
import { db, type PgStatement } from "@/server/db/client";
import { serverEnv } from "@/server/env";
import type { Actor } from "@/server/actors";
import { createLinkedCoursework, getCoursework, listCourseStudents, listCourseworkSubmissions, listTeacherCourses, matchClassroomStudent, returnSubmission, sendGradeToClassroom } from "@/server/classroom";
import { getRunForTeacher, questionsForParticipant } from "@/server/repository";
import { getRunCapabilities } from "@/server/exam-permissions";


// `accounts` es tabla de better-auth: sus timestamps son timestamptz, así que
// node-postgres los devuelve como Date. Ver src/server/db/schema.ts.
interface GoogleAccount {
  access_token: string | null;
  refresh_token: string | null;
  access_token_expires_at: Date | null;
}

export async function googleAccessToken(actor: Actor) {
  const account = await db.prepare(
    "SELECT access_token, refresh_token, access_token_expires_at FROM accounts WHERE user_id = ? AND provider_id = 'google' ORDER BY updated_at DESC LIMIT 1",
  ).bind(actor.id).first<GoogleAccount>();
  if (!account?.access_token) throw new Error("Conectá Google Classroom para continuar");
  if (!account.access_token_expires_at || account.access_token_expires_at.getTime() > Date.now() + 60_000) return account.access_token;
  if (!account.refresh_token) throw new Error("Google venció la autorización. Volvé a conectar Classroom.");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: serverEnv.GOOGLE_CLIENT_ID,
      client_secret: serverEnv.GOOGLE_CLIENT_SECRET,
      refresh_token: account.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) throw new Error("Google rechazó la renovación del permiso de Classroom");
  const body = await response.json() as { access_token: string; expires_in: number };
  await db.prepare(
    "UPDATE accounts SET access_token = ?, access_token_expires_at = ?, updated_at = ? WHERE user_id = ? AND provider_id = 'google'",
  ).bind(body.access_token, new Date(Date.now() + body.expires_in * 1000), new Date(), actor.id).run();
  return body.access_token;
}

export async function classroomCourses(actor: Actor) {
  return listTeacherCourses(await googleAccessToken(actor));
}

export async function publishRunToClassroom(actor: Actor, runId: string, courseId: string, origin: string) {
  if (!(await getRunCapabilities(runId, actor)).manageClassroom) throw new Error("No tenés permiso para operar Classroom en esta evaluación");
  const run = await getRunForTeacher(runId, actor);
  if (!run) return null;
  const token = await googleAccessToken(actor);
  const [{ students }, coursework] = await Promise.all([
    listCourseStudents(token, courseId),
    createLinkedCoursework(token, {
      courseId,
      title: run.title,
      // El enlace alcanza para entrar, pero el código va igual en el texto: si
      // el alumno abre Classroom desde el celular y rinde en otra máquina,
      // tiene que poder escribirlo a mano.
      description: [
        "Entrá al enlace de abajo para rendir la evaluación en Testra.",
        `Si preferís entrar a mano, el código de la sala es ${run.code}.`,
        "Si ingresás con la misma cuenta de Google o correo de Classroom, Testra podrá vincular tu nota de forma segura.",
      ].join("\n\n"),
      runUrl: `${origin}/rendir/${run.code}`,
      // Cada alumno puede recibir preguntas con puntajes distintos. Classroom
      // necesita un maximo comun, por eso las nuevas tareas usan porcentaje.
      maxPoints: 100,
    }),
  ]);
  const statements: PgStatement[] = [
    db.prepare("UPDATE runs SET classroom_course_id = ?, classroom_coursework_id = ? WHERE id = ?").bind(courseId, coursework.id, runId),
    db.prepare("DELETE FROM expected_run_students WHERE run_id = ?").bind(runId),
  ];
  for (const student of students) {
    statements.push(db.prepare(
      "INSERT INTO expected_run_students (run_id, google_user_id, name, email) VALUES (?, ?, ?, ?)",
    ).bind(runId, student.userId, student.profile.name.fullName, student.profile.emailAddress ?? null));
  }
  await db.batch(statements);
  return { coursework, studentCount: students.length };
}

export async function classroomGradePreview(actor: Actor, runId: string) {
  if (!(await getRunCapabilities(runId, actor)).manageClassroom) throw new Error("No tenés permiso para operar Classroom en esta evaluación");
  const run = await getRunForTeacher(runId, actor);
  if (!run) return null;
  if (!run.classroom_course_id || !run.classroom_coursework_id) throw new Error("Esta sesión no está vinculada con Classroom");
  const token = await googleAccessToken(actor);
  const [{ submissions }, coursework, result, expected, gradeResult] = await Promise.all([
    listCourseworkSubmissions(token, run.classroom_course_id, run.classroom_coursework_id),
    getCoursework(token, run.classroom_course_id, run.classroom_coursework_id),
    db.prepare(
      `SELECT p.id AS participant_id, p.display_name AS name, u.email,
        (SELECT a.account_id FROM accounts a WHERE a.user_id = u.id AND a.provider_id = 'google' ORDER BY a.updated_at DESC LIMIT 1) AS google_user_id
       FROM participants p LEFT JOIN users u ON u.id = p.user_id
       WHERE p.run_id = ? AND p.status = 'submitted'`,
    ).bind(runId).all<{ participant_id: string; name: string; email: string | null; google_user_id: string | null }>(),
    db.prepare("SELECT google_user_id, name, email FROM expected_run_students WHERE run_id = ?")
      .bind(runId).all<{ google_user_id: string; name: string; email: string | null }>(),
    db.prepare(
      `SELECT g.participant_id, g.question_id, g.points_awarded
       FROM grades g JOIN participants p ON p.id = g.participant_id WHERE p.run_id = ?`,
    ).bind(runId).all<{ participant_id: string; question_id: string; points_awarded: number | null }>(),
  ]);
  const submissionByUser = new Map(submissions.map((submission) => [submission.userId, submission]));
  return {
    courseId: run.classroom_course_id,
    courseworkId: run.classroom_coursework_id,
    token,
    rows: result.results.map((row) => {
      const match = matchClassroomStudent({ googleUserId: row.google_user_id, email: row.email }, expected.results);
      const submission = submissionByUser.get(match?.googleUserId ?? "");
      const assignedQuestions = questionsForParticipant(run, row.participant_id);
      const assignedIds = new Set(assignedQuestions.map((question) => question.id));
      const assignedGrades = gradeResult.results.filter((grade) => grade.participant_id === row.participant_id && assignedIds.has(grade.question_id));
      const assignedMax = assignedQuestions.reduce((total, question) => total + question.points, 0);
      const score = assignedGrades.reduce((total, item) => total + Number(item.points_awarded ?? 0), 0);
      const pendingManual = assignedGrades.filter((item) => item.points_awarded === null).length;
      const grade = assignedMax > 0 ? Math.round((score / assignedMax) * coursework.maxPoints * 100) / 100 : 0;
      return {
        participantId: row.participant_id,
        name: row.name,
        email: row.email,
        matchMethod: match?.method ?? null,
        linked: Boolean(match),
        grade,
        score,
        assignedMax,
        classroomMax: coursework.maxPoints,
        pendingManual,
        submissionId: submission?.id ?? null,
        submissionState: submission?.state ?? null,
        // Alcanza con que exista la entrega en Classroom y que no queden
        // desarrollos sin corregir. No se pide TURNED_IN: ver el comentario de
        // sendGradeToClassroom.
        canSend: Boolean(match && submission && pendingManual === 0),
      };
    }),
  };
}

export async function sendRunGrades(actor: Actor, runId: string) {
  const preview = await classroomGradePreview(actor, runId);
  if (!preview) return null;
  const eligible = preview.rows.filter((row) => row.canSend && row.submissionId);
  const unlinked = preview.rows.filter((row) => !row.linked).map((row) => ({ name: row.name, email: row.email }));
  const pending = preview.rows.filter((row) => row.linked && row.pendingManual > 0).map((row) => row.name);

  let sent = 0;
  const failures: Array<{ name: string; reason: string }> = [];

  for (const row of eligible) {
    try {
      // Escribir la nota y devolver la entrega son dos pasos distintos de la
      // API. Si sólo se escribe, el alumno no ve nada.
      await sendGradeToClassroom(preview.token, {
        courseId: preview.courseId,
        courseworkId: preview.courseworkId,
        submissionId: row.submissionId!,
        grade: row.grade,
      });
      if (row.submissionState !== "RETURNED") {
        await returnSubmission(preview.token, {
          courseId: preview.courseId,
          courseworkId: preview.courseworkId,
          submissionId: row.submissionId!,
        });
      }
      await db.prepare("UPDATE participants SET classroom_submission_id = ? WHERE id = ?")
        .bind(row.submissionId, row.participantId).run();
      sent += 1;
    } catch (error) {
      // Un alumno que falla no puede dejar sin nota a los demás.
      failures.push({ name: row.name, reason: error instanceof Error ? error.message.slice(0, 200) : "error desconocido" });
    }
  }

  return {
    sent,
    skipped: preview.rows.length - eligible.length,
    unlinked,
    pending,
    failures,
    rows: preview.rows,
  };
}
