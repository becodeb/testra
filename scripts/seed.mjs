// Carga scripts/seed.sql en la base apuntada por DATABASE_URL. Es una
// instalación de demostración: no correr contra producción.

import { readFile } from "node:fs/promises";

import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[seed] falta DATABASE_URL");
  process.exit(1);
}

const sql = await readFile(new URL("./seed.sql", import.meta.url), "utf8");
const pool = new pg.Pool({ connectionString: url, max: 1 });
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query(sql);
  await client.query("COMMIT");
  console.log("[seed] datos de demostración cargados");
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("[seed] falló la carga", error);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
