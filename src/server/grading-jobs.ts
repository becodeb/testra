import type { FullQuestion } from "@/domain/exam";
import type { Actor } from "@/server/actors";
import { AI_GRADING_MODEL, GmiGradingProvider, type AiGradingInput, type AiGradingProvider } from "@/server/ai-grading";
import { db } from "@/server/db/client";
import { getRunCapabilities } from "@/server/exam-permissions";

type JobStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";

interface CandidateRow {
  grade_id: string;
  question_id: string;
  value: string | null;
  questions_snapshot: string;
  ai_grading_mode: "off" | "suggest" | "auto_clear";
}

const WORKERS_KEY = Symbol.for("testra.gradingJobWorkers");
const workers = ((globalThis as typeof globalThis & { [WORKERS_KEY]?: Set<string> })[WORKERS_KEY] ??= new Set<string>());
const RESUME_KEY = Symbol.for("testra.gradingJobResumeAt");
const resumeState = globalThis as typeof globalThis & { [RESUME_KEY]?: number };

function eligibleSql(runId: string | null) {
  return `SELECT g.id AS grade_id, g.question_id, a.value, r.ai_grading_mode,
    -- Quien rinde una version adaptada respondio SUS preguntas: buscarlas en
    -- el examen de la toma no las encuentra y la correccion con IA se saltea.
    COALESCE(p.assigned_questions_snapshot, r.questions_snapshot) AS questions_snapshot
    FROM grades g
    JOIN participants p ON p.id = g.participant_id
    JOIN runs r ON r.id = p.run_id
    LEFT JOIN answers a ON a.participant_id = p.id AND a.question_id = g.question_id
    WHERE p.status = 'submitted' AND g.grading_status IN ('pending_manual', 'ai_queued', 'ai_processing')
      ${runId ? "AND r.id = ?" : ""}`;
}

const jobItemsSql = `SELECT g.id AS grade_id, g.question_id, a.value, r.ai_grading_mode,
    -- Quien rinde una version adaptada respondio SUS preguntas: buscarlas en
    -- el examen de la toma no las encuentra y la correccion con IA se saltea.
    COALESCE(p.assigned_questions_snapshot, r.questions_snapshot) AS questions_snapshot
  FROM grading_job_items ji JOIN grades g ON g.id = ji.grade_id
  JOIN participants p ON p.id = g.participant_id JOIN runs r ON r.id = p.run_id
  LEFT JOIN answers a ON a.participant_id = p.id AND a.question_id = g.question_id
  WHERE ji.job_id = ? AND ji.status IN ('queued', 'processing')`;

async function assertRunAccess(runId: string | null, actor: Actor) {
  if (!runId) return;
  const capabilities = await getRunCapabilities(runId, actor);
  if (!capabilities.correct) throw new Error("No tenés acceso a esta corrección");
}

export async function createGradingJob(actor: Actor, runId: string | null) {
  if (!runId) throw new Error("Elegí una evaluación para analizar sus respuestas");
  await assertRunAccess(runId, actor);
  const existing = await db.prepare("SELECT id FROM grading_jobs WHERE run_id = ? AND status IN ('queued', 'processing') ORDER BY created_at DESC LIMIT 1")
    .bind(runId).first<{ id: string }>();
  if (existing) {
    const job = await getGradingJob(actor, existing.id);
    if (job) { ensureGradingJob(existing.id); return job; }
    throw new Error("Ya hay un análisis en curso para esta evaluación");
  }
  const rows = await (runId
    ? db.prepare(eligibleSql(runId)).bind(runId)
    : db.prepare(`${eligibleSql(null)} AND (r.author_id = ? OR EXISTS (SELECT 1 FROM organization_memberships om WHERE om.organization_id = r.org_id AND om.user_id = ?))`).bind(actor.id, actor.id)
  ).all<CandidateRow>();
  const candidates = rows.results.filter((row) => {
    const question = (JSON.parse(row.questions_snapshot) as FullQuestion[]).find((item) => item.id === row.question_id);
    // Sin interruptor previo: si es de desarrollo, la IA puede sugerir. Los
    // criterios se cargan cuando el docente quiere, incluso despues de la toma.
    return question?.type === "long";
  });
  const jobId = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    db.prepare("INSERT INTO grading_jobs (id, run_id, requested_by, status, total, processed, failed, created_at) VALUES (?, ?, ?, 'queued', ?, 0, 0, ?)")
      .bind(jobId, runId, actor.id, candidates.length, now),
    ...candidates.map((row) => db.prepare("INSERT INTO grading_job_items (job_id, grade_id, status) VALUES (?, ?, 'queued')").bind(jobId, row.grade_id)),
    ...candidates.map((row) => db.prepare("UPDATE grades SET grading_status = 'ai_queued', ai_error = NULL WHERE id = ? AND grading_status = 'pending_manual'").bind(row.grade_id)),
  ]);
  ensureGradingJob(jobId);
  return getGradingJob(actor, jobId);
}

export async function getGradingJob(actor: Actor, jobId: string) {
  return db.prepare("SELECT id, run_id, status, total, processed, failed, created_at, started_at, completed_at, error FROM grading_jobs WHERE id = ? AND requested_by = ?")
    .bind(jobId, actor.id).first<{ id: string; run_id: string | null; status: JobStatus; total: number; processed: number; failed: number; created_at: number; started_at: number | null; completed_at: number | null; error: string | null }>();
}

export async function cancelGradingJob(actor: Actor, jobId: string) {
  await db.prepare("UPDATE grading_jobs SET status = 'cancelled', completed_at = ? WHERE id = ? AND requested_by = ? AND status IN ('queued', 'processing')")
    .bind(Date.now(), jobId, actor.id).run();
  await db.prepare("UPDATE grades SET grading_status = 'pending_manual' WHERE grading_status IN ('ai_queued', 'ai_processing') AND id IN (SELECT grade_id FROM grading_job_items WHERE job_id = ? AND status IN ('queued', 'processing'))")
    .bind(jobId).run();
  await db.prepare("UPDATE grading_job_items SET status = 'cancelled' WHERE job_id = ? AND status IN ('queued', 'processing')").bind(jobId).run();
  return getGradingJob(actor, jobId);
}

export function ensureGradingJob(jobId: string, provider: AiGradingProvider = new GmiGradingProvider()) {
  if (workers.has(jobId)) return;
  workers.add(jobId);
  void processGradingJob(jobId, provider).finally(() => workers.delete(jobId));
}

export async function resumeGradingJobs() {
  const pending = await db.prepare("SELECT id FROM grading_jobs WHERE status IN ('queued', 'processing') ORDER BY created_at LIMIT 10").all<{ id: string }>();
  for (const job of pending.results) ensureGradingJob(job.id);
}

export function kickGradingJobs(now = Date.now()) {
  if (now - (resumeState[RESUME_KEY] ?? 0) < 30_000) return;
  resumeState[RESUME_KEY] = now;
  void resumeGradingJobs().catch((error) => console.error("[correcciones] no se pudieron reanudar procesos", error));
}

/**
 * Cómo cierra un lote de corrección.
 *
 * Cerrar siempre como "completo" era el peor de los finales posibles: si una
 * respuesta quedaba sin procesar, el docente leía "Análisis completo" y
 * publicaba notas creyendo que estaban todas. Un lote con trabajo sin terminar
 * se cierra como fallado y dice cuántas quedaron.
 */
export function jobClosure(remaining: number, failed: number): { status: "completed" | "failed"; error: string | null } {
  if (remaining > 0) {
    return { status: "failed", error: `Quedaron ${remaining} respuesta${remaining === 1 ? "" : "s"} sin analizar. Se corrigen a mano desde la bandeja.` };
  }
  if (failed > 0) {
    return { status: "completed", error: `${failed} respuesta${failed === 1 ? " no se pudo analizar" : "s no se pudieron analizar"}. Se corrigen a mano desde la bandeja.` };
  }
  return { status: "completed", error: null };
}

/**
 * La pregunta de una respuesta puede no estar en el examen de la toma: se
 * regeneró con variantes, o al alumno se le asignó una versión adaptada
 * después de que entrara al lote. Antes esto salteaba la respuesta en silencio
 * —el ítem quedaba encolado para siempre y el contador nunca llegaba al total—.
 * Ahora se marca como fallada, con el motivo a la vista.
 */
export const MISSING_QUESTION_ERROR = "La pregunta ya no está en el examen de esta toma. Corregila a mano.";

async function processGradingJob(jobId: string, provider: AiGradingProvider) {
  const claimed = await db.prepare("UPDATE grading_jobs SET status = 'processing', started_at = COALESCE(started_at, ?) WHERE id = ? AND status IN ('queued', 'processing') RETURNING run_id")
    .bind(Date.now(), jobId).first<{ run_id: string | null }>();
  if (!claimed) return;
  try {
    const candidates = await db.prepare(jobItemsSql).bind(jobId).all<CandidateRow>();
    for (const row of candidates.results) {
      const job = await db.prepare("SELECT status FROM grading_jobs WHERE id = ?").bind(jobId).first<{ status: JobStatus }>();
      if (job?.status === "cancelled") return;
      const question = (JSON.parse(row.questions_snapshot) as FullQuestion[]).find((item) => item.id === row.question_id);
      if (!question || question.type !== "long") {
        // Nunca dejar un ítem colgado: se cierra como fallado y cuenta.
        await db.batch([
          db.prepare("UPDATE grades SET grading_status = 'pending_manual', ai_error = ? WHERE id = ?").bind(MISSING_QUESTION_ERROR, row.grade_id),
          db.prepare("UPDATE grading_job_items SET status = 'failed' WHERE job_id = ? AND grade_id = ?").bind(jobId, row.grade_id),
          db.prepare("UPDATE grading_jobs SET processed = processed + 1, failed = failed + 1 WHERE id = ?").bind(jobId),
        ]);
        continue;
      }
      await db.batch([
        db.prepare("UPDATE grades SET grading_status = 'ai_processing' WHERE id = ?").bind(row.grade_id),
        db.prepare("UPDATE grading_job_items SET status = 'processing' WHERE job_id = ? AND grade_id = ?").bind(jobId, row.grade_id),
      ]);
      try {
        const parsed = row.value === null ? "" : JSON.parse(row.value);
        const input: AiGradingInput = {
          prompt: question.prompt,
          answer: typeof parsed === "string" ? parsed : JSON.stringify(parsed),
          maxPoints: question.points,
          gradingCriteria: question.config.gradingCriteria ?? "",
          referenceAnswer: question.config.referenceAnswer ?? "",
          rubric: question.config.rubric ?? [],
        };
        const result = input.answer.trim() ? await provider.grade(input) : { score: 0, maxScore: input.maxPoints, confidence: 1, feedback: "No se registró una respuesta.", teacherNote: "Respuesta vacía.", criteria: [] };
        // La IA nunca escribe una nota sola. Deja la sugerencia y el puntaje
        // queda sin asignar hasta que el docente la acepta o la corrige: la
        // responsabilidad por la nota no es delegable, y el rastro de que vino
        // de una sugerencia queda en ai_suggested_score y graded_by_type.
        await db.prepare(
          `UPDATE grades SET grading_status = 'ai_suggested', ai_suggested_score = ?, ai_confidence = ?, ai_feedback = ?, ai_teacher_note = ?, ai_criteria = ?, ai_model = ?, ai_error = NULL
           WHERE id = ?`,
        ).bind(result.score, result.confidence, result.feedback, result.teacherNote, JSON.stringify(result.criteria), AI_GRADING_MODEL, row.grade_id).run();
        await db.batch([
          db.prepare("UPDATE grading_job_items SET status = 'completed' WHERE job_id = ? AND grade_id = ?").bind(jobId, row.grade_id),
          db.prepare("UPDATE grading_jobs SET processed = processed + 1 WHERE id = ?").bind(jobId),
        ]);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falló el análisis";
        await db.batch([
          db.prepare("UPDATE grades SET grading_status = 'pending_manual', ai_error = ? WHERE id = ?").bind(message.slice(0, 1000), row.grade_id),
          db.prepare("UPDATE grading_job_items SET status = 'failed' WHERE job_id = ? AND grade_id = ?").bind(jobId, row.grade_id),
          db.prepare("UPDATE grading_jobs SET processed = processed + 1, failed = failed + 1 WHERE id = ?").bind(jobId),
        ]);
      }
    }
    const restantes = await db.prepare("SELECT COUNT(*) AS n FROM grading_job_items WHERE job_id = ? AND status IN ('queued', 'processing')").bind(jobId).first<{ n: number }>();
    const fallados = await db.prepare("SELECT COUNT(*) AS n FROM grading_job_items WHERE job_id = ? AND status = 'failed'").bind(jobId).first<{ n: number }>();
    const cierre = jobClosure(Number(restantes?.n ?? 0), Number(fallados?.n ?? 0));
    await db.prepare("UPDATE grading_jobs SET status = ?, completed_at = ?, error = ? WHERE id = ? AND status = 'processing'")
      .bind(cierre.status, Date.now(), cierre.error, jobId).run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falló el lote de corrección";
    await db.prepare("UPDATE grading_jobs SET status = 'failed', completed_at = ?, error = ? WHERE id = ?").bind(Date.now(), message.slice(0, 1000), jobId).run();
  }
}
