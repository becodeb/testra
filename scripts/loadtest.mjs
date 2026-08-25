// Prueba de carga de una toma en vivo. Simula un aula entera contra un servidor
// ya levantado: cada alumno es una sesión de invitado real, con su cookie, su
// WebSocket y su ritmo de guardado.
//
//   node scripts/loadtest.mjs                       100 alumnos
//   node scripts/loadtest.mjs --students=250        otro tamaño
//   node scripts/loadtest.mjs --seconds=60          fase sostenida más larga
//   node scripts/loadtest.mjs --base=http://host:3000
//
// El servidor tiene que estar corriendo con ALLOW_DEMO_AUTH=true (el docente de
// la prueba es el docente demo) y con el seed cargado.
//
// NO apuntar esto a producción.

import { WebSocket } from "ws";

const args = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const [key, value = "true"] = argument.replace(/^--/, "").split("=");
    return [key, value];
  }),
);

const BASE = args.base ?? "http://127.0.0.1:3000";
const STUDENTS = Number(args.students ?? 100);
const SECONDS = Number(args.seconds ?? 30);
const EXAM_ID = args.exam ?? "exam-biology-demo";
const ANSWER_EVERY_MS = Number(args["answer-every"] ?? 8000);
const HEARTBEAT_EVERY_MS = 5000;
const BURST = args.burst === "true";

if (BASE.includes("becode.com.ar") || BASE.includes("workers.dev")) {
  console.error("Esta prueba no se corre contra producción.");
  process.exit(1);
}

const wsBase = BASE.replace(/^http/, "ws");

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function summarize(label, values, unit = "ms") {
  if (!values.length) return `${label}: sin datos`;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return `${label}: n=${values.length}  p50=${percentile(values, 50)}${unit}  p95=${percentile(values, 95)}${unit}  max=${Math.max(...values)}${unit}  media=${mean.toFixed(1)}${unit}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Docente ---------------------------------------------------------------

async function createRun() {
  const response = await fetch(`${BASE}/api/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ examId: EXAM_ID }),
  });
  if (!response.ok) throw new Error(`no se pudo crear la toma: ${response.status} ${await response.text()}`);
  return response.json();
}

async function control(runId, body) {
  const response = await fetch(`${BASE}/api/runs/${runId}/control`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`control ${body.action}: ${response.status} ${await response.text()}`);
  return response.json();
}

// --- Alumnos ---------------------------------------------------------------

async function joinAsGuest(code, name) {
  const response = await fetch(`${BASE}/api/student/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, name }),
  });
  if (!response.ok) throw new Error(`join: ${response.status} ${await response.text()}`);
  const raw = response.headers.getSetCookie?.() ?? [];
  const cookie = raw.map((value) => value.split(";")[0]).find((value) => value.startsWith("testra_student_session="));
  if (!cookie) throw new Error("el join no devolvió la cookie de invitado");
  // La cookie es `participantId.token`, así que de ahí sale la identidad.
  const value = decodeURIComponent(cookie.slice("testra_student_session=".length));
  return { cookie, participantId: value.slice(0, value.indexOf(".")) };
}

class Student {
  constructor(index, runId) {
    this.index = index;
    this.runId = runId;
    this.name = `Alumno de prueba ${String(index).padStart(3, "0")}`;
    this.received = 0;
    this.byType = new Map();
    this.startLatency = null;
    this.endLatency = null;
    this.heartbeatRtt = [];
    this.answerLatency = [];
    this.errors = [];
    this.pendingHeartbeat = null;
  }

  async join(code) {
    const { cookie, participantId } = await joinAsGuest(code, this.name);
    this.cookie = cookie;
    this.participantId = participantId;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const url = `${wsBase}/api/runs/${encodeURIComponent(this.runId)}/socket?role=student&participantId=${encodeURIComponent(this.participantId)}`;
      this.socket = new WebSocket(url, { headers: { cookie: this.cookie } });
      const timer = setTimeout(() => reject(new Error("timeout al abrir el socket")), 20_000);
      this.socket.on("open", () => { clearTimeout(timer); resolve(); });
      this.socket.on("error", (error) => { clearTimeout(timer); this.errors.push(error.message); reject(error); });
      this.socket.on("message", (raw) => this.onMessage(raw));
    });
  }

  onMessage(raw) {
    const now = Date.now();
    this.received += 1;
    let payload;
    try { payload = JSON.parse(raw.toString()); } catch { return; }
    this.byType.set(payload.type, (this.byType.get(payload.type) ?? 0) + 1);

    if (payload.type === "run-started" && this.startLatency === null) {
      // El propio servidor sella el frame, así que esto mide servidor -> cliente.
      this.startLatency = now - payload.run.serverNow;
    }
    if (payload.type === "run-ended" && this.endLatency === null) {
      this.endLatency = now - payload.run.serverNow;
    }
    if (payload.type === "heartbeat-ack" && this.pendingHeartbeat !== null) {
      this.heartbeatRtt.push(now - this.pendingHeartbeat);
      this.pendingHeartbeat = null;
    }
  }

  heartbeat() {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.pendingHeartbeat = Date.now();
    this.socket.send(JSON.stringify({ type: "heartbeat" }));
  }

  async saveAnswer(questionId, value) {
    const started = Date.now();
    try {
      const response = await fetch(`${BASE}/api/student/answer`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: this.cookie },
        body: JSON.stringify({ participantId: this.participantId, questionId, value }),
      });
      if (!response.ok) {
        this.errors.push(`answer ${response.status}: ${(await response.text()).slice(0, 80)}`);
        return;
      }
      await response.json();
      this.answerLatency.push(Date.now() - started);
    } catch (error) {
      this.errors.push(`answer: ${error.message}`);
    }
  }

  close() {
    this.socket?.close();
  }
}

// --- Ejecución -------------------------------------------------------------

console.log(`\nAula simulada: ${STUDENTS} alumnos, ${SECONDS}s de fase sostenida, carga ${BURST ? "sincronizada" : "escalonada"}, contra ${BASE}\n`);

const run = await createRun();
console.log(`Toma creada: ${run.id} (código ${run.code})`);

const teacher = {
  events: 0,
  byType: new Map(),
  socket: new WebSocket(`${wsBase}/api/runs/${encodeURIComponent(run.id)}/socket?role=teacher`),
  participantsSeen: new Set(),
};
await new Promise((resolve, reject) => {
  teacher.socket.on("open", resolve);
  teacher.socket.on("error", reject);
});
// El panel real relee el snapshot completo cuando llega un evento, agrupando
// las relecturas. Se replica igual acá para que la medición diga lo que de
// verdad le pasa al docente. Ver src/components/live-run-monitor.tsx.
teacher.refreshes = 0;
teacher.refreshLatency = [];
let teacherPending = null;
let teacherRefreshing = false;
let teacherQueued = false;
async function teacherRefresh() {
  if (teacherRefreshing) { teacherQueued = true; return; }
  teacherRefreshing = true;
  const started = Date.now();
  const response = await fetch(`${BASE}/api/runs/${run.id}/state`).catch(() => null);
  if (response?.ok) {
    const snapshot = await response.json();
    teacher.refreshes += 1;
    teacher.refreshLatency.push(Date.now() - started);
    for (const participant of snapshot.participants ?? []) teacher.participantsSeen.add(participant.id ?? participant.participantId);
  }
  teacherRefreshing = false;
  if (teacherQueued) {
    teacherQueued = false;
    teacherPending = setTimeout(() => { teacherPending = null; void teacherRefresh(); }, 800);
  }
}

teacher.socket.on("message", (raw) => {
  teacher.events += 1;
  const payload = JSON.parse(raw.toString());
  teacher.byType.set(payload.type, (teacher.byType.get(payload.type) ?? 0) + 1);
  if (payload.type === "participant-joined") teacher.participantsSeen.add(payload.participant.participantId);
  if (payload.type === "state") for (const participant of payload.run.participants ?? []) teacher.participantsSeen.add(participant.participantId);
  if (!teacherPending) {
    teacherPending = setTimeout(() => { teacherPending = null; void teacherRefresh(); }, 800);
  }
});
console.log("Docente conectado\n");

console.log("1. Ingreso de los alumnos");
const students = Array.from({ length: STUDENTS }, (_, index) => new Student(index + 1, run.id));
let joinStart = Date.now();
const joinResults = await Promise.allSettled(students.map((student) => student.join(run.code)));
const joinFailures = joinResults.filter((result) => result.status === "rejected");
console.log(`   join HTTP: ${STUDENTS - joinFailures.length}/${STUDENTS} en ${Date.now() - joinStart}ms`);
if (joinFailures.length) console.log(`   FALLAS: ${joinFailures.slice(0, 3).map((f) => f.reason.message).join(" | ")}`);

const active = students.filter((student) => student.participantId);
const connectStart = Date.now();
const connectResults = await Promise.allSettled(active.map((student) => student.connect()));
const connectFailures = connectResults.filter((result) => result.status === "rejected");
console.log(`   WebSocket: ${active.length - connectFailures.length}/${active.length} en ${Date.now() - connectStart}ms`);
if (connectFailures.length) console.log(`   FALLAS: ${connectFailures.slice(0, 3).map((f) => f.reason.message).join(" | ")}`);

const online = active.filter((student) => student.socket?.readyState === WebSocket.OPEN);
await sleep(1500);
console.log(`   el docente ve ${teacher.participantsSeen.size} de ${online.length} participantes\n`);

console.log("2. Arranque de la toma (un evento se reparte a todos)");
await control(run.id, { action: "start" });
await sleep(2000);
const startLatencies = online.map((student) => student.startLatency).filter((value) => value !== null);
console.log(`   recibieron run-started: ${startLatencies.length}/${online.length}`);
console.log(`   ${summarize("   reparto servidor->alumno", startLatencies)}\n`);

console.log(`3. Fase sostenida (${SECONDS}s: heartbeats cada ${HEARTBEAT_EVERY_MS / 1000}s + guardado cada ${ANSWER_EVERY_MS / 1000}s)`);
const questionIds = ["demo-q1", "demo-q3"];
const phaseStart = Date.now();
const timers = [];
function answer(student) {
    const questionId = questionIds[student.index % questionIds.length];
    const value = questionId === "demo-q1" ? "b" : `Respuesta del alumno ${student.index} a las ${new Date().toISOString()}`;
    void student.saveAnswer(questionId, value);
}

if (BURST) {
  timers.push(setInterval(() => { for (const student of online) student.heartbeat(); }, HEARTBEAT_EVERY_MS));
  timers.push(setInterval(() => { for (const student of online) answer(student); }, ANSWER_EVERY_MS));
  for (const student of online) student.heartbeat();
} else {
  for (const student of online) {
    timers.push(setTimeout(() => {
      student.heartbeat();
      timers.push(setInterval(() => student.heartbeat(), HEARTBEAT_EVERY_MS));
    }, (student.index * 991) % HEARTBEAT_EVERY_MS));
    timers.push(setTimeout(() => {
      answer(student);
      timers.push(setInterval(() => answer(student), ANSWER_EVERY_MS));
    }, (student.index * 997) % ANSWER_EVERY_MS));
  }
}

await sleep(SECONDS * 1000);
for (const timer of timers) clearInterval(timer);
await sleep(1500);

const phaseSeconds = (Date.now() - phaseStart) / 1000;
const answerLatencies = online.flatMap((student) => student.answerLatency);
const heartbeatRtts = online.flatMap((student) => student.heartbeatRtt);
const totalReceived = online.reduce((sum, student) => sum + student.received, 0);

console.log(`   ${summarize("guardado de respuesta (HTTP)", answerLatencies)}`);
console.log(`   ${summarize("heartbeat ida y vuelta (WS)", heartbeatRtts)}`);
console.log(`   respuestas guardadas: ${answerLatencies.length} (${(answerLatencies.length / phaseSeconds).toFixed(1)}/s)`);
console.log(`   mensajes recibidos por los alumnos: ${totalReceived} (${(totalReceived / phaseSeconds).toFixed(0)}/s)`);
console.log(`   mensajes recibidos por el docente: ${teacher.events}`);
console.log(`   relecturas del panel docente: ${teacher.refreshes} (${(teacher.refreshes / phaseSeconds).toFixed(1)}/s)`);
console.log(`   ${summarize("GET /state del panel docente", teacher.refreshLatency)}`);
console.log(`   promedio de mensajes por alumno: ${(totalReceived / online.length).toFixed(1)}`);
const sample = online[0];
console.log(`   desglose de un alumno: ${[...sample.byType.entries()].map(([type, count]) => `${type}=${count}`).join(", ")}\n`);

console.log("4. Cierre de la toma (corrige y persiste a todos)");
const endStart = Date.now();
await control(run.id, { action: "end" });
const endHttp = Date.now() - endStart;
await sleep(2500);
const endLatencies = online.map((student) => student.endLatency).filter((value) => value !== null);
console.log(`   POST /control end tardó ${endHttp}ms (incluye corregir y guardar ${online.length} alumnos)`);
console.log(`   recibieron run-ended: ${endLatencies.length}/${online.length}`);
console.log(`   ${summarize("   reparto servidor->alumno", endLatencies)}\n`);

const errors = online.flatMap((student) => student.errors);
if (errors.length) {
  const grouped = new Map();
  for (const error of errors) grouped.set(error.slice(0, 60), (grouped.get(error.slice(0, 60)) ?? 0) + 1);
  console.log(`ERRORES (${errors.length}):`);
  for (const [message, count] of grouped) console.log(`   ${count}x ${message}`);
} else {
  console.log("Sin errores.");
}

for (const student of online) student.close();
teacher.socket.close();
await sleep(500);
process.exit(errors.length || joinFailures.length || connectFailures.length ? 1 : 0);
