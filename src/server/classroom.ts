import { z } from "zod";

const CLASSROOM_API = "https://classroom.googleapis.com/v1";

export const CLASSROOM_SCOPES = {
  courses: "https://www.googleapis.com/auth/classroom.courses.readonly",
  rosters: "https://www.googleapis.com/auth/classroom.rosters.readonly",
  emails: "https://www.googleapis.com/auth/classroom.profile.emails",
  coursework: "https://www.googleapis.com/auth/classroom.coursework.students",
} as const;

const courseSchema = z.object({
  id: z.string(),
  name: z.string(),
  section: z.string().optional(),
  ownerId: z.string(),
  courseState: z.string(),
});

const studentSchema = z.object({
  userId: z.string(),
  profile: z.object({
    id: z.string(),
    name: z.object({ fullName: z.string() }),
    emailAddress: z.email().optional(),
  }),
});

async function classroomFetch<T>(
  accessToken: string,
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${CLASSROOM_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Classroom respondió ${response.status}: ${body.slice(0, 300)}`);
  }

  return schema.parse(await response.json());
}

export async function listTeacherCourses(accessToken: string) {
  const schema = z.object({ courses: z.array(courseSchema).default([]), nextPageToken: z.string().optional() });
  const courses: z.infer<typeof courseSchema>[] = [];
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({ teacherId: "me", courseStates: "ACTIVE", pageSize: "100" });
    if (pageToken) query.set("pageToken", pageToken);
    const page = await classroomFetch(accessToken, `/courses?${query}`, schema);
    courses.push(...page.courses);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return { courses };
}

export async function listCourseStudents(accessToken: string, courseId: string) {
  const schema = z.object({ students: z.array(studentSchema).default([]), nextPageToken: z.string().optional() });
  const students: z.infer<typeof studentSchema>[] = [];
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({ pageSize: "100" });
    if (pageToken) query.set("pageToken", pageToken);
    const page = await classroomFetch(accessToken, `/courses/${encodeURIComponent(courseId)}/students?${query}`, schema);
    students.push(...page.students);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return { students };
}

const submissionSchema = z.object({
  id: z.string(),
  userId: z.string(),
  state: z.string(),
  draftGrade: z.number().optional(),
  assignedGrade: z.number().optional(),
});

export async function listCourseworkSubmissions(accessToken: string, courseId: string, courseworkId: string) {
  const pageSchema = z.object({ studentSubmissions: z.array(submissionSchema).default([]), nextPageToken: z.string().optional() });
  const submissions: z.infer<typeof submissionSchema>[] = [];
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({ pageSize: "100" });
    if (pageToken) query.set("pageToken", pageToken);
    const page = await classroomFetch(accessToken, `/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(courseworkId)}/studentSubmissions?${query}`, pageSchema);
    submissions.push(...page.studentSubmissions);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return { submissions };
}

export async function createLinkedCoursework(
  accessToken: string,
  input: { courseId: string; title: string; description: string; runUrl: string; maxPoints: number },
) {
  const schema = z.object({ id: z.string(), courseId: z.string(), alternateLink: z.url() });
  return classroomFetch(
    accessToken,
    `/courses/${encodeURIComponent(input.courseId)}/courseWork`,
    schema,
    {
      method: "POST",
      body: JSON.stringify({
        title: input.title,
        description: input.description,
        workType: "ASSIGNMENT",
        state: "PUBLISHED",
        maxPoints: input.maxPoints,
        materials: [{ link: { url: input.runUrl, title: input.title } }],
      }),
    },
  );
}

export async function sendGradeToClassroom(
  accessToken: string,
  input: {
    courseId: string;
    courseworkId: string;
    submissionId: string;
    grade: number;
    submissionState: string;
  },
) {
  if (input.submissionState !== "TURNED_IN" && input.submissionState !== "RETURNED") {
    throw new Error("Classroom sólo permite devolver una entrega que el alumno ya entregó");
  }

  const schema = z.object({ id: z.string(), draftGrade: z.number(), assignedGrade: z.number() });
  const path = [
    "/courses/",
    encodeURIComponent(input.courseId),
    "/courseWork/",
    encodeURIComponent(input.courseworkId),
    "/studentSubmissions/",
    encodeURIComponent(input.submissionId),
    "?updateMask=draftGrade,assignedGrade",
  ].join("");

  return classroomFetch(accessToken, path, schema, {
    method: "PATCH",
    body: JSON.stringify({ draftGrade: input.grade, assignedGrade: input.grade }),
  });
}
