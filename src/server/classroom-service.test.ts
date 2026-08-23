import { describe, expect, it } from "vitest";

import { normalizeStudentName, uniqueGoogleUsersByName } from "@/server/classroom";

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
});
