import { getCoursework, listCourseworkSubmissions, returnSubmission, sendGradeToClassroom } from "@/server/classroom";
import { db } from "@/server/db/client";
import { serverEnv } from "@/server/env";

interface GoogleAccount {
  access_token: string | null;
  refresh_token: string | null;
  access_token_expires_at: Date | null;
}

interface AutomaticGradeInput {
  runId: string;
  participantId: string;
  score: number;
  maxPoints: number;
  hasPendingManual: boolean;
}

export function canAutomaticallyReturnClassroomGrade(input: Pick<AutomaticGradeInput, "maxPoints" | "hasPendingManual">) {
  return input.maxPoints > 0 && !input.hasPendingManual;
}

async function teacherAccessToken(userId: string) {
  const account = await db.prepare(
    "SELECT access_token, refresh_token, access_token_expires_at FROM accounts WHERE user_id = ? AND provider_id = 'google' ORDER BY updated_at DESC LIMIT 1",
  ).bind(userId).first<GoogleAccount>();
  if (!account?.access_token) throw new Error("El docente no tiene Google Classroom autorizado");
  if (!account.access_token_expires_at || account.access_token_expires_at.getTime() > Date.now() + 60_000) return account.access_token;
  if (!account.refresh_token) throw new Error("Google venció la autorización del docente");

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
  ).bind(body.access_token, new Date(Date.now() + body.expires_in * 1_000), new Date(), userId).run();
  return body.access_token;
}

/**
 * Devuelve automáticamente sólo notas completamente autocorregibles. Los
 * desarrollos siguen esperando la corrección del docente y su publicación.
 */
export async function syncAutomaticClassroomGrade(input: AutomaticGradeInput) {
  if (!canAutomaticallyReturnClassroomGrade(input)) return { status: "pending-manual" as const };

  const context = await db.prepare(
    `SELECT r.classroom_course_id, r.classroom_coursework_id, r.author_id,
            p.classroom_google_user_id, p.classroom_submission_id
     FROM participants p JOIN runs r ON r.id = p.run_id
     WHERE p.id = ? AND p.run_id = ?`,
  ).bind(input.participantId, input.runId).first<{
    classroom_course_id: string | null;
    classroom_coursework_id: string | null;
    author_id: string | null;
    classroom_google_user_id: string | null;
    classroom_submission_id: string | null;
  }>();
  if (!context?.classroom_course_id || !context.classroom_coursework_id || !context.author_id || !context.classroom_google_user_id) {
    return { status: "not-linked" as const };
  }

  const token = await teacherAccessToken(context.author_id);
  const [{ submissions }, coursework] = await Promise.all([
    listCourseworkSubmissions(token, context.classroom_course_id, context.classroom_coursework_id),
    getCoursework(token, context.classroom_course_id, context.classroom_coursework_id),
  ]);
  const submission = submissions.find((candidate) => candidate.userId === context.classroom_google_user_id);
  if (!submission) throw new Error("No se encontró la entrega de este alumno en Google Classroom");

  const grade = Math.round((input.score / input.maxPoints) * coursework.maxPoints * 100) / 100;
  await sendGradeToClassroom(token, {
    courseId: context.classroom_course_id,
    courseworkId: context.classroom_coursework_id,
    submissionId: submission.id,
    grade,
  });
  if (submission.state !== "RETURNED") {
    await returnSubmission(token, {
      courseId: context.classroom_course_id,
      courseworkId: context.classroom_coursework_id,
      submissionId: submission.id,
    });
  }
  await db.prepare("UPDATE participants SET classroom_submission_id = ? WHERE id = ?")
    .bind(submission.id, input.participantId).run();
  return { status: "sent" as const, grade };
}
