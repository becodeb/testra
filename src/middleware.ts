import { defineMiddleware } from "astro:middleware";

import { serverEnv } from "@/server/env";
import { auth } from "@/server/auth";
import { kickGradingJobs } from "@/server/grading-jobs";


const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const FORM_CONTENT_TYPES = ["application/x-www-form-urlencoded", "multipart/form-data", "text/plain"];

// Reemplazo de security.checkOrigin, desactivado en astro.config.mjs. El chequeo
// original compara el Origin contra el host de la request, y el proxy que publica
// el dominio público reescribe Host hacia workers.dev: el Origin del navegador
// nunca coincide y todo POST de formulario termina rechazado. Acá se acepta,
// además del mismo origen, el dominio público declarado en BETTER_AUTH_URL.
function trustedOrigins(url: URL) {
  const origins = new Set([url.origin]);
  try {
    origins.add(new URL(serverEnv.BETTER_AUTH_URL).origin);
  } catch {
    // Con BETTER_AUTH_URL inválida solo se confía en el mismo origen.
  }
  return origins;
}

function isForbiddenCrossOriginRequest(request: Request, url: URL) {
  if (SAFE_METHODS.has(request.method)) return false;

  const contentType = request.headers.get("content-type");
  if (contentType && !FORM_CONTENT_TYPES.some((type) => contentType.toLowerCase().includes(type))) {
    return false;
  }

  const origin = request.headers.get("origin");
  return origin === null || !trustedOrigins(url).has(origin);
}

export const onRequest = defineMiddleware(async (context, next) => {
  kickGradingJobs();
  if (isForbiddenCrossOriginRequest(context.request, context.url)) {
    return new Response(`Cross-site ${context.request.method} form submissions are forbidden`, { status: 403 });
  }
  const result = await auth.api.getSession({ headers: context.request.headers });
  context.locals.user = result?.user ?? null;
  context.locals.session = result?.session ?? null;
  return next();
});
