import { env } from "cloudflare:workers";
import { z } from "zod";

import type { Actor } from "@/server/actors";
import { getParticipantDetail, getRunAnalysisData } from "@/server/repository";

const runtimeEnv = env as unknown as CloudflareEnv;
const MODEL = "stealth/ox-alpha";

export const runAiReportSchema = z.object({
  summary: z.string(),
  overallRisk: z.enum(["low", "medium", "high"]),
  likelyCopying: z.array(z.object({ participantId: z.string(), name: z.string(), risk: z.enum(["low", "medium", "high"]), confidence: z.number().min(0).max(100), reasons: z.array(z.string()) })),
  patterns: z.array(z.string()),
  recommendation: z.string(),
  caveat: z.string(),
});

export const personAiReportSchema = z.object({
  summary: z.string(),
  assessment: z.enum(["probably_accidental", "mixed", "concerning", "insufficient"]),
  confidence: z.number().min(0).max(100),
  evidence: z.array(z.string()),
  benignExplanations: z.array(z.string()),
  concerningSignals: z.array(z.string()),
  recommendation: z.string(),
  caveat: z.string(),
});

export async function getStoredAiReport(scopeType: "run" | "participant", scopeId: string, actor: Actor) {
  await assertScopeAccess(scopeType, scopeId, actor);
  const row = await runtimeEnv.DB.prepare("SELECT content, model, generated_at FROM ai_reports WHERE scope_type = ? AND scope_id = ?")
    .bind(scopeType, scopeId).first<{ content: string; model: string; generated_at: number }>();
  return row ? { content: JSON.parse(row.content), model: row.model, generatedAt: row.generated_at } : null;
}

export async function generateAiReport(scopeType: "run" | "participant", scopeId: string, actor: Actor) {
  const input = scopeType === "run" ? await getRunAnalysisData(scopeId, actor) : await getParticipantDetail(scopeId, actor);
  if (!input) return null;
  const compactInput = JSON.stringify(input);
  const inputHash = await sha256(compactInput);
  const existing = await runtimeEnv.DB.prepare("SELECT content, model, generated_at, input_hash FROM ai_reports WHERE scope_type = ? AND scope_id = ?")
    .bind(scopeType, scopeId).first<{ content: string; model: string; generated_at: number; input_hash: string }>();
  if (existing?.input_hash === inputHash) return { content: JSON.parse(existing.content), model: existing.model, generatedAt: existing.generated_at };

  const schema = scopeType === "run" ? runAiReportSchema : personAiReportSchema;
  const instructions = scopeType === "run"
    ? "Analizá la evaluación completa. Identificá, sin acusar como hecho, quiénes presentan más indicios compatibles con copia. Compará patrones de respuestas, tiempos e incidentes; devolvé participantId exacto."
    : "Analizá a esta persona. Distinguí incidentes probablemente accidentales (notificación, popup, selector del sistema, pérdida brevísima de foco) de cambios sostenidos o repetidos de pestaña/ventana. Considerá duración, secuencia y pregunta activa.";
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${runtimeEnv.OPENROUTER_API_KEY}`,
      "content-type": "application/json",
      "HTTP-Referer": "https://testra.becode.com.ar",
      "X-Title": "Testra",
    },
    body: JSON.stringify({
      model: MODEL,
      reasoning_effort: "low",
      max_tokens: 1800,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `Sos un analista de integridad académica. Respondé SOLO JSON en español válido para este esquema: ${JSON.stringify(z.toJSONSchema(schema))}. Nunca declares que alguien copió como certeza: son indicadores orientativos y toda decisión exige revisión docente. Un cambio de IP o navegador aislado es evidencia débil.` },
        { role: "user", content: `${instructions}\n\nDatos:\n${compactInput.slice(0, 100_000)}` },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`El análisis IA no respondió (${response.status})`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = schema.parse(JSON.parse(payload.choices?.[0]?.message?.content ?? "{}"));
  const generatedAt = Date.now();
  const runId = scopeType === "run" ? scopeId : (input as NonNullable<Awaited<ReturnType<typeof getParticipantDetail>>>).run.id;
  await runtimeEnv.DB.prepare(
    `INSERT INTO ai_reports (id, scope_type, scope_id, run_id, content, model, input_hash, generated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(scope_type, scope_id) DO UPDATE SET content = excluded.content, model = excluded.model, input_hash = excluded.input_hash, generated_at = excluded.generated_at`,
  ).bind(crypto.randomUUID(), scopeType, scopeId, runId, JSON.stringify(content), MODEL, inputHash, generatedAt).run();
  return { content, model: MODEL, generatedAt };
}

async function assertScopeAccess(scopeType: "run" | "participant", scopeId: string, actor: Actor) {
  const data = scopeType === "run" ? await getRunAnalysisData(scopeId, actor) : await getParticipantDetail(scopeId, actor);
  if (!data) throw new Error("No tenés acceso a este reporte");
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
