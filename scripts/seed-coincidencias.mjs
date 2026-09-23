// SOLO DESARROLLO: carga una toma de demostración pensada para "Coincidencias
// entre alumnos" (ver `odd/tasks/jev-copy-detection.md`). Nunca correr contra
// producción: agrega 24 participantes ficticios con respuestas armadas para
// que la demo tenga algo que mostrar.
//
// Idempotente: borra y vuelve a crear SU PROPIA toma (`run-coincidencias-demo`)
// y su examen (`exam-coincidencias-demo`) por id fijo, así correrlo de nuevo
// no duplica nada ni pisa otros datos de `db:seed`.
//
// Las dos preguntas de desarrollo son reales, tomadas de
// `scripts/copy-eval/dataset.json` (el mismo dataset que evalúa T4): un par
// copia casi textual en "fotosíntesis" (q1) Y comparte el mismo error
// distintivo en "metáfora" (q3) — el mismo par en las dos preguntas, a
// propósito. Las 10 preguntas de opción múltiple son simuladas para este seed
// y ese mismo par comparte 4 respuestas incorrectas raras entre sí, para que
// el patrón cerrado llegue a "fuerte" sin depender de Jev (que hoy responde
// `billing_required`, ver el registro de tareas).

import { readFile } from "node:fs/promises";

import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[seed-coincidencias] falta DATABASE_URL");
  process.exit(1);
}

const ORG_ID = "org-demo";
const TEACHER_ID = "teacher-demo";
const EXAM_ID = "exam-coincidencias-demo";
const RUN_ID = "run-coincidencias-demo";
const RUN_CODE = "CP1234";

// --- Dataset real de T4: preguntas de desarrollo y textos -------------------

const datasetPath = new URL("./copy-eval/dataset.json", import.meta.url);
const dataset = JSON.parse(await readFile(datasetPath, "utf8"));

function datasetQuestion(id) {
  const question = dataset.questions.find((candidate) => candidate.id === id);
  if (!question) throw new Error(`[seed-coincidencias] no está la pregunta ${id} en dataset.json`);
  return question;
}

function textOf(question, answerId) {
  const answer = question.answers.find((candidate) => candidate.id === answerId);
  if (!answer) throw new Error(`[seed-coincidencias] no está la respuesta ${answerId} en ${question.id}`);
  return answer.text;
}

const datasetQ1 = datasetQuestion("q1"); // fotosíntesis
const datasetQ3 = datasetQuestion("q3"); // metáfora

// --- Los 24 alumnos: quién dice qué en cada pregunta de desarrollo ----------
//
// Los primeros dos (el "par que copia") están armados a propósito: en q1
// tienen la copia casi textual del dataset (q1-s02 → q1-s19, "verbatim"), y en
// q3 tienen el error distintivo compartido (q3-s11 → q3-s16, "shared_error").
// Los siguientes tres son "memorizадores": recitan la definición de clase en
// las dos preguntas — coincidencia esperable, no señal (ver
// `computeFragmentSignals`: excluye lo que ya está en la consigna/referencia,
// pero no la definición de clase, así que esto reproduce el caso real). El
// resto son las 19 respuestas independientes del dataset, una por alumno,
// para no dejar ninguna sin usar.
const STUDENTS = [
  { name: "Valentina Suárez", q1: "q1-s02", q3: "q3-s11" },
  { name: "Bruno Ferreyra", q1: "q1-s19", q3: "q3-s16" },
  { name: "Camila Ibarra", q1: "q1-s04", q3: "q3-s02" },
  { name: "Nicolás Peralta", q1: "q1-s07", q3: "q3-s04" },
  { name: "Agustina Molina", q1: "q1-s08", q3: "q3-s08" },
  { name: "Franco Acosta", q1: "q1-s01", q3: "q3-s01" },
  { name: "Martina Ríos", q1: "q1-s03", q3: "q3-s03" },
  { name: "Lucas Domínguez", q1: "q1-s05", q3: "q3-s05" },
  { name: "Abril Sosa", q1: "q1-s06", q3: "q3-s06" },
  { name: "Joaquín Vega", q1: "q1-s09", q3: "q3-s07" },
  { name: "Delfina Aguirre", q1: "q1-s10", q3: "q3-s09" },
  { name: "Mateo Cabrera", q1: "q1-s11", q3: "q3-s10" },
  { name: "Renata Godoy", q1: "q1-s12", q3: "q3-s12" },
  { name: "Santino Correa", q1: "q1-s13", q3: "q3-s13" },
  { name: "Priscila Leiva", q1: "q1-s14", q3: "q3-s14" },
  { name: "Tomás Quiroga", q1: "q1-s15", q3: "q3-s15" },
  { name: "Milagros Bazán", q1: "q1-s16", q3: "q3-s17" },
  { name: "Ignacio Funes", q1: "q1-s17", q3: "q3-s18" },
  { name: "Julieta Paz", q1: "q1-s18", q3: "q3-s19" },
  { name: "Ezequiel Montes", q1: "q1-s20", q3: "q3-s20" },
  { name: "Catalina Rojas", q1: "q1-s21", q3: "q3-s21" },
  { name: "Benjamín Escobar", q1: "q1-s22", q3: "q3-s22" },
  { name: "Sofía Navarro", q1: "q1-s23", q3: "q3-s23" },
  { name: "Emiliano Torres", q1: "q1-s24", q3: "q3-s24" },
].map((student, index) => ({
  id: `coincidencias-p${String(index + 1).padStart(2, "0")}`,
  name: student.name,
  q1Text: textOf(datasetQ1, student.q1),
  q3Text: textOf(datasetQ3, student.q3),
}));

const HERO_COUNT = 2; // los primeros dos STUDENTS: el par que copia en las dos preguntas
const OTHERS_COUNT = STUDENTS.length - HERO_COUNT; // 22

// --- Las 10 preguntas de opción múltiple, simuladas para este seed ---------
//
// Cuatro tienen `hero`: ahí el par que copia elige la MISMA opción rara
// (`hero.wrong`), casi nadie más la elige (`hero.groups` reparte a los otros
// 22 en las opciones incorrectas restantes; lo que sobra va a la correcta), y
// eso alcanza para que el patrón cerrado llegue a "fuerte" — verificado a mano
// contra `computeClosedSignals`/`closedLevelFor` antes de escribir este seed:
// con 24 alumnos (276 pares) da p ≈ 5×10⁻⁶, muy por debajo del umbral
// `CLOSED_ALPHA_STRONG / nPares` (≈ 3.6×10⁻⁵). Las otras seis son de relleno:
// casi toda la clase responde bien, con algún error suelto y sin patrón.
const MC_QUESTIONS = [
  {
    id: "coin-mc-01",
    prompt: "¿Qué gas liberan las plantas durante la fotosíntesis?",
    options: [["a", "Dióxido de carbono"], ["b", "Oxígeno"], ["c", "Nitrógeno"], ["d", "Hidrógeno"]],
    correct: "b",
  },
  {
    id: "coin-mc-02",
    prompt: "¿En qué parte de la célula vegetal está la clorofila?",
    options: [["a", "Cloroplasto"], ["b", "Núcleo"], ["c", "Mitocondria"], ["d", "Vacuola"]],
    correct: "a",
    hero: { wrong: "d", groups: [["b", 5], ["c", 2]], offset: 0 },
  },
  {
    id: "coin-mc-03",
    prompt: "¿Cuál de estas oraciones tiene una metáfora?",
    options: [["a", "Sus ojos son como luceros"], ["b", "Sus ojos son dos luceros"], ["c", "Tiene los ojos claros"], ["d", "Sus ojos brillan mucho"]],
    correct: "b",
  },
  {
    id: "coin-mc-04",
    prompt: "¿Cómo se llama la figura retórica que compara usando 'como'?",
    options: [["a", "Metáfora"], ["b", "Símil"], ["c", "Hipérbole"], ["d", "Metonimia"]],
    correct: "b",
    hero: { wrong: "d", groups: [["a", 5], ["c", 1], ["d", 1]], offset: 7 },
  },
  {
    id: "coin-mc-05",
    prompt: "¿Qué necesitan las plantas para hacer la fotosíntesis, además de luz y agua?",
    options: [["a", "Dióxido de carbono"], ["b", "Oxígeno"], ["c", "Nitrógeno"], ["d", "Metano"]],
    correct: "a",
  },
  {
    id: "coin-mc-06",
    prompt: "¿Cuál de estas frases es una hipérbole?",
    options: [["a", "Te lo dije mil veces"], ["b", "Te lo dije ayer"], ["c", "Te lo voy a decir"], ["d", "Te lo dije una vez"]],
    correct: "a",
  },
  {
    id: "coin-mc-07",
    prompt: "¿En qué parte de la planta ocurre principalmente la fotosíntesis?",
    options: [["a", "La raíz"], ["b", "Las hojas"], ["c", "El tallo"], ["d", "La flor"]],
    correct: "b",
    hero: { wrong: "d", groups: [["a", 2], ["c", 4]], offset: 14 },
  },
  {
    id: "coin-mc-08",
    prompt: "¿Qué es una metáfora?",
    options: [["a", "Una figura retórica"], ["b", "Una regla de ortografía"], ["c", "Un signo de puntuación"], ["d", "Un tiempo verbal"]],
    correct: "a",
  },
  {
    id: "coin-mc-09",
    prompt: "¿Qué producen las plantas, además de oxígeno, durante la fotosíntesis?",
    options: [["a", "Glucosa"], ["b", "Proteínas"], ["c", "Agua"], ["d", "Sales minerales"]],
    correct: "a",
    hero: { wrong: "d", groups: [["b", 4], ["c", 1], ["d", 1]], offset: 3 },
  },
  {
    id: "coin-mc-10",
    prompt: "¿Cuál de estas frases NO es una metáfora?",
    options: [["a", "Un mar de gente"], ["b", "El cielo está nublado"], ["c", "Río de lágrimas"], ["d", "Nieva en su cabello"]],
    correct: "b",
  },
].map((question, index) => ({ ...question, position: 2 + index }));

/** Qué opción eligió `studentIndex` (0-based, en el orden de STUDENTS) en esta pregunta. */
function mcAnswerFor(studentIndex, question) {
  if (studentIndex < HERO_COUNT) return question.hero ? question.hero.wrong : question.correct;

  const otherIndex = studentIndex - HERO_COUNT; // 0..21

  if (question.hero) {
    const position = (((otherIndex - question.hero.offset) % OTHERS_COUNT) + OTHERS_COUNT) % OTHERS_COUNT;
    let cursor = 0;
    for (const [option, count] of question.hero.groups) {
      if (position < cursor + count) return option;
      cursor += count;
    }
    return question.correct;
  }

  // Relleno: ~1 de cada 7 falla, y cuál falla rota con la pregunta para no
  // repetir siempre al mismo par en la misma opción incorrecta.
  const allOptions = question.options.map(([id]) => id);
  const wrongOptions = allOptions.filter((id) => id !== question.correct);
  const questionIndex = question.position - 2;
  if (otherIndex % 7 === questionIndex % 7) return wrongOptions[(otherIndex + questionIndex) % wrongOptions.length];
  return question.correct;
}

// --- Arma el snapshot de preguntas (mismo shape que `FullQuestion`) --------

const LONG_QUESTIONS = [
  { id: "coin-long-q1", position: 0, prompt: datasetQ1.prompt, points: 4, config: { referenceAnswer: datasetQ1.referenceAnswer } },
  { id: "coin-long-q3", position: 1, prompt: datasetQ3.prompt, points: 4, config: { referenceAnswer: datasetQ3.referenceAnswer } },
];

const questionsSnapshot = [
  ...LONG_QUESTIONS.map((question) => ({ id: question.id, position: question.position, type: "long", prompt: question.prompt, points: question.points, config: question.config })),
  ...MC_QUESTIONS.map((question) => ({
    id: question.id,
    position: question.position,
    type: "mc",
    prompt: question.prompt,
    points: 1,
    config: { options: question.options.map(([id, text]) => ({ id, text })), correctOptionId: question.correct },
  })),
];

// --- Carga ------------------------------------------------------------------

const pool = new pg.Pool({ connectionString: url, max: 1 });
const client = await pool.connect();

try {
  await client.query("BEGIN");

  await client.query(
    `INSERT INTO organizations (id, name, google_domain) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [ORG_ID, "Escuela Secundaria Demo", "escuela.example.edu"],
  );
  await client.query(
    `INSERT INTO users (id, email, email_verified, name, role, google_sub, org_id) VALUES ($1, $2, true, $3, 'teacher', $4, $5) ON CONFLICT DO NOTHING`,
    [TEACHER_ID, "mariana@escuela.example.edu", "Mariana Costa", "google-teacher-demo", ORG_ID],
  );

  // Idempotente: se borra primero la propia toma (en cascada se lleva
  // participantes, respuestas, notas e incidentes) y después el propio
  // examen (en cascada se lleva su banco de preguntas).
  await client.query(`DELETE FROM runs WHERE id = $1`, [RUN_ID]);
  await client.query(`DELETE FROM exams WHERE id = $1`, [EXAM_ID]);

  await client.query(
    `INSERT INTO exams (id, org_id, author_id, title, subject, instructions, time_limit_s, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'ready')`,
    [EXAM_ID, ORG_ID, TEACHER_ID, "Evaluación integradora: fotosíntesis y figuras retóricas", "Repaso integrador", "Leé cada consigna antes de responder.", 2700],
  );

  for (const question of questionsSnapshot) {
    await client.query(
      `INSERT INTO questions (id, exam_id, position, type, prompt, points, config) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [question.id, EXAM_ID, question.position, question.type, question.prompt, question.points, JSON.stringify(question.config)],
    );
  }

  const now = Date.now();
  const runStartedAt = now - 75 * 60_000;
  const runEndsAt = runStartedAt + 2_700_000;
  const runEndedAt = now - 5 * 60_000;

  await client.query(
    `INSERT INTO runs (id, org_id, author_id, exam_id, code, title, questions_snapshot, time_limit_s, status, created_at, started_at, ends_at, ended_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ended', $9, $9, $10, $11)`,
    [RUN_ID, ORG_ID, TEACHER_ID, EXAM_ID, RUN_CODE, "Evaluación integradora: fotosíntesis y figuras retóricas", JSON.stringify(questionsSnapshot), 2700, runStartedAt, runEndsAt, runEndedAt],
  );

  for (const [studentIndex, student] of STUDENTS.entries()) {
    const joinedAt = runStartedAt + studentIndex * 30_000;
    const submittedAt = runStartedAt + 15 * 60_000 + studentIndex * 2 * 60_000;

    await client.query(
      `INSERT INTO participants (id, run_id, display_name, status, joined_at, submitted_at, submit_reason, last_seen)
       VALUES ($1, $2, $3, 'submitted', $4, $5, 'manual', $5)`,
      [student.id, RUN_ID, student.name, joinedAt, submittedAt],
    );

    const longAnswers = [
      { questionId: "coin-long-q1", value: student.q1Text, points: 4 },
      { questionId: "coin-long-q3", value: student.q3Text, points: 4 },
    ];
    for (const answer of longAnswers) {
      await client.query(
        `INSERT INTO answers (id, participant_id, question_id, value, updated_at) VALUES ($1, $2, $3, $4, $5)`,
        [`${student.id}-${answer.questionId}`, student.id, answer.questionId, JSON.stringify(answer.value), submittedAt],
      );
      await client.query(
        `INSERT INTO grades (id, participant_id, question_id, auto, override, points_awarded, grading_status, graded_by_type)
         VALUES ($1, $2, $3, NULL, NULL, NULL, 'pending_manual', 'auto')`,
        [`${student.id}-${answer.questionId}-grade`, student.id, answer.questionId],
      );
    }

    for (const question of MC_QUESTIONS) {
      const optionId = mcAnswerFor(studentIndex, question);
      const correct = optionId === question.correct;
      await client.query(
        `INSERT INTO answers (id, participant_id, question_id, value, updated_at) VALUES ($1, $2, $3, $4, $5)`,
        [`${student.id}-${question.id}`, student.id, question.id, JSON.stringify(optionId), submittedAt],
      );
      await client.query(
        `INSERT INTO grades (id, participant_id, question_id, auto, override, points_awarded, grading_status, graded_by_type)
         VALUES ($1, $2, $3, 1, NULL, $4, 'auto_graded', 'auto')`,
        [`${student.id}-${question.id}-grade`, student.id, question.id, correct ? 1 : 0],
      );
    }
  }

  await client.query("COMMIT");
  console.log(`[seed-coincidencias] toma "${RUN_ID}" cargada con ${STUDENTS.length} alumnos (código ${RUN_CODE}).`);
  console.log(`[seed-coincidencias] par que copia en las dos preguntas de desarrollo y en 4 opciones raras: ${STUDENTS[0].name} / ${STUDENTS[1].name}.`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("[seed-coincidencias] falló la carga", error);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
