import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "server",
  adapter: cloudflare({
    imageService: "compile",
  }),
  integrations: [react()],
  // El chequeo de origen propio de Astro compara el Origin del navegador contra el
  // host de la request. El proxy que publica testra.becode.com.ar reescribe Host
  // hacia workers.dev, así que ese chequeo rechaza todos los POST de formulario.
  // Se reemplaza por uno equivalente y consciente del proxy en src/middleware.ts.
  security: { checkOrigin: false },
  vite: {
    plugins: [tailwindcss()],
  },
});
