import type { APIRoute } from "astro";

import { PUBLIC_ROUTES, publicUrl } from "@/server/site";

// El sitemap sale de la misma lista que decide el `noindex` de cada página, así
// que no puede anunciar una URL que después se publica como no indexable.
//
// `/` queda afuera a propósito: para un visitante anónimo es un redirect a
// `/rendir`, y un sitemap que lista redirects es un sitemap que miente.
export const GET: APIRoute = () => {
  const urls = PUBLIC_ROUTES.map(
    (route) => `  <url>
    <loc>${publicUrl(route.path)}</loc>
    <changefreq>${route.changefreq}</changefreq>
    <priority>${route.priority.toFixed(1)}</priority>
  </url>`,
  ).join("\n");

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

  return new Response(body, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
};
