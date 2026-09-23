import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { chatJson, type ChatMessage } from "@/server/ai-client";
import { JevError, evaluateWithJev, jevConfigured, type JevAnswer, type JevErrorCode, type JevEvaluateRequest, type JevQuestionSpec, type JevResult } from "@/server/jev-client";
import { buildJevRequest, eligibleParticipantIds, orderPairsForQuestion, SEMANTIC_REVIEW_PROBABILITY, SIMILARITY_CONTEXT, SIMILARITY_QUESTIONS } from "@/server/similarity-analysis";
import { computeFragmentSignals, pairKey, type FragmentFinding, type SimilarityQuestion } from "@/server/similarity-signals";

import { runClosedSimulation, type ClosedSimConfig } from "./lib/closed-sim";
import { allPairs, globalPairKey, loadDataset, questionToClassInput, type Dataset, type DatasetQuestion } from "./lib/dataset";
import { max, mean, percentile, precisionRecall, rocAuc, seededRng, sleep } from "./lib/metrics";
import { fmtMs, fmtNum, fmtPct, mdTable } from "./lib/report";

// Harness de evaluación: responde "¿esto detecta copia, y Jev ayuda acá?" con
// números, sobre el dataset sintético de `scripts/copy-eval/dataset.json`.
// Corre con `npm run eval:copias` (config separada, `vitest.eval.config.ts`;
// `npm test` nunca la levanta). Gratis y offline por defecto: Jev y el juez
// LLM son opt-in por variable de entorno (`EVAL_JEV=1`, `EVAL_LLM=1`) porque
// hacen llamadas de red reales. Ver `odd/tasks/jev-copy-detection.md`, tarea T4.

if (existsSync(".env")) process.loadEnvFile();

const DATASET_PATH = fileURLToPath(new URL("./dataset.json", import.meta.url));
const RESULTS_DIR = fileURLToPath(new URL("./results", import.meta.url));

// --- Utilidades compartidas entre medidas -----------------------------------

interface LabeledPair {
  questionId: string;
  a: string;
  b: string;
  kind: string;
}

function collectPositives(dataset: Dataset): LabeledPair[] {
  return dataset.questions.flatMap((q) => q.positives.map((p) => ({ questionId: q.id, a: p.a, b: p.b, kind: p.kind })));
}

function collectHardNegatives(dataset: Dataset): LabeledPair[] {
  return dataset.questions.flatMap((q) => q.hardNegatives.map((p) => ({ questionId: q.id, a: p.a, b: p.b, kind: p.kind })));
}

function collectAllPairs(dataset: Dataset): LabeledPair[] {
  return dataset.questions.flatMap((q) => allPairs(q.answers.map((a) => a.id)).map(([a, b]) => ({ questionId: q.id, a, b, kind: "any" })));
}

function textLookup(dataset: Dataset): Map<string, Map<string, string>> {
  return new Map(dataset.questions.map((q) => [q.id, new Map(q.answers.map((a) => [a.id, a.text]))]));
}

function timestampTag(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
}

// --- Medida 1: señales de código en desarrollo (computeFragmentSignals) -----

type FragmentLevel = "strong" | "review" | null;
type Threshold = "strong" | "review_or_strong";

function predictsAt(level: FragmentLevel, threshold: Threshold): boolean {
  return threshold === "strong" ? level === "strong" : level === "strong" || level === "review";
}

function evaluateFragments(dataset: Dataset): { markdown: string; findingsByQuestion: Map<string, Map<string, FragmentFinding[]>> } {
  const flagByKey = new Map<string, { a: string; b: string; questionId: string; level: FragmentLevel }>();
  const findingsByQuestion = new Map<string, Map<string, FragmentFinding[]>>();

  for (const question of dataset.questions) {
    const input = questionToClassInput(question);
    const findings = computeFragmentSignals(input);
    findingsByQuestion.set(question.id, findings);
    const ids = question.answers.map((a) => a.id);
    for (const [a, b] of allPairs(ids)) {
      const finding = (findings.get(pairKey(a, b)) ?? []).find((f) => f.questionId === question.id);
      flagByKey.set(globalPairKey(question.id, a, b), { a, b, questionId: question.id, level: finding?.level ?? null });
    }
  }

  const positives = collectPositives(dataset);
  const hardNegatives = collectHardNegatives(dataset);
  const positiveKeys = new Set(positives.map((p) => globalPairKey(p.questionId, p.a, p.b)));
  const hardNegKind = new Map(hardNegatives.map((p) => [globalPairKey(p.questionId, p.a, p.b), p.kind]));
  const totalUniverse = flagByKey.size; // 1656 = 6 preguntas × 276 pares
  const totalOtherNegatives = totalUniverse - positives.length - hardNegatives.length;

  const summaryRows: Array<Array<string | number>> = [];
  const recallByKindRows: Array<Array<string | number>> = [];
  const hardNegRows: Array<Array<string | number>> = [];
  const fpLines: string[] = [];
  const fnLines: string[] = [];
  const recallByKindPerThreshold = new Map<Threshold, Map<string, { tp: number; total: number }>>();

  for (const threshold of ["strong", "review_or_strong"] as const) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    const fpByHardKind = new Map<string, number>();
    let fpOther = 0;
    const recallByKind = new Map<string, { tp: number; total: number }>();

    for (const p of positives) {
      const key = globalPairKey(p.questionId, p.a, p.b);
      const rec = recallByKind.get(p.kind) ?? { tp: 0, total: 0 };
      rec.total += 1;
      const predicted = predictsAt(flagByKey.get(key)!.level, threshold);
      if (predicted) {
        tp += 1;
        rec.tp += 1;
      } else {
        fn += 1;
        fnLines.push(`- [${threshold}] FN — ${p.questionId} ${p.a} ~ ${p.b} (copyKind=${p.kind})`);
      }
      recallByKind.set(p.kind, rec);
    }
    recallByKindPerThreshold.set(threshold, recallByKind);

    for (const [key, flag] of flagByKey) {
      if (positiveKeys.has(key)) continue;
      if (!predictsAt(flag.level, threshold)) continue;
      fp += 1;
      const kind = hardNegKind.get(key);
      if (kind) {
        fpByHardKind.set(kind, (fpByHardKind.get(kind) ?? 0) + 1);
        fpLines.push(`- [${threshold}] FP (hard negative, kind=${kind}) — ${flag.questionId} ${flag.a} ~ ${flag.b} (level=${flag.level})`);
      } else {
        fpOther += 1;
        fpLines.push(`- [${threshold}] FP (otro par) — ${flag.questionId} ${flag.a} ~ ${flag.b} (level=${flag.level})`);
      }
    }

    const { precision, recall } = precisionRecall({ tp, fp, fn });
    summaryRows.push([threshold, fmtPct(precision), fmtPct(recall), tp, fp, fn]);
    for (const kind of ["class_definition", "common_misconception"] as const) {
      const count = fpByHardKind.get(kind) ?? 0;
      const total = hardNegatives.filter((h) => h.kind === kind).length;
      hardNegRows.push([threshold, kind, count, total, fmtPct(total ? count / total : null)]);
    }
    hardNegRows.push([threshold, "otros negativos", fpOther, totalOtherNegatives, fmtPct(totalOtherNegatives ? fpOther / totalOtherNegatives : null)]);
  }

  for (const kind of ["verbatim", "partial", "paraphrase", "shared_error"] as const) {
    const strong = recallByKindPerThreshold.get("strong")!.get(kind) ?? { tp: 0, total: 0 };
    const reviewOrStrong = recallByKindPerThreshold.get("review_or_strong")!.get(kind) ?? { tp: 0, total: 0 };
    recallByKindRows.push([
      kind,
      strong.total,
      fmtPct(strong.total ? strong.tp / strong.total : null),
      fmtPct(reviewOrStrong.total ? reviewOrStrong.tp / reviewOrStrong.total : null),
    ]);
  }

  const markdown = [
    "## 1. Señales de código en desarrollo (`computeFragmentSignals`)",
    "",
    `Universo: ${totalUniverse} pares (6 preguntas × 276), ${positives.length} positivos, ${hardNegatives.length} negativos difíciles, ${totalOtherNegatives} otros negativos.`,
    "",
    mdTable(["nivel", "precisión", "recall", "TP", "FP", "FN"], summaryRows),
    "",
    "### Recall por `copyKind`",
    "",
    mdTable(["copyKind", "positivos", "recall (strong)", "recall (review+strong)"], recallByKindRows),
    "",
    "### Falsos positivos por tipo de negativo",
    "",
    mdTable(["nivel", "tipo", "FP", "total", "tasa"], hardNegRows),
    "",
    "### Falsos positivos, uno por uno",
    "",
    fpLines.length ? fpLines.join("\n") : "_(ninguno)_",
    "",
    "### Falsos negativos, uno por uno",
    "",
    fnLines.length ? fnLines.join("\n") : "_(ninguno)_",
  ].join("\n");

  return { markdown, findingsByQuestion };
}

// --- Medida 2: prefiltro (orderPairsForQuestion + rankPairsByTfIdf) ---------

function evaluatePrefilter(dataset: Dataset, findingsByQuestion: Map<string, Map<string, FragmentFinding[]>>): string {
  const positives = collectPositives(dataset);
  const rankRows: Array<Array<string | number>> = [];
  let withinBudget = 0;
  const budgetPerQuestion = new Map<string, number>();
  const orderedByQuestion = new Map<string, Array<[string, string]>>();

  for (const question of dataset.questions) {
    const input = questionToClassInput(question);
    const eligibleIds = eligibleParticipantIds(input, question.id);
    const budget = Math.max(20, 3 * eligibleIds.size);
    budgetPerQuestion.set(question.id, budget);
    const ordered = orderPairsForQuestion(input, question.id, findingsByQuestion.get(question.id) ?? new Map(), eligibleIds);
    orderedByQuestion.set(question.id, ordered);
  }

  for (const p of positives) {
    const ordered = orderedByQuestion.get(p.questionId) ?? [];
    const budget = budgetPerQuestion.get(p.questionId) ?? 0;
    const key = pairKey(p.a, p.b);
    const rank = ordered.findIndex(([a, b]) => pairKey(a, b) === key);
    const inBudget = rank !== -1 && rank < budget;
    if (inBudget) withinBudget += 1;
    rankRows.push([p.questionId, `${p.a} ~ ${p.b}`, p.kind, rank === -1 ? "fuera del ranking" : rank + 1, inBudget ? "sí" : "no"]);
  }

  const recall = positives.length ? withinBudget / positives.length : null;
  const budgetExample = [...budgetPerQuestion.values()][0] ?? 0;

  const markdown = [
    "## 2. Prefiltro (orden real: fragmentos primero, después TF-IDF; presupuesto por pregunta)",
    "",
    `Presupuesto por pregunta: \`max(20, 3×respondentes)\` = ${budgetExample} de 276 pares posibles.`,
    "",
    `Recall de los ${positives.length} positivos dentro del presupuesto: **${fmtPct(recall)}** (${withinBudget}/${positives.length}).`,
    "",
    mdTable(["pregunta", "par", "copyKind", "rank (1-based)", "¿entra al presupuesto?"], rankRows),
  ].join("\n");

  return markdown;
}

// --- Medida 3: Jev (EVAL_JEV=1) ---------------------------------------------

type JevVariantName = "base" | "no_context" | "es";

const SIMILARITY_QUESTIONS_ES: Record<string, JevQuestionSpec> = {
  shared_distinctive_wording: {
    type: "boolean",
    instructions: "¿Comparten respuesta_1 y respuesta_2 un vocabulario distintivo que no está en la consigna ni en la respuesta_de_referencia?",
    criteria: {
      true: "Repiten las mismas frases u oraciones poco comunes, los mismos ejemplos propios, o la misma forma inusual de decir algo.",
      false: "Lo que comparten es el vocabulario del tema, la respuesta de referencia, o una definición que todos los alumnos aprendieron en clase.",
    },
  },
  same_mistake: {
    type: "boolean",
    instructions: "¿Contienen respuesta_1 y respuesta_2 el mismo error específico?",
    criteria: {
      true: "Ambas afirman el mismo dato incorrecto, la misma idea equivocada, el mismo término inventado, o la misma falta de ortografía distintiva.",
      false: "Ninguna tiene un error, o sus errores son distintos.",
    },
  },
  reworded_copy: {
    type: "boolean",
    instructions: "¿Es una respuesta una versión reformulada de la otra?",
    criteria: {
      true: "Sigue a la otra punto por punto, con el mismo orden y los mismos ejemplos, cambiando algunas palabras.",
      false: "Cada respuesta desarrolla las ideas a su manera, aunque ambas cubran los puntos clave de la respuesta de referencia.",
    },
  },
};

function similarityQuestionOf(question: DatasetQuestion): SimilarityQuestion {
  return { id: question.id, label: question.prompt, type: "long", prompt: question.prompt, expectedText: question.referenceAnswer };
}

function buildRequestForVariant(question: DatasetQuestion, textA: string, textB: string, variant: JevVariantName): JevEvaluateRequest {
  if (variant === "no_context") {
    return { state: { consigna: question.prompt, respuesta_1: textA, respuesta_2: textB }, questions: SIMILARITY_QUESTIONS };
  }
  const base = buildJevRequest(similarityQuestionOf(question), textA, textB);
  return variant === "es" ? { state: base.state, questions: SIMILARITY_QUESTIONS_ES } : base;
}

interface JevCall {
  questionId: string;
  a: string;
  b: string;
  kind: string;
  request: JevEvaluateRequest;
}

function buildJevCalls(dataset: Dataset, variant: JevVariantName): JevCall[] {
  const positives = new Map(collectPositives(dataset).map((p) => [globalPairKey(p.questionId, p.a, p.b), p.kind]));
  const hardNegs = new Map(collectHardNegatives(dataset).map((p) => [globalPairKey(p.questionId, p.a, p.b), p.kind]));
  const calls: JevCall[] = [];
  for (const question of dataset.questions) {
    const texts = new Map(question.answers.map((a) => [a.id, a.text]));
    for (const [a, b] of allPairs(question.answers.map((x) => x.id))) {
      const key = globalPairKey(question.id, a, b);
      const kind = positives.get(key) ?? hardNegs.get(key) ?? "other";
      calls.push({ questionId: question.id, a, b, kind, request: buildRequestForVariant(question, texts.get(a)!, texts.get(b)!, variant) });
    }
  }
  return calls;
}

const FATAL_JEV_CODES = new Set<JevErrorCode>(["not_configured", "billing_required", "unauthorized", "bad_request"]);

interface JevCallRecord {
  call: JevCall;
  result: JevResult;
  latencyMs: number;
}

async function runJevCalls(calls: JevCall[], concurrency: number): Promise<{ records: JevCallRecord[]; attempted: number; stopReason: string | null }> {
  const records: JevCallRecord[] = [];
  let stopReason: string | null = null;
  let attempted = 0;
  let cursor = 0;

  async function worker() {
    for (;;) {
      if (stopReason) return;
      const index = cursor;
      if (index >= calls.length) return;
      cursor += 1;
      const call = calls[index];
      attempted += 1;
      const start = Date.now();
      try {
        const result = await evaluateWithJev(call.request);
        records.push({ call, result, latencyMs: Date.now() - start });
      } catch (error) {
        if (error instanceof JevError && FATAL_JEV_CODES.has(error.code)) {
          stopReason = error.code;
          return;
        }
        // Falla transitoria puntual de un par: se descarta esa fila y se sigue,
        // acá interesa juntar datos de tantos pares como se pueda.
      }
    }
  }
  const workerCount = Math.max(1, Math.min(concurrency, calls.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return { records, attempted, stopReason };
}

function readProbability(answer: JevAnswer | undefined): number {
  return answer && answer.type === "boolean" ? answer.probability : 0;
}

const BOOLEAN_KEYS = ["shared_distinctive_wording", "same_mistake", "reworded_copy"] as const;
type BooleanKey = (typeof BOOLEAN_KEYS)[number] | "max";
const REPORTED_KEYS: BooleanKey[] = [...BOOLEAN_KEYS, "max"];

/** Probabilidad de una clave real, o el máximo de las tres para la pseudo-clave "max" (la que de hecho decide el nivel en producción). */
function scoreFor(result: JevResult, key: BooleanKey): number {
  return key === "max" ? Math.max(...BOOLEAN_KEYS.map((k) => readProbability(result.answers[k]))) : readProbability(result.answers[key]);
}

function variantStatsMarkdown(variant: JevVariantName, dataset: Dataset, records: JevCallRecord[]): string {
  const positiveKeys = new Set(collectPositives(dataset).map((p) => globalPairKey(p.questionId, p.a, p.b)));
  const hardNegKind = new Map(collectHardNegatives(dataset).map((p) => [globalPairKey(p.questionId, p.a, p.b), p.kind]));
  const copyKindByKey = new Map(collectPositives(dataset).map((p) => [globalPairKey(p.questionId, p.a, p.b), p.kind]));

  const perKeyRows: Array<Array<string | number>> = [];
  for (const key of REPORTED_KEYS) {
    const scores = records.map((r) => ({
      score: scoreFor(r.result, key),
      label: (positiveKeys.has(globalPairKey(r.call.questionId, r.call.a, r.call.b)) ? 1 : 0) as 0 | 1,
    }));
    const auc = rocAuc(scores);
    for (const threshold of [0.5, 0.7, 0.9]) {
      let tp = 0, fp = 0, fn = 0;
      for (const r of records) {
        const isPositive = positiveKeys.has(globalPairKey(r.call.questionId, r.call.a, r.call.b));
        const predicted = scoreFor(r.result, key) >= threshold;
        if (predicted && isPositive) tp += 1;
        else if (predicted && !isPositive) fp += 1;
        else if (!predicted && isPositive) fn += 1;
      }
      const { precision, recall } = precisionRecall({ tp, fp, fn });
      perKeyRows.push([key, threshold, fmtPct(precision), fmtPct(recall)]);
    }
    perKeyRows.push([key, "AUC-ROC", fmtNum(auc), ""]);
  }

  const latencies = records.map((r) => r.latencyMs);
  const inputTokens = records.reduce((sum, r) => sum + (r.result.usage?.inputTokens ?? 0), 0);
  const cost = records.reduce((sum, r) => sum + (r.result.costUsd ?? 0), 0);

  const hardNegRows: Array<Array<string | number>> = [];
  for (const kind of ["class_definition", "common_misconception"] as const) {
    const relevant = records.filter((r) => hardNegKind.get(globalPairKey(r.call.questionId, r.call.a, r.call.b)) === kind);
    for (const threshold of [0.5, 0.7, 0.9]) {
      const flagged = relevant.filter((r) => scoreFor(r.result, "max") >= threshold).length;
      hardNegRows.push([kind, threshold, flagged, relevant.length, fmtPct(relevant.length ? flagged / relevant.length : null)]);
    }
  }

  const recallByCopyKindRows: Array<Array<string | number>> = [];
  for (const kind of ["verbatim", "partial", "paraphrase", "shared_error"] as const) {
    const relevant = records.filter((r) => copyKindByKey.get(globalPairKey(r.call.questionId, r.call.a, r.call.b)) === kind);
    for (const threshold of [0.5, 0.7, 0.9]) {
      const flagged = relevant.filter((r) => scoreFor(r.result, "max") >= threshold).length;
      recallByCopyKindRows.push([kind, threshold, flagged, relevant.length, fmtPct(relevant.length ? flagged / relevant.length : null)]);
    }
  }

  return [
    `### Variante \`${variant}\` — ${records.length} pares evaluados`,
    "",
    mdTable(["boolean/max", "umbral o métrica", "precisión/AUC", "recall"], perKeyRows),
    "",
    "#### Falsos positivos en negativos difíciles (máx. de los 3 booleanos)",
    "",
    mdTable(["kind", "umbral", "FP", "total", "tasa"], hardNegRows),
    "",
    "#### Recall por `copyKind` (máx. de los 3 booleanos)",
    "",
    mdTable(["copyKind", "umbral", "detectados", "total", "recall"], recallByCopyKindRows),
    "",
    `Latencia: p50 ${fmtMs(percentile(latencies, 50))}, p95 ${fmtMs(percentile(latencies, 95))}. Tokens de entrada: ${inputTokens}. Costo: US$ ${cost.toFixed(6)}.`,
  ].join("\n");
}

async function evaluateJev(dataset: Dataset): Promise<{ markdown: string; perPairBase: Map<string, JevResult> }> {
  const perPairBase = new Map<string, JevResult>();
  if (!jevConfigured()) {
    return { markdown: "## 3. Jev (`EVAL_JEV=1`)\n\n`AI_GATEWAY_API_KEY` no está configurada: no se hizo ningún llamado.", perPairBase };
  }

  const requested = (process.env.EVAL_JEV_VARIANTS ?? "base")
    .split(",")
    .map((v) => v.trim())
    .filter((v): v is JevVariantName => v === "base" || v === "no_context" || v === "es");
  const variantNames = requested.length ? requested : (["base"] as JevVariantName[]);

  const sections: string[] = [];
  let globalStopReason: string | null = null;
  let totalAttempted = 0;

  for (const variant of variantNames) {
    if (globalStopReason) {
      sections.push(`### Variante \`${variant}\`\n\nNo se corrió: la tanda ya se había cortado en la variante anterior.`);
      continue;
    }
    const calls = buildJevCalls(dataset, variant);
    const { records, attempted, stopReason } = await runJevCalls(calls, 4);
    totalAttempted += attempted;
    if (variant === "base") for (const r of records) perPairBase.set(globalPairKey(r.call.questionId, r.call.a, r.call.b), r.result);

    if (stopReason) {
      globalStopReason = stopReason;
      sections.push(
        `### Variante \`${variant}\`\n\nSe cortó de inmediato: de ${attempted} llamado(s) intentado(s), uno devolvió **\`${stopReason}\`** (error permanente, no se reintenta). Ningún número fabricado para esta variante — ${records.length} pares sí llegaron a evaluarse antes del corte.` +
          (records.length ? `\n\n${variantStatsMarkdown(variant, dataset, records)}` : ""),
      );
      continue;
    }
    sections.push(variantStatsMarkdown(variant, dataset, records));

    // Consistencia: solo tiene sentido si la variante base realmente corrió.
    if (variant === "base" && records.length >= 40) {
      const fixed = records.slice(0, 40);
      const diffs: number[] = [];
      for (const record of fixed) {
        try {
          const second = await evaluateWithJev(record.call.request);
          for (const key of BOOLEAN_KEYS) diffs.push(Math.abs(readProbability(record.result.answers[key]) - readProbability(second.answers[key])));
        } catch {
          // Una falla puntual en el re-run no invalida el resto de la muestra.
        }
      }
      sections.push(`#### Consistencia (\`base\`, 40 pares fijos re-evaluados)\n\nDiferencia absoluta de probabilidad: media ${fmtNum(mean(diffs))}, máxima ${fmtNum(max(diffs))} (${diffs.length} valores).`);
    }
  }

  const header = [
    "## 3. Jev (`EVAL_JEV=1`)",
    "",
    `${totalAttempted} llamado(s) reales intentados contra \`${process.env.AI_GATEWAY_URL ?? "https://ai-gateway.vercel.sh"}\`. Concurrencia 4, todos los 276 pares de cada pregunta (no solo los preseleccionados).`,
    globalStopReason ? `\n**La tanda se cortó por \`${globalStopReason}\`.**` : "",
  ].join("\n");

  return { markdown: [header, ...sections].join("\n\n"), perPairBase };
}

// --- Medida 4: juez LLM vía ai-router (EVAL_LLM=1) --------------------------

function buildLlmSample(dataset: Dataset): LabeledPair[] {
  const positives = collectPositives(dataset);
  const hardNegatives = collectHardNegatives(dataset);
  const taken = new Set([...positives, ...hardNegatives].map((p) => globalPairKey(p.questionId, p.a, p.b)));
  const otherPairs = collectAllPairs(dataset).filter((p) => !taken.has(globalPairKey(p.questionId, p.a, p.b)));

  const rng = seededRng("copy-eval-llm-sample-v1");
  const shuffled = [...otherPairs];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return [...positives, ...hardNegatives, ...shuffled.slice(0, 72)];
}

interface LlmJudgment {
  copia: boolean;
  probabilidad: number;
  motivo: string;
}

function buildLlmMessages(question: DatasetQuestion, textA: string, textB: string): ChatMessage[] {
  const system =
    "Sos un asistente que ayuda a un docente a revisar si dos respuestas de examen podrían ser una copia entre compañeros. " +
    "Nunca acusás ni sancionás: solo das una probabilidad y un motivo breve. " +
    'Respondé SOLO JSON válido con el esquema {"copia": boolean, "probabilidad": number (0 a 1), "motivo": string}.';
  const user = `${SIMILARITY_CONTEXT}\n\nConsigna: ${question.prompt}\nRespuesta de referencia: ${question.referenceAnswer}\n\nRespuesta 1: ${textA}\n\nRespuesta 2: ${textB}\n\n¿Una respuesta es copia de la otra (textual, parcial, parafraseada, o comparte un error particular que no se explica por estudiar el mismo tema)?`;
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

async function callLlmJudge(question: DatasetQuestion, textA: string, textB: string): Promise<LlmJudgment | { error: string }> {
  try {
    const raw = await chatJson(buildLlmMessages(question, textA, textB), {
      unavailable: "ai-router no configurado",
      failed: "el juez LLM no respondió con JSON válido",
    });
    const parsed = raw as Partial<LlmJudgment>;
    if (typeof parsed.copia !== "boolean" || typeof parsed.probabilidad !== "number" || Number.isNaN(parsed.probabilidad)) {
      return { error: `forma inesperada: ${JSON.stringify(raw).slice(0, 200)}` };
    }
    return { copia: parsed.copia, probabilidad: Math.min(1, Math.max(0, parsed.probabilidad)), motivo: typeof parsed.motivo === "string" ? parsed.motivo : "" };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function evaluateLlmJudge(dataset: Dataset, jevPerPairBase: Map<string, JevResult>): Promise<string> {
  const sample = buildLlmSample(dataset);
  const texts = textLookup(dataset);
  const questionById = new Map(dataset.questions.map((q) => [q.id, q]));

  interface Row {
    pair: LabeledPair;
    outcome: Awaited<ReturnType<typeof callLlmJudge>>;
    latencyMs: number;
  }
  const rows: Row[] = [];
  for (const pair of sample) {
    const question = questionById.get(pair.questionId)!;
    const start = Date.now();
    const outcome = await callLlmJudge(question, texts.get(pair.questionId)!.get(pair.a)!, texts.get(pair.questionId)!.get(pair.b)!);
    rows.push({ pair, outcome, latencyMs: Date.now() - start });
    await sleep(1000);
  }

  const failures = rows.filter((r) => "error" in r.outcome).length;
  const ok = rows.filter((r): r is Row & { outcome: LlmJudgment } => !("error" in r.outcome));
  const positiveKeys = new Set(collectPositives(dataset).map((p) => globalPairKey(p.questionId, p.a, p.b)));
  const hardNegKind = new Map(collectHardNegatives(dataset).map((p) => [globalPairKey(p.questionId, p.a, p.b), p.kind]));

  let tp = 0, fp = 0, fn = 0;
  const fpByHardKind = new Map<string, number>();
  for (const row of ok) {
    const key = globalPairKey(row.pair.questionId, row.pair.a, row.pair.b);
    const isPositive = positiveKeys.has(key);
    if (row.outcome.copia && isPositive) tp += 1;
    else if (row.outcome.copia && !isPositive) {
      fp += 1;
      const kind = hardNegKind.get(key);
      if (kind) fpByHardKind.set(kind, (fpByHardKind.get(kind) ?? 0) + 1);
    } else if (!row.outcome.copia && isPositive) fn += 1;
  }
  const { precision, recall } = precisionRecall({ tp, fp, fn });
  const latencies = rows.map((r) => r.latencyMs);

  // Consistencia: 20 pares fijos (los primeros 20 de la muestra que sí contestaron bien), re-evaluados.
  const consistencySample = ok.slice(0, 20);
  const diffs: number[] = [];
  let agree = 0;
  for (const row of consistencySample) {
    const question = questionById.get(row.pair.questionId)!;
    const second = await callLlmJudge(question, texts.get(row.pair.questionId)!.get(row.pair.a)!, texts.get(row.pair.questionId)!.get(row.pair.b)!);
    await sleep(1000);
    if (!("error" in second)) {
      diffs.push(Math.abs(row.outcome.probabilidad - second.probabilidad));
      if (row.outcome.copia === second.copia) agree += 1;
    }
  }

  const hardNegRows = (["class_definition", "common_misconception"] as const).map((kind) => {
    const total = sample.filter((p) => p.kind === kind).length;
    const flagged = fpByHardKind.get(kind) ?? 0;
    return [kind, flagged, total, fmtPct(total ? flagged / total : null)];
  });

  const sections = [
    "## 4. Juez LLM pairwise vía el ai-router (`EVAL_LLM=1`)",
    "",
    `Muestra: ${sample.length} pares (24 positivos + 24 negativos difíciles + 72 otros negativos al azar, semilla fija), secuencial, ~1s entre llamados.`,
    "",
    mdTable(
      ["precisión", "recall", "TP", "FP", "FN", "fallas de parseo/transporte", "latencia p50", "latencia p95"],
      [[fmtPct(precision), fmtPct(recall), tp, fp, fn, `${failures}/${rows.length}`, fmtMs(percentile(latencies, 50)), fmtMs(percentile(latencies, 95))]],
    ),
    "",
    "### Falsos positivos en negativos difíciles",
    "",
    mdTable(["kind", "FP", "total", "tasa"], hardNegRows),
    "",
    `### Consistencia (20 pares fijos re-evaluados)\n\nAcuerdo en \`copia\`: ${fmtPct(consistencySample.length ? agree / consistencySample.length : null)}. Diferencia absoluta de \`probabilidad\`: media ${fmtNum(mean(diffs))}, máxima ${fmtNum(max(diffs))}.`,
  ];

  if (jevPerPairBase.size > 0) {
    const comparisonRows: Array<Array<string | number>> = [];
    let jevAgree = 0;
    let jevCompared = 0;
    for (const row of ok) {
      const key = globalPairKey(row.pair.questionId, row.pair.a, row.pair.b);
      const jev = jevPerPairBase.get(key);
      if (!jev) continue;
      jevCompared += 1;
      const jevMax = Math.max(...BOOLEAN_KEYS.map((k) => readProbability(jev.answers[k])));
      const jevSaysCopy = jevMax >= SEMANTIC_REVIEW_PROBABILITY;
      if (jevSaysCopy === row.outcome.copia) jevAgree += 1;
    }
    comparisonRows.push(["LLM vs Jev (base)", jevCompared, fmtPct(jevCompared ? jevAgree / jevCompared : null)]);
    sections.push("### Comparación con Jev `base` sobre los mismos 120 pares", "", mdTable(["comparación", "pares en común", "acuerdo"], comparisonRows));
  } else {
    sections.push("### Comparación con Jev\n\nJev no corrió (o se cortó antes de reunir datos): no hay tabla comparativa para esta corrida.");
  }

  return sections.join("\n\n");
}

// --- Medida 5: simulación de preguntas cerradas (sin IA) --------------------

function evaluateClosedSim(): string {
  const mcConfig: ClosedSimConfig = { studentCount: 30, questionCount: 15, questionType: "mc", distractorWeights: [0.6, 0.25, 0.15], colludingPairs: 2, collusionRate: 0.7 };
  const tfConfig: ClosedSimConfig = { studentCount: 30, questionCount: 10, questionType: "tf", distractorWeights: [1], colludingPairs: 2, collusionRate: 0.7 };
  const mc = runClosedSimulation(mcConfig, 200, "closed-sim-mc-v1");
  const tf = runClosedSimulation(tfConfig, 200, "closed-sim-tf-v1");

  const rows = [
    ["15 mc (4 opciones, distractores 60/25/15)", mc.colludingInstances, fmtPct(mc.strongRate), fmtPct(mc.reviewOrStrongRate), fmtNum(mc.otherFalseFlagsMean, 2), fmtNum(mc.otherFalseFlagsP95, 2), mc.totalOtherPairsPerClass],
    ["10 tf", tf.colludingInstances, fmtPct(tf.strongRate), fmtPct(tf.reviewOrStrongRate), fmtNum(tf.otherFalseFlagsMean, 2), fmtNum(tf.otherFalseFlagsP95, 2), tf.totalOtherPairsPerClass],
  ];

  return [
    "## 5. Preguntas cerradas, simulación sin IA (calibra `CLOSED_*`)",
    "",
    "30 alumnos, modelo logístico de habilidad/dificultad (1 parámetro), 2 pares que coluden copiando la respuesta del otro con 70% de probabilidad por pregunta, 200 semillas.",
    "",
    mdTable(
      ["clase", "instancias colusoras (2×200)", "detección strong", "detección review+strong", "falsos flags/clase (media)", "falsos flags/clase (p95)", "otros pares/clase"],
      rows,
    ),
  ].join("\n");
}

// --- Orquestación y reporte --------------------------------------------------

function buildReport(dataset: Dataset, methodSet: string[], sections: string[]): string {
  return [
    "# Evaluación de detección de copia entre alumnos",
    "",
    `Generado: ${new Date().toISOString()}. Dataset: \`scripts/copy-eval/dataset.json\` (${dataset.questions.length} preguntas × 24 respuestas, ${dataset.questions.reduce((s, q) => s + q.positives.length, 0)} positivos, ${dataset.questions.reduce((s, q) => s + q.hardNegatives.length, 0)} negativos difíciles).`,
    `Métodos evaluados en esta corrida: ${methodSet.join(", ")}.`,
    "",
    ...sections,
  ].join("\n\n");
}

function writeReport(methodSet: string[], report: string): string {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const fileName = `${methodSet.join("-")}-${timestampTag()}.md`;
  const outPath = `${RESULTS_DIR}/${fileName}`;
  writeFileSync(outPath, report);
  return outPath;
}

describe("evaluación de detección de copia entre alumnos", () => {
  it(
    "corre el pipeline y escribe el reporte",
    { timeout: 20 * 60 * 1000 },
    async () => {
      const dataset = loadDataset(DATASET_PATH);
      expect(dataset.questions.length).toBe(6);

      const methodSet = ["fragmentos", "prefiltro", "cerradas"];
      const { markdown: fragmentsMd, findingsByQuestion } = evaluateFragments(dataset);
      const prefilterMd = evaluatePrefilter(dataset, findingsByQuestion);
      const closedMd = evaluateClosedSim();
      const sections = [fragmentsMd, prefilterMd, closedMd];

      let jevPerPairBase = new Map<string, JevResult>();
      if (process.env.EVAL_JEV === "1") {
        methodSet.push("jev");
        const jevResult = await evaluateJev(dataset);
        sections.push(jevResult.markdown);
        jevPerPairBase = jevResult.perPairBase;
      }

      if (process.env.EVAL_LLM === "1") {
        methodSet.push("llm");
        sections.push(await evaluateLlmJudge(dataset, jevPerPairBase));
      }

      const report = buildReport(dataset, methodSet, sections);
      const outPath = writeReport(methodSet, report);
      console.log(report);
      console.log(`\n[eval] reporte escrito en ${outPath}`);
    },
  );
});
