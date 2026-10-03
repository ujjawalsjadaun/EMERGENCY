"use client";
import { Bell, BellOff, CheckCheck, Clock, ListChecks, Lock, LogOut, Pause, Play, Siren, Timer, TriangleAlert, Zap } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { api, mmss, notify, siren, timeAgo, useLiveEvents, useNow } from "@/lib/client";
import { CATEGORIES, CATEGORY_EMOJI, PRIORITIES, STATUSES, type Issue, type LiveEvent } from "@/lib/domain";
import type { Stats } from "@/lib/issues";
import { AnimatedNumber } from "./animated-number";
import { CampusMap } from "./campus-map";
import { Charts } from "./charts";
import { IssueDrawer } from "./issue-drawer";
import { Button, Card, CardTitle, Label, PriorityBadge, StatusBadge, cx, inputCls } from "./ui";

export function AdminApp() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => {
    api<{ admin: boolean }>("/api/logout")
      .then((r) => setAuthed(r.admin))
      .catch(() => setAuthed(false));
  }, []);

  if (authed === null) return <div className="mx-auto mt-24 h-40 max-w-sm animate-pulse rounded-2xl bg-line/60" />;
  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  return <Dashboard onLogout={() => setAuthed(false)} />;
}

// ---------------------------------------------------------------- login
function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/login", { method: "POST", body: { password } });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-sm px-4 pt-20">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <Card>
          <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-brand-gradient text-white shadow-lg">
            <Lock className="size-6" />
          </div>
          <h1 className="text-center text-2xl font-extrabold">Authority login</h1>
          <p className="mb-2 text-center text-sm text-muted">The password is printed in the server console at startup.</p>
          <form onSubmit={submit}>
            <Label>Password</Label>
            <input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} />
            <p className="mt-2 min-h-5 text-sm font-semibold text-critical">{error}</p>
            <Button type="submit" disabled={busy || !password} className="mt-1 w-full">
              Log in
            </Button>
          </form>
        </Card>
      </motion.div>
    </main>
  );
}

// ---------------------------------------------------------------- dashboard pieces
function SlaCell({ due }: { due: string }) {
  const now = useNow(1000);
  const left = (new Date(due).getTime() - now) / 1000;
  return <span className={cx("font-bold tabular-nums", left <= 0 && "blink text-critical")}>{left > 0 ? mmss(left) : "OVERDUE"}</span>;
}

function Kpi({ label, value, decimals = 0, suffix = "", icon: Icon, tone = "text-brand" }: { label: string; value: number | null; decimals?: number; suffix?: string; icon: typeof Zap; tone?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-2xl border border-line bg-card p-4 shadow-card">
      <span className="absolute inset-y-0 left-0 w-1 bg-brand-gradient" />
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted">{label}</p>
        <Icon className={cx("size-4", tone)} />
      </div>
      <p className="mt-1 text-3xl font-extrabold tracking-tight">{value == null ? "–" : <AnimatedNumber value={value} decimals={decimals} suffix={suffix} />}</p>
    </motion.div>
  );
}

// ---------------------------------------------------------------- dashboard
function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loadedAt, setLoadedAt] = useState(() => Date.now());
  const [selected, setSelected] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [filters, setFilters] = useState({ category: "", priority: "", status: "" });
  const [heat, setHeat] = useState(false);
  const [sirenOn, setSirenOn] = useState(true);
  const [replay, setReplay] = useState(1000); // 1000 = live
  const [playing, setPlaying] = useState(false);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const seen = useRef<Map<string, string>>(new Map());
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const now = useNow(30_000);

  const load = useCallback(async () => {
    try {
      const [list, st] = await Promise.all([api<Issue[]>("/api/issues"), api<Stats>("/api/stats")]);
      const changed = new Set<string>();
      for (const i of list) if (seen.current.size && seen.current.get(i.id) !== i.updatedAt) changed.add(i.id);
      seen.current = new Map(list.map((i) => [i.id, i.updatedAt]));
      setIssues(list);
      setStats(st);
      setLoadedAt(Date.now());
      setRefreshKey((k) => k + 1);
      if (changed.size) {
        setFlash(changed);
        setTimeout(() => setFlash(new Set()), 1900);
      }
    } catch (e) {
      if ((e as { status?: number }).status === 401) onLogout();
    }
  }, [onLogout]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch
    load();
  }, [load]);

  const onEvent = useCallback(
    (e: LiveEvent) => {
      clearTimeout(reloadTimer.current);
      reloadTimer.current = setTimeout(load, 250); // coalesce bursts of events
      if (e.type === "created") {
        const msg = `${e.sos ? "🆘 SOS" : `New ${e.priority} ${e.category}`} - ${e.text ?? ""}`;
        (e.priority === "Critical" ? toast.error : toast.warning)(msg);
        notify(msg);
        if (sirenOn && (e.sos || e.priority === "Critical")) siren();
      } else if (e.type === "alert") {
        toast.warning(`⏰ ${e.text}`);
        if (sirenOn && e.priority === "Critical") siren();
      } else if (e.type === "message" && e.text?.startsWith("Student")) {
        toast(`💬 ${e.id}: ${e.text}`);
      }
    },
    [load, sirenOn],
  );
  useLiveEvents("/api/events", onEvent);

  // Time-lapse replay of how incidents appeared and were resolved.
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setReplay((r) => {
        if (r >= 1000) {
          setPlaying(false);
          return 1000;
        }
        return Math.min(1000, r + 8);
      });
    }, 100);
    return () => clearInterval(t);
  }, [playing]);

  const filtered = useMemo(
    () => issues.filter((i) => (!filters.category || i.category === filters.category) && (!filters.priority || i.priority === filters.priority) && (!filters.status || i.status === filters.status)),
    [issues, filters],
  );

  const replayT = useMemo(() => {
    if (replay >= 1000) return null;
    const lo = Math.min(loadedAt - 3_600_000, ...issues.map((i) => new Date(i.createdAt).getTime()));
    return lo + ((loadedAt - lo) * replay) / 1000;
  }, [replay, issues, loadedAt]);

  const pins = useMemo(
    () =>
      issues.filter((i) =>
        replayT === null ? i.status !== "Resolved" : new Date(i.createdAt).getTime() <= replayT && (!i.resolvedAt || new Date(i.resolvedAt).getTime() > replayT),
      ),
    [issues, replayT],
  );

  const criticalOpen = issues.filter((i) => i.priority === "Critical" && i.status !== "Resolved").length;

  const logout = async () => {
    await api("/api/logout", { method: "POST" }).catch(() => undefined);
    onLogout();
  };

  return (
    <main className="mx-auto grid max-w-6xl gap-5 px-4 pb-24 pt-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Command Center</h1>
          <p className="flex items-center gap-2 text-sm text-muted">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-low opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-low" />
            </span>
            Live - updates appear instantly
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => (setSirenOn(!sirenOn), !sirenOn && siren())}>
            {sirenOn ? <Bell className="size-4" /> : <BellOff className="size-4" />} Siren {sirenOn ? "on" : "muted"}
          </Button>
          <Button variant="ghost" onClick={logout}>
            <LogOut className="size-4" /> Log out
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <Kpi label="Total" value={stats?.total ?? 0} icon={ListChecks} />
        <Kpi label="Open" value={stats?.open ?? 0} icon={Zap} tone="text-high" />
        <Kpi label="Critical open" value={criticalOpen} icon={TriangleAlert} tone="text-critical" />
        <Kpi label="SOS alerts" value={stats?.sos ?? 0} icon={Siren} tone="text-critical" />
        <Kpi label="Resolved" value={stats?.byStatus.Resolved ?? 0} icon={CheckCheck} tone="text-low" />
        <Kpi label="Avg response" value={stats?.avgResponseMinutes ?? null} decimals={1} suffix=" min" icon={Timer} />
        <Kpi label="Avg resolution" value={stats?.avgResolutionHours ?? null} decimals={1} suffix=" h" icon={Clock} />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card>
          <CardTitle
            right={
              <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-muted">
                <input type="checkbox" checked={heat} onChange={(e) => setHeat(e.target.checked)} className="size-4 accent-brand" /> Heatmap
              </label>
            }
          >
            Campus map
          </CardTitle>
          <CampusMap pins={pins} heat={heat} onPinClick={setSelected} />
          <div className="mt-3 flex items-center gap-3">
            <Button
              variant="ghost"
              className="px-3 py-2"
              aria-label={playing ? "Pause replay" : "Play replay"}
              onClick={() => {
                if (!playing && replay >= 1000) setReplay(0);
                setPlaying(!playing);
              }}
            >
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />} Replay
            </Button>
            <input
              type="range"
              min={0}
              max={1000}
              value={replay}
              onChange={(e) => {
                setPlaying(false);
                setReplay(+e.target.value);
              }}
              className="flex-1 accent-brand"
              aria-label="Replay position"
            />
            <span className="w-28 text-right text-xs text-muted">{replayT ? new Date(replayT).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "Live"}</span>
          </div>
        </Card>
        <Card>
          <CardTitle>Live analytics</CardTitle>
          {stats ? <Charts stats={stats} /> : <div className="h-72 animate-pulse rounded-xl bg-line/60" />}
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardTitle>Reported issues</CardTitle>
        <div className="grid gap-3 sm:grid-cols-3">
          <select className={inputCls} value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} aria-label="Filter by category">
            <option value="">All categories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_EMOJI[c]} {c}
              </option>
            ))}
          </select>
          <select className={inputCls} value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })} aria-label="Filter by priority">
            <option value="">All priorities</option>
            {PRIORITIES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <select className={inputCls} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} aria-label="Filter by status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="-mx-5 mt-4 overflow-x-auto sm:-mx-6">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-muted">
                {["ID", "Category", "Priority", "Status", "Response SLA", "Location", "👥", "Reported"].map((h) => (
                  <th key={h} className="border-b border-line px-3 py-2.5 font-bold first:pl-5 last:pr-5 sm:first:pl-6 sm:last:pr-6">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
                {filtered.map((i) => (
                  <motion.tr
                    key={i.id}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    onClick={() => setSelected(i.id)}
                    className={cx("cursor-pointer border-b border-line/70 transition-colors hover:bg-soft", i.sos && i.status !== "Resolved" && "bg-critical/10 shadow-[inset_4px_0_0_var(--color-critical)]", flash.has(i.id) && "flash-row")}
                  >
                    <td className="whitespace-nowrap px-3 py-3 pl-5 font-mono text-xs font-bold sm:pl-6">
                      {i.sos && "🚨 "}
                      {i.id}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      {CATEGORY_EMOJI[i.category]} {i.category}
                    </td>
                    <td className="px-3 py-3">
                      <PriorityBadge priority={i.priority} />
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge status={i.status} />
                    </td>
                    <td className="px-3 py-3">{i.slaDue ? <SlaCell due={i.slaDue} /> : <span className="text-muted">–</span>}</td>
                    <td className="max-w-48 truncate px-3 py-3">{i.location}</td>
                    <td className="px-3 py-3">{i.votes}</td>
                    <td className="whitespace-nowrap px-3 py-3 pr-5 text-muted sm:pr-6">{timeAgo(i.createdAt, now)}</td>
                  </motion.tr>
                ))}
              </AnimatePresence>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-10 text-center text-muted">
                    No issues match - all quiet 🎉
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <AnimatePresence>{selected && <IssueDrawer key={selected} id={selected} refreshKey={refreshKey} onClose={() => setSelected(null)} onSaved={load} />}</AnimatePresence>
    </main>
  );
}
