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
    // La supervision estricta quedo activada por defecto, y un navegador sin
    // gesto del usuario no puede entrar en pantalla completa: sin esto la
    // evaluacion se queda en el cartel "Entra en pantalla completa". Las tomas
    // que si prueban ese camino lo piden explicitamente.
    requireFullscreen: false,
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
  await page.locator("[data-join-ready=true]").waitFor();
  if (await page.getByRole("heading", { name: "¿Cómo te llamás?" }).isVisible()) {
    await page.getByLabel("Tu nombre y apellido").fill(name);
    await page.getByRole("button", { name: "Entrar a la sala" }).click();
  }
  await page.locator("[data-student-ready=true]").waitFor();
  return name;
}

async function createExamFromSetup(page: Page, title: string, subject = "Ciencias") {
  await page.goto("/evaluaciones/nueva");
  await page.locator("[data-setup-ready=true]").waitFor();
  await page.getByLabel("Título").fill(title);
  await page.getByLabel("Materia").fill(subject);
  await page.getByRole("button", { name: "Crear y agregar preguntas" }).click();
  await page.locator("[data-editor-ready=true]").waitFor();
}

test("a new teacher can create an account without institutional approval", async ({ page }) => {
  const email = `cuenta-${Date.now()}-${Math.random().toString(36).slice(2)}@gmail.com`;
  await page.goto("/login");
  await page.locator("[data-auth-ready=true]").waitFor();
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await page.getByLabel("Nombre y apellido").fill("Cuenta de prueba");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill("Testra-Prueba-2026");
  await page.getByRole("button", { name: "Crear mi cuenta" }).click();
  await expect(page).toHaveURL(/\/evaluaciones(?:\?|$)/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Evaluaciones", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Cuenta de prueba.*Docente/ })).toBeVisible();
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

test("student answers survive a full reload through autosave", async ({ page }) => {
  const title = `Persistencia de respuesta ${Date.now()}`;
  const examCreation = await page.request.post("/api/exams", { data: examPayload(title) });
  expect(examCreation.status()).toBe(201);
  const exam = await examCreation.json() as { id: string };
  const runCreation = await page.request.post("/api/runs", { data: { examId: exam.id } });
  expect(runCreation.status()).toBe(201);
  const run = await runCreation.json() as { id: string; code: string };
  await page.goto(`/rendir/${run.code}`);
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

test("a ready exam creates a real lobby backed by the run actor", async ({ page, isMobile }) => {
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
  await page.locator("[data-library-ready=true]").waitFor();
  const card = page.locator("article").filter({ hasText: title });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: `Borrar ${title}` }).click();
  await expect(card.getByText("Confirmar borrado")).toBeVisible();
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
      await student.goto(`/rendir/${run.code}`);
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
  await page.goto("/resultados?run=run-biology-ended&tab=correcciones");
  await page.locator("[data-correction-ready=true]").waitFor();
  // La bandeja arranca filtrada por pendientes y esta prueba deja la respuesta
  // corregida: sin abrir el filtro, la segunda corrida no encontraría la fila.
  await page.getByLabel("Estado").selectOption("all");
  const row = page.locator("article").filter({ hasText: "Tomás Benítez" }).first();
  const input = row.getByLabel(/Puntaje sobre 4/);
  const next = (await input.inputValue()) === "3" ? "2" : "3";
  await input.fill(next);
  await expect(input).toHaveValue(next);
  const outgoing = page.waitForRequest((request) => request.url().endsWith("/api/corrections/grade") && request.method() === "POST");
  const saved = page.waitForResponse((response) => response.url().endsWith("/api/corrections/grade") && response.request().method() === "POST");
  await row.getByRole("button", { name: "Guardar acá", exact: true }).click();
  expect((await outgoing).postDataJSON().pointsAwarded).toBe(Number(next));
  expect((await saved).ok()).toBe(true);
  await page.reload();
  await page.locator("[data-correction-ready=true]").waitFor();
  await page.getByLabel("Estado").selectOption("graded");
  await expect(page.locator("article").filter({ hasText: "Tomás Benítez" }).first().getByLabel(/Puntaje sobre 4/)).toHaveValue(next);
});

test("a run opens on notas and switches to correcciones and análisis", async ({ page }) => {
  await page.goto("/resultados?run=run-biology-ended");
  await page.locator("[data-results-ready=true]").waitFor();
  const tabs = page.getByRole("tablist", { name: "Vistas de la toma" });
  await expect(tabs.getByRole("tab", { name: /Notas/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: /Notas/ })).toBeVisible();
  await tabs.getByRole("tab", { name: /Correcciones/ }).click();
  await expect(page.getByRole("tabpanel", { name: /Correcciones/ })).toBeVisible();
  await expect(page).toHaveURL(/tab=correcciones/);
  await tabs.getByRole("tab", { name: /Análisis/ }).click();
  await expect(page.getByRole("tabpanel", { name: /Análisis/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Analítica" })).toBeVisible();
  await expect(page).toHaveURL(/tab=analisis/);
  // La pestaña sobrevive a la recarga porque viaja en la URL.
  await page.reload();
  await page.locator("[data-results-ready=true]").waitFor();
  await expect(tabs.getByRole("tab", { name: /Análisis/ })).toHaveAttribute("aria-selected", "true");
});

test("an incident reaches teacher state in under one second", async ({ page, isMobile }) => {
  test.skip(Boolean(isMobile), "Realtime latency is covered once on desktop");
  const examCreation = await page.request.post("/api/exams", { data: examPayload(`Incidentes ${Date.now()}`) });
  const exam = await examCreation.json() as { id: string };
  const runCreation = await page.request.post("/api/runs", { data: { examId: exam.id } });
  const run = await runCreation.json() as { id: string; code: string };
  const studentName = `Incidente ${Date.now()}`;
  await page.goto(`/rendir/${run.code}`);
  await page.locator("[data-join-ready=true]").waitFor();
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
    await student.goto(`/rendir/${run.code}`);
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

test("an asynchronous attempt starts its own server timer and survives reload", async ({ page, isMobile }) => {
  test.skip(Boolean(isMobile), "The async contract is covered once on desktop");
  const title = `Asincrónica ${Date.now()}`;
  const payload = {
    ...examPayload(title),
    deliveryMode: "async",
    availableFrom: new Date(Date.now() - 60_000).toISOString(),
    availableUntil: new Date(Date.now() + 10 * 60_000).toISOString(),
  };
  const examCreation = await page.request.post("/api/exams", { data: payload });
  expect(examCreation.status()).toBe(201);
  const exam = await examCreation.json() as { id: string };
  const runCreation = await page.request.post("/api/runs", { data: { examId: exam.id } });
  expect(runCreation.status()).toBe(201);
  const run = await runCreation.json() as { code: string };
  await page.goto(`/rendir/${run.code}`);
  await page.locator("[data-join-ready=true]").waitFor();
  await page.getByLabel("Tu nombre y apellido").fill(`Alumno asincrónico ${Date.now()}`);
  await page.getByRole("button", { name: "Entrar a la sala" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByRole("button", { name: "Iniciar intento" })).toBeVisible();
  await page.getByRole("button", { name: "Iniciar intento" }).click();
  await page.getByRole("button", { name: "Sí, empezar" }).click();
  await page.locator("[data-student-ready=true]").waitFor();
  await expect(page.getByRole("timer")).toContainText(/29:5\d/);
  await page.getByRole("radio", { name: "Respuesta 1.1" }).click();
  await expect(page.getByText("Guardado", { exact: true })).toBeVisible();
  await page.reload();
  await page.locator("[data-student-ready=true]").waitFor();
  await expect(page.getByRole("radio", { name: "Respuesta 1.1" })).toBeChecked();
  await expect(page.getByRole("button", { name: "Iniciar intento" })).toHaveCount(0);
});

test("corrections is a real work inbox instead of a redirect", async ({ page, isMobile }) => {
  test.skip(Boolean(isMobile), "The correction workspace is covered once on desktop");
  await page.goto("/correcciones");
  await page.locator("[data-correction-ready=true]").waitFor();
  await expect(page).toHaveURL(/\/correcciones$/);
  await expect(page.getByRole("heading", { name: "Correcciones pendientes" })).toBeVisible();
  await page.getByLabel("Estado").selectOption("all");
  await expect(page.getByText("Tomás Benítez", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Guardar y siguiente" })).toBeVisible();
});

test("correcting takes over the whole screen and Escape gives it back", async ({ page, isMobile }) => {
  test.skip(Boolean(isMobile), "Fullscreen correcting is covered once on desktop");
  await page.goto("/correcciones");
  await page.locator("[data-correction-ready=true]").waitFor();
  await page.getByRole("button", { name: "Pantalla completa" }).click();
  await expect(page.locator("[data-correction-expanded=true]")).toBeVisible();
  await expect(page.getByRole("button", { name: "Salir", exact: true })).toBeVisible();
  // La bandeja se posiciona contra el viewport, no contra el contenedor de la página.
  const box = await page.locator("[data-correction-expanded=true]").boundingBox();
  expect(box?.y).toBeLessThanOrEqual(1);
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-correction-expanded=true]")).toHaveCount(0);
});

test("teacher preview renders math, regenerates locally and never creates participants", async ({ page, isMobile }) => {
  test.skip(Boolean(isMobile), "Preview isolation is covered once on desktop");
  const payload = examPayload(`Vista previa ${Date.now()}`);
  payload.questions[0].prompt = "Calculá $x^2$ y explicá ```js\nconst x = 2\n```";
  const creation = await page.request.post("/api/exams", { data: payload });
  const exam = await creation.json() as { id: string };
  const runCreation = await page.request.post("/api/runs", { data: { examId: exam.id } });
  const run = await runCreation.json() as { id: string };
  const before = await (await page.request.get(`/api/runs/${run.id}/state`)).json() as { participants: unknown[] };
  expect(before.participants).toHaveLength(0);
  await page.goto(`/evaluaciones/${exam.id}/vista-previa`);
  await page.locator("[data-preview-ready]").waitFor();
  await expect(page.locator(".katex")).toBeVisible();
  await expect(page.locator("[data-preview-ready] pre code")).toContainText("const x = 2");
  await page.getByRole("button", { name: "Regenerar variante" }).click();
  const after = await (await page.request.get(`/api/runs/${run.id}/state`)).json() as { participants: unknown[] };
  expect(after.participants).toHaveLength(0);
});

test("individual time and reopening preserve one participant and existing answers", async ({ page, isMobile }) => {
  test.skip(Boolean(isMobile), "Individual deadline flow is covered once on desktop");
  const payload = examPayload(`Reapertura ${Date.now()}`);
  const creation = await page.request.post("/api/exams", { data: payload });
  const exam = await creation.json() as { id: string };
  const runCreation = await page.request.post("/api/runs", { data: { examId: exam.id } });
  const run = await runCreation.json() as { id: string; code: string };
  await page.goto(`/rendir/${run.code}`);
  await page.locator("[data-join-ready=true]").waitFor();
  await page.getByLabel("Tu nombre y apellido").fill("Alumno con tiempo extra");
  await page.getByRole("button", { name: "Entrar a la sala" }).click();
  await expect(page.getByText(new RegExp(`Sala de espera · ${run.code}`))).toBeVisible();
  const initial = await (await page.request.get(`/api/runs/${run.id}/state`)).json() as { participants: Array<{ id: string }> };
  const participantId = initial.participants[0].id;
  expect((await page.request.post(`/api/runs/${run.id}/control`, { data: { action: "participant-time", participantId, extraTimeS: 600 } })).ok()).toBe(true);
  expect((await page.request.post(`/api/runs/${run.id}/control`, { data: { action: "start" } })).ok()).toBe(true);
  const running = await (await page.request.get(`/api/runs/${run.id}/state`)).json() as { run: { ends_at: number }; participants: Array<{ id: string; deadline_at: number; extra_time_s: number }> };
  expect(running.participants[0].deadline_at - running.run.ends_at).toBe(600_000);
  expect((await page.request.post("/api/student/answer", { data: { participantId, questionId: payload.questions[0].id, value: payload.questions[0].config.correctOptionId } })).ok()).toBe(true);
  expect((await page.request.post("/api/student/submit", { data: { participantId, reason: "manual" } })).ok()).toBe(true);
  expect((await page.request.post(`/api/runs/${run.id}/control`, { data: { action: "reopen", participantId, extraTimeS: 120 } })).ok()).toBe(true);
  const reopened = await (await page.request.get(`/api/runs/${run.id}/state`)).json() as { participants: Array<{ id: string; status: string; extra_time_s: number; reopened_count: number }>; events: Array<{ type: string }> };
  expect(reopened.participants).toHaveLength(1);
  expect(reopened.participants[0]).toMatchObject({ id: participantId, status: "active", extra_time_s: 720, reopened_count: 1 });
  expect(reopened.events.some((event) => event.type === "submission-reopened")).toBe(true);
  expect((await page.request.post("/api/student/answer", { data: { participantId, questionId: payload.questions[0].id, value: payload.questions[0].config.correctOptionId } })).ok()).toBe(true);
});

test("question image upload is validated and served as optimized WebP", async ({ page, isMobile }) => {
  test.skip(Boolean(isMobile), "Upload flow is covered once on desktop");
  const creation = await page.request.post("/api/exams", { data: examPayload(`Imagen ${Date.now()}`) });
  const exam = await creation.json() as { id: string };
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const upload = await page.request.post("/api/question-assets", { headers: { origin: "http://127.0.0.1:4321" }, multipart: { examId: exam.id, file: { name: "pixel.png", mimeType: "image/png", buffer: png } } });
  expect(upload.status()).toBe(201);
  const asset = await upload.json() as { id: string; mimeType: string; width: number; height: number };
  expect(asset).toMatchObject({ mimeType: "image/webp", width: 1, height: 1 });
  const image = await page.request.get(`/api/question-assets/${asset.id}`);
  expect(image.headers()["content-type"]).toBe("image/webp");
  expect(image.headers()["x-content-type-options"]).toBe("nosniff");
});

test("historical analytics expose current and aggregate metrics without an invented threshold", async ({ page, isMobile }) => {
  test.skip(Boolean(isMobile), "Analytics contract is covered once on desktop");
  const response = await page.request.get("/api/runs/run-biology-ended/analytics");
  expect(response.ok()).toBe(true);
  const body = await response.json() as { current: { analytics: { summary: { participants: number; passPercentage: number | null }; questions: unknown[] } }; aggregate: unknown; perRun: unknown[] };
  expect(body.current.analytics.summary.participants).toBeGreaterThan(0);
  expect(body.current.analytics.summary.passPercentage).toBeNull();
  expect(body.current.analytics.questions.length).toBeGreaterThan(0);
  expect(body.perRun.length).toBeGreaterThan(1);
});

/**
 * Dos cosas que estaban rotas para todos, y que en Mac se notaban mas porque
 * alla el gesto habitual es cambiar de aplicacion:
 *
 * 1. El alumno que esperaba en la sala cuando el docente abrio la toma se
 *    quedaba SIN supervision hasta recargar la pagina.
 * 2. Moverse entre los controles de la evaluacion inventaba avisos de 0
 *    segundos, y de paso pisaba la ausencia real.
 *
 * El test tambien reproduce la firma de eventos de macOS: al hacer Cmd+Tab o
 * cambiar de escritorio la ventana pierde el foco y NO llega ninguna senal de
 * visibilidad, que es lo que Windows si manda. No corre sobre macOS —no hay una
 * Mac en el entorno—, asi que verifica que la cadena entera (oyentes, maquina
 * de estados, POST, actor y base) haga lo correcto cuando el navegador entrega
 * exactamente esos eventos y nada mas.
 */
test("la supervision se enciende sin recargar y registra la salida de ventana con su duracion", async ({ page, isMobile }) => {
  test.skip(Boolean(isMobile), "El gesto de cambiar de aplicacion no existe en un telefono");
  const examCreation = await page.request.post("/api/exams", { data: examPayload(`Foco macOS ${Date.now()}`) });
  const exam = await examCreation.json() as { id: string };
  const runCreation = await page.request.post("/api/runs", { data: { examId: exam.id } });
  const run = await runCreation.json() as { id: string; code: string };
  const studentName = `Foco ${Date.now()}`;
  await page.goto(`/rendir/${run.code}`);
  await page.locator("[data-join-ready=true]").waitFor();
  await page.getByLabel("Tu nombre y apellido").fill(studentName);
  await page.getByRole("button", { name: "Entrar a la sala" }).click();
  await expect(page.getByText(new RegExp(`Sala de espera · ${run.code}`))).toBeVisible();

  // El alumno ya estaba esperando cuando arranca la toma: el caso que quedaba
  // sin supervisar.
  await page.request.post(`/api/runs/${run.id}/control`, { data: { action: "start" } });
  await page.locator("[data-student-ready=true]").waitFor();
  await expect(page.locator("[data-monitoring-active=true]")).toBeAttached();

  const salidas = async () => {
    const response = await page.request.get(`/api/runs/${run.id}/state`);
    const body = await response.json() as { incidents: Array<{ type: string; duration_ms: number }> };
    return body.incidents.filter((item) => item.type === "ventana-sin-foco" || item.type === "cambio-de-pestana");
  };

  // Responder mueve el foco entre controles. Eso no es una ausencia.
  await page.evaluate(() => {
    const campo = document.querySelector("main input, main textarea, main button");
    if (!campo) throw new Error("la evaluacion no tiene ningun control");
    campo.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
    campo.dispatchEvent(new FocusEvent("focus", { bubbles: false }));
  });
  await page.waitForTimeout(600);
  expect(await salidas()).toEqual([]);

  // Cmd+Tab: solo `blur` de ventana, sin `visibilitychange`.
  await page.evaluate(() => window.dispatchEvent(new FocusEvent("blur", { bubbles: false })));
  await page.waitForTimeout(1_500);
  await page.evaluate(() => window.dispatchEvent(new FocusEvent("focus", { bubbles: false })));

  await expect.poll(async () => (await salidas()).length, { timeout: 10_000 }).toBe(1);
  const [registrado] = await salidas();
  expect(registrado.type).toBe("ventana-sin-foco");
  // La duracion tiene que ser la real, no el 0 que se veia en Windows.
  expect(registrado.duration_ms).toBeGreaterThanOrEqual(1_000);
});

/**
 * Ajustes de lectura, para chicos con adecuaciones.
 *
 * "Bulletproof" acá tiene un significado concreto y medible: el criterio 1.4.12
 * de WCAG 2.2 no pide que el contenido USE cierto espaciado, pide que SOBREVIVA
 * a él sin perder contenido ni funcionalidad. Eso es exactamente lo que se
 * verifica: con todo al máximo la evaluación se sigue leyendo, se sigue
 * respondiendo y se sigue guardando.
 *
 * Los dos casos que rompen si nadie los cuida son la matemática y el código: a
 * KaTeX se le parten las fórmulas si se le separan los glifos, y el
 * monoespaciado deja de estar en columna.
 */
test("la evaluacion sobrevive al espaciado maximo y sigue respondiendose", async ({ page, isMobile }) => {
  const stamp = Date.now();
  const payload = examPayload(`Lectura ${stamp}`);
  payload.questions = [
    {
      ...payload.questions[0],
      prompt: "Con $ax^2+bx+c=0$, y este fragmento:\n```python\ndef d(a, b, c):\n    return b**2 - 4*a*c\n```\n¿Como se llama $b^2-4ac$?",
    },
  ] as typeof payload.questions;
  const examCreation = await page.request.post("/api/exams", { data: payload });
  const exam = await examCreation.json() as { id: string };
  const runCreation = await page.request.post("/api/runs", { data: { examId: exam.id } });
  const run = await runCreation.json() as { id: string; code: string };

  await page.goto(`/rendir/${run.code}`);
  await page.locator("[data-join-ready=true]").waitFor();
  await page.getByLabel("Tu nombre y apellido").fill(`Lectura ${stamp}`);
  await page.getByRole("button", { name: "Entrar a la sala" }).click();
  await expect(page.getByText(new RegExp(`Sala de espera · ${run.code}`))).toBeVisible();
  await page.request.post(`/api/runs/${run.id}/control`, { data: { action: "start" } });
  await page.locator("[data-student-ready=true]").waitFor();

  // Arranca sin cambiar nada: quien no lo necesita no ve ninguna diferencia.
  const zona = page.locator("#contenido");
  expect(await zona.evaluate((el) => getComputedStyle(el).letterSpacing)).toBe("normal");

  await page.locator("[data-reading-toggle]").click();
  const panel = page.locator("[data-reading-panel]");
  await expect(panel).toBeVisible();

  // El maximo de cada escala, todos a la vez, que es el caso peor.
  // Se hace clic en la etiqueta, que es lo que toca una persona: el radio en si
  // esta visualmente oculto a proposito —queda accesible por teclado y para el
  // lector de pantalla, y el recuadro que se ve es la etiqueta—.
  for (const grupo of await panel.locator("fieldset").all()) {
    const opciones = grupo.locator("label");
    await opciones.nth(await opciones.count() - 1).click();
    await expect(grupo.locator("input[type=radio]").last()).toBeChecked();
  }

  const medidas = await zona.evaluate((el) => {
    const cs = getComputedStyle(el);
    const pre = el.querySelector("pre");
    const katex = el.querySelector(".katex");
    return {
      escala: Number(cs.getPropertyValue("--lectura-escala")),
      interlineado: Number(cs.getPropertyValue("--lectura-interlineado")),
      letras: cs.letterSpacing,
      preLetras: pre ? getComputedStyle(pre).letterSpacing : null,
      katexLetras: katex ? getComputedStyle(katex).letterSpacing : null,
      preDesborda: pre ? pre.scrollWidth > pre.clientWidth + 1 : false,
    };
  });

  expect(medidas.escala).toBeGreaterThan(1);
  // Piso del criterio 1.4.12 de WCAG 2.2.
  expect(medidas.interlineado).toBeGreaterThanOrEqual(1.5);
  expect(medidas.letras).not.toBe("normal");
  // Formulas y codigo quedan afuera del espaciado, o se rompen.
  expect(medidas.preLetras).toBe("normal");
  expect(medidas.katexLetras).toBe("normal");
  expect(medidas.preDesborda).toBe(false);

  // Nada se sale de la pantalla: scrollear en horizontal para leer una
  // pregunta es justamente perder funcionalidad.
  const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(desborde).toBeLessThanOrEqual(1);

  // Se sigue pudiendo responder, y la respuesta llega al servidor.
  // Las opciones son botones con rol de radio, no inputs nativos.
  await page.locator("#contenido").getByRole("radio").first().click();
  await expect(page.getByText("Guardado", { exact: true })).toBeVisible();

  // Con el texto agrandado, el campo donde se escribe tiene que acompañar.
  const campos = page.locator("#contenido textarea, #contenido input[type=text]");
  if (await campos.count()) {
    const proporcion = await campos.first().evaluate((el) => {
      const zona = el.closest("#contenido") as HTMLElement;
      return parseFloat(getComputedStyle(el).fontSize) / parseFloat(getComputedStyle(zona).fontSize);
    });
    expect(proporcion).toBeGreaterThanOrEqual(0.95);
  }

  // Usar el panel no puede parecerse a hacer trampa: cero avisos.
  const estado = await page.request.get(`/api/runs/${run.id}/state`);
  const cuerpo = await estado.json() as { incidents: Array<{ type: string }> };
  expect(cuerpo.incidents).toEqual([]);

  // Y sigue siendo accesible con todo puesto.
  if (!isMobile) {
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
    expect(axe.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? ""))).toEqual([]);
  }

  // La preferencia sobrevive a recargar: nadie tiene que reconfigurar a mitad.
  await page.reload();
  await page.locator("[data-student-ready=true]").waitFor();
  expect(await zona.evaluate((el) => getComputedStyle(el).letterSpacing)).not.toBe("normal");
});

/**
 * Exámenes paralelos para chicos con adecuaciones.
 *
 * Lo que se prueba no es sólo que funcione, sino que funcione SIN exponer al
 * alumno: entra con el mismo código que el resto, en la misma sala, y su
 * pantalla no dice en ningún lado que está rindiendo otra cosa. Que la versión
 * sea distinta lo sabe el docente y nadie más.
 */
test("una version adaptada se asigna por alumno dentro de la misma sala", async ({ page, browser, isMobile }) => {
  test.skip(Boolean(isMobile), "La asignación se hace desde el monitor, que es de escritorio");
  // Levanta dos alumnos en contextos separados: necesitan sesiones distintas.
  test.setTimeout(90_000);
  const stamp = Date.now();
  const preguntas = (cantidad: number, etiqueta: string) => Array.from({ length: cantidad }, (_, index) => ({
    id: `q-${etiqueta}-${stamp}-${index}`,
    position: index,
    type: "mc" as const,
    points: 1,
    prompt: `${etiqueta} pregunta ${index + 1}`,
    config: {
      options: [{ id: "a", text: `${etiqueta} opcion A` }, { id: "b", text: `${etiqueta} opcion B` }],
      correctOptionId: "a",
    },
  }));

  const base = { ...examPayload(`Original ${stamp}`), shuffleQuestions: false, shuffleOptions: false };
  const original = await (await page.request.post("/api/exams", {
    data: { ...base, questions: preguntas(4, "ALFA") },
  })).json() as { id: string };

  // La versión adaptada nace atada a la original, y se acorta a la mitad.
  const adaptada = await (await page.request.post(`/api/exams/${original.id}/duplicate`, { data: { adapted: true } })).json() as { id: string; title: string };
  expect(adaptada.title).toContain("adaptada");
  await page.request.patch(`/api/exams/${adaptada.id}`, {
    data: { ...base, id: adaptada.id, title: adaptada.title, status: "ready", questions: preguntas(2, "BETA"), updatedAt: new Date().toISOString() },
  });

  const run = await (await page.request.post("/api/runs", { data: { examId: original.id } })).json() as { id: string; code: string };

  const entrar = async (nombre: string) => {
    const contexto = await browser.newContext({ baseURL: "http://127.0.0.1:4321" });
    const hoja = await contexto.newPage();
    await hoja.goto(`/rendir/${run.code}`);
    await hoja.locator("[data-join-ready=true]").waitFor();
    await hoja.getByLabel("Tu nombre y apellido").fill(nombre);
    await hoja.getByRole("button", { name: "Entrar a la sala" }).click();
    await expect(hoja.getByText(new RegExp(`Sala de espera · ${run.code}`))).toBeVisible();
    return hoja;
  };
  const comun = await entrar(`Comun ${stamp}`);
  const adecuacion = await entrar(`Adecuacion ${stamp}`);

  // El docente asigna desde el monitor, con el selector de la fila del alumno.
  await page.goto(`/sesiones/${run.id}`);
  await page.locator("[data-monitor-ready=true]").waitFor();
  const fila = page.getByRole("row", { name: new RegExp(`Adecuacion ${stamp}`) });
  await fila.locator("select").selectOption({ label: adaptada.title });
  await expect(fila.locator("select")).toHaveValue(adaptada.id);


  await page.request.post(`/api/runs/${run.id}/control`, { data: { action: "start" } });

  for (const [hoja, propias, ajenas] of [[comun, "ALFA", "BETA"], [adecuacion, "BETA", "ALFA"]] as const) {
    await hoja.locator("[data-student-ready=true]").waitFor();
    await expect(hoja.locator("#contenido")).toContainText(`${propias} pregunta 1`);
    const html = await hoja.content();
    expect(html).toContain(`${propias} pregunta 1`);
    // No debe filtrarse ni una pregunta de la otra versión.
    expect(html).not.toContain(`${ajenas} pregunta 1`);
    // Ni el título de la versión paralela, que es lo que delataría la adecuación.
    expect(html).not.toContain(adaptada.title);
  }

  // Cada uno responde su propia primera pregunta y entrega.
  for (const hoja of [comun, adecuacion]) {
    await hoja.locator("#contenido").getByRole("radio").first().click();
    await expect(hoja.getByText("Guardado", { exact: true })).toBeVisible();
  }

  // El docente ve las dos versiones conviviendo, con distinta cantidad.
  const estado = await (await page.request.get(`/api/runs/${run.id}/state`)).json() as {
    participants: Array<{ name: string; assigned_questions: number; assigned_exam_id: string | null }>;
  };
  const filaComun = estado.participants.find((p) => p.name.startsWith("Comun"))!;
  const filaAdaptada = estado.participants.find((p) => p.name.startsWith("Adecuacion"))!;
  expect(filaComun.assigned_questions).toBe(4);
  expect(filaComun.assigned_exam_id).toBeNull();
  expect(filaAdaptada.assigned_questions).toBe(2);
  expect(filaAdaptada.assigned_exam_id).toBe(adaptada.id);

  await comun.context().close();
  await adecuacion.context().close();
});
