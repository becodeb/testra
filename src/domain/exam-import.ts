import type { FullQuestion, QuestionType } from "@/domain/exam";

// Vive fuera del editor porque no es del editor: la demo pública arma sus
// preguntas con este mismo parser. Si cada uno tuviera su copia, la demo
// terminaría mostrando un comportamiento que el producto ya no tiene.

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  mc: "Opción única",
  ms: "Varias opciones",
  tf: "Verdadero / Falso",
  sa: "Respuesta corta",
  long: "Desarrollo",
};

export function newId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function makeQuestion(type: QuestionType = "mc", position = 0): FullQuestion {
  const base = { id: newId("q"), position, prompt: "", points: 1, section: "", assets: [] };
  const options = [
    { id: newId("op"), text: "" },
    { id: newId("op"), text: "" },
  ];

  switch (type) {
    case "mc":
      return { ...base, type, config: { options, correctOptionId: "" } };
    case "ms":
      return { ...base, type, config: { options, correctOptionIds: [] } };
    case "tf":
      return { ...base, type, config: { correct: true } };
    case "sa":
      return { ...base, type, config: { accepted: [""] } };
    case "long":
      return { ...base, type, config: { aiEnabled: false, gradingCriteria: "", referenceAnswer: "", rubric: [] } };
  }
}

export function parsePastedExam(text: string): FullQuestion[] {
  const blocks = text
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.map((block, position) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const prompt = (lines.shift() ?? "").replace(/^\d+[).\-]\s*/, "");
    const optionLines = lines.filter((line) => /^[A-Ha-h][).\-]\s+/.test(line));

    if (optionLines.length >= 2) {
      const question = makeQuestion("mc", position);
      if (question.type !== "mc") return question;
      return {
        ...question,
        prompt,
        config: {
          options: optionLines.map((line) => ({
            id: newId("op"),
            text: line.replace(/^[A-Ha-h][).\-]\s+/, ""),
          })),
          correctOptionId: "",
        },
      };
    }

    return { ...makeQuestion("long", position), prompt } as FullQuestion;
  });
}
