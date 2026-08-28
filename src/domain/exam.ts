import { z } from "zod";

export const questionTypeSchema = z.enum(["mc", "ms", "tf", "sa", "long"]);
export type QuestionType = z.infer<typeof questionTypeSchema>;

export const questionDifficultySchema = z.enum(["easy", "medium", "hard"]);
export type QuestionDifficulty = z.infer<typeof questionDifficultySchema>;

export const questionAssetSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(180),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  width: z.number().int().positive().max(8000),
  height: z.number().int().positive().max(8000),
});
export type QuestionAsset = z.infer<typeof questionAssetSchema>;

export const rubricCriterionSchema = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1).max(180),
  maxPoints: z.number().positive().max(1000),
});
export type RubricCriterion = z.infer<typeof rubricCriterionSchema>;

export const deliveryModeSchema = z.enum(["sync", "async"]);
export const aiGradingModeSchema = z.enum(["off", "suggest", "auto_clear"]);

const optionSchema = z.object({
  id: z.string().min(1),
  text: z.string().max(1000),
});

const baseQuestionShape = {
  id: z.string().min(1),
  position: z.number().int().nonnegative(),
  prompt: z.string().max(10_000),
  points: z.number().positive("El puntaje debe ser mayor que cero").max(1000),
  // Agrupa preguntas para poder servir una cantidad distinta de cada grupo:
  // "2 de teoria, 4 de practica". Vacio significa que la pregunta no esta en
  // ninguna seccion. Ver `sectionQuotas` en el examen.
  section: z.string().trim().max(60).optional(),
  difficulty: questionDifficultySchema.nullable().optional(),
  assets: z.array(questionAssetSchema).max(4).optional(),
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
      gradingMode: z.enum(["exact", "partial"]).optional(),
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
  config: z.object({
    rubric: z.array(rubricCriterionSchema).max(20).optional(),
    aiEnabled: z.boolean().optional(),
    gradingCriteria: z.string().trim().max(6000).optional(),
    referenceAnswer: z.string().trim().max(10_000).optional(),
  }),
}).superRefine((question, context) => {
  const rubric = question.config.rubric ?? [];
  if (!rubric.length) return;
  const total = rubric.reduce((sum, criterion) => sum + criterion.maxPoints, 0);
  if (Math.abs(total - question.points) > 0.001) {
    context.addIssue({
      code: "custom",
      path: ["config", "rubric"],
      message: `La rúbrica debe sumar ${question.points} puntos`,
    });
  }
});

export const fullQuestionSchema = z.discriminatedUnion("type", [
  multipleChoiceQuestionSchema,
  multipleSelectQuestionSchema,
  trueFalseQuestionSchema,
  shortAnswerQuestionSchema,
  longAnswerQuestionSchema,
]);

export type FullQuestion = z.infer<typeof fullQuestionSchema>;

export const supervisionLevelSchema = z.enum(["normal", "strict", "custom"]);
export const violationActionSchema = z.enum(["warn_and_record", "record_only"]);
export const resultsDisplaySchema = z.enum(["score_only", "score_and_answers", "hidden"]);
export const resultsWhenSchema = z.enum(["teacher_publishes", "after_submit", "after_run"]);

export const examDraftSchema = z.object({
  id: z.string().min(1),
  title: z.string().max(120),
  subject: z.string().max(80),
  instructions: z.string().trim().max(4000),
  timeLimitS: z.number().int().min(60).max(6 * 60 * 60),
  deliveryMode: deliveryModeSchema.default("sync"),
  availableFrom: z.iso.datetime().nullable().default(null),
  availableUntil: z.iso.datetime().nullable().default(null),
  aiGradingMode: aiGradingModeSchema.default("suggest"),
  // Pozo de preguntas: cada alumno recibe este subconjunto, elegido al azar y
  // distinto por alumno. null sirve todas las preguntas cargadas.
  questionsToServe: z.number().int().positive().max(1000).nullable().default(null),
  // De las servidas, cuántas deben ser de desarrollo. Se sortean aparte para que
  // ningún alumno reciba una evaluación sin preguntas para justificar por escrito.
  longToServe: z.number().int().nonnegative().max(100).default(2),
  // Cuantas preguntas sirve de cada seccion: { "Teoria": 2, "Practica": 4 }.
  // Cuando tiene entradas manda sobre questionsToServe y sobre longToServe,
  // porque el docente ya definio la composicion explicitamente.
  sectionQuotas: z.record(z.string().trim().min(1).max(60), z.number().int().nonnegative().max(1000)).default({}),
  shuffleQuestions: z.boolean().default(false),
  shuffleOptions: z.boolean().default(false),
  allowBackwards: z.boolean().default(true),
  showProgress: z.boolean().default(true),
  autoSubmit: z.boolean().default(true),
  allowReconnect: z.boolean().default(true),
  supervisionLevel: supervisionLevelSchema.default("normal"),
  requireFullscreen: z.boolean().default(false),
  detectFocusLoss: z.boolean().default(true),
  blockClipboard: z.boolean().default(false),
  recordDisconnects: z.boolean().default(true),
  violationAction: violationActionSchema.default("warn_and_record"),
  resultsDisplay: resultsDisplaySchema.default("score_only"),
  resultsWhen: resultsWhenSchema.default("teacher_publishes"),
  passingScorePercent: z.number().min(0).max(100).nullable().optional(),
  status: z.enum(["draft", "ready"]),
  questions: z.array(fullQuestionSchema).min(1, "Agregá al menos una pregunta"),
  updatedAt: z.iso.datetime(),
}).superRefine((exam, context) => {
  if (exam.deliveryMode === "async") {
    if (exam.availableFrom && exam.availableUntil && Date.parse(exam.availableFrom) >= Date.parse(exam.availableUntil)) {
      context.addIssue({ code: "custom", path: ["availableUntil"], message: "El cierre debe ser posterior a la apertura" });
    }
  }
  if (exam.status !== "ready") return;
  if (exam.deliveryMode === "async") {
    if (!exam.availableFrom) context.addIssue({ code: "custom", path: ["availableFrom"], message: "Definí cuándo se abre la evaluación" });
    if (!exam.availableUntil) context.addIssue({ code: "custom", path: ["availableUntil"], message: "Definí cuándo cierra la evaluación" });
  }
  if (exam.title.trim().length < 3) {
    context.addIssue({ code: "custom", path: ["title"], message: "Escribí un título de al menos 3 caracteres" });
  }
  if (!exam.subject.trim()) {
    context.addIssue({ code: "custom", path: ["subject"], message: "Indicá la materia" });
  }
  const quotas = Object.entries(exam.sectionQuotas).filter(([, count]) => count > 0);
  if (quotas.length) {
    const porSeccion = new Map<string, number>();
    for (const question of exam.questions) {
      if (!question.section) continue;
      porSeccion.set(question.section, (porSeccion.get(question.section) ?? 0) + 1);
    }
    for (const [section, count] of quotas) {
      const disponibles = porSeccion.get(section) ?? 0;
      if (disponibles === 0) {
        context.addIssue({
          code: "custom",
          path: ["sectionQuotas", section],
          message: `La seccion "${section}" no tiene ninguna pregunta cargada`,
        });
      } else if (count > disponibles) {
        context.addIssue({
          code: "custom",
          path: ["sectionQuotas", section],
          message: `Pediste ${count} de "${section}" pero solo hay ${disponibles} cargada${disponibles === 1 ? "" : "s"}`,
        });
      }
    }
  }

  if (exam.questionsToServe !== null && exam.questionsToServe > exam.questions.length) {
    context.addIssue({
      code: "custom",
      path: ["questionsToServe"],
      message: `No podés servir ${exam.questionsToServe} preguntas si el pozo tiene ${exam.questions.length}`,
    });
  }
  if (exam.questionsToServe !== null && exam.longToServe > exam.questionsToServe) {
    context.addIssue({
      code: "custom",
      path: ["longToServe"],
      message: `No podés pedir ${exam.longToServe} de desarrollo si servís ${exam.questionsToServe} preguntas`,
    });
  }
  const desarrolloEnPozo = exam.questions.filter((question) => question.type === "long").length;
  if (exam.questionsToServe !== null && exam.longToServe > desarrolloEnPozo) {
    context.addIssue({
      code: "custom",
      path: ["longToServe"],
      message: `El pozo solo tiene ${desarrolloEnPozo} preguntas de desarrollo`,
    });
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
      section?: string;
      assets: QuestionAsset[];
      type: "mc";
      config: { options: Array<{ id: string; text: string }> };
    }
  | {
      id: string;
      position: number;
      prompt: string;
      points: number;
      section?: string;
      assets: QuestionAsset[];
      type: "ms";
      config: { options: Array<{ id: string; text: string }> };
    }
  | {
      id: string;
      position: number;
      prompt: string;
      points: number;
      section?: string;
      assets: QuestionAsset[];
      type: "tf";
      config: Record<string, never>;
    }
  | {
      id: string;
      position: number;
      prompt: string;
      points: number;
      section?: string;
      assets: QuestionAsset[];
      type: "sa";
      config: Record<string, never>;
    }
  | {
      id: string;
      position: number;
      prompt: string;
      points: number;
      section?: string;
      assets: QuestionAsset[];
      type: "long";
      config: Record<string, never>;
    };

export function toStudentQuestion(question: FullQuestion): StudentQuestion {
  const base = {
    id: question.id,
    position: question.position,
    prompt: question.prompt,
    points: question.points,
    section: question.section,
    assets: question.assets ?? [],
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
