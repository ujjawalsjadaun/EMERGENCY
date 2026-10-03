import type { LiveEvent } from "@/lib/domain";
import { requireAdmin, route } from "@/lib/http";
import { subscribe } from "@/lib/realtime";

export const dynamic = "force-dynamic";

/**
 * Server-Sent Events stream. `?id=CMP-...` follows one complaint (public); without an id the stream
 * carries every event and requires an authority session.
 */
export const GET = route(async (req) => {
  const id = req.nextUrl.searchParams.get("id")?.toUpperCase() ?? null;
  if (!id) await requireAdmin();

  const enc = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream({
    async start(controller) {
      const write = (s: string) => {
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          cleanup();
        }
      };
      const send = (e: LiveEvent) => write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      write(": connected\n\n");
      const unsubscribe = await subscribe({ issueId: id, send });
      const ping = setInterval(() => write(": ping\n\n"), 15_000);
      cleanup = () => {
        clearInterval(ping);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
});
