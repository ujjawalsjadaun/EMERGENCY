"use client";
import { CheckCircle2, Hourglass, Radio } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { api, timeAgo, useNow } from "@/lib/client";
import { CATEGORY_EMOJI, PRIORITY_WEIGHT, nearestZone, safetyScore, type Status } from "@/lib/domain";
import type { BoardData } from "@/lib/issues";
import { AnimatedNumber } from "./animated-number";
import { CampusMap } from "./campus-map";
import { Card, CardTitle } from "./ui";

const VERB: Record<Status, string> = { Reported: "reported", Assigned: "assigned to a team", "In Progress": "being handled", Resolved: "resolved ✅" };

function PulseGauge({ score }: { score: number }) {
  const color = score > 75 ? "#16a37a" : score > 45 ? "#e0a100" : "#e5383b";
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid size-24 shrink-0 place-items-center">
      <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--line)" strokeWidth="9" />
        <motion.circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - score / 100) }} transition={{ duration: 1, ease: "easeOut" }} />
      </svg>
      <span className="text-2xl font-black" style={{ color }}>
        <AnimatedNumber value={score} />
      </span>
    </div>
  );
}

/** Public, anonymous live board: no descriptions, names or free-text locations. Polls every 4 seconds. */
export function BoardApp() {
  const [data, setData] = useState<BoardData | null>(null);
  const [heat, setHeat] = useState(true);
  const [updated, setUpdated] = useState<number | null>(null);
  const now = useNow(1000);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const d = await api<BoardData>("/api/board");
        if (alive) {
          setData(d);
          setUpdated(Date.now());
        }
      } catch {
        /* keep the last good data */
      }
    };
    poll();
    const t = setInterval(poll, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const score = data ? safetyScore(data.open) : 100;
  const hotspots = useMemo(() => {
    const zones = new Map<string, number>();
    for (const i of data?.open ?? []) {
      if (i.x == null || i.y == null) continue;
      const name = nearestZone(i.x, i.y).name;
      zones.set(name, (zones.get(name) ?? 0) + PRIORITY_WEIGHT[i.priority]);
    }
    return [...zones.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [data]);
  const maxHot = Math.max(1, ...hotspots.map(([, v]) => v));

  return (
    <main className="mx-auto grid max-w-6xl gap-5 px-4 pb-24 pt-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">
            <span className="text-brand-gradient">Campus Pulse</span>
          </h1>
          <p className="text-muted">A live, anonymous view of what is happening on campus right now.</p>
        </div>
        <p className="flex items-center gap-2 text-sm text-muted">
          <Radio className="size-4 text-low" /> {updated ? `Updated ${Math.max(0, Math.round((now - updated) / 1000))}s ago` : "Connecting…"}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="flex items-center gap-4 p-4 sm:p-4">
          <PulseGauge score={score} />
          <div>
            <p className="font-bold leading-tight">Safety pulse</p>
            <p className="text-sm text-muted">{score > 75 ? "Calm" : score > 45 ? "Busy" : "Under pressure"}</p>
          </div>
        </Card>
        {[
          { label: "Open issues", value: data?.open.length ?? 0, icon: Hourglass, tone: "text-high", suffix: "" },
          { label: "Resolved (24h)", value: data?.resolvedToday ?? 0, icon: CheckCircle2, tone: "text-low", suffix: "" },
          { label: "Avg first response", value: data?.avgResponseMinutes ?? null, icon: Radio, tone: "text-brand", suffix: " min" },
        ].map((k) => (
          <Card key={k.label} className="p-4 sm:p-4">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted">{k.label}</p>
              <k.icon className={`size-4 ${k.tone}`} />
            </div>
            <p className="mt-2 text-4xl font-extrabold tracking-tight">{k.value == null ? "–" : <AnimatedNumber value={k.value} decimals={k.suffix ? 1 : 0} suffix={k.suffix} />}</p>
          </Card>
        ))}
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardTitle
            right={
              <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-muted">
                <input type="checkbox" checked={heat} onChange={(e) => setHeat(e.target.checked)} className="size-4 accent-brand" /> Heatmap
              </label>
            }
          >
            Live map
          </CardTitle>
          <CampusMap pins={data?.open ?? []} heat={heat} />
        </Card>
        <Card className="lg:col-span-2">
          <CardTitle>Hotspots</CardTitle>
          <div className="grid gap-3">
            {hotspots.length === 0 && <p className="text-sm text-muted">All quiet 🎉</p>}
            {hotspots.map(([name, v]) => (
              <div key={name}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-semibold">{name}</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-line">
                  <motion.div className="h-full rounded-full bg-gradient-to-r from-high to-critical" initial={{ width: 0 }} animate={{ width: `${(v / maxHot) * 100}%` }} transition={{ duration: 0.7 }} />
                </div>
              </div>
            ))}
          </div>
          <h2 className="mb-2 mt-7 text-lg font-bold tracking-tight">Live activity</h2>
          <ul className="grid">
            <AnimatePresence initial={false}>
              {(data?.ticker ?? []).map((t) => (
                <motion.li key={`${t.at}-${t.status}-${t.category}`} layout initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} className="border-b border-line py-2 text-sm last:border-0">
                  {CATEGORY_EMOJI[t.category]} {t.category} issue {VERB[t.status]} <span className="text-muted">· {timeAgo(t.at, now)}</span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </Card>
      </div>
      <p className="text-center text-sm text-muted">Anonymous public view - no descriptions, names or exact locations are shown.</p>
    </main>
  );
}
