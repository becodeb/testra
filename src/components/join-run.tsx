import { useState } from "react";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const CODE_ALPHABET = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

export function JoinRun() {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!CODE_ALPHABET.test(normalized)) {
      setError("Ingresá los 6 caracteres del código. No usa I, O, 0 ni 1.");
      return;
    }
    setLoading(true);
    setError("");
    const response = await fetch("/api/student/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: normalized }),
    });
    const body = await response.json() as { code?: string; error?: string };
    if (response.ok && body.code) window.location.assign(`/rendir/${encodeURIComponent(body.code)}`);
    else {
      setError(body.error ?? "No pudimos ingresar a la toma");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full rounded-lg border bg-paper p-6 shadow-card sm:p-8">
      <p className="text-xs font-semibold tracking-[.08em] text-muted uppercase">Ingreso de alumnos</p>
      <h1 className="mt-2 text-2xl font-semibold text-ink">Entrá a tu evaluación</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">Usá el código de seis caracteres que muestra tu docente.</p>
      <Field className="mt-6" data-invalid={Boolean(error) || undefined}>
        <FieldLabel htmlFor="run-code">Código de la toma</FieldLabel>
        <Input
          id="run-code"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase().slice(0, 6))}
          className="mono-number h-14 text-center text-2xl font-bold tracking-[.2em] uppercase"
          autoComplete="one-time-code"
          inputMode="text"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "run-code-error" : undefined}
          autoFocus
        />
        {error ? <FieldError id="run-code-error">{error}</FieldError> : null}
      </Field>
      <Button type="submit" className="mt-5 w-full" disabled={loading}>{loading ? "Ingresando…" : "Continuar"}<ArrowRight data-icon="inline-end" /></Button>
      <p className="mt-5 border-t pt-4 text-xs leading-relaxed text-muted">Testra usa la identidad de tu cuenta para registrar la entrega. No te pedirá que escribas tu nombre.</p>
    </form>
  );
}
