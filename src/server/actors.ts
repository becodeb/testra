import { serverEnv } from "@/server/env";


export type ActorRole = "teacher" | "student";

export interface Actor {
  id: string;
  email: string;
  name: string;
  role: ActorRole;
  orgId: string | null;
  orgAdmin: boolean;
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
    };
  }
  return {
    id: "teacher-demo",
    email: "mariana@escuela.example.edu",
    name: "Mariana Costa",
    role: "teacher",
    orgId: "org-demo",
    orgAdmin: true,
  };
}

export function getAuthenticatedActor(locals: App.Locals): Actor | null {
  return locals.user ? getActor(locals) : null;
}

export function isTeacher(actor: Actor | null): actor is Actor & { role: "teacher" } {
  return actor?.role === "teacher";
}

export function forbidden(message = "No tenés permiso para realizar esta acción") {
  return Response.json({ error: message }, { status: 403 });
}

export function unauthenticated() {
  return Response.json({ error: "Iniciá sesión para continuar" }, { status: 401 });
}
