import { z } from "zod";

import { db } from "@/server/db/client";
import { serverEnv } from "@/server/env";
import type { Actor } from "@/server/actors";
import { getParticipantDetail, getRunAnalysisData } from "@/server/repository";

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
  const row = await db.prepare("SELECT content, model, generated_at FROM ai_reports WHERE scope_type = ? AND scope_id = ?")
    .bind(scopeType, scopeId).first<{ content: string; model: string; generated_at: number }>();
  return row ? { content: JSON.parse(row.content), model: row.model, generatedAt: row.generated_at } : null;
}

export async function generateAiReport(scopeType: "run" | "participant", scopeId: string, actor: Actor) {
  const input = scopeType === "run" ? await getRunAnalysisData(scopeId, actor) : await getParticipantDetail(scopeId, actor);
  if (!input) return null;
  const compactInput = JSON.stringify(input);
  const inputHash = await sha256(compactInput);
  const existing = await db.prepare("SELECT content, model, generated_at, input_hash FROM ai_reports WHERE scope_type = ? AND scope_id = ?")
    .bind(scopeType, scopeId).first<{ content: string; model: string; generated_at: number; input_hash: string }>();
  if (existing?.input_hash === inputHash) return { content: JSON.parse(existing.content), model: existing.model, generatedAt: existing.generated_at };

  const schema = scopeType === "run" ? runAiReportSchema : personAiReportSchema;
  const instructions = scopeType === "run"
    ? "Analizá la evaluación completa para un profesor. Señalá únicamente qué alumnos conviene revisar, sin acusar ni inferir copia como hecho. Explicá qué ocurrió, cuándo, cuántas veces, explicaciones normales y qué revisar; devolvé participantId exacto."
    : "Analizá a esta persona para su profesor. Explicá qué ocurrió, cuándo y cuántas veces. Distinguí explicaciones normales de patrones que conviene revisar y proponé preguntas concretas para esa revisión.";
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${serverEnv.OPENROUTER_API_KEY}`,
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
        { role: "system", content: `Sos un asistente para docentes, no un perito técnico. Respondé SOLO JSON en español válido para este esquema: ${JSON.stringify(z.toJSONSchema(schema))}. Usá lenguaje cotidiano. No escribas IP, proxy, user agent, WebSocket, fingerprint, visibilitychange ni heurística: traducí cada término a lo que vivió la persona. Nunca declares que alguien copió o hizo trampa. Ninguna señal cambia una nota. Incluí explicaciones normales y una recomendación de revisión humana. La IA no califica ni sanciona.` },
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
  await db.prepare(
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
