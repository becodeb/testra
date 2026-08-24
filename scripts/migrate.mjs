// Aplica las migraciones generadas por drizzle-kit. Corre también dentro del
// contenedor antes de arrancar el servidor (`npm start`), así que usa el
// migrador de drizzle-orm —que es una dependencia de producción— y no
// drizzle-kit, que solo está en las de desarrollo.

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[migrate] falta DATABASE_URL");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });

try {
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.log("[migrate] esquema al día");
} catch (error) {
  console.error("[migrate] falló la migración", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
