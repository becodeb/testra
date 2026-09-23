/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    user: import("better-auth").User | null;
    session: import("better-auth").Session | null;
    /** Message a page sets before `Astro.rewrite("/404")`; never read from the URL. */
    notFoundMessage?: string;
  }
}
