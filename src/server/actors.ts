import { serverEnv } from "@/server/env";


export type ActorRole = "teacher" | "student";

export interface Actor {
  id: string;
  email: string;
  name: string;
  role: ActorRole;
  orgId: string | null;
  /** Administra su propia organizacion: aprueba docentes. */
  orgAdmin: boolean;
  /** Ve la plataforma entera, todas las organizaciones. */
  superadmin: boolean;
}

/**
 * El superadmin sale de SUPERADMIN_EMAILS, no de la base. Es deliberado: da de
 * alta a gente que todavia no se registro, y no se puede escalar privilegios
 * escribiendo una fila.
 */
function isSuperadminEmail(email: string): boolean {
  const allowlist = (serverEnv.SUPERADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLocaleLowerCase())
    .filter(Boolean);
  return allowlist.includes(email.trim().toLocaleLowerCase());
}


export function getActor(locals: App.Locals, preferredRole?: ActorRole): Actor | null {
  if (locals.user) {
    const user = locals.user as typeof locals.user & { role?: ActorRole; orgId?: string | null; orgAdmin?: boolean };
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role ?? "student",
      orgId: user.orgId ?? null,
      orgAdmin: user.orgAdmin ?? false,
      superadmin: isSuperadminEmail(user.email),
    };
  }

  if (serverEnv.ALLOW_DEMO_AUTH !== "true") return null;
  if (preferredRole === "student") {
    return {
      id: "student-demo",
      email: "sofia@escuela.example.edu",
      name: "Sofía Álvarez",
      role: "student",
      orgId: "org-demo",
      orgAdmin: false,
      superadmin: false,
    };
  }
  return {
    id: "teacher-demo",
    email: "mariana@escuela.example.edu",
    name: "Mariana Costa",
    role: "teacher",
    orgId: "org-demo",
    orgAdmin: true,
    superadmin: isSuperadminEmail("mariana@escuela.example.edu"),
  };
}

export function getAuthenticatedActor(locals: App.Locals): Actor | null {
  return locals.user ? getActor(locals) : null;
}

export function isTeacher(actor: Actor | null): actor is Actor & { role: "teacher" } {
  return actor?.role === "teacher";
}

export function isSuperadmin(actor: Actor | null): actor is Actor & { superadmin: true } {
  return actor?.superadmin === true;
}

export function forbidden(message = "No tenés permiso para realizar esta acción") {
  return Response.json({ error: message }, { status: 403 });
}

export function unauthenticated() {
  return Response.json({ error: "Iniciá sesión para continuar" }, { status: 401 });
}
