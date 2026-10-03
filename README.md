# Campus Assist - Emergency & Assistance Platform

Students report campus emergencies (medical, electrical, infrastructure, security, lost & found, other) and watch the response
in real time. Authorities triage, assign and resolve from a live dashboard.

## Run it
Requires Python 3.8+. **No dependencies to install.**
```
python server.py
```
- Student app: http://localhost:8000/
- Authority dashboard: http://localhost:8000/admin.html - the password is printed in the console at startup
  (or set your own: `ADMIN_PASSWORD=... python server.py`; `PORT` and `CAMPUS_DB` are also configurable)
- Public live board: http://localhost:8000/board.html
- Tests: `python -m unittest discover tests`

## Demo script (3 minutes)
1. Student page: type "student fainted near library, not responding" - category and priority are suggested; tap the map; submit.
2. Copy the complaint ID. In the Track box, watch the status.
3. Open the dashboard in another window: the report appears instantly (siren for Critical). Assign it, set *In Progress*, send a chat message.
4. Back on the student page: status, timeline and chat update live, without refresh.
5. Hold the **SOS** button: a Critical alert appears on the dashboard map.
6. Dashboard: heatmap + time-lapse replay; `/board.html` shows the anonymous public view.

## Features
**Required MVP:** report form (6 categories, description, location, optional photo), 4 priority levels, authority dashboard with
filters and status changes (Reported / Assigned / In Progress / Resolved), live status via Server-Sent Events, unique complaint IDs
and tracking.

**Extras that solve real problems in an emergency**
| Feature | Why it exists |
|---|---|
| Hold-to-send SOS | Panicked users should not fill a form |
| Keyword auto-categorisation / priority suggestion | Students often don't know the category or urgency |
| "Me too" duplicate detection | Ten people reporting one broken light shouldn't be ten tickets; 3 and 6 reports raise priority |
| Response SLA + auto-escalation | Guarantees nothing sits unseen; Critical re-alerts every 5 min |
| Student-responder chat | Responders can ask "which floor?" without phone numbers |
| Map, heatmap, replay, public Pulse board | Spot recurring hot-spots; show the public that issues get resolved |
| Avg response / resolution analytics | Measures whether the authority is actually responding |

## Architecture
```
server.py          HTTP API + SSE + SQLite storage + SLA escalation thread (Python stdlib only)
public/            Static frontend (vanilla JS + vendored Chart.js / confetti, no build step)
  index.html       student: SOS, report, track, chat
  admin.html       authority dashboard
  board.html       public anonymous live board
  common.js        shared helpers (API client, map rendering)
tests/test_api.py  end-to-end API tests
```
- **API:** `POST /api/issues`, `GET /api/issues/:id` (public, private fields stripped), `GET /api/issues` and `PATCH /api/issues/:id` (admin),
  `POST /api/issues/:id/vote|messages`, `GET /api/similar`, `GET /api/board`, `GET /api/stats`, `GET /api/events` (SSE).
- **Database:** one SQLite table `issues`; history and chat are JSON columns (simple, atomic with the row). Schema migrates itself.
- **Real-time:** SSE; students subscribe per complaint ID, authorities subscribe to everything. Student streams never include contact details.
- **Security:** admin routes need a bearer token from `/api/login`; random admin password unless configured; all user text is HTML-escaped
  on render; inputs validated and size-limited; uploads restricted to image types, 6 MB max, saved under server-generated names.

## Known limitations / future work
- Admin auth is a single shared password with in-memory tokens (restart logs everyone out). Production would use per-user accounts.
- Categorisation is keyword-based, not ML. The map is a schematic, not real GPS tiles.
- Complaint IDs are short and guessable-ish; public tracking exposes description/location (not contact info) to anyone with the ID.
- No rate limiting. SMS/push delivery isn't implemented (browser notifications only).

## Credits
Backend: Python standard library only. Frontend libraries are vendored in `public/vendor/` (no CDN, works offline, nothing to install):
- [Chart.js](https://www.chartjs.org) 4.4.7 (MIT) - live analytics charts on the dashboard
- [canvas-confetti](https://github.com/catdad/canvas-confetti) 1.9.3 (ISC) - small celebration when a student's issue is resolved

Browser APIs: EventSource, Web Speech API, Geolocation, Web Audio.
