"use client";
import { X } from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/client";
import { CATEGORY_EMOJI, DEPARTMENTS, PRIORITIES, STATUSES, type Department, type Issue, type Priority, type Status } from "@/lib/domain";
import { Chat, Timeline } from "./chat-timeline";
import { Button, Label, PriorityBadge, StatusBadge, inputCls } from "./ui";

interface Props {
  id: string;
  /** Bumped by the dashboard whenever a live event arrives, so the drawer re-fetches. */
  refreshKey: number;
  onClose: () => void;
  onSaved: () => void;
}

/** Slide-over panel where an authority triages one issue: status, priority, assignment, notes and chat. */
export function IssueDrawer({ id, refreshKey, onClose, onSaved }: Props) {
  const [issue, setIssue] = useState<Issue | null>(null);
  const [status, setStatus] = useState<Status>("Reported");
  const [priority, setPriority] = useState<Priority>("Medium");
  const [department, setDepartment] = useState<Department>(DEPARTMENTS[0]);
  const [assignee, setAssignee] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const sync = useCallback((i: Issue) => {
    setIssue(i);
    setStatus(i.status);
    setPriority(i.priority);
    setDepartment(i.department);
    setAssignee(i.assignee ?? "");
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<Issue>(`/api/issues/${id}`)
      .then((i) => {
        if (cancelled) return;
        // Live refreshes update chat/timeline but must not overwrite what the authority is editing.
        if (dirty) setIssue(i);
        else sync(i);
      })
      .catch((e) => toast.error((e as Error).message));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `dirty` intentionally read, not a trigger
  }, [id, refreshKey, sync]);

  const touch = <T,>(set: (v: T) => void) => (v: T) => {
    setDirty(true);
    set(v);
  };

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api<Issue>(`/api/issues/${id}`, { method: "PATCH", body: { status, priority, department, assignee: assignee || null, note: note || undefined } });
      setNote("");
      setDirty(false);
      sync(updated);
      toast.success(`Updated ${id}`);
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <motion.div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.aside
        role="dialog"
        aria-label={`Issue ${id}`}
        className="fixed inset-y-0 right-0 z-50 w-full max-w-xl overflow-y-auto border-l border-line bg-card p-6 shadow-lift"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 36 }}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-sm font-bold text-brand">{id}</p>
            {issue && (
              <h2 className="mt-1 text-xl font-extrabold">
                {issue.sos && "🚨 "}
                {CATEGORY_EMOJI[issue.category]} {issue.category}
              </h2>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" className="grid size-9 cursor-pointer place-items-center rounded-full text-muted hover:bg-soft hover:text-foreground">
            <X className="size-5" />
          </button>
        </div>

        {!issue ? (
          <div className="h-48 animate-pulse rounded-2xl bg-line/60" />
        ) : (
          <>
            <div className="mb-3 flex gap-2">
              <PriorityBadge priority={issue.priority} />
              <StatusBadge status={issue.status} />
            </div>
            <p>{issue.description}</p>
            <p className="mt-2 text-sm text-muted">
              📍 {issue.location} · Reporter: {issue.reporter || "anonymous"} {issue.contact} · 👥 {issue.votes} report{issue.votes > 1 ? "s" : ""}
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {issue.image && <img src={issue.image} alt="Attached by the reporter" className="mt-3 max-h-64 rounded-2xl shadow-card" />}

            <div className="mt-5 grid gap-x-4 sm:grid-cols-2">
              <div>
                <Label>Status</Label>
                <select className={inputCls} value={status} onChange={(e) => touch(setStatus)(e.target.value as Status)}>
                  {STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Priority</Label>
                <select className={inputCls} value={priority} onChange={(e) => touch(setPriority)(e.target.value as Priority)}>
                  {PRIORITIES.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Department</Label>
                <select className={inputCls} value={department} onChange={(e) => touch(setDepartment)(e.target.value as Department)}>
                  {DEPARTMENTS.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Assign to person</Label>
                <input className={inputCls} value={assignee} placeholder="Name" maxLength={80} onChange={(e) => touch(setAssignee)(e.target.value)} />
              </div>
            </div>
            <Label>Note on timeline (visible to the student)</Label>
            <input className={inputCls} value={note} maxLength={300} placeholder="e.g. Ambulance dispatched, ETA 5 min" onChange={(e) => touch(setNote)(e.target.value)} />
            <Button onClick={save} disabled={saving} className="mt-4 w-full">
              {saving ? "Saving…" : "Save update"}
            </Button>

            <h4 className="mb-2 mt-7 font-bold">💬 Chat with student</h4>
            <Chat
              messages={issue.messages ?? []}
              me="authority"
              placeholder="Message the student…"
              onSend={async (text) => {
                await api(`/api/issues/${id}/messages`, { method: "POST", body: { text } });
              }}
            />

            <h4 className="mb-3 mt-7 font-bold">Timeline</h4>
            <Timeline history={issue.history ?? []} />
          </>
        )}
      </motion.aside>
    </>
  );
}
