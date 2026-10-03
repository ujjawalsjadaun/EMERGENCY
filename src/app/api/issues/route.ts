import { json, parseBody, rateLimit, requireAdmin, route } from "@/lib/http";
import { createIssue, listIssues } from "@/lib/issues";
import { createIssueSchema } from "@/lib/validation";

export const GET = route(async () => {
  await requireAdmin();
  return json(await listIssues());
});

export const POST = route(async (req) => {
  rateLimit(req, "report", 20, 10 * 60_000);
  const input = await parseBody(req, createIssueSchema);
  return json({ id: await createIssue(input) }, 201);
});
