import { afterEach, describe, expect, it, vi } from "vitest";

import { getCoursework, listTeacherCourses, returnSubmission, sendGradeToClassroom } from "@/server/classroom";

afterEach(() => vi.unstubAllGlobals());

describe("Google Classroom client", () => {
  it("paginates teacher courses", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ courses: [{ id: "1", name: "A", ownerId: "me", courseState: "ACTIVE" }], nextPageToken: "next" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ courses: [{ id: "2", name: "B", ownerId: "me", courseState: "ACTIVE" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await listTeacherCourses("token");
    expect(result.courses.map((course) => course.id)).toEqual(["1", "2"]);
    expect(String(fetchMock.mock.calls[1][0])).toContain("pageToken=next");
  });

  it("writes draftGrade and assignedGrade together", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "submission", draftGrade: 8, assignedGrade: 8 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await sendGradeToClassroom("token", { courseId: "course", courseworkId: "work", submissionId: "submission", grade: 8 });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ draftGrade: 8, assignedGrade: 8 });
    expect(String(fetchMock.mock.calls[0][0])).toContain("updateMask=draftGrade,assignedGrade");
  });

  // Un alumno que rinde en Testra entra por el enlace y nunca toca el boton de
  // entregar de Classroom, asi que su entrega se queda en CREATED. Antes se
  // exigia TURNED_IN y eso dejaba al curso entero sin nota.
  it("grades a submission the student never turned in", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "submission", draftGrade: 8, assignedGrade: 8 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      sendGradeToClassroom("token", { courseId: "course", courseworkId: "work", submissionId: "submission", grade: 8 }),
    ).resolves.toMatchObject({ id: "submission" });
  });

  it("returns the submission so the student can see the grade", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await returnSubmission("token", { courseId: "course", courseworkId: "work", submissionId: "submission" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/studentSubmissions/submission:return");
    expect(init.method).toBe("POST");
  });

  it("reads the real Classroom maximum for historical and pooled exams", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "work", maxPoints: 30 }), { status: 200 })));
    await expect(getCoursework("token", "course", "work")).resolves.toEqual({ id: "work", maxPoints: 30 });
  });
});
