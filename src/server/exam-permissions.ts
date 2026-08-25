import type { Actor } from "@/server/actors";
import { db } from "@/server/db/client";

export type CollaboratorPermission = "view" | "edit" | "correct";

export interface ExamCapabilities {
  role: "owner" | "superadmin" | CollaboratorPermission | "none";
  view: boolean;
  edit: boolean;
  correct: boolean;
  openRuns: boolean;
  publishResults: boolean;
  manageClassroom: boolean;
  manageSharing: boolean;
  delete: boolean;
}

interface AccessRow {
  owner_id: string | null;
  permission: CollaboratorPermission | null;
  can_publish_results: number | null;
  can_manage_classroom: number | null;
}

const noAccess: ExamCapabilities = {
  role: "none",
  view: false,
  edit: false,
  correct: false,
  openRuns: false,
  publishResults: false,
  manageClassroom: false,
  manageSharing: false,
  delete: false,
};

export function capabilitiesFor(actor: Actor, row: AccessRow | null): ExamCapabilities {
  if (!row) return noAccess;
  if (row.owner_id === actor.id) {
    return {
      role: "owner",
      view: true,
      edit: true,
      correct: true,
      openRuns: true,
      publishResults: true,
      manageClassroom: true,
      manageSharing: true,
      delete: true,
    };
  }
  if (actor.superadmin) return { ...noAccess, role: "superadmin", view: true };
  if (!row.permission) return noAccess;
  return {
    role: row.permission,
    view: true,
    edit: row.permission === "edit",
    correct: row.permission === "correct",
    openRuns: row.permission === "edit",
    publishResults: Boolean(row.can_publish_results),
    manageClassroom: Boolean(row.can_manage_classroom),
    manageSharing: false,
    delete: false,
  };
}

export async function getExamCapabilities(examId: string, actor: Actor): Promise<ExamCapabilities> {
  const row = await db.prepare(
    `SELECT e.author_id AS owner_id, c.permission, c.can_publish_results, c.can_manage_classroom
     FROM exams e
     LEFT JOIN exam_collaborators c ON c.exam_id = e.id AND c.user_id = ?
     WHERE e.id = ?`,
  ).bind(actor.id, examId).first<AccessRow>();
  return capabilitiesFor(actor, row);
}

export async function getRunCapabilities(runId: string, actor: Actor): Promise<ExamCapabilities> {
  const row = await db.prepare(
    `SELECT COALESCE(e.author_id, r.author_id) AS owner_id,
            c.permission, c.can_publish_results, c.can_manage_classroom
     FROM runs r
     LEFT JOIN exams e ON e.id = r.exam_id
     LEFT JOIN exam_collaborators c ON c.exam_id = e.id AND c.user_id = ?
     WHERE r.id = ?`,
  ).bind(actor.id, runId).first<AccessRow>();
  return capabilitiesFor(actor, row);
}

export interface ExamCollaborator {
  userId: string;
  name: string;
  email: string;
  permission: CollaboratorPermission;
  canPublishResults: boolean;
  canManageClassroom: boolean;
}

export async function listExamCollaborators(examId: string, actor: Actor): Promise<ExamCollaborator[] | null> {
  const capabilities = await getExamCapabilities(examId, actor);
  if (!capabilities.manageSharing) return null;
  const result = await db.prepare(
    `SELECT u.id AS user_id, u.name, u.email, c.permission,
            c.can_publish_results, c.can_manage_classroom
     FROM exam_collaborators c JOIN users u ON u.id = c.user_id
     WHERE c.exam_id = ? ORDER BY u.name, u.email`,
  ).bind(examId).all<{
    user_id: string;
    name: string;
    email: string;
    permission: CollaboratorPermission;
    can_publish_results: number;
    can_manage_classroom: number;
  }>();
  return result.results.map((row) => ({
    userId: row.user_id,
    name: row.name,
    email: row.email,
    permission: row.permission,
    canPublishResults: Boolean(row.can_publish_results),
    canManageClassroom: Boolean(row.can_manage_classroom),
  }));
}

export async function upsertExamCollaborator(
  examId: string,
  actor: Actor,
  input: {
    email: string;
    permission: CollaboratorPermission;
    canPublishResults: boolean;
    canManageClassroom: boolean;
  },
): Promise<ExamCollaborator> {
  const capabilities = await getExamCapabilities(examId, actor);
  if (!capabilities.manageSharing) throw new Error("Solo el propietario puede administrar accesos");
  const user = await db.prepare(
    "SELECT id, name, email, role FROM users WHERE lower(email) = lower(?)",
  ).bind(input.email.trim()).first<{ id: string; name: string; email: string; role: string }>();
  if (!user || user.role !== "teacher") throw new Error("El docente debe tener una cuenta en Testra");
  if (user.id === actor.id) throw new Error("Ya sos el propietario de esta evaluación");
  const now = Date.now();
  await db.prepare(
    `INSERT INTO exam_collaborators
       (exam_id, user_id, permission, can_publish_results, can_manage_classroom, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(exam_id, user_id) DO UPDATE SET
       permission = excluded.permission,
       can_publish_results = excluded.can_publish_results,
       can_manage_classroom = excluded.can_manage_classroom,
       updated_at = excluded.updated_at`,
  ).bind(
    examId,
    user.id,
    input.permission,
    input.canPublishResults ? 1 : 0,
    input.canManageClassroom ? 1 : 0,
    now,
    now,
  ).run();
  return {
    userId: user.id,
    name: user.name,
    email: user.email,
    permission: input.permission,
    canPublishResults: input.canPublishResults,
    canManageClassroom: input.canManageClassroom,
  };
}

export async function removeExamCollaborator(examId: string, userId: string, actor: Actor): Promise<boolean> {
  const capabilities = await getExamCapabilities(examId, actor);
  if (!capabilities.manageSharing) return false;
  const result = await db.prepare("DELETE FROM exam_collaborators WHERE exam_id = ? AND user_id = ?")
    .bind(examId, userId).run();
  return result.meta.changes > 0;
}
