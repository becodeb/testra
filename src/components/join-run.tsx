import { useEffect, useState } from "react";
import { ArrowRight, KeyRound, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const CODE_ALPHABET = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

interface JoinRunProps {
  step?: "code" | "name";
  code?: string;
  runTitle?: string;
  defaultName?: string;
  monitoringSummary?: string;
}

export function JoinRun({ step = "code", code: initialCode = "", runTitle, defaultName = "", monitoringSummary = "cambios de visibilidad y conexión" }: JoinRunProps) {
  const [ready, setReady] = useState(false);
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState(defaultName);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => setReady(true), []);

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!CODE_ALPHABET.test(normalized)) {
      setError("Ingresá los 6 caracteres del código. No usa I, O, 0 ni 1.");
      return;
    }
    if (step === "name" && name.trim().length < 2) {
      setError("Escribí tu nombre para que el docente pueda reconocerte.");
      return;
    }
    setLoading(true);
    setError("");
    const response = await fetch("/api/student/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: normalized, ...(step === "name" ? { name: name.trim() } : {}) }),
    });
    const body = await response.json() as { code?: string; error?: string };
    if (response.ok && body.code) window.location.assign(`/rendir/${encodeURIComponent(body.code)}`);
    else {
      setError(body.error ?? "No pudimos ingresar a la evaluación");
      setLoading(false);
    }
  }

  const isNameStep = step === "name";

  return (
    <form onSubmit={submit} className="w-full rounded-xl border bg-paper p-6 shadow-card sm:p-8" data-join-ready={ready} inert={!ready}>
      <div className="flex size-11 items-center justify-center rounded-lg bg-brand-soft text-brand-deep" aria-hidden="true">
        {isNameStep ? <UserRound className="size-5" /> : <KeyRound className="size-5" />}
      </div>
      <p className="mt-5 text-xs font-semibold tracking-[.08em] text-muted uppercase">
        {isNameStep ? `Código ${code}` : "Ingreso de alumnos"}
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-ink">
        {isNameStep ? "¿Cómo te llamás?" : "Entrá a tu evaluación"}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        {isNameStep
          ? <>Vas a ingresar a <strong className="font-semibold text-ink-2">{runTitle}</strong>. Tu docente verá este nombre en la sala.</>
          : "Usá el código de seis caracteres que muestra tu docente. No necesitás una cuenta."}
      </p>

      {isNameStep ? (
        <Field className="mt-6" data-invalid={Boolean(error) || undefined}>
          <FieldLabel htmlFor="student-name">Tu nombre y apellido</FieldLabel>
          <Input
            id="student-name"
            value={name}
            onChange={(event) => setName(event.target.value.slice(0, 80))}
            className="h-12 text-base"
            autoComplete="name"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "join-error" : undefined}
            autoFocus
          />
          {error ? <FieldError id="join-error">{error}</FieldError> : null}
        </Field>
      ) : (
        <Field className="mt-6" data-invalid={Boolean(error) || undefined}>
          <FieldLabel htmlFor="run-code">Código de la evaluación</FieldLabel>
          <Input
            id="run-code"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
            className="mono-number h-14 text-center text-2xl font-bold tracking-[.2em] uppercase"
            autoComplete="one-time-code"
            inputMode="text"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "join-error" : undefined}
            autoFocus
          />
          {error ? <FieldError id="join-error">{error}</FieldError> : null}
        </Field>
      )}

      {isNameStep ? <aside className="mt-5 rounded-md bg-inset p-4 text-xs leading-5 text-ink-2"><strong>Antes de entrar:</strong> durante la toma activa Testra registra {monitoringSummary}. No guarda el contenido del portapapeles. Estos avisos se muestran al alumno, no cambian la nota y no prueban una infracción por sí solos; la revisión final siempre corresponde al docente. <a href="/docs/vigilancia" target="_blank" rel="noreferrer" className="font-semibold text-brand hover:underline">Ver explicación completa</a>.</aside> : null}

      <Button type="submit" className="mt-5 w-full" disabled={loading}>
        {loading ? "Ingresando…" : isNameStep ? "Entrar a la sala" : "Continuar"}
        <ArrowRight data-icon="inline-end" />
      </Button>

      <p className="mt-5 border-t pt-4 text-center text-xs leading-relaxed text-muted">
        {isNameStep ? "No hace falta iniciar sesión." : <>¿Querés usar tu cuenta? <a className="font-medium text-brand-deep underline underline-offset-4" href="/login?next=%2Frendir">Iniciá sesión (opcional)</a></>}
      </p>
    </form>
  );
}
