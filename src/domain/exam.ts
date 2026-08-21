import { z } from "zod";

export const questionTypeSchema = z.enum(["mc", "ms", "tf", "sa", "long"]);
export type QuestionType = z.infer<typeof questionTypeSchema>;

const optionSchema = z.object({
  id: z.string().min(1),
  text: z.string().max(1000),
});

const baseQuestionShape = {
  id: z.string().min(1),
  position: z.number().int().nonnegative(),
  prompt: z.string().max(10_000),
  points: z.number().positive("El puntaje debe ser mayor que cero").max(1000),
};

export const multipleChoiceQuestionSchema = z.object({
  ...baseQuestionShape,
  type: z.literal("mc"),
  config: z
    .object({
      options: z.array(optionSchema).min(2, "Agregá al menos dos opciones"),
      correctOptionId: z.string(),
    })
    .superRefine((config, context) => {
      if (config.correctOptionId && !config.options.some((option) => option.id === config.correctOptionId)) {
        context.addIssue({
          code: "custom",
          path: ["correctOptionId"],
          message: "La respuesta correcta debe ser una de las opciones",
        });
      }
    }),
});

export const multipleSelectQuestionSchema = z.object({
  ...baseQuestionShape,
  type: z.literal("ms"),
  config: z
    .object({
      options: z.array(optionSchema).min(2, "Agregá al menos dos opciones"),
      correctOptionIds: z.array(z.string()),
    })
    .superRefine((config, context) => {
      const optionIds = new Set(config.options.map((option) => option.id));
      if (config.correctOptionIds.some((id) => !optionIds.has(id))) {
        context.addIssue({
          code: "custom",
          path: ["correctOptionIds"],
          message: "Todas las respuestas correctas deben existir entre las opciones",
        });
      }
    }),
});

export const trueFalseQuestionSchema = z.object({
  ...baseQuestionShape,
  type: z.literal("tf"),
  config: z.object({ correct: z.boolean() }),
});

export const shortAnswerQuestionSchema = z.object({
  ...baseQuestionShape,
  type: z.literal("sa"),
  config: z.object({
    accepted: z
      .array(z.string().max(1000))
      .min(1, "Agregá al menos una respuesta aceptada"),
  }),
});

export const longAnswerQuestionSchema = z.object({
  ...baseQuestionShape,
  type: z.literal("long"),
  config: z.object({}),
});

export const fullQuestionSchema = z.discriminatedUnion("type", [
  multipleChoiceQuestionSchema,
  multipleSelectQuestionSchema,
  trueFalseQuestionSchema,
  shortAnswerQuestionSchema,
  longAnswerQuestionSchema,
]);

export type FullQuestion = z.infer<typeof fullQuestionSchema>;

export const examDraftSchema = z.object({
  id: z.string().min(1),
  title: z.string().max(120),
  subject: z.string().max(80),
  instructions: z.string().trim().max(4000),
  timeLimitS: z.number().int().min(60).max(6 * 60 * 60),
  status: z.enum(["draft", "ready"]),
  questions: z.array(fullQuestionSchema).min(1, "Agregá al menos una pregunta"),
  updatedAt: z.iso.datetime(),
}).superRefine((exam, context) => {
  if (exam.status !== "ready") return;
  if (exam.title.trim().length < 3) {
    context.addIssue({ code: "custom", path: ["title"], message: "Escribí un título de al menos 3 caracteres" });
  }
  if (!exam.subject.trim()) {
    context.addIssue({ code: "custom", path: ["subject"], message: "Indicá la materia" });
  }
  exam.questions.forEach((question, index) => {
    if (getQuestionCompletion(question) !== "complete") {
      context.addIssue({ code: "custom", path: ["questions", index], message: `Completá la pregunta ${index + 1}` });
    }
    if ((question.type === "mc" || question.type === "ms") && question.config.options.some((option) => !option.text.trim())) {
      context.addIssue({ code: "custom", path: ["questions", index, "config", "options"], message: `Completá las opciones de la pregunta ${index + 1}` });
    }
  });
});

export type ExamDraft = z.infer<typeof examDraftSchema>;

export type StudentQuestion =
  | {
      id: string;
      position: number;
      prompt: string;
      points: number;
      type: "mc";
      config: { options: Array<{ id: string; text: string }> };
    }
  | {
      id: string;
      position: number;
      prompt: string;
      points: number;
      type: "ms";
      config: { options: Array<{ id: string; text: string }> };
    }
  | {
      id: string;
      position: number;
      prompt: string;
      points: number;
      type: "tf";
      config: Record<string, never>;
    }
  | {
      id: string;
      position: number;
      prompt: string;
      points: number;
      type: "sa";
      config: Record<string, never>;
    }
  | {
      id: string;
      position: number;
      prompt: string;
      points: number;
      type: "long";
      config: Record<string, never>;
    };

export function toStudentQuestion(question: FullQuestion): StudentQuestion {
  const base = {
    id: question.id,
    position: question.position,
    prompt: question.prompt,
    points: question.points,
  };

  switch (question.type) {
    case "mc":
    case "ms":
      return {
        ...base,
        type: question.type,
        config: { options: question.config.options },
      } as StudentQuestion;
    case "tf":
    case "sa":
    case "long":
      return { ...base, type: question.type, config: {} } as StudentQuestion;
  }
}

export function toStudentQuestions(questions: FullQuestion[]): StudentQuestion[] {
  return questions.map(toStudentQuestion);
}

export type QuestionCompletion = "complete" | "missing-key" | "empty";

export function getQuestionCompletion(question: FullQuestion): QuestionCompletion {
  if (!question.prompt.trim()) return "empty";
  if (question.points <= 0) return "missing-key";

  switch (question.type) {
    case "mc":
      return question.config.correctOptionId ? "complete" : "missing-key";
    case "ms":
      return question.config.correctOptionIds.length > 0 ? "complete" : "missing-key";
    case "sa":
      return question.config.accepted.some((value) => value.trim()) ? "complete" : "missing-key";
    case "tf":
    case "long":
      return "complete";
  }
}

export function examTotalPoints(questions: FullQuestion[]): number {
  return questions.reduce((sum, question) => sum + question.points, 0);
}
