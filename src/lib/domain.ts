/** Shared domain model: constants, types and pure helpers used by both server and client. */

export const CATEGORIES = ["Medical", "Electrical", "Infrastructure", "Security", "Lost & Found", "Other"] as const;
export const PRIORITIES = ["Low", "Medium", "High", "Critical"] as const;
export const STATUSES = ["Reported", "Assigned", "In Progress", "Resolved"] as const;
export const DEPARTMENTS = [
  "Medical Center",
  "Electrical Dept",
  "Maintenance",
  "Campus Security",
  "Hostel Warden",
  "Student Affairs",
] as const;

export type Category = (typeof CATEGORIES)[number];
export type Priority = (typeof PRIORITIES)[number];
export type Status = (typeof STATUSES)[number];
export type Department = (typeof DEPARTMENTS)[number];

export const CATEGORY_EMOJI: Record<Category, string> = {
  Medical: "🚑",
  Electrical: "⚡",
  Infrastructure: "🔧",
  Security: "🔐",
  "Lost & Found": "🎒",
  Other: "🆘",
};

export const DEFAULT_DEPARTMENT: Record<Category, Department> = {
  Medical: "Medical Center",
  Electrical: "Electrical Dept",
  Infrastructure: "Maintenance",
  Security: "Campus Security",
  "Lost & Found": "Student Affairs",
  Other: "Student Affairs",
};

/** Minutes a report may sit as "Reported" before it is auto-escalated. */
export const SLA_MINUTES: Record<Priority, number> = { Critical: 5, High: 30, Medium: 120, Low: 480 };

/** Votes (people reporting the same problem) at which priority is raised one level. */
export const VOTE_ESCALATION_THRESHOLDS = [3, 6];

export function nextPriority(p: Priority): Priority {
  return PRIORITIES[Math.min(PRIORITIES.indexOf(p) + 1, PRIORITIES.length - 1)];
}

export interface HistoryEntry {
  at: string;
  status: Status;
  note: string;
  kind: "created" | "update" | "system";
}

export interface Message {
  at: string;
  from: "student" | "authority";
  text: string;
}

/** The shape returned by the API. Private fields (reporter, contact) are only present for admins. */
export interface Issue {
  id: string;
  category: Category;
  priority: Priority;
  status: Status;
  description: string;
  location: string;
  x: number | null;
  y: number | null;
  image: string | null;
  sos: boolean;
  votes: number;
  assignee: string | null;
  department: Department;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  /** ISO deadline for responders to acknowledge; null once the issue has left "Reported". */
  slaDue: string | null;
  reporter?: string | null;
  contact?: string | null;
  history?: HistoryEntry[];
  messages?: Message[];
}

// ---- Campus map (schematic; viewBox 0 0 100 70) ----
export interface Zone {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const ZONES: Zone[] = [
  { name: "Main Gate", x: 50, y: 64, w: 14, h: 8 },
  { name: "Admin Block", x: 50, y: 48, w: 16, h: 10 },
  { name: "Academic Block", x: 22, y: 42, w: 22, h: 14 },
  { name: "Library", x: 50, y: 26, w: 16, h: 10 },
  { name: "Medical Center", x: 80, y: 46, w: 15, h: 9 },
  { name: "Hostel A", x: 18, y: 14, w: 18, h: 11 },
  { name: "Hostel B", x: 80, y: 14, w: 18, h: 11 },
  { name: "Canteen", x: 78, y: 30, w: 14, h: 8 },
  { name: "Sports Ground", x: 20, y: 60, w: 24, h: 12 },
];

export function nearestZone(x: number, y: number): Zone {
  return ZONES.reduce((best, z) => (Math.hypot(z.x - x, z.y - y) < Math.hypot(best.x - x, best.y - y) ? z : best));
}

export const PRIORITY_WEIGHT: Record<Priority, number> = { Low: 1, Medium: 3, High: 6, Critical: 12 };

/** 0-100 "campus safety pulse": starts at 100 and drops with the weighted number of open issues. */
export function safetyScore(open: { priority: Priority }[]): number {
  const load = open.reduce((sum, i) => sum + PRIORITY_WEIGHT[i.priority], 0);
  return Math.max(0, Math.round(100 - load * 2));
}

// ---- Live-event payloads (sent over SSE) ----
export interface LiveEvent {
  type: "created" | "updated" | "message" | "alert";
  id: string;
  priority?: Priority;
  category?: Category;
  status?: Status;
  sos?: boolean;
  /** Human-readable text; only delivered to authorities. */
  text?: string;
}
