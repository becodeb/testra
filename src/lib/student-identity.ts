export interface StudentIdentity {
  name?: string | null;
  email?: string | null;
}

export function normalizeStudentName(name: string) {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function normalizeStudentEmail(email: string | null | undefined) {
  return email?.trim().toLocaleLowerCase() || null;
}

function nameTokens(name: string) {
  return new Set(normalizeStudentName(name).split(" ").filter(Boolean));
}

/**
 * Acepta un nombre abreviado sólo cuando todos sus términos aparecen en el
 * nombre completo. La persona que llama debe además verificar que no haya
 * otra coincidencia posible antes de usarlo.
 */
export function namesAreCompatible(first: string | null | undefined, second: string | null | undefined) {
  if (!first?.trim() || !second?.trim()) return false;
  const firstTokens = nameTokens(first);
  const secondTokens = nameTokens(second);
  if (!firstTokens.size || !secondTokens.size) return false;
  const firstContainedInSecond = [...firstTokens].every((token) => secondTokens.has(token));
  const secondContainedInFirst = [...secondTokens].every((token) => firstTokens.has(token));
  return firstContainedInSecond || secondContainedInFirst;
}

/**
 * Devuelve los alumnos esperados que ya están presentes. Nunca reutiliza un
 * participante ni acepta un nombre parcial si deja más de una opción.
 */
export function matchedExpectedStudentIndexes(expected: StudentIdentity[], participants: StudentIdentity[]) {
  const matchedExpected = new Set<number>();
  const matchedParticipants = new Set<number>();

  function matchUnique(predicate: (student: StudentIdentity, participant: StudentIdentity) => boolean) {
    for (let expectedIndex = 0; expectedIndex < expected.length; expectedIndex += 1) {
      if (matchedExpected.has(expectedIndex)) continue;
      const candidates = participants
        .map((participant, participantIndex) => ({ participant, participantIndex }))
        .filter(({ participant, participantIndex }) => !matchedParticipants.has(participantIndex) && predicate(expected[expectedIndex], participant));
      if (candidates.length !== 1) continue;

      const { participantIndex } = candidates[0];
      const reverseCandidates = expected
        .map((student, otherExpectedIndex) => ({ student, otherExpectedIndex }))
        .filter(({ student, otherExpectedIndex }) => !matchedExpected.has(otherExpectedIndex) && predicate(student, participants[participantIndex]));
      if (reverseCandidates.length !== 1) continue;

      matchedExpected.add(expectedIndex);
      matchedParticipants.add(participantIndex);
    }
  }

  matchUnique((student, participant) => {
    const studentEmail = normalizeStudentEmail(student.email);
    return Boolean(studentEmail && studentEmail === normalizeStudentEmail(participant.email));
  });
  matchUnique((student, participant) => Boolean(student.name && participant.name && normalizeStudentName(student.name) === normalizeStudentName(participant.name)));
  matchUnique((student, participant) => namesAreCompatible(student.name, participant.name));

  return matchedExpected;
}
