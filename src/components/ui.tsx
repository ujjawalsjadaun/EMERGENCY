"use client";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import type { Priority, Status } from "@/lib/domain";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("rounded-2xl border border-line bg-card p-5 shadow-card transition-shadow hover:shadow-lift sm:p-6", className)} {...p} />;
}

export function CardTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-lg font-bold tracking-tight">{children}</h2>
      {right}
    </div>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" };
export function Button({ variant = "primary", className, ...p }: BtnProps) {
  const styles = {
    primary: "bg-brand-gradient text-white shadow-[0_4px_14px_#5b5bf044] hover:brightness-110",
    ghost: "border border-brand/40 text-brand hover:bg-soft",
    danger: "bg-critical text-white hover:brightness-110",
  }[variant];
  return (
    <button
      className={cx(
        "inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50",
        styles,
        className,
      )}
      {...p}
    />
  );
}

export const inputCls =
  "w-full rounded-xl border-[1.5px] border-line bg-background px-3.5 py-2.5 text-sm outline-none transition placeholder:text-muted/70 focus:border-brand focus:ring-4 focus:ring-brand/15";

export function Label({ children }: { children: ReactNode }) {
  return <label className="mb-1.5 mt-4 block text-xs font-bold uppercase tracking-wider text-muted">{children}</label>;
}

const PRIORITY_BG: Record<Priority, string> = { Low: "bg-low", Medium: "bg-medium", High: "bg-high", Critical: "bg-critical badge-critical" };
export function PriorityBadge({ priority }: { priority: Priority }) {
  return <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold text-white", PRIORITY_BG[priority])}>{priority}</span>;
}

const STATUS_BG: Record<Status, string> = { Reported: "bg-[#7b84a6]", Assigned: "bg-brand2", "In Progress": "bg-[#3b82f6]", Resolved: "bg-low" };
export function StatusBadge({ status }: { status: Status }) {
  return <span className={cx("inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold text-white", STATUS_BG[status])}>{status}</span>;
}
