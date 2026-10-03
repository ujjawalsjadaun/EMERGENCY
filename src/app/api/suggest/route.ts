import { json, parseBody, route } from "@/lib/http";
import { suggest } from "@/lib/suggest";
import { suggestSchema } from "@/lib/validation";

export const POST = route(async (req) => json(suggest((await parseBody(req, suggestSchema)).description)));
