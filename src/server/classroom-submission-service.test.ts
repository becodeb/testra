import { describe, expect, it } from "vitest";

import { canAutomaticallyReturnClassroomGrade, classroomErrorForTeacher } from "@/server/classroom-submission-service";

describe("automatic Classroom return", () => {
  it("returns only fully auto-corrected exams", () => {
    expect(canAutomaticallyReturnClassroomGrade({ maxPoints: 10, hasPendingManual: false })).toBe(true);
    expect(canAutomaticallyReturnClassroomGrade({ maxPoints: 10, hasPendingManual: true })).toBe(false);
  });

  it("does not return an exam without graded points", () => {
    expect(canAutomaticallyReturnClassroomGrade({ maxPoints: 0, hasPendingManual: false })).toBe(false);
  });

  it("translates Classroom precondition errors into an actionable message", () => {
    expect(classroomErrorForTeacher(new Error('Classroom respondió 400: { "status": "FAILED_PRECONDITION" }')))
      .toBe("Classroom no pudo devolver la nota porque el alumno todavía no presionó Entregar en esa tarea.");
  });
});
