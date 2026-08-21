import type { APIRoute } from "astro";

import { auth } from "@/server/auth";

export const ALL: APIRoute = ({ request }) => auth.handler(request);
