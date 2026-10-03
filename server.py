"""Campus Emergency & Assistance Platform - zero-dependency backend (Python 3.8+).

Run:  python server.py        (env: PORT, ADMIN_PASSWORD)
Student: http://localhost:8000/        Admin: http://localhost:8000/admin.html
"""
import base64, json, mimetypes, os, queue, re, secrets, sqlite3, threading, time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

BASE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(BASE, "public")
UPLOADS = os.path.join(BASE, "uploads")
os.makedirs(UPLOADS, exist_ok=True)
PORT = int(os.environ.get("PORT", 8000))
# No hard-coded credential: set ADMIN_PASSWORD, otherwise a random one is generated and printed at startup.
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD") or secrets.token_urlsafe(9)
DB_PATH = os.environ.get("CAMPUS_DB", os.path.join(BASE, "campus.db"))

CATEGORIES = ["Medical", "Electrical", "Infrastructure", "Security", "Lost & Found", "Other"]
PRIORITIES = ["Low", "Medium", "High", "Critical"]
STATUSES = ["Reported", "Assigned", "In Progress", "Resolved"]
DEPARTMENTS = ["Medical Center", "Electrical Dept", "Maintenance", "Campus Security",
               "Hostel Warden", "Student Affairs"]
DEFAULT_DEPT = {"Medical": "Medical Center", "Electrical": "Electrical Dept",
                "Infrastructure": "Maintenance", "Security": "Campus Security",
                "Lost & Found": "Student Affairs", "Other": "Student Affairs"}

# --- "AI" auto-categorisation: weighted keyword scoring (no external API needed) ---
KEYWORDS = {
    "Medical": "injury injured blood bleeding faint fainted unconscious seizure fever sick ill pain chest breathing asthma allergy ambulance doctor medicine accident fracture burn vomit heart attack overdose",
    "Electrical": "power electric electricity shock spark sparks short circuit wire wiring fan light bulb tubelight switch socket outage blackout voltage transformer lift elevator ac geyser",
    "Infrastructure": "water leak leaking pipe broken crack ceiling roof wall road pothole toilet washroom drain sewage door window bench gate flood clogged damaged",
    "Security": "theft stolen thief harass harassment ragging fight assault stalker stalking unsafe dark suspicious intruder weapon threat molest bully drunk fire",
    "Lost & Found": "lost found missing wallet phone laptop bag id card keys purse umbrella bottle charger earphones watch notebook",
}
CRITICAL_WORDS = "unconscious unresponsive seizure bleeding heavy chest breathing fire spark sparks shock assault weapon overdose suicide trapped collapsed attack molest"
HIGH_WORDS = "injury injured accident fracture fever harassment ragging stolen theft flood leak unsafe threat fight burn"


def suggest(text):
    words = re.findall(r"[a-z]+", text.lower())
    joined = " " + " ".join(words) + " "
    scores = {}
    for cat, kws in KEYWORDS.items():
        scores[cat] = sum(1 for k in kws.split() if " " + k + " " in joined)
    best = max(scores, key=scores.get)
    category = best if scores[best] > 0 else "Other"
    if any(" " + w + " " in joined for w in CRITICAL_WORDS.split()):
        priority = "Critical"
    elif any(" " + w + " " in joined for w in HIGH_WORDS.split()):
        priority = "High"
    elif category in ("Lost & Found", "Other"):
        priority = "Low"
    else:
        priority = "Medium"
    if category == "Lost & Found" and priority != "Critical":
        priority = "Low"
    return {"category": category, "priority": priority, "confidence": min(1.0, 0.4 + 0.2 * scores.get(best, 0))}


# --- storage ---
db = sqlite3.connect(DB_PATH, check_same_thread=False)
db.row_factory = sqlite3.Row
lock = threading.RLock()
with lock:
    db.execute("""CREATE TABLE IF NOT EXISTS issues (
        id TEXT PRIMARY KEY, category TEXT, priority TEXT, status TEXT, description TEXT,
        location TEXT, x REAL, y REAL, image TEXT, reporter TEXT, contact TEXT,
        assignee TEXT, department TEXT, created REAL, updated REAL, resolved REAL,
        history TEXT)""")
    for col, typ in [("votes", "INTEGER DEFAULT 0"), ("voters", "TEXT"), ("messages", "TEXT"),
                     ("sos", "INTEGER DEFAULT 0"), ("sla_base", "REAL"), ("escalations", "INTEGER DEFAULT 0")]:
        try:
            db.execute(f"ALTER TABLE issues ADD COLUMN {col} {typ}")
        except sqlite3.OperationalError:
            pass
    db.commit()


# minutes a report may sit as "Reported" before it is auto-escalated
SLA = {"Critical": 5, "High": 30, "Medium": 120, "Low": 480}


def row_to_issue(r, public=False):
    d = dict(r)
    d["history"] = json.loads(d["history"] or "[]")
    d["messages"] = json.loads(d.get("messages") or "[]")
    d.pop("voters", None)
    d["votes"] = d.get("votes") or 0
    d["sos"] = bool(d.get("sos"))
    base = d.get("sla_base") or d["created"]
    d["slaDue"] = base + SLA[d["priority"]] * 60 if d["status"] == "Reported" else None
    if public:
        d.pop("contact", None)
        d.pop("reporter", None)
    return d


def fetch(iid):
    return row_to_issue(db.execute("SELECT * FROM issues WHERE id=?", (iid,)).fetchone())


def new_id():
    while True:
        cid = "CMP-" + time.strftime("%y%m%d") + "-" + secrets.token_hex(2).upper()
        if not db.execute("SELECT 1 FROM issues WHERE id=?", (cid,)).fetchone():
            return cid


# --- real-time: SSE subscribers ---
subs = []  # (queue, issue_id or None for admin)
subs_lock = threading.Lock()


def broadcast(event, issue, issue_id, admin_only=False):
    full = f"event: {event}\ndata: {json.dumps(issue)}\n\n"
    pub = {k: v for k, v in issue.items() if k not in ("contact", "reporter")}
    pub = f"event: {event}\ndata: {json.dumps(pub)}\n\n"
    with subs_lock:
        for q, sid in subs:
            if sid is None:
                q.put(full)
            elif sid == issue_id and not admin_only:
                q.put(pub)


tokens = set()


def save_image(data_url, cid):
    m = re.match(r"data:image/(png|jpeg|jpg|webp|gif);base64,(.+)$", data_url or "", re.S)
    if not m:
        return None
    raw = base64.b64decode(m.group(2))
    if len(raw) > 6 * 1024 * 1024:
        raise ValueError("Image too large (max 6MB)")
    ext = "jpg" if m.group(1) == "jpeg" else m.group(1)
    name = f"{cid}.{ext}"
    with open(os.path.join(UPLOADS, name), "wb") as f:
        f.write(raw)
    return "/uploads/" + name


def stats():
    rows = [dict(r) for r in db.execute("SELECT * FROM issues")]
    by = lambda k, opts: {o: sum(1 for r in rows if r[k] == o) for o in opts}
    res = [(r["resolved"] - r["created"]) / 3600 for r in rows if r["resolved"]]
    per_cat = {}
    for c in CATEGORIES:
        v = [(r["resolved"] - r["created"]) / 3600 for r in rows if r["resolved"] and r["category"] == c]
        per_cat[c] = round(sum(v) / len(v), 2) if v else None
    day = {}
    for r in rows:
        d = time.strftime("%Y-%m-%d", time.localtime(r["created"]))
        day[d] = day.get(d, 0) + 1
    resp = []
    for r in rows:
        h = json.loads(r["history"] or "[]")
        if len(h) > 1:
            resp.append((h[1]["t"] - r["created"]) / 60)
    return {"avgResponseMinutes": round(sum(resp) / len(resp), 1) if resp else None,
            "sos": sum(1 for r in rows if r["sos"]), "total": len(rows), "byCategory": by("category", CATEGORIES), "byPriority": by("priority", PRIORITIES),
            "byStatus": by("status", STATUSES), "avgResolutionHours": round(sum(res) / len(res), 2) if res else None,
            "avgResolutionByCategory": per_cat, "perDay": dict(sorted(day.items())[-14:]),
            "open": sum(1 for r in rows if r["status"] != "Resolved")}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    # helpers
    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 10 * 1024 * 1024:
            raise ValueError("Payload too large")
        return json.loads(self.rfile.read(n) or b"{}")

    def is_admin(self, qs=None):
        t = self.headers.get("Authorization", "").replace("Bearer ", "") or (qs or {}).get("token", [""])[0]
        return t in tokens

    def static(self, path):
        if path == "/":
            path = "/index.html"
        root = UPLOADS if path.startswith("/uploads/") else PUBLIC
        rel = path[len("/uploads/"):] if root == UPLOADS else path.lstrip("/")
        full = os.path.normpath(os.path.join(root, rel))
        if not full.startswith(root) or not os.path.isfile(full):
            return self.send_json({"error": "Not found"}, 404)
        with open(full, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(full)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def sse(self, issue_id):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        q = queue.Queue()
        entry = (q, issue_id)
        with subs_lock:
            subs.append(entry)
        try:
            self.wfile.write(b": connected\n\n")
            self.wfile.flush()
            while True:
                try:
                    msg = q.get(timeout=15)
                except queue.Empty:
                    msg = ": ping\n\n"
                self.wfile.write(msg.encode())
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            with subs_lock:
                if entry in subs:
                    subs.remove(entry)
            self.close_connection = True

    # routes
    def do_GET(self):
        u = urlparse(self.path)
        qs = parse_qs(u.query)
        p = u.path
        if p == "/api/meta":
            return self.send_json({"categories": CATEGORIES, "priorities": PRIORITIES,
                                   "statuses": STATUSES, "departments": DEPARTMENTS, "sla": SLA})
        if p == "/api/similar":
            cat = qs.get("category", [""])[0]
            try:
                x, y = float(qs["x"][0]), float(qs["y"][0])
            except (KeyError, ValueError):
                return self.send_json([])
            with lock:
                rows = db.execute("SELECT * FROM issues WHERE status!='Resolved' AND created>?", (time.time() - 12 * 3600,)).fetchall()
            out = []
            for r in rows:
                if r["x"] is None or (cat and r["category"] != cat) or r["category"] == "Lost & Found":
                    continue
                if ((r["x"] - x) ** 2 + (r["y"] - y) ** 2) ** .5 <= 14:
                    out.append({"id": r["id"], "category": r["category"], "description": r["description"][:110],
                                "status": r["status"], "votes": r["votes"] or 0, "created": r["created"]})
            return self.send_json(out[:5])
        if p == "/api/board":
            with lock:
                rows = [row_to_issue(r, True) for r in db.execute("SELECT * FROM issues ORDER BY created DESC").fetchall()]
            today = time.time() - 86400
            ev = sorted(((h["t"], i["category"], h["status"]) for i in rows for h in i["history"]), reverse=True)[:12]
            resp = [(i["history"][1]["t"] - i["created"]) / 60 for i in rows[:60] if len(i["history"]) > 1]
            return self.send_json({
                "open": [{"x": i["x"], "y": i["y"], "category": i["category"], "priority": i["priority"],
                          "status": i["status"], "sos": i["sos"], "id": ""} for i in rows if i["status"] != "Resolved"],
                "resolvedToday": sum(1 for i in rows if i["resolved"] and i["resolved"] > today),
                "avgResponseMinutes": round(sum(resp) / len(resp), 1) if resp else None,
                "ticker": [{"t": t, "category": c, "status": s_} for t, c, s_ in ev]})
        if p == "/api/events":
            iid = (qs.get("id", [""])[0] or "").upper()
            if iid:
                return self.sse(iid)
            if not self.is_admin(qs):
                return self.send_json({"error": "Unauthorized"}, 401)
            return self.sse(None)
        m = re.match(r"^/api/issues/([\w-]+)$", p)
        if m:
            with lock:
                r = db.execute("SELECT * FROM issues WHERE id=?", (m.group(1).upper(),)).fetchone()
            if not r:
                return self.send_json({"error": "No complaint found with that ID"}, 404)
            return self.send_json(row_to_issue(r, public=not self.is_admin()))
        if p == "/api/issues":
            if not self.is_admin():
                return self.send_json({"error": "Unauthorized"}, 401)
            with lock:
                rows = db.execute("SELECT * FROM issues ORDER BY created DESC").fetchall()
            order = {p_: i for i, p_ in enumerate(PRIORITIES)}
            out = [row_to_issue(r) for r in rows]
            out.sort(key=lambda i: (i["status"] == "Resolved", -order[i["priority"]], -i["created"]))
            return self.send_json(out)
        if p == "/api/stats":
            if not self.is_admin():
                return self.send_json({"error": "Unauthorized"}, 401)
            with lock:
                return self.send_json(stats())
        return self.static(p)

    def do_POST(self):
        p = urlparse(self.path).path
        try:
            data = self.body()
        except Exception as e:
            return self.send_json({"error": str(e)}, 400)
        if p == "/api/login":
            if secrets.compare_digest(str(data.get("password", "")), ADMIN_PASSWORD):
                t = secrets.token_urlsafe(24)
                tokens.add(t)
                return self.send_json({"token": t})
            return self.send_json({"error": "Wrong password"}, 401)
        if p == "/api/suggest":
            return self.send_json(suggest(str(data.get("description", ""))))
        if p == "/api/issues":
            sos = bool(data.get("sos"))
            desc = str(data.get("description", "")).strip()
            cat, pri = data.get("category"), data.get("priority")
            loc = str(data.get("location", "")).strip()
            if sos:
                cat = cat if cat in CATEGORIES else "Other"
                pri, desc = "Critical", desc or "SOS panic button pressed - immediate help requested"
                loc = loc or "Unknown (SOS - location not shared)"
            if cat not in CATEGORIES or pri not in PRIORITIES or len(desc) < 5 or not loc:
                return self.send_json({"error": "Category, priority, description (5+ chars) and location are required"}, 400)
            now = time.time()
            with lock:
                cid = new_id()
                try:
                    img = save_image(data.get("image"), cid) if data.get("image") else None
                except Exception as e:
                    return self.send_json({"error": str(e)}, 400)
                hist = [{"t": now, "status": "Reported", "note": "SOS received - alerting responders" if sos else "Complaint received"}]
                db.execute("""INSERT INTO issues (id,category,priority,status,description,location,x,y,image,reporter,contact,
                              assignee,department,created,updated,resolved,history,votes,voters,messages,sos,sla_base,escalations)
                              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                           (cid, cat, pri, "Reported", desc[:2000], loc[:200], data.get("x"), data.get("y"), img,
                            str(data.get("reporter", ""))[:80], str(data.get("contact", ""))[:80], None,
                            DEFAULT_DEPT[cat], now, now, None, json.dumps(hist), 1, "[]", "[]", int(sos), now, 0))
                db.commit()
                issue = fetch(cid)
            broadcast("created", issue, None)
            return self.send_json({"id": cid}, 201)
        m = re.match(r"^/api/issues/([\w-]+)/(vote|messages)$", p)
        if m:
            iid, kind = m.group(1).upper(), m.group(2)
            with lock:
                r = db.execute("SELECT * FROM issues WHERE id=?", (iid,)).fetchone()
                if not r:
                    return self.send_json({"error": "Not found"}, 404)
                now = time.time()
                if kind == "vote":
                    voters = json.loads(r["voters"] or "[]")
                    client = str(data.get("client", ""))[:40]
                    if not client or client in voters or r["status"] == "Resolved":
                        return self.send_json({"votes": r["votes"] or 0, "already": True})
                    voters.append(client)
                    votes, pri = (r["votes"] or 0) + 1, r["priority"]
                    hist = json.loads(r["history"])
                    note = f"{votes} people have now reported this"
                    if votes in (3, 6) and pri != "Critical":
                        pri = PRIORITIES[PRIORITIES.index(pri) + 1]
                        note += f" - priority raised to {pri}"
                    hist.append({"t": now, "status": r["status"], "note": note})
                    db.execute("UPDATE issues SET votes=?, voters=?, priority=?, history=?, updated=? WHERE id=?",
                               (votes, json.dumps(voters), pri, json.dumps(hist), now, iid))
                else:
                    text = str(data.get("text", "")).strip()[:500]
                    if not text:
                        return self.send_json({"error": "Empty message"}, 400)
                    msgs = json.loads(r["messages"] or "[]")[-99:]
                    msgs.append({"t": now, "from": "authority" if self.is_admin() else "student", "text": text})
                    db.execute("UPDATE issues SET messages=?, updated=? WHERE id=?", (json.dumps(msgs), now, iid))
                db.commit()
                issue = fetch(iid)
            broadcast("updated", issue, iid)
            return self.send_json({"ok": True, "votes": issue["votes"]})
        return self.send_json({"error": "Not found"}, 404)

    def do_PATCH(self):
        m = re.match(r"^/api/issues/([\w-]+)$", urlparse(self.path).path)
        if not m:
            return self.send_json({"error": "Not found"}, 404)
        if not self.is_admin():
            return self.send_json({"error": "Unauthorized"}, 401)
        try:
            data = self.body()
        except Exception as e:
            return self.send_json({"error": str(e)}, 400)
        iid = m.group(1).upper()
        with lock:
            r = db.execute("SELECT * FROM issues WHERE id=?", (iid,)).fetchone()
            if not r:
                return self.send_json({"error": "Not found"}, 404)
            issue = row_to_issue(r)
            now = time.time()
            note = str(data.get("note", "")).strip()[:300]
            changes = []
            if data.get("status") in STATUSES and data["status"] != issue["status"]:
                issue["status"] = data["status"]
                issue["resolved"] = now if data["status"] == "Resolved" else None
                changes.append(f"Status changed to {data['status']}")
            if data.get("priority") in PRIORITIES and data["priority"] != issue["priority"]:
                issue["priority"] = data["priority"]
                changes.append(f"Priority set to {data['priority']}")
            for k, label in (("department", "Department"), ("assignee", "Assigned to")):
                if k in data and (data[k] or None) != issue[k]:
                    issue[k] = str(data[k]).strip()[:80] or None
                    changes.append(f"{label}: {issue[k] or 'unassigned'}")
            # auto-advance Reported -> Assigned when someone is assigned
            if issue["status"] == "Reported" and issue["assignee"] and "status" not in data:
                issue["status"] = "Assigned"
                changes.append("Status changed to Assigned")
            if changes or note:
                issue["history"].append({"t": now, "status": issue["status"], "note": "; ".join(changes + ([note] if note else []))})
            issue["updated"] = now
            db.execute("""UPDATE issues SET status=?, priority=?, assignee=?, department=?, updated=?, resolved=?, history=?
                          WHERE id=?""", (issue["status"], issue["priority"], issue["assignee"], issue["department"],
                                          now, issue["resolved"], json.dumps(issue["history"]), iid))
            db.commit()
            issue = fetch(iid)
        broadcast("updated", issue, iid)
        return self.send_json(issue)


def escalation_loop():
    """Auto-escalate reports nobody has acknowledged within their SLA; re-alert for stuck Critical ones."""
    while True:
        time.sleep(10)
        now, fired = time.time(), []
        with lock:
            for r in db.execute("SELECT * FROM issues WHERE status='Reported'").fetchall():
                i = row_to_issue(r)
                if now < i["slaDue"]:
                    continue
                pri, hist = i["priority"], i["history"]
                if pri == "Critical":
                    note = f"Still unacknowledged after {SLA[pri]} min - re-alerting all responders"
                else:
                    new = PRIORITIES[PRIORITIES.index(pri) + 1]
                    note = f"Auto-escalated {pri} -> {new}: no response within {SLA[pri]} min"
                    pri = new
                hist.append({"t": now, "status": "Reported", "note": note})
                db.execute("UPDATE issues SET priority=?, sla_base=?, escalations=escalations+1, history=?, updated=? WHERE id=?",
                           (pri, now, json.dumps(hist), now, i["id"]))
                fired.append((i["id"], note))
            db.commit()
            fired = [(iid, note, fetch(iid)) for iid, note in fired]
        for iid, note, issue in fired:
            broadcast("updated", issue, iid)
            broadcast("alert", {"id": iid, "text": note, "priority": issue["priority"]}, iid, admin_only=True)


if __name__ == "__main__":
    threading.Thread(target=escalation_loop, daemon=True).start()
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    srv.daemon_threads = True
    print(f"Campus Assist running:  http://localhost:{PORT}/   admin: /admin.html  (password: {ADMIN_PASSWORD})", flush=True)
    srv.serve_forever()
