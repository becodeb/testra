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

      <form onSubmit={submit} className="mt-6 space-y-4">
        {mode === "signup" ? (
          <Field>
            <FieldLabel htmlFor="auth-name">Nombre y apellido</FieldLabel>
            <Input
              id="auth-name"
              name="name"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              minLength={2}
              maxLength={80}
              disabled={loading}
            />
          </Field>
        ) : null}

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

      <p className="mt-5 text-center text-xs leading-relaxed text-muted">
        No necesitás una cuenta de Google. Tus datos de acceso se guardan de forma segura.
      </p>
    </div>
  );
}
