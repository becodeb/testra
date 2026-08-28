export function normalizeExtraTime(seconds: number) { return Math.max(0, Math.min(24 * 60 * 60, Math.trunc(seconds))); }
export function participantDeadline(baseEndsAt: number, extraTimeS: number, now = 0) { return Math.max(now, baseEndsAt + normalizeExtraTime(extraTimeS) * 1000); }
export function shiftDeadline(deadlineAt: number, deltaS: number, now: number) { return Math.max(now, deadlineAt + Math.trunc(deltaS) * 1000); }
export type AsyncAvailability = "upcoming" | "available" | "closed";

export function asyncAvailabilityState(availableFrom: number, availableUntil: number, now = Date.now()): AsyncAvailability {
  if (now < availableFrom) return "upcoming";
  if (now >= availableUntil) return "closed";
  return "available";
}

export function asyncAttemptDeadline(startedAt: number, timeLimitS: number, extraTimeS = 0) {
  return startedAt + (Math.max(60, Math.trunc(timeLimitS)) + normalizeExtraTime(extraTimeS)) * 1000;
}

export function allDeadlinesComplete(baseEndsAt: number, now: number, statuses: string[]) {
  return now >= baseEndsAt && statuses.every((status) => status === "submitted" || status === "expired");
}
