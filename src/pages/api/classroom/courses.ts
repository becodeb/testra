import type { APIRoute } from "astro";

import { getActor, isTeacher, unauthenticated, forbidden } from "@/server/actors";
import { apiError } from "@/server/api";
import { classroomCourses } from "@/server/classroom-service";

export const GET: APIRoute = async ({ locals }) => {
  const actor = getActor(locals, "teacher");
  if (!actor) return unauthenticated();
  if (!isTeacher(actor)) return forbidden();
  try { return Response.json(await classroomCourses(actor)); } catch (error) { return apiError(error); }
};
