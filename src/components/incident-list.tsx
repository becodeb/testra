import { Clock3, Eye, ShieldAlert } from "lucide-react";
import { clipboardDetail, copyForIncident } from "@/lib/incident-copy";

export interface Incident {
  id: string;
  at: number;
  duration_ms: number;
  type: string;
  source: string;
  questionNumber: number | null;
  questionPrompt: string | null;
  meta?: Record<string, unknown>;
}

const dateFormatter = new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" });

export const incidentLabels: Record<string, string> = {
  "manipulacion-de-supervision": "Alteró la supervisión desde el navegador",
  "cambio-de-pestana": "Cambió de pestaña o ventana",
  "ventana-sin-foco": "La ventana perdió el foco",
  "atajo-copiar-pegar": "Usó copiar, cortar o pegar",
  "salida-pantalla-completa": "Salió de pantalla completa",
  "sesion-duplicada": "Se abrió otra sesión",
  "cambio-ip": "Cambió de red o conexión",
  "cambio-user-agent": "Cambió de navegador o dispositivo",
  "cadencia-respuestas": "Respondió varias preguntas muy seguidas",
  "ritmo-desarrollo": "Respondió desarrollos muy rápido",
  desconexion: "Se interrumpió la conexión",
  "cierre-pestana": "Cerró o recargó la pestaña",
};

/**
 * Las señales de que el alumno salió de la pantalla son, de lejos, las más
 * numerosas: una evaluación larga junta decenas. Puestas en la misma lista que
 * el resto lo tapan, y lo que se pierde es justamente lo que menos se repite y
 * más dice. Por eso van en su propio bloque, después.
 */
const SALIDA_DE_PANTALLA = new Set([
  "cambio-de-pestana",
  "ventana-sin-foco",
  "salida-pantalla-completa",
  "cierre-pestana",
]);
const RITMO_DE_RESOLUCION = new Set(["cadencia-respuestas", "ritmo-desarrollo"]);

function IncidentCard({ incident }: { incident: Incident }) {
  const copy = copyForIncident(incident.type);
  return (
    <article className="rounded-md border p-4">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-ink">{copy.title}</p>
          <p className="mt-1 text-xs text-muted">
            {dateFormatter.format(incident.at)}
            {incident.duration_ms ? ` · ${(incident.duration_ms / 1000).toLocaleString("es-AR", { maximumFractionDigits: 1 })} s` : ""}
          </p>
          {incident.type === "atajo-copiar-pegar" && clipboardDetail(incident.meta)
            ? <p className="mt-1 text-xs font-medium text-ink-2">{clipboardDetail(incident.meta)}</p>
            : null}
          <p className="mt-2 text-sm text-ink-2">
            {incident.questionNumber
              ? `Estaba en la pregunta ${incident.questionNumber}: ${incident.questionPrompt}`
              : "No hay pregunta asociada (registro anterior a esta mejora o alumno fuera de una pregunta)."}
          </p>
          <p className="mt-2 text-sm leading-6 text-ink-2">{copy.what} <span className="text-muted">{copy.normal}</span></p>
          <p className="mt-2 text-xs font-medium text-brand-deep">Qué conviene revisar: {copy.review}</p>
          <details className="mt-2 text-xs text-muted"><summary className="cursor-pointer font-medium">Ver detalle técnico</summary><p className="mt-1">Tipo interno: {incident.type} · origen: {incident.source === "server" ? "servidor" : "navegador"}</p></details>
        </div>
      </div>
    </article>
  );
}

function Resumen({ incidents }: { incidents: Incident[] }) {
  const porTipo = new Map<string, number>();
  for (const incident of incidents) porTipo.set(incident.type, (porTipo.get(incident.type) ?? 0) + 1);
  const ordenados = [...porTipo.entries()].sort((a, b) => b[1] - a[1]);
  return (
    <ul className="mt-3 flex flex-wrap gap-2">
      {ordenados.map(([type, count]) => (
        <li key={type} className="rounded-sm border bg-inset px-2 py-1 text-xs text-ink-2">
          {copyForIncident(type).title}
          <span className="mono-number ms-1.5 font-semibold text-ink">{count}</span>
        </li>
      ))}
    </ul>
  );
}

export function IncidentList({ incidents }: { incidents: Incident[] }) {
  if (!incidents.length) {
    return <p className="rounded-md bg-inset p-4 text-sm text-muted">No se registraron avisos.</p>;
  }

  const salida = incidents.filter((incident) => SALIDA_DE_PANTALLA.has(incident.type));
  const ritmo = incidents.filter((incident) => RITMO_DE_RESOLUCION.has(incident.type));
  const resto = incidents.filter((incident) => !SALIDA_DE_PANTALLA.has(incident.type) && !RITMO_DE_RESOLUCION.has(incident.type));

  return (
    <div className="mt-3 space-y-5">
      <Resumen incidents={incidents} />

      {resto.length ? (
        <section aria-labelledby="avisos-otros">
          <h4 id="avisos-otros" className="text-sm font-semibold text-ink-2">
            Otras señales <span className="mono-number font-normal text-muted">({resto.length})</span>
          </h4>
          <div className="mt-2 space-y-2">
            {resto.map((incident) => <IncidentCard incident={incident} key={incident.id} />)}
          </div>
        </section>
      ) : null}

      {salida.length ? (
        <section aria-labelledby="avisos-salida">
          <h4 id="avisos-salida" className="flex items-center gap-2 text-sm font-semibold text-ink-2">
            <Eye className="size-4 text-muted" aria-hidden="true" />
            Salidas de la pantalla <span className="mono-number font-normal text-muted">({salida.length})</span>
          </h4>
          <p className="mt-1 text-xs text-muted">Cambios de pestaña, pérdidas de foco y recargas. Suelen ser muchas y no significan nada por sí solas.</p>
          <div className="mt-2 space-y-2">
            {salida.map((incident) => <IncidentCard incident={incident} key={incident.id} />)}
          </div>
        </section>
      ) : null}

      {ritmo.length ? (
        <section aria-labelledby="avisos-ritmo">
          <h4 id="avisos-ritmo" className="flex items-center gap-2 text-sm font-semibold text-ink-2">
            <Clock3 className="size-4 text-muted" aria-hidden="true" />
            Ritmo de resolución <span className="mono-number font-normal text-muted">({ritmo.length})</span>
          </h4>
          <p className="mt-1 text-xs text-muted">Es contexto de corrección, no una señal de integridad ni una prueba de copia.</p>
          <div className="mt-2 space-y-2">{ritmo.map((incident) => <IncidentCard incident={incident} key={incident.id} />)}</div>
        </section>
      ) : null}
    </div>
  );
}
