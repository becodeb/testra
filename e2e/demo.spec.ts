import { expect, test, type Request } from "@playwright/test";

// La demo promete que nada sale del navegador. Una vez que hidrata, lo único
// que el navegador puede pedirle al sitio son sus propios archivos: los que baja
// solo (íconos, manifiesto, tipografías) y, en desarrollo, los módulos que sirve
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
  /^\/favicon(-32\.png|\.ico)$/,
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

test("la demo se rinde, avisa cada intento de copiarse y muestra lo que vio el docente", async ({ page, baseURL }) => {
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

  // Sin bienvenida ni pasos previos: la primera pregunta está a la vista.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Si cambiás de pestaña durante la evaluación, ¿qué ve tu docente?")).toBeVisible();
  await expect(page.getByText("Pregunta 1 de 3")).toBeVisible();
  const visible = page.getByText(/^\d+ avisos? visibles?$/);
  await expect(visible).toHaveText("0 avisos visibles");
  const warning = page.getByRole("dialog", { name: "Este evento quedó registrado" });

  // Pregunta 1: la ventana pierde el foco un rato y lo detecta el hook real.
  await page.getByRole("radio", { name: "Un aviso con cuánto tiempo estuviste afuera" }).click();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.waitForTimeout(1_100);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(warning).toContainText("Estuviste fuera de la ventana");
  await expect(warning).toContainText("Tu docente ve el mismo registro. Los incidentes no cambian tu nota automáticamente.");
  await warning.getByRole("button", { name: "Entendido" }).click();
  await expect(warning).toBeHidden();
  await expect(visible).toHaveText("1 aviso visible");

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
  await warning.getByRole("button", { name: "Entendido" }).click();
  await expect(visible).toHaveText("2 avisos visibles");

  // Pregunta 2: copiar el enunciado. Se responde mal a propósito.
  await page.getByRole("button", { name: "Siguiente" }).click();
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
  await warning.getByRole("button", { name: "Entendido" }).click();
  await page.getByRole("radio", { name: "Nada", exact: true }).click();
  await expect(visible).toHaveText("3 avisos visibles");

  // Pregunta 3: pegar la respuesta corta. Solo viaja la cantidad, nunca el texto.
  await page.getByRole("button", { name: "Siguiente" }).click();
  const answer = page.getByRole("textbox", { name: "Tu respuesta" });
  await answer.evaluate((field) => {
    const data = new DataTransfer();
    data.setData("text/plain", "código");
    field.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(warning).toContainText("Usaste pegar (6 caracteres). Testra no guarda el contenido.");
  await warning.getByRole("button", { name: "Entendido" }).click();
  await answer.fill("Código");
  await expect(visible).toHaveText("4 avisos visibles");

  // Entregar lleva directo a lo que vio el docente.
  await page.getByRole("button", { name: "Entregar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Esto vio tu docente" })).toBeVisible();
  const grade = page.getByRole("region", { name: "Cómo te fue" });
  await expect(grade.getByText("67%")).toBeVisible();
  await expect(grade.getByText("2 de 3 correctas")).toBeVisible();
  await expect(grade.getByText("Correcta: La acción y la cantidad de caracteres")).toBeVisible();
  const log = page.getByRole("region", { name: "Lo que registró Testra" }).getByRole("listitem");
  await expect(log).toHaveCount(4);
  await expect(log.nth(0)).toContainText(/Otra ventana tomó el control \(1(,\d)? s\)/);
  await expect(log.nth(0)).toContainText(/Pregunta 1 · \d{2}:\d{2}:\d{2}/);
  await expect(log.nth(1)).toContainText("La evaluación dejó de estar visible");
  await expect(log.nth(1)).toContainText("Pregunta 1 ·");
  await expect(log.nth(2)).toContainText(`Copió ${promptLength} caracteres`);
  await expect(log.nth(2)).toContainText("Pregunta 2 ·");
  await expect(log.nth(3)).toContainText("Pegó 6 caracteres");
  await expect(log.nth(3)).toContainText("Pregunta 3 ·");
  await expect(page.getByRole("link", { name: "Crear mi cuenta" })).toHaveAttribute("href", "/login?modo=registro");

  // Rendir de nuevo: en blanco, sin avisos y con el reloj entero.
  await page.getByRole("button", { name: "Rendir de nuevo" }).click();
  await expect(page.getByText("Pregunta 1 de 3")).toBeVisible();
  await expect(visible).toHaveText("0 avisos visibles");
  await expect(page.getByRole("timer")).toHaveText(/^0(5:00|4:5\d)$/);
  await expect(page.getByRole("radio", { name: "Un aviso con cuánto tiempo estuviste afuera" })).toHaveAttribute("aria-checked", "false");

  // Sin responder ni probar nada, el informe también lo dice.
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("button", { name: "Entregar" }).click();
  await expect(page.getByRole("region", { name: "Cómo te fue" }).getByText("0 de 3 correctas")).toBeVisible();
  await expect(page.getByText("No hubo avisos. Rendí de nuevo y probá cambiar de pestaña o pegar una respuesta.")).toBeVisible();

  expect(outgoing).toEqual([]);
});
