export function formatAssignedProgress(answered: number, assigned: number) {
  return `${Math.max(0, answered)}/${Math.max(0, assigned)}`;
}
