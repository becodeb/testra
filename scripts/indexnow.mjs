// IndexNow avisa a Bing, Yandex, Seznam, Naver y otros buscadores que una URL
// cambió, para no depender de que un crawler pase solo por su cuenta. Google
// no lee este protocolo: para Google la vía sigue siendo Search Console con
// el sitemap. La clave es pública a propósito: el protocolo prueba que quien
// avisa controla el dominio publicándola ahí mismo, en texto plano.
//
// Uso: node scripts/indexnow.mjs [origen] [--dry-run]
//   origen     Por omisión https://testra.becode.com.ar
//   --dry-run  Valida todo y lista las URL sin avisar a nadie.
//
// No lo corras sin --dry-run salvo que quieras mandar el aviso real: cada
// llamada sin esa bandera le pide a IndexNow que recorra el sitio de nuevo.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLAVE = "4b0e775e82ef465fd0811f776583d73b";
const ENDPOINT = "https://api.indexnow.org/indexnow";

function fallar(mensaje) {
  console.error(`Error: ${mensaje}`);
  process.exit(1);
}

const argumentos = process.argv.slice(2);
const simulacro = argumentos.includes("--dry-run");
const origenIndicado = argumentos.find((argumento) => !argumento.startsWith("--"));
const origen = (origenIndicado ?? "https://testra.becode.com.ar").replace(/\/+$/, "");

let origenUrl;
try {
  origenUrl = new URL(origen);
} catch {
  fallar(`"${origen}" no es una URL válida.`);
}

// La clave tiene que existir en el repo antes de pedirle nada al
// servidor: si no está acá, tampoco puede estar deployada.
const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const archivoClave = path.join(raiz, "public", `${CLAVE}.txt`);

let claveLocal;
try {
  claveLocal = (await readFile(archivoClave, "utf8")).trim();
} catch {
  fallar(`No encuentro ${archivoClave}. Creá el archivo de la clave antes de correr esto.`);
}
if (claveLocal !== CLAVE) {
  fallar(`${archivoClave} no contiene la clave esperada.`);
}

// Si el sitio todavía no sirve el archivo, IndexNow no puede validar el
// aviso.
const ubicacionClave = `${origen}/${CLAVE}.txt`;
let respuestaClave;
try {
  respuestaClave = await fetch(ubicacionClave);
} catch (error) {
  fallar(`No pude conectar con ${ubicacionClave}: ${error.message}`);
}
if (respuestaClave.status !== 200) {
  fallar(`${ubicacionClave} respondió ${respuestaClave.status}. Deployá los cambios antes de avisar a IndexNow.`);
}
if ((await respuestaClave.text()).trim() !== CLAVE) {
  fallar(`${ubicacionClave} no devuelve la clave esperada. Deployá los cambios antes de avisar a IndexNow.`);
}

// El sitemap es la única fuente de URLs para avisar.
const urlSitemap = `${origen}/sitemap.xml`;
let textoSitemap;
try {
  const respuestaSitemap = await fetch(urlSitemap);
  if (respuestaSitemap.status !== 200) {
    fallar(`${urlSitemap} respondió ${respuestaSitemap.status}.`);
  }
  textoSitemap = await respuestaSitemap.text();
} catch (error) {
  fallar(`No pude leer ${urlSitemap}: ${error.message}`);
}

const listaUrls = [...textoSitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((coincidencia) => coincidencia[1].trim());
if (listaUrls.length === 0) {
  fallar(`${urlSitemap} no tiene ninguna URL.`);
}
for (const url of listaUrls) {
  let host;
  try {
    host = new URL(url).host;
  } catch {
    fallar(`"${url}" del sitemap no es una URL válida.`);
  }
  if (host !== origenUrl.host) {
    fallar(`"${url}" no pertenece a ${origenUrl.host}.`);
  }
}

// El modo simulacro confirma qué se mandaría, sin gastar el aviso real.
if (simulacro) {
  console.log(`Clave: ${ubicacionClave}`);
  console.log(`URLs (${listaUrls.length}):`);
  for (const url of listaUrls) console.log(`  ${url}`);
  process.exit(0);
}

// El aviso real: un solo POST con todas las URL.
let respuestaIndexNow;
try {
  respuestaIndexNow = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: origenUrl.host, key: CLAVE, keyLocation: ubicacionClave, urlList: listaUrls }),
  });
} catch (error) {
  fallar(`No pude contactar a ${ENDPOINT}: ${error.message}`);
}

console.log(`IndexNow respondió ${respuestaIndexNow.status}`);
if (respuestaIndexNow.status === 200 || respuestaIndexNow.status === 202) {
  process.exit(0);
}
console.error(await respuestaIndexNow.text());
process.exit(1);
