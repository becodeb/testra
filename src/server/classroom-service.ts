import { env } from "cloudflare:workers";

import type { Actor } from "@/server/actors";
import { createLinkedCoursework, listCourseStudents, listCourseworkSubmissions, listTeacherCourses, sendGradeToClassroom } from "@/server/classroom";
import { getRunForTeacher } from "@/server/repository";

const runtimeEnv = env as unknown as CloudflareEnv;

interface GoogleAccount {
  access_token: string | null;
  refresh_token: string | null;
  access_token_expires_at: number | null;
}

export async function googleAccessToken(actor: Actor) {
  const account = await runtimeEnv.DB.prepare(
    "SELECT access_token, refresh_token, access_token_expires_at FROM accounts WHERE user_id = ? AND provider_id = 'google' ORDER BY updated_at DESC LIMIT 1",
  ).bind(actor.id).first<GoogleAccount>();
  if (!account?.access_token) throw new Error("Conectá Google Classroom para continuar");
  if (!account.access_token_expires_at || account.access_token_expires_at > Date.now() + 60_000) return account.access_token;
  if (!account.refresh_token) throw new Error("Google venció la autorización. Volvé a conectar Classroom.");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: runtimeEnv.GOOGLE_CLIENT_ID,
      client_secret: runtimeEnv.GOOGLE_CLIENT_SECRET,
      refresh_token: account.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) throw new Error("Google rechazó la renovación del permiso de Classroom");
  const body = await response.json() as { access_token: string; expires_in: number };
  await runtimeEnv.DB.prepare(
    "UPDATE accounts SET access_token = ?, access_token_expires_at = ?, updated_at = ? WHERE user_id = ? AND provider_id = 'google'",
  ).bind(body.access_token, Date.now() + body.expires_in * 1000, Date.now(), actor.id).run();
  return body.access_token;
}

export async function classroomCourses(actor: Actor) {
  return listTeacherCourses(await googleAccessToken(actor));
}

export async function publishRunToClassroom(actor: Actor, runId: string, courseId: string, origin: string) {
  const run = await getRunForTeacher(runId, actor);
  if (!run) return null;
  const token = await googleAccessToken(actor);
  const [{ students }, coursework] = await Promise.all([
    listCourseStudents(token, courseId),
    createLinkedCoursework(token, {
      courseId,
      title: run.title,
      description: "Ingresá a Testra con tu cuenta institucional para rendir la evaluación.",
      runUrl: `${origin}/rendir/${run.code}`,
      maxPoints: (JSON.parse(run.questions_snapshot) as Array<{ points: number }>).reduce((sum, question) => sum + question.points, 0),
    }),
  ]);
  const statements: D1PreparedStatement[] = [
    runtimeEnv.DB.prepare("UPDATE runs SET classroom_course_id = ?, classroom_coursework_id = ? WHERE id = ?").bind(courseId, coursework.id, runId),
    runtimeEnv.DB.prepare("DELETE FROM expected_run_students WHERE run_id = ?").bind(runId),
  ];
  for (const student of students) {
    statements.push(runtimeEnv.DB.prepare(
      "INSERT INTO expected_run_students (run_id, google_user_id, name, email) VALUES (?, ?, ?, ?)",
    ).bind(runId, student.userId, student.profile.name.fullName, student.profile.emailAddress ?? null));
  }
  await runtimeEnv.DB.batch(statements);
  return { coursework, studentCount: students.length };
}

export async function classroomGradePreview(actor: Actor, runId: string) {
  const run = await getRunForTeacher(runId, actor);
  if (!run) return null;
  if (!run.classroom_course_id || !run.classroom_coursework_id) throw new Error("Esta toma no está vinculada con Classroom");
  const token = await googleAccessToken(actor);
  const { submissions } = await listCourseworkSubmissions(token, run.classroom_course_id, run.classroom_coursework_id);
  const result = await runtimeEnv.DB.prepare(
    `SELECT p.id AS participant_id, u.name, u.email,
      SUM(CASE WHEN g.points_awarded IS NOT NULL THEN g.points_awarded ELSE 0 END) AS grade,
      SUM(CASE WHEN g.points_awarded IS NULL THEN 1 ELSE 0 END) AS pending
     FROM participants p JOIN users u ON u.id = p.user_id
     LEFT JOIN grades g ON g.participant_id = p.id
     WHERE p.run_id = ? AND p.status = 'submitted' GROUP BY p.id`,
  ).bind(runId).all<{ participant_id: string; name: string; email: string; grade: number; pending: number }>();
  const expected = await runtimeEnv.DB.prepare(
    "SELECT google_user_id, email FROM expected_run_students WHERE run_id = ?",
  ).bind(runId).all<{ google_user_id: string; email: string | null }>();
  const googleByEmail = new Map(expected.results.filter((row) => row.email).map((row) => [row.email!.toLocaleLowerCase(), row.google_user_id]));
  const submissionByUser = new Map(submissions.map((submission) => [submission.userId, submission]));
  return {
    courseId: run.classroom_course_id,
    courseworkId: run.classroom_coursework_id,
    token,
    rows: result.results.map((row) => {
      const submission = submissionByUser.get(googleByEmail.get(row.email.toLocaleLowerCase()) ?? "");
      return {
        participantId: row.participant_id,
        name: row.name,
        email: row.email,
        grade: Number(row.grade),
        pendingManual: Number(row.pending),
        submissionId: submission?.id ?? null,
        submissionState: submission?.state ?? null,
        canSend: Boolean(submission && row.pending === 0 && (submission.state === "TURNED_IN" || submission.state === "RETURNED")),
      };
    }),
  };
}

export async function sendRunGrades(actor: Actor, runId: string) {
  const preview = await classroomGradePreview(actor, runId);
  if (!preview) return null;
  const eligible = preview.rows.filter((row) => row.canSend && row.submissionId && row.submissionState);
  for (const row of eligible) {
    await sendGradeToClassroom(preview.token, {
      courseId: preview.courseId,
      courseworkId: preview.courseworkId,
      submissionId: row.submissionId!,
      grade: row.grade,
      submissionState: row.submissionState!,
    });
    await runtimeEnv.DB.prepare("UPDATE participants SET classroom_submission_id = ? WHERE id = ?").bind(row.submissionId, row.participantId).run();
  }
  return { sent: eligible.length, skipped: preview.rows.length - eligible.length, rows: preview.rows };
}
