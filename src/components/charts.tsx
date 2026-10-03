"use client";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CATEGORIES, CATEGORY_EMOJI, type Category } from "@/lib/domain";
import type { Stats } from "@/lib/issues";

const CATEGORY_COLOR: Record<Category, string> = {
  Medical: "#e5383b",
  Electrical: "#f5a524",
  Infrastructure: "#3e63dd",
  Security: "#8b5cf6",
  "Lost & Found": "#16a37a",
  Other: "#8b8d98",
};

const tooltipStyle = { background: "var(--card)", border: "1px solid var(--line)", borderRadius: 12, color: "var(--foreground)", fontSize: 12 };
const axis = { stroke: "var(--muted)", fontSize: 11, tickLine: false, axisLine: false } as const;

function Panel({ title, children, height = 170 }: { title: string; children: React.ReactNode; height?: number }) {
  return (
    <div>
      <p className="mb-1 text-xs font-bold uppercase tracking-wider text-muted">{title}</p>
      <div style={{ height }}>{children}</div>
    </div>
  );
}

export function Charts({ stats }: { stats: Stats }) {
  const byCategory = CATEGORIES.map((c) => ({ name: `${CATEGORY_EMOJI[c]} ${c}`, key: c, value: stats.byCategory[c] })).filter((d) => d.value > 0);
  const resolution = CATEGORIES.filter((c) => stats.avgResolutionByCategory[c] != null).map((c) => ({ name: c, hours: stats.avgResolutionByCategory[c] }));

  return (
    <div className="grid gap-5">
      <Panel title="Reports by category">
        {byCategory.length === 0 ? (
          <Empty />
        ) : (
          <ResponsiveContainer>
            <PieChart>
              <Pie data={byCategory} dataKey="value" nameKey="name" innerRadius="52%" outerRadius="82%" paddingAngle={3} stroke="none" isAnimationActive>
                {byCategory.map((d) => (
                  <Cell key={d.key} fill={CATEGORY_COLOR[d.key]} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </Panel>
      <Panel title="Reports per day" height={140}>
        <ResponsiveContainer>
          <AreaChart data={stats.perDay} margin={{ left: -24, right: 6, top: 6 }}>
            <defs>
              <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7c7cff" stopOpacity={0.5} />
                <stop offset="100%" stopColor="#7c7cff" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis dataKey="day" {...axis} />
            <YAxis allowDecimals={false} {...axis} />
            <Tooltip contentStyle={tooltipStyle} />
            <Area type="monotone" dataKey="count" name="Reports" stroke="#7c7cff" strokeWidth={2.5} fill="url(#area)" />
          </AreaChart>
        </ResponsiveContainer>
      </Panel>
      <Panel title="Avg hours to resolve" height={140}>
        {resolution.length === 0 ? (
          <Empty text="Resolve an issue to see this" />
        ) : (
          <ResponsiveContainer>
            <BarChart data={resolution} margin={{ left: -24, right: 6, top: 6 }}>
              <CartesianGrid stroke="var(--line)" vertical={false} />
              <XAxis dataKey="name" {...axis} />
              <YAxis {...axis} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--soft)" }} />
              <Bar dataKey="hours" name="Hours" fill="#16a37a" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Panel>
    </div>
  );
}

function Empty({ text = "No data yet" }: { text?: string }) {
  return <div className="grid h-full place-items-center rounded-xl border border-dashed border-line text-sm text-muted">{text}</div>;
}
