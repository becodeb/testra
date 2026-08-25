export interface CorrectionGroupItem {
  participantId: string;
  studentName: string;
  questionId: string;
  prompt: string;
  pointsAwarded: number | null;
}

export function groupCorrectionsByQuestion<T extends CorrectionGroupItem>(items: T[]) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const current = groups.get(item.questionId) ?? [];
    current.push(item);
    groups.set(item.questionId, current);
  }

  return [...groups.values()]
    .map((groupItems) => {
      const sorted = [...groupItems].sort((a, b) => a.studentName.localeCompare(b.studentName));
      return {
        questionId: sorted[0].questionId,
        prompt: sorted[0].prompt,
        completed: sorted.filter((item) => item.pointsAwarded !== null).length,
        total: sorted.length,
        items: sorted,
      };
    })
    .sort((a, b) => a.questionId.localeCompare(b.questionId));
}
