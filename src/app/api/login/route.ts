import { checkPassword, createSession } from "@/lib/auth";
import { HttpError, json, parseBody, rateLimit, route } from "@/lib/http";
import { loginSchema } from "@/lib/validation";

export const POST = route(async (req) => {
  rateLimit(req, "login", 8, 5 * 60_000); // brute-force protection
  const { password } = await parseBody(req, loginSchema);
  if (!checkPassword(password)) throw new HttpError(401, "Wrong password");
  await createSession();
  return json({ ok: true });
});
