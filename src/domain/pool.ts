import type { FullQuestion } from "./exam";

// Sorteo de preguntas por alumno. Vive en el dominio y no en repository.ts para
// que se pueda probar sin abrir una conexion a Postgres: es la logica de la que
// depende que dos alumnos sentados juntos no reciban la misma evaluacion.
//
// Todo acá es deterministico: la misma semilla da siempre el mismo resultado,
// asi que corregir y mostrar respuestas puede recalcular lo que vio el alumno
// sin guardar nada extra.

export function seededShuffle<T>(source: T[], seed: string): T[] {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  const next = [...source];
  for (let index = next.length - 1; index > 0; index -= 1) {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    const random = ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    const target = Math.floor(random * (index + 1));
    [next[index], next[target]] = [next[target], next[index]];
  }
  return next;
}

/**
 * Elige las preguntas que recibe un alumno garantizando la cuota de desarrollo.
 *
 * Un sorteo plano sobre el pozo puede dejar a un alumno sin ninguna pregunta
 * para justificar por escrito y a otro con seis. Aca se sortea por separado el
 * grupo de desarrollo y el resto, y despues se arma el conjunto final. Si el
 * pozo no tiene suficientes de desarrollo se toman las que haya y se completa
 * con el resto, sin devolver nunca menos preguntas de las pedidas.
 */
export function elegirSubconjunto(
  questions: FullQuestion[],
  seed: string,
  total: number,
  longToServe: number,
): FullQuestion[] {
  const desarrollo = questions.filter((question) => question.type === "long");
  const resto = questions.filter((question) => question.type !== "long");

  const cuotaDesarrollo = Math.max(0, Math.min(longToServe, desarrollo.length, total));
  const elegidasDesarrollo = seededShuffle(desarrollo, `${seed}:pool:long`).slice(0, cuotaDesarrollo);
  const elegidasResto = seededShuffle(resto, `${seed}:pool:resto`).slice(0, total - cuotaDesarrollo);

  // Si el resto no alcanza para llenar el cupo, se completa con mas de desarrollo.
  const faltan = total - elegidasDesarrollo.length - elegidasResto.length;
  const relleno = faltan > 0
    ? desarrollo.filter((q) => !elegidasDesarrollo.includes(q)).slice(0, faltan)
    : [];

  return [...elegidasDesarrollo, ...elegidasResto, ...relleno];
}

/**
 * Sorteo por secciones: sirve exactamente la cantidad pedida de cada una.
 *
 * Con 15 preguntas cargadas en cada seccion y una cuota de 2 de X, 4 de Y y 4
 * de Z, cada alumno recibe esas diez, distintas de las de su companero. Si una
 * seccion tiene menos preguntas que las pedidas se sirven todas las que haya:
 * es preferible una evaluacion mas corta que una que no se puede rendir.
 *
 * Las preguntas sin seccion, y las de secciones sin cuota, quedan afuera. Es
 * deliberado: cuando el docente define la composicion, la define entera.
 */
export function elegirPorSecciones(
  questions: FullQuestion[],
  seed: string,
  quotas: Record<string, number>,
): FullQuestion[] {
  const elegidas: FullQuestion[] = [];
  // Se recorre en orden alfabetico y no en el del objeto para que el resultado
  // no dependa de en que orden el docente creo las secciones.
  for (const section of Object.keys(quotas).sort()) {
    const cupo = quotas[section];
    if (cupo <= 0) continue;
    const disponibles = questions.filter((question) => (question.section ?? "") === section);
    elegidas.push(...seededShuffle(disponibles, `${seed}:seccion:${section}`).slice(0, cupo));
  }
  return elegidas;
}

export function hayCuotasDeSeccion(quotas: Record<string, number>): boolean {
  return Object.values(quotas).some((cupo) => cupo > 0);
}

/** Cuenta cuantas preguntas hay cargadas en cada seccion. */
export function contarPorSeccion(questions: FullQuestion[]): Map<string, number> {
  const total = new Map<string, number>();
  for (const question of questions) {
    const section = question.section ?? "";
    if (!section) continue;
    total.set(section, (total.get(section) ?? 0) + 1);
  }
  return total;
}

export function personalizeQuestions(
  source: FullQuestion[],
  seed: string,
  shuffleQuestions: boolean,
  shuffleOptions: boolean,
  questionsToServe?: number | null,
  longToServe = 2,
  sectionQuotas: Record<string, number> = {},
): FullQuestion[] {
  const questions = structuredClone(source);
  // El subconjunto se sortea siempre por alumno, aunque el docente no haya
  // pedido mezclar: es justamente lo que evita que dos alumnos reciban las
  // mismas preguntas.
  const pool = hayCuotasDeSeccion(sectionQuotas)
    ? elegirPorSecciones(questions, seed, sectionQuotas)
    : questionsToServe && questionsToServe > 0 && questionsToServe < questions.length
      ? elegirSubconjunto(questions, seed, questionsToServe, longToServe)
      : questions;

  const ordered = shuffleQuestions ? seededShuffle(pool, `${seed}:questions`) : pool;
  return ordered.map((question, position) => {
    const next = { ...question, position } as FullQuestion;
    if (shuffleOptions && (next.type === "mc" || next.type === "ms")) {
      next.config.options = seededShuffle(next.config.options, `${seed}:${next.id}:options`);
    }
    return next;
  });
}
