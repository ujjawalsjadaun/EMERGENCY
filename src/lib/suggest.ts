import type { Category, Priority } from "./domain";

/**
 * Rule-based "smart" categorisation: weighted keyword scoring, no external API.
 * Deterministic, offline and unit-tested - a deliberate choice over an ML dependency.
 */
const KEYWORDS: Record<Exclude<Category, "Other">, string> = {
  Medical:
    "injury injured blood bleeding faint fainted unconscious seizure fever sick ill pain chest breathing asthma allergy ambulance doctor medicine accident fracture burn vomit heart attack overdose",
  Electrical:
    "power electric electricity shock spark sparks short circuit wire wiring fan light bulb tubelight switch socket outage blackout voltage transformer lift elevator ac geyser",
  Infrastructure:
    "water leak leaking pipe broken crack ceiling roof wall road pothole toilet washroom drain sewage door window bench gate flood clogged damaged",
  Security:
    "theft stolen thief harass harassment ragging fight assault stalker stalking unsafe dark suspicious intruder weapon threat molest bully drunk fire",
  "Lost & Found":
    "lost found missing wallet phone laptop bag id card keys purse umbrella bottle charger earphones watch notebook",
};

const CRITICAL = new Set(
  "unconscious unresponsive seizure bleeding chest breathing fire spark sparks shock assault weapon overdose suicide trapped collapsed attack molest".split(" "),
);
const HIGH = new Set("injury injured accident fracture fever harassment ragging stolen theft flood leak unsafe threat fight burn".split(" "));

export interface Suggestion {
  category: Category;
  priority: Priority;
  confidence: number;
}

export function suggest(text: string): Suggestion {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const set = new Set(words);

  let best: Category = "Other";
  let bestScore = 0;
  for (const [cat, kws] of Object.entries(KEYWORDS) as [Exclude<Category, "Other">, string][]) {
    const score = kws.split(" ").filter((k) => set.has(k)).length;
    if (score > bestScore) [best, bestScore] = [cat, score];
  }

  let priority: Priority;
  if (words.some((w) => CRITICAL.has(w))) priority = "Critical";
  else if (best === "Lost & Found") priority = "Low";
  else if (words.some((w) => HIGH.has(w))) priority = "High";
  else if (best === "Other") priority = "Low";
  else priority = "Medium";

  return { category: best, priority, confidence: Math.min(1, 0.4 + 0.2 * bestScore) };
}
