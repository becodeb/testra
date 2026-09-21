import type { APIRoute } from "astro";

import { publicUrl } from "@/server/site";

// Rutas que un buscador no debe ni pedir.
//
// `/rendir/` con la barra final bloquea las tomas en vivo (`/rendir/<codigo>`)
// sin bloquear `/rendir`, que es la página pública donde se ingresa el código.
// Esa distinción es el punto entero de la lista: una toma es el examen de
// alguien, no contenido.
//
// El resto redirige al login igual, pero declararlo ahorra que el rastreador
// gaste presupuesto de rastreo en pantallas que nunca va a poder ver.
const DISALLOW = [
  "/api/",
  "/rendir/",
  "/evaluaciones",
  "/sesiones",
  "/tomas",
  "/correcciones",
  "/resultados",
  "/admin",
  "/onboarding",
  "/solicitudes",
  "/solicitud-pendiente",
];

export const GET: APIRoute = () => {
  const body = [
    "User-agent: *",
    ...DISALLOW.map((path) => `Disallow: ${path}`),
    "",
    `Sitemap: ${publicUrl("/sitemap.xml")}`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
};
