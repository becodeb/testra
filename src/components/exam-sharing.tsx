import { useState } from "react";
import { Share2, Trash2 } from "lucide-react";

import type { ExamCollaborator } from "@/server/exam-permissions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function ExamSharing({ examId, initial }: { examId: string; initial: ExamCollaborator[] }) {
  const [items, setItems] = useState(initial);
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState<"view" | "edit" | "correct">("view");
  const [publish, setPublish] = useState(false);
  const [classroom, setClassroom] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setError("");
    const response = await fetch(`/api/exams/${encodeURIComponent(examId)}/collaborators`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, permission, canPublishResults: publish, canManageClassroom: classroom }) });
    const body = await response.json().catch(() => ({})) as ExamCollaborator & { error?: string };
    if (!response.ok) return setError(body.error ?? "No se pudo compartir");
    setItems((current) => [...current.filter((item) => item.userId !== body.userId), body]);
    setEmail("");
  }

  async function remove(userId: string) {
    const response = await fetch(`/api/exams/${encodeURIComponent(examId)}/collaborators`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId }) });
    if (response.ok) setItems((current) => current.filter((item) => item.userId !== userId));
  }

  return <Dialog><DialogTrigger asChild><Button type="button" variant="outline" size="sm"><Share2 data-icon="inline-start" />Compartir</Button></DialogTrigger><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Compartir evaluación</DialogTitle><DialogDescription>El propietario sigue siendo vos. Publicar resultados y usar Classroom requieren permisos explícitos y nunca comparten credenciales OAuth.</DialogDescription></DialogHeader><div className="grid gap-4"><div className="grid gap-3 sm:grid-cols-[1fr_9rem]"><Field><FieldLabel htmlFor="share-email">Email del docente</FieldLabel><Input id="share-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="docente@escuela.edu" /></Field><Field><FieldLabel>Permiso</FieldLabel><Select value={permission} onValueChange={(value) => setPermission(value as typeof permission)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="view">Ver</SelectItem><SelectItem value="edit">Editar y abrir</SelectItem><SelectItem value="correct">Corregir</SelectItem></SelectContent></Select></Field></div><div className="grid gap-2 sm:grid-cols-2"><FieldLabel className="bg-white"><Field orientation="horizontal"><Checkbox checked={publish} onCheckedChange={(value) => setPublish(Boolean(value))} />Puede publicar resultados</Field></FieldLabel><FieldLabel className="bg-white"><Field orientation="horizontal"><Checkbox checked={classroom} onCheckedChange={(value) => setClassroom(Boolean(value))} />Puede operar Classroom con su cuenta</Field></FieldLabel></div>{error ? <p className="text-sm text-alert">{error}</p> : null}<Button type="button" disabled={!email.trim()} onClick={() => void save()}>Guardar acceso</Button><div className="divide-y rounded-md border">{items.map((item) => <div key={item.userId} className="flex items-center gap-3 p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-ink">{item.name}</p><p className="truncate text-xs text-muted">{item.email} · {item.permission}{item.canPublishResults ? " · publica" : ""}{item.canManageClassroom ? " · Classroom" : ""}</p></div><Button type="button" variant="ghost" size="icon-sm" aria-label={`Quitar acceso de ${item.name}`} onClick={() => void remove(item.userId)}><Trash2 /></Button></div>)}{!items.length ? <p className="p-4 text-center text-sm text-muted">Todavía no compartiste esta evaluación.</p> : null}</div></div></DialogContent></Dialog>;
}
