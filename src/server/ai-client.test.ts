import { describe, expect, it } from "vitest";

import { parseJsonResponse, parseSseText } from "@/server/ai-client";

// El router no expone `response_format: json_object`, asi que el modelo envuelve
// la respuesta en un bloque de codigo bastante seguido. `JSON.parse` sobre eso
// falla con `Unexpected token '`'` y se cae la corrida entera: le paso en
// produccion al pedir variantes de una pregunta.
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

// El AI Router no habla el JSON de OpenAI: manda un evento SSE por token con el
// texto crudo adentro. Estas pruebas fijan el formato real, medido contra el
// router en produccion, porque las dos trampas se comen texto en silencio.
describe("parseSseText", () => {
  it("junta los tokens de un stream", () => {
    expect(parseSseText('data: {"\n\ndata: ok\n\ndata: ":\n\ndata: true\n\ndata: }\n\ndata: [DONE]\n\n')).toBe('{"ok":true}');
  });

  it("conserva los espacios que vienen dentro del token", () => {
    // Medido con od -c: el token " mundo" viaja como `data:` + espacio del
    // formato + el espacio del token. Recortar de mas pega las palabras.
    expect(parseSseText("data: hola\n\ndata:  mundo\n\ndata:  querido\n\ndata: [DONE]\n\n")).toBe("hola mundo querido");
  });

  it("no se come un token que es solo un espacio", () => {
    expect(parseSseText("data: a\n\ndata:  \n\ndata: b\n\ndata: [DONE]\n\n")).toBe("a b");
  });

  it("conserva la linea en blanco que viene dentro de un token", () => {
    // Un token con "\n\n" adentro parte el evento en dos y la segunda mitad
    // queda sin el prefijo `data:`. Es texto del modelo, no un evento nuevo.
    expect(parseSseText("data: uno\n\ndos\n\ndata: [DONE]\n\n")).toBe("uno\n\ndos");
  });

  it("no filtra el prefijo cuando un token termina en salto de linea", () => {
    // Regresion medida contra el router: el modelo abre el JSON con "{" y un
    // enter, asi que el cable trae tres saltos seguidos y la linea en blanco que
    // separa los eventos se corre un caracter. Partir por la linea en blanco
    // sola metia el literal "data:" adentro del JSON y lo rompia entero.
    const body = 'data: {\n\n\ndata:   "a": 1\n\ndata: }\n\ndata: [DONE]\n\n';
    expect(parseSseText(body)).toBe('{\n  "a": 1}');
    expect(parseSseText(body)).not.toContain("data:");
  });

  it("ignora lo que venga antes del primer evento", () => {
    expect(parseSseText(": keep-alive\n\ndata: hola\n\ndata: [DONE]\n\n")).toBe("hola");
  });

  it("respeta los saltos de linea simples del token", () => {
    expect(parseSseText('data: {\n  "a": 1\n\ndata: }\n\ndata: [DONE]\n\n')).toBe('{\n  "a": 1}');
  });

  it("corta en [DONE] e ignora lo que venga despues", () => {
    expect(parseSseText("data: hola\n\ndata: [DONE]\n\ndata: basura\n\n")).toBe("hola");
  });

  it("devuelve vacio cuando el stream no trajo ningun token", () => {
    expect(parseSseText("data: [DONE]\n\n")).toBe("");
  });

  it("sobrevive a un stream cortado sin [DONE]", () => {
    expect(parseSseText('data: {"a"\n\ndata: :1}')).toBe('{"a":1}');
  });
});
