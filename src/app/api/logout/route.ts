import { destroySession, isAdmin } from "@/lib/auth";
import { json, route } from "@/lib/http";

// GET doubles as a session probe for the dashboard.
export const GET = route(async () => json({ admin: await isAdmin() }));

export const POST = route(async () => {
  await destroySession();
  return json({ ok: true });
});
