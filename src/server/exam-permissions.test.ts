import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actors";
import { capabilitiesFor } from "@/server/exam-permissions";

const actor: Actor = {
  id: "teacher-2",
  email: "docente@example.com",
  name: "Docente",
  image: null,
  role: "teacher",
  orgId: null,
  orgAdmin: false,
  superadmin: false,
};

describe("exam collaboration capabilities", () => {
  it("keeps owner-only destructive and sharing permissions", () => {
    const access = capabilitiesFor(actor, {
      owner_id: actor.id,
      permission: null,
      can_publish_results: null,
      can_manage_classroom: null,
    });
    expect(access).toMatchObject({ role: "owner", edit: true, correct: true, manageSharing: true, delete: true });
  });

  it("does not grant sensitive actions implicitly to editors", () => {
    const access = capabilitiesFor(actor, {
      owner_id: "owner",
      permission: "edit",
      can_publish_results: 0,
      can_manage_classroom: 0,
    });
    expect(access).toMatchObject({ view: true, edit: true, openRuns: true, correct: false, publishResults: false, manageClassroom: false });
  });

  it("grants publishing and Classroom only through explicit flags", () => {
    const access = capabilitiesFor(actor, {
      owner_id: "owner",
      permission: "correct",
      can_publish_results: 1,
      can_manage_classroom: 1,
    });
    expect(access).toMatchObject({ correct: true, edit: false, publishResults: true, manageClassroom: true, delete: false });
  });
});
