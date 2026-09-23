import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Config separada de `vitest.config.ts` a propósito: el harness de evaluación de
// detección de copia (scripts/copy-eval) hace llamadas de red reales (ai-router,
// y Jev cuando EVAL_JEV=1) y puede tardar varios minutos. `npm test` usa
// `vitest.config.ts` (solo `src/**/*.test.ts`) y nunca levanta esto.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["scripts/**/*.eval.ts"],
    exclude: ["node_modules/**"],
    // Sin límite propio: cada test interno controla su propio timeout con red
    // real (el juez LLM solo, con 120 pares ~1s de pausa entre sí, ya pasa el
    // minuto). testTimeout es la red de seguridad, no el ritmo esperado.
    testTimeout: 20 * 60 * 1000,
    hookTimeout: 20 * 60 * 1000,
    // El reporter "default" de Vitest 4 no muestra el `console.log` de un test
    // que pasa. El harness necesita que el reporte se imprima siempre (no solo
    // quede en el archivo), así que acá el reporter verbose es el default.
    reporters: ["verbose"],
  },
});
