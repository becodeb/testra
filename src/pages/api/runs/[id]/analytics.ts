import type { APIRoute } from "astro";
import { forbidden, getActor, isTeacher, unauthenticated } from "@/server/actors";
import { getExamAnalytics } from "@/server/repository";

export const GET: APIRoute = async ({ locals, params }) => {
  const actor = getActor(locals, "teacher");
  if (!actor) return unauthenticated();
  if (!isTeacher(actor)) return forbidden();
  const analytics = await getExamAnalytics(params.id!, actor);
  return analytics ? Response.json(analytics) : forbidden();
};
