import { useEffect, useState } from "react";
import { BookOpen, ExternalLink, Send } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

const CLASSROOM_SCOPES = [
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.rosters.readonly",
  "https://www.googleapis.com/auth/classroom.profile.emails",
  "https://www.googleapis.com/auth/classroom.coursework.students",
] as const;

interface ClassroomPanelProps {
  runId: string;
  linked: boolean;
  ended: boolean;
}

interface Course { id: string; name: string; section?: string }
interface GradeRow { name: string; email: string; grade: number; pendingManual: number; submissionState: string | null; canSend: boolean }

export function ClassroomPanel({ runId, linked: initialLinked, ended }: ClassroomPanelProps) {
  const [linked, setLinked] = useState(initialLinked);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState("");
  const [grades, setGrades] = useState<GradeRow[] | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function connect() {
    setLoading(true);
    await authClient.signIn.social({
      provider: "google",
      callbackURL: window.location.pathname,
      scopes: [...CLASSROOM_SCOPES],
    });
    setLoading(false);
  }

  async function loadCourses() {
    setLoading(true);
    const response = await fetch("/api/classroom/courses");
    const body = await response.json() as { courses?: Course[]; error?: string };
    if (response.ok) {
      setCourses(body.courses ?? []);
      setCourseId(body.courses?.[0]?.id ?? "");
    } else setMessage(body.error ?? "No se pudieron cargar los cursos");
    setLoading(false);
  }

  async function publish() {
    setLoading(true);
    const response = await fetch("/api/classroom/publish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId, courseId }) });
    const body = await response.json() as { studentCount?: number; error?: string };
    if (response.ok) { setLinked(true); setMessage(`Tarea publicada. Se cargó el roster de ${body.studentCount ?? 0} alumnos.`); }
    else setMessage(body.error ?? "No se pudo publicar");
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
    const body = await response.json() as { sent?: number; skipped?: number; error?: string };
    setMessage(response.ok ? `Se enviaron ${body.sent ?? 0} notas. ${body.skipped ?? 0} quedaron sin enviar.` : body.error ?? "No se pudieron enviar las notas");
    setLoading(false);
  }

  useEffect(() => {
    if (linked && ended) void loadGrades();
  }, [ended, linked]);

  return <section className="rounded-lg border bg-paper p-5 shadow-card" aria-labelledby="classroom-title"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold tracking-[.08em] text-muted uppercase">Integración opcional</p><h2 id="classroom-title" className="mt-1 flex items-center gap-2 font-semibold text-ink"><BookOpen className="size-4 text-brand" aria-hidden="true" />Google Classroom</h2><p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">Publicá un link a la toma y usá el roster real. Los permisos se piden recién ahora.</p></div>{!linked ? <Button type="button" variant="outline" disabled={loading} onClick={courses.length ? undefined : loadCourses}>{courses.length ? "Cursos cargados" : "Cargar mis cursos"}<ExternalLink data-icon="inline-end" /></Button> : <span className="rounded-sm border border-ok/25 px-2 py-1 text-xs font-semibold text-ok">Vinculada</span>}</div>{message ? <p className="mt-4 rounded-md bg-inset px-3 py-2 text-sm text-ink-2" role="status">{message}</p> : null}{!linked && courses.length ? <div className="mt-4 flex flex-wrap items-end gap-2"><label className="flex min-w-64 flex-1 flex-col gap-1.5 text-sm font-semibold text-ink-2">Curso<select value={courseId} onChange={(event) => setCourseId(event.target.value)} className="h-9 rounded-md border bg-white px-3 font-normal">{courses.map((course) => <option value={course.id} key={course.id}>{course.name}{course.section ? ` · ${course.section}` : ""}</option>)}</select></label><Button type="button" disabled={!courseId || loading} onClick={publish}>Publicar tarea</Button></div> : null}{!linked && message.includes("Conectá") ? <Button type="button" className="mt-3" onClick={connect} disabled={loading}>Autorizar Classroom</Button> : null}{linked && ended && grades ? <div className="mt-5"><div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[620px] text-left text-sm"><thead className="bg-inset text-xs"><tr><th className="px-3 py-2">Alumno</th><th className="px-3 py-2 text-right">Nota</th><th className="px-3 py-2">Entrega</th><th className="px-3 py-2">Resultado</th></tr></thead><tbody className="divide-y">{grades.map((row) => <tr key={row.email}><th scope="row" className="px-3 py-2.5 font-medium">{row.name}</th><td className="mono-number px-3 py-2.5 text-right">{row.grade}</td><td className="px-3 py-2.5 text-xs">{row.submissionState ?? "No encontrada"}</td><td className="px-3 py-2.5 text-xs">{row.canSend ? "Lista para enviar" : row.pendingManual ? "Falta corrección manual" : "El alumno aún no entregó en Classroom"}</td></tr>)}</tbody></table></div><div className="mt-3 flex items-center justify-between gap-3"><p className="text-xs text-muted">Se escribirán draftGrade y assignedGrade sólo para entregas elegibles.</p><Button type="button" disabled={loading || !grades.some((row) => row.canSend)} onClick={sendGrades}><Send data-icon="inline-start" />Enviar notas a Classroom</Button></div></div> : null}</section>;
}
