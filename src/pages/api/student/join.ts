import type { APIRoute } from "astro";
import { z } from "zod";

import { getAuthenticatedActor } from "@/server/actors";
import { apiError, readJson } from "@/server/api";
import { getJoinableRun, getStudentSession, joinRunByCode } from "@/server/repository";
import {
  createGuestToken,
  encodeGuestSession,
  hashGuestToken,
  STUDENT_SESSION_COOKIE,
} from "@/server/student-access";

const inputSchema = z.object({
  code: z.string().trim().length(6),
  name: z.string().trim().min(2).max(80).optional(),
});

export const POST: APIRoute = async ({ cookies, locals, request, url }) => {
  const actor = getAuthenticatedActor(locals);
  try {
    const { code: rawCode, name } = inputSchema.parse(await readJson(request));
    const code = rawCode.toUpperCase();
    const run = await getJoinableRun(code);
    if (!run) return Response.json({ error: "No encontramos una toma activa con ese código" }, { status: 404 });
    if (!name) return Response.json({ code: run.code, title: run.title });

    const access = { actor, request };
    const existing = await getStudentSession(access, code);
    if (existing) return Response.json({ code: existing.run.code, status: existing.run.status });

    const guestToken = actor ? undefined : createGuestToken();
    const joined = await joinRunByCode(
      actor,
      code,
      name.replace(/\s+/g, " "),
      guestToken ? await hashGuestToken(guestToken) : undefined,
    );
    if (joined && guestToken) {
      cookies.set(
        STUDENT_SESSION_COOKIE,
        encodeGuestSession(joined.participant.id, guestToken),
        {
          httpOnly: true,
          sameSite: "lax",
          secure: url.protocol === "https:",
          path: "/",
          maxAge: 12 * 60 * 60,
        },
      );
    }
    return joined
      ? Response.json({ code: joined.run.code, status: joined.run.status })
      : Response.json({ error: "No encontramos una toma activa con ese código" }, { status: 404 });
  } catch (error) {
    return apiError(error);
  }
};
