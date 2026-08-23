import { DurableObject } from "cloudflare:workers";

import type { FullQuestion } from "@/domain/exam";
import { gradeExam } from "@/server/grading";

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

type RunStatus = "lobby" | "running" | "ended";

interface ParticipantState {
  participantId: string;
  userId: string;
  name: string;
  status: "waiting" | "active" | "submitted" | "disconnected";
  lastSeen: number;
  ip: string;
  userAgent: string;
}

interface LiveRunState {
  runId: string;
  title: string;
  status: RunStatus;
  timeLimitS: number;
  startedAt: number | null;
  endsAt: number | null;
  participants: Record<string, ParticipantState>;
}

interface SocketAttachment {
  role: "teacher" | "student";
  participantId?: string;
}

const emptyRun = (): LiveRunState => ({
  runId: "",
  title: "",
  status: "lobby",
  timeLimitS: 0,
  startedAt: null,
  endsAt: null,
  participants: {},
});

export class ExamRunDO extends DurableObject<CloudflareEnv> {
  private run: LiveRunState = emptyRun();

  constructor(context: DurableObjectState, env: CloudflareEnv) {
    super(context, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.run = (await this.ctx.storage.get<LiveRunState>("run")) ?? emptyRun();
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (!this.run.runId && url.pathname !== "/initialize") {
      await this.hydrateFromDatabase(url.searchParams.get("runId"));
    }

    if (url.pathname === "/connect") return this.acceptConnection(request, url);
    if (url.pathname === "/state" && request.method === "GET") {
      return Response.json(this.publicState());
    }
    if (request.method !== "POST") return Response.json({ error: "Método no permitido" }, { status: 405 });

    if (url.pathname === "/initialize") {
      const input = (await request.json()) as Pick<LiveRunState, "runId" | "title" | "timeLimitS">;
      this.run = { ...emptyRun(), ...input };
      await this.persist();
      return Response.json(this.publicState());
    }

    if (url.pathname === "/join") {
      const input = (await request.json()) as { participantId: string; userId: string; name: string };
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
      await this.persist();
      this.broadcast({ type: "participant-joined", participant: this.run.participants[input.participantId] });
      return Response.json(this.publicState());
    }

    if (url.pathname === "/start") {
      if (this.run.status !== "lobby") return Response.json({ error: "La sesión ya fue iniciada" }, { status: 409 });
      const now = Date.now();
      this.run.status = "running";
      this.run.startedAt = now;
      this.run.endsAt = now + this.run.timeLimitS * 1000;
      for (const participant of Object.values(this.run.participants)) participant.status = "active";
      await this.env.DB.prepare(
        "UPDATE runs SET status = 'running', started_at = ?, ends_at = ? WHERE id = ?",
      ).bind(now, this.run.endsAt, this.run.runId).run();
      await this.env.DB.prepare(
        "UPDATE participants SET status = 'active' WHERE run_id = ? AND status = 'waiting'",
      ).bind(this.run.runId).run();
      await this.persistAndSchedule();
      this.broadcast({ type: "run-started", run: this.publicState() });
      return Response.json(this.publicState());
    }

    if (url.pathname === "/adjust-time") {
      const { deltaS } = (await request.json()) as { deltaS: number };
      if (this.run.status !== "running" || this.run.endsAt === null) {
        return Response.json({ error: "La sesión no está en curso" }, { status: 409 });
      }
      this.run.endsAt = Math.max(Date.now(), this.run.endsAt + Math.trunc(deltaS) * 1000);
      await this.env.DB.prepare("UPDATE runs SET ends_at = ? WHERE id = ?")
        .bind(this.run.endsAt, this.run.runId)
        .run();
      await this.persistAndSchedule();
      this.broadcast({ type: "time-adjusted", endsAt: this.run.endsAt });
      return Response.json(this.publicState());
    }

    if (url.pathname === "/heartbeat") {
      const { participantId } = (await request.json()) as { participantId: string };
      const participant = this.run.participants[participantId];
      if (!participant) return Response.json({ error: "Participante inexistente" }, { status: 404 });
      participant.lastSeen = Date.now();
      if (participant.status === "disconnected") {
        participant.status = "active";
        this.broadcast({ type: "participant-reconnected", participantId });
      }
      await this.env.DB.prepare(
        "UPDATE participants SET last_seen = ?, status = CASE WHEN status = 'disconnected' THEN 'active' ELSE status END WHERE id = ?",
      ).bind(participant.lastSeen, participantId).run();
      await this.persistAndSchedule();
      return Response.json({ serverNow: Date.now(), endsAt: this.run.endsAt, status: this.run.status });
    }

    if (url.pathname === "/incident") {
      const payload = (await request.json()) as Record<string, unknown>;
      const participantId = String(payload.participantId ?? "");
      const incidentType = String(payload.incidentType ?? "");
      if (!this.run.participants[participantId] || !CLIENT_INCIDENT_TYPES.has(incidentType)) {
        return Response.json({ error: "Incidente inválido" }, { status: 400 });
      }
      const countKey = `incident-count:${participantId}`;
      const count = (await this.ctx.storage.get<number>(countKey)) ?? 0;
      if (count >= 500) return Response.json({ accepted: false, reason: "limit" }, { status: 429 });
      await this.ctx.storage.put(countKey, count + 1);
      const durationMs = Math.max(0, Math.min(Number(payload.durationMs) || 0, SIX_HOURS_MS));
      const meta = typeof payload.meta === "object" && payload.meta ? payload.meta : {};
      await this.recordIncident(participantId, incidentType, durationMs, meta, "client");
      this.broadcast({ type: "incident", participantId, incidentType, durationMs, source: "client", at: Date.now() });
      return Response.json({ accepted: true }, { status: 202 });
    }

    if (url.pathname === "/lifecycle") {
      const payload = (await request.json()) as { participantId: string; event: "hidden" | "pagehide"; at: number };
      if (!this.run.participants[payload.participantId]) {
        return Response.json({ error: "Participante inexistente" }, { status: 404 });
      }
      await this.ctx.storage.put(`lifecycle:${payload.participantId}`, { event: payload.event, at: payload.at });
      if (payload.event === "pagehide") {
        const dedupeKey = `pagehide-recorded:${payload.participantId}`;
        const prior = (await this.ctx.storage.get<number>(dedupeKey)) ?? 0;
        if (Date.now() - prior > 2_000) {
          await this.ctx.storage.put(dedupeKey, Date.now());
          await this.recordIncident(payload.participantId, "cierre-pestana", 0, { event: payload.event, clientAt: payload.at }, "client");
          this.broadcast({ type: "incident", participantId: payload.participantId, incidentType: "cierre-pestana", durationMs: 0, source: "client", at: Date.now() });
        }
      }
      return new Response(null, { status: 202 });
    }

    if (url.pathname === "/answer-saved") {
      const payload = (await request.json()) as { participantId: string; questionId: string; questionType: string; at: number };
      const participant = this.run.participants[payload.participantId];
      if (!participant) return Response.json({ error: "Participante inexistente" }, { status: 404 });
      participant.lastSeen = Date.now();
      const key = `answer-times:${payload.participantId}`;
      const existing = (await this.ctx.storage.get<number[]>(key)) ?? [];
      const recent = [...existing.filter((time) => payload.at - time <= 11_000), payload.at].slice(-5);
      await this.ctx.storage.put(key, recent);
      if (payload.questionType === "long" && recent.length >= 5) {
        const cadenceKey = `cadence-recorded:${payload.participantId}`;
        if (!(await this.ctx.storage.get<boolean>(cadenceKey))) {
          await this.ctx.storage.put(cadenceKey, true);
          await this.recordIncident(payload.participantId, "cadencia-respuestas", recent.at(-1)! - recent[0], { answers: recent.length }, "server");
          this.broadcast({ type: "incident", participantId: payload.participantId, incidentType: "cadencia-respuestas", source: "server", at: Date.now() });
        }
      }
      this.broadcast({ type: "answer-saved", participantId: payload.participantId, questionId: payload.questionId, at: Date.now() });
      await this.persistAndSchedule();
      return Response.json({ accepted: true, serverNow: Date.now() });
    }

    if (url.pathname === "/submit") {
      const payload = (await request.json()) as { participantId: string; reason: string; at: number };
      const participant = this.run.participants[payload.participantId];
      if (participant) participant.status = "submitted";
      await this.persist();
      this.broadcast({ type: "participant-submitted", participantId: payload.participantId, reason: payload.reason, at: payload.at });
      return Response.json({ accepted: true });
    }

    if (url.pathname === "/end") {
      await this.endRun("teacher");
      return Response.json(this.publicState());
    }

    return Response.json({ error: "Ruta no encontrada" }, { status: 404 });
  }

  async alarm(): Promise<void> {
    if (this.run.status !== "running" || this.run.endsAt === null) return;

    const now = Date.now();
    if (now >= this.run.endsAt) {
      await this.endRun("timer");
      return;
    }

    for (const participant of Object.values(this.run.participants)) {
      if (participant.status === "active" && now - participant.lastSeen >= HEARTBEAT_TIMEOUT_MS) {
        participant.status = "disconnected";
        await this.recordIncident(participant.participantId, "desconexion", 0, {
          lastSeen: participant.lastSeen,
        });
        await this.env.DB.prepare("UPDATE participants SET status = 'disconnected' WHERE id = ? AND status = 'active'")
          .bind(participant.participantId)
          .run();
        this.broadcast({ type: "participant-disconnected", participantId: participant.participantId });
      }
    }

    await this.persistAndSchedule();
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    const payload = JSON.parse(message) as Record<string, unknown>;

    if (payload.type === "heartbeat" && attachment?.participantId) {
      const participant = this.run.participants[attachment.participantId];
      if (!participant) return;
      participant.lastSeen = Date.now();
      if (participant.status === "disconnected") {
        participant.status = "active";
        this.broadcast({ type: "participant-reconnected", participantId: participant.participantId });
      }
      await this.persistAndSchedule();
      await this.env.DB.prepare(
        "UPDATE participants SET last_seen = ?, status = CASE WHEN status = 'disconnected' THEN 'active' ELSE status END WHERE id = ?",
      ).bind(participant.lastSeen, participant.participantId).run();
      socket.send(JSON.stringify({ type: "heartbeat-ack", serverNow: Date.now(), endsAt: this.run.endsAt }));
      return;
    }

    if (payload.type === "incident" && attachment?.participantId) {
      const incidentType = String(payload.incidentType ?? "");
      if (!CLIENT_INCIDENT_TYPES.has(incidentType)) return;
      const countKey = `incident-count:${attachment.participantId}`;
      const count = (await this.ctx.storage.get<number>(countKey)) ?? 0;
      if (count >= 500) return;
      await this.ctx.storage.put(countKey, count + 1);
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
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    if (!attachment?.participantId || this.run.status !== "running") return;
    const participant = this.run.participants[attachment.participantId];
    if (participant) participant.lastSeen = Date.now();
    await this.persistAndSchedule();
  }

  private async acceptConnection(request: Request, url: URL): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return Response.json({ error: "Se esperaba WebSocket" }, { status: 426 });
    }

    const role = url.searchParams.get("role") === "teacher" ? "teacher" : "student";
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    if (role === "teacher") {
      this.ctx.acceptWebSocket(server, ["teacher"]);
      server.serializeAttachment({ role } satisfies SocketAttachment);
    } else {
      const participantId = url.searchParams.get("participantId");
      const userId = url.searchParams.get("userId");
      if (!participantId || !userId) return Response.json({ error: "Falta identidad" }, { status: 400 });
      const tag = `participant:${participantId}`;
      const duplicate = this.ctx.getWebSockets(tag).length > 0;
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const userAgent = request.headers.get("User-Agent") ?? "unknown";
      const prior = this.run.participants[participantId];

      this.ctx.acceptWebSocket(server, ["student", tag]);
      server.serializeAttachment({ role, participantId } satisfies SocketAttachment);

      this.run.participants[participantId] = {
        participantId,
        userId,
        name: url.searchParams.get("name") ?? "Alumno",
        status: prior?.status ?? (this.run.status === "running" ? "active" : "waiting"),
        lastSeen: Date.now(),
        ip,
        userAgent,
      };

      if (duplicate) await this.recordIncident(participantId, "sesion-duplicada", 0, {});
      if (prior && prior.ip !== ip) await this.recordIncident(participantId, "cambio-ip", 0, { from: prior.ip, to: ip });
      if (prior && prior.userAgent !== userAgent) {
        await this.recordIncident(participantId, "cambio-user-agent", 0, {
          from: prior.userAgent,
          to: userAgent,
        });
      }
      await this.persist();
      this.broadcast({ type: "participant-joined", participant: this.run.participants[participantId] });
    }

    server.send(JSON.stringify({ type: "state", run: this.publicState(), serverNow: Date.now() }));
    return new Response(null, { status: 101, webSocket: client });
  }

  private publicState() {
    return {
      ...this.run,
      serverNow: Date.now(),
      participants: Object.values(this.run.participants),
    };
  }

  private broadcast(payload: unknown) {
    const message = JSON.stringify(payload);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
      } catch {
        // Hibernation may expose a socket while it is finishing its close handshake.
      }
    }
  }

  private async persist() {
    await this.ctx.storage.put("run", this.run);
  }

  private async hydrateFromDatabase(runId: string | null) {
    if (!runId) return;
    const row = await this.env.DB.prepare(
      "SELECT id, title, status, time_limit_s, started_at, ends_at FROM runs WHERE id = ?",
    ).bind(runId).first<{
      id: string;
      title: string;
      status: RunStatus;
      time_limit_s: number;
      started_at: number | null;
      ends_at: number | null;
    }>();
    if (!row) return;
    const participants = await this.env.DB.prepare(
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
    await this.persist();
  }

  private async persistAndSchedule() {
    await this.persist();
    if (this.run.status === "running" && this.run.endsAt !== null) {
      await this.ctx.storage.setAlarm(Math.min(this.run.endsAt, Date.now() + 5_000));
    }
  }

  private async endRun(reason: "timer" | "teacher") {
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
    await this.env.DB.prepare(
      "UPDATE runs SET status = 'ended', ends_at = ?, ended_at = ? WHERE id = ?",
    ).bind(this.run.endsAt, endedAt, this.run.runId).run();
    await this.persist();
    await this.ctx.storage.deleteAlarm();
    this.broadcast({ type: "run-ended", reason, run: this.publicState() });
  }

  private async recordIncident(
    participantId: string,
    type: string,
    durationMs: number,
    meta: unknown,
    source: "client" | "server" = "server",
  ) {
    await this.env.DB.prepare(
      "INSERT INTO incidents (id, participant_id, at, duration_ms, type, meta, source) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(crypto.randomUUID(), participantId, Date.now(), durationMs, type, JSON.stringify(meta), source)
      .run();
  }

  private async gradeAndSubmit(participantId: string, reason: "timer" | "teacher") {
    const run = await this.env.DB.prepare("SELECT questions_snapshot FROM runs WHERE id = ?")
      .bind(this.run.runId)
      .first<{ questions_snapshot: string }>();
    if (!run) return;
    const answers = await this.env.DB.prepare(
      "SELECT question_id, value FROM answers WHERE participant_id = ?",
    ).bind(participantId).all<{ question_id: string; value: string }>();
    const result = gradeExam(
      JSON.parse(run.questions_snapshot) as FullQuestion[],
      answers.results.map((answer) => ({ questionId: answer.question_id, value: JSON.parse(answer.value) })),
    );
    const now = Date.now();
    const statements: D1PreparedStatement[] = [
      this.env.DB.prepare(
        "UPDATE participants SET status = 'submitted', submitted_at = ?, submit_reason = ?, last_seen = ? WHERE id = ? AND status != 'submitted'",
      ).bind(now, reason, now, participantId),
    ];
    for (const grade of result.questions) {
      statements.push(
        this.env.DB.prepare(
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
    await this.env.DB.batch(statements);
  }
}
