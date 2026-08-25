import { z } from "zod";

const CLASSROOM_API = "https://classroom.googleapis.com/v1";

export const CLASSROOM_SCOPES = {
  courses: "https://www.googleapis.com/auth/classroom.courses.readonly",
  rosters: "https://www.googleapis.com/auth/classroom.rosters.readonly",
  coursework: "https://www.googleapis.com/auth/classroom.coursework.students",
} as const;

export function normalizeStudentName(name: string) {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function uniqueGoogleUsersByName(rows: Array<{ google_user_id: string; name: string }>) {
  const users = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const row of rows) {
    const normalized = normalizeStudentName(row.name);
    if (users.has(normalized)) ambiguous.add(normalized);
    else users.set(normalized, row.google_user_id);
  }
  for (const normalized of ambiguous) users.delete(normalized);
  return users;
}

export function normalizeStudentEmail(email: string | null | undefined) {
  return email?.trim().toLocaleLowerCase() || null;
}

export interface ClassroomRosterIdentity {
  google_user_id: string;
  email: string | null;
}

export interface TestraStudentIdentity {
  googleUserId: string | null;
  email: string | null;
}

/**
 * Vinculacion conservadora: primero el identificador Google de la cuenta y
 * despues un correo unico normalizado. El nombre no participa porque dos
 * personas homonimas nunca deben compartir una nota.
 */
export function matchClassroomStudent(
  student: TestraStudentIdentity,
  roster: ClassroomRosterIdentity[],
): { googleUserId: string; method: "google_id" | "email" } | null {
  if (student.googleUserId) {
    const byId = roster.filter((row) => row.google_user_id === student.googleUserId);
    if (byId.length === 1) return { googleUserId: byId[0].google_user_id, method: "google_id" };
  }

  const email = normalizeStudentEmail(student.email);
  if (!email) return null;
  const byEmail = roster.filter((row) => normalizeStudentEmail(row.email) === email);
  return byEmail.length === 1 ? { googleUserId: byEmail[0].google_user_id, method: "email" } : null;
}

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

export async function getCoursework(accessToken: string, courseId: string, courseworkId: string) {
  return classroomFetch(
    accessToken,
    `/courses/${encodeURIComponent(courseId)}/courseWork/${encodeURIComponent(courseworkId)}`,
    z.object({ id: z.string(), maxPoints: z.number().positive().default(100) }),
  );
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

function submissionPath(courseId: string, courseworkId: string, submissionId: string) {
  return [
    "/courses/",
    encodeURIComponent(courseId),
    "/courseWork/",
    encodeURIComponent(courseworkId),
    "/studentSubmissions/",
    encodeURIComponent(submissionId),
  ].join("");
}

/**
 * Escribe la nota. `draftGrade` sólo la ve el docente; `assignedGrade` es la
 * definitiva, y recién se le muestra al alumno cuando la entrega se devuelve
 * con `returnSubmission`. Por eso las dos llamadas van siempre juntas.
 *
 * No se exige que el alumno haya entregado en Classroom. Un alumno que rinde en
 * Testra entra por el enlace y nunca toca el botón de entregar, así que su
 * entrega se queda en CREATED para siempre: exigir TURNED_IN dejaba a todo el
 * curso sin nota. La API de Classroom no pone esa restricción para escribir
 * notas, solamente para transferir archivos adjuntos, que acá no hay.
 */
export async function sendGradeToClassroom(
  accessToken: string,
  input: { courseId: string; courseworkId: string; submissionId: string; grade: number },
) {
  const schema = z.object({ id: z.string(), draftGrade: z.number().optional(), assignedGrade: z.number().optional() });
  return classroomFetch(
    accessToken,
    `${submissionPath(input.courseId, input.courseworkId, input.submissionId)}?updateMask=draftGrade,assignedGrade`,
    schema,
    { method: "PATCH", body: JSON.stringify({ draftGrade: input.grade, assignedGrade: input.grade }) },
  );
}

/** Devuelve la entrega al alumno. Sin esto la nota queda invisible para él. */
export async function returnSubmission(
  accessToken: string,
  input: { courseId: string; courseworkId: string; submissionId: string },
) {
  return classroomFetch(
    accessToken,
    `${submissionPath(input.courseId, input.courseworkId, input.submissionId)}:return`,
    z.object({}).loose(),
    { method: "POST", body: "{}" },
  );
}
