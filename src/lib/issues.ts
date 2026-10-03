import "server-only";
import { randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import {
  DEFAULT_DEPARTMENT,
  PRIORITIES,
  SLA_MINUTES,
  STATUSES,
  VOTE_ESCALATION_THRESHOLDS,
  CATEGORIES,
  nextPriority,
  type Category,
  type HistoryEntry,
  type LiveEvent,
  type Issue,
  type Message,
  type Priority,
  type Status,
} from "./domain";
import { db, tx } from "./db";
import { HttpError } from "./http";
import { publish } from "./realtime";
import type { CreateIssueInput, PatchIssueInput, SosInput } from "./validation";

// ---------------------------------------------------------------- row mapping
const COLS = `id, category, priority, status, description, location, x, y, image_id, reporter, contact, assignee,
  department, sos, votes, sla_base, created_at, updated_at, resolved_at`;

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function toIssue(r: Row, admin: boolean): Issue {
  const due = r.status === "Reported" ? new Date(r.sla_base.getTime() + SLA_MINUTES[r.priority as Priority] * 60_000) : null;
  const issue: Issue = {
    id: r.id,
    category: r.category,
    priority: r.priority,
    status: r.status,
    description: r.description,
    location: r.location,
    x: r.x,
    y: r.y,
    image: r.image_id ? `/api/images/${r.image_id}` : null,
    sos: r.sos,
    votes: r.votes,
    assignee: r.assignee,
    department: r.department,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    resolvedAt: r.resolved_at ? r.resolved_at.toISOString() : null,
    slaDue: due ? due.toISOString() : null,
  };
  if (admin) {
    issue.reporter = r.reporter;
    issue.contact = r.contact;
  }
  return issue;
}

async function loadDetail(issue: Issue): Promise<Issue> {
  const pool = await db();
  const [events, messages] = await Promise.all([
    pool.query("SELECT created_at, status, note, kind FROM issue_events WHERE issue_id=$1 ORDER BY created_at, id", [issue.id]),
    pool.query("SELECT created_at, sender, body FROM messages WHERE issue_id=$1 ORDER BY created_at, id", [issue.id]),
  ]);
  issue.history = events.rows.map((e): HistoryEntry => ({ at: e.created_at.toISOString(), status: e.status, note: e.note, kind: e.kind }));
  issue.messages = messages.rows.map((m): Message => ({ at: m.created_at.toISOString(), from: m.sender, text: m.body }));
  return issue;
}

// ---------------------------------------------------------------- images
export async function saveImage(dataUrl: string): Promise<string> {
  const m = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw new HttpError(400, "image: must be a PNG, JPEG, WebP or GIF data URL");
  const data = Buffer.from(m[2], "base64");
  if (data.length > 6 * 1024 * 1024) throw new HttpError(413, "image: too large (max 6 MB)");
  const id = randomBytes(12).toString("hex");
  await (await db()).query("INSERT INTO images (id, mime, data) VALUES ($1,$2,$3)", [id, `image/${m[1]}`, data]);
  return id;
}

export async function getImage(id: string): Promise<{ mime: string; data: Buffer } | null> {
  const { rows } = await (await db()).query("SELECT mime, data FROM images WHERE id=$1", [id]);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------- create
function newId(): string {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `CMP-${ymd}-${randomBytes(2).toString("hex").toUpperCase()}`;
}

async function insertIssue(
  client: PoolClient,
  v: { category: Category; priority: Priority; description: string; location: string; x?: number; y?: number; imageId?: string | null; reporter?: string; contact?: string; sos: boolean },
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = newId();
    try {
      await client.query("SAVEPOINT ins");
      await client.query(
        `INSERT INTO issues (id, category, priority, description, location, x, y, image_id, reporter, contact, department, sos)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [id, v.category, v.priority, v.description, v.location, v.x ?? null, v.y ?? null, v.imageId ?? null, v.reporter ?? null, v.contact ?? null, DEFAULT_DEPARTMENT[v.category], v.sos],
      );
      await client.query("INSERT INTO issue_events (issue_id, status, note, kind) VALUES ($1,'Reported',$2,'created')", [
        id,
        v.sos ? "SOS received - alerting responders" : "Complaint received",
      ]);
      return id;
    } catch (err) {
      await client.query("ROLLBACK TO SAVEPOINT ins");
      if ((err as { code?: string }).code !== "23505") throw err; // retry only on id collision
    }
  }
  throw new Error("Could not allocate a complaint id");
}

export async function createIssue(input: CreateIssueInput): Promise<string> {
  const imageId = input.image ? await saveImage(input.image) : null;
  const id = await tx((c) => insertIssue(c, { ...input, imageId, sos: false }));
  await publish({ type: "created", id, priority: input.priority, category: input.category, sos: false, text: `${input.location}: ${input.description.slice(0, 120)}` });
  return id;
}

export async function createSos(input: SosInput): Promise<string> {
  const location = input.location ?? "Unknown (SOS - location not shared)";
  const id = await tx((c) =>
    insertIssue(c, { category: "Other", priority: "Critical", description: "SOS panic button pressed - immediate help requested", ...input, location, sos: true }),
  );
  await publish({ type: "created", id, priority: "Critical", category: "Other", sos: true, text: `SOS at ${location}` });
  return id;
}

// ---------------------------------------------------------------- read
export async function getIssue(id: string, admin: boolean): Promise<Issue | null> {
  const { rows } = await (await db()).query(`SELECT ${COLS} FROM issues WHERE id=$1`, [id.toUpperCase()]);
  return rows[0] ? loadDetail(toIssue(rows[0], admin)) : null;
}

/** Admin list: open issues first, then by priority and recency. */
export async function listIssues(): Promise<Issue[]> {
  const { rows } = await (await db()).query(
    `SELECT ${COLS} FROM issues
     ORDER BY (status='Resolved'), array_position($1::text[], priority) DESC, created_at DESC LIMIT 500`,
    [PRIORITIES as unknown as string[]],
  );
  return rows.map((r) => toIssue(r, true));
}

export async function similarIssues(category: Category | null, x: number, y: number) {
  const { rows } = await (await db()).query(
    `SELECT id, category, description, status, votes, created_at FROM issues
     WHERE status <> 'Resolved' AND created_at > now() - interval '12 hours' AND category <> 'Lost & Found'
       AND x IS NOT NULL AND ($1::text IS NULL OR category = $1)
       AND sqrt(power(x - $2::float8, 2) + power(y - $3::float8, 2)) <= 14
     ORDER BY created_at DESC LIMIT 5`,
    [category, x, y],
  );
  return rows.map((r) => ({ id: r.id, category: r.category as Category, description: String(r.description).slice(0, 110), status: r.status as Status, votes: r.votes as number }));
}

// ---------------------------------------------------------------- write
export async function updateIssue(id: string, patch: PatchIssueInput): Promise<Issue> {
  const result = await tx(async (c) => {
    const { rows } = await c.query("SELECT * FROM issues WHERE id=$1 FOR UPDATE", [id.toUpperCase()]);
    const cur = rows[0];
    if (!cur) throw new HttpError(404, "Not found");

    const changes: string[] = [];
    let { status, priority, department, assignee } = cur as { status: Status; priority: Priority; department: string; assignee: string | null };

    if (patch.status && patch.status !== status) {
      status = patch.status;
      changes.push(`Status changed to ${status}`);
    }
    if (patch.priority && patch.priority !== priority) {
      priority = patch.priority;
      changes.push(`Priority set to ${priority}`);
    }
    if (patch.department && patch.department !== department) {
      department = patch.department;
      changes.push(`Department: ${department}`);
    }
    if (patch.assignee !== undefined && (patch.assignee || null) !== assignee) {
      assignee = patch.assignee || null;
      changes.push(`Assigned to: ${assignee ?? "unassigned"}`);
    }
    // Assigning a person to a fresh report implicitly acknowledges it.
    if (status === "Reported" && assignee && patch.status === undefined) {
      status = "Assigned";
      changes.push("Status changed to Assigned");
    }
    const note = [...changes, ...(patch.note ? [patch.note] : [])].join("; ");
    if (note) await c.query("INSERT INTO issue_events (issue_id, status, note, kind) VALUES ($1,$2,$3,'update')", [cur.id, status, note]);

    await c.query(
      `UPDATE issues SET status=$2, priority=$3, department=$4, assignee=$5, updated_at=now(),
         resolved_at = CASE WHEN $2 = 'Resolved' THEN COALESCE(resolved_at, now()) ELSE NULL END
       WHERE id=$1`,
      [cur.id, status, priority, department, assignee],
    );
    return { id: cur.id as string, status, priority, category: cur.category as Category };
  });
  await publish({ type: "updated", ...result });
  return (await getIssue(id, true))!;
}

export async function voteIssue(id: string, clientId: string): Promise<{ votes: number; already: boolean }> {
  let event: LiveEvent | null = null;
  const out = await tx(async (c) => {
    const { rows } = await c.query("SELECT id, status, priority, category, votes FROM issues WHERE id=$1 FOR UPDATE", [id.toUpperCase()]);
    const cur = rows[0];
    if (!cur) throw new HttpError(404, "Not found");
    if (cur.status === "Resolved") return { votes: cur.votes as number, already: true };

    const ins = await c.query("INSERT INTO votes (issue_id, client_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [cur.id, clientId]);
    if (ins.rowCount === 0) return { votes: cur.votes as number, already: true };

    const votes = (cur.votes as number) + 1;
    let priority = cur.priority as Priority;
    let note = `${votes} people have now reported this`;
    if (VOTE_ESCALATION_THRESHOLDS.includes(votes) && priority !== "Critical") {
      priority = nextPriority(priority);
      note += ` - priority raised to ${priority}`;
    }
    await c.query("UPDATE issues SET votes=$2, priority=$3, updated_at=now() WHERE id=$1", [cur.id, votes, priority]);
    await c.query("INSERT INTO issue_events (issue_id, status, note, kind) VALUES ($1,$2,$3,'system')", [cur.id, cur.status, note]);
    event = { type: "updated", id: cur.id as string, status: cur.status as Status, priority, category: cur.category as Category };
    return { votes, already: false };
  });
  if (event) await publish(event);
  return out;
}

export async function addMessage(id: string, from: "student" | "authority", text: string): Promise<void> {
  const pool = await db();
  const { rows } = await pool.query("INSERT INTO messages (issue_id, sender, body) SELECT id, $2, $3 FROM issues WHERE id=$1 RETURNING issue_id", [id.toUpperCase(), from, text]);
  if (!rows[0]) throw new HttpError(404, "Not found");
  await pool.query("UPDATE issues SET updated_at=now() WHERE id=$1", [rows[0].issue_id]);
  await publish({ type: "message", id: rows[0].issue_id, text: `${from === "student" ? "Student" : "Responder"}: ${text.slice(0, 120)}` });
}

// ---------------------------------------------------------------- analytics
const zeroMap = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

const FIRST_RESPONSE_SQL = `
  SELECT avg(extract(epoch FROM (fr - created_at)) / 60.0) AS minutes FROM (
    SELECT i.created_at, (SELECT min(e.created_at) FROM issue_events e WHERE e.issue_id = i.id AND e.kind = 'update') AS fr
    FROM issues i ORDER BY i.created_at DESC LIMIT 200) t WHERE fr IS NOT NULL`;

const round = (n: number | null, d = 1) => (n == null ? null : Math.round(Number(n) * 10 ** d) / 10 ** d);

export async function stats() {
  const pool = await db();
  const [totals, byCat, byPri, byStatus, resolution, resByCat, response, perDay] = await Promise.all([
    pool.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status <> 'Resolved')::int AS open, count(*) FILTER (WHERE sos)::int AS sos FROM issues`),
    pool.query("SELECT category AS k, count(*)::int AS n FROM issues GROUP BY 1"),
    pool.query("SELECT priority AS k, count(*)::int AS n FROM issues GROUP BY 1"),
    pool.query("SELECT status AS k, count(*)::int AS n FROM issues GROUP BY 1"),
    pool.query("SELECT avg(extract(epoch FROM resolved_at - created_at)) / 3600.0 AS hours FROM issues WHERE resolved_at IS NOT NULL"),
    pool.query("SELECT category AS k, avg(extract(epoch FROM resolved_at - created_at)) / 3600.0 AS hours FROM issues WHERE resolved_at IS NOT NULL GROUP BY 1"),
    pool.query(FIRST_RESPONSE_SQL),
    pool.query(`SELECT to_char(date_trunc('day', created_at), 'MM-DD') AS d, count(*)::int AS n FROM issues
                WHERE created_at > now() - interval '14 days' GROUP BY date_trunc('day', created_at) ORDER BY date_trunc('day', created_at)`),
  ]);
  const fill = <K extends string>(keys: readonly K[], rows: { k: K; n: number }[]) => {
    const m = zeroMap(keys);
    rows.forEach((r) => (m[r.k] = r.n));
    return m;
  };
  const resMap: Record<string, number | null> = Object.fromEntries(CATEGORIES.map((c) => [c, null]));
  resByCat.rows.forEach((r) => (resMap[r.k] = round(r.hours, 2)));
  return {
    ...totals.rows[0],
    byCategory: fill(CATEGORIES, byCat.rows),
    byPriority: fill(PRIORITIES, byPri.rows),
    byStatus: fill(STATUSES, byStatus.rows),
    avgResolutionHours: round(resolution.rows[0].hours, 2),
    avgResolutionByCategory: resMap,
    avgResponseMinutes: round(response.rows[0].minutes),
    perDay: perDay.rows.map((r) => ({ day: r.d as string, count: r.n as number })),
  };
}

/** Anonymous public data for the Campus Pulse board - no descriptions, names or free-text locations. */
export async function boardData() {
  const pool = await db();
  const [open, resolved, response, ticker] = await Promise.all([
    pool.query("SELECT x, y, category, priority, status, sos FROM issues WHERE status <> 'Resolved'"),
    pool.query("SELECT count(*)::int AS n FROM issues WHERE resolved_at > now() - interval '24 hours'"),
    pool.query(FIRST_RESPONSE_SQL),
    pool.query(
      `SELECT e.created_at, i.category, e.status FROM issue_events e JOIN issues i ON i.id = e.issue_id
       WHERE e.kind IN ('created','update') ORDER BY e.created_at DESC LIMIT 12`,
    ),
  ]);
  return {
    open: open.rows as { x: number | null; y: number | null; category: Category; priority: Priority; status: Status; sos: boolean }[],
    resolvedToday: resolved.rows[0].n as number,
    avgResponseMinutes: round(response.rows[0].minutes),
    ticker: ticker.rows.map((r) => ({ at: r.created_at.toISOString() as string, category: r.category as Category, status: r.status as Status })),
  };
}

// ---------------------------------------------------------------- SLA escalation
export async function runEscalationPass(): Promise<number> {
  const pool = await db();
  const { rows } = await pool.query("SELECT id, priority, sla_base FROM issues WHERE status='Reported'");
  const now = Date.now();
  let fired = 0;
  for (const r of rows) {
    const priority = r.priority as Priority;
    if (now < r.sla_base.getTime() + SLA_MINUTES[priority] * 60_000) continue;

    const outcome = await tx(async (c) => {
      // Re-check under lock: another instance may have handled it, or a human may have responded.
      const { rows: cur } = await c.query("SELECT priority, category, sla_base FROM issues WHERE id=$1 AND status='Reported' FOR UPDATE SKIP LOCKED", [r.id]);
      if (!cur[0] || cur[0].sla_base.getTime() !== r.sla_base.getTime()) return null;
      const next = priority === "Critical" ? priority : nextPriority(priority);
      const note =
        priority === "Critical"
          ? `Still unacknowledged after ${SLA_MINUTES[priority]} min - re-alerting all responders`
          : `Auto-escalated ${priority} -> ${next}: no response within ${SLA_MINUTES[priority]} min`;
      await c.query("UPDATE issues SET priority=$2, sla_base=now(), escalations=escalations+1, updated_at=now() WHERE id=$1", [r.id, next]);
      await c.query("INSERT INTO issue_events (issue_id, status, note, kind) VALUES ($1,'Reported',$2,'system')", [r.id, note]);
      return { priority: next, category: cur[0].category as Category, note };
    });
    if (!outcome) continue;
    fired++;
    await publish({ type: "updated", id: r.id, status: "Reported", priority: outcome.priority, category: outcome.category });
    await publish({ type: "alert", id: r.id, priority: outcome.priority, category: outcome.category, text: `${r.id}: ${outcome.note}` });
  }
  return fired;
}

export type Stats = Awaited<ReturnType<typeof stats>>;
export type BoardData = Awaited<ReturnType<typeof boardData>>;
