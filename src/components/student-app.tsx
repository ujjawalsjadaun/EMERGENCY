"use client";
import { CheckCircle2, Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ReportForm } from "./report-form";
import { SosButton } from "./sos-button";
import { Tracker } from "./tracker";
import { Button, Card, CardTitle, inputCls } from "./ui";

export function StudentApp() {
  const [trackId, setTrackId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const trackerRef = useRef<HTMLDivElement>(null);

  // Restore the last complaint (or ?id=...) so students land back on their live status.
  useEffect(() => {
    let id = new URLSearchParams(window.location.search).get("id");
    try {
      id ??= localStorage.getItem("campus-last-id");
    } catch {
      /* storage unavailable */
    }
    if (id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from URL/localStorage
      setTrackId(id.toUpperCase());
      setInput(id.toUpperCase());
    }
  }, []);

  const follow = useCallback((id: string, announce = false) => {
    setTrackId(id);
    setInput(id);
    if (announce) setSubmittedId(id);
    try {
      localStorage.setItem("campus-last-id", id);
    } catch {
      /* storage unavailable */
    }
    setTimeout(() => trackerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
  }, []);

  return (
    <main className="mx-auto grid max-w-3xl gap-6 px-4 pb-24 pt-8 sm:px-6">
      <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-balance text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl">
          Campus emergency? <span className="text-brand-gradient">Help is one tap away.</span>
        </h1>
        <p className="mt-3 max-w-xl text-lg text-muted">Report a problem in seconds, see exactly who is handling it, and chat with responders in real time.</p>
      </motion.section>

      <SosButton onCreated={(id) => follow(id)} />

      <AnimatePresence mode="wait">
        {submittedId ? (
          <motion.div key="done" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
            <Card className="text-center">
              <CheckCircle2 className="mx-auto size-12 text-low" />
              <h2 className="mt-2 text-2xl font-extrabold">Report submitted</h2>
              <p className="text-muted">Your complaint ID - save it to track progress any time:</p>
              <p className="my-2 font-mono text-3xl font-black tracking-wider text-brand">{submittedId}</p>
              <Button variant="ghost" onClick={() => setSubmittedId(null)}>
                File another report
              </Button>
            </Card>
          </motion.div>
        ) : (
          <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <ReportForm onCreated={(id) => follow(id, true)} onBackExisting={(id) => follow(id)} />
          </motion.div>
        )}
      </AnimatePresence>

      <div ref={trackerRef} className="scroll-mt-24">
        <Card>
          <CardTitle>Track a complaint</CardTitle>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const id = input.trim().toUpperCase();
              if (id) follow(id);
            }}
          >
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Complaint ID, e.g. CMP-261004-A1B2" className={`${inputCls} font-mono`} />
            <Button type="submit">
              <Search className="size-4" /> Track
            </Button>
          </form>
          {trackId && (
            <div className="mt-5">
              <Tracker id={trackId} />
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}
