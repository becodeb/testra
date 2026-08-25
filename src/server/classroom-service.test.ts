import { describe, expect, it } from "vitest";

import { matchClassroomStudent, normalizeStudentEmail, normalizeStudentName, uniqueGoogleUsersByName } from "@/server/classroom";

describe("Classroom student matching", () => {
  it("matches names independently of accents, case and extra whitespace", () => {
    expect(normalizeStudentName("  Bautista   Goñi ")).toBe("bautista goni");
  });

  it("only maps unambiguous roster names", () => {
    const users = uniqueGoogleUsersByName([
      { google_user_id: "1", name: "Ana Pérez" },
      { google_user_id: "2", name: "Juan López" },
      { google_user_id: "3", name: "Ana Perez" },
    ]);
    expect(users.get("juan lopez")).toBe("2");
    expect(users.has("ana perez")).toBe(false);
  });

  it("prefers the stable Google id, then a normalized unique email", () => {
    const roster = [
      { google_user_id: "g-1", email: "ana@escuela.edu" },
      { google_user_id: "g-2", email: "juan@escuela.edu" },
    ];
    expect(matchClassroomStudent({ googleUserId: "g-2", email: "otro@escuela.edu" }, roster)).toEqual({ googleUserId: "g-2", method: "google_id" });
    expect(matchClassroomStudent({ googleUserId: null, email: "  ANA@ESCUELA.EDU " }, roster)).toEqual({ googleUserId: "g-1", method: "email" });
    expect(normalizeStudentEmail("  ANA@ESCUELA.EDU ")).toBe("ana@escuela.edu");
  });

  it("never links ambiguous emails or names alone", () => {
    const roster = [
      { google_user_id: "g-1", email: "ana@escuela.edu" },
      { google_user_id: "g-2", email: "ANA@ESCUELA.EDU" },
    ];
    expect(matchClassroomStudent({ googleUserId: null, email: "ana@escuela.edu" }, roster)).toBeNull();
    expect(matchClassroomStudent({ googleUserId: null, email: null }, roster)).toBeNull();
  });
});
