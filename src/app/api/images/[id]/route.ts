import { HttpError, route } from "@/lib/http";
import { getImage } from "@/lib/issues";

export const GET = route(async (_req, ctx: RouteContext<"/api/images/[id]">) => {
  const { id } = await ctx.params;
  if (!/^[a-f0-9]{24}$/.test(id)) throw new HttpError(404, "Not found");
  const img = await getImage(id);
  if (!img) throw new HttpError(404, "Not found");
  return new Response(new Uint8Array(img.data), {
    headers: { "Content-Type": img.mime, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
  });
});
