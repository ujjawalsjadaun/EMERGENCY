import "server-only";
import { Client } from "pg";
import type { LiveEvent } from "./domain";
import { databaseUrl, db } from "./db";

/**
 * Real-time fan-out built on PostgreSQL LISTEN/NOTIFY:
 *  - every change calls publish(), which runs pg_notify
 *  - one dedicated connection per server process LISTENs and forwards events to its open SSE streams
 * So it keeps working when the app runs as several instances behind a load balancer.
 *
 * Events carry only ids/status (NOTIFY payloads are limited to 8KB); clients re-fetch through the normal,
 * permission-checked API. Free-text `text` is delivered to authorities only.
 */
const CHANNEL = "campus_events";

type Subscriber = { issueId: string | null; send: (e: LiveEvent) => void }; // issueId null => authority stream

const g = globalThis as unknown as { __rt?: { subs: Set<Subscriber>; started: boolean } };
const state = (g.__rt ??= { subs: new Set(), started: false });

export async function publish(event: LiveEvent): Promise<void> {
  const payload = JSON.stringify(event);
  await (await db()).query("SELECT pg_notify($1, $2)", [CHANNEL, payload]);
}

function dispatch(e: LiveEvent) {
  for (const sub of state.subs) {
    if (sub.issueId === null) sub.send(e);
    else if (sub.issueId === e.id) sub.send({ type: e.type, id: e.id, status: e.status, priority: e.priority });
  }
}

async function startListener(): Promise<void> {
  const client = new Client({ connectionString: databaseUrl() });
  client.on("notification", (msg) => {
    try {
      if (msg.payload) dispatch(JSON.parse(msg.payload) as LiveEvent);
    } catch (err) {
      console.error("[realtime] bad payload", err);
    }
  });
  const retry = () => {
    state.started = false;
    setTimeout(() => ensureListener().catch(() => undefined), 2000);
  };
  client.on("error", retry);
  client.on("end", retry);
  await client.connect();
  await client.query(`LISTEN ${CHANNEL}`);
}

async function ensureListener(): Promise<void> {
  if (state.started) return;
  state.started = true;
  try {
    await db(); // make sure the schema exists first
    await startListener();
  } catch (err) {
    state.started = false;
    throw err;
  }
}

/** Registers an SSE subscriber; returns an unsubscribe function. */
export async function subscribe(sub: Subscriber): Promise<() => void> {
  await ensureListener();
  state.subs.add(sub);
  return () => state.subs.delete(sub);
}
