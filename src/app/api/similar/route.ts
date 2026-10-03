import { z } from "zod";
import { CATEGORIES } from "@/lib/domain";
import { HttpError, json, route } from "@/lib/http";
import { similarIssues } from "@/lib/issues";

const query = z.object({
  x: z.coerce.number().min(0).max(100),
  y: z.coerce.number().min(0).max(70),
  category: z.enum(CATEGORIES).optional().catch(undefined),
});

export const GET = route(async (req) => {
  const parsed = query.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) throw new HttpError(400, "x and y are required");
  return json(await similarIssues(parsed.data.category ?? null, parsed.data.x, parsed.data.y));
});
