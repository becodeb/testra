import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { z } from "zod";

import { apiError, readJson } from "@/server/api";

const runtimeEnv = env as unknown as CloudflareEnv;
const personalEmailDomains = new Set([
  "gmail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
]);

export const POST: APIRoute = async ({ locals, request }) => {
  if (!locals.user) return Response.json({ error: "Iniciá sesión para continuar" }, { status: 401 });
  try {
    const input = z.object({ school: z.string().trim().min(3).max(120), role: z.enum(["teacher", "student"]) }).parse(await readJson(request));
    const domain = locals.user.email.split("@").at(-1)?.toLocaleLowerCase();
    if (!domain) throw new Error("La cuenta no tiene un correo válido");
    const reusableDomain = !personalEmailDomains.has(domain);
    let organization = reusableDomain
      ? await runtimeEnv.DB.prepare("SELECT id FROM organizations WHERE google_domain = ?").bind(domain).first<{ id: string }>()
      : null;

    if (input.role === "teacher" && organization) {
      const allowlist = (runtimeEnv.TEACHER_EMAILS ?? "").split(",").map((value) => value.trim().toLocaleLowerCase()).filter(Boolean);
      if (!allowlist.includes(locals.user.email.toLocaleLowerCase())) throw new Error("La institución ya existe. Pedile al administrador que habilite tu correo como docente.");
    }

    if (!organization) {
      organization = { id: crypto.randomUUID() };
      await runtimeEnv.DB.prepare("INSERT INTO organizations (id, name, google_domain) VALUES (?, ?, ?)").bind(organization.id, input.school, reusableDomain ? domain : null).run();
    }
    await runtimeEnv.DB.prepare("UPDATE users SET org_id = ?, role = ?, updated_at = ? WHERE id = ?").bind(organization.id, input.role, Date.now(), locals.user.id).run();
    return Response.json({ redirect: input.role === "teacher" ? "/evaluaciones" : "/rendir" });
  } catch (error) {
    return apiError(error);
  }
};
