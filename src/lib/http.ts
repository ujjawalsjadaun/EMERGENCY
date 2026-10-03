import "server-only";
import type { NextRequest } from "next/server";
import type { ZodType } from "zod";
import { isAdmin } from "./auth";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const json = (data: unknown, status = 200) => Response.json(data, { status });

/** Wraps a route handler: turns HttpError into JSON responses and hides unexpected errors. */
export function route<Ctx = unknown>(fn: (req: NextRequest, ctx: Ctx) => Promise<Response>) {
  return async (req: NextRequest, ctx: Ctx): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(`[api] ${req.method} ${req.nextUrl.pathname}`, err);
      return json({ error: "Internal server error" }, 500);
    }
  };
}

export async function parseBody<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new HttpError(400, `${issue.path.join(".") || "body"}: ${issue.message}`);
  }
  return result.data;
}

export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) throw new HttpError(401, "Unauthorized");
}

// ---- tiny in-memory fixed-window rate limiter (per process; fine for a single-node deployment) ----
const buckets = new Map<string, { count: number; reset: number }>();

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
}

export function rateLimit(req: NextRequest, name: string, limit: number, windowMs: number): void {
  const key = `${name}:${clientIp(req)}`;
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now > b.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    if (buckets.size > 5000) for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k);
    return;
  }
  if (++b.count > limit) throw new HttpError(429, "Too many requests - please slow down");
}
