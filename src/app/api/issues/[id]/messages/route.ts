import { isAdmin } from "@/lib/auth";
import { json, parseBody, rateLimit, route } from "@/lib/http";
import { addMessage } from "@/lib/issues";
import { messageSchema } from "@/lib/validation";

export const POST = route(async (req, ctx: RouteContext<"/api/issues/[id]/messages">) => {
  rateLimit(req, "message", 60, 10 * 60_000);
  const { id } = await ctx.params;
  const { text } = await parseBody(req, messageSchema);
  await addMessage(id, (await isAdmin()) ? "authority" : "student", text);
  return json({ ok: true }, 201);
});
