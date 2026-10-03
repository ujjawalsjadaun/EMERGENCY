"""End-to-end API tests. Run from the project root:  python -m unittest discover tests"""
import json, os, subprocess, sys, tempfile, time, unittest, urllib.error, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT, PASSWORD = 8791, "test-pass"
BASE = f"http://127.0.0.1:{PORT}"


def call(method, path, body=None, token=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {token}"} if token else {})
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        env = {**os.environ, "PORT": str(PORT), "ADMIN_PASSWORD": PASSWORD, "CAMPUS_DB": os.path.join(cls.tmp.name, "t.db")}
        cls.proc = subprocess.Popen([sys.executable, os.path.join(ROOT, "server.py")], env=env, stdout=subprocess.DEVNULL)
        for _ in range(50):
            try:
                call("GET", "/api/meta")
                break
            except OSError:
                time.sleep(.1)
        cls.token = call("POST", "/api/login", {"password": PASSWORD})[1]["token"]

    @classmethod
    def tearDownClass(cls):
        cls.proc.kill()
        cls.proc.wait()
        try:
            cls.tmp.cleanup()
        except OSError:
            pass

    def report(self, **kw):
        body = {"category": "Electrical", "priority": "Medium", "description": "Sparks from socket", "location": "Hostel A", "x": 18, "y": 14, **kw}
        return call("POST", "/api/issues", body)

    def test_report_track_and_lifecycle(self):
        code, r = self.report()
        self.assertEqual(code, 201)
        code, issue = call("GET", "/api/issues/" + r["id"])
        self.assertEqual((code, issue["status"]), (200, "Reported"))
        self.assertNotIn("contact", issue)             # private fields never leak to students
        call("PATCH", "/api/issues/" + r["id"], {"status": "Resolved", "assignee": "Dr. Rao"}, self.token)
        self.assertEqual(call("GET", "/api/issues/" + r["id"])[1]["status"], "Resolved")

    def test_validation_and_auth(self):
        self.assertEqual(self.report(description="x")[0], 400)
        self.assertEqual(self.report(category="Nope")[0], 400)
        self.assertEqual(call("GET", "/api/issues")[0], 401)
        self.assertEqual(call("POST", "/api/login", {"password": "wrong"})[0], 401)
        self.assertEqual(call("GET", "/api/issues/CMP-000000-0000")[0], 404)

    def test_sos_is_critical(self):
        _, r = call("POST", "/api/issues", {"sos": True})
        self.assertEqual(call("GET", "/api/issues/" + r["id"])[1]["priority"], "Critical")

    def test_votes_escalate_once_per_client(self):
        _, r = self.report(location="Library", x=50, y=26)
        for c in ("a", "a", "b", "c"):
            call("POST", f"/api/issues/{r['id']}/vote", {"client": c})
        issue = call("GET", "/api/issues/" + r["id"])[1]
        self.assertEqual((issue["votes"], issue["priority"]), (4, "High"))

    def test_chat_roles(self):
        _, r = self.report()
        call("POST", f"/api/issues/{r['id']}/messages", {"text": "help"})
        call("POST", f"/api/issues/{r['id']}/messages", {"text": "on it"}, self.token)
        self.assertEqual([m["from"] for m in call("GET", "/api/issues/" + r["id"])[1]["messages"]], ["student", "authority"])

    def test_suggest(self):
        s = call("POST", "/api/suggest", {"description": "student unconscious and bleeding"})[1]
        self.assertEqual((s["category"], s["priority"]), ("Medical", "Critical"))


if __name__ == "__main__":
    unittest.main()
