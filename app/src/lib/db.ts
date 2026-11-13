import { Pool, PoolClient } from "pg";

const g = globalThis as unknown as { __semdocPool?: Pool };
export const pool: Pool =
  g.__semdocPool ?? (g.__semdocPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 }));

export async function q<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(text, params)).rows as T[];
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

/** Errors with a message that is safe to show to the user. */
export class AppError extends Error {}

export const fmt = (d: Date | string | null) =>
  d ? new Date(d).toISOString().slice(0, 16).replace("T", " ") : "—";
