import { useEffect, useState } from "react";
import { BookOpen, ExternalLink, RefreshCw, Send } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

const CLASSROOM_SCOPES = [
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.rosters.readonly",
  "https://www.googleapis.com/auth/classroom.coursework.students",
] as const;

interface ClassroomPanelProps { runId: string; linked: boolean; ended: boolean }
interface Course { id: string; name: string; section?: string }
interface GradeRow { name: string; email: string | null; grade: number; pendingManual: number; submissionState: string | null; canSend: boolean; linked: boolean; matchMethod: "google_id" | "email" | null }

export function ClassroomPanel({ runId, linked: initialLinked, ended }: ClassroomPanelProps) {
  const [linked, setLinked] = useState(initialLinked);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState("");
  const [grades, setGrades] = useState<GradeRow[] | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

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
    const body = await response.json() as { studentCount?: number; error?: string };
    if (response.ok) {
      setLinked(true);
      setMessage(`Tarea publicada. Se cargó la lista de ${body.studentCount ?? 0} alumnos.`);
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
    const body = await response.json() as { sent?: number; unlinked?: Array<{ name: string }>; pending?: string[]; failures?: Array<{ name: string; reason: string }>; error?: string };
    setMessage(response.ok
      ? `Classroom: ${body.sent ?? 0} notas devueltas · ${body.unlinked?.length ?? 0} alumnos sin vincular · ${body.failures?.length ?? 0} errores${body.pending?.length ? ` · ${body.pending.length} pendientes de corrección` : ""}.`
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
      {!linked && courses.length ? <div className="mt-4 flex flex-wrap items-end gap-2"><label className="flex min-w-64 flex-1 flex-col gap-1.5 text-sm font-semibold text-ink-2">Curso<select value={courseId} onChange={(event) => setCourseId(event.target.value)} className="h-9 rounded-md border bg-white px-3 font-normal">{courses.map((course) => <option value={course.id} key={course.id}>{course.name}{course.section ? ` · ${course.section}` : ""}</option>)}</select></label><Button type="button" disabled={!courseId || loading} onClick={() => void publish()}>Publicar tarea</Button></div> : null}
      {linked && ended && grades ? <div className="mt-5"><div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-inset text-xs"><tr><th className="px-3 py-2">Alumno</th><th className="px-3 py-2 text-right">Nota</th><th className="px-3 py-2">Vínculo</th><th className="px-3 py-2">Resultado</th></tr></thead><tbody className="divide-y">{grades.map((row, index) => <tr key={`${row.email ?? row.name}:${index}`}><th scope="row" className="px-3 py-2.5 font-medium">{row.name}<span className="mt-0.5 block text-xs font-normal text-muted">{row.email ?? "Rindió como invitado"}</span></th><td className="mono-number px-3 py-2.5 text-right">{row.grade}</td><td className="px-3 py-2.5 text-xs">{row.linked ? row.matchMethod === "google_id" ? "Cuenta de Google" : "Correo verificado" : "Sin vincular"}</td><td className="px-3 py-2.5 text-xs">{row.canSend ? "Lista para devolver" : row.pendingManual ? "Falta corrección manual" : !row.linked ? "No hay una coincidencia segura" : row.submissionState ? "Entrega no disponible" : "No se encontró la entrega"}</td></tr>)}</tbody></table></div><div className="mt-3 flex items-center justify-between gap-3"><p className="text-xs text-muted">Testra nunca vincula notas por nombre. Las notas se envían sólo después de tu confirmación.</p><Button type="button" disabled={loading || !grades.some((row) => row.canSend)} onClick={() => void sendGrades()}><Send data-icon="inline-start" />Enviar notas a Classroom</Button></div></div> : null}
    </section>
  );
}
