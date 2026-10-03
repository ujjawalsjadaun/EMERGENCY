"use client";
import { Check, Siren } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/client";
import { Button, Card } from "./ui";

const HOLD_MS = 1500;
const FOLLOW_UPS = ["Medical emergency", "Fire / electrical danger", "I feel unsafe / being followed", "Someone else needs help"];

type Phase = "idle" | "holding" | "sending" | "sent";

function currentPosition(): Promise<string | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(`GPS ${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)}`),
      () => resolve(null),
      { timeout: 3500 },
    );
  });
}

/** Panic button: hold for 1.5s to send a Critical alert with GPS, no form needed. */
export function SosButton({ onCreated }: { onCreated: (id: string) => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [sentId, setSentId] = useState<string | null>(null);
  const [sentChips, setSentChips] = useState<string[]>([]);
  const raf = useRef(0);
  const busy = useRef(false);

  const fire = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setPhase("sending");
    navigator.vibrate?.(200);
    try {
      const gps = await currentPosition();
      const { id } = await api<{ id: string }>("/api/sos", { method: "POST", body: { location: gps ?? undefined } });
      setSentId(id);
      setPhase("sent");
      onCreated(id);
    } catch (e) {
      setPhase("idle");
      setProgress(0);
      busy.current = false;
      toast.error(`Could not send SOS: ${(e as Error).message}. Call campus security directly.`);
    }
  }, [onCreated]);

  const begin = () => {
    if (busy.current) return;
    setPhase("holding");
    const t0 = performance.now();
    const tick = () => {
      const p = Math.min(1, (performance.now() - t0) / HOLD_MS);
      setProgress(p);
      if (p >= 1) fire();
      else raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };
  const cancel = () => {
    if (busy.current) return;
    cancelAnimationFrame(raf.current);
    setPhase("idle");
    setProgress(0);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const sendFollowUp = async (text: string) => {
    if (!sentId) return;
    setSentChips((c) => [...c, text]);
    try {
      await api(`/api/issues/${sentId}/messages`, { method: "POST", body: { text } });
    } catch {
      toast.error("Could not send that detail");
    }
  };

  return (
    <Card className="relative overflow-hidden border-critical/25 bg-gradient-to-b from-critical/10 to-card text-center">
      <AnimatePresence mode="wait">
        {phase !== "sent" ? (
          <motion.div key="idle" exit={{ opacity: 0, scale: 0.95 }} className="flex flex-col items-center">
            <div className="relative my-3 grid place-items-center">
              {phase === "idle" && (
                <>
                  <span className="absolute size-44 animate-ping rounded-full bg-critical/20 [animation-duration:2.6s]" />
                  <span className="absolute size-56 rounded-full bg-critical/10" />
                </>
              )}
              <motion.button
                type="button"
                aria-label="Hold to send an SOS alert"
                onPointerDown={begin}
                onPointerUp={cancel}
                onPointerLeave={cancel}
                onPointerCancel={cancel}
                onContextMenu={(e) => e.preventDefault()}
                onKeyDown={(e) => (e.key === " " || e.key === "Enter") && !e.repeat && begin()}
                onKeyUp={(e) => (e.key === " " || e.key === "Enter") && cancel()}
                animate={{ scale: phase === "holding" ? 0.94 : 1 }}
                className="relative grid size-40 cursor-pointer touch-none select-none place-items-center rounded-full text-3xl font-black tracking-[0.2em] text-white shadow-[0_14px_40px_#e5383b77] outline-none focus-visible:ring-4 focus-visible:ring-critical/40"
                style={{ background: "radial-gradient(circle at 50% 30%, #ff7a70, #d4160c 70%)" }}
              >
                <span className="sos-ring absolute -inset-3 rounded-full" style={{ ["--p" as string]: `${progress * 100}%` }} />
                {phase === "sending" ? <span className="size-7 animate-spin rounded-full border-4 border-white/40 border-t-white" /> : "SOS"}
              </motion.button>
            </div>
            <p className="font-semibold">Press and hold for 1.5 seconds to alert responders instantly</p>
            <p className="mt-1 max-w-md text-sm text-muted">Sends a Critical alert with your location. No form needed - you can add details afterwards.</p>
          </motion.div>
        ) : (
          <motion.div key="sent" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="py-2">
            <div className="mx-auto mb-3 grid size-14 place-items-center rounded-full bg-critical text-white">
              <Siren className="size-7" />
            </div>
            <h2 className="flex items-center justify-center gap-2 text-xl font-extrabold">
              <Check className="size-5 text-low" /> SOS sent - help is being alerted
            </h2>
            <p className="mt-1 font-mono text-lg font-bold text-brand">{sentId}</p>
            <p className="mt-2 text-sm text-muted">Stay where you are if it is safe. Tell responders what is happening:</p>
            <div className="mx-auto mt-3 flex max-w-xl flex-wrap justify-center gap-2">
              {FOLLOW_UPS.map((t) => (
                <Button key={t} variant="ghost" disabled={sentChips.includes(t)} onClick={() => sendFollowUp(t)} className="text-xs">
                  {sentChips.includes(t) ? "✓ " : ""}
                  {t}
                </Button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
