// Genera los íconos y la tarjeta social a partir de la marca.
//
// Existe como script y no como imágenes sueltas commiteadas a mano porque el
// favicon original eran los 1254x1254 de la marca —359 KB servidos en cada
// página— y sin una receta escrita el próximo que cambie el logo vuelve a
// copiar el PNG grande a `public/`.
//
// Uso: node scripts/generate-icons.mjs

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import sharp from "sharp";

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const marca = path.join(raiz, "src/assets/testra-mark.png");
const destino = path.join(raiz, "public");

const BRAND = "#0a2878";
const BRAND_DEEP = "#061a59";
const INK_2 = "#3f454f";
const MUTED = "#6b7280";

// Liberation Sans está en la imagen base de Debian y es métricamente compatible
// con Arial. No se usa Inter aunque el proyecto la tenga: viene solo en woff2 y
// el renderizador de SVG de sharp no la levanta.
const FUENTE = "Liberation Sans, DejaVu Sans, sans-serif";

/** Íconos cuadrados. El de 32 es el que pide el navegador en cada visita. */
const ICONOS = [
  { nombre: "favicon-32.png", tamano: 32 },
  // Se regenera chico aunque ya nadie lo referencie: la ruta vieja sigue viva
  // en marcadores y en cualquier enlace externo, y pesaba 359 KB.
  { nombre: "favicon.png", tamano: 48 },
  { nombre: "icon-192.png", tamano: 192 },
  { nombre: "icon-512.png", tamano: 512 },
  { nombre: "apple-touch-icon.png", tamano: 180, fondo: "#ffffff" },
];

async function generarIconos() {
  for (const { nombre, tamano, fondo } of ICONOS) {
    let pipeline = sharp(marca).resize(tamano, tamano, {
      fit: "contain",
      background: fondo ?? { r: 0, g: 0, b: 0, alpha: 0 },
    });
    // iOS no respeta la transparencia y pinta el alfa de negro.
    if (fondo) pipeline = pipeline.flatten({ background: fondo });
    await pipeline.png({ compressionLevel: 9 }).toFile(path.join(destino, nombre));
    console.log("ok", nombre);
  }
}

async function generarTarjetaSocial() {
  const ANCHO = 1200;
  const ALTO = 630;
  const marcaLado = 168;

  const fondo = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${ANCHO}" height="${ALTO}">
  <rect width="${ANCHO}" height="${ALTO}" fill="#ffffff"/>
  <rect width="${ANCHO}" height="14" fill="${BRAND}"/>
  <g font-family="${FUENTE}">
    <text x="312" y="278" font-size="96" font-weight="bold" fill="${BRAND_DEEP}" letter-spacing="-3">Testra</text>
    <text x="316" y="344" font-size="42" fill="${INK_2}">Evaluaciones en línea para docentes</text>
    <text x="316" y="398" font-size="32" fill="${MUTED}">Creá, tomá y corregí desde un mismo lugar.</text>
  </g>
  <text x="${ANCHO - 64}" y="${ALTO - 48}" text-anchor="end" font-family="${FUENTE}" font-size="26" fill="${MUTED}">testra.becode.com.ar</text>
</svg>`);

  const marcaRedimensionada = await sharp(marca)
    .resize(marcaLado, marcaLado, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();

  await sharp(fondo)
    .composite([{ input: marcaRedimensionada, left: 104, top: 228 }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(destino, "og.png"));
  console.log("ok og.png");
}

async function generarManifiesto() {
  const manifiesto = {
    name: "Testra",
    short_name: "Testra",
    description: "Evaluaciones en línea para docentes.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: BRAND,
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
    ],
  };
  await writeFile(path.join(destino, "site.webmanifest"), `${JSON.stringify(manifiesto, null, 2)}\n`);
  console.log("ok site.webmanifest");
}

await mkdir(destino, { recursive: true });
await generarIconos();
await generarTarjetaSocial();
await generarManifiesto();
