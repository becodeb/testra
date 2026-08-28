import { useEffect, useMemo, useState } from "react";
import { BookOpen, ExternalLink, RefreshCw, Search, Send } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const CLASSROOM_SCOPES = [
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.rosters.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.students",
] as const;

interface ClassroomPanelProps { runId: string; linked: boolean; ended: boolean }
interface Course { id: string; name: string; section?: string }
interface GradeRow { name: string; email: string | null; grade: number; pendingManual: number; submissionState: string | null; canSend: boolean; linked: boolean; matchMethod: "google_id" | "email" | "name" | null }

export function ClassroomPanel({ runId, linked: initialLinked, ended }: ClassroomPanelProps) {
  const [linked, setLinked] = useState(initialLinked);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState("");
  const [grades, setGrades] = useState<GradeRow[] | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [listaAbierta, setListaAbierta] = useState(false);

  // Un docente con veinte cursos no encuentra el suyo en un desplegable nativo,
  // asi que se filtra por nombre y por seccion mientras escribe.
  const cursosFiltrados = useMemo(() => {
    const termino = busqueda.trim().toLocaleLowerCase();
    if (!termino) return courses;
    return courses.filter((course) =>
      `${course.name} ${course.section ?? ""}`.toLocaleLowerCase().includes(termino),
    );
  }, [busqueda, courses]);
  const cursoElegido = courses.find((course) => course.id === courseId) ?? null;

  async function connect() {
    setLoading(true);
    await authClient.linkSocial({
      provider: "google",
      callbackURL: `${window.location.pathname}?classroom=connected`,
      scopes: [...CLASSROOM_SCOPES],
    });
    setLoading(false);
  }

  async function loadCourses() {
    setLoading(true);
    setMessage("");
    const response = await fetch("/api/classroom/courses");
    const body = await response.json() as { courses?: Course[]; error?: string };
    if (response.ok) {
      setCourses(body.courses ?? []);
      setCourseId(body.courses?.[0]?.id ?? "");
      if (!body.courses?.length) setMessage("Google no devolvió cursos activos para esta cuenta docente.");
    } else setMessage(body.error ?? "No se pudieron cargar los cursos");
    setLoading(false);
  }

  async function publish() {
    setLoading(true);
    const response = await fetch("/api/classroom/publish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId, courseId }) });
    const body = await response.json() as { studentCount?: number; joinedBeforeLink?: number; error?: string };
    if (response.ok) {
      setLinked(true);
      setMessage(`Tarea publicada. Se cargó la lista de ${body.studentCount ?? 0} alumnos.${body.joinedBeforeLink ? ` ${body.joinedBeforeLink} ya habían ingresado: en esta toma no verán el campo de correo; publicá Classroom antes de abrir la sala para exigir esa validación.` : ""}`);
    } else setMessage(body.error ?? "No se pudo publicar la tarea");
    setLoading(false);
  }

  async function loadGrades() {
    setLoading(true);
    const response = await fetch(`/api/classroom/grades?runId=${encodeURIComponent(runId)}`);
    const body = await response.json() as { rows?: GradeRow[]; error?: string };
    if (response.ok) setGrades(body.rows ?? []);
    else setMessage(body.error ?? "No se pudo preparar el envío");
    setLoading(false);
  }

  async function sendGrades() {
    setLoading(true);
    const response = await fetch("/api/classroom/grades", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId, confirmed: true }) });
    const body = await response.json() as { sent?: number; unlinked?: Array<{ name: string }>; pending?: string[]; awaitingTurnIn?: string[]; failures?: Array<{ name: string; reason: string }>; error?: string };
    setMessage(response.ok
      ? `Classroom: ${body.sent ?? 0} notas devueltas · ${body.awaitingTurnIn?.length ?? 0} esperan que el alumno entregue · ${body.unlinked?.length ?? 0} alumnos sin vincular · ${body.failures?.length ?? 0} errores${body.pending?.length ? ` · ${body.pending.length} pendientes de corrección` : ""}.`
      : body.error ?? "No se pudieron enviar las notas");
    setLoading(false);
  }

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("classroom") === "connected" && !linked) {
      window.history.replaceState(null, "", window.location.pathname);
      void loadCourses();
    }
  }, [linked]);

  useEffect(() => { if (linked && ended) void loadGrades(); }, [ended, linked]);

  return (
    <section className="rounded-lg border bg-paper p-5 shadow-card" aria-labelledby="classroom-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-semibold tracking-[.08em] text-muted uppercase">Integración opcional</p><h2 id="classroom-title" className="mt-1 flex items-center gap-2 font-semibold text-ink"><BookOpen className="size-4 text-brand" aria-hidden="true" />Google Classroom</h2><p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">Publicá un enlace a esta evaluación y cargá automáticamente la lista de alumnos.</p></div>
        {!linked ? <div className="flex gap-2"><Button type="button" variant="outline" disabled={loading} onClick={() => void connect()}><ExternalLink data-icon="inline-start" />Autorizar Google</Button><Button type="button" disabled={loading} onClick={() => void loadCourses()}><RefreshCw data-icon="inline-start" />Cargar cursos</Button></div> : <span className="rounded-sm border border-ok/25 px-2 py-1 text-xs font-semibold text-ok">Vinculada</span>}
      </div>
      {message ? <p className="mt-4 rounded-md bg-inset px-3 py-2 text-sm text-ink-2" role="status">{message}</p> : null}
      {!linked && courses.length ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div className="min-w-0">
            <label htmlFor="classroom-course" className="text-sm font-semibold text-ink-2">
              Curso <span className="font-normal text-muted">· {courses.length} disponible{courses.length === 1 ? "" : "s"}</span>
            </label>
            <div className="relative mt-1.5">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
              <Input
                id="classroom-course"
                role="combobox"
                aria-expanded={listaAbierta}
                aria-controls="classroom-course-list"
                autoComplete="off"
                className="ps-9"
                placeholder="Buscá tu curso por nombre"
                value={listaAbierta ? busqueda : cursoElegido ? `${cursoElegido.name}${cursoElegido.section ? ` · ${cursoElegido.section}` : ""}` : ""}
                onFocus={() => { setListaAbierta(true); setBusqueda(""); }}
                onChange={(event) => { setBusqueda(event.target.value); setListaAbierta(true); }}
                onBlur={() => window.setTimeout(() => setListaAbierta(false), 120)}
                onKeyDown={(event) => { if (event.key === "Escape") setListaAbierta(false); }}
              />
              {listaAbierta ? (
                <ul
                  id="classroom-course-list"
                  role="listbox"
                  className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-paper py-1 shadow-card"
                >
                  {cursosFiltrados.map((course) => (
                    <li key={course.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={course.id === courseId}
                        className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors ${course.id === courseId ? "bg-brand-soft text-brand-deep" : "hover:bg-canvas"}`}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => { setCourseId(course.id); setListaAbierta(false); setBusqueda(""); }}
                      >
                        <span className="w-full truncate text-sm font-semibold">{course.name}</span>
                        {course.section ? <span className="w-full truncate text-xs text-muted">{course.section}</span> : null}
                      </button>
                    </li>
                  ))}
                  {!cursosFiltrados.length ? (
                    <li className="px-3 py-4 text-center text-sm text-muted">Ningún curso coincide con «{busqueda}».</li>
                  ) : null}
                </ul>
              ) : null}
            </div>
          </div>
          <Button type="button" disabled={!courseId || loading} onClick={() => void publish()}>Publicar tarea</Button>
        </div>
      ) : null}
      {linked && ended && grades ? <div className="mt-5"><div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-inset text-xs"><tr><th className="px-3 py-2">Alumno</th><th className="px-3 py-2 text-right">Nota</th><th className="px-3 py-2">Vínculo</th><th className="px-3 py-2">Resultado</th></tr></thead><tbody className="divide-y">{grades.map((row, index) => <tr key={`${row.email ?? row.name}:${index}`}><th scope="row" className="px-3 py-2.5 font-medium">{row.name}<span className="mt-0.5 block text-xs font-normal text-muted">{row.email ?? "Rindió como invitado"}</span></th><td className="mono-number px-3 py-2.5 text-right">{row.grade}</td><td className="px-3 py-2.5 text-xs">{row.linked ? row.matchMethod === "google_id" ? "Cuenta de Google" : row.matchMethod === "email" ? "Correo verificado" : "Nombre único" : "Sin vincular"}</td><td className="px-3 py-2.5 text-xs">{row.canSend ? "Lista para devolver" : row.pendingManual ? "Falta corrección manual" : !row.linked ? "No hay una coincidencia segura" : row.submissionState ? "Entrega no disponible" : "No se encontró la entrega"}</td></tr>)}</tbody></table></div><div className="mt-3 flex items-center justify-between gap-3"><p className="text-xs text-muted">Testra usa nombres sólo cuando el roster deja una coincidencia única. Las notas se envían sólo después de tu confirmación.</p><Button type="button" disabled={loading || !grades.some((row) => row.canSend)} onClick={() => void sendGrades()}><Send data-icon="inline-start" />Enviar notas a Classroom</Button></div></div> : null}
    </section>
  );
}
