import type { WebSocket } from "ws";

import type { FullQuestion } from "@/domain/exam";
import { shouldCompareConnectionValue } from "@/server/connection-signals";
import { db, type PgStatement } from "@/server/db/client";
import { gradeExam } from "@/server/grading";

// Reemplazo del Durable Object `ExamRunDO`. Cada toma en vivo tiene un actor en
// memoria dentro del proceso Node: el estado, los WebSockets y el temporizador
// viven en el mismo proceso que atiende las peticiones, así que un heartbeat o
// un incidente no cruzan ninguna red antes de llegar al resto del aula.
//
// Diferencias con el Durable Object que reemplaza:
//   - `ctx.storage` para el estado de la toma desaparece. Todo lo durable ya se
//     escribe en Postgres, y `hydrate()` lo recupera si el proceso se reinicia.
//     Los contadores antispam sí quedan en memoria: son guardas efímeras por
//     toma y perder los de una toma en curso no rompe nada.
//   - Las alarmas pasan a `setTimeout`.
//   - Las garantías de un solo hilo del Durable Object se reproducen con la
//     cola `serialize()`, que evita que dos comandos se entrelacen en un await.
//
// Este diseño asume UNA sola réplica de la aplicación. Es la contrapartida de
// que todo sea instantáneo; está documentado en docs/deployment.md.

const CLIENT_INCIDENT_TYPES = new Set([
  "cambio-de-pestana",
  "ventana-sin-foco",
  "atajo-f12",
  "atajo-copiar-pegar",
  "salida-pantalla-completa",
  "cierre-pestana",
]);

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const HEARTBEAT_TIMEOUT_MS = 20_000;
const TICK_MS = 5_000;

type RunStatus = "lobby" | "running" | "ended";

interface ParticipantState {
  participantId: string;
  userId: string;
  name: string;
  status: "waiting" | "active" | "submitted" | "disconnected";
  lastSeen: number;
  ip: string;
  userAgent: string;
  currentQuestionId?: string;
}

interface LiveRunState {
  runId: string;
  title: string;
  status: RunStatus;
  timeLimitS: number;
  startedAt: number | null;
  endsAt: number | null;
  recordDisconnects: boolean;
  participants: Record<string, ParticipantState>;
}

interface SocketAttachment {
  role: "teacher" | "student";
  participantId?: string;
}

export interface SocketIdentity {
  role: "teacher" | "student";
  participantId?: string;
  userId?: string;
  name?: string;
  ip: string;
  userAgent: string;
}

const emptyRun = (): LiveRunState => ({
  runId: "",
  title: "",
  status: "lobby",
  timeLimitS: 0,
  startedAt: null,
  endsAt: null,
  recordDisconnects: true,
  participants: {},
});

export class ExamRunActor {
  private run: LiveRunState = emptyRun();
  private readonly sockets = new Map<WebSocket, SocketAttachment>();
  private readonly memory = new Map<string, unknown>();
  private timer: NodeJS.Timeout | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly runId: string) {}

  get isIdle(): boolean {
    return this.sockets.size === 0 && (this.run.status === "ended" || this.run.runId === "");
  }

  /** Serializa los comandos igual que el gating de entrada de un Durable Object. */
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.catch(() => undefined);
    return result;
  }

  async handle(path: string, searchParams: URLSearchParams, body: unknown): Promise<Response> {
    return this.serialize(async () => {
      if (!this.run.runId && path !== "/initialize") {
        await this.hydrate(searchParams.get("runId") ?? this.runId);
      }
      return this.dispatch(path, body);
    });
  }

  private async dispatch(path: string, body: unknown): Promise<Response> {
    if (path === "/state") return Response.json(this.publicState());

    if (path === "/initialize") {
      const input = body as Pick<LiveRunState, "runId" | "title" | "timeLimitS" | "recordDisconnects">;
      this.run = { ...emptyRun(), ...input };
      return Response.json(this.publicState());
    }

    if (path === "/join") {
      const input = body as { participantId: string; userId: string; name: string };
      const prior = this.run.participants[input.participantId];
      this.run.participants[input.participantId] = {
        participantId: input.participantId,
        userId: input.userId,
        name: input.name,
        status: prior?.status ?? (this.run.status === "running" ? "active" : "waiting"),
        lastSeen: Date.now(),
        ip: prior?.ip ?? "pending-socket",
        userAgent: prior?.userAgent ?? "pending-socket",
      };
      this.broadcast({ type: "participant-joined", participant: this.run.participants[input.participantId] });
      return Response.json(this.publicState());
    }

    if (path === "/start") {
      if (this.run.status !== "lobby") return Response.json({ error: "La sesión ya fue iniciada" }, { status: 409 });
      const now = Date.now();
      this.run.status = "running";
      this.run.startedAt = now;
      this.run.endsAt = now + this.run.timeLimitS * 1000;
      for (const participant of Object.values(this.run.participants)) participant.status = "active";
      await db.batch([
        db.prepare("UPDATE runs SET status = 'running', started_at = ?, ends_at = ? WHERE id = ?")
          .bind(now, this.run.endsAt, this.run.runId),
        db.prepare("UPDATE participants SET status = 'active' WHERE run_id = ? AND status = 'waiting'")
          .bind(this.run.runId),
      ]);
      this.schedule();
      this.broadcast({ type: "run-started", run: this.publicState() });
      return Response.json(this.publicState());
    }

    if (path === "/adjust-time") {
      const { deltaS } = body as { deltaS: number };
      if (this.run.status !== "running" || this.run.endsAt === null) {
        return Response.json({ error: "La sesión no está en curso" }, { status: 409 });
      }
      this.run.endsAt = Math.max(Date.now(), this.run.endsAt + Math.trunc(deltaS) * 1000);
      await db.prepare("UPDATE runs SET ends_at = ? WHERE id = ?").bind(this.run.endsAt, this.run.runId).run();
      this.schedule();
      this.broadcast({ type: "time-adjusted", endsAt: this.run.endsAt });
      return Response.json(this.publicState());
    }

    if (path === "/heartbeat") {
      const { participantId, questionId } = body as { participantId: string; questionId?: string };
      const participant = this.run.participants[participantId];
      if (!participant) return Response.json({ error: "Participante inexistente" }, { status: 404 });
      if (questionId) participant.currentQuestionId = questionId;
      await this.markSeen(participant);
      this.schedule();
      return Response.json({ serverNow: Date.now(), endsAt: this.run.endsAt, status: this.run.status });
    }

    if (path === "/incident") {
      const payload = (body ?? {}) as Record<string, unknown>;
      const participantId = String(payload.participantId ?? "");
      const incidentType = String(payload.incidentType ?? "");
      if (!this.run.participants[participantId] || !CLIENT_INCIDENT_TYPES.has(incidentType)) {
        return Response.json({ error: "Incidente inválido" }, { status: 400 });
      }
      if (!this.countIncident(participantId)) {
        return Response.json({ accepted: false, reason: "limit" }, { status: 429 });
      }
      const durationMs = Math.max(0, Math.min(Number(payload.durationMs) || 0, SIX_HOURS_MS));
      const meta = typeof payload.meta === "object" && payload.meta ? payload.meta : {};
      await this.recordIncident(participantId, incidentType, durationMs, meta, "client");
      this.broadcast({ type: "incident", participantId, incidentType, durationMs, source: "client", at: Date.now() });
      return Response.json({ accepted: true }, { status: 202 });
    }

    if (path === "/lifecycle") {
      const payload = body as { participantId: string; event: "hidden" | "pagehide"; at: number; questionId?: string };
      if (!this.run.participants[payload.participantId]) {
        return Response.json({ error: "Participante inexistente" }, { status: 404 });
      }
      if (payload.questionId) this.run.participants[payload.participantId].currentQuestionId = payload.questionId;
      this.memory.set(`lifecycle:${payload.participantId}`, { event: payload.event, at: payload.at });
      if (payload.event === "pagehide") {
        const dedupeKey = `pagehide-recorded:${payload.participantId}`;
        const prior = (this.memory.get(dedupeKey) as number | undefined) ?? 0;
        if (Date.now() - prior > 2_000) {
          this.memory.set(dedupeKey, Date.now());
          await this.recordIncident(payload.participantId, "cierre-pestana", 0, { event: payload.event, clientAt: payload.at }, "client");
          this.broadcast({ type: "incident", participantId: payload.participantId, incidentType: "cierre-pestana", durationMs: 0, source: "client", at: Date.now() });
        }
      }
      return new Response(null, { status: 202 });
    }

    if (path === "/answer-saved") {
      const payload = body as { participantId: string; questionId: string; questionType: string; at: number };
      const participant = this.run.participants[payload.participantId];
      if (!participant) return Response.json({ error: "Participante inexistente" }, { status: 404 });
      participant.lastSeen = Date.now();
      participant.currentQuestionId = payload.questionId;
      const key = `answer-times:${payload.participantId}`;
      const existing = (this.memory.get(key) as number[] | undefined) ?? [];
      const recent = [...existing.filter((time) => payload.at - time <= 11_000), payload.at].slice(-5);
      this.memory.set(key, recent);
      if (payload.questionType === "long" && recent.length >= 5) {
        const cadenceKey = `cadence-recorded:${payload.participantId}`;
        if (!this.memory.get(cadenceKey)) {
          this.memory.set(cadenceKey, true);
          await this.recordIncident(payload.participantId, "cadencia-respuestas", recent.at(-1)! - recent[0], { answers: recent.length }, "server");
          this.broadcast({ type: "incident", participantId: payload.participantId, incidentType: "cadencia-respuestas", source: "server", at: Date.now() });
        }
      }
      this.broadcast({ type: "answer-saved", participantId: payload.participantId, questionId: payload.questionId, at: Date.now() });
      this.schedule();
      return Response.json({ accepted: true, serverNow: Date.now() });
    }

    if (path === "/submit") {
      const payload = body as { participantId: string; reason: string; at: number };
      const participant = this.run.participants[payload.participantId];
      if (participant) participant.status = "submitted";
      this.broadcast({ type: "participant-submitted", participantId: payload.participantId, reason: payload.reason, at: payload.at });
      return Response.json({ accepted: true });
    }

    if (path === "/end") {
      await this.endRun("teacher");
      return Response.json(this.publicState());
    }

    return Response.json({ error: "Ruta no encontrada" }, { status: 404 });
  }

  // --- WebSockets -----------------------------------------------------------

  async accept(socket: WebSocket, identity: SocketIdentity): Promise<void> {
    // Los listeners se enganchan antes de la parte asíncrona: `ws` descarta los
    // mensajes que llegan sin listener, y el alumno puede mandar su primer
    // heartbeat mientras todavía se está resolviendo el alta. Como `onMessage`
    // pasa por la misma cola `serialize`, igual queda encolado detrás del alta y
    // ve el estado ya armado.
    socket.on("message", (data) => {
      void this.onMessage(socket, typeof data === "string" ? data : data.toString());
    });
    socket.on("close", () => {
      void this.onClose(socket);
    });
    socket.on("error", () => {
      void this.onClose(socket);
    });

    await this.serialize(async () => {
      if (!this.run.runId) await this.hydrate(this.runId);

      if (identity.role === "teacher") {
        this.sockets.set(socket, { role: "teacher" });
      } else {
        const participantId = identity.participantId!;
        const duplicate = this.socketsFor(participantId).length > 0;
        const prior = this.run.participants[participantId];
        this.sockets.set(socket, { role: "student", participantId });

        this.run.participants[participantId] = {
          participantId,
          userId: identity.userId ?? participantId,
          name: identity.name ?? "Alumno",
          status: prior?.status ?? (this.run.status === "running" ? "active" : "waiting"),
          lastSeen: Date.now(),
          ip: identity.ip,
          userAgent: identity.userAgent,
          currentQuestionId: prior?.currentQuestionId,
        };

        if (duplicate) await this.recordIncident(participantId, "sesion-duplicada", 0, {});
        if (shouldCompareConnectionValue(prior?.ip) && prior!.ip !== identity.ip) {
          await this.recordIncident(participantId, "cambio-ip", 0, { from: prior!.ip, to: identity.ip });
        }
        if (shouldCompareConnectionValue(prior?.userAgent) && prior!.userAgent !== identity.userAgent) {
          await this.recordIncident(participantId, "cambio-user-agent", 0, {
            from: prior!.userAgent,
            to: identity.userAgent,
          });
        }
        this.broadcast({ type: "participant-joined", participant: this.run.participants[participantId] });
      }

      this.send(socket, { type: "state", run: this.publicState(), serverNow: Date.now() });
    });
  }

  private async onMessage(socket: WebSocket, raw: string): Promise<void> {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    await this.serialize(async () => {
      const attachment = this.sockets.get(socket);
      if (!attachment?.participantId) return;

      if (payload.type === "heartbeat") {
        const participant = this.run.participants[attachment.participantId];
        if (!participant) return;
        await this.markSeen(participant);
        this.schedule();
        this.send(socket, { type: "heartbeat-ack", serverNow: Date.now(), endsAt: this.run.endsAt });
        return;
      }

      if (payload.type === "incident") {
        const incidentType = String(payload.incidentType ?? "");
        if (!CLIENT_INCIDENT_TYPES.has(incidentType)) return;
        if (!this.countIncident(attachment.participantId)) return;
        const durationMs = Math.max(0, Math.min(Number(payload.durationMs) || 0, SIX_HOURS_MS));
        const meta = typeof payload.meta === "object" && payload.meta ? payload.meta : {};
        await this.recordIncident(attachment.participantId, incidentType, durationMs, meta, "client");
        this.broadcast({
          type: "incident",
          participantId: attachment.participantId,
          incidentType,
          durationMs,
          source: "client",
          at: Date.now(),
        });
      }
    });
  }

  private async onClose(socket: WebSocket): Promise<void> {
    const attachment = this.sockets.get(socket);
    this.sockets.delete(socket);
    if (!attachment?.participantId || this.run.status !== "running") return;
    const participant = this.run.participants[attachment.participantId];
    if (participant) participant.lastSeen = Date.now();
    this.schedule();
  }

  private socketsFor(participantId: string): WebSocket[] {
    return [...this.sockets.entries()]
      .filter(([, attachment]) => attachment.participantId === participantId)
      .map(([socket]) => socket);
  }

  private send(socket: WebSocket, payload: unknown) {
    try {
      socket.send(JSON.stringify(payload));
    } catch {
      // El socket puede estar cerrándose; el evento `close` lo saca del mapa.
    }
  }

  private broadcast(payload: unknown) {
    const message = JSON.stringify(payload);
    for (const socket of this.sockets.keys()) {
      try {
        socket.send(message);
      } catch {
        // Igual que arriba: un socket a medio cerrar no debe cortar el reparto.
      }
    }
  }

  // --- Temporizador ---------------------------------------------------------

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.run.status !== "running" || this.run.endsAt === null) return;
    const delay = Math.max(0, Math.min(this.run.endsAt, Date.now() + TICK_MS) - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.serialize(() => this.tick());
    }, delay);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.run.status !== "running" || this.run.endsAt === null) return;

    const now = Date.now();
    if (now >= this.run.endsAt) {
      await this.endRun("timer");
      return;
    }

    for (const participant of Object.values(this.run.participants)) {
      if (participant.status === "active" && now - participant.lastSeen >= HEARTBEAT_TIMEOUT_MS) {
        participant.status = "disconnected";
        if (this.run.recordDisconnects) {
          await this.recordIncident(participant.participantId, "desconexion", 0, { lastSeen: participant.lastSeen });
        }
        await db.prepare("UPDATE participants SET status = 'disconnected' WHERE id = ? AND status = 'active'")
          .bind(participant.participantId)
          .run();
        this.broadcast({ type: "participant-disconnected", participantId: participant.participantId });
      }
    }

    this.schedule();
  }

  // --- Estado ---------------------------------------------------------------

  private publicState() {
    return {
      ...this.run,
      serverNow: Date.now(),
      participants: Object.values(this.run.participants),
    };
  }

  private countIncident(participantId: string): boolean {
    const key = `incident-count:${participantId}`;
    const count = (this.memory.get(key) as number | undefined) ?? 0;
    if (count >= 500) return false;
    this.memory.set(key, count + 1);
    return true;
  }

  private async markSeen(participant: ParticipantState): Promise<void> {
    participant.lastSeen = Date.now();
    if (participant.status === "disconnected") {
      participant.status = "active";
      this.broadcast({ type: "participant-reconnected", participantId: participant.participantId });
    }
    await db.prepare(
      "UPDATE participants SET last_seen = ?, status = CASE WHEN status = 'disconnected' THEN 'active' ELSE status END WHERE id = ?",
    ).bind(participant.lastSeen, participant.participantId).run();
  }

  private async hydrate(runId: string | null): Promise<void> {
    if (!runId) return;
    const row = await db.prepare(
      "SELECT id, title, status, time_limit_s, started_at, ends_at, record_disconnects FROM runs WHERE id = ?",
    ).bind(runId).first<{
      id: string;
      title: string;
      status: RunStatus;
      time_limit_s: number;
      started_at: number | null;
      ends_at: number | null;
      record_disconnects: number;
    }>();
    if (!row) return;
    const participants = await db.prepare(
      `SELECT p.id, p.user_id, p.status, p.last_seen, p.display_name AS name
       FROM participants p WHERE p.run_id = ?`,
    ).bind(row.id).all<{ id: string; user_id: string | null; status: ParticipantState["status"]; last_seen: number; name: string }>();
    this.run = {
      runId: row.id,
      title: row.title,
      status: row.status,
      timeLimitS: row.time_limit_s,
      startedAt: row.started_at,
      endsAt: row.ends_at,
      recordDisconnects: Boolean(row.record_disconnects),
      participants: Object.fromEntries(participants.results.map((participant) => [participant.id, {
        participantId: participant.id,
        userId: participant.user_id ?? participant.id,
        name: participant.name,
        status: participant.status,
        lastSeen: participant.last_seen,
        ip: "restored",
        userAgent: "restored",
      }])),
    };
    // Una toma que seguía en curso al reiniciar el proceso vuelve a vigilarse.
    this.schedule();
  }

  private async endRun(reason: "timer" | "teacher"): Promise<void> {
    if (this.run.status === "ended") return;
    this.run.status = "ended";
    this.run.endsAt = Math.min(this.run.endsAt ?? Date.now(), Date.now());
    const endedAt = Date.now();
    for (const participant of Object.values(this.run.participants)) {
      if (participant.status === "active" || participant.status === "disconnected") {
        await this.gradeAndSubmit(participant.participantId, reason === "timer" ? "timer" : "teacher");
        participant.status = "submitted";
      }
    }
    await db.prepare("UPDATE runs SET status = 'ended', ends_at = ?, ended_at = ? WHERE id = ?")
      .bind(this.run.endsAt, endedAt, this.run.runId)
      .run();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.broadcast({ type: "run-ended", reason, run: this.publicState() });
  }

  private async recordIncident(
    participantId: string,
    type: string,
    durationMs: number,
    meta: unknown,
    source: "client" | "server" = "server",
  ): Promise<void> {
    const participant = this.run.participants[participantId];
    const receivedMeta = typeof meta === "object" && meta ? meta as Record<string, unknown> : {};
    const questionId = typeof receivedMeta.questionId === "string" ? receivedMeta.questionId : participant?.currentQuestionId ?? null;
    // `duration_ms` es bigint. El esquema de la API acepta un número no entero
    // (z.number().min(0)) y D1 lo guardaba igual, pero Postgres rechaza "1234.5"
    // para un bigint y el incidente se perdería con un 500 en plena evaluación.
    const duration = Math.trunc(durationMs) || 0;
    await db.prepare(
      "INSERT INTO incidents (id, participant_id, at, duration_ms, type, question_id, meta, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(crypto.randomUUID(), participantId, Date.now(), duration, type, questionId, JSON.stringify({ ...receivedMeta, questionId }), source)
      .run();
  }

  private async gradeAndSubmit(participantId: string, reason: "timer" | "teacher"): Promise<void> {
    const run = await db.prepare("SELECT questions_snapshot FROM runs WHERE id = ?")
      .bind(this.run.runId)
      .first<{ questions_snapshot: string }>();
    if (!run) return;
    const answers = await db.prepare("SELECT question_id, value FROM answers WHERE participant_id = ?")
      .bind(participantId)
      .all<{ question_id: string; value: string }>();
    const result = gradeExam(
      JSON.parse(run.questions_snapshot) as FullQuestion[],
      answers.results.map((answer) => ({ questionId: answer.question_id, value: JSON.parse(answer.value) })),
    );
    const now = Date.now();
    const statements: PgStatement[] = [
      db.prepare(
        "UPDATE participants SET status = 'submitted', submitted_at = ?, submit_reason = ?, last_seen = ? WHERE id = ? AND status != 'submitted'",
      ).bind(now, reason, now, participantId),
    ];
    for (const grade of result.questions) {
      statements.push(
        db.prepare(
          `INSERT INTO grades (id, participant_id, question_id, auto, override, points_awarded)
           VALUES (?, ?, ?, ?, NULL, ?)
           ON CONFLICT(participant_id, question_id) DO UPDATE SET auto = excluded.auto, points_awarded = excluded.points_awarded`,
        ).bind(
          crypto.randomUUID(),
          participantId,
          grade.questionId,
          grade.auto === null ? null : grade.auto ? 1 : 0,
          grade.pointsAwarded,
        ),
      );
    }
    await db.batch(statements);
  }
}

// --- Registro de actores ----------------------------------------------------

// Igual que el pool de Postgres, el registro se cuelga de globalThis: el bundle
// SSR y el del upgrade de WebSocket son dos grafos de módulos distintos y tienen
// que ver el mismo actor por toma. Si cada uno tuviera el suyo, el `/start` del
// docente no llegaría a los sockets de los alumnos.
const ACTORS_KEY = Symbol.for("testra.examRunActors");
const globalStore = globalThis as typeof globalThis & { [ACTORS_KEY]?: Map<string, ExamRunActor> };

const actors: Map<string, ExamRunActor> = (globalStore[ACTORS_KEY] ??= new Map());

export function getRunActor(runId: string): ExamRunActor {
  let actor = actors.get(runId);
  if (!actor) {
    actor = new ExamRunActor(runId);
    actors.set(runId, actor);
  }
  return actor;
}

/**
 * Puerta de entrada equivalente a `stub.fetch()` del Durable Object. Mantiene la
 * firma y el tipo de retorno para que las rutas de la API no cambien, pero acá
 * es una llamada a un método: no hay serialización ni salto de red.
 */
export async function dispatchRunCommand(runId: string, pathWithQuery: string, body?: unknown): Promise<Response> {
  const [path, query = ""] = pathWithQuery.split("?");
  return getRunActor(runId).handle(path, new URLSearchParams(query), body);
}

/** Libera los actores de tomas terminadas que ya no tienen a nadie conectado. */
export function pruneIdleRunActors(): number {
  let removed = 0;
  for (const [runId, actor] of actors) {
    if (actor.isIdle) {
      actors.delete(runId);
      removed += 1;
    }
  }
  return removed;
}
