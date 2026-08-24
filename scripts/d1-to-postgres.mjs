// Migra los datos de la D1 de producción a Postgres.
//
//   node scripts/d1-to-postgres.mjs --dry-run     solo lee y reporta cuánto hay
//   node scripts/d1-to-postgres.mjs               lee de D1 y escribe en Postgres
//
// Requiere DATABASE_URL (destino Postgres, con las migraciones ya aplicadas) y
// acceso de lectura a la D1 de origen. Para eso alcanza con cualquiera de las
// dos formas que entiende wrangler:
//
//   a) npx wrangler login          inicia sesión por navegador, no hay que
//                                  crear ningún token
//   b) CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID   token con D1:Read
//
// Sobre D1 solo se ejecutan SELECT: el origen no se toca. Con --dry-run tampoco
// se escribe en Postgres, así que es seguro correrlo para ver qué hay antes de
// decidir. La carga real va dentro de una transacción: o entra todo o no entra
// nada.
//
// Las filas ya presentes se saltan (ON CONFLICT DO NOTHING), así que el script
// se puede repetir sin duplicar.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import pg from "pg";

const run = promisify(execFile);

const DATABASE = "testra-db";

// Orden que respeta las claves foráneas.
const TABLES = [
  "organizations",
  "users",
  "sessions",
  "accounts",
  "verifications",
  "exams",
  "questions",
  "runs",
  "participants",
  "answers",
  "grades",
  "incidents",
  "access_requests",
  "ai_reports",
  "expected_run_students",
];

// En D1 todo esto eran enteros. En Postgres las tablas de better-auth usan
// tipos nativos, así que hay que convertir. Ver src/server/db/schema.ts.
const BOOLEAN_COLUMNS = {
  users: ["email_verified", "org_admin"],
};

const TIMESTAMP_COLUMNS = {
  users: ["created_at", "updated_at"],
  sessions: ["expires_at", "created_at", "updated_at"],
  accounts: ["access_token_expires_at", "refresh_token_expires_at", "created_at", "updated_at"],
  verifications: ["expires_at", "created_at", "updated_at"],
};

const dryRun = process.argv.includes("--dry-run");

// Sale solo si falta una variable realmente obligatoria.
function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`[migracion] falta ${name}`);
    process.exit(1);
  }
  return value;
}

async function readTable(table) {
  // `wrangler d1 execute --json` devuelve las filas ya parseadas, así que no hay
  // que interpretar el dialecto SQL de SQLite en ningún momento.
  const { stdout } = await run(
    "npx",
    ["--yes", "wrangler@4", "d1", "execute", DATABASE, "--remote", "--json", "--command", `SELECT * FROM ${table}`],
    { maxBuffer: 256 * 1024 * 1024, shell: process.platform === "win32" },
  );
  const parsed = JSON.parse(stdout);
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  return first?.results ?? [];
}

function convert(table, row) {
  const converted = { ...row };
  for (const column of BOOLEAN_COLUMNS[table] ?? []) {
    if (column in converted && converted[column] !== null) converted[column] = Boolean(converted[column]);
  }
  for (const column of TIMESTAMP_COLUMNS[table] ?? []) {
    if (column in converted && converted[column] !== null) converted[column] = new Date(Number(converted[column]));
  }
  return converted;
}

async function targetColumns(client, table) {
  const { rows } = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
    [table],
  );
  return new Set(rows.map((row) => row.column_name));
}

async function insertRows(client, table, rows, columns) {
  // Solo se copian las columnas que existen en el destino: si D1 quedó con
  // alguna columna vieja, se descarta en lugar de romper la carga.
  const names = [...columns].filter((column) => column in rows[0]);
  if (!names.length) return 0;

  const CHUNK = 500;
  let inserted = 0;

  for (let offset = 0; offset < rows.length; offset += CHUNK) {
    const chunk = rows.slice(offset, offset + CHUNK);
    const values = [];
    const placeholders = chunk.map((row, rowIndex) => {
      const slots = names.map((name, columnIndex) => {
        values.push(row[name] ?? null);
        return `$${rowIndex * names.length + columnIndex + 1}`;
      });
      return `(${slots.join(", ")})`;
    });

    const result = await client.query(
      `INSERT INTO "${table}" (${names.map((name) => `"${name}"`).join(", ")})
       VALUES ${placeholders.join(", ")}
       ON CONFLICT DO NOTHING`,
      values,
    );
    inserted += result.rowCount ?? 0;
  }

  return inserted;
}

async function main() {
  // Con `wrangler login` la sesión queda en disco y no hacen falta variables.
  if (process.env.CLOUDFLARE_API_TOKEN) requireEnv("CLOUDFLARE_ACCOUNT_ID");
  const url = dryRun ? process.env.DATABASE_URL : requireEnv("DATABASE_URL");

  console.log(dryRun ? "[migracion] modo ensayo: no se escribe nada" : "[migracion] copiando D1 -> Postgres");

  const source = {};
  for (const table of TABLES) {
    const rows = await readTable(table);
    source[table] = rows;
    console.log(`[migracion] ${table}: ${rows.length} filas en D1`);
  }

  if (dryRun) {
    const total = Object.values(source).reduce((sum, rows) => sum + rows.length, 0);
    console.log(`[migracion] total ${total} filas. Nada fue escrito.`);
    return;
  }

  const pool = new pg.Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    for (const table of TABLES) {
      const rows = source[table];
      if (!rows.length) continue;
      const columns = await targetColumns(client, table);
      const inserted = await insertRows(client, table, rows.map((row) => convert(table, row)), columns);
      console.log(`[migracion] ${table}: ${inserted} filas nuevas (${rows.length - inserted} ya estaban)`);
    }
    await client.query("COMMIT");
    console.log("[migracion] listo");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[migracion] falló, no se escribió nada", error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

await main();
