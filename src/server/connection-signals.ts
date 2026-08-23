const TRANSIENT_VALUES = new Set(["pending-socket", "restored", "unknown"]);

export function shouldCompareConnectionValue(value: string | undefined) {
  return Boolean(value && !TRANSIENT_VALUES.has(value));
}
