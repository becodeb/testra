import type { APIRoute } from "astro";

import { getActor, isSuperadmin } from "@/server/actors";
import { getPlatformOverview } from "@/server/repository";

// Alimenta el refresco automatico de la consola. Devuelve 404 y no 403 a quien
// no corresponde: la existencia del panel tampoco es informacion publica.
export const GET: APIRoute = async ({ locals }) => {
  const actor = getActor(locals);
  if (!isSuperadmin(actor)) return new Response("No encontrado", { status: 404 });
  return Response.json(await getPlatformOverview());
};
