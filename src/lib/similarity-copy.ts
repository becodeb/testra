import type { PairQuestionFinding, SemanticFindingReport, SimilarityPair, SimilarityReport } from "@/server/similarity-analysis";
import type { SimilarityQuestionType } from "@/server/similarity-signals";

// Textos para el docente sobre "Coincidencias entre alumnos". Mismo formato
// que `incident-copy.ts` ({title, what, normal, review}) para que las dos
// listas de señales se lean con la misma voz. SOLO tipos de
// `@/server/similarity-analysis` y `@/server/similarity-signals` (`import
// type`, nunca un import de valor): esos módulos arrastran `db` y el cliente
// de Jev, y este archivo lo importa `similarity-card.tsx`, que corre en el
// navegador. Ver `odd/tasks/jev-copy-detection.md`.

export interface SimilarityCopy {
  title: string;
  what: string;
  normal: string;
  review: string;
}

export type SimilaritySignalKey =
  | "shared_wrong_choice"
  | "shared_wrong_short"
  | "shared_fragments"
  | "shared_distinctive_wording"
  | "same_mistake"
  | "reworded_copy";

export const similarityCopy: Record<SimilaritySignalKey, SimilarityCopy> = {
  shared_wrong_choice: {
    title: "Misma opción incorrecta",
    what: "Los dos eligieron exactamente la misma opción incorrecta.",
    normal: "Un distractor que eligió buena parte de la clase no dice nada por sí solo.",
    review: "Pocos compañeros más eligieron esa misma opción.",
  },
  shared_wrong_short: {
    title: "Misma respuesta corta incorrecta",
    what: "Los dos escribieron la misma respuesta incorrecta, palabra por palabra.",
    normal: "Una confusión típica del tema puede repetirse sin que haya copia.",
    review: "Casi nadie más de la clase escribió esa misma respuesta.",
  },
  shared_fragments: {
    title: "Fragmentos de texto compartidos",
    what: "Las dos respuestas comparten frases que casi nadie más de la clase escribió.",
    normal: "Repetir la definición vista en clase o el vocabulario del tema no cuenta: eso ya se excluye antes de marcar esta señal.",
    review: "Cuanto más largo el fragmento compartido y más cubre de la respuesta, más llamativo.",
  },
  shared_distinctive_wording: {
    title: "Redacción poco común compartida",
    what: "Jev encontró frases o ejemplos propios que se repiten entre las dos respuestas y que no salen de la consigna ni de la respuesta de referencia.",
    normal: "Compartir el vocabulario del tema o la respuesta de referencia no cuenta como esto.",
    review: "Jev lo marca como poco probable que sea casualidad.",
  },
  same_mistake: {
    title: "Mismo error",
    what: "Jev encontró que las dos respuestas tienen el mismo dato incorrecto, la misma confusión o el mismo término inventado.",
    normal: "Un error muy común del tema puede aparecer en varios alumnos sin relación entre sí.",
    review: "Un error específico y poco común compartido por dos personas llama más la atención.",
  },
  reworded_copy: {
    title: "Una respuesta sigue a la otra",
    what: "Jev encontró que una respuesta sigue a la otra punto por punto, con el mismo orden y los mismos ejemplos, cambiando algunas palabras.",
    normal: "Desarrollar las mismas ideas clave del tema en un orden parecido no alcanza para esto.",
    review: "Jev lo marca como poco probable que sea casualidad.",
  },
};

// Calcado de SEMANTIC_STRONG_PROBABILITY / SEMANTIC_REVIEW_PROBABILITY en
// `similarity-analysis.ts` (0.9 / 0.7): ahí deciden si Jev escala el nivel del
// par, acá deciden con qué palabra mostrarle la probabilidad al docente. No
// se importan como valor a propósito (ver el comentario de arriba); si esos
// números cambian, cambian los dos lugares.
const PROBABILITY_HIGH = 0.9;
const PROBABILITY_REVIEW = 0.7;

/** `null` = por debajo del piso de "para revisar": no se le muestra al docente. */
export function probabilityWord(probability: number): "muy probable" | "probable" | null {
  if (probability >= PROBABILITY_HIGH) return "muy probable";
  if (probability >= PROBABILITY_REVIEW) return "probable";
  return null;
}

const SEMANTIC_KEYS: Array<keyof SemanticFindingReport> = ["same_mistake", "reworded_copy", "shared_distinctive_wording"];

/** Las líneas de Jev con probabilidad ≥ "para revisar", ordenadas de más a menos probable. */
export function relevantSemanticFindings(semantic: SemanticFindingReport): Array<{ key: keyof SemanticFindingReport; probability: number; word: "muy probable" | "probable" }> {
  return SEMANTIC_KEYS.map((key) => ({ key, probability: semantic[key], word: probabilityWord(semantic[key]) }))
    .filter((entry): entry is { key: keyof SemanticFindingReport; probability: number; word: "muy probable" | "probable" } => entry.word !== null)
    .sort((a, b) => b.probability - a.probability);
}

export function semanticStatusLine(semantic: SimilarityReport["semantic"]): string {
  const pares = (n: number) => `${n} par${n === 1 ? "" : "es"}`;
  switch (semantic.status) {
    case "ok":
      return `La redacción de las respuestas de desarrollo la revisó Jev (IA) en ${pares(semantic.evaluatedPairs)}.`;
    case "partial": {
      const noRevisados = semantic.failedPairs + semantic.skippedPairs;
      return `La redacción de las respuestas de desarrollo la revisó Jev (IA) en ${pares(semantic.evaluatedPairs)}; ${noRevisados} no se pudieron revisar.`;
    }
    case "not_configured":
      return "La revisión de redacción con IA no está configurada: se muestran solo las coincidencias exactas.";
    case "unavailable":
      return "La revisión de redacción con IA no está disponible ahora: se muestran solo las coincidencias exactas.";
    case "not_needed":
      return "No hay preguntas de desarrollo para comparar la redacción.";
  }
}

function expectedByChanceLabel(value: number): string {
  return value.toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

const SEMANTIC_EVIDENCE_PHRASE: Record<keyof SemanticFindingReport, string> = {
  same_mistake: "mismo error",
  reworded_copy: "una respuesta sigue a la otra",
  shared_distinctive_wording: "redacción poco común compartida",
};

/**
 * Una línea por par para la lista sin expandir: como mucho una frase por
 * pregunta de desarrollo (semántica si Jev encontró algo relevante, si no
 * fragmentos) más el resumen de las cerradas si coincidieron. Primera letra
 * en mayúscula, el resto tal cual.
 */
export function pairEvidenceLine(pair: SimilarityPair): string {
  const parts: string[] = [];

  for (const question of pair.questions) {
    if (question.type !== "long") continue;
    const semantic = question.semantic ? relevantSemanticFindings(question.semantic)[0] : undefined;
    if (semantic) {
      parts.push(`${SEMANTIC_EVIDENCE_PHRASE[semantic.key]} en «${question.label}»`);
    } else if (question.fragments) {
      parts.push(`frases que nadie más escribió en «${question.label}»`);
    }
  }

  if (pair.closedPattern && pair.closedPattern.sharedWrong > 0) {
    const { sharedWrong, expectedByChance } = pair.closedPattern;
    parts.push(
      `${sharedWrong} respuesta${sharedWrong === 1 ? "" : "s"} incorrecta${sharedWrong === 1 ? "" : "s"} igual${sharedWrong === 1 ? "" : "es"} (por azar: ${expectedByChanceLabel(expectedByChance)})`,
    );
  }

  const line = parts.join(" · ");
  return line ? line.charAt(0).toUpperCase() + line.slice(1) : "";
}

/** "Coinciden en S respuestas incorrectas; si hubieran respondido cada uno por su cuenta, lo esperable era E." */
export function closedPatternLine(closedPattern: NonNullable<SimilarityPair["closedPattern"]>): string {
  const { sharedWrong, expectedByChance } = closedPattern;
  return `Coinciden en ${sharedWrong} respuesta${sharedWrong === 1 ? "" : "s"} incorrecta${sharedWrong === 1 ? "" : "s"}; si hubieran respondido cada uno por su cuenta, lo esperable era ${expectedByChanceLabel(expectedByChance)}.`;
}

/** "nadie más la eligió" / "la eligieron X compañeros más". */
export function othersWithSameLine(othersWithSame: number): string {
  return othersWithSame === 0 ? "nadie más la eligió" : `la eligieron ${othersWithSame} compañero${othersWithSame === 1 ? "" : "s"} más`;
}

export function copyForClosedQuestion(type: SimilarityQuestionType): SimilarityCopy {
  return similarityCopy[type === "sa" ? "shared_wrong_short" : "shared_wrong_choice"];
}

/** "Comparten fragmentos que nadie más escribió (41 % del texto)". */
export function fragmentCoverageLine(coverage: number): string {
  return `Comparten fragmentos que nadie más escribió (${Math.round(coverage * 100)} % del texto).`;
}

const relativeFormatter = new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" });

/** "hace instantes" / "hace N minutos" / "hace N horas", y la fecha local a partir del día. */
export function relativeTimeLabel(epochMs: number, now: number = Date.now()): string {
  const diffSeconds = Math.round((now - epochMs) / 1000);
  if (diffSeconds < 45) return "hace instantes";
  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `hace ${diffMinutes} minuto${diffMinutes === 1 ? "" : "s"}`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `hace ${diffHours} hora${diffHours === 1 ? "" : "s"}`;
  return relativeFormatter.format(epochMs);
}

export function pairKeyOf(pair: SimilarityPair): string {
  return pair.a.participantId < pair.b.participantId ? `${pair.a.participantId}|${pair.b.participantId}` : `${pair.b.participantId}|${pair.a.participantId}`;
}

/** Preguntas cerradas (mc/ms/tf/sa) del par que sí tienen la opción compartida, en el orden en que llegaron. */
export function closedFindingsOf(pair: SimilarityPair): PairQuestionFinding[] {
  return pair.questions.filter((question) => question.type !== "long" && question.sharedWrongAnswer);
}

/** Preguntas de desarrollo del par, en el orden en que llegaron. */
export function longFindingsOf(pair: SimilarityPair): PairQuestionFinding[] {
  return pair.questions.filter((question) => question.type === "long");
}
