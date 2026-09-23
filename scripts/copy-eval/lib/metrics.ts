// Utilidades estadísticas genéricas para el harness de evaluación de copia.
// Nada acá sabe de copia, de Jev ni del dataset: son primitivas chicas que se
// reusan en las cinco medidas de `evaluate.eval.ts`.

export interface ConfusionCounts {
  tp: number;
  fp: number;
  fn: number;
}

export function precisionRecall({ tp, fp, fn }: ConfusionCounts): { precision: number | null; recall: number | null } {
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  return { precision, recall };
}

/** `p` en 0-100. Método "nearest rank", simple y suficiente para reportar p50/p95 de latencias chicas. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function max(values: number[]): number | null {
  return values.length ? Math.max(...values) : null;
}

/**
 * ROC-AUC vía el estadístico U de Mann-Whitney (equivalente a integrar la
 * curva ROC, sin tener que barrer umbrales a mano). Empates se resuelven con
 * el rank promedio, como es estándar.
 */
export function rocAuc(scores: Array<{ score: number; label: 0 | 1 }>): number | null {
  const positives = scores.filter((s) => s.label === 1).length;
  const negatives = scores.filter((s) => s.label === 0).length;
  if (!positives || !negatives) return null;

  const sorted = [...scores].sort((a, b) => a.score - b.score);
  const ranks = new Array<number>(sorted.length);
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length && sorted[j].score === sorted[i].score) j += 1;
    const avgRank = (i + 1 + j) / 2; // suma de rangos (i+1..j) sobre (j-i) posiciones empatadas
    for (let k = i; k < j; k += 1) ranks[k] = avgRank;
    i = j;
  }
  let sumRanksPositive = 0;
  sorted.forEach((item, idx) => {
    if (item.label === 1) sumRanksPositive += ranks[idx];
  });
  const u = sumRanksPositive - (positives * (positives + 1)) / 2;
  return u / (positives * negatives);
}

// PRNG determinístico chiquito (mulberry32 + hash FNV-like de la semilla en
// texto), el mismo patrón que ya usan `scripts/copy-eval/generate.mjs` y
// `src/domain/pool.ts`. Se reimplementa acá en vez de importar el generador
// (que no exporta el PRNG) o `seededShuffle` de dominio (da un shuffle, no un
// float 0-1 para la simulación de habilidad/dificultad).
export function hashStringToInt(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededRng(seed: string): () => number {
  return mulberry32(hashStringToInt(seed));
}

/** Box-Muller simple para muestrear ~N(0,1); usado por la simulación de habilidad/dificultad. */
export function nextGaussian(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
