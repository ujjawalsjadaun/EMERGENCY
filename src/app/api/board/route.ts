import { json, route } from "@/lib/http";
import { boardData } from "@/lib/issues";

export const GET = route(async () => json(await boardData()));
