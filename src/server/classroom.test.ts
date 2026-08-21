import { afterEach, describe, expect, it, vi } from "vitest";

import { listTeacherCourses, sendGradeToClassroom } from "@/server/classroom";

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
    await sendGradeToClassroom("token", { courseId: "course", courseworkId: "work", submissionId: "submission", grade: 8, submissionState: "TURNED_IN" });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ draftGrade: 8, assignedGrade: 8 });
    expect(String(fetchMock.mock.calls[0][0])).toContain("updateMask=draftGrade,assignedGrade");
  });

  it("refuses grades for work not submitted in Classroom", async () => {
    await expect(sendGradeToClassroom("token", { courseId: "course", courseworkId: "work", submissionId: "submission", grade: 8, submissionState: "CREATED" })).rejects.toThrow(/ya entregó/);
  });
});
