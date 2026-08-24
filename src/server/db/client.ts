import { Pool, types, type PoolClient } from "pg";

import { serverEnv } from "@/server/env";

// node-postgres devuelve int8 y numeric como string para no perder precisión.
// Todos los int8 de este esquema son epoch en milisegundos o conteos, muy por
// debajo de 2^53, y los numeric vienen de promedios de puntaje. Leerlos como
// number mantiene intactos los tipos de fila heredados de D1.
types.setTypeParser(types.builtins.INT8, Number);
types.setTypeParser(types.builtins.NUMERIC, Number);

// El bundle SSR de Astro y el bundle del upgrade de WebSocket se construyen por
// separado, así que cada uno instancia sus propios módulos. El pool se cuelga de
// globalThis para que ambos compartan un único juego de conexiones en vez de
// abrir dos. De paso sobrevive al recargado de módulos de `astro dev`.
const POOL_KEY = Symbol.for("testra.pg.pool");
const globalStore = globalThis as typeof globalThis & { [POOL_KEY]?: Pool };

export function getPool(): Pool {
  let pool = globalStore[POOL_KEY];
  if (!pool) {
    pool = new Pool({
      connectionString: serverEnv.DATABASE_URL,
      max: Number(process.env.DATABASE_POOL_MAX ?? 12),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    pool.on("error", (error) => {
      console.error("[db] error en cliente ocioso del pool", error);
    });
    globalStore[POOL_KEY] = pool;
  }
  return pool;
}

export async function closeDatabase(): Promise<void> {
  const pool = globalStore[POOL_KEY];
  if (!pool) return;
  globalStore[POOL_KEY] = undefined;
  await pool.end();
}

// Traduce los `?` de D1 a los `$n` posicionales de Postgres. Recorre la cadena
// carácter por carácter para no tocar los `?` que estén dentro de un literal.
export function toPositional(sql: string): string {
  let out = "";
  let position = 0;
  let quote: string | null = null;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];

    if (quote) {
      out += char;
      if (char === quote) {
        if (sql[index + 1] === quote) {
          out += sql[index + 1];
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      out += char;
      continue;
    }

    if (char === "?") {
      position += 1;
      out += `$${position}`;
      continue;
    }

    out += char;
  }

  return out;
}

type Executor = Pool | PoolClient;

/**
 * Statement con la misma forma que `D1PreparedStatement`. Mantener la interfaz
 * permite portar `repository.ts` y el actor de tomas sin reescribir las 41
 * consultas: solo cambia de dónde sale el objeto de base de datos.
 */
export class PgStatement {
  constructor(
    private readonly executor: Executor,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]): PgStatement {
    return new PgStatement(this.executor, this.sql, params);
  }

  withExecutor(executor: Executor): PgStatement {
    return new PgStatement(executor, this.sql, this.params);
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const result = await this.executor.query(toPositional(this.sql), this.params);
    return (result.rows[0] as T) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: true }> {
    const result = await this.executor.query(toPositional(this.sql), this.params);
    return { results: result.rows as T[], success: true };
  }

  async run(): Promise<{ success: true; meta: { changes: number } }> {
    const result = await this.executor.query(toPositional(this.sql), this.params);
    return { success: true, meta: { changes: result.rowCount ?? 0 } };
  }
}

export class PgDatabase {
  prepare(sql: string): PgStatement {
    return new PgStatement(getPool(), sql);
  }

  /** Equivalente a `D1Database.batch`: ejecuta todo dentro de una transacción. */
  async batch(statements: PgStatement[]): Promise<void> {
    await this.transaction(async (client) => {
      for (const statement of statements) {
        await statement.withExecutor(client).run();
      }
    });
  }

  async transaction<T>(handler: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const result = await handler(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {
        // La conexión ya está rota; el `release` de abajo la descarta.
      });
      throw error;
    } finally {
      client.release();
    }
  }
}

export const db = new PgDatabase();
