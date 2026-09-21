import { serverEnv } from "@/server/env";

// Un único cliente para toda la IA de Testra. Detrás está el AI Router de
// BeCode: un proxy que reparte cada pedido entre varios proveedores gratuitos
// ordenados por latencia y cae al siguiente cuando uno falla, se queda sin
// cuota o no larga el primer token a tiempo. Corrección, informes y variantes
// comparten transporte y manejo de errores en vez de repetir el fetch tres
// veces.
//
// El router NO habla el JSON de OpenAI: contesta un stream SSE de texto crudo.
// Las trampas de ese formato están documentadas en `parseSseText`.

// El router elige el modelo por pedido y no lo informa en la respuesta, así que
// lo que se guarda en la base es quién resolvió la consulta, no qué modelo
// contestó. `GET /providers` expone el modelo activo de cada proveedor.
export const AI_MODEL = "ai-router";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface ChatJsonOptions {
  // No hay tope de tokens: el router acepta `max_tokens` en el cuerpo pero no se
  // lo reenvía al proveedor. Medido contra producción, un pedido con
  // `max_tokens: 5` devuelve igual una respuesta larga. Mandarlo sería fingir un
  // control que no existe, así que cada proveedor aplica su propio límite.
  timeoutMs?: number;
  unavailable: string;
  failed: string;
}

export function aiConfigured() {
  return Boolean(serverEnv.AI_ROUTER_URL);
}

export async function chatJson(messages: readonly ChatMessage[], options: ChatJsonOptions): Promise<unknown> {
  if (!aiConfigured()) throw new Error(options.unavailable);
  // Un reintento porque sin `response_format: json_object` el respaldo contra un
  // modelo que contesta en prosa es el prompt, y la cascada puede resolver cada
  // pedido en un proveedor distinto: volver a pedir suele caer en otro modelo.
  // Solo se reintenta cuando la respuesta no es JSON. Un error de transporte no
  // se reintenta: el router ya recorrió su cascada por dentro.
  for (let attempt = 0; ; attempt += 1) {
    const content = await requestText(messages, options);
    try {
      return parseJsonResponse(content, options.failed);
    } catch (error) {
      if (attempt >= 1) throw error;
    }
  }
}

async function requestText(messages: readonly ChatMessage[], options: ChatJsonOptions): Promise<string> {
  // Sin `model` el router usa la cascada gratuita ordenada por latencia. Fijar
  // uno desactiva el failover, que es justamente lo que se viene a buscar acá.
  const response = await fetch(`${serverEnv.AI_ROUTER_URL.replace(/\/+$/, "")}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 90_000),
  });
  // Mirar `response.ok` no alcanza: cuando toda la cascada falla el router
  // contesta JSON en vez de un event-stream, y detrás de Cloudflare el 502 se
  // reemplaza por una página de texto plano. El content-type es el que manda.
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.includes("text/event-stream")) {
    throw new Error(await describeFailure(response, options.failed));
  }
  // `text()` decodifica el cuerpo entero como UTF-8 de una sola vez. Leer el
  // stream a mano obligaría a un TextDecoder incremental: los tokens del router
  // parten los caracteres multibyte (emojis, acentos) entre chunk y chunk.
  const content = parseSseText(await response.text());
  if (!content.trim()) throw new Error(options.failed);
  return content;
}

const PREFIJO = "data: ";
// El separador real entre eventos es la línea en blanco MÁS el prefijo del
// siguiente, no la línea en blanco sola. Ver `parseSseText`.
const SEPARADOR = `\n\n${PREFIJO}`;

/**
 * Reconstruye el texto de una respuesta SSE del router.
 *
 * El router escribe un evento por token con la forma `data: <token>` seguido de
 * una línea en blanco, y el token va crudo: no es JSON por chunk. Como el token
 * puede contener saltos de línea, el formato es ambiguo si se lo lee de la
 * manera obvia, y las dos trampas se comen o ensucian el texto en silencio.
 *
 * 1. El prefijo se saca por posición, nunca con `trim()` ni con una expresión
 *    regular que consuma los espacios siguientes. Un token que empieza con
 *    espacio llega como `data:` + dos espacios, y recortar de más pega las
 *    palabras entre sí: "hola mundo" queda "holamundo".
 * 2. Partir por la línea en blanco sola está mal. Un token que termina en salto
 *    de línea —`{` seguido de un enter, que es como abre casi todo JSON
 *    formateado— deja tres saltos seguidos en el cable, la línea en blanco se
 *    corre un caracter y el pedazo siguiente ya no empieza con `data:`. Tomarlo
 *    por continuación mete el literal `data:` adentro del JSON y lo rompe. Por
 *    eso se corta por línea en blanco + prefijo: esa secuencia sí marca dónde
 *    arranca un evento, y un salto suelto queda donde corresponde, dentro del
 *    token.
 */
export function parseSseText(body: string): string {
  let resto = body;
  if (!resto.startsWith(PREFIJO)) {
    // Comentarios o keep-alives antes del primer evento.
    const primero = resto.indexOf(SEPARADOR);
    if (primero === -1) return "";
    resto = resto.slice(primero + 2);
  }
  const eventos = resto.slice(PREFIJO.length).split(SEPARADOR);
  let out = "";
  for (const [indice, evento] of eventos.entries()) {
    // Al último evento le queda pegada la línea en blanco que lo cierra, porque
    // no hay un evento siguiente del que separarlo.
    const token = indice === eventos.length - 1 && evento.endsWith("\n\n") ? evento.slice(0, -2) : evento;
    if (token === "[DONE]") break;
    out += token;
  }
  return out;
}

/**
 * Saca el JSON de la respuesta del modelo.
 *
 * El router no expone `response_format: json_object`, así que el modelo devuelve
 * el objeto envuelto en un bloque de código markdown mucho más seguido que
 * antes, y de vez en cuando con una línea de texto antes o después.
 * `JSON.parse` sobre eso falla con `Unexpected token '`'` y se lleva puesta
 * toda la corrida, así que se limpia antes de parsear.
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

// El router describe la falla en `{ error, provider, attempts }`. Se usa ese
// texto cuando llega, pero nunca se confía en que el cuerpo sea JSON: Cloudflare
// lo reemplaza por su propia página cuando el origen contesta 502.
async function describeFailure(response: Response, failed: string): Promise<string> {
  let detail = "";
  try {
    const body = (await response.text()).trim();
    const parsed = JSON.parse(body) as { error?: unknown };
    if (typeof parsed.error === "string") detail = parsed.error;
  } catch {
    // Cuerpo vacío, HTML de Cloudflare o un stream cortado: queda el status.
  }
  return detail ? `${failed}: ${detail} (${response.status})` : `${failed} (${response.status})`;
}
