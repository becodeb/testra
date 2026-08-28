import { describe, expect, it } from "vitest";

import { parseJsonResponse } from "@/server/ai-client";

// MiniMax M3 no siempre respeta `response_format: json_object`. Cuando envuelve
// la respuesta en un bloque de codigo, `JSON.parse` falla con
// `Unexpected token '`'` y se cae la corrida entera: le paso en produccion al
// pedir variantes de una pregunta.
describe("parseJsonResponse", () => {
  const falla = "El modelo no respondió";

  it("parsea un JSON limpio", () => {
    expect(parseJsonResponse('{"score":3}', falla)).toEqual({ score: 3 });
  });

  it("parsea un JSON envuelto en un bloque ```json", () => {
    expect(parseJsonResponse('```json\n{"score":3}\n```', falla)).toEqual({ score: 3 });
  });

  it("parsea un bloque de codigo sin lenguaje", () => {
    expect(parseJsonResponse('```\n{"score":3}\n```', falla)).toEqual({ score: 3 });
  });

  it("tolera espacios y saltos alrededor", () => {
    expect(parseJsonResponse('  \n ```json  \n {"score": 3}  \n ``` \n ', falla)).toEqual({ score: 3 });
  });

  it("rescata el objeto aunque el modelo escriba una frase antes", () => {
    expect(parseJsonResponse('Acá va el resultado:\n{"score":3}', falla)).toEqual({ score: 3 });
  });

  it("rescata el objeto aunque escriba una frase después", () => {
    expect(parseJsonResponse('{"score":3}\nEspero que sirva.', falla)).toEqual({ score: 3 });
  });

  it("parsea un arreglo, que es lo que devuelven las variantes", () => {
    expect(parseJsonResponse('```json\n[{"prompt":"a"},{"prompt":"b"}]\n```', falla)).toEqual([
      { prompt: "a" },
      { prompt: "b" },
    ]);
  });

  it("no confunde llaves que aparecen dentro de un texto", () => {
    const contenido = '{"feedback":"Usá {llaves} con cuidado","score":2}';
    expect(parseJsonResponse(contenido, falla)).toEqual({ feedback: "Usá {llaves} con cuidado", score: 2 });
  });

  it("falla con el mensaje del llamador si no hay JSON en ningún lado", () => {
    expect(() => parseJsonResponse("No puedo responder eso.", falla)).toThrow(falla);
  });
});
