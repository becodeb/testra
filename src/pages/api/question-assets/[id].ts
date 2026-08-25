import type { APIRoute } from "astro";

import { readQuestionImage } from "@/server/question-assets";

export const GET: APIRoute = async ({ params }) => {
  const image = await readQuestionImage(params.id!);
  if (!image) return new Response("Imagen inexistente", { status: 404 });
  return new Response(new Uint8Array(image.data), {
    headers: {
      "content-type": image.mime_type,
      "content-length": String(image.size_bytes),
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-disposition": `inline; filename="${image.original_name.replace(/["\r\n]/g, "_")}"`,
    },
  });
};
