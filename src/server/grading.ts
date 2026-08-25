import type { FullQuestion } from "@/domain/exam";

export type AnswerValue = string | boolean | string[] | null;

export interface SubmittedAnswer {
  questionId: string;
  value: AnswerValue;
}

export interface QuestionGrade {
  questionId: string;
  auto: boolean | null;
  pointsAwarded: number | null;
  maxPoints: number;
}

export interface GradeResult {
  questions: QuestionGrade[];
  awardedPoints: number;
  pendingManualPoints: number;
  maxPoints: number;
}

const DIACRITICS = /[\u0300-\u036f]/g;
const WHITESPACE = /\s+/g;

export function normalizeShortAnswer(value: string): string {
  return value
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toLocaleLowerCase("es")
    .replace(WHITESPACE, " ")
    .trim();
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

/**
 * Crédito parcial para selección múltiple. Cada acierto aporta una fracción
 * igual y cada opción incorrecta resta una fracción igual. El piso evita notas
 * negativas y el techo protege el máximo aun si llegan opciones duplicadas.
 */
export function partialMultiSelectScore(
  selected: string[],
  correctIds: string[],
  allOptionIds: string[],
  maxPoints: number,
): number {
  const uniqueSelected = new Set(selected.filter((id) => allOptionIds.includes(id)));
  const correct = new Set(correctIds);
  const wrongCount = Math.max(1, allOptionIds.length - correct.size);
  let selectedCorrect = 0;
  let selectedWrong = 0;
  for (const optionId of uniqueSelected) {
    if (correct.has(optionId)) selectedCorrect += 1;
    else selectedWrong += 1;
  }
  const fraction = selectedCorrect / correct.size - selectedWrong / wrongCount;
  return Math.min(maxPoints, Math.max(0, fraction * maxPoints));
}

export function gradeQuestion(question: FullQuestion, value: AnswerValue): QuestionGrade {
  let correct: boolean | null;

  switch (question.type) {
    case "mc":
      correct = typeof value === "string" && value === question.config.correctOptionId;
      break;
    case "ms":
      if (question.config.gradingMode === "partial") {
        const selected = Array.isArray(value) ? value : [];
        const exact = sameStringSet([...new Set(selected)], question.config.correctOptionIds);
        const pointsAwarded = partialMultiSelectScore(
          selected,
          question.config.correctOptionIds,
          question.config.options.map((option) => option.id),
          question.points,
        );
        return {
          questionId: question.id,
          auto: exact,
          pointsAwarded,
          maxPoints: question.points,
        };
      }
      correct = Array.isArray(value) && sameStringSet(value, question.config.correctOptionIds);
      break;
    case "tf":
      correct = typeof value === "boolean" && value === question.config.correct;
      break;
    case "sa": {
      const normalized = typeof value === "string" ? normalizeShortAnswer(value) : "";
      correct = question.config.accepted.some(
        (accepted) => normalizeShortAnswer(accepted) === normalized,
      );
      break;
    }
    case "long":
      correct = null;
      break;
  }

  return {
    questionId: question.id,
    auto: correct,
    pointsAwarded: correct === null ? null : correct ? question.points : 0,
    maxPoints: question.points,
  };
}

export function gradeExam(
  questions: FullQuestion[],
  submittedAnswers: SubmittedAnswer[],
): GradeResult {
  const answerByQuestion = new Map(
    submittedAnswers.map((answer) => [answer.questionId, answer.value]),
  );
  const grades = questions.map((question) =>
    gradeQuestion(question, answerByQuestion.get(question.id) ?? null),
  );

  return {
    questions: grades,
    awardedPoints: grades.reduce((sum, grade) => sum + (grade.pointsAwarded ?? 0), 0),
    pendingManualPoints: grades.reduce(
      (sum, grade) => sum + (grade.auto === null ? grade.maxPoints : 0),
      0,
    ),
    maxPoints: grades.reduce((sum, grade) => sum + grade.maxPoints, 0),
  };
}
