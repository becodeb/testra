import { z } from "zod";
import type { Actor } from "@/server/actors";
import { fullQuestionSchema, type FullQuestion } from "@/domain/exam";
import { serverEnv } from "@/server/env";
import { getExamCapabilities } from "@/server/exam-permissions";
import { getExam } from "@/server/repository";

const MODEL = "stealth/ox-alpha";
const envelopeSchema = z.object({ variants: z.array(z.object({ prompt: z.string().min(1).max(12000), config: z.record(z.string(), z.unknown()), rationale: z.string().max(500).optional() })).min(3).max(5) });

export function materializeQuestionVariants(original: FullQuestion, rawEnvelope: unknown) {
  const parsed = envelopeSchema.parse(rawEnvelope);
  return parsed.variants.map((variant, index) => fullQuestionSchema.parse({
    ...original,
    id: crypto.randomUUID(),
    position: original.position + index + 1,
    prompt: variant.prompt,
    config: variant.config,
  }) as FullQuestion);
}

export async function generateQuestionVariants(actor: Actor, examId: string, questionId: string, count: number) {
  if (!serverEnv.OPENROUTER_API_KEY) throw new Error("La asistencia con IA no está configurada");
  if (!(await getExamCapabilities(examId, actor)).edit) throw new Error("No tenés permiso para editar esta evaluación");
  const exam = await getExam(examId, actor);
  const original = exam?.questions.find((question) => question.id === questionId);
  if (!exam || !original) throw new Error("Pregunta inexistente");
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${serverEnv.OPENROUTER_API_KEY}`, "content-type": "application/json", "HTTP-Referer": "https://testra.becode.com.ar", "X-Title": "Testra" },
    body: JSON.stringify({ model: MODEL, reasoning_effort: "low", max_tokens: 2600, response_format: { type: "json_object" }, messages: [
      { role: "system", content: `Sos asistente de un docente. Devolvé SOLO JSON válido con {variants:[{prompt,config,rationale}]}. Generá exactamente ${count} variantes del mismo tipo, dificultad, objetivo y nivel. No copies literalmente. La config debe conservar la forma del original y siempre incluir una clave correcta inequívoca. No insertes ni decidas por el docente.` },
      { role: "user", content: JSON.stringify({ exam: { title: exam.title, subject: exam.subject, instructions: exam.instructions }, original }) },
    ] }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`La asistencia IA no respondió (${response.status})`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return materializeQuestionVariants(original, JSON.parse(payload.choices?.[0]?.message?.content ?? "{}"));
}
