import "server-only";
import { Pool, type PoolClient } from "pg";
import { SCHEMA_SQL } from "./schema";

// One pool per server process (kept on globalThis so dev hot-reloads don't leak connections).
const g = globalThis as unknown as { __pool?: Pool; __schemaReady?: Promise<void> };

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Run `npm run dev` (starts a local PostgreSQL) or copy .env.example to .env.local.");
  }
  return url;
}

function pool(): Pool {
  if (!g.__pool) {
    g.__pool = new Pool({ connectionString: databaseUrl(), max: 10 });
    g.__pool.on("error", (err) => console.error("[db] idle client error", err));
  }
  return g.__pool;
}

/** Returns the shared pool, applying the schema once per process. */
export async function db(): Promise<Pool> {
  g.__schemaReady ??= pool()
    .query(SCHEMA_SQL)
    .then(() => undefined)
    .catch((err) => {
      g.__schemaReady = undefined; // allow a retry on the next call
      throw err;
    });
  await g.__schemaReady;
  return pool();
}

/** Runs `fn` inside a transaction, rolling back on any error. */
export async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await (await db()).connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
