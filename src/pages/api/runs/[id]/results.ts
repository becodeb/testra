import type { APIRoute } from "astro";
import { z } from "zod";

import { getActor, isTeacher, unauthenticated, forbidden } from "@/server/actors";
import { apiError, readJson } from "@/server/api";
import { sendRunGrades } from "@/server/classroom-service";
import { publishRunResults } from "@/server/repository";

/**
 * El "listo" del docente, en una sola acción: cierra la corrección y, si la
 * toma está vinculada a Classroom, devuelve ahí las notas.
 *
 * Sigue siendo un acto explícito —nunca automático— porque escribe en un
 * registro académico externo. Lo que cambia es que ahora es UN gesto en vez de
 * dos, que era lo que hacía que la mitad de las veces las notas quedaran
 * escritas en Testra y nunca llegaran al alumno.
 */
export const POST: APIRoute = async ({ locals, request, params }) => {
  const actor = getActor(locals, "teacher");
  if (!actor) return unauthenticated();
  if (!isTeacher(actor)) return forbidden();

  try {
    const { sendToClassroom } = z
      .object({ sendToClassroom: z.boolean().default(true) })
      .parse(await readJson(request).catch(() => ({})));

    const published = await publishRunResults(actor, params.id!);
    if (!published) return Response.json({ error: "Sesión inexistente" }, { status: 404 });

    if (!published.classroomLinked || !sendToClassroom) {
      return Response.json({ ...published, classroom: null });
    }

    // Que falle Classroom no puede deshacer la publicación: la nota ya es
    // visible en Testra y el docente puede reintentar el envío.
    try {
      const classroom = await sendRunGrades(actor, params.id!);
      return Response.json({ ...published, classroom });
    } catch (error) {
      return Response.json({
        ...published,
        classroom: null,
        classroomError: error instanceof Error ? error.message : "No se pudieron enviar las notas a Classroom",
      });
    }
  } catch (error) {
    return apiError(error);
  }
};
