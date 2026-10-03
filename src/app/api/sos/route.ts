import { json, parseBody, rateLimit, route } from "@/lib/http";
import { createSos } from "@/lib/issues";
import { sosSchema } from "@/lib/validation";

export const POST = route(async (req) => {
  rateLimit(req, "sos", 10, 10 * 60_000);
  const input = await parseBody(req, sosSchema);
  return json({ id: await createSos(input) }, 201);
});
