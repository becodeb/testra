import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Type } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  READING_STORAGE_KEY,
  defaultReadingSettings,
  isAdjusted,
  parseReadingSettings,
  readingScales,
  readingStyle,
  type ReadingScale,
  type ReadingSettings,
} from "@/lib/reading-settings";

const GROUPS: Array<{ scale: ReadingScale; legend: string }> = [
  { scale: "texto", legend: "Tamaño del texto" },
  { scale: "interlineado", legend: "Separación entre renglones" },
  { scale: "letras", legend: "Separación entre letras" },
  { scale: "palabras", legend: "Separación entre palabras" },
  { scale: "fondo", legend: "Color del fondo" },
];

/**
 * Los ajustes viven en el navegador del alumno y no viajan al servidor. Eso no
 * es una limitación sino la parte importante: nadie más ve quién los usa, así
 * que tenerlos activados no señala a nadie frente al curso.
 */
export function useReadingSettings() {
  const [settings, setSettings] = useState<ReadingSettings>(() => {
    if (typeof window === "undefined") return { ...defaultReadingSettings };
    try {
      return parseReadingSettings(window.localStorage.getItem(READING_STORAGE_KEY));
    } catch {
      // Modo privado o almacenamiento bloqueado: se rinde igual, sin ajustes.
      return { ...defaultReadingSettings };
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(READING_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Que no se pueda recordar la preferencia no puede cortar la evaluación.
    }
  }, [settings]);

  return [settings, setSettings] as const;
}

export { readingStyle };

export const READING_PANEL_ID = "ajustes-de-lectura";

/** El botón vive en el encabezado y el panel se despliega debajo, a lo ancho. */
export function ReadingSettingsToggle({ settings, open, onToggle }: { settings: ReadingSettings; open: boolean; onToggle: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-expanded={open}
      aria-controls={READING_PANEL_ID}
      onClick={onToggle}
      data-reading-toggle
    >
      <Type data-icon="inline-start" aria-hidden="true" />
      Lectura
      {isAdjusted(settings) ? <span className="ml-1.5 size-1.5 rounded-full bg-brand" aria-label="con ajustes" /> : null}
    </Button>
  );
}

interface ReadingSettingsPanelProps {
  settings: ReadingSettings;
  open: boolean;
  onChange: (settings: ReadingSettings) => void;
}

export function ReadingSettingsPanel({ settings, open, onChange }: ReadingSettingsPanelProps) {
  const panelId = READING_PANEL_ID;
  const ajustado = isAdjusted(settings);

  const pick = useCallback((scale: ReadingScale, id: string) => {
    onChange({ ...settings, [scale]: id });
  }, [onChange, settings]);

  return (
    <>
      <div
        id={panelId}
        hidden={!open}
        data-reading-panel
        className="mt-3 w-full rounded-lg border bg-inset p-4"
      >
        <p className="text-sm text-ink-2">
          Acomodá el texto para leerlo más cómodo. Sólo cambia cómo lo ves vos: no modifica la evaluación,
          no se avisa a nadie y no cuenta como un aviso de supervisión.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {GROUPS.map(({ scale, legend }) => (
            <fieldset key={scale} className="min-w-0">
              <legend className="text-xs font-semibold tracking-[.06em] text-ink-2 uppercase">{legend}</legend>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(readingScales[scale] as Array<{ id: string; label: string; hint?: string }>).map((option) => (
                  <label key={option.id} className="cursor-pointer" title={option.hint}>
                    <input
                      type="radio"
                      name={`${panelId}-${scale}`}
                      value={option.id}
                      checked={settings[scale] === option.id}
                      onChange={() => pick(scale, option.id)}
                      className="peer sr-only"
                    />
                    <span className="inline-block rounded-md border bg-paper px-2.5 py-1.5 text-sm text-ink-2 transition-colors peer-checked:border-brand peer-checked:bg-brand-soft peer-checked:font-semibold peer-checked:text-brand-deep peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-1">
                      {option.label}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between gap-3 border-t pt-3">
          <p className="text-xs text-ink-2">Se recuerda en este dispositivo.</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!ajustado}
            onClick={() => onChange({ ...defaultReadingSettings })}
          >
            <RotateCcw data-icon="inline-start" aria-hidden="true" />
            Restablecer
          </Button>
        </div>
      </div>
    </>
  );
}
