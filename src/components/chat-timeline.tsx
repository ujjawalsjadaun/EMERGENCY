"use client";
import { Send } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { HistoryEntry, Message } from "@/lib/domain";
import { fmtDateTime, fmtTime } from "@/lib/client";
import { Button, cx, inputCls } from "./ui";

export function Chat({ messages, me, onSend, placeholder }: { messages: Message[]; me: "student" | "authority"; onSend: (text: string) => Promise<void>; placeholder: string }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      await onSend(t);
      setText("");
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <div ref={box} className="mb-3 grid max-h-64 gap-2 overflow-y-auto rounded-2xl bg-background/60 p-3">
        {messages.length === 0 && <p className="py-4 text-center text-sm text-muted">No messages yet - say hello 👋</p>}
        <AnimatePresence initial={false}>
          {messages.map((m, i) => (
            <motion.div
              key={`${m.at}-${i}`}
              initial={{ opacity: 0, y: 8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className={cx("max-w-[85%] rounded-2xl px-3.5 py-2 text-sm", m.from === me ? "justify-self-end rounded-br-sm bg-brand-gradient text-white" : "justify-self-start rounded-bl-sm border border-line bg-card")}
            >
              <span className={cx("mb-0.5 block text-[11px]", m.from === me ? "text-white/70" : "text-muted")}>
                {m.from === "authority" ? "🛡️ Responder" : "🙋 Student"} · {fmtTime(m.at)}
              </span>
              {m.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <div className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} maxLength={500} placeholder={placeholder} className={inputCls} />
        <Button onClick={send} disabled={sending || !text.trim()} aria-label="Send message" className="px-4">
          <Send className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function Timeline({ history }: { history: HistoryEntry[] }) {
  return (
    <ol className="relative ml-2 border-l-2 border-line pl-6">
      <AnimatePresence initial={false}>
        {[...history].reverse().map((h, i) => (
          <motion.li key={`${h.at}-${h.note}`} layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="relative pb-5 last:pb-0">
            <span className={cx("absolute -left-[33px] top-1 size-3 rounded-full border-[3px] border-card bg-brand-gradient", i === 0 && "ring-4 ring-brand/20")} />
            <p className="text-sm font-bold">
              {h.status}
              {h.kind === "system" && <span className="ml-2 rounded bg-high/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-high">auto</span>}
            </p>
            <p className="text-sm">{h.note}</p>
            <p className="text-xs text-muted">{fmtDateTime(h.at)}</p>
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  );
}
