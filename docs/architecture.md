# Architecture

## Boundaries

- Astro renders teacher read surfaces on the server.
- React islands own the editor and student runtime.
- Postgres is the durable record for exams, frozen runs, responses, grades, and incidents.
- One `ExamRunActor` owns each live run: presence, authoritative clock, WebSockets, and timer scheduling. Actors live in the Node process and are keyed by run ID.
- Zod schemas are shared; answer keys remain inside `FullQuestion` on trusted server code and become the distinct `StudentQuestion` type before serialization.

## Live-run sequence

1. Creating a run copies the complete question set into `runs.questions_snapshot`.
2. The server initializes the run actor with the run ID, title, and duration.
3. Lobby connections upgrade to WebSockets, tracked per role and participant.
4. Starting sets `startedAt` and `endsAt` once on the server and schedules a timer.
5. Clients render remaining time from `endsAt` plus a measured server offset.
6. The timer ends the run or performs the next heartbeat audit, whichever is earlier.
7. Closing persists the durable result to Postgres; the actor remains only the hot coordinator.

## Migration from Cloudflare

The runtime moved from Cloudflare Workers to a Node container on Coolify. Each Cloudflare primitive has a direct replacement:

| Cloudflare | Replacement |
| --- | --- |
| Worker runtime | Astro with `@astrojs/node`, started by `server.mjs` |
| D1 (SQLite) | Postgres through `src/server/db/client.ts` |
| `ExamRunDO` | `ExamRunActor`, in-process, `src/server/exam-run-actor.ts` |
| Durable Object storage | Postgres for durable state, an in-memory `Map` for per-run antispam counters |
| Alarms | `setTimeout` |
| WebSocket Hibernation | Live `ws` sockets, upgraded in `src/server/ws-upgrade.ts` |
| Durable Object input gating | The `serialize()` queue inside the actor |
| `env` from `cloudflare:workers` | `process.env` through `src/server/env.ts` |
| `CF-Connecting-IP` | `X-Forwarded-For`, read by `clientIp()` |

`src/server/db/client.ts` keeps the `prepare().bind().first()/.all()/.run()` shape D1 had, and rewrites `?` placeholders into Postgres `$n`. That is why the 41 raw queries in `repository.ts` survived the move unchanged.

Two consequences are worth remembering:

- The application must run as a **single replica**. Live-run state is in-process. See `docs/deployment.md`.
- The database keeps two timestamp conventions. better-auth tables use `timestamptz` and `boolean` because better-auth reads them through Drizzle; application tables keep epoch milliseconds in `bigint` and 0/1 flags in `integer`, matching what the domain and the browser already speak. The reasoning is written down in `src/server/db/schema.ts`.

## Trust model

Student responses are untrusted input. Every save receives a server timestamp. Grading reads the frozen server-side key. Incident type and duration are whitelisted and bounded. UI timestamps and timers are display-only.
