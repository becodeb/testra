import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

function examPayload(title: string, status: "draft" | "ready" = "ready", questionCount = 1) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    id: `exam-${stamp}`,
    title,
    subject: "Ciencias",
    instructions: "Leé con atención antes de responder.",
    timeLimitS: 1800,
    shuffleQuestions: true,
    shuffleOptions: true,
    status,
    updatedAt: new Date().toISOString(),
    questions: Array.from({ length: questionCount }, (_, index) => ({
      id: `question-${stamp}-${index}`,
      position: index,
      prompt: `Pregunta identificable ${index + 1}`,
      points: 1,
      type: "mc" as const,
      config: {
        options: Array.from({ length: 4 }, (__, optionIndex) => ({
          id: `option-${stamp}-${index}-${optionIndex}`,
          text: `Respuesta ${index + 1}.${optionIndex + 1}`,
        })),
        correctOptionId: `option-${stamp}-${index}-0`,
      },
    })),
  };
}

async function enterDemoRun(page: Page, name = `Alumno prueba ${Date.now()}`) {
  await page.goto("/rendir/demo");
  if (await page.getByRole("heading", { name: "¿Cómo te llamás?" }).isVisible()) {
    await page.getByLabel("Tu nombre y apellido").fill(name);
    await page.getByRole("button", { name: "Entrar a la sala" }).click();
  }
  await page.locator("[data-student-ready=true]").waitFor();
  return name;
}

async function createExamFromSetup(page: Page, title: string, subject = "Ciencias") {
  await page.goto("/evaluaciones/nueva");
  await page.getByLabel("Título").fill(title);
  await page.getByLabel("Materia").fill(subject);
  await page.getByRole("button", { name: "Crear y agregar preguntas" }).click();
  await page.locator("[data-editor-ready=true]").waitFor();
}

test("a new user can create an account with email and password", async ({ page }) => {
  const email = `cuenta-${Date.now()}-${Math.random().toString(36).slice(2)}@gmail.com`;
  await page.goto("/login");
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await page.getByLabel("Nombre y apellido").fill("Cuenta de prueba");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill("Testra-Prueba-2026");
  await page.getByRole("button", { name: "Crear mi cuenta" }).click();
  await expect(page).toHaveURL(/\/onboarding(?:\?|$)/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Configurá tu espacio" })).toBeVisible();
});

test("the teacher editor adds a question from the keyboard shortcut", async ({ page }) => {
  await createExamFromSetup(page, `Atajo ${Date.now()}`);
  const bubbles = page.getByRole("button", { name: /^Pregunta \d/ });
  await expect(bubbles).toHaveCount(1);
  await page.getByRole("textbox", { name: "Enunciado" }).press("Control+Enter");
  await expect(bubbles).toHaveCount(2);
  await expect(page.getByText("Pregunta 2 de 2")).toBeVisible();
});

test("student markup never contains answer-key fields", async ({ page }) => {
  await enterDemoRun(page);
  const html = await page.content();
  expect(html).not.toContain("correctOptionId");
  expect(html).not.toContain("correctOptionIds");
  expect(html).not.toContain("accepted");
});

for (const route of ["/evaluaciones", "/evaluaciones/nueva", "/rendir/demo"]) {
  test(`${route} has no serious axe violations`, async ({ page }) => {
    if (route === "/rendir/demo") await enterDemoRun(page);
    else await page.goto(route);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
    expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
  });
}

test("student answers survive question navigation", async ({ page }) => {
  await enterDemoRun(page);
  const answer = page.getByRole("radio", { name: "Fotosíntesis" });
  await answer.click();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("button", { name: "Anterior" }).click();
  await expect(answer).toBeChecked();
});

test("student answers survive a full reload through D1 autosave", async ({ page }) => {
  const title = `Persistencia de respuesta ${Date.now()}`;
  const examCreation = await page.request.post("/api/exams", { data: examPayload(title) });
  expect(examCreation.status()).toBe(201);
  const exam = await examCreation.json() as { id: string };
  const runCreation = await page.request.post("/api/runs", { data: { examId: exam.id } });
  expect(runCreation.status()).toBe(201);
  const run = await runCreation.json() as { id: string; code: string };
  await page.goto("/rendir");
  await page.locator("[data-join-ready=true]").waitFor();
  await page.getByLabel("Código de la evaluación").fill(run.code);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "¿Cómo te llamás?" })).toBeVisible();
  await page.locator("[data-join-ready=true]").waitFor();
  await page.getByLabel("Tu nombre y apellido").fill(`Persistencia ${Date.now()}`);
  await page.getByRole("button", { name: "Entrar a la sala" }).click();
  await expect(page.getByText(new RegExp(`Sala de espera · ${run.code}`))).toBeVisible();
  const started = await page.request.post(`/api/runs/${run.id}/control`, { data: { action: "start" } });
  expect(started.ok()).toBe(true);
  await page.reload();
  await page.locator("[data-student-ready=true]").waitFor();
  const targetName = "Respuesta 1.1";
  const saved = page.waitForResponse((response) =>
    response.url().endsWith("/api/student/answer") && response.request().method() === "POST",
  );
  await page.getByRole("radio", { name: targetName }).click();
  expect((await saved).ok()).toBe(true);
  await expect(page.getByText("Guardado", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("radio", { name: targetName })).toBeChecked();
});

test("teacher monitoring is backed by the persisted demo run", async ({ page }) => {
  const response = await page.goto("/sesiones/run-biology-demo");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Fotosíntesis y respiración celular" })).toBeVisible();
  await expect(page.getByText("K7M4QH", { exact: true })).toBeVisible();
});

test("teacher drafts persist and reopen from their canonical URL", async ({ page, isMobile }) => {
  test.skip(Boolean(isMobile), "Persistence flow is covered once on desktop");
  const title = `Evaluación persistente ${Date.now()}`;
  await createExamFromSetup(page, title);
  await page.getByRole("textbox", { name: "Enunciado" }).fill("¿Qué propiedad demuestra este guardado?");
  await expect(page.getByText("Cambios sin guardar", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Guardar ahora" }).click();
  await expect(page).toHaveURL(/\/evaluaciones\/[0-9a-f-]+$/i, { timeout: 10_000 });
  await expect(page.getByText("Guardado", { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await page.getByRole("button", { name: "Configuración" }).click();
  await expect(page.getByLabel("Título")).toHaveValue(title);
  await expect(page.getByLabel("Materia")).toHaveValue("Ciencias");
  await page.getByRole("button", { name: "Listo" }).click();
  await expect(page.getByRole("textbox", { name: "Enunciado" })).toHaveValue("¿Qué propiedad demuestra este guardado?");
});

test("a ready exam creates a real lobby backed by the Durable Object", async ({ page, isMobile }) => {
  test.skip(Boolean(isMobile), "Run creation is covered once on desktop");
  await page.goto("/evaluaciones");
  await page.locator("[data-library-ready=true]").waitFor();
  const card = page.locator("article").filter({ hasText: "Fotosíntesis y respiración celular" }).first();
  const take = card.getByRole("button", { name: "Abrir sala" });
  await expect(take).toBeEnabled();
  const creation = page.waitForResponse((response) => response.url().endsWith("/api/runs") && response.request().method() === "POST");
  await take.click();
  expect((await creation).status()).toBe(201);
  await expect(page).toHaveURL(/\/sesiones\/[0-9a-f-]+$/i, { timeout: 10_000 });
  await expect(page.getByText("Sala de espera", { exact: true })).toBeVisible();
  await expect(page.locator("[aria-label^='Código ']")).toHaveText(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
});

test("preparing an exam opens its waiting room without going back to the library", async ({ page, isMobile }) => {
  test.skip(Boolean(isMobile), "Preparation flow is covered once on desktop");
  const title = `Preparación directa ${Date.now()}`;
  const creation = await page.request.post("/api/exams", { data: examPayload(title, "draft") });
  expect(creation.status()).toBe(201);
  const exam = await creation.json() as { id: string };

  await page.goto(`/evaluaciones/${exam.id}`);
  await page.locator("[data-editor-ready=true]").waitFor();
  await page.getByRole("button", { name: "Preparar para el curso" }).click();
  await expect(page).toHaveURL(/\/sesiones\/[0-9a-f-]+$/i, { timeout: 10_000 });
  await expect(page.getByText("Sala de espera", { exact: true })).toBeVisible();
});

test("deleting an exam keeps its prior session history", async ({ page, isMobile }) => {
  test.skip(Boolean(isMobile), "Deletion regression is covered once on desktop");
  const title = `Evaluación para borrar ${Date.now()}`;
  const creation = await page.request.post("/api/exams", { data: examPayload(title) });
  expect(creation.status()).toBe(201);
  const exam = await creation.json() as { id: string };
  const runCreation = await page.request.post("/api/runs", { data: { examId: exam.id } });
  expect(runCreation.status()).toBe(201);
  const run = await runCreation.json() as { id: string };

  await page.goto("/evaluaciones");
  const card = page.locator("article").filter({ hasText: title });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: `Borrar ${title}` }).click();
  await card.getByRole("button", { name: `Borrar ${title}` }).click();
  await expect(card).toHaveCount(0);

  await page.goto(`/sesiones/${run.id}`);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
});

test("question and answer order is personalized for each student", async ({ page, browser, isMobile }) => {
  test.skip(Boolean(isMobile), "Shuffle behavior is covered once on desktop");
  const title = `Orden mezclado ${Date.now()}`;
  const examCreation = await page.request.post("/api/exams", { data: examPayload(title, "ready", 5) });
  expect(examCreation.status()).toBe(201);
  const exam = await examCreation.json() as { id: string };
  const runCreation = await page.request.post("/api/runs", { data: { examId: exam.id } });
  expect(runCreation.status()).toBe(201);
  const run = await runCreation.json() as { id: string; code: string };

  const contexts = await Promise.all([
    browser.newContext({ baseURL: "http://127.0.0.1:4321" }),
    browser.newContext({ baseURL: "http://127.0.0.1:4321" }),
  ]);
  try {
    const students = await Promise.all(contexts.map((context) => context.newPage()));
    for (const [index, student] of students.entries()) {
      await student.goto("/rendir");
      await student.locator("[data-join-ready=true]").waitFor();
      await student.getByLabel("Código de la evaluación").fill(run.code);
      await student.getByRole("button", { name: "Continuar" }).click();
      await expect(student.getByRole("heading", { name: "¿Cómo te llamás?" })).toBeVisible();
      await student.locator("[data-join-ready=true]").waitFor();
      await student.getByLabel("Tu nombre y apellido").fill(`Alumno mezcla ${index + 1}`);
      await student.getByRole("button", { name: "Entrar a la sala" }).click();
      await expect(student.getByText(new RegExp(`Sala de espera · ${run.code}`))).toBeVisible();
    }

    const started = await page.request.post(`/api/runs/${run.id}/control`, { data: { action: "start" } });
    expect(started.ok()).toBe(true);
    await Promise.all(students.map((student) => student.reload()));
    await Promise.all(students.map((student) => student.locator("[data-student-ready=true]").waitFor({ timeout: 10_000 })));

    async function visibleOrder(student: Page) {
      const order: string[] = [];
      for (let index = 0; index < 5; index += 1) {
        const prompt = await student.locator("#student-question").innerText();
        const options = await student.getByRole("radio").evaluateAll((radios) => radios.map((radio) => radio.getAttribute("aria-label") ?? ""));
        order.push(`${prompt}|${options.join("|")}`);
        if (index < 4) await student.getByRole("button", { name: "Siguiente" }).click();
      }
      return order;
    }

    const [firstOrder, secondOrder] = await Promise.all(students.map(visibleOrder));
    expect(new Set(firstOrder).size).toBe(5);
    expect(new Set(secondOrder).size).toBe(5);
    expect(secondOrder).not.toEqual(firstOrder);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("manual correction persists on the server", async ({ page, isMobile }) => {
  test.skip(Boolean(isMobile), "Correction persistence is covered once on desktop");
  await page.goto("/resultados?run=run-biology-ended");
  await page.locator("[data-correction-ready=true]").waitFor();
  const row = page.locator("article").filter({ hasText: "Tomás Benítez" }).first();
  const input = row.getByLabel(/Puntaje sobre 4/);
  const next = (await input.inputValue()) === "3" ? "2" : "3";
  await input.fill(next);
  await expect(input).toHaveValue(next);
  await row.getByRole("button", { name: "Guardar" }).click();
  await expect(row.getByRole("button", { name: "Guardado" })).toBeVisible();
  await page.reload();
  await expect(page.locator("article").filter({ hasText: "Tomás Benítez" }).first().getByLabel(/Puntaje sobre 4/)).toHaveValue(next);
});

test("an incident reaches teacher state in under one second", async ({ page, isMobile }) => {
  test.skip(Boolean(isMobile), "Realtime latency is covered once on desktop");
  const examCreation = await page.request.post("/api/exams", { data: examPayload(`Incidentes ${Date.now()}`) });
  const exam = await examCreation.json() as { id: string };
  const runCreation = await page.request.post("/api/runs", { data: { examId: exam.id } });
  const run = await runCreation.json() as { id: string; code: string };
  const studentName = `Incidente ${Date.now()}`;
  await page.goto(`/rendir/${run.code}`);
  await page.getByLabel("Tu nombre y apellido").fill(studentName);
  await page.getByRole("button", { name: "Entrar a la sala" }).click();
  await expect(page.getByText(new RegExp(`Sala de espera · ${run.code}`))).toBeVisible();
  await page.request.post(`/api/runs/${run.id}/control`, { data: { action: "start" } });
  await page.locator("[data-student-ready=true]").waitFor();
  const stateResponse = await page.request.get(`/api/runs/${run.id}/state`);
  const state = await stateResponse.json() as { participants: Array<{ id: string; name: string }> };
  const participant = state.participants.find((candidate) => candidate.name === studentName);
  expect(participant).toBeTruthy();
  await page.request.post("/api/student/incident", {
    data: { participantId: participant!.id, type: "atajo-f12", at: Date.now(), durationMs: 0, meta: { warmup: true } },
  });
  const started = Date.now();
  const incident = await page.request.post("/api/student/incident", {
    data: { participantId: participant!.id, type: "atajo-f12", at: Date.now(), durationMs: 0, meta: {} },
  });
  expect(incident.status()).toBe(202);
  const refreshed = await page.request.get(`/api/runs/${run.id}/state`);
  const body = await refreshed.json() as { incidents: Array<{ type: string }> };
  expect(body.incidents.some((item) => item.type === "atajo-f12")).toBe(true);
  expect(Date.now() - started).toBeLessThan(1_000);
});

test("an anonymous student joins from another browser, waits, and submits", async ({ page, browser, isMobile }) => {
  test.skip(Boolean(isMobile), "Keyboard flow is covered once on desktop");
  const creation = await page.request.post("/api/runs", { data: { examId: "exam-biology-demo" } });
  expect(creation.status()).toBe(201);
  const run = await creation.json() as { id: string; code: string };

  const studentContext = await browser.newContext({ baseURL: "http://127.0.0.1:4321" });
  const student = await studentContext.newPage();
  try {
    await student.goto("/rendir");
    await student.locator("[data-join-ready=true]").waitFor();
    await student.getByLabel("Código de la evaluación").fill(run.code);
    await student.getByRole("button", { name: "Continuar" }).click();
    await expect(student.getByRole("heading", { name: "¿Cómo te llamás?" })).toBeVisible();
    await student.locator("[data-join-ready=true]").waitFor();
    await student.getByLabel("Tu nombre y apellido").fill("Valentina Gerstner");
    await student.getByRole("button", { name: "Entrar a la sala" }).click();
    await expect(student.getByText(new RegExp(`Sala de espera · ${run.code}`))).toBeVisible();

    await page.goto(`/sesiones/${run.id}`);
    await expect(page.getByRole("rowheader", { name: "Valentina Gerstner" })).toBeVisible({ timeout: 10_000 });
    const started = await page.request.post(`/api/runs/${run.id}/control`, { data: { action: "start" } });
    expect(started.ok()).toBe(true);
    await student.locator("[data-student-ready=true]").waitFor({ timeout: 10_000 });

    await student.getByRole("radio", { name: "Fotosíntesis" }).press("Space");
    await expect(student.getByRole("radio", { name: "Fotosíntesis" })).toBeChecked();
    await student.getByRole("button", { name: /Pregunta 2/ }).press("Enter");
    await student.getByLabel("Tu respuesta").pressSequentially("clorofila");
    await student.getByRole("button", { name: /Pregunta 3/ }).press("Enter");
    await student.getByLabel("Tu desarrollo").pressSequentially("Produce alimento y oxígeno.");
    await student.getByRole("button", { name: "Revisar" }).click();
    await student.getByRole("button", { name: "Entregar evaluación" }).press("Enter");
    await student.getByRole("button", { name: "Entregar", exact: true }).press("Enter");
    await expect(student.getByRole("heading", { name: "Entrega recibida" })).toBeVisible({ timeout: 10_000 });
  } finally {
    await studentContext.close();
  }
});
