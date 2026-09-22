// Identidad pública del sitio: de acá salen las URL canónicas, el sitemap y el
// robots.txt.
//
// El origen se deriva de BETTER_AUTH_URL en vez de fijar `site` en
// astro.config.mjs a propósito. Ese dominio ya es el público —con él se firman y
// validan las sesiones— y se resuelve en runtime, así que el mismo build sirve
// para producción y para desarrollo. Dos fuentes de verdad para el dominio
// terminan discrepando, y una canónica equivocada le dice al buscador que
// indexe una URL que no existe.

import { serverEnv } from "@/server/env";

export interface PublicRoute {
  path: string;
  /** Prioridad relativa dentro del sitio, no una promesa al buscador. */
  priority: number;
  changefreq: "daily" | "weekly" | "monthly" | "yearly";
}

/**
 * Las ÚNICAS rutas que un buscador puede indexar.
 *
 * Testra es una plataforma de evaluaciones: casi todo lo que sirve es privado,
 * y lo público que no está acá —una toma en vivo en `/rendir/<codigo>`— es
 * contenido efímero de un examen real que no debe terminar en un buscador
 * jamás. Por eso la regla es al revés de lo habitual: **el default es noindex y
 * acá se opta explícitamente por entrar**. Una página nueva nace privada; si
 * alguien la quiere pública tiene que agregarla a esta lista, y al agregarla
 * entra sola al sitemap.
 *
 * `Seo.astro` lee esta lista para decidir el `robots` de cada página, así que
 * la lista y el sitemap nunca pueden discrepar.
 */
export const PUBLIC_ROUTES: readonly PublicRoute[] = [
  { path: "/", priority: 1.0, changefreq: "monthly" },
  { path: "/demo", priority: 0.9, changefreq: "monthly" },
  { path: "/rendir", priority: 0.9, changefreq: "monthly" },
  { path: "/acerca", priority: 0.8, changefreq: "monthly" },
  { path: "/docs/vigilancia", priority: 0.8, changefreq: "monthly" },
  { path: "/login", priority: 0.5, changefreq: "yearly" },
  { path: "/privacidad", priority: 0.3, changefreq: "yearly" },
  { path: "/terminos", priority: 0.3, changefreq: "yearly" },
];

export function siteOrigin(): string {
  try {
    return new URL(serverEnv.BETTER_AUTH_URL).origin;
  } catch {
    // BETTER_AUTH_URL es obligatoria y se valida al arrancar; este respaldo
    // existe para que una canónica rota nunca tumbe el render de la página.
    return "https://testra.becode.com.ar";
  }
}

export function publicUrl(path: string): string {
  return new URL(normalizePath(path), `${siteOrigin()}/`).toString();
}

/**
 * Deja una sola forma por ruta antes de compararla o publicarla.
 *
 * Sin esto, `/acerca` y `/acerca/` son dos URL distintas para el buscador con el
 * mismo contenido, y la segunda además no matchearía contra `PUBLIC_ROUTES` y
 * se publicaría como `noindex` por accidente.
 */
export function normalizePath(pathname: string): string {
  const sinBarra = pathname.replace(/\/+$/, "");
  return sinBarra === "" ? "/" : sinBarra;
}

export function isPublicRoute(pathname: string): boolean {
  const path = normalizePath(pathname);
  return PUBLIC_ROUTES.some((route) => route.path === path);
}
