"use client";
import { ImagePlus, Mic, Send, Sparkles, Users } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { api, clientId } from "@/lib/client";
import { CATEGORIES, CATEGORY_EMOJI, PRIORITIES, nearestZone, type Category, type Priority, type Status } from "@/lib/domain";
import type { Suggestion } from "@/lib/suggest";
import { CampusMap } from "./campus-map";
import { Button, Card, CardTitle, Label, PriorityBadge, StatusBadge, cx, inputCls } from "./ui";

interface SimilarIssue {
  id: string;
  category: Category;
  description: string;
  status: Status;
  votes: number;
}

// Minimal typing for the (still prefixed) Web Speech API.
interface SpeechRec {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type SpeechCtor = new () => SpeechRec;

/** Downscale to <=1280px and re-encode as JPEG so uploads stay small. */
function shrinkImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => reject(new Error("Could not read that image"));
    img.src = URL.createObjectURL(file);
  });
}

export function ReportForm({ onCreated, onBackExisting }: { onCreated: (id: string) => void; onBackExisting: (id: string) => void }) {
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<Category | null>(null);
  const [priority, setPriority] = useState<Priority | null>(null);
  const [picked, setPicked] = useState<{ x: number; y: number } | null>(null);
  const [location, setLocation] = useState("");
  const [reporter, setReporter] = useState("");
  const [contact, setContact] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [similar, setSimilar] = useState<SimilarIssue[]>([]);
  const [listening, setListening] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const touched = useRef({ category: false, priority: false });
  const recognition = useRef<SpeechRec | null>(null);
  // Browser-only capability: false on the server / first render, then the real value.
  const speechOk = useSyncExternalStore(
    () => () => {},
    () => {
      const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
      return Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition);
    },
    () => false,
  );

  // Debounced auto-categorisation while the student types.
  useEffect(() => {
    if (description.trim().length < 8) return;
    const t = setTimeout(async () => {
      try {
        const s = await api<Suggestion>("/api/suggest", { method: "POST", body: { description } });
        setSuggestion(s);
        if (!touched.current.category) setCategory(s.category);
        if (!touched.current.priority) setPriority(s.priority);
      } catch {
        /* suggestions are optional */
      }
    }, 450);
    return () => clearTimeout(t);
  }, [description]);

  // Duplicate detection: is there already an open report nearby?
  useEffect(() => {
    if (!picked) return;
    let cancelled = false;
    const params = new URLSearchParams({ x: String(picked.x), y: String(picked.y), ...(category ? { category } : {}) });
    api<SimilarIssue[]>(`/api/similar?${params}`)
      .then((list) => !cancelled && setSimilar(list))
      .catch(() => !cancelled && setSimilar([]));
    return () => {
      cancelled = true;
    };
  }, [picked, category]);

  const pick = (x: number, y: number) => {
    setPicked({ x, y });
    setLocation(`${nearestZone(x, y).name} (near)`);
  };

  const toggleVoice = () => {
    if (listening) return recognition.current?.stop();
    const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-IN";
    rec.interimResults = false;
    rec.onresult = (e) => setDescription((d) => `${d}${d ? " " : ""}${e.results[0][0].transcript}`);
    rec.onend = () => setListening(false);
    recognition.current = rec;
    setListening(true);
    rec.start();
  };

  const backExisting = async (id: string) => {
    try {
      const r = await api<{ already: boolean }>(`/api/issues/${id}/vote`, { method: "POST", body: { client: clientId() } });
      toast.success(r.already ? "You already backed this report" : `Thanks - your report was added to ${id}`);
      onBackExisting(id);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!category || !priority) return toast.error("Please choose a category and priority");
    setSubmitting(true);
    try {
      const { id } = await api<{ id: string }>("/api/issues", {
        method: "POST",
        body: { category, priority, description, location, x: picked?.x, y: picked?.y, reporter, contact, image: image ?? undefined },
      });
      onCreated(id);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardTitle>Report a problem</CardTitle>
      <form onSubmit={submit}>
        <div className="flex items-center justify-between">
          <Label>Describe what happened</Label>
          {speechOk && (
            <button
              type="button"
              onClick={toggleVoice}
              className={cx("mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition", listening ? "blink border-critical bg-critical text-white" : "border-line text-muted hover:border-brand hover:text-brand")}
            >
              <Mic className="size-3.5" /> {listening ? "Listening…" : "Dictate"}
            </button>
          )}
        </div>
        <textarea required minLength={5} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Student fainted near the library, not responding" className={cx(inputCls, "min-h-28 resize-y")} />

        <AnimatePresence>
          {suggestion && (
            <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mt-2.5 flex items-center gap-2 overflow-hidden rounded-xl border border-brand/20 bg-soft px-3.5 py-2 text-sm">
              <Sparkles className="size-4 shrink-0 text-brand" />
              <span>
                Suggested: <b>{CATEGORY_EMOJI[suggestion.category]} {suggestion.category}</b> · <b>{suggestion.priority}</b> priority - change it below if needed.
              </span>
            </motion.p>
          )}
        </AnimatePresence>

        <Label>Category</Label>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {CATEGORIES.map((c) => (
            <motion.button
              type="button"
              key={c}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => {
                touched.current.category = true;
                setCategory(c);
              }}
              className={cx("cursor-pointer rounded-2xl border-[1.5px] px-2 py-3 text-sm font-semibold transition-colors", category === c ? "border-brand bg-soft ring-4 ring-brand/10" : "border-line bg-background hover:border-brand/50")}
            >
              <span className="mb-0.5 block text-2xl">{CATEGORY_EMOJI[c]}</span>
              {c}
            </motion.button>
          ))}
        </div>

        <Label>Priority</Label>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {PRIORITIES.map((p) => (
            <motion.button
              type="button"
              key={p}
              whileTap={{ scale: 0.96 }}
              onClick={() => {
                touched.current.priority = true;
                setPriority(p);
              }}
              className={cx("cursor-pointer rounded-2xl border-[1.5px] py-3 transition-colors", priority === p ? "border-brand bg-soft ring-4 ring-brand/10" : "border-line bg-background hover:border-brand/50")}
            >
              <PriorityBadge priority={p} />
            </motion.button>
          ))}
        </div>

        <Label>Location - tap the map or type it</Label>
        <CampusMap onPick={pick} picked={picked} />
        <input required value={location} onChange={(e) => setLocation(e.target.value)} maxLength={200} placeholder="e.g. Hostel A, 2nd floor corridor" className={cx(inputCls, "mt-2.5")} />

        <AnimatePresence>
          {similar.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-3 rounded-2xl border-[1.5px] border-dashed border-high bg-high/5 p-3.5">
              <p className="flex items-center gap-2 text-sm font-bold">
                <Users className="size-4 text-high" /> Already reported nearby?
              </p>
              <p className="mb-2 text-xs text-muted">Add your voice instead of a duplicate - more reports raise the priority.</p>
              {similar.map((s) => (
                <div key={s.id} className="flex items-center gap-3 border-t border-line py-2 first:border-0">
                  <span className="flex-1 text-sm">
                    {CATEGORY_EMOJI[s.category]} {s.description}
                    <span className="ml-2 inline-flex items-center gap-1.5 align-middle">
                      <StatusBadge status={s.status} />
                      <span className="text-xs text-muted">👥 {s.votes}</span>
                    </span>
                  </span>
                  <Button type="button" variant="ghost" className="px-3 py-1.5 text-xs" onClick={() => backExisting(s.id)}>
                    Me too
                  </Button>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid gap-x-4 sm:grid-cols-2">
          <div>
            <Label>Your name (optional)</Label>
            <input value={reporter} onChange={(e) => setReporter(e.target.value)} maxLength={80} className={inputCls} />
          </div>
          <div>
            <Label>Phone / email (optional)</Label>
            <input value={contact} onChange={(e) => setContact(e.target.value)} maxLength={80} className={inputCls} />
          </div>
        </div>

        <Label>Photo (optional)</Label>
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border-[1.5px] border-dashed border-line bg-background px-4 py-3 text-sm text-muted transition hover:border-brand hover:text-brand">
          <ImagePlus className="size-5" />
          {image ? "Photo attached - tap to change" : "Add a photo of the problem"}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return setImage(null);
              try {
                setImage(await shrinkImage(f));
              } catch (err) {
                toast.error((err as Error).message);
              }
            }}
          />
        </label>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {image && <img src={image} alt="Attached preview" className="mt-3 max-h-60 rounded-2xl shadow-card" />}

        <Button type="submit" disabled={submitting} className="mt-6 w-full py-3 text-base">
          {submitting ? <span className="size-5 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <Send className="size-4" />}
          Submit report
        </Button>
      </form>
    </Card>
  );
}
