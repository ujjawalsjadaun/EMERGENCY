# Campus Assist - Campus Emergency & Assistance Platform

Students report campus emergencies (medical, electrical, infrastructure, security, lost & found, other) and watch the
response happen live. Authorities triage, assign and resolve from a real-time command centre.

**Stack:** Next.js 16 (App Router) · TypeScript · PostgreSQL · Tailwind CSS v4

## Quick start
Requires **Node.js 20+**. No database to install - the first run boots a local PostgreSQL for you.

```bash
npm install
npm run dev          # http://localhost:3000
```

On first run the launcher (`scripts/run.mjs`) will:
1. create `.env.local` with a random `AUTH_SECRET` and a random authority password (printed in the console; never committed),
2. initialise and start an embedded PostgreSQL in `./.pgdata` (port 5433) - or use your own via `DATABASE_URL`,
3. start Next.js and shut everything down together on Ctrl+C.

| Page | URL |
|---|---|
| Student app (report, SOS, track, chat) | `/` |
| Authority command centre | `/admin` |
| Public live board (anonymous) | `/board` |

**Production build:** `npm run build && npm start`.
**Own PostgreSQL / Docker:** `docker compose up -d`, then put `DATABASE_URL=postgres://campus:campus@localhost:5432/campus` in `.env.local` (see `.env.example`).
The schema is applied automatically on first connection.

## 3-minute demo script
1. `/` - type "student fainted near the library, not responding": category and priority are suggested. Tap the map, submit.
2. The complaint ID appears with a live tracker. Open `/admin` in another window and log in: the report appears instantly (siren for Critical).
3. Open the report, assign a responder, set *In Progress*, add a note, send a chat message. The student's page updates live, no refresh.
4. Student page: hold the **SOS** button - a Critical alert hits the dashboard map. Mark the first report *Resolved* and watch the confetti.
5. Dashboard: heatmap toggle, time-lapse replay, live analytics. Then `/board` for the anonymous public view.

## Features
**Required MVP** - report form (6 categories, description, location, optional photo), 4 priority levels, authority dashboard with
filters and status changes (Reported / Assigned / In Progress / Resolved), live status via Server-Sent Events, unique
complaint IDs with public tracking.

**Extras that solve real problems in an emergency**

| Feature | Why it exists |
|---|---|
| Hold-to-send SOS | A panicked user should not fill in a form |
| Auto-categorisation + priority suggestion (voice dictation too) | Students often don't know the category or urgency |
| "Me too" duplicate detection | Ten reports of one broken light shouldn't be ten tickets; the 3rd and 6th vote raise priority |
| Response SLA with auto-escalation | Nothing sits unseen: unanswered reports climb a priority level; Critical ones re-alert every 5 min |
| Student ↔ responder chat | Responders can ask "which floor?" without phone numbers |
| Map, heatmap, replay, public Pulse board | Spot recurring hot-spots; show the public that issues get resolved |
| Response / resolution analytics | Measures whether the authority is actually responding |

## Architecture
```
src/
  app/                       Next.js App Router
    page.tsx, admin/, board/   pages (thin; render client apps)
    api/                       route handlers (one folder per resource)
  components/                UI (student-app, admin-app, board-app, tracker, report-form, ...)
  lib/
    domain.ts                  shared types, constants, pure helpers (used by server AND client)
    suggest.ts                 rule-based categorisation (pure, unit-tested)
    validation.ts              zod schemas for every request body
    db.ts                      pg pool, transactions, auto-applied schema (schema.ts)
    issues.ts                  all SQL - the only module that talks to the database
    realtime.ts                LISTEN/NOTIFY -> SSE fan-out
    auth.ts                    signed-JWT cookie session (jose)
    http.ts                    error handling, request parsing, rate limiting
  instrumentation.ts         starts the SLA auto-escalation job
scripts/run.mjs              dev/prod launcher (env + embedded PostgreSQL + Next.js)
tests/                       vitest: unit tests + end-to-end API tests
```

**Database (PostgreSQL)** - normalised, with `CHECK` constraints and indexes:
`issues` (state + SLA window) · `issue_events` (audit trail = student timeline; `kind` separates human actions from system events) ·
`messages` (chat) · `votes` (primary key `(issue_id, client_id)` guarantees one vote per browser) · `images` (photos as `bytea`, no filesystem dependency).
State changes run in transactions with `SELECT ... FOR UPDATE`, so concurrent updates, votes and escalations can't corrupt an issue.

**Real-time** - every change calls `pg_notify`; each server process holds one `LISTEN` connection and forwards events to its open
SSE streams (`/api/events`). Events carry only ids/status; clients re-fetch through the normal permission-checked API, so the stream can
never leak data. Because Postgres does the fan-out, it keeps working with several app instances.

**Security & reliability**
- Authority routes require a signed, `httpOnly`, `sameSite` JWT cookie; password compared in constant time; login is rate-limited.
- Secrets live only in `.env.local` (git-ignored) - random on first run, never hard-coded.
- Every request body is validated with zod; all SQL is parameterised; React escapes all rendered text.
- Students only ever receive public fields (no reporter name / contact). The public board exposes no free text.
- Uploads: PNG/JPEG/WebP/GIF only (no SVG), 6 MB cap, served with `nosniff`.
- Rate limits on report, SOS, vote, message and login endpoints; unexpected errors return a generic 500 and are logged server-side.

## Testing
```bash
npm test             # 13 unit tests (suggestion engine, domain logic, validation)
npm run typecheck && npm run lint

# end-to-end API tests against a running server (skipped if TEST_BASE_URL is unset):
npm run dev
TEST_BASE_URL=http://localhost:3000 TEST_ADMIN_PASSWORD=<password from .env.local> npm test
```

## Known limitations / future work
- One shared authority password. Production would use per-user accounts / SSO and role-based access.
- Categorisation is keyword rules, not ML; the campus map is a schematic, not GPS tiles.
- Complaint IDs are short: anyone holding an ID can read that complaint (never the contact details).
- The rate limiter is in-memory (per process); use Redis if you scale out. No SMS/push delivery - browser notifications only.

## Credits
Open-source libraries (see `package.json`): Next.js, React, Tailwind CSS, `pg`, `zod`, `jose`, Motion (animations), Recharts (charts),
Lucide (icons), Sonner (toasts), canvas-confetti, Geist (font), `embedded-postgres` (local dev database), Vitest.
