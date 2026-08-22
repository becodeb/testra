export const STUDENT_SESSION_COOKIE = "testra_student_session";

export interface GuestSession {
  participantId: string;
  token: string;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function createGuestToken() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashGuestToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return base64Url(new Uint8Array(digest));
}

export function encodeGuestSession(participantId: string, token: string) {
  return `${participantId}.${token}`;
}

export function readGuestSession(request: Request): GuestSession | null {
  const cookie = request.headers.get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${STUDENT_SESSION_COOKIE}=`));
  if (!cookie) return null;
  const value = decodeURIComponent(cookie.slice(STUDENT_SESSION_COOKIE.length + 1));
  const separator = value.indexOf(".");
  if (separator < 1) return null;
  const participantId = value.slice(0, separator);
  const token = value.slice(separator + 1);
  return participantId && token ? { participantId, token } : null;
}
