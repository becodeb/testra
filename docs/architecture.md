# Architecture

## Boundaries

- Astro renders teacher read surfaces on the server.
- React islands own the editor and student runtime.
- D1 is the durable record for exams, frozen runs, responses, grades, and incidents.
- One `ExamRunDO` owns each live run: presence, authoritative clock, hibernatable WebSockets, and alarm scheduling.
- Zod schemas are shared; answer keys remain inside `FullQuestion` on trusted server code and become the distinct `StudentQuestion` type before serialization.

## Live-run sequence

1. Creating a run copies the complete question set into `runs.questions_snapshot`.
2. The Worker initializes the Durable Object with the run ID, title, and duration.
3. Lobby connections use hibernatable WebSockets tagged by role and participant.
4. Starting sets `startedAt` and `endsAt` once on the server and schedules an alarm.
5. Clients render remaining time from `endsAt` plus a measured server offset.
6. The alarm ends the run or performs the next heartbeat audit, whichever is earlier.
7. Closing persists the durable result to D1; the DO remains only the hot coordinator.

## Trust model

Student responses are untrusted input. Every save receives a server timestamp. Grading reads the frozen server-side key. Incident type and duration are whitelisted and bounded. UI timestamps and timers are display-only.
