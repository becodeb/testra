#!/usr/bin/env node
// Generador del dataset sintético para evaluar la detección de copia entre alumnos.
//
// Se usó UNA vez para producir `scripts/copy-eval/dataset.json` (commiteado como
// fixture) y queda acá como documentación reproducible de cómo se armó. No hace
// falta ninguna clave para correrlo: habla con el AI Router gratuito de BeCode
// (sin autenticación). Volver a correrlo generaría un dataset nuevo (no
// determinístico entre corridas reales, porque depende de qué modelo gratuito
// conteste cada vez), así que no es parte de `npm run eval:copias`.
//
// Habla con un router multi-proveedor gratuito por un protocolo SSE a medida (sin
// clave de API). El router manda el texto crudo de cada token por evento, no JSON
// — ver parseSSEEvents() para las reglas exactas de parseo a nivel de bytes,
// verificadas contra producción antes de escribir este archivo.
//
// Uso:
//   node generate.mjs                  # corrida completa, 6 preguntas
//   COPY_EVAL_LIMIT=1 node generate.mjs # prueba rápida: solo las primeras N preguntas
//
// Salida: /tmp/copy-eval/dataset.json (con checkpoint después de cada pregunta).

import { writeFileSync, mkdirSync } from "node:fs";

// ---------- Config ----------
const ROUTER_URL = "https://ai-router.becode.com.ar/chat";
const OUTPUT_PATH = "/tmp/copy-eval/dataset.json";
const CALL_GAP_MS = 2000; // pausa prudente entre llamados lógicos
const MAX_TRANSPORT_ATTEMPTS = 4; // reintentos a nivel transporte, por llamado lógico
const BAD_CONTENT_TYPE_WAIT_MS = 20000; // "fallaron todos los proveedores" -> esperar ~20s
const STREAM_ERROR_WAIT_MS = 3000; // error a mitad de stream / falta [DONE] -> espera más corta
const MAX_JSON_ATTEMPTS = 2; // reintentar una vez más si falla la extracción de JSON
const MAX_REGENERATIONS = 2; // por sub-parte chequeada (regeneración guiada por el chequeo de calidad)
const SHAPE_RETRY_ATTEMPTS = 2; // defensivo: reintentar todo el llamado si la forma del JSON está mal

const SEED = "copy-eval-v1";
const TEST_LIMIT = process.env.COPY_EVAL_LIMIT ? Number(process.env.COPY_EVAL_LIMIT) : null;

// ---------- Utilidades chicas ----------
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function log(msg) {
  const t = new Date().toISOString().slice(11, 19);
  console.error(`[${t}] ${msg}`);
}

function normalizeWords(text) {
  const noAccents = String(text)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  const cleaned = noAccents.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  return cleaned.split(/\s+/).filter(Boolean);
}

function jaccard(a, b) {
  const setA = new Set(normalizeWords(a));
  const setB = new Set(normalizeWords(b));
  if (setA.size === 0 && setB.size === 0) return 0;
  let inter = 0;
  for (const w of setA) if (setB.has(w)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Fracción de las palabras de la definición que también aparecen en la respuesta.
function definitionContainment(definition, answer) {
  const defSet = new Set(normalizeWords(definition));
  const ansSet = new Set(normalizeWords(answer));
  if (defSet.size === 0) return 0;
  let inter = 0;
  for (const w of defSet) if (ansSet.has(w)) inter++;
  return inter / defSet.size;
}

// Heurística best-effort: ¿el texto todavía conserva las palabras clave del error distintivo?
// Solo informativo (no es uno de los chequeos de Jaccard obligatorios).
function markerPresent(markerPhrase, text) {
  const markerWords = normalizeWords(markerPhrase).filter((w) => w.length > 2);
  if (markerWords.length === 0) return true;
  const textWords = new Set(normalizeWords(text));
  const hits = markerWords.filter((w) => textWords.has(w)).length;
  return hits / markerWords.length >= 0.5;
}

function hashStringToInt(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(array, seedStr) {
  const rng = mulberry32(hashStringToInt(seedStr));
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function seededPick(array, count, seedStr) {
  return seededShuffle(array, seedStr).slice(0, count);
}

// ---------- Cliente del router ----------

const callStats = {
  logicalCalls: 0,
  httpRequests: 0,
  byLabel: {},
  providers: new Set(),
  startTime: Date.now(),
};

// Parsea el cuerpo crudo SSE en un arreglo de strings de tokens crudos (nunca recortados).
// Reglas (medidas contra producción):
// - se separa por el literal "\n\ndata: " (línea en blanco + prefijo), nunca por una línea en blanco sola.
// - el primer evento todavía trae su propio prefijo "data: " (6 caracteres, se saca por posición).
// - el "\n\n" final de todo el cuerpo se saca una sola vez, antes de separar.
function parseSSEEvents(rawText) {
  let text = rawText;
  if (text.endsWith("\n\n")) text = text.slice(0, -2);
  const rawParts = text.split("\n\ndata: ");
  return rawParts.map((p, i) => {
    if (i === 0 && p.startsWith("data: ")) return p.slice(6);
    return p;
  });
}

function assembleContent(tokens) {
  let content = "";
  let sawDone = false;
  let errorPayload = null;
  for (const tok of tokens) {
    if (tok === "[DONE]") {
      sawDone = true;
      break;
    }
    if (tok.startsWith('{"error"')) {
      try {
        const parsed = JSON.parse(tok);
        if (parsed && typeof parsed === "object" && "error" in parsed) {
          errorPayload = parsed.error;
          break;
        }
      } catch {
        // No era realmente un evento de error JSON aislado: se trata como contenido normal.
      }
    }
    content += tok;
  }
  return { content, sawDone, errorPayload };
}

// Un llamado lógico al router. Maneja las reglas de reintento a nivel transporte ya documentadas.
async function callRouter(messages, label) {
  callStats.logicalCalls++;
  callStats.byLabel[label] = (callStats.byLabel[label] || 0) + 1;

  for (let attempt = 1; attempt <= MAX_TRANSPORT_ATTEMPTS; attempt++) {
    callStats.httpRequests++;
    let res;
    try {
      res = await fetch(ROUTER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });
    } catch (e) {
      log(`[router:${label}] intento ${attempt}: fetch tiró ${e.message}`);
      if (attempt < MAX_TRANSPORT_ATTEMPTS) {
        await sleep(BAD_CONTENT_TYPE_WAIT_MS);
        continue;
      }
      throw new Error(`${label}: falla de red después de ${MAX_TRANSPORT_ATTEMPTS} intentos: ${e.message}`);
    }

    const text = await res.text();
    const contentType = res.headers.get("content-type") || "";
    const provider = res.headers.get("x-provider");
    if (provider) callStats.providers.add(provider);

    if (!contentType.includes("text/event-stream")) {
      log(
        `[router:${label}] intento ${attempt}: respuesta no-SSE (content-type="${contentType}"), ` +
          `fallaron todos los proveedores; esperando ${BAD_CONTENT_TYPE_WAIT_MS / 1000}s`,
      );
      if (attempt < MAX_TRANSPORT_ATTEMPTS) {
        await sleep(BAD_CONTENT_TYPE_WAIT_MS);
        continue;
      }
      throw new Error(`${label}: el router falló después de ${MAX_TRANSPORT_ATTEMPTS} intentos (no-SSE)`);
    }

    const tokens = parseSSEEvents(text);
    const { content, sawDone, errorPayload } = assembleContent(tokens);

    if (errorPayload) {
      log(`[router:${label}] intento ${attempt}: evento de error a mitad de stream ${JSON.stringify(errorPayload)}, reintentando`);
      if (attempt < MAX_TRANSPORT_ATTEMPTS) {
        await sleep(STREAM_ERROR_WAIT_MS);
        continue;
      }
      throw new Error(`${label}: el router falló después de ${MAX_TRANSPORT_ATTEMPTS} intentos (error a mitad de stream)`);
    }

    if (!sawDone) {
      log(`[router:${label}] intento ${attempt}: el stream terminó sin [DONE], reintentando`);
      if (attempt < MAX_TRANSPORT_ATTEMPTS) {
        await sleep(STREAM_ERROR_WAIT_MS);
        continue;
      }
      throw new Error(`${label}: el router falló después de ${MAX_TRANSPORT_ATTEMPTS} intentos (sin [DONE])`);
    }

    await sleep(CALL_GAP_MS); // ser prudente antes del próximo llamado lógico
    return { content, provider };
  }
  throw new Error(`${label}: salida inalcanzable del loop de reintentos`);
}

function extractJSON(raw) {
  let s = raw;
  const fenceMatch = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) s = fenceMatch[1];
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last === -1 || last < first) return null;
  const candidate = s.slice(first, last + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

async function callRouterJSON(systemPrompt, userPrompt, label) {
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];
  let lastRawHead = "";
  for (let attempt = 1; attempt <= MAX_JSON_ATTEMPTS; attempt++) {
    const { content } = await callRouter(messages, label);
    const parsed = extractJSON(content);
    if (parsed) return parsed;
    lastRawHead = content.slice(0, 200).replace(/\n/g, "\\n");
    log(`[json:${label}] intento ${attempt}: no se pudo parsear JSON, inicio del crudo: ${lastRawHead}`);
  }
  throw new Error(`${label}: no se pudo obtener JSON válido después de ${MAX_JSON_ATTEMPTS} intentos. Inicio del último crudo: ${lastRawHead}`);
}

// Capa defensiva más allá de las reglas de reintento documentadas: reintenta un paso
// de generación entero si el JSON parseó bien pero tenía la forma equivocada
// (faltan campos, longitud de arreglo incorrecta).
async function withShapeRetry(label, fn) {
  let lastErr;
  for (let i = 1; i <= SHAPE_RETRY_ATTEMPTS; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      log(`[shape-retry] ${label}: intento ${i} falló: ${e.message}`);
    }
  }
  throw lastErr;
}

// ---------- Diseño del dataset ----------

const QUESTIONS = [
  {
    id: "q1",
    subject: "Biología",
    prompt: "Explicá qué es la fotosíntesis y por qué es importante para los seres vivos.",
    misconceptionHint:
      "Muchos estudiantes de esta edad creen que las plantas se 'alimentan' de la tierra, como si la tierra fuera su comida, en vez de entender que fabrican su propio alimento (glucosa) usando luz solar, agua y dióxido de carbono; el agua y los minerales del suelo los toman, pero no son 'el alimento' en sí.",
    errorGuidance:
      "una fecha, término o dato específico inventado o claramente incorrecto relacionado con la fotosíntesis (por ejemplo un nombre de científico inventado, confundir la clorofila con otra sustancia, un dato numérico raro)",
  },
  {
    id: "q2",
    subject: "Historia",
    prompt: "¿Cuáles fueron las causas de la Revolución de Mayo de 1810?",
    misconceptionHint:
      "Es muy común que confundan la Revolución de Mayo de 1810 con la independencia: muchos escriben que el 25 de mayo de 1810 'nos independizamos de España', cuando ese día se formó la Primera Junta de gobierno y la independencia se declaró recién el 9 de julio de 1816.",
    errorGuidance:
      "una fecha incorrecta específica, un nombre de personaje histórico inventado o mal atribuido, o un dato concreto equivocado sobre la Revolución de Mayo",
  },
  {
    id: "q3",
    subject: "Lengua",
    prompt: "¿Qué es una metáfora? Explicalo y da un ejemplo propio.",
    misconceptionHint:
      "Muchos estudiantes confunden la metáfora con el símil/comparación: creen que cualquier frase que compara dos cosas es una metáfora, incluso cuando usa 'como' (por ejemplo piensan que 'sus ojos son como estrellas' es una metáfora, cuando en realidad es un símil porque usa el nexo comparativo 'como'; la metáfora identifica una cosa con otra sin usar 'como', por ejemplo 'sus ojos son estrellas').",
    errorGuidance:
      "un ejemplo inventado y mal formado que el estudiante presenta como si fuera una metáfora correcta (por ejemplo en realidad es un símil con 'como', pero lo llama metáfora), o un término inventado para nombrar la figura retórica",
  },
  {
    id: "q4",
    subject: "Geografía",
    prompt: "Explicá la diferencia entre el clima y el tiempo atmosférico.",
    misconceptionHint:
      "Es muy común que usen 'clima' y 'tiempo atmosférico' como sinónimos, sin entender que el tiempo es la condición atmosférica de un momento y lugar puntual (por ejemplo, hoy llueve) y el clima es el patrón promedio de muchos años en una región (por ejemplo, clima templado).",
    errorGuidance:
      "un dato geográfico o meteorológico inventado o incorrecto (por ejemplo confundir la causa de las estaciones, un nombre de instrumento meteorológico inventado, una cifra rara)",
  },
  {
    id: "q5",
    subject: "Física",
    prompt: "¿Por qué un barco de acero flota en el agua si el acero es más denso que el agua?",
    misconceptionHint:
      "Muchos estudiantes creen que si un material es más denso que el agua, cualquier objeto hecho de ese material se hunde siempre, sin entender que lo que importa es la densidad promedio de todo el objeto (el barco hueco, lleno de aire) comparada con el agua, no solo la densidad del material del que está hecho.",
    errorGuidance:
      "un nombre de principio físico inventado o mal atribuido (por ejemplo atribuirle el principio de flotación a otro científico), o una cifra o dato físico incorrecto",
  },
  {
    id: "q6",
    subject: "Educación cívica",
    prompt: "¿Por qué es importante la división de poderes en una democracia?",
    misconceptionHint:
      "Es común que piensen que el presidente está 'por encima' de los otros dos poderes y los controla o los puede mandar, en vez de entender que los tres poderes (ejecutivo, legislativo, judicial) son independientes entre sí y se controlan mutuamente (frenos y contrapesos).",
    errorGuidance:
      "un dato institucional inventado o incorrecto (por ejemplo un nombre equivocado para uno de los poderes, una función inventada, o confundir quién ocupa cada poder)",
  },
];

const INDEPENDENT_PROFILES = [
  "alumno destacado, respuesta clara y completa",
  "alumno promedio, correcta pero simple",
  "alumno con dificultades, respuesta corta y básica",
  "alumno que se explaya de más, da vueltas",
  "usa un ejemplo personal o familiar",
  "ideas correctas pero desordenadas",
  "escribe casi en forma de lista de ideas sueltas",
  "mezcla una idea correcta con un error propio (no común)",
  "muy informal, tipo mensaje a un amigo",
  "correcta pero fría y telegráfica, tipo resumen",
  "insegura, usa 'creo que' / 'no me acuerdo bien'",
  "se va un poco del tema hacia algo relacionado",
  "prolija pero con oraciones largas y enredadas",
  "usa una comparación o metáfora propia inventada",
];

const MEMORIZER_FLAVORS = [
  "agregá una razón corta y propia de por qué se acuerda de esto (por ejemplo algo que vio en su casa)",
  "agregá un ejemplo corto y propio, distinto al de la definición",
  "agregá un comentario corto y propio sobre qué le costó entender o qué le pareció interesante",
];

const BASE_SYSTEM =
  "Sos un generador de datos sintéticos para un dataset de evaluación educativa. " +
  "Escribís respuestas de examen realistas de estudiantes argentinos de secundaria (13 a 16 años), " +
  "en español rioplatense con voseo donde sea natural. Respondés ÚNICAMENTE con un objeto JSON válido, " +
  "sin texto antes ni después, sin bloques de código markdown si es posible.";

// ---------- Constructores de prompts ----------

function buildCorePrompt(q) {
  const profileList = INDEPENDENT_PROFILES.map((p, i) => `${i + 1}. ${p}`).join("\n");
  const user = `Materia: ${q.subject}
Pregunta de examen (desarrollo, respuesta abierta): "${q.prompt}"

Generá:
1. "referenceAnswer": la respuesta modelo del docente (40 a 80 palabras), correcta, clara y completa.
2. "classDefinition": UNA sola oración que el docente dictó en clase y que los alumnos memorizan de memoria (15 a 30 palabras). Tiene que sonar como una definición para copiar en la carpeta, concisa y "oficial".
3. "independents": 14 respuestas de examen de 14 alumnos DISTINTOS, cada una escrita de forma completamente independiente (no se copiaron entre sí). Cada respuesta entre 20 y 90 palabras. Asignale a cada una un perfil DIFERENTE de esta lista (resumilo en 3-8 palabras en el campo "profile"):
${profileList}

Reglas importantes para las 14 independientes:
- Cada una escrita con sus PROPIAS palabras y su propia estructura de oración. No pueden compartir frases entre sí más allá del vocabulario obvio del tema.
- Escritura realista de adolescente: algunas (no todas) con faltas de acentos, alguna con minúscula al inicio, alguna usando "q" en vez de "que", alguna con oraciones largas sin puntuar bien (run-on). Repartilo de forma variada, no lo repitas igual en todas.
- El contenido tiene que ser mayormente correcto según el perfil (salvo la de perfil "mezcla una idea correcta con un error propio", que debe tener un error propio y distinto de cualquier error común de manual).
- No repitas la misma estructura de oración de una respuesta a otra.

Devolvé SOLO este JSON (sin explicaciones):
{
  "referenceAnswer": "...",
  "classDefinition": "...",
  "independents": [
    {"profile": "...", "text": "..."}
  ]
}
(el array "independents" debe tener exactamente 14 elementos)`;
  return { system: BASE_SYSTEM, user };
}

function buildIndependentsRetryPrompt(q, classDefinition, collidingPair) {
  const profileList = INDEPENDENT_PROFILES.map((p, i) => `${i + 1}. ${p}`).join("\n");
  const user = `Materia: ${q.subject}
Pregunta: "${q.prompt}"
Definición dictada en clase (para coherencia temática, NO la copies literalmente acá): "${classDefinition}"

Necesito 14 NUEVAS respuestas independientes de alumnos distintos para esta pregunta (20-90 palabras cada una, perfiles variados de esta lista, escritura realista de adolescente):
${profileList}

IMPORTANTE: en un intento anterior, dos respuestas quedaron demasiado parecidas entre sí (compartían casi las mismas frases), lo cual está mal porque tienen que ser independientes. Ejemplo de lo que hay que EVITAR (no repitas este tipo de coincidencia textual):
--- Respuesta A ---
${collidingPair[0]}
--- Respuesta B ---
${collidingPair[1]}

Esta vez asegurate de que las 14 respuestas sean léxicamente bien distintas entre sí (distinta estructura de oración, distintas palabras, aunque compartan vocabulario técnico inevitable del tema).

Devolvé SOLO este JSON:
{
  "independents": [
    {"profile": "...", "text": "..."}
  ]
}
(exactamente 14 elementos)`;
  return { system: BASE_SYSTEM, user };
}

function buildMemorizersPrompt(q, classDefinition) {
  const user = `Materia: ${q.subject}
Pregunta: "${q.prompt}"
Definición dictada en clase (los alumnos la memorizan tal cual): "${classDefinition}"

Generá 3 respuestas de examen de 3 alumnos DISTINTOS que estudiaron memorizando la definición del docente. Cada respuesta tiene que:
- Empezar reproduciendo la definición de clase CASI TEXTUAL (podés variar una palabra suelta, la puntuación, o un conector, pero tiene que ser reconocible como la misma definición memorizada, no una paráfrasis).
- Después agregar 1 o 2 oraciones cortas EN SUS PROPIAS PALABRAS que sí varíen entre los tres alumnos:
  - Alumno 1: ${MEMORIZER_FLAVORS[0]}
  - Alumno 2: ${MEMORIZER_FLAVORS[1]}
  - Alumno 3: ${MEMORIZER_FLAVORS[2]}

Esto simula un caso esperable (NO es copia entre compañeros): los tres memorizaron lo mismo del pizarrón.

Devolvé SOLO este JSON:
{
  "memorizers": [
    {"profile": "memorizó la definición + razón propia", "text": "..."},
    {"profile": "memorizó la definición + ejemplo propio", "text": "..."},
    {"profile": "memorizó la definición + comentario propio", "text": "..."}
  ]
}`;
  return { system: BASE_SYSTEM, user };
}

function buildMemorizerRetryPrompt(q, classDefinition, flavor, priorAttemptText) {
  const user = `Materia: ${q.subject}
Definición dictada en clase (los alumnos la memorizan tal cual): "${classDefinition}"

Necesito UNA respuesta de examen de un alumno que memorizó esta definición de memoria. Un intento anterior no reprodujo suficiente la definición literal: "${priorAttemptText}"
Esta vez:
- Reproducí la definición CASI TEXTUAL al principio de la respuesta (como mucho una palabra o conector cambiado), no la parafrasees ni la resumas.
- Después agregá 1-2 oraciones cortas propias: ${flavor}

Devolvé SOLO este JSON:
{ "text": "..." }`;
  return { system: BASE_SYSTEM, user };
}

function buildMisconceptionsPrompt(q) {
  const user = `Materia: ${q.subject}
Pregunta: "${q.prompt}"

Hay un error conceptual MUY COMÚN en alumnos de esta edad sobre este tema: ${q.misconceptionHint}

Generá 2 respuestas de examen de 2 alumnos DISTINTOS que, cada uno por su cuenta (no se copiaron), tienen ese mismo error común metido naturalmente en su respuesta. El resto de cada respuesta (estructura, ejemplos, longitud, qué más dicen) tiene que ser bien distinto entre los dos. Cada una entre 20 y 90 palabras, escritura realista de adolescente.

En el campo "profile" de cada una, nombrá explícitamente cuál es el error común que contiene (en pocas palabras).

Devolvé SOLO este JSON:
{
  "misconceptions": [
    {"profile": "cree que ...", "text": "..."},
    {"profile": "cree que ...", "text": "..."}
  ]
}`;
  return { system: BASE_SYSTEM, user };
}

function buildDistinctivePrompt(q) {
  const user = `Materia: ${q.subject}
Pregunta: "${q.prompt}"

Generá UNA respuesta de examen, de nivel normal/promedio, que en general esté bien pero que tenga METIDO UN ERROR DISTINTIVO Y POCO COMÚN: ${q.errorGuidance}. Tiene que ser un error específico y raro (no el típico error común de todo el curso), algo que solo se le ocurriría a ese alumno puntual. El resto de la respuesta tiene que sonar normal. Entre 20 y 90 palabras.

En "profile" describí en pocas palabras cuál es el error distintivo.
En "markerPhrase" poné una frase cortita (2 a 6 palabras) que capture ESE error puntual tal cual aparece en el texto (se va a usar para chequear que otra respuesta lo mantenga).

Devolvé SOLO este JSON:
{ "profile": "...", "text": "...", "markerPhrase": "..." }`;
  return { system: BASE_SYSTEM, user };
}

function buildCopiesPrompt(q, s) {
  const user = `Materia: ${q.subject}
Pregunta: "${q.prompt}"

Te doy 4 respuestas ya escritas por otros alumnos. Para cada una, generá una respuesta NUEVA de un alumno distinto que la copió de alguna forma, según se indica.

--- Fuente para copia VERBATIM ---
"${s.verbatimSrc}"
Generá "verbatim": una copia casi palabra por palabra de esa fuente, con SOLO 2 a 4 cambios chiquitos (por ejemplo: un typo, cambiar una palabra por un sinónimo, sacar una palabra). Tiene que quedar MUY parecida a la fuente.

--- Fuente para copia PARCIAL ---
"${s.partialSrc}"
Generá "partial": copiá TEXTUALMENTE 1 o 2 oraciones completas de esa fuente, y escribí el resto de la respuesta con tus propias palabras y tu propia estructura (distinta de la fuente).

--- Fuente para PARÁFRASIS disfrazada ---
"${s.paraphraseSrc}"
Generá "paraphrase": reescribí esa fuente para disimular que es una copia: mismas ideas, mismo orden de las ideas, mismos ejemplos si los tiene, pero cambiando LA MAYORÍA de las palabras por sinónimos y reestructurando las oraciones.

--- Fuente con ERROR DISTINTIVO (para copiar el error) ---
"${s.sharedErrorSrc}"
Esa respuesta tiene un error particular: ${s.markerPhrase}
Generá "shared_error": reescribí esa respuesta con OTRAS palabras y otra estructura (como una paráfrasis normal), pero MANTENÉ exactamente ese mismo error particular (${s.markerPhrase}) en tu versión, ni lo corrijas ni lo cambies por otro error.

Cada respuesta generada, entre 20 y 90 palabras, escritura realista de adolescente.

Devolvé SOLO este JSON:
{
  "copies": {
    "verbatim": {"profile": "copia casi textual con retoques", "text": "..."},
    "partial": {"profile": "copia parcial + desarrollo propio", "text": "..."},
    "paraphrase": {"profile": "parafraseo disfrazado", "text": "..."},
    "shared_error": {"profile": "comparte el error distintivo de otro compañero", "text": "..."}
  }
}`;
  return { system: BASE_SYSTEM, user };
}

function buildCopyRetryPrompt(q, kind, sourceText, priorText, priorJaccard, thresholdLabel) {
  let instruction;
  if (kind === "verbatim") {
    instruction = `El intento anterior quedó con ${(priorJaccard * 100).toFixed(0)}% de palabras en común con la fuente, y necesito ${thresholdLabel}. Hacé una copia MÁS parecida todavía a la fuente: cambiá como mucho 2 a 4 palabras/detalles chiquitos (typo, sinónimo, o sacar una palabra), el resto tiene que quedar textual.`;
  } else if (kind === "partial") {
    if (priorJaccard < 0.25) {
      instruction = `El intento anterior quedó con solo ${(priorJaccard * 100).toFixed(0)}% de palabras en común con la fuente (muy bajo, necesito ${thresholdLabel}). Copiá TEXTUALMENTE 1 o 2 oraciones completas y más largas de la fuente, y después seguí con tus propias palabras.`;
    } else {
      instruction = `El intento anterior quedó con ${(priorJaccard * 100).toFixed(0)}% de palabras en común con la fuente (muy alto, necesito ${thresholdLabel}). Copiá TEXTUALMENTE solo 1 oración corta de la fuente (no 2 largas), y escribí bastante más del resto con tus propias palabras y tu propia estructura.`;
    }
  } else {
    instruction = `El intento anterior quedó con ${(priorJaccard * 100).toFixed(0)}% de palabras en común con la fuente, y necesito ${thresholdLabel}. Cambiá más palabras por sinónimos y reestructurá más las oraciones; mantené las mismas ideas y orden pero con vocabulario bastante más distinto.`;
  }
  const user = `Materia: ${q.subject}
Pregunta: "${q.prompt}"

--- Fuente ---
"${sourceText}"

Intento anterior (no cumplió el criterio de similitud): "${priorText}"

${instruction}

Entre 20 y 90 palabras, escritura realista de adolescente.

Devolvé SOLO este JSON:
{ "text": "..." }`;
  return { system: BASE_SYSTEM, user };
}

function buildSharedErrorRetryPrompt(q, sourceText, markerPhrase, priorText) {
  const user = `Materia: ${q.subject}
Pregunta: "${q.prompt}"

--- Fuente con error distintivo ---
"${sourceText}"
El error particular que hay que mantener es: ${markerPhrase}

Intento anterior (no mantuvo claramente ese error): "${priorText}"

Reescribí de nuevo la fuente con otras palabras y otra estructura, pero esta vez asegurate de que el error puntual "${markerPhrase}" quede presente de forma clara y reconocible en el texto (no lo corrijas, no lo diluyas, no lo reemplaces por otro error).

Entre 20 y 90 palabras.

Devolvé SOLO este JSON:
{ "text": "..." }`;
  return { system: BASE_SYSTEM, user };
}

// ---------- Pasos de generación ----------

async function generateCore(q) {
  const { system, user } = buildCorePrompt(q);
  const data = await callRouterJSON(system, user, `${q.id}:core`);
  if (!data.referenceAnswer || !data.classDefinition || !Array.isArray(data.independents) || data.independents.length < 14) {
    throw new Error(`la respuesta core no tiene los campos requeridos o <14 independientes (llegaron ${data.independents?.length})`);
  }
  return {
    referenceAnswer: data.referenceAnswer,
    classDefinition: data.classDefinition,
    independents: data.independents.slice(0, 14),
  };
}

function maxPairwiseJaccard(items) {
  let max = -1;
  let worstPair = null;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const val = jaccard(items[i].text, items[j].text);
      if (val > max) {
        max = val;
        worstPair = [i, j];
      }
    }
  }
  return { max, worstPair };
}

async function ensureIndependentsDistinct(q, classDefinition, independents) {
  let current = independents;
  let { max, worstPair } = maxPairwiseJaccard(current);
  let regenerations = 0;
  while (max >= 0.5 && regenerations < MAX_REGENERATIONS) {
    regenerations++;
    log(
      `[check] ${q.id}: independents pairwise max jaccard=${max.toFixed(3)} >= 0.5 ` +
        `(par ${current[worstPair[0]].tempId}/${current[worstPair[1]].tempId}), regenerando (#${regenerations})`,
    );
    const collidingPair = [current[worstPair[0]].text, current[worstPair[1]].text];
    const { system, user } = buildIndependentsRetryPrompt(q, classDefinition, collidingPair);
    const data = await withShapeRetry(`${q.id}:independents-retry-${regenerations}`, async () => {
      const d = await callRouterJSON(system, user, `${q.id}:independents-retry`);
      if (!Array.isArray(d.independents) || d.independents.length < 14) {
        throw new Error(`independents-retry devolvió ${d.independents?.length} elementos`);
      }
      return d;
    });
    current = data.independents
      .slice(0, 14)
      .map((it, i) => ({ tempId: `ind${i + 1}`, role: "independent", profile: it.profile, text: it.text }));
    ({ max, worstPair } = maxPairwiseJaccard(current));
  }
  const pass = max < 0.5;
  return {
    independents: current,
    report: {
      metric: "max_pairwise_jaccard_among_independents",
      value: Number(max.toFixed(4)),
      threshold: "< 0.5",
      pass,
      regenerations,
      worstPair: worstPair ? [current[worstPair[0]].tempId, current[worstPair[1]].tempId] : null,
    },
  };
}

async function generateMemorizers(q, classDefinition) {
  const { system, user } = buildMemorizersPrompt(q, classDefinition);
  const data = await withShapeRetry(`${q.id}:memorizers`, async () => {
    const d = await callRouterJSON(system, user, `${q.id}:memorizers`);
    if (!Array.isArray(d.memorizers) || d.memorizers.length < 3) {
      throw new Error(`memorizers devolvió ${d.memorizers?.length} elementos`);
    }
    return d;
  });
  const items = data.memorizers.slice(0, 3);

  const results = [];
  for (let i = 0; i < 3; i++) {
    let text = items[i].text;
    const profile = items[i].profile;
    let containment = definitionContainment(classDefinition, text);
    let regenerations = 0;
    while (containment < 0.7 && regenerations < MAX_REGENERATIONS) {
      regenerations++;
      log(`[check] ${q.id}: memorizer ${i + 1} containment=${containment.toFixed(3)} < 0.7, regenerando (#${regenerations})`);
      const { system: rs, user: ru } = buildMemorizerRetryPrompt(q, classDefinition, MEMORIZER_FLAVORS[i], text);
      const rd = await withShapeRetry(`${q.id}:memorizer${i + 1}-retry-${regenerations}`, async () => {
        const d2 = await callRouterJSON(rs, ru, `${q.id}:memorizer${i + 1}-retry`);
        if (!d2.text) throw new Error("al retry le falta el texto");
        return d2;
      });
      text = rd.text;
      containment = definitionContainment(classDefinition, text);
    }
    results.push({
      profile,
      text,
      containmentReport: {
        metric: "definition_containment",
        value: Number(containment.toFixed(4)),
        threshold: ">= 0.7",
        pass: containment >= 0.7,
        regenerations,
      },
    });
  }
  return results;
}

async function generateMisconceptions(q) {
  const { system, user } = buildMisconceptionsPrompt(q);
  const data = await withShapeRetry(`${q.id}:misconceptions`, async () => {
    const d = await callRouterJSON(system, user, `${q.id}:misconceptions`);
    if (!Array.isArray(d.misconceptions) || d.misconceptions.length < 2) {
      throw new Error(`misconceptions devolvió ${d.misconceptions?.length} elementos`);
    }
    return d;
  });
  return data.misconceptions.slice(0, 2).map((m) => ({ profile: m.profile, text: m.text }));
}

async function generateDistinctive(q) {
  const { system, user } = buildDistinctivePrompt(q);
  const data = await withShapeRetry(`${q.id}:distinctive`, async () => {
    const d = await callRouterJSON(system, user, `${q.id}:distinctive`);
    if (!d.text || !d.profile) throw new Error("a distinctive le falta text/profile");
    return d;
  });
  return { profile: data.profile, text: data.text, markerPhrase: data.markerPhrase || data.profile };
}

async function generateCopies(q, srcs) {
  const { system, user } = buildCopiesPrompt(q, {
    verbatimSrc: srcs.verbatimSrc.text,
    partialSrc: srcs.partialSrc.text,
    paraphraseSrc: srcs.paraphraseSrc.text,
    sharedErrorSrc: srcs.sharedErrorSrc.text,
    markerPhrase: srcs.markerPhrase,
  });
  const data = await withShapeRetry(`${q.id}:copies`, async () => {
    const d = await callRouterJSON(system, user, `${q.id}:copies`);
    const c = d.copies;
    if (!c || !c.verbatim?.text || !c.partial?.text || !c.paraphrase?.text || !c.shared_error?.text) {
      throw new Error("a copies le falta uno o más tipos");
    }
    return d;
  });

  const kindDefs = [
    { kind: "verbatim", src: srcs.verbatimSrc, checkFn: (v) => v >= 0.75, thresholdLabel: ">= 0.75" },
    { kind: "partial", src: srcs.partialSrc, checkFn: (v) => v >= 0.25 && v <= 0.75, thresholdLabel: "0.25-0.75" },
    { kind: "paraphrase", src: srcs.paraphraseSrc, checkFn: (v) => v <= 0.55, thresholdLabel: "<= 0.55" },
  ];

  const results = [];
  for (const k of kindDefs) {
    let text = data.copies[k.kind].text;
    const profile = data.copies[k.kind].profile;
    let val = jaccard(text, k.src.text);
    let regenerations = 0;
    while (!k.checkFn(val) && regenerations < MAX_REGENERATIONS) {
      regenerations++;
      log(`[check] ${q.id}: copy ${k.kind} jaccard=${val.toFixed(3)} fuera de ${k.thresholdLabel}, regenerando (#${regenerations})`);
      const { system: rs, user: ru } = buildCopyRetryPrompt(q, k.kind, k.src.text, text, val, k.thresholdLabel);
      const rd = await withShapeRetry(`${q.id}:${k.kind}-retry-${regenerations}`, async () => {
        const d2 = await callRouterJSON(rs, ru, `${q.id}:${k.kind}-retry`);
        if (!d2.text) throw new Error("al retry le falta el texto");
        return d2;
      });
      text = rd.text;
      val = jaccard(text, k.src.text);
    }
    results.push({
      kind: k.kind,
      profile,
      text,
      sourceTempId: k.src.tempId,
      checkReport: {
        metric: "jaccard_vs_source",
        value: Number(val.toFixed(4)),
        threshold: k.thresholdLabel,
        pass: k.checkFn(val),
        regenerations,
      },
    });
  }

  // shared_error: chequeo informativo de presencia del marcador (no es uno de los
  // chequeos de Jaccard obligatorios, pero lo exige la propia definición de este
  // copyKind: tiene que conservar el error distintivo).
  {
    let text = data.copies.shared_error.text;
    const profile = data.copies.shared_error.profile;
    let present = markerPresent(srcs.markerPhrase, text);
    let regenerations = 0;
    while (!present && regenerations < MAX_REGENERATIONS) {
      regenerations++;
      log(`[check] ${q.id}: shared_error no conservó claramente el marcador, regenerando (#${regenerations})`);
      const { system: rs, user: ru } = buildSharedErrorRetryPrompt(q, srcs.sharedErrorSrc.text, srcs.markerPhrase, text);
      const rd = await withShapeRetry(`${q.id}:shared_error-retry-${regenerations}`, async () => {
        const d2 = await callRouterJSON(rs, ru, `${q.id}:shared_error-retry`);
        if (!d2.text) throw new Error("al retry le falta el texto");
        return d2;
      });
      text = rd.text;
      present = markerPresent(srcs.markerPhrase, text);
    }
    results.push({
      kind: "shared_error",
      profile,
      text,
      sourceTempId: srcs.sharedErrorSrc.tempId,
      checkReport: {
        metric: "shared_error_marker_present_heuristic",
        value: present,
        threshold: "informativo (heurística de superposición de palabras, no un chequeo de Jaccard obligatorio)",
        pass: present,
        regenerations,
      },
    });
  }

  return results;
}

// ---------- Orquestación por pregunta ----------

async function generateQuestion(q) {
  log(`--- ${q.id}: ${q.subject} ---`);

  const core = await withShapeRetry(`${q.id}:core`, () => generateCore(q));
  const initialIndependents = core.independents.map((it, i) => ({
    tempId: `ind${i + 1}`,
    role: "independent",
    profile: it.profile,
    text: it.text,
  }));
  const indCheck = await ensureIndependentsDistinct(q, core.classDefinition, initialIndependents);
  const independents = indCheck.independents;

  const memorizers = await generateMemorizers(q, core.classDefinition);
  const misconceptions = await generateMisconceptions(q);
  const distinctive = await generateDistinctive(q);

  const idxPool = independents.map((_, i) => i);
  const [srcVerbIdx, srcPartIdx, srcParaIdx] = seededPick(idxPool, 3, `${SEED}:${q.id}:copy-sources`);
  const copies = await generateCopies(q, {
    verbatimSrc: independents[srcVerbIdx],
    partialSrc: independents[srcPartIdx],
    paraphraseSrc: independents[srcParaIdx],
    sharedErrorSrc: { tempId: "distinctive", text: distinctive.text },
    markerPhrase: distinctive.markerPhrase,
  });

  const rawAnswers = [
    ...independents,
    ...memorizers.map((m, i) => ({ tempId: `mem${i + 1}`, role: "memorizer", profile: m.profile, text: m.text })),
    ...misconceptions.map((m, i) => ({
      tempId: `misc${i + 1}`,
      role: "common_misconception",
      profile: m.profile,
      text: m.text,
    })),
    { tempId: "distinctive", role: "distinctive_error_source", profile: distinctive.profile, text: distinctive.text },
    ...copies.map((c) => ({
      tempId: `copy_${c.kind}`,
      role: "copy",
      profile: c.profile,
      text: c.text,
      sourceTempId: c.sourceTempId,
      copyKind: c.kind,
    })),
  ];

  const shuffled = seededShuffle(rawAnswers, `${SEED}:${q.id}:order`);
  const idMap = {};
  shuffled.forEach((a, i) => {
    idMap[a.tempId] = `${q.id}-s${String(i + 1).padStart(2, "0")}`;
  });

  const finalAnswers = shuffled.map((a) => {
    const out = { id: idMap[a.tempId], role: a.role, profile: a.profile, text: a.text };
    if (a.role === "copy") {
      out.copyOf = idMap[a.sourceTempId];
      out.copyKind = a.copyKind;
    }
    return out;
  });

  const positives = copies.map((c) => ({
    a: idMap[c.sourceTempId],
    b: idMap[`copy_${c.kind}`],
    kind: c.kind,
  }));

  const memIds = [1, 2, 3].map((i) => idMap[`mem${i}`]);
  const hardNegatives = [
    { a: memIds[0], b: memIds[1], kind: "class_definition" },
    { a: memIds[0], b: memIds[2], kind: "class_definition" },
    { a: memIds[1], b: memIds[2], kind: "class_definition" },
    { a: idMap.misc1, b: idMap.misc2, kind: "common_misconception" },
  ];

  const copyChecks = {};
  for (const c of copies) copyChecks[c.kind] = c.checkReport;

  const mandatoryChecksPass =
    indCheck.report.pass &&
    memorizers.every((m) => m.containmentReport.pass) &&
    copyChecks.verbatim.pass &&
    copyChecks.partial.pass &&
    copyChecks.paraphrase.pass;

  return {
    id: q.id,
    subject: q.subject,
    prompt: q.prompt,
    referenceAnswer: core.referenceAnswer,
    classDefinition: core.classDefinition,
    answers: finalAnswers,
    positives,
    hardNegatives,
    checks: {
      independents: indCheck.report,
      memorizers: memorizers.map((m, i) => ({ id: idMap[`mem${i + 1}`], ...m.containmentReport })),
      copies: copyChecks,
      allMandatoryChecksPass: mandatoryChecksPass,
    },
  };
}

// ---------- Main ----------

function writeDataset(questions, totalPlanned, partial) {
  const dataset = {
    version: 1,
    generatedAt: new Date().toISOString(),
    generator: {
      router: ROUTER_URL,
      notes:
        "Dataset sintético para evaluar la detección de copia entre las respuestas de desarrollo de alumnos, " +
        "generado vía un router LLM multi-proveedor gratuito (protocolo SSE a medida, sin clave de API). Incluye " +
        "negativos difíciles (definición de clase compartida, error común compartido -- coincidencias esperables) y " +
        "positivos (copias verbatim/parcial/parafraseada/error compartido -- copia real) con chequeos de calidad " +
        "automáticos basados en Jaccard y regeneración acotada (máximo 2 por parte que no cumple). " +
        "En cada par de 'positives' / 'hardNegatives', 'a' es la respuesta fuente/anterior y 'b' la derivada, " +
        "excepto los pares de hardNegatives que son simétricos (ambas producidas de forma independiente). " +
        "Las respuestas están en español rioplatense para estudiantes secundarios argentinos de 13 a 16 años.",
    },
    questions,
  };
  writeFileSync(OUTPUT_PATH, JSON.stringify(dataset, null, 2));
  if (partial) log(`[checkpoint] se escribieron ${questions.length}/${totalPlanned} preguntas en ${OUTPUT_PATH}`);
}

async function main() {
  mkdirSync("/tmp/copy-eval", { recursive: true });
  const activeQuestions = TEST_LIMIT ? QUESTIONS.slice(0, TEST_LIMIT) : QUESTIONS;
  log(`Empezando la generación de ${activeQuestions.length} pregunta(s)${TEST_LIMIT ? " (LÍMITE DE PRUEBA)" : ""}`);

  const questionResults = [];
  const errors = [];
  for (const q of activeQuestions) {
    try {
      const result = await generateQuestion(q);
      questionResults.push(result);
    } catch (e) {
      log(`[FATAL para ${q.id}] ${e.stack || e.message}`);
      errors.push({ id: q.id, error: e.message });
    }
    writeDataset(questionResults, activeQuestions.length, true);
  }
  writeDataset(questionResults, activeQuestions.length, false);

  const elapsedSec = ((Date.now() - callStats.startTime) / 1000).toFixed(1);
  log(
    `LISTO: ${questionResults.length}/${activeQuestions.length} preguntas escritas, ` +
      `${callStats.logicalCalls} llamados lógicos (${callStats.httpRequests} pedidos HTTP crudos), ` +
      `${elapsedSec}s transcurridos, proveedores observados: ${[...callStats.providers].join(", ") || "ninguno expuesto"}`,
  );
  if (errors.length) {
    log(`ERRORES: ${JSON.stringify(errors)}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  log(`FATAL SIN CAPTURAR: ${e.stack || e.message}`);
  process.exit(1);
});
