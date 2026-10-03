import { json, requireAdmin, route } from "@/lib/http";
import { stats } from "@/lib/issues";

export const GET = route(async () => {
  await requireAdmin();
  return json(await stats());
});
