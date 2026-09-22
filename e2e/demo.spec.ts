import { expect, test, type Page, type Request } from "@playwright/test";

// La demo promete que nada sale del navegador. Una vez cargada, lo único que el
// navegador puede pedirle al sitio son sus propios archivos: los que baja solo
// (íconos, manifiesto, tipografías) y, en desarrollo, los módulos que sirve
// Vite. Una lista blanca y no una negra: lo que no está previsto, falla.
const STATIC_AFTER_LOAD = [
  /^\/_astro\//,
  /^\/_image/,
  /^\/node_modules\//,
  /^\/src\//,
  /^\/@vite\//,
  /^\/@id\//,
  /^\/@fs\//,
  /^\/@react-refresh/,
  /^\/favicon-32\.png$/,
  /^\/icon-192\.png$/,
  /^\/apple-touch-icon\.png$/,
  /^\/site\.webmanifest$/,
];

function isStaticAsset(request: Request, origin: string) {
  const url = new URL(request.url());
  return url.origin === origin && request.method() === "GET" && STATIC_AFTER_LOAD.some((pattern) => pattern.test(url.pathname));
}

/** El canal de recarga de Vite en desarrollo, que no existe en producción. */
function isViteHmr(socketUrl: string, origin: string) {
  const url = new URL(socketUrl);
  return url.host === new URL(origin).host && url.pathname === "/" && url.searchParams.has("token");
}

async function markKey(page: Page, question: number, option: string) {
  await page.getByRole("radiogroup", { name: `Respuesta correcta de la pregunta ${question}` }).getByRole("radio", { name: option }).click();
}

/** Registra todo lo que la página pida o abra desde que queda hidratada. */
async function openDemoWatchingNetwork(page: Page, baseURL: string | undefined) {
  const origin = new URL(baseURL ?? "http://127.0.0.1:4321").origin;
  const outgoing: string[] = [];
  let watching = false;
  page.on("request", (request) => {
    if (watching && !isStaticAsset(request, origin)) outgoing.push(`${request.method()} ${request.url()}`);
  });
  page.on("websocket", (socket) => {
    if (watching && !isViteHmr(socket.url(), origin)) outgoing.push(`websocket ${socket.url()}`);
  });

  await page.goto("/demo");
  await page.waitForLoadState("load");
  await page.locator("[data-demo-ready=true]").waitFor();
  watching = true;

  const welcome = page.getByRole("dialog", { name: "Probá Testra en tres minutos" });
  await expect(welcome).toContainText("nada se envía a Testra");
  await welcome.getByRole("button", { name: "Empezar" }).click();
  await expect(welcome).toBeHidden();
  return outgoing;
}

// En el teléfono la pantalla del docente no está al lado: se abre desde la
// línea de arriba. Este recorrido la prueba; el de escritorio, todo lo demás.
test("en el teléfono lo que ve el docente queda a un toque, arriba de la evaluación", async ({ page, baseURL, isMobile }) => {
  test.skip(!isMobile, "El recorrido de escritorio cubre las dos pantallas lado a lado.");
  const outgoing = await openDemoWatchingNetwork(page, baseURL);

  await page.getByRole("button", { name: "Convertir en preguntas" }).click();
  await markKey(page, 1, "B) Un aviso con cuánto tiempo estuviste afuera");
  await markKey(page, 2, "C) La acción y la cantidad de caracteres");
  await markKey(page, 3, "A) El código de la sala");
  await page.getByRole("button", { name: "Abrir sala" }).last().click();
  await page.getByRole("button", { name: "Entrar a la sala" }).click();

  const ticker = page.getByRole("button", { name: /^Pantalla del docente/ });
  await expect(ticker).toContainText("Sin avisos");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.waitForTimeout(1_100);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const warning = page.getByRole("dialog", { name: "Este evento quedó registrado" });
  await expect(warning).toContainText("Estuviste fuera de la ventana");
  await warning.getByRole("button", { name: "Entendido" }).click();
  await expect(ticker).toContainText("1 aviso");
  await expect(ticker).toContainText("Otra ventana tomó el control");

  await ticker.click();
  const teacher = page.getByRole("dialog", { name: "Pantalla del docente" });
  await expect(teacher.getByText("DEMO01")).toBeVisible();
  await expect(teacher.getByRole("row", { name: /Alumno de prueba/ })).toContainText("Rindiendo");
  await expect(teacher.getByText(/^Otra ventana tomó el control \(1(,\d)? s\)$/)).toBeVisible();
  await teacher.getByRole("button", { name: "Volver a la pantalla del alumno" }).click();
  await expect(teacher).toBeHidden();
  await expect(page.getByRole("region", { name: "Pantalla del alumno" }).getByRole("radio").first()).toBeVisible();

  expect(outgoing).toEqual([]);
});

test("la demo se recorre entera, detecta lo que hace el alumno y no manda nada", async ({ page, baseURL, isMobile }) => {
  test.skip(isMobile, "En el teléfono la pantalla del docente va detrás de un toque; la cubre la prueba de arriba.");
  const outgoing = await openDemoWatchingNetwork(page, baseURL);

  // Armar: las preguntas salen del parser real y la sala no abre sin claves.
  await page.getByRole("button", { name: "Convertir en preguntas" }).click();
  await expect(page.getByText("Falta marcar la clave en 3 preguntas.")).toBeVisible();
  // Dos botones con la misma intención: el de la cabecera y el que queda junto
  // a la validación, que es el que está a la vista después de la última clave.
  const openRoom = page.getByRole("button", { name: "Abrir sala" });
  await expect(openRoom).toHaveCount(2);
  await expect(openRoom.first()).toBeDisabled();
  await expect(openRoom.last()).toBeDisabled();
  await markKey(page, 1, "B) Un aviso con cuánto tiempo estuviste afuera");
  await markKey(page, 2, "C) La acción y la cantidad de caracteres");
  await markKey(page, 3, "A) El código de la sala");
  await expect(page.getByText("Todas las preguntas tienen clave y puntaje.")).toBeVisible();
  await expect(openRoom.first()).toBeEnabled();
  await openRoom.last().click();

  // Rendir. Los avisos del alumno son modales: el resto de la página queda
  // oculto para el lector de pantalla, pero sigue a la vista, y es justamente
  // lo que se quiere mostrar.
  const student = page.getByRole("region", { name: "Pantalla del alumno", includeHidden: true });
  const teacher = page.getByRole("region", { name: "Pantalla del docente", includeHidden: true });
  const challenges = page.getByRole("list", { name: "Qué probar", includeHidden: true });
  const warning = page.getByRole("dialog", { name: "Este evento quedó registrado" });
  await expect(teacher.getByText("Todavía no ingresó ningún alumno.")).toBeVisible();
  await expect(teacher.getByText("DEMO01")).toBeVisible();
  await expect(page.getByLabel("Tu nombre y apellido")).toHaveValue("Alumno de prueba");
  await page.getByRole("button", { name: "Entrar a la sala" }).click();
  await expect(teacher.getByRole("row", { name: /Alumno de prueba/, includeHidden: true })).toContainText("Rindiendo");
  await expect(challenges.getByRole("listitem", { includeHidden: true })).toHaveCount(4);

  await student.getByRole("radio", { name: "Un aviso con cuánto tiempo estuviste afuera" }).click();
  await expect(teacher.getByRole("row", { name: /Alumno de prueba/, includeHidden: true })).toContainText("1/4");

  // La ventana pierde el foco un rato: lo detecta el hook real.
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.waitForTimeout(1_100);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(warning).toContainText("Estuviste fuera de la ventana");
  await expect(teacher.getByText(/^Otra ventana tomó el control \(1(,\d)? s\)$/)).toBeVisible();
  await expect(challenges.getByText("Cambiá de pestaña y volvé, detectado")).toBeAttached();
  await warning.getByRole("button", { name: "Entendido" }).click();
  await expect(warning).toBeHidden();

  // Copiar el enunciado de la pregunta 2.
  await student.getByRole("button", { name: "Siguiente" }).click();
  const promptLength = await page.evaluate(() => {
    const prompt = document.querySelector("[data-demo-prompt]")!;
    const range = document.createRange();
    range.selectNodeContents(prompt);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    // Los tipos lo marcan obsoleto, pero sigue siendo la forma de disparar un
    // copiar real desde la página, con su evento y su selección.
    (document as unknown as { execCommand(command: "copy"): boolean }).execCommand("copy");
    return selection.toString().length;
  });
  await expect(warning).toContainText(`Usaste copiar (${promptLength} caracteres). Testra no guarda el contenido.`);
  await expect(teacher.getByText(`Se usó copiar, cortar o pegar · Copió ${promptLength} caracteres.`)).toBeVisible();
  await expect(challenges.getByText("Copiá un texto, detectado")).toBeAttached();
  await warning.getByRole("button", { name: "Entendido" }).click();
  await student.getByRole("radio", { name: "La acción y la cantidad de caracteres" }).click();
  await student.getByRole("button", { name: "Siguiente" }).click();
  await student.getByRole("radio", { name: "El código de la sala" }).click();
  await student.getByRole("button", { name: "Siguiente" }).click();

  // Pegar en el desarrollo: solo viaja la cantidad, nunca el texto.
  const essay = student.getByRole("textbox", { name: "Tu desarrollo" });
  await essay.evaluate((field) => {
    const data = new DataTransfer();
    data.setData("text/plain", "texto pegado");
    field.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(warning).toContainText("Usaste pegar (12 caracteres).");
  await expect(teacher.getByText("Se usó copiar, cortar o pegar · Pegó 12 caracteres.")).toBeVisible();
  await warning.getByRole("button", { name: "Entendido" }).click();

  // La pestaña se oculta. En una toma real eso sale como beacon al servidor;
  // la demo lo descarta, y la lista de pedidos del final lo comprueba.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    // Se saca enseguida: dejarlo puesto es justo lo que Testra marca como
    // manipulación de la supervisión.
    delete (document as { visibilityState?: unknown }).visibilityState;
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(warning).toContainText("Estuviste fuera de la ventana");
  await expect(teacher.getByText(/^La evaluación dejó de estar visible/)).toBeVisible();
  await warning.getByRole("button", { name: "Entendido" }).click();

  await page.keyboard.press("F12");
  await expect(warning).toContainText("Se detectó el uso de F12.");
  await warning.getByRole("button", { name: "Entendido" }).click();
  await expect(challenges.getByText(", detectado")).toHaveCount(4);
  await expect(page.getByText("Testra registró todo lo que probaste")).toBeVisible();

  await essay.fill("Primero miraría el contexto de cada aviso y después hablaría con el alumno.");
  await student.getByRole("button", { name: "Revisar" }).click();
  await expect(student.getByText("Respondiste todas las preguntas.")).toBeVisible();
  await student.getByRole("button", { name: "Entregar" }).click();
  const confirm = page.getByRole("alertdialog", { name: "¿Confirmás la entrega?" });
  await confirm.getByRole("button", { name: "Entregar" }).click();
  await expect(student.getByRole("heading", { name: "Entrega recibida" })).toBeVisible();
  await expect(teacher.getByRole("row", { name: /Alumno de prueba/ })).toContainText("Entregó");
  await expect(teacher.getByText("Informado por el navegador", { exact: false })).toHaveCount(5);
  await student.getByRole("button", { name: "Ver el informe" }).click();

  // Revisar: el informe es el IncidentList real, con cada aviso en su pregunta.
  await expect(page.getByRole("heading", { level: 1, name: "Alumno de prueba" })).toBeVisible();
  await expect(page.getByText("Falta corrección manual")).toBeVisible();
  await expect(page.getByText("75%")).toBeVisible();
  const report = page.getByRole("region", { name: "Avisos de actividad" });
  await expect(report.getByText("Estaba en la pregunta 1: Si cambiás de pestaña durante la evaluación, ¿qué ve tu docente?")).toBeVisible();
  await expect(report.getByText("Estaba en la pregunta 2: Si copiás o pegás un texto, ¿qué queda registrado?")).toBeVisible();
  await expect(report.getByText(`Copió ${promptLength} caracteres.`)).toBeVisible();
  await expect(report.getByText("Pegó 12 caracteres.")).toBeVisible();
  await expect(report.getByText("Se presionó la tecla F12", { exact: true })).toBeVisible();

  await page.getByRole("radiogroup", { name: "Corregí esta respuesta" }).getByRole("radio", { name: "1 pt" }).click();
  await expect(page.getByText("100%")).toBeVisible();
  await expect(page.getByText("Falta corrección manual")).toBeHidden();
  await expect(page.getByText(/^Listo en \d+:\d{2}$/)).toBeVisible();
  await expect(page.getByText("Armaste, rendiste y corregiste una evaluación. Eso es Testra.")).toBeVisible();
  // El cierre lleva directo al registro, no a elegir entre entrar y registrarse.
  await expect(page.getByRole("link", { name: "Crear mi cuenta" })).toHaveAttribute("href", "/login?modo=registro");

  expect(outgoing).toEqual([]);
});
