import { z } from "zod";

import { serverEnv } from "@/server/env";

// Cliente para Jev, el modelo de decisión "System One" de TypeSafe AI, servido
// a través de Vercel AI Gateway. A diferencia del AI Router (`ai-client.ts`),
// Jev no genera texto: contesta probabilidades calibradas para preguntas
// atómicas (boolean/choice/score) sobre un "estado" que le pasamos. Ver
// `odd/tasks/jev-copy-detection.md` para las fuentes y el diseño.
//
// Documentado, no medido: la respuesta 403 `customer_verification_required` sí
// está medida contra la clave real (2026-09-23) — Vercel exige tarjeta antes de
// cualquier pedido, incluso los gratuitos.

const EVALUATE_PATH = "/v1/evaluate";
const MODEL = "typesafe-ai/jev";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 300;
const RETRY_AFTER_CAP_MS = 5_000;

export function jevConfigured(): boolean {
  return Boolean(serverEnv.AI_GATEWAY_API_KEY);
}

// --- Tipos del pedido ---------------------------------------------------

export type JevQuestionSpec =
  | { type: "boolean"; instructions: string; criteria?: { true: string; false: string } }
  | { type: "choice"; instructions?: string; criteria: Record<string, string> }
  | { type: "score"; instructions?: string; criteria: string[] };

export type JevStateValue = string | Record<string, unknown> | unknown[];

export interface JevEvaluateRequest {
  state: JevStateValue;
  questions: Record<string, JevQuestionSpec>;
}

// --- Tipos de la respuesta ------------------------------------------------

export interface JevBooleanAnswer {
  type: "boolean";
  probability: number;
  confidence?: number;
}

export interface JevChoiceAnswer {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence?: number;
}

export interface JevScoreAnswer {
  type: "score";
  score: number;
  probabilities: Record<string, number>;
  confidence?: number;
}

export type JevAnswer = JevBooleanAnswer | JevChoiceAnswer | JevScoreAnswer;

export interface JevResult {
  answers: Record<string, JevAnswer>;
  usage: { inputTokens: number; outputTokens: number } | null;
  costUsd: number | null;
}

// --- Errores ---------------------------------------------------------------

export type JevErrorCode =
  | "not_configured"
  | "billing_required"
  | "unauthorized"
  | "bad_request"
  | "rate_limited"
  | "unavailable"
  | "invalid_response";

export class JevError extends Error {
  readonly code: JevErrorCode;
  readonly status?: number;

  constructor(code: JevErrorCode, message: string, status?: number) {
    super(message);
    this.name = "JevError";
    this.code = code;
    this.status = status;
  }
}

// --- Validación de la respuesta ---------------------------------------------

const probabilitySchema = z.number().min(0).max(1);

const answerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("boolean"), probability: probabilitySchema, confidence: z.number().optional() }),
  z.object({
    type: z.literal("choice"),
    choice: z.string(),
    probabilities: z.record(z.string(), probabilitySchema),
    confidence: z.number().optional(),
  }),
  z.object({
    type: z.literal("score"),
    score: z.number(),
    probabilities: z.record(z.string(), probabilitySchema),
    confidence: z.number().optional(),
  }),
]);

// Sin `.passthrough()`: zod 4 descarta en silencio las claves que no se
// declaran (routing, marketCost, generationId, ...) y es justo lo que se
// quiere, en vez de fallar la validación por campos que no se usan.
const responseSchema = z.object({
  answers: z.record(z.string(), answerSchema),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }).nullable().optional(),
  providerMetadata: z
    .object({
      gateway: z.object({ cost: z.string().optional() }).optional(),
    })
    .optional(),
});

function parseJevResponse(json: unknown, requested: Record<string, JevQuestionSpec>): JevResult {
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) throw new JevError("invalid_response", "La respuesta de Jev no tiene el formato esperado");

  for (const [key, spec] of Object.entries(requested)) {
    const answer = parsed.data.answers[key];
    if (!answer || answer.type !== spec.type) {
      throw new JevError("invalid_response", `Jev no contestó la pregunta "${key}" con el tipo esperado`);
    }
  }

  const rawCost = parsed.data.providerMetadata?.gateway?.cost;
  const costUsd = rawCost !== undefined && Number.isFinite(Number(rawCost)) ? Number(rawCost) : null;

  return {
    answers: parsed.data.answers as Record<string, JevAnswer>,
    usage: parsed.data.usage ?? null,
    costUsd,
  };
}

// --- Clasificación de errores HTTP -----------------------------------------

interface ErrorBody {
  error?: { type?: string; message?: string };
}

async function classifyErrorResponse(response: Response): Promise<{ error: JevError; retryable: boolean }> {
  const status = response.status;
  const bodyText = await response.text().catch(() => "");
  let parsedBody: ErrorBody | null = null;
  try {
    parsedBody = bodyText ? (JSON.parse(bodyText) as ErrorBody) : null;
  } catch {
    // Cuerpo no-JSON: queda solo el status.
  }
  const errorType = parsedBody?.error?.type;
  const errorMessage = parsedBody?.error?.message;

  // Medido contra la clave real (2026-09-23): Vercel exige tarjeta de crédito
  // en la cuenta antes de aceptar cualquier pedido, incluso los gratuitos.
  if (status === 403 && errorType === "customer_verification_required") {
    return {
      error: new JevError("billing_required", errorMessage ?? "AI Gateway requiere una tarjeta de crédito registrada", status),
      retryable: false,
    };
  }
  if (status === 401 || status === 403) {
    return { error: new JevError("unauthorized", errorMessage ?? `Jev respondió ${status}`, status), retryable: false };
  }
  if (status === 429) {
    return { error: new JevError("rate_limited", errorMessage ?? "Jev limitó la frecuencia de pedidos", status), retryable: true };
  }
  if (status >= 500 || status === 529) {
    return { error: new JevError("unavailable", errorMessage ?? `Jev no está disponible (${status})`, status), retryable: true };
  }
  return { error: new JevError("bad_request", errorMessage ?? `Jev rechazó el pedido (${status})`, status), retryable: false };
}

// --- Reintentos --------------------------------------------------------------

function backoffDelayMs(attempt: number, baseDelayMs: number): number {
  if (baseDelayMs <= 0) return 0;
  const exponential = baseDelayMs * 2 ** attempt;
  const jitter = Math.random() * baseDelayMs;
  return Math.min(RETRY_AFTER_CAP_MS, exponential + jitter);
}

function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(RETRY_AFTER_CAP_MS, seconds * 1000);
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Llamado principal -------------------------------------------------------

export interface EvaluateWithJevOptions {
  /** Señal del llamador, combinada con el timeout de cada intento. */
  signal?: AbortSignal;
  /** Timeout por intento. */
  timeoutMs?: number;
  /** Reintentos además del primer intento (default 2, o sea 3 intentos en total). */
  maxRetries?: number;
  /** Base del backoff exponencial. Los tests la fijan en 0 para no esperar de verdad. */
  baseDelayMs?: number;
}

export async function evaluateWithJev(
  request: JevEvaluateRequest,
  options: EvaluateWithJevOptions = {},
): Promise<JevResult> {
  if (!jevConfigured()) throw new JevError("not_configured", "Falta configurar AI_GATEWAY_API_KEY");

  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const url = `${serverEnv.AI_GATEWAY_URL.replace(/\/+$/, "")}${EVALUATE_PATH}`;
  const body = JSON.stringify({
    model: MODEL,
    state: request.state,
    questions: request.questions,
    // ZDR por pedido, ademas de la configuracion `zdr: all` de la cuenta:
    // "only" fija el proveedor para que el gateway nunca enrute a otro.
    providerOptions: { gateway: { zeroDataRetention: true, only: ["typesafe-ai"] } },
  });

  let lastError: JevError = new JevError("unavailable", "Jev no respondió");

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const timeoutSignal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const signal = options.signal ? AbortSignal.any([timeoutSignal, options.signal]) : timeoutSignal;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serverEnv.AI_GATEWAY_API_KEY}`,
          "Content-Type": "application/json",
        },
        body,
        signal,
      });

      if (response.ok) {
        return parseJevResponse(await response.json(), request.questions);
      }

      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      const classified = await classifyErrorResponse(response);
      if (!classified.retryable || attempt >= maxRetries) throw classified.error;
      lastError = classified.error;
      await sleep(retryAfterMs ?? backoffDelayMs(attempt, baseDelayMs));
    } catch (error) {
      if (error instanceof JevError) throw error;
      // Red, timeout o abort: no hay respuesta que clasificar por status.
      const networkError = new JevError("unavailable", describeNetworkError(error));
      if (attempt >= maxRetries) throw networkError;
      lastError = networkError;
      await sleep(backoffDelayMs(attempt, baseDelayMs));
    }
  }

  throw lastError;
}

function describeNetworkError(error: unknown): string {
  if (error instanceof Error) return `Jev no respondió: ${error.message}`;
  return "Jev no respondió";
}
