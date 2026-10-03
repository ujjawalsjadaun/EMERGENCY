"use client";
import { Clock, Users } from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ApiError, api, mmss, notify, useLiveEvents, useNow, fmtDateTime } from "@/lib/client";
import { CATEGORY_EMOJI, STATUSES, type Issue } from "@/lib/domain";
import { Chat, Timeline } from "./chat-timeline";
import { PriorityBadge, StatusBadge, cx } from "./ui";

async function celebrate() {
  const { default: confetti } = await import("canvas-confetti");
  confetti({ particleCount: 150, spread: 85, origin: { y: 0.7 } });
}

/** Live view of one complaint: progress, SLA countdown, timeline and chat. Updates over SSE. */
export function Tracker({ id }: { id: string }) {
  const [issue, setIssue] = useState<Issue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prev = useRef<Issue | null>(null);
  const now = useNow(500);

  const load = useCallback(async () => {
    try {
      const next = await api<Issue>(`/api/issues/${encodeURIComponent(id)}`);
      const old = prev.current;
      if (old && old.id === next.id) {
        if (next.status !== old.status) {
          toast.info(`${next.id} is now: ${next.status}`);
          notify(`${next.id} is now: ${next.status}`);
          if (next.status === "Resolved") celebrate();
        } else if (next.priority !== old.priority) toast.warning(`${next.id} priority is now ${next.priority}`);
        else if ((next.messages?.length ?? 0) > (old.messages?.length ?? 0) && next.messages?.at(-1)?.from === "authority") toast("💬 New message from responders");
      }
      prev.current = next;
      setIssue(next);
      setError(null);
    } catch (e) {
      setIssue(null);
      setError(e instanceof ApiError ? e.message : "Could not load this complaint");
    }
  }, [id]);

  useEffect(() => {
    prev.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on id change
    load();
  }, [load]);
  useLiveEvents(`/api/events?id=${encodeURIComponent(id)}`, () => load());

  if (error) return <p className="rounded-xl bg-critical/10 px-4 py-3 text-sm font-semibold text-critical">{error}</p>;
  if (!issue) return <div className="h-40 animate-pulse rounded-2xl bg-line/60" />;

  const step = STATUSES.indexOf(issue.status);
  const slaLeft = issue.slaDue ? (new Date(issue.slaDue).getTime() - now) / 1000 : null;

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-mono text-lg font-bold">
          {issue.id} {issue.sos && "🚨"}
        </h3>
        <div className="flex gap-2">
          <PriorityBadge priority={issue.priority} />
          <StatusBadge status={issue.status} />
        </div>
      </div>

      <div className="my-5 flex gap-1.5">
        {STATUSES.map((s, i) => (
          <div key={s} className="flex-1 text-center">
            <p className={cx("mb-1.5 text-xs font-bold transition-colors", i <= step ? "text-brand" : "text-muted")}>{s}</p>
            <div className="h-1.5 overflow-hidden rounded-full bg-line">
              <motion.div className="h-full rounded-full bg-brand-gradient" initial={{ width: 0 }} animate={{ width: i <= step ? "100%" : 0 }} transition={{ duration: 0.6, delay: i * 0.12 }} />
            </div>
          </div>
        ))}
      </div>

      {slaLeft !== null && (
        <p className="mb-4 flex items-center gap-2 rounded-xl border border-brand/20 bg-soft px-3.5 py-2.5 text-sm">
          <Clock className="size-4 shrink-0 text-brand" />
          <span>
            Responders must acknowledge within{" "}
            <b className={cx("tabular-nums", slaLeft <= 0 && "blink text-critical")}>{slaLeft > 0 ? mmss(slaLeft) : "any moment now"}</b> - otherwise this is escalated automatically.
          </span>
        </p>
      )}

      <p className="font-semibold">
        {CATEGORY_EMOJI[issue.category]} {issue.category} <span className="font-normal text-muted">at {issue.location}</span>
      </p>
      <p className="mt-1">{issue.description}</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {issue.image && <img src={issue.image} alt="Attached by the reporter" className="mt-3 max-h-64 rounded-2xl shadow-card" />}
      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
        <span className="inline-flex items-center gap-1.5">
          <Users className="size-4" /> {issue.votes} report{issue.votes > 1 ? "s" : ""}
        </span>
        <span>Handled by: {issue.assignee ?? issue.department}</span>
        <span>Updated {fmtDateTime(issue.updatedAt)}</span>
      </p>

      <h4 className="mb-2 mt-6 font-bold">💬 Chat with responders</h4>
      <Chat
        messages={issue.messages ?? []}
        me="student"
        placeholder="Send an update or ask a question…"
        onSend={async (text) => {
          await api(`/api/issues/${issue.id}/messages`, { method: "POST", body: { text } });
          await load();
        }}
      />

      <h4 className="mb-3 mt-6 font-bold">Timeline</h4>
      <Timeline history={issue.history ?? []} />
    </motion.div>
  );
}
