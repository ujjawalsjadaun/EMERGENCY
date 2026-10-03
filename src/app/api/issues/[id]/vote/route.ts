import { json, parseBody, rateLimit, route } from "@/lib/http";
import { voteIssue } from "@/lib/issues";
import { voteSchema } from "@/lib/validation";

export const POST = route(async (req, ctx: RouteContext<"/api/issues/[id]/vote">) => {
  rateLimit(req, "vote", 30, 10 * 60_000);
  const { id } = await ctx.params;
  const { client } = await parseBody(req, voteSchema);
  return json(await voteIssue(id, client));
});
