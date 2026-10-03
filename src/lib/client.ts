"use client";
import { useEffect, useRef, useState } from "react";
import type { LiveEvent } from "./domain";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Thin fetch wrapper: JSON in/out, throws ApiError with the server's message. */
export async function api<T = unknown>(path: string, init?: Omit<RequestInit, "body"> & { body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}), ...init?.headers },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? res.statusText);
  return data as T;
}

/** Anonymous per-browser id, used so one device can only back a report once. */
export function clientId(): string {
  try {
    let id = localStorage.getItem("campus-cid");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("campus-cid", id);
    }
    return id;
  } catch {
    return `anon-${Math.random().toString(36).slice(2, 12)}`;
  }
}

/** Subscribes to the SSE stream while `url` is non-null. The browser reconnects automatically. */
export function useLiveEvents(url: string | null, onEvent: (e: LiveEvent) => void) {
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  });
  useEffect(() => {
    if (!url) return;
    const es = new EventSource(url);
    const forward = (ev: MessageEvent) => {
      try {
        handler.current(JSON.parse(ev.data) as LiveEvent);
      } catch {
        /* ignore malformed event */
      }
    };
    for (const t of ["created", "updated", "message", "alert"]) es.addEventListener(t, forward as EventListener);
    return () => es.close();
  }, [url]);
}

/** Re-renders every `ms` so countdowns stay live. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`;
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

/** Short two-tone siren for critical alerts (Web Audio; needs a prior user gesture to be allowed). */
let audio: AudioContext | undefined;
export function siren() {
  try {
    audio ??= new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.connect(gain);
    gain.connect(audio.destination);
    gain.gain.value = 0.12;
    const t = audio.currentTime;
    for (let k = 0; k < 6; k++) osc.frequency.setValueAtTime(k % 2 ? 660 : 880, t + k * 0.25);
    osc.start(t);
    osc.stop(t + 1.5);
  } catch {
    /* audio blocked - ignore */
  }
}

/** Browser notification, if the user granted permission. */
export function notify(body: string) {
  try {
    if ("Notification" in window && Notification.permission === "granted") new Notification("Campus Assist", { body });
  } catch {
    /* ignore */
  }
}
