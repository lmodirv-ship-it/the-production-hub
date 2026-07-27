/** Pure helpers for the auto-tour recorder (no React, no DOM ownership). */

export type TourStop = { path: string; seconds: number; enabled: boolean };

export const DEFAULT_SECONDS = 8;

export function normalizeUrl(raw: string) {
  const t = raw.trim();
  if (!t) return "";
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export function originOf(raw: string) {
  try {
    return new URL(normalizeUrl(raw)).origin;
  } catch {
    return "";
  }
}

export function fileNameFor(raw: string) {
  try {
    const h = new URL(normalizeUrl(raw)).hostname.replace(/^www\./, "");
    return `${h.replace(/[^a-z0-9]+/gi, "_")}.mp4`;
  } catch {
    return "video.mp4";
  }
}

export function fmt(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Slow start, slow end — reads like a human scrolling. */
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;

export function storageKey(url: string) {
  return `eco-tour:${originOf(url) || url}`;
}

export function loadStops(url: string): TourStop[] | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey(url));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TourStop[];
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch {
    return null;
  }
}

export function saveStops(url: string, stops: TourStop[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey(url), JSON.stringify(stops));
  } catch {
    /* quota or private mode — non fatal */
  }
}

/**
 * Animate a value from 0 to `distance` over `durationMs`.
 * Returns a cancel function; resolves when finished or cancelled.
 */
export function animateScroll(
  distance: number,
  durationMs: number,
  onFrame: (offset: number) => void,
): { done: Promise<void>; cancel: () => void } {
  let raf = 0;
  let cancelled = false;
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((r) => (resolveDone = r));
  const start = performance.now();

  const step = (now: number) => {
    if (cancelled) return resolveDone();
    const t = Math.min(1, (now - start) / Math.max(1, durationMs));
    onFrame(easeInOutSine(t) * distance);
    if (t < 1) raf = requestAnimationFrame(step);
    else resolveDone();
  };
  raf = requestAnimationFrame(step);

  return {
    done,
    cancel: () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      resolveDone();
    },
  };
}

/**
 * Cinematic scroll: splits the travel into segments with a short hold at the
 * end of each one, so the camera "reads" the page instead of sliding past it.
 */
export function animateScrollCinematic(
  distance: number,
  durationMs: number,
  segments: number,
  onFrame: (offset: number) => void,
): { done: Promise<void>; cancel: () => void } {
  const n = Math.max(1, Math.round(segments));
  const holdMs = 550;
  const moveTotal = Math.max(600, durationMs - holdMs * (n - 1));
  const moveEach = moveTotal / n;
  const cycle = moveEach + holdMs;

  let raf = 0;
  let cancelled = false;
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((r) => (resolveDone = r));
  const start = performance.now();
  const total = moveTotal + holdMs * (n - 1);

  const step = (now: number) => {
    if (cancelled) return resolveDone();
    const elapsed = now - start;
    const t = Math.min(1, elapsed / Math.max(1, total));
    const idx = Math.min(n - 1, Math.floor(elapsed / cycle));
    const inSeg = Math.min(moveEach, elapsed - idx * cycle);
    const segProgress = easeInOutSine(Math.max(0, inSeg) / moveEach);
    const value = ((idx + segProgress) / n) * distance;
    onFrame(Math.min(distance, value));
    if (t < 1) raf = requestAnimationFrame(step);
    else { onFrame(distance); resolveDone(); }
  };
  raf = requestAnimationFrame(step);

  return {
    done,
    cancel: () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      resolveDone();
    },
  };
}

export function totalDuration(stops: TourStop[]) {
  return stops.filter((s) => s.enabled).reduce((a, s) => a + s.seconds, 0);
}

export type QualityKey = "hd" | "fhd" | "ultra";

export const QUALITY: Record<QualityKey, {
  label: string; width: number; height: number; fps: number; videoBps: number;
}> = {
  hd: { label: "عادي 720p", width: 1280, height: 720, fps: 30, videoBps: 5_000_000 },
  fhd: { label: "عالي 1080p", width: 1920, height: 1080, fps: 60, videoBps: 12_000_000 },
  ultra: { label: "فائق 1440p", width: 2560, height: 1440, fps: 60, videoBps: 20_000_000 },
};

/** Decode an mp3 data blob just enough to know how long the narration runs. */
export function audioDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const a = new Audio();
    a.preload = "metadata";
    a.onloadedmetadata = () => resolve(Number.isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => resolve(0);
    a.src = url;
  });
}

export function base64ToBlobUrl(base64: string, mime: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

