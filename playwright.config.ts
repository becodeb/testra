import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:4321",
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      // Safari usa WebKit, y en las Mac es el otro navegador que se usa para
      // rendir. Corre sobre este entorno, asi que valida el motor pero no el
      // sistema: el manejo de ventanas de macOS (Cmd+Tab, escritorios, la
      // ventana ocluida) no se puede reproducir desde aca.
      name: "webkit-supervision",
      grep: /supervision se enciende/,
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: "npm run db:setup && npm run dev -- --host 127.0.0.1 --force",
    url: "http://127.0.0.1:4321/evaluaciones",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
