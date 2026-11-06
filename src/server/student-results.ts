import type { FullQuestion } from "@/domain/exam";
import { db } from "@/server/db/client";
import { isAnswered, parseJson, printedAnswer } from "@/server/exam-printout";
import { questionsForParticipant } from "@/server/participant-paper";
import { participantOwnedBy, type RunRow, type StudentAccess } from "@/server/repository";
import { resultsVisibility, withoutGrading, type StudentResultAnswer, type StudentResultQuestion, type StudentResults } from "@/lib/student-results";

interface GradeRow {
  question_id: string;
  points_awarded: number | null;
  grading_status: string;
  feedback: string | null;
}

const isConfirmed = (grade: GradeRow | undefined) => grade?.grading_status === "auto_graded" || grade?.grading_status === "graded";

function resultAnswer(question: FullQuestion, value: unknown): StudentResultAnswer {
  const answer = printedAnswer(question, value);
  // La respuesta de referencia de un desarrollo es del docente: nunca se libera.
  if (answer.kind === "text") return answer.accepted ? { kind: "text", value: answer.value, accepted: answer.accepted } : { kind: "text", value: answer.value };
  return answer;
}

/**
 * Lo que este alumno puede ver de su entrega. La nota cuenta solo lo confirmado:
 * una sugerencia de la IA que el docente no revisó no es una corrección.
 */
export async function getStudentResults(access: StudentAccess, participantId: string): Promise<StudentResults | null> {
  const participant = await participantOwnedBy(participantId, access);
  if (!participant) return null;
  const run = await db.prepare("SELECT * FROM runs WHERE id = ?").bind(participant.run_id).first<RunRow>();
  if (!run) return null;

  const { level, waitingFor } = resultsVisibility({
    display: run.results_display,
    when: run.results_when,
    runStatus: run.status,
    publishedAt: run.results_published_at,
    participantStatus: participant.status,
  });
  if (level === "none") return { level, waitingFor, final: run.results_display === "hidden" };

  const questions = questionsForParticipant(run, participant);
  const [gradeResult, answerResult] = await Promise.all([
    db.prepare("SELECT question_id, points_awarded, grading_status, feedback FROM grades WHERE participant_id = ?").bind(participantId).all<GradeRow>(),
    db.prepare("SELECT question_id, value FROM answers WHERE participant_id = ?").bind(participantId).all<{ question_id: string; value: string }>(),
  ]);
  const grades = new Map(gradeResult.results.map((grade) => [grade.question_id, grade]));
  const answers = new Map(answerResult.results.map((answer) => [answer.question_id, parseJson(answer.value)]));

  const awarded = questions.reduce((sum, question) => {
    const grade = grades.get(question.id);
    return sum + (isConfirmed(grade) ? Number(grade?.points_awarded ?? 0) : 0);
  }, 0);
  const max = questions.reduce((sum, question) => sum + question.points, 0);
  const pendingCorrections = questions.filter((question) => !isConfirmed(grades.get(question.id))).length;
  const percent = max > 0 ? Math.round((awarded / max) * 100) : 0;
  const score = {
    awarded,
    max,
    percent,
    pendingCorrections,
    // Con correcciones pendientes la nota todavía puede subir: no se adelanta el veredicto.
    passed: pendingCorrections || run.passing_score_percent === null ? null : percent >= Number(run.passing_score_percent),
  };
  const final = run.status === "ended" && pendingCorrections === 0;
  if (level === "score") return { level, waitingFor, final, score };

  const printed = questions.map((question, index): StudentResultQuestion => {
    const value = answers.get(question.id);
    const answer = resultAnswer(question, value);
    const base = {
      id: question.id,
      number: index + 1,
      prompt: question.prompt,
      assets: question.assets ?? [],
      points: question.points,
      answered: isAnswered(value),
    };
    if (level === "answers") return { ...base, answer: withoutGrading(answer) };
    const grade = grades.get(question.id);
    return {
      ...base,
      answer,
      review: isConfirmed(grade)
        ? { pointsAwarded: Number(grade?.points_awarded ?? 0), feedback: grade?.feedback?.trim() ?? "" }
        : { pointsAwarded: null, feedback: "" },
    };
  });
  return { level, waitingFor, final, score, questions: printed };
}
