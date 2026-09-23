import type { Actor } from "@/server/actors";
import { db } from "@/server/db/client";
import { analyzeSimilarity, buildSimilarityClassInput, type SimilarityReport } from "@/server/similarity-analysis";
import type { ParticipantResponse, SimilarityClassInput } from "@/server/similarity-signals";

// Persiste el reporte de similitud entre alumnos de una toma: un row por
// `run_id` (a diferencia de `ai_reports`, este reporte no se escopa por
// `scope_type`/`scope_id` porque siempre compara a la toma entera contra sí
// misma). Mismas convenciones que `src/server/ai-reports.ts`: hash del input
// para saber si conviene regenerar, upsert por `ON CONFLICT`. Ver
// `odd/tasks/jev-copy-detection.md`.

export interface StoredSimilarityReport {
  report: SimilarityReport;
  /** El `input_hash` guardado ya no coincide con el de las respuestas actuales: alguien respondió, corrigió o se agregó a la toma después de la última búsqueda. */
  stale: boolean;
  updatedAt: number;
}

interface SimilarityReportRow {
  report: string;
  input_hash: string;
  updated_at: number;
}

// --- Canonicalización pura, para el hash de staleness ------------------------
//
// Deliberadamente SIN nombres: renombrar a un alumno no puede volver "stale"
// un reporte ya calculado. Ordenado por id en cada nivel (preguntas y
// participantes) para que el resultado no dependa del orden de iteración de
// la base ni de `Map`. Función pura y exportada para poder testearla sin
// tocar la base (convención del repo: ver `buildSimilarityClassInput`).

interface CanonicalQuestion {
  id: string;
  type: string;
  prompt: string;
  expectedText: string;
}

interface CanonicalParticipant {
  participantId: string;
  responses: Array<[string, ParticipantResponse]>;
}

export interface CanonicalSimilarityInput {
  questions: CanonicalQuestion[];
  participants: CanonicalParticipant[];
}

export function canonicalizeSimilarityInput(input: SimilarityClassInput): CanonicalSimilarityInput {
  const questions = [...input.questions]
    .map((question) => ({ id: question.id, type: question.type, prompt: question.prompt, expectedText: question.expectedText }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const participants = [...input.participants]
    .map((participant) => ({
      participantId: participant.participantId,
      responses: [...participant.responses.entries()].sort(([a], [b]) => a.localeCompare(b)) as Array<[string, ParticipantResponse]>,
    }))
    .sort((a, b) => a.participantId.localeCompare(b.participantId));

  return { questions, participants };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashSimilarityInput(input: SimilarityClassInput): Promise<string> {
  return sha256(JSON.stringify(canonicalizeSimilarityInput(input)));
}

// --- Lectura -------------------------------------------------------------

/**
 * Mismo criterio de acceso que `assertScopeAccess` en `ai-reports.ts`: si
 * `buildSimilarityClassInput` no encuentra la toma o el actor no tiene
 * permiso de verla, es el mismo error genérico (no distingue "no existe" de
 * "no tenés acceso").
 */
async function requireAccess(runId: string, actor: Actor): Promise<SimilarityClassInput> {
  const input = await buildSimilarityClassInput(runId, actor);
  if (!input) throw new Error("No tenés acceso a este reporte");
  return input;
}

export async function getStoredSimilarityReport(runId: string, actor: Actor): Promise<StoredSimilarityReport | null> {
  const input = await requireAccess(runId, actor);
  const row = await db
    .prepare("SELECT report, input_hash, updated_at FROM similarity_reports WHERE run_id = ?")
    .bind(runId)
    .first<SimilarityReportRow>();
  if (!row) return null;
  const currentHash = await hashSimilarityInput(input);
  return { report: JSON.parse(row.report) as SimilarityReport, stale: row.input_hash !== currentHash, updatedAt: row.updated_at };
}

// --- Generación, con deduplicación de corridas concurrentes -----------------
//
// Un solo replica (ver `odd/tasks/jev-copy-detection.md`): un `Map` a nivel de
// módulo alcanza para que dos clicks seguidos en "Buscar coincidencias" para
// la misma toma no disparen dos corridas de Jev en paralelo. Si el proceso
// llegara a correr en más de una réplica, cada una deduplica la suya —el
// upsert de abajo sigue siendo correcto, solo se pierde el ahorro.
const inFlight = new Map<string, Promise<StoredSimilarityReport>>();

export async function generateSimilarityReport(runId: string, actor: Actor): Promise<StoredSimilarityReport> {
  const existing = inFlight.get(runId);
  if (existing) return existing;
  const promise = runGeneration(runId, actor).finally(() => {
    if (inFlight.get(runId) === promise) inFlight.delete(runId);
  });
  inFlight.set(runId, promise);
  return promise;
}

async function runGeneration(runId: string, actor: Actor): Promise<StoredSimilarityReport> {
  const input = await requireAccess(runId, actor);
  const inputHash = await hashSimilarityInput(input);

  // Igual que `generateAiReport`: si nada cambió desde la última corrida, no
  // hace falta gastar de nuevo el presupuesto de Jev (tiempo y costo).
  const existing = await db
    .prepare("SELECT report, input_hash, updated_at FROM similarity_reports WHERE run_id = ?")
    .bind(runId)
    .first<SimilarityReportRow>();
  if (existing?.input_hash === inputHash) {
    return { report: JSON.parse(existing.report) as SimilarityReport, stale: false, updatedAt: existing.updated_at };
  }

  const report = await analyzeSimilarity(input);
  logSemanticStatus(runId, report);

  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO similarity_reports (id, run_id, report, input_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (run_id) DO UPDATE SET report = excluded.report, input_hash = excluded.input_hash, updated_at = excluded.updated_at`,
    )
    .bind(crypto.randomUUID(), runId, JSON.stringify(report), inputHash, now, now)
    .run();

  return { report, stale: false, updatedAt: now };
}

/** Nunca la clave: `reason` es un `JevErrorCode`, un código corto (p. ej. "billing_required"), nunca el mensaje crudo del proveedor. */
function logSemanticStatus(runId: string, report: SimilarityReport): void {
  if (report.semantic.status === "ok") return;
  const reason = report.semantic.reason ? ` (${report.semantic.reason})` : "";
  console.log(`[similarity] Jev no corrió del todo para la toma ${runId}: ${report.semantic.status}${reason}`);
}
