import { useState } from "react";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function OnboardingForm({ next = "/" }: { next?: string }) {
  const [school, setSchool] = useState("");
  const [role, setRole] = useState<"teacher" | "student">("teacher");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const response = await fetch("/api/onboarding", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ school, role }) });
    const body = await response.json().catch(() => ({})) as { redirect?: string; error?: string; pending?: boolean };
    if (response.ok) window.location.assign(body.redirect ?? (role === "teacher" ? "/evaluaciones" : (next === "/" ? "/rendir" : next)));
    else { setError(body.error ?? "No se pudo configurar la cuenta"); setLoading(false); }
  }

  return <form onSubmit={submit} className="w-full rounded-lg border bg-paper p-8 shadow-card"><p className="text-xs font-semibold tracking-[.08em] text-muted uppercase">Primera vez</p><h1 className="mt-2 text-2xl font-semibold text-ink">Configurá tu espacio</h1><p className="mt-2 text-sm leading-relaxed text-muted">Esto se hace una sola vez. Con un correo personal creamos un espacio independiente para vos.</p><Field className="mt-6"><FieldLabel htmlFor="school">Nombre de la institución o espacio</FieldLabel><Input id="school" value={school} onChange={(event) => setSchool(event.target.value)} required minLength={3} /></Field><fieldset className="mt-5"><legend className="text-sm font-semibold text-ink-2">Usaré Testra como</legend><div className="mt-2 grid grid-cols-2 gap-2"><label className="rounded-md border p-3 text-sm font-medium"><input type="radio" name="role" value="teacher" checked={role === "teacher"} onChange={() => setRole("teacher")} className="mr-2" />Docente</label><label className="rounded-md border p-3 text-sm font-medium"><input type="radio" name="role" value="student" checked={role === "student"} onChange={() => setRole("student")} className="mr-2" />Alumno</label></div></fieldset>{error ? <FieldError className="mt-4" role="alert">{error}</FieldError> : null}<Button type="submit" className="mt-6 w-full" disabled={loading || school.trim().length < 3}>{loading ? "Guardando…" : "Continuar"}<ArrowRight data-icon="inline-end" /></Button></form>;
}
