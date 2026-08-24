// Genera el SQL para cargar un tema en la evaluación de Gustavo Rosa.
//   node scripts/cargar-tema.mjs <ruta-json> > salida.sql
// La evaluación se crea una sola vez (ON CONFLICT DO NOTHING) y cada tema
// agrega sus preguntas al final, corriendo las posiciones para no chocar con
// el índice único (exam_id, position).
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const EXAM_ID = "eval-recuperatoria-prog-web-2026";
const AUTHOR_ID = "e8HSpkpHceZ6ziBSY13DeHgVvzSeojmD"; // grosa@northfield.edu.ar
const ORG_ID = "19565b4c-88da-4f02-b1d3-86030e3670ca"; // Northfield
const TITULO = "Evaluación recuperatoria de Programación Web";
const INSTRUCCIONES =
  "Evaluación individual. Leé atentamente cada situación. En las consignas que incluyan justificación, explicá brevemente tu elección. La calificación se publicará después de la revisión del docente.";

const q = (value) => (value === null ? "NULL" : `'${String(value).replace(/'/g, "''")}'`);

const tema = JSON.parse(readFileSync(process.argv[2], "utf8"));
const base = Number(process.argv[3] ?? 0); // posición inicial para este tema

const lineas = [];

// La evaluación se crea la primera vez y no se pisa en las siguientes cargas.
lineas.push(`INSERT INTO exams (id, org_id, author_id, title, subject, instructions, time_limit_s,
  questions_to_serve, shuffle_questions, shuffle_options, status, created_at, updated_at)
VALUES (${q(EXAM_ID)}, ${q(ORG_ID)}, ${q(AUTHOR_ID)}, ${q(TITULO)}, ${q("Programación Web")},
  ${q(INSTRUCCIONES)}, 3600, 10, 1, 1, 'draft', (unixepoch()*1000), (unixepoch()*1000))
ON CONFLICT(id) DO NOTHING;`);

tema.preguntas.forEach((pregunta, indice) => {
  const posicion = base + indice;
  const id = `${EXAM_ID}-${tema.tema}-${String(pregunta.n).replace(".", "_")}`;
  const opciones = pregunta.opciones.map((texto) => ({ id: randomUUID(), text: texto }));

  let config;
  if (pregunta.tipo === "mc") {
    config = { options: opciones, correctOptionId: opciones[pregunta.correctas[0]].id };
  } else if (pregunta.tipo === "ms") {
    config = { options: opciones, correctOptionIds: pregunta.correctas.map((i) => opciones[i].id) };
  } else {
    config = {};
  }

  // El prompt lleva el tema adelante para que el docente sepa de dónde salió
  // cada pregunta cuando las vea mezcladas en el pozo.
  const prompt = `[${tema.tema}] ${pregunta.prompt}`;

  lineas.push(`INSERT INTO questions (id, exam_id, position, type, prompt, points, config)
VALUES (${q(id)}, ${q(EXAM_ID)}, ${posicion}, ${q(pregunta.tipo)}, ${q(prompt)}, 1, ${q(JSON.stringify(config))})
ON CONFLICT(id) DO UPDATE SET prompt = excluded.prompt, config = excluded.config, position = excluded.position;`);
});

console.log(lineas.join("\n"));
console.error(`Tema ${tema.tema}: ${tema.preguntas.length} preguntas, posiciones ${base}..${base + tema.preguntas.length - 1}`);
