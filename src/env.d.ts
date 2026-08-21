/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface CloudflareEnv {
  DB: D1Database;
  EXAM_RUNS: DurableObjectNamespace;
  ASSETS: Fetcher;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  ALLOW_DEMO_AUTH?: string;
  TEACHER_EMAILS?: string;
}

declare namespace App {
  interface Locals {
    user: import("better-auth").User | null;
    session: import("better-auth").Session | null;
  }
}
