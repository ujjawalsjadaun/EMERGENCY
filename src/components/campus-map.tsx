"use client";
import { motion } from "motion/react";
import type { MouseEvent } from "react";
import { ZONES, type Category, type Priority, type Status } from "@/lib/domain";

export interface MapPin {
  id?: string;
  x: number | null;
  y: number | null;
  priority: Priority;
  sos?: boolean;
  category?: Category;
  status?: Status;
}

const COLOR: Record<Priority, string> = { Low: "#16a37a", Medium: "#e0a100", High: "#ee6c1a", Critical: "#e5383b" };
const HEAT_RADIUS: Record<Priority, number> = { Low: 4, Medium: 6, High: 8, Critical: 11 };

interface Props {
  pins?: MapPin[];
  heat?: boolean;
  /** Called with map coordinates (0-100, 0-70) when the user taps the map. */
  onPick?: (x: number, y: number) => void;
  picked?: { x: number; y: number } | null;
  onPinClick?: (id: string) => void;
  className?: string;
}

/** Schematic campus map. Pure SVG so it works offline and themes with the rest of the app. */
export function CampusMap({ pins = [], heat = false, onPick, picked, onPinClick, className }: Props) {
  const handleClick = (e: MouseEvent<SVGSVGElement>) => {
    if (!onPick) return;
    const r = e.currentTarget.getBoundingClientRect();
    onPick(+(((e.clientX - r.left) / r.width) * 100).toFixed(1), +(((e.clientY - r.top) / r.height) * 70).toFixed(1));
  };

  return (
    <svg
      viewBox="0 0 100 70"
      onClick={handleClick}
      className={`h-auto w-full overflow-hidden rounded-xl border-[1.5px] border-line ${onPick ? "cursor-crosshair" : ""} ${className ?? ""}`}
      role="img"
      aria-label="Campus map"
    >
      <defs>
        <radialGradient id="heat">
          <stop offset="0" stopColor="#e5383b" stopOpacity="0.45" />
          <stop offset="1" stopColor="#e5383b" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="100" height="70" className="map-bg" />
      <path d="M50 70V0M0 36H100" className="map-road" strokeWidth="2.5" fill="none" />
      {ZONES.map((z) => (
        <g key={z.name}>
          <rect x={z.x - z.w / 2} y={z.y - z.h / 2} width={z.w} height={z.h} rx="1.5" className="map-zone" />
          <text x={z.x} y={z.y + 0.8} fontSize="2.2" textAnchor="middle" className="map-zone-text">
            {z.name}
          </text>
        </g>
      ))}

      {pins
        .filter((p) => p.x != null && p.y != null)
        .map((p, i) =>
          heat ? (
            <circle key={p.id ?? i} cx={p.x!} cy={p.y!} r={HEAT_RADIUS[p.priority]} fill="url(#heat)" />
          ) : (
            <g key={p.id ?? i} onClick={p.id && onPinClick ? () => onPinClick(p.id!) : undefined} className={p.id && onPinClick ? "cursor-pointer" : ""}>
              {(p.sos || p.priority === "Critical") && (
                <circle cx={p.x!} cy={p.y!} r="1.7" fill="none" stroke={COLOR.Critical} strokeWidth="0.4">
                  <animate attributeName="r" values="1.7;6" dur="1.4s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="1;0" dur="1.4s" repeatCount="indefinite" />
                </circle>
              )}
              <motion.circle
                cx={p.x!}
                cy={p.y!}
                r="1.7"
                fill={COLOR[p.priority]}
                stroke="var(--card)"
                strokeWidth="0.5"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                style={{ transformOrigin: `${p.x}px ${p.y}px`, transformBox: "view-box" }}
                transition={{ type: "spring", stiffness: 400, damping: 18 }}
              >
                <title>{[p.id, p.category, p.status].filter(Boolean).join(" · ")}</title>
              </motion.circle>
            </g>
          ),
        )}

      {picked && (
        <motion.g initial={{ y: -6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 300, damping: 14 }}>
          <path
            d={`M${picked.x} ${picked.y} c-2.6 -3.2 -3.4 -4.4 -3.4 -6 a3.4 3.4 0 1 1 6.8 0 c0 1.6 -0.8 2.8 -3.4 6z`}
            fill="#5b5bf0"
            stroke="#fff"
            strokeWidth="0.5"
          />
          <circle cx={picked.x} cy={picked.y - 6} r="1.2" fill="#fff" />
        </motion.g>
      )}
    </svg>
  );
}
