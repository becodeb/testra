import { describe, expect, it } from "vitest";

import { toPositional } from "./client";

// Esta función traduce las 41 consultas heredadas de D1 a la sintaxis de
// Postgres. Un error acá corrompe cualquier consulta, así que el contrato queda
// fijado en tests.
describe("toPositional", () => {
  it("numera los placeholders en orden", () => {
    expect(toPositional("SELECT * FROM runs WHERE id = ? AND org_id = ?")).toBe(
      "SELECT * FROM runs WHERE id = $1 AND org_id = $2",
    );
  });

  it("deja intacta una consulta sin placeholders", () => {
    expect(toPositional("SELECT 1")).toBe("SELECT 1");
  });

  it("no toca los signos de pregunta dentro de un literal", () => {
    expect(toPositional("SELECT ? WHERE prompt = '¿Cuál es el pigmento?'")).toBe(
      "SELECT $1 WHERE prompt = '¿Cuál es el pigmento?'",
    );
  });

  it("reconoce la comilla escapada dentro de un literal", () => {
    expect(toPositional("SELECT ? WHERE name = 'O''Brien ?' AND id = ?")).toBe(
      "SELECT $1 WHERE name = 'O''Brien ?' AND id = $2",
    );
  });

  it("no toca los signos de pregunta dentro de un identificador entrecomillado", () => {
    expect(toPositional('SELECT "raro?" FROM t WHERE id = ?')).toBe('SELECT "raro?" FROM t WHERE id = $1');
  });

  it("mantiene la numeración a través de varias líneas y de un ON CONFLICT", () => {
    const source = `INSERT INTO grades (id, participant_id, question_id, auto, override, points_awarded)
     VALUES (?, ?, ?, NULL, 1, ?)
     ON CONFLICT(participant_id, question_id) DO UPDATE SET override = 1, points_awarded = excluded.points_awarded`;
    expect(toPositional(source)).toContain("VALUES ($1, $2, $3, NULL, 1, $4)");
  });

  it("numera cada aparición aunque se repita el mismo valor", () => {
    // `listExams` pasa `subject` dos veces; cada `?` es un parámetro propio.
    expect(toPositional("WHERE (? = '' OR e.subject = ?)")).toBe("WHERE ($1 = '' OR e.subject = $2)");
  });
});
