/**
 * Ajustes de lectura para la evaluación.
 *
 * Qué ayuda de verdad, según la evidencia:
 *
 * - **Espaciado entre letras: sí.** Es la intervención con mejor respaldo.
 *   Zorzi et al. (PNAS, 2012) midió chicos con dislexia leyendo 20% más rápido
 *   y con la mitad de errores solo separando las letras, sin ningún
 *   entrenamiento previo. La explicación es el apiñamiento: las letras muy
 *   juntas se interfieren entre sí al reconocerlas.
 * - **Fuentes "para dislexia": no.** Un metaanálisis de 15 estudios (N = 688)
 *   no encontró efecto sobre velocidad ni precisión, y un estudio de 2017
 *   midió OpenDyslexic más lenta que Arial. Por eso acá no hay ninguna.
 * - **Filtros de color: no como tratamiento.** Las revisiones sistemáticas no
 *   encontraron evidencia confiable y atribuyen las mejoras al efecto placebo.
 *   El tono de fondo se ofrece igual, pero como comodidad ante el brillo —que
 *   es un motivo legítimo—, nunca presentado como que corrige la dislexia.
 *
 * Los mínimos de cada escala salen del criterio 1.4.12 (Espaciado del texto)
 * de WCAG 2.2: interlineado 1.5, entre letras 0.12, entre palabras 0.16.
 */

export const WCAG_MINIMO = { interlineado: 1.5, letras: 0.12, palabras: 0.16 } as const;

export interface ReadingOption<T> {
  id: string;
  label: string;
  value: T;
  /** Se muestra al alumno para que entienda qué está eligiendo. */
  hint?: string;
}

/** El primer valor de cada escala deja la evaluación como estaba. */
export const readingScales = {
  texto: [
    { id: "normal", label: "Normal", value: 1 },
    { id: "grande", label: "Grande", value: 1.15 },
    { id: "mas-grande", label: "Más grande", value: 1.3 },
    { id: "maximo", label: "Máximo", value: 1.5 },
  ] as ReadingOption<number>[],
  interlineado: [
    { id: "normal", label: "Normal", value: 1.6 },
    { id: "amplio", label: "Amplio", value: 1.8 },
    { id: "muy-amplio", label: "Muy amplio", value: 2.1 },
  ] as ReadingOption<number>[],
  letras: [
    { id: "normal", label: "Normal", value: 0 },
    { id: "separadas", label: "Separadas", value: WCAG_MINIMO.letras, hint: "Ayuda a que no se mezclen entre sí" },
    { id: "muy-separadas", label: "Muy separadas", value: 0.18 },
  ] as ReadingOption<number>[],
  palabras: [
    { id: "normal", label: "Normal", value: 0 },
    { id: "separadas", label: "Separadas", value: WCAG_MINIMO.palabras },
  ] as ReadingOption<number>[],
  fondo: [
    { id: "papel", label: "Blanco", value: "#ffffff" },
    { id: "crema", label: "Crema", value: "#fbf6ec", hint: "Baja el brillo de la pantalla" },
    { id: "gris", label: "Gris suave", value: "#f2f3f5" },
    { id: "azulado", label: "Azulado", value: "#eef4fb" },
  ] as ReadingOption<string>[],
} as const;

export type ReadingScale = keyof typeof readingScales;

export type ReadingSettings = Record<ReadingScale, string>;

export const defaultReadingSettings: ReadingSettings = {
  texto: "normal",
  interlineado: "normal",
  letras: "normal",
  palabras: "normal",
  fondo: "papel",
};

/** Un id desconocido —ajuste viejo, guardado a mano— vuelve al de por defecto. */
export function optionFor<K extends ReadingScale>(scale: K, id: string) {
  const options = readingScales[scale] as ReadingOption<number | string>[];
  return options.find((option) => option.id === id) ?? options[0];
}

/** Las variables que consume el CSS. Nunca devuelve por debajo del piso WCAG. */
export function readingStyle(settings: ReadingSettings): Record<string, string> {
  const interlineado = Math.max(Number(optionFor("interlineado", settings.interlineado).value), WCAG_MINIMO.interlineado);
  return {
    "--lectura-escala": String(optionFor("texto", settings.texto).value),
    "--lectura-interlineado": String(interlineado),
    "--lectura-letras": `${optionFor("letras", settings.letras).value}em`,
    "--lectura-palabras": `${optionFor("palabras", settings.palabras).value}em`,
    "--lectura-fondo": String(optionFor("fondo", settings.fondo).value),
  };
}

/** true cuando el alumno se movió de los valores originales. */
export function isAdjusted(settings: ReadingSettings): boolean {
  return (Object.keys(defaultReadingSettings) as ReadingScale[]).some((scale) => settings[scale] !== defaultReadingSettings[scale]);
}

/**
 * Lo guardado puede venir de cualquier lado: una versión anterior, otra
 * pestaña, o alguien editando el almacenamiento a mano. Se acepta lo que sirve
 * y el resto vuelve al valor por defecto, sin tirar nada.
 */
export function parseReadingSettings(raw: unknown): ReadingSettings {
  const source = typeof raw === "string" ? safeParse(raw) : raw;
  if (!source || typeof source !== "object") return { ...defaultReadingSettings };
  const stored = source as Record<string, unknown>;
  const settings = { ...defaultReadingSettings };
  for (const scale of Object.keys(defaultReadingSettings) as ReadingScale[]) {
    const id = stored[scale];
    if (typeof id !== "string") continue;
    const options = readingScales[scale] as ReadingOption<number | string>[];
    if (options.some((option) => option.id === id)) settings[scale] = id;
  }
  return settings;
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export const READING_STORAGE_KEY = "testra:lectura";
