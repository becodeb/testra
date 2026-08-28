import { serverEnv } from "@/server/env";

// Un único cliente para toda la IA de Testra. GMI Cloud expone una API
// compatible con OpenAI, así que corrección, informes y variantes comparten
// transporte, modelo y manejo de errores en vez de repetir el fetch tres veces.
export const AI_MODEL = "MiniMaxAI/MiniMax-M3";

const ENDPOINT = "https://api.gmi-serving.com/v1/chat/completions";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface ChatJsonOptions {
  // MiniMax M3 razona antes de responder y ese razonamiento consume el mismo
  // presupuesto que la respuesta: quedarse corto devuelve JSON truncado.
  maxTokens: number;
  timeoutMs?: number;
  unavailable: string;
  failed: string;
}

export function aiConfigured() {
  return Boolean(serverEnv.GMI_API_KEY);
}

export async function chatJson(messages: readonly ChatMessage[], options: ChatJsonOptions): Promise<unknown> {
  if (!aiConfigured()) throw new Error(options.unavailable);
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${serverEnv.GMI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: options.maxTokens,
      response_format: { type: "json_object" },
      messages,
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 90_000),
  });
  if (!response.ok) throw new Error(`${options.failed} (${response.status})`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error(options.failed);
  return parseJsonResponse(content, options.failed);
}

/**
 * Saca el JSON de la respuesta del modelo.
 *
 * Aunque se pide `response_format: json_object`, MiniMax M3 a veces devuelve el
 * objeto envuelto en un bloque de codigo markdown, y de vez en cuando con una
 * linea de texto antes o despues. `JSON.parse` sobre eso falla con
 * `Unexpected token '`'` y se lleva puesta toda la corrida, asi que se limpia
 * antes de parsear.
 */
export function parseJsonResponse(content: string, failed: string): unknown {
  const candidates: string[] = [];
  const texto = content.trim();
  candidates.push(texto);

  // ```json { ... } ```  o  ``` { ... } ```
  const fence = texto.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fence) candidates.push(fence[1].trim());

  // Ultimo recurso: el bloque mas externo entre llaves o corchetes, por si el
  // modelo agrego una frase suelta antes o despues.
  for (const [abre, cierra] of [["{", "}"], ["[", "]"]] as const) {
    const inicio = texto.indexOf(abre);
    const fin = texto.lastIndexOf(cierra);
    if (inicio !== -1 && fin > inicio) candidates.push(texto.slice(inicio, fin + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Se prueba la siguiente forma.
    }
  }
  throw new Error(failed);
}
