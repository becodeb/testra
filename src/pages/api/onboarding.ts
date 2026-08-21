import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { z } from "zod";

import { apiError, readJson } from "@/server/api";

const runtimeEnv = env as unknown as CloudflareEnv;

export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return Response.json({ error: "Iniciá sesión para continuar" }, { status: 401 });
  try {
    const input = z.object({ school: z.string().trim().min(3).max(120), role: z.enum(["teacher", "student"]) }).parse(await readJson(request));
    if (input.role === "teacher") {
      const allowlist = (runtimeEnv.TEACHER_EMAILS ?? "").split(",").map((value) => value.trim().toLocaleLowerCase()).filter(Boolean);
      if (!allowlist.length || !allowlist.includes(locals.user.email.toLocaleLowerCase())) throw new Error("Tu cuenta no está habilitada como docente. Pedile al administrador que agregue tu correo a TEACHER_EMAILS.");
    }
    const domain = locals.user.email.split("@").at(-1)?.toLocaleLowerCase();
    if (!domain) throw new Error("La cuenta no tiene un correo válido");
    let organization = await runtimeEnv.DB.prepare("SELECT id FROM organizations WHERE google_domain = ?").bind(domain).first<{ id: string }>();
    if (!organization) {
      organization = { id: crypto.randomUUID() };
      await runtimeEnv.DB.prepare("INSERT INTO organizations (id, name, google_domain) VALUES (?, ?, ?)").bind(organization.id, input.school, domain).run();
    }
    await runtimeEnv.DB.prepare("UPDATE users SET org_id = ?, role = ?, updated_at = ? WHERE id = ?").bind(organization.id, input.role, Date.now(), locals.user.id).run();
    return Response.json({ redirect: input.role === "teacher" ? "/evaluaciones" : "/rendir" });
  } catch (error) {
    return apiError(error);
  }
};
