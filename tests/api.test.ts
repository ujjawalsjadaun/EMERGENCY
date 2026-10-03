/**
 * End-to-end API tests against a RUNNING server (they are skipped otherwise):
 *   npm run dev     (in one terminal)
 *   TEST_BASE_URL=http://localhost:3000 TEST_ADMIN_PASSWORD=<password from .env.local> npm test
 */
import { beforeAll, describe, expect, it } from "vitest";

const BASE = process.env.TEST_BASE_URL;
const PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? "";

async function call(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  const res = await fetch(BASE + path, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.cookie ? { Cookie: init.cookie } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})), headers: res.headers };
}

describe.skipIf(!BASE)("API", () => {
  let cookie = "";
  beforeAll(async () => {
    const r = await call("/api/login", { body: { password: PASSWORD } });
    expect(r.status).toBe(200);
    cookie = r.headers.get("set-cookie")!.split(";")[0];
  });

  const report = (extra = {}) =>
    call("/api/issues", { body: { category: "Electrical", priority: "Medium", description: "Sparks from socket", location: "Hostel A", x: 18, y: 14, contact: "secret-contact", ...extra } });

  it("report -> public track hides private fields -> admin lifecycle", async () => {
    const created = await report();
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const pub = await call(`/api/issues/${id}`);
    expect(pub.status).toBe(200);
    expect(pub.body.status).toBe("Reported");
    expect(pub.body.contact).toBeUndefined();

    expect((await call(`/api/issues/${id}`, { method: "PATCH", body: { status: "Resolved" } })).status).toBe(401);
    const patched = await call(`/api/issues/${id}`, { method: "PATCH", body: { assignee: "Dr. Rao", status: "Resolved" }, cookie });
    expect(patched.body).toMatchObject({ status: "Resolved", assignee: "Dr. Rao", contact: "secret-contact" });
    expect(patched.body.resolvedAt).toBeTruthy();
  });

  it("validates input and protects admin routes", async () => {
    expect((await report({ description: "x" })).status).toBe(400);
    expect((await call("/api/issues")).status).toBe(401);
    expect((await call("/api/stats")).status).toBe(401);
    expect((await call("/api/login", { body: { password: "definitely-wrong" } })).status).toBe(401);
    expect((await call("/api/issues/CMP-000000-0000")).status).toBe(404);
  });

  it("SOS creates a Critical issue", async () => {
    const { body } = await call("/api/sos", { body: {} });
    expect((await call(`/api/issues/${body.id}`)).body).toMatchObject({ priority: "Critical", sos: true });
  });

  it("votes count once per client and raise priority at 3", async () => {
    const id = (await report()).body.id as string;
    for (const client of ["client-aaaa", "client-aaaa", "client-bbbb"]) await call(`/api/issues/${id}/vote`, { body: { client } });
    expect((await call(`/api/issues/${id}`)).body).toMatchObject({ votes: 3, priority: "High" });
  });

  it("chat roles are taken from the session, not the request", async () => {
    const id = (await report()).body.id as string;
    await call(`/api/issues/${id}/messages`, { body: { text: "help" } });
    await call(`/api/issues/${id}/messages`, { body: { text: "on it" }, cookie });
    const { body } = await call(`/api/issues/${id}`);
    expect(body.messages.map((m: { from: string }) => m.from)).toEqual(["student", "authority"]);
  });

  it("public board exposes no free text", async () => {
    const { body } = await call("/api/board");
    expect(JSON.stringify(body)).not.toContain("Sparks from socket");
  });
});
