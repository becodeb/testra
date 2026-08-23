import { useState } from "react";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type Mode = "signin" | "signup";

const messages: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "El correo o la contraseña no coinciden.",
  USER_ALREADY_EXISTS: "Ya existe una cuenta con ese correo. Probá iniciar sesión.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "Ya existe una cuenta con ese correo. Probá iniciar sesión.",
  PASSWORD_TOO_SHORT: "La contraseña debe tener al menos 8 caracteres.",
  PASSWORD_TOO_LONG: "La contraseña no puede superar los 128 caracteres.",
  TOO_MANY_REQUESTS: "Hubo demasiados intentos. Esperá un momento y volvé a probar.",
};

function readableError(code?: string, fallback?: string) {
  if (code && messages[code]) return messages[code];
  return fallback || "No se pudo completar el acceso. Revisá los datos e intentá nuevamente.";
}

export function AuthForm({ callbackURL }: { callbackURL: string }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function changeMode(next: Mode) {
    setMode(next);
    setError("");
  }

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const result = mode === "signup"
        ? await authClient.signUp.email({
            name: name.trim(),
            email: email.trim(),
            password,
            callbackURL,
          })
        : await authClient.signIn.email({
            email: email.trim(),
            password,
            rememberMe: true,
            callbackURL,
          });

      if (result.error) {
        setError(readableError(result.error.code, result.error.message));
        setLoading(false);
        return;
      }

      window.location.assign(callbackURL);
    } catch {
      setError("No pudimos conectar con Testra. Revisá tu conexión y volvé a probar.");
      setLoading(false);
    }
  }

  async function signInWithGoogle() {
    setLoading(true);
    setError("");
    try {
      const result = await authClient.signIn.social({ provider: "google", callbackURL });
      if (result.error) {
        setError(readableError(result.error.code, result.error.message));
        setLoading(false);
      }
    } catch {
      setError("No pudimos iniciar el acceso con Google. Podés entrar con correo y contraseña.");
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="grid grid-cols-2 rounded-md bg-inset p-1" aria-label="Elegir forma de acceso">
        <button
          type="button"
          aria-pressed={mode === "signin"}
          className="rounded-sm px-3 py-2 text-sm font-semibold text-muted transition-colors aria-pressed:bg-white aria-pressed:text-brand-deep aria-pressed:shadow-card"
          onClick={() => changeMode("signin")}
        >
          Iniciar sesión
        </button>
        <button
          type="button"
          aria-pressed={mode === "signup"}
          className="rounded-sm px-3 py-2 text-sm font-semibold text-muted transition-colors aria-pressed:bg-white aria-pressed:text-brand-deep aria-pressed:shadow-card"
          onClick={() => changeMode("signup")}
        >
          Crear cuenta
        </button>
      </div>

      <form onSubmit={submit} className="mt-6 space-y-4 transition-[height] duration-500 ease-in-out">
        <div className={`grid transition-[grid-template-rows,opacity] duration-500 ease-in-out ${mode === "signup" ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`} aria-hidden={mode !== "signup"}>
          <div className="overflow-hidden"><Field className="pb-4">
            <FieldLabel htmlFor="auth-name">Nombre y apellido</FieldLabel>
            <Input
              id="auth-name"
              name="name"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required={mode === "signup"}
              minLength={2}
              maxLength={80}
              disabled={loading}
            />
          </Field></div>
        </div>

        <Field>
          <FieldLabel htmlFor="auth-email">Correo electrónico</FieldLabel>
          <Input
            id="auth-email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            disabled={loading}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="auth-password">Contraseña</FieldLabel>
          <Input
            id="auth-password"
            name="password"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={8}
            maxLength={128}
            disabled={loading}
          />
          {mode === "signup" ? <p className="text-xs text-muted">Usá 8 caracteres o más.</p> : null}
        </Field>

        {error ? <FieldError role="alert">{error}</FieldError> : null}

        <Button type="submit" size="lg" className="w-full" disabled={loading}>
          {loading ? "Procesando…" : mode === "signup" ? "Crear mi cuenta" : "Entrar a Testra"}
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-line" /><span>o</span><span className="h-px flex-1 bg-line" /></div>
      <Button type="button" variant="outline" size="lg" className="w-full" disabled={loading} onClick={() => void signInWithGoogle()}>
        <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.91h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.4Z"/><path fill="#34A853" d="M12 22c2.7 0 4.97-.9 6.62-2.43l-3.24-2.54c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.39 13.86A6 6 0 0 1 6.07 12c0-.65.11-1.28.32-1.86V7.52H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.48l3.35-2.62Z"/><path fill="#EA4335" d="M12 6.01c1.47 0 2.79.51 3.83 1.5l2.87-2.88A9.65 9.65 0 0 0 12 2a10 10 0 0 0-8.96 5.52l3.35 2.62C7.18 7.77 9.39 6.01 12 6.01Z"/></svg>
        Continuar con Google
      </Button>

      <p className="mt-5 text-center text-xs leading-relaxed text-muted">
        Google es opcional. También podés usar solamente tu correo y contraseña.
      </p>
    </div>
  );
}
