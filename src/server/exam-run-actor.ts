import type { WebSocket } from "ws";

import type { FullQuestion } from "@/domain/exam";
import { personalizeQuestions } from "@/domain/pool";
import { shouldCompareConnectionValue } from "@/server/connection-signals";
import { db, type PgStatement } from "@/server/db/client";
import { gradeExam } from "@/server/grading";
import { allDeadlinesComplete, normalizeExtraTime, participantDeadline, shiftDeadline } from "@/server/run-time";
import { nextWritingCadence, type WritingCadenceEntry } from "@/server/writing-cadence";

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

function eventStatement(participantId: string, type: string, actorUserId: string | null, at: number, meta: unknown): PgStatement {
  return db.prepare(
    "INSERT INTO participant_events (id, participant_id, at, type, actor_user_id, meta) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), participantId, at, type, actorUserId, JSON.stringify(meta ?? {}));
}

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
  extraTimeS: number;
  deadlineAt: number | null;
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

interface GradingRunSnapshot {
  questions_snapshot: string;
  shuffle_questions: number;
  shuffle_options: number;
  questions_to_serve: number | null;
  long_to_serve: number;
  section_quotas: string;
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

  /**
   * Escritura que no necesita el orden global de la cola. La registra el turno
   * que está corriendo y se ejecuta recién cuando el candado se soltó, así cien
   * heartbeats simultáneos van al pool en paralelo en vez de hacer fila.
   *
   * Se lee dentro del mismo turno serializado que la escribió, y los turnos no
   * se entrelazan, así que no se pueden mezclar entre comandos.
   */
  private deferred: (() => Promise<void>) | undefined;

  private defer(task: () => Promise<void>) {
    this.deferred = task;
  }

  private async withDeferred<T>(task: () => Promise<T>): Promise<T> {
    type Turn = { value: T; after: (() => Promise<void>) | undefined };
    const { value, after } = await this.serialize(async (): Promise<Turn> => {
      this.deferred = undefined;
      const value = await task();
      return { value, after: this.deferred };
    });
    if (after) {
      await after().catch((error) => console.error("[toma] falló una escritura diferida", error));
    }
    return value;
  }

  async handle(path: string, searchParams: URLSearchParams, body: unknown): Promise<Response> {
    return this.withDeferred(async () => {
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
        extraTimeS: prior?.extraTimeS ?? 0,
        deadlineAt: prior?.deadlineAt ?? this.run.endsAt,
      };
      this.broadcastToTeachers({ type: "participant-joined", participant: this.run.participants[input.participantId] });
      return Response.json(this.publicState());
    }

    if (path === "/start") {
      if (this.run.status !== "lobby") return Response.json({ error: "La sesión ya fue iniciada" }, { status: 409 });
      const now = Date.now();
      this.run.status = "running";
      this.run.startedAt = now;
      this.run.endsAt = now + this.run.timeLimitS * 1000;
      for (const participant of Object.values(this.run.participants)) {
        participant.status = "active";
        participant.deadlineAt = this.run.endsAt + participant.extraTimeS * 1000;
      }
      await db.batch([
        db.prepare("UPDATE runs SET status = 'running', started_at = ?, ends_at = ? WHERE id = ?")
          .bind(now, this.run.endsAt, this.run.runId),
        db.prepare("UPDATE participants SET status = 'active', deadline_at = ?::bigint + extra_time_s * 1000 WHERE run_id = ? AND status = 'waiting'")
          .bind(this.run.endsAt, this.run.runId),
        db.prepare(
          `INSERT INTO participant_events (id, participant_id, at, type, meta)
           SELECT gen_random_uuid()::text, id, ?, 'exam-started', '{}' FROM participants WHERE run_id = ?`,
        ).bind(now, this.run.runId),
      ]);
      this.schedule();
      this.broadcastRunState("run-started");
      return Response.json(this.publicState());
    }

    if (path === "/adjust-time") {
      const { deltaS } = body as { deltaS: number };
      if (this.run.status !== "running" || this.run.endsAt === null) {
        return Response.json({ error: "La sesión no está en curso" }, { status: 409 });
      }
      const deltaMs = Math.trunc(deltaS) * 1000;
      this.run.endsAt = Math.max(Date.now(), this.run.endsAt + deltaMs);
      await db.batch([
        db.prepare("UPDATE runs SET ends_at = ? WHERE id = ?").bind(this.run.endsAt, this.run.runId),
        db.prepare("UPDATE participants SET deadline_at = GREATEST(?, deadline_at + ?) WHERE run_id = ? AND deadline_at IS NOT NULL AND status != 'submitted'")
          .bind(Date.now(), deltaMs, this.run.runId),
      ]);
      for (const participant of Object.values(this.run.participants)) {
        if (participant.deadlineAt !== null && participant.status !== "submitted") {
          participant.deadlineAt = shiftDeadline(participant.deadlineAt, deltaS, Date.now());
        }
      }
      this.schedule();
      this.broadcastRunState("time-adjusted");
      return Response.json(this.publicState());
    }

    if (path === "/participant-time") {
      const { participantId, extraTimeS, actorUserId } = body as { participantId: string; extraTimeS: number; actorUserId: string };
      const participant = this.run.participants[participantId];
      if (!participant) return Response.json({ error: "Participante inexistente" }, { status: 404 });
      const normalized = normalizeExtraTime(extraTimeS);
      participant.extraTimeS = normalized;
      participant.deadlineAt = this.run.status === "running" && this.run.endsAt !== null
        ? participantDeadline(this.run.endsAt, normalized, Date.now())
        : null;
      const at = Date.now();
      await db.batch([
        db.prepare("UPDATE participants SET extra_time_s = ?, deadline_at = ? WHERE id = ? AND run_id = ?")
          .bind(normalized, participant.deadlineAt, participantId, this.run.runId),
        eventStatement(participantId, "extra-time-changed", actorUserId, at, { extraTimeS: normalized, deadlineAt: participant.deadlineAt }),
      ]);
      this.schedule();
      this.write(this.socketsFor(participantId), { type: "time-adjusted", endsAt: participant.deadlineAt, serverNow: at });
      this.broadcastToTeachers({ type: "participant-time-adjusted", participantId, extraTimeS: normalized, deadlineAt: participant.deadlineAt, at });
      return Response.json({ participantId, extraTimeS: normalized, deadlineAt: participant.deadlineAt });
    }

    if (path === "/reopen") {
      const { participantId, extraTimeS = 0, actorUserId } = body as { participantId: string; extraTimeS?: number; actorUserId: string };
      if (this.run.status !== "running" || this.run.endsAt === null) {
        return Response.json({ error: "Solo se puede reabrir mientras la sesión está en curso" }, { status: 409 });
      }
      const participant = this.run.participants[participantId];
      if (!participant || participant.status !== "submitted") {
        return Response.json({ error: "La entrega no está cerrada" }, { status: 409 });
      }
      const extra = normalizeExtraTime(extraTimeS);
      participant.status = "active";
      participant.extraTimeS += extra;
      participant.deadlineAt = Math.max(Date.now() + extra * 1000, participantDeadline(this.run.endsAt, participant.extraTimeS));
      const at = Date.now();
      await db.batch([
        db.prepare(
          `UPDATE participants SET status = 'active', submitted_at = NULL, submit_reason = NULL,
             extra_time_s = ?, deadline_at = ?, reopened_count = reopened_count + 1, last_seen = ?
           WHERE id = ? AND run_id = ? AND status = 'submitted'`,
        ).bind(participant.extraTimeS, participant.deadlineAt, at, participantId, this.run.runId),
        eventStatement(participantId, "submission-reopened", actorUserId, at, { extraTimeS: extra, deadlineAt: participant.deadlineAt }),
      ]);
      this.write(this.socketsFor(participantId), { type: "submission-reopened", endsAt: participant.deadlineAt, serverNow: at });
      this.broadcastToTeachers({ type: "participant-reopened", participantId, deadlineAt: participant.deadlineAt, at });
      this.schedule();
      return Response.json({ participantId, deadlineAt: participant.deadlineAt });
    }

    if (path === "/heartbeat") {
      const { participantId, questionId } = body as { participantId: string; questionId?: string };
      const participant = this.run.participants[participantId];
      if (!participant) return Response.json({ error: "Participante inexistente" }, { status: 404 });
      if (questionId) participant.currentQuestionId = questionId;
      this.markSeen(participant);
      this.schedule();
      return Response.json({ serverNow: Date.now(), endsAt: participant.deadlineAt ?? this.run.endsAt, status: this.run.status, participantStatus: participant.status });
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
      this.broadcastIncident(participantId, { type: "incident", participantId, incidentType, durationMs, source: "client", at: Date.now() });
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
          this.broadcastIncident(payload.participantId, { type: "incident", participantId: payload.participantId, incidentType: "cierre-pestana", durationMs: 0, source: "client", at: Date.now() });
        }
      }
      return new Response(null, { status: 202 });
    }

    if (path === "/answer-saved") {
      const payload = body as { participantId: string; questionId: string; questionType: string; answerLength: number; at: number };
      const participant = this.run.participants[payload.participantId];
      if (!participant) return Response.json({ error: "Participante inexistente" }, { status: 404 });
      participant.lastSeen = Date.now();
      participant.currentQuestionId = payload.questionId;
      // El ritmo no pretende detectar copia. Sólo queda como contexto cuando
      // hay varios desarrollos distintos y sustantivos en un lapso inusual.
      // Las opciones rápidas, respuestas cortas y autoguardados no participan.
      const key = `answer-times:${payload.participantId}`;
      const existing = (this.memory.get(key) as WritingCadenceEntry[] | undefined) ?? [];
      const cadence = nextWritingCadence(existing, payload);
      this.memory.set(key, cadence.recent);
      if (cadence.unusual) {
        const cadenceKey = `cadence-recorded:${payload.participantId}`;
        if (!this.memory.get(cadenceKey)) {
          this.memory.set(cadenceKey, true);
          const lapso = cadence.recent.at(-1)!.at - cadence.recent[0].at;
          await this.recordIncident(
            payload.participantId,
            "ritmo-desarrollo",
            lapso,
            { questions: cadence.recent.length, questionIds: cadence.recent.map((entry) => entry.questionId) },
            "server",
          );
          this.broadcastIncident(payload.participantId, { type: "incident", participantId: payload.participantId, incidentType: "ritmo-desarrollo", source: "server", at: Date.now() });
        }
      }
      this.broadcastToTeachers({ type: "answer-saved", participantId: payload.participantId, questionId: payload.questionId, at: Date.now() });
      this.schedule();
      return Response.json({ accepted: true, serverNow: Date.now() });
    }

    if (path === "/submit") {
      const payload = body as { participantId: string; reason: string; at: number };
      const participant = this.run.participants[payload.participantId];
      if (participant) participant.status = "submitted";
      await db.prepare(
        "INSERT INTO participant_events (id, participant_id, at, type, meta) VALUES (?, ?, ?, 'submitted', ?)",
      ).bind(crypto.randomUUID(), payload.participantId, payload.at, JSON.stringify({ reason: payload.reason })).run();
      this.broadcastToTeachers({ type: "participant-submitted", participantId: payload.participantId, reason: payload.reason, at: payload.at });
      return Response.json({ accepted: true });
    }

    if (path === "/end") {
      await this.endRun("teacher");
      return Response.json(this.publicState());
    }

    if (path === "/admin-end") {
      await this.endRun("admin");
      return Response.json(this.publicState());
    }

    if (path === "/expire-lobby") {
      if (this.run.status !== "lobby") return Response.json(this.publicState());
      await this.endRun("abandoned");
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
          extraTimeS: prior?.extraTimeS ?? 0,
          deadlineAt: prior?.deadlineAt ?? this.run.endsAt,
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
        this.broadcastToTeachers({ type: "participant-joined", participant: this.run.participants[participantId] });
      }

      this.send(socket, {
        type: "state",
        run: identity.role === "teacher" ? this.publicState() : this.studentState(identity.participantId),
        serverNow: Date.now(),
      });
    });
  }

  private async onMessage(socket: WebSocket, raw: string): Promise<void> {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    await this.withDeferred(async () => {
      const attachment = this.sockets.get(socket);
      if (!attachment?.participantId) return;

      if (payload.type === "heartbeat") {
        const participant = this.run.participants[attachment.participantId];
        if (!participant) return;
        this.markSeen(participant);
        this.schedule();
        this.send(socket, { type: "heartbeat-ack", serverNow: Date.now(), endsAt: participant.deadlineAt ?? this.run.endsAt });
        return;
      }

      if (payload.type === "incident") {
        const incidentType = String(payload.incidentType ?? "");
        if (!CLIENT_INCIDENT_TYPES.has(incidentType)) return;
        if (!this.countIncident(attachment.participantId)) return;
        const durationMs = Math.max(0, Math.min(Number(payload.durationMs) || 0, SIX_HOURS_MS));
        const meta = typeof payload.meta === "object" && payload.meta ? payload.meta : {};
        await this.recordIncident(attachment.participantId, incidentType, durationMs, meta, "client");
        this.broadcastIncident(attachment.participantId, {
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

  private write(sockets: Iterable<WebSocket>, payload: unknown) {
    const message = JSON.stringify(payload);
    for (const socket of sockets) {
      try {
        socket.send(message);
      } catch {
        // Un socket a medio cerrar no debe cortar el reparto al resto.
      }
    }
  }

  /**
   * Cambio de estado de la toma. Va a todos, pero cada rol recibe la vista que
   * le corresponde: el docente el estado completo, el alumno solo el reloj.
   */
  private broadcastRunState(type: string, extra: Record<string, unknown> = {}) {
    const forTeachers = JSON.stringify({ type, ...extra, run: this.publicState() });
    for (const [socket, attachment] of this.sockets) {
      try {
        socket.send(attachment.role === "teacher"
          ? forTeachers
          : JSON.stringify({ type, ...extra, run: this.studentState(attachment.participantId) }));
      } catch {
        // Un socket a medio cerrar no debe cortar el reparto al resto.
      }
    }
  }

  /**
   * Eventos de seguimiento. Van solo a los docentes, por dos razones.
   *
   * De privacidad: `participant-joined` lleva la IP y el user agent del alumno,
   * y los incidentes dicen quién perdió el foco o cambió de pestaña. Eso no
   * tiene por qué llegarle al resto del curso.
   *
   * De escala: el reparto a todos era cuadrático. Con 100 alumnos guardando
   * respuestas, cada guardado se repetía 101 veces y el aula recibía ~36.000
   * mensajes en 30 segundos que el cliente del alumno descartaba enteros.
   */
  private broadcastToTeachers(payload: unknown) {
    const teachers: WebSocket[] = [];
    for (const [socket, attachment] of this.sockets) {
      if (attachment.role === "teacher") teachers.push(socket);
    }
    if (teachers.length) this.write(teachers, payload);
  }

  /**
   * Un incidente va a los docentes y al alumno al que le corresponde. El alumno
   * tiene que poder ver toda señal registrada sobre él en el momento en que
   * ocurre; el resto del curso, ninguna.
   */
  private broadcastIncident(participantId: string, payload: unknown) {
    const targets: WebSocket[] = [];
    for (const [socket, attachment] of this.sockets) {
      if (attachment.role === "teacher" || attachment.participantId === participantId) targets.push(socket);
    }
    if (targets.length) this.write(targets, payload);
  }

  // --- Temporizador ---------------------------------------------------------

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.run.status !== "running" || this.run.endsAt === null) return;
    const deadlines = Object.values(this.run.participants)
      .filter((participant) => participant.status !== "submitted" && participant.deadlineAt !== null)
      .map((participant) => participant.deadlineAt!);
    const nextDeadline = deadlines.length ? Math.min(...deadlines) : this.run.endsAt;
    const delay = Math.max(0, Math.min(nextDeadline, Date.now() + TICK_MS) - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.serialize(() => this.tick());
    }, delay);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.run.status !== "running" || this.run.endsAt === null) return;

    const now = Date.now();
    for (const participant of Object.values(this.run.participants)) {
      if (participant.status !== "submitted" && participant.deadlineAt !== null && now >= participant.deadlineAt) {
        await this.gradeAndSubmit(participant.participantId, "timer");
        participant.status = "submitted";
        this.write(this.socketsFor(participant.participantId), { type: "participant-deadline", serverNow: now });
        this.broadcastToTeachers({ type: "participant-submitted", participantId: participant.participantId, reason: "timer", at: now });
      }
    }

    for (const participant of Object.values(this.run.participants)) {
      if (participant.status === "active" && now - participant.lastSeen >= HEARTBEAT_TIMEOUT_MS) {
        participant.status = "disconnected";
        if (this.run.recordDisconnects) {
          await this.recordIncident(participant.participantId, "desconexion", 0, { lastSeen: participant.lastSeen });
        }
        await db.batch([
          db.prepare("UPDATE participants SET status = 'disconnected' WHERE id = ? AND status = 'active'").bind(participant.participantId),
          eventStatement(participant.participantId, "disconnected", null, now, { lastSeen: participant.lastSeen }),
        ]);
        this.broadcastToTeachers({ type: "participant-disconnected", participantId: participant.participantId });
      }
    }

    if (allDeadlinesComplete(this.run.endsAt, now, Object.values(this.run.participants).map((participant) => participant.status))) {
      await this.endRun("timer");
      return;
    }

    this.schedule();
  }

  // --- Estado ---------------------------------------------------------------

  /** Vista completa de la toma. Solo para docentes: incluye IP y user agent. */
  private publicState() {
    return {
      ...this.run,
      serverNow: Date.now(),
      participants: Object.values(this.run.participants),
    };
  }

  /**
   * Vista para el alumno: el reloj y el estado de la toma, nada del resto del
   * curso. Es lo único que consume student-runtime.tsx, y evita mandarle la
   * lista de participantes con la IP y el user agent de sus compañeros.
   */
  private studentState(participantId?: string) {
    const participant = participantId ? this.run.participants[participantId] : undefined;
    return {
      runId: this.run.runId,
      title: this.run.title,
      status: this.run.status,
      timeLimitS: this.run.timeLimitS,
      startedAt: this.run.startedAt,
      endsAt: participant?.deadlineAt ?? this.run.endsAt,
      serverNow: Date.now(),
    };
  }

  private countIncident(participantId: string): boolean {
    const key = `incident-count:${participantId}`;
    const count = (this.memory.get(key) as number | undefined) ?? 0;
    if (count >= 500) return false;
    this.memory.set(key, count + 1);
    return true;
  }

  /**
   * El estado en memoria es el que manda para detectar desconexiones, así que
   * se actualiza en el acto. La copia en Postgres —que es la que ve el panel del
   * docente— se difiere: es una fila por alumno, sin orden entre sí.
   */
  private markSeen(participant: ParticipantState): void {
    const reconnected = participant.status === "disconnected";
    participant.lastSeen = Date.now();
    if (reconnected) {
      participant.status = "active";
      this.broadcastToTeachers({ type: "participant-reconnected", participantId: participant.participantId });
    }
    const lastSeen = participant.lastSeen;
    const participantId = participant.participantId;
    this.defer(async () => {
      const statements = [db.prepare(
        "UPDATE participants SET last_seen = ?, status = CASE WHEN status = 'disconnected' THEN 'active' ELSE status END WHERE id = ?",
      ).bind(lastSeen, participantId)];
      if (reconnected) statements.push(eventStatement(participantId, "reconnected", null, lastSeen, {}));
      await db.batch(statements);
    });
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
      `SELECT p.id, p.user_id, p.status, p.last_seen, p.display_name AS name, p.extra_time_s, p.deadline_at
       FROM participants p WHERE p.run_id = ?`,
    ).bind(row.id).all<{ id: string; user_id: string | null; status: ParticipantState["status"]; last_seen: number; name: string; extra_time_s: number; deadline_at: number | null }>();
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
        extraTimeS: participant.extra_time_s,
        deadlineAt: participant.deadline_at,
      }])),
    };
    // Una toma que seguía en curso al reiniciar el proceso vuelve a vigilarse.
    this.schedule();
  }

  private async endRun(reason: "timer" | "teacher" | "admin" | "abandoned"): Promise<void> {
    if (this.run.status === "ended") return;
    this.run.status = "ended";
    this.run.endsAt = Math.min(this.run.endsAt ?? Date.now(), Date.now());
    const endedAt = Date.now();
    // Persistir el cierre antes de corregir impide que una ruta de guardado que
    // corre en paralelo siga aceptando respuestas durante el cierre.
    await db.prepare("UPDATE runs SET status = 'ended', ends_at = ?, ended_at = ? WHERE id = ?")
      .bind(this.run.endsAt, endedAt, this.run.runId)
      .run();
    const pending = Object.values(this.run.participants).filter(
      (participant) => participant.status === "active" || participant.status === "disconnected",
    );
    const gradingRun = await this.loadGradingRun();
    // El cierre de un aula grande no debe repetir la misma consulta de la toma
    // por alumno ni corregir cientos de entregas estrictamente en serie. Se usa
    // concurrencia acotada para aprovechar el pool sin inundar Postgres.
    for (let index = 0; index < pending.length; index += 20) {
      const batch = pending.slice(index, index + 20);
      await Promise.all(batch.map(async (participant) => {
        await this.gradeAndSubmit(participant.participantId, reason === "timer" ? "timer" : "teacher", gradingRun);
        participant.status = "submitted";
      }));
    }

    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.broadcastRunState("run-ended", { reason });
    this.memory.clear();
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

  private async loadGradingRun(): Promise<GradingRunSnapshot | null> {
    return db.prepare("SELECT questions_snapshot, shuffle_questions, shuffle_options, questions_to_serve, long_to_serve, section_quotas FROM runs WHERE id = ?")
      .bind(this.run.runId)
      .first<GradingRunSnapshot>();
  }

  private async gradeAndSubmit(participantId: string, reason: "timer" | "teacher", snapshot?: GradingRunSnapshot | null): Promise<void> {
    const run = snapshot ?? await this.loadGradingRun();
    if (!run) return;
    const answers = await db.prepare("SELECT question_id, value FROM answers WHERE participant_id = ?")
      .bind(participantId)
      .all<{ question_id: string; value: string }>();
    let sectionQuotas: Record<string, number> = {};
    try { sectionQuotas = JSON.parse(run.section_quotas) as Record<string, number>; } catch { /* compatibilidad con tomas viejas */ }
    const assignedQuestions = personalizeQuestions(
      JSON.parse(run.questions_snapshot) as FullQuestion[],
      `${this.run.runId}:${participantId}`,
      Boolean(run.shuffle_questions),
      Boolean(run.shuffle_options),
      run.questions_to_serve,
      run.long_to_serve,
      sectionQuotas,
    );
    const result = gradeExam(
      assignedQuestions,
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

/**
 * Barrido durable: decide por created_at en Postgres, por lo que tambien
 * encuentra salas vencidas durante un reinicio. El actor solo distribuye el
 * cierre a los sockets que sigan conectados.
 */
export async function closeAbandonedLobbyRuns(now = Date.now()): Promise<number> {
  const cutoff = abandonedLobbyCutoff(now);
  const stale = await db.prepare("SELECT id FROM runs WHERE status = 'lobby' AND started_at IS NULL AND created_at <= ?")
    .bind(cutoff).all<{ id: string }>();
  for (const row of stale.results) await dispatchRunCommand(row.id, "/expire-lobby");
  return stale.results.length;
}

export function abandonedLobbyCutoff(now: number) {
  return now - 60 * 60 * 1000;
}
