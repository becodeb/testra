export async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw new Error("Se esperaba JSON");
  return request.json();
}

export function apiError(error: unknown, fallback = "No se pudo completar la operación") {
  const message = error instanceof Error ? error.message : fallback;
  return Response.json({ error: message }, { status: 400 });
}
