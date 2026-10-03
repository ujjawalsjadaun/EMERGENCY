import { isAdmin } from "@/lib/auth";
import { HttpError, json, parseBody, requireAdmin, route } from "@/lib/http";
import { getIssue, updateIssue } from "@/lib/issues";
import { patchIssueSchema } from "@/lib/validation";

// Students can read any complaint whose id they know (private fields stripped); authorities see everything.
export const GET = route(async (_req, ctx: RouteContext<"/api/issues/[id]">) => {
  const { id } = await ctx.params;
  const issue = await getIssue(id, await isAdmin());
  if (!issue) throw new HttpError(404, "No complaint found with that ID");
  return json(issue);
});

export const PATCH = route(async (req, ctx: RouteContext<"/api/issues/[id]">) => {
  await requireAdmin();
  const { id } = await ctx.params;
  return json(await updateIssue(id, await parseBody(req, patchIssueSchema)));
});
