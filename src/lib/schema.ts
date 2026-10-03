/** Idempotent PostgreSQL schema, applied on first connection (see db.ts). */
export const SCHEMA_SQL = `
-- Campus Assist database schema (PostgreSQL). Idempotent: applied automatically on first connection.

CREATE TABLE IF NOT EXISTS issues (
  id          text PRIMARY KEY,
  category    text NOT NULL CHECK (category IN ('Medical','Electrical','Infrastructure','Security','Lost & Found','Other')),
  priority    text NOT NULL CHECK (priority IN ('Low','Medium','High','Critical')),
  status      text NOT NULL DEFAULT 'Reported' CHECK (status IN ('Reported','Assigned','In Progress','Resolved')),
  description text NOT NULL,
  location    text NOT NULL,
  x           real,
  y           real,
  image_id    text,
  reporter    text,
  contact     text,
  assignee    text,
  department  text NOT NULL,
  sos         boolean NOT NULL DEFAULT false,
  votes       integer NOT NULL DEFAULT 1,
  escalations integer NOT NULL DEFAULT 0,
  sla_base    timestamptz NOT NULL DEFAULT now(),   -- start of the current response-SLA window
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS issues_status_priority_idx ON issues (status, priority);
CREATE INDEX IF NOT EXISTS issues_created_idx ON issues (created_at DESC);

-- Audit trail shown to students as the timeline. kind = created | update (human action) | system (auto-escalation, votes)
CREATE TABLE IF NOT EXISTS issue_events (
  id         bigserial PRIMARY KEY,
  issue_id   text NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  status     text NOT NULL,
  note       text NOT NULL,
  kind       text NOT NULL DEFAULT 'update' CHECK (kind IN ('created','update','system')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS issue_events_issue_idx ON issue_events (issue_id, created_at);

CREATE TABLE IF NOT EXISTS messages (
  id         bigserial PRIMARY KEY,
  issue_id   text NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  sender     text NOT NULL CHECK (sender IN ('student','authority')),
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_issue_idx ON messages (issue_id, created_at);

-- "Me too" votes: one per anonymous browser id per issue (enforced by the primary key).
CREATE TABLE IF NOT EXISTS votes (
  issue_id  text NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  client_id text NOT NULL,
  PRIMARY KEY (issue_id, client_id)
);

-- Uploaded photos live in the database so the app has no filesystem dependency.
CREATE TABLE IF NOT EXISTS images (
  id         text PRIMARY KEY,
  mime       text NOT NULL,
  data       bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;
