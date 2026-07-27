import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  Sparkles,
  Video,
  Loader2,
  ExternalLink,
  FolderOpen,
  FileText,
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  Volume2,
} from "lucide-react";
import { SITES } from "@/data/sites";
import { discoverPages } from "@/lib/pages.functions";
import { generateLongNarration, synthesizeSpeech } from "@/lib/narration.functions";
import { startCompositor } from "@/lib/compositor";
import {
  QUALITY,
  animateScrollCinematic,
  audioDuration,
  base64ToBlobUrl,
  ensureTotalSeconds,
  fmt,
  normalizeUrl,
  originOf,
  sleep,
  type QualityKey,
  type TourStop,
} from "@/lib/tour";
import {
  MIN_VIDEO_SECONDS,
  buildDescriptionFile,
  buildSrt,
  safeFileBase,
  timeCaptions,
  wordsForSeconds,
  type TimedCaption,
} from "@/lib/script";
import {
  currentFolderName,
  pickFolder,
  restoreFolder,
  saveFile,
  supportsFolderSave,
} from "@/lib/fs-save";

const search = z.object({ url: z.string().optional() }).partial();

export const Route = createFileRoute("/studio")({
  validateSearch: (s) => search.parse(s),
  head: () => ({
    meta: [
      { title: "استوديو الجولات — Eco AI" },
      {
        name: "description",
        content:
          "سجّل فيديو تعريفياً لكل موقع من مواقعك دفعة واحدة، مع تعليق صوتي ونص مدمج وملف MP4 جاهز ليوتيوب.",
      },
      { property: "og:title", content: "استوديو الجولات — Eco AI" },
      {
        property: "og:description",
        content: "طابور تسجيل تلقائي لمواقعك مع تعليق صوتي ونص أسفل الفيديو.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StudioPage,
});

const BASE_W = 1280;
const BASE_H = 720;

const VOICES = [
  { id: "alloy", label: "هادئ" },
  { id: "verse", label: "حيوي" },
  { id: "sage", label: "رصين" },
  { id: "coral", label: "دافئ" },
];

const DURATIONS = [
  { s: MIN_VIDEO_SECONDS, label: "٣:١٥ دقيقة" },
  { s: 240, label: "٤ دقائق" },
  { s: 300, label: "٥ دقائق" },
];

type QueueStatus = "pending" | "running" | "done" | "failed";
type QueueItem = {
  url: string;
  name: string;
  description: string;
  status: QueueStatus;
  note?: string;
};
type Clip = { url: string; seconds: number };

function StudioPage() {
  const sp = useSearch({ from: "/studio" });

  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    sp.url ? { [sp.url]: true } : {},
  );
  const [extra, setExtra] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [current, setCurrent] = useState(-1);

  const [quality, setQuality] = useState<QualityKey>("fhd");
  const [voice, setVoice] = useState("alloy");
  const [target, setTarget] = useState(MIN_VIDEO_SECONDS);
  const [depth] = useState(3);
  const [folder, setFolder] = useState("");

  const [running, setRunning] = useState(false);
  const [textOnly, setTextOnly] = useState(false);
  const [message, setMessage] = useState("اختر مواقعك من القائمة ثم اضغط «ابدأ التسجيل المتواصل».");
  const [seconds, setSeconds] = useState(0);
  const [caption, setCaption] = useState("");
  const [stageLabel, setStageLabel] = useState("");

  const [frameSrc, setFrameSrc] = useState("");
  const [offset, setOffset] = useState(0);
  const [fade, setFade] = useState(false);
  const [scale, setScale] = useState(1);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const narrationElRef = useRef<HTMLAudioElement | null>(null);
  const displayRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mediaSrcRef = useRef<MediaElementAudioSourceNode | null>(null);
  const narrationTracksRef = useRef<MediaStreamTrack[]>([]);
  const clipsRef = useRef<Record<string, Clip>>({});
  const timerRef = useRef<number | null>(null);
  const captionTimersRef = useRef<number[]>([]);
  const cancelScrollRef = useRef<() => void>(() => {});
  const abortRef = useRef(false);
  const compositorRef = useRef<ReturnType<typeof startCompositor> | null>(null);

  const tall = BASE_H * depth;

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / BASE_W));
    ro.observe(el);
    setScale(el.clientWidth / BASE_W);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (supportsFolderSave()) void restoreFolder().then((n) => n && setFolder(n));
    return () => {
      displayRef.current?.getTracks().forEach((t) => t.stop());
      if (timerRef.current) window.clearInterval(timerRef.current);
      Object.values(clipsRef.current).forEach((c) => URL.revokeObjectURL(c.url));
      void audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  /* ---------------- selection ---------------- */

  const list = SITES.filter(
    (s) => !filter.trim() || (s.name + s.description).includes(filter.trim()),
  );
  const selectedCount = Object.values(selected).filter(Boolean).length;

  function buildQueue(): QueueItem[] {
    const picked = SITES.filter((s) => selected[s.url]).map((s) => ({
      url: s.url,
      name: s.name,
      description: s.description,
      status: "pending" as QueueStatus,
    }));
    const manual = extra
      .split(/[\n,]/)
      .map((v) => normalizeUrl(v.trim()))
      .filter(Boolean)
      .filter((u) => !picked.some((p) => p.url === u))
      .map((u) => ({
        url: u,
        name: safeFileBase(u),
        description: "",
        status: "pending" as QueueStatus,
      }));
    return [...picked, ...manual];
  }

  /* ---------------- narration helpers ---------------- */

  async function planSite(item: QueueItem) {
    setMessage(`اكتشاف صفحات ${item.name}…`);
    let paths: string[] = ["/"];
    try {
      const res = await discoverPages({ data: { url: item.url } });
      if (res.paths.length) paths = res.paths.slice(0, 12);
    } catch {
      /* single page tour */
    }

    setMessage(`كتابة النص (${wordsForSeconds(target)} كلمة) لـ ${item.name}…`);
    const narration = await generateLongNarration({
      data: {
        url: item.url,
        paths,
        totalWords: wordsForSeconds(target),
        description: item.description || undefined,
      },
    });

    Object.values(clipsRef.current).forEach((c) => URL.revokeObjectURL(c.url));
    clipsRef.current = {};

    const stops: TourStop[] = [];
    for (let i = 0; i < narration.items.length; i++) {
      if (abortRef.current) break;
      const it = narration.items[i];
      setMessage(`توليد الصوت ${i + 1}/${narration.items.length} — ${item.name}`);
      let secs = Math.max(12, Math.ceil(it.text.length / 14));
      try {
        const { audio, mime } = await synthesizeSpeech({
          data: { text: it.text.slice(0, 1900), voice },
        });
        const url = base64ToBlobUrl(audio, mime);
        const dur = await audioDuration(url);
        if (dur > 0) {
          clipsRef.current[it.path] = { url, seconds: dur };
          secs = Math.ceil(dur) + 3;
        }
      } catch (e) {
        console.error(e);
      }
      stops.push({ path: it.path, seconds: secs, enabled: true });
    }

    return { stops: ensureTotalSeconds(stops, target), scripts: narration.items };
  }

  function clearCaptionTimers() {
    captionTimersRef.current.forEach((t) => window.clearTimeout(t));
    captionTimersRef.current = [];
  }

  function scheduleCaptions(
    text: string,
    duration: number,
    offsetSec: number,
    sink: TimedCaption[],
  ) {
    const timed = timeCaptions(text, 0, duration);
    timed.forEach((c) => {
      sink.push({ text: c.text, start: c.start + offsetSec, end: c.end + offsetSec });
      captionTimersRef.current.push(
        window.setTimeout(() => {
          compositorRef.current?.setCaption(c.text);
          setCaption(c.text);
        }, c.start * 1000),
      );
    });
    captionTimersRef.current.push(
      window.setTimeout(() => {
        compositorRef.current?.setCaption("");
        setCaption("");
      }, duration * 1000),
    );
  }

  function playClip(path: string) {
    const clip = clipsRef.current[path];
    const el = narrationElRef.current;
    if (!clip || !el) return;
    el.src = clip.url;
    el.currentTime = 0;
    void el.play().catch(() => {});
  }

  function ensureNarrationTracks() {
    if (narrationTracksRef.current.length) return narrationTracksRef.current;
    const el = narrationElRef.current;
    if (!el) return [];
    try {
      const ctx = audioCtxRef.current ?? new AudioContext();
      audioCtxRef.current = ctx;
      void ctx.resume().catch(() => {});
      const dest = ctx.createMediaStreamDestination();
      if (!mediaSrcRef.current) mediaSrcRef.current = ctx.createMediaElementSource(el);
      mediaSrcRef.current.connect(dest);
      narrationTracksRef.current = dest.stream.getAudioTracks();
    } catch (e) {
      console.error("audio mix failed", e);
    }
    return narrationTracksRef.current;
  }

  /* ---------------- mp4 ---------------- */

  const convertToMp4 = useCallback(async (blob: Blob): Promise<Blob> => {
    setMessage("جاري التحويل إلى MP4…");
    try {
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const { fetchFile, toBlobURL } = await import("@ffmpeg/util");
      const ffmpeg = new FFmpeg();
      const base = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";
      await ffmpeg.load({
        coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
      });
      await ffmpeg.writeFile("in.webm", await fetchFile(blob));
      await ffmpeg.exec([
        "-i",
        "in.webm",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "19",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        "out.mp4",
      ]);
      const data = await ffmpeg.readFile("out.mp4");
      const u8 = data as Uint8Array;
      return new Blob(
        [u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer],
        { type: "video/mp4" },
      );
    } catch (err) {
      console.error("ffmpeg convert failed", err);
      toast.error("تعذّر التحويل إلى MP4 — سيُحفظ الملف كما هو.");
      return blob;
    }
  }, []);

  /* ---------------- tour ---------------- */

  async function runTour(
    item: QueueItem,
    stops: TourStop[],
    scripts: { path: string; text: string }[],
  ) {
    const origin = originOf(item.url);
    const captions: TimedCaption[] = [];
    let elapsed = 0;

    for (let i = 0; i < stops.length; i++) {
      if (abortRef.current) break;
      const stop = stops[i];
      setStageLabel(`${item.name} · ${i + 1}/${stops.length}`);
      compositorRef.current?.setBadge(`${item.name} — ${stop.path}`);
      setFade(true);
      setOffset(0);
      setFrameSrc(`${origin}${stop.path}`);
      await Promise.race([
        new Promise<void>((r) => {
          const el = iframeRef.current;
          if (!el) return r();
          const on = () => {
            el.removeEventListener("load", on);
            r();
          };
          el.addEventListener("load", on);
        }),
        sleep(7000),
      ]);
      if (abortRef.current) break;
      setFade(false);
      await sleep(500);

      const text = scripts.find((s) => s.path === stop.path)?.text ?? "";
      playClip(stop.path);
      if (text) scheduleCaptions(text, stop.seconds, elapsed, captions);

      const scrollMs = Math.max(2500, stop.seconds * 1000 - 2200);
      const segments = Math.max(3, Math.round(stop.seconds / 7));
      const anim = animateScrollCinematic(tall - BASE_H, scrollMs, segments, setOffset);
      cancelScrollRef.current = anim.cancel;
      await anim.done;
      if (abortRef.current) break;
      await sleep(900);
      elapsed += stop.seconds;
      setFade(true);
      await sleep(400);
    }
    clearCaptionTimers();
    compositorRef.current?.setCaption("");
    setCaption("");
    return captions;
  }

  /* ---------------- one site ---------------- */

  async function recordOne(item: QueueItem) {
    const { stops, scripts } = await planSite(item);
    if (abortRef.current) throw new Error("aborted");

    const q = QUALITY[quality];
    const comp = startCompositor(displayRef.current!, q.width, q.height, q.fps);
    compositorRef.current = comp;

    const tracks: MediaStreamTrack[] = [
      ...comp.stream.getVideoTracks(),
      ...ensureNarrationTracks(),
    ];
    const candidates = [
      "video/mp4;codecs=avc1,mp4a.40.2",
      "video/mp4",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    const mime = candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";
    const rec = new MediaRecorder(new MediaStream(tracks), {
      mimeType: mime,
      videoBitsPerSecond: q.videoBps,
      audioBitsPerSecond: 192_000,
    });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    const stopped = new Promise<void>((r) => {
      rec.onstop = () => r();
    });

    setSeconds(0);
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    setMessage(`جارٍ تصوير ${item.name} — لا تلمس شيئاً.`);
    rec.start(1000);

    let captions: TimedCaption[] = [];
    try {
      captions = await runTour(item, stops, scripts);
    } finally {
      await sleep(600);
      if (rec.state !== "inactive") rec.stop();
      await stopped;
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      comp.stop();
      compositorRef.current = null;
      narrationElRef.current?.pause();
    }

    const raw = new Blob(chunks, { type: mime.split(";")[0] || "video/webm" });
    const finalBlob = mime.startsWith("video/mp4") ? raw : await convertToMp4(raw);
    const base = safeFileBase(item.url);
    const ext = finalBlob.type === "video/mp4" ? "mp4" : "webm";
    const fullScript = scripts.map((s) => s.text).join("\n\n");
    const total = stops.reduce((a, s) => a + s.seconds, 0);

    setMessage(`حفظ ملفات ${item.name}…`);
    const where = await saveFile(finalBlob, `${base}.${ext}`);
    await saveFile(
      buildDescriptionFile({ name: item.name, url: item.url, seconds: total, script: fullScript }),
      `${base}.txt`,
    );
    if (captions.length) await saveFile(buildSrt(captions), `${base}.srt`);
    return where;
  }

  /* ---------------- queue ---------------- */

  async function startQueue() {
    const items = buildQueue();
    if (!items.length) {
      toast.error("اختر موقعاً واحداً على الأقل.");
      return;
    }
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
      toast.error("متصفحك لا يدعم التسجيل. استخدم Chrome أو Edge على الحاسوب.");
      return;
    }

    setQueue(items);
    abortRef.current = false;
    setRunning(true);
    setMessage("اختر «هذا التبويب» في نافذة المشاركة — مرة واحدة فقط لكل المواقع.");

    const q = QUALITY[quality];
    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: q.fps, max: q.fps },
          width: { ideal: q.width },
          height: { ideal: q.height },
          displaySurface: "browser",
        },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: "include",
        surfaceSwitching: "exclude",
      } as DisplayMediaStreamOptions);
    } catch (err) {
      console.error(err);
      setRunning(false);
      setMessage("تم إلغاء المشاركة. اضغط «ابدأ» للمحاولة مجدداً.");
      return;
    }
    displayRef.current = display;
    const vt = display.getVideoTracks()[0];
    try {
      vt.contentHint = "detail";
      await vt.applyConstraints({
        frameRate: { ideal: q.fps },
        width: { ideal: q.width },
        height: { ideal: q.height },
      });
    } catch {
      /* browser picks its best */
    }
    vt.addEventListener("ended", () => {
      abortRef.current = true;
    });

    if (stageRef.current) {
      try {
        await stageRef.current.requestFullscreen();
      } catch {
        /* windowed is fine */
      }
      await sleep(500);
    }

    for (let i = 0; i < items.length; i++) {
      if (abortRef.current) break;
      setCurrent(i);
      setQueue((prev) => prev.map((p, j) => (j === i ? { ...p, status: "running" } : p)));
      try {
        const where = await recordOne(items[i]);
        setQueue((prev) =>
          prev.map((p, j) =>
            j === i
              ? {
                  ...p,
                  status: "done",
                  note: where === "folder" ? "حُفظ في المجلد" : "نزل للتنزيلات",
                }
              : p,
          ),
        );
      } catch (e) {
        console.error(e);
        setQueue((prev) =>
          prev.map((p, j) => (j === i ? { ...p, status: "failed", note: "تعذّر التسجيل" } : p)),
        );
      }
      await sleep(800);
    }

    display.getTracks().forEach((t) => t.stop());
    displayRef.current = null;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    setRunning(false);
    setCurrent(-1);
    setFrameSrc("");
    setMessage(
      abortRef.current ? "تم إيقاف الطابور." : "اكتمل الطابور — كل الفيديوهات والنصوص جاهزة.",
    );
    if (!abortRef.current) toast.success("اكتملت كل الفيديوهات.");
  }

  function stopQueue() {
    abortRef.current = true;
    cancelScrollRef.current();
    clearCaptionTimers();
    narrationElRef.current?.pause();
  }

  /* ---------------- text only ---------------- */

  async function generateTextsOnly() {
    const items = buildQueue();
    if (!items.length) {
      toast.error("اختر أو ألصق موقعاً واحداً على الأقل.");
      return;
    }
    setTextOnly(true);
    setQueue(items);
    try {
      for (let i = 0; i < items.length; i++) {
        setCurrent(i);
        setQueue((prev) => prev.map((p, j) => (j === i ? { ...p, status: "running" } : p)));
        setMessage(`كتابة نص ${items[i].name}…`);
        try {
          let paths = ["/"];
          try {
            const res = await discoverPages({ data: { url: items[i].url } });
            if (res.paths.length) paths = res.paths.slice(0, 12);
          } catch {
            /* single page */
          }
          const n = await generateLongNarration({
            data: {
              url: items[i].url,
              paths,
              totalWords: wordsForSeconds(target),
              description: items[i].description || undefined,
            },
          });
          const base = safeFileBase(items[i].url);
          await saveFile(
            buildDescriptionFile({
              name: items[i].name,
              url: items[i].url,
              seconds: target,
              script: n.items.map((x) => x.text).join("\n\n"),
            }),
            `${base}.txt`,
          );
          setQueue((prev) =>
            prev.map((p, j) => (j === i ? { ...p, status: "done", note: "نص جاهز" } : p)),
          );
        } catch (e) {
          console.error(e);
          setQueue((prev) =>
            prev.map((p, j) => (j === i ? { ...p, status: "failed", note: "تعذّر التوليد" } : p)),
          );
        }
      }
      setMessage("تم توليد كل النصوص.");
    } finally {
      setTextOnly(false);
      setCurrent(-1);
    }
  }

  /* ---------------- folder ---------------- */

  async function chooseFolder() {
    try {
      const n = await pickFolder();
      setFolder(n);
      toast.success(`سيتم الحفظ في مجلد ${n}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "تعذّر اختيار المجلد.");
    }
  }

  const busy = running || textOnly;

  return (
    <main className="min-h-screen grid-bg">
      <audio ref={narrationElRef} className="hidden" />

      <header className="mx-auto flex w-[92%] items-center justify-between py-4">
        <Link to="/" className="flex items-center gap-2 hover:opacity-80">
          <div className="size-9 rounded-xl bg-gradient-hero grid place-items-center glow-primary">
            <Sparkles className="size-5 text-primary-foreground" />
          </div>
          <span className="text-lg font-bold">Eco AI</span>
        </Link>
        <span className="text-xs text-muted-foreground">طابور تسجيل → MP4 + نص</span>
      </header>

      <section className="mx-auto w-[92%] pb-16">
        {/* stage — 90% of the screen */}
        <div
          ref={stageRef}
          className={`relative mx-auto overflow-hidden bg-black ${
            running
              ? "fixed inset-0 z-50 w-screen rounded-none"
              : "w-[90vw] max-w-[1600px] rounded-2xl border border-border aspect-video"
          }`}
        >
          <div ref={shellRef} className="relative h-full w-full overflow-hidden">
            <div
              className="absolute left-0 top-0 origin-top-left overflow-hidden transition-opacity duration-500"
              style={{
                width: BASE_W,
                height: BASE_H,
                transform: `scale(${scale})`,
                opacity: fade ? 0 : 1,
              }}
            >
              {frameSrc ? (
                <iframe
                  ref={iframeRef}
                  src={frameSrc}
                  title="tour"
                  className="border-0"
                  style={{ width: BASE_W, height: tall, transform: `translateY(${-offset}px)` }}
                />
              ) : null}
            </div>
          </div>

          {caption && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-6 text-center">
              <p className="mx-auto max-w-[86%] text-lg font-semibold leading-8 text-white drop-shadow">
                {caption}
              </p>
            </div>
          )}

          {!frameSrc && !busy && (
            <div className="absolute inset-0 grid place-items-center text-center px-6">
              <div className="text-sm text-muted-foreground">
                <Video className="mx-auto mb-3 size-8 opacity-50" />
                ستُعرض هنا جولة كل موقع أثناء التصوير.
              </div>
            </div>
          )}

          {running && (
            <div className="absolute top-3 right-3 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-xs text-white">
              <span className="size-2 animate-pulse rounded-full bg-red-500" />
              {fmt(seconds)} · {stageLabel}
            </div>
          )}
        </div>

        {running && (
          <button
            onClick={stopQueue}
            className="fixed bottom-4 left-4 z-[60] rounded-full bg-destructive/90 px-4 py-2 text-xs text-destructive-foreground opacity-25 hover:opacity-100"
          >
            إيقاف الطابور
          </button>
        )}

        <p className="mt-3 text-center text-sm text-muted-foreground">{message}</p>

        {/* controls */}
        {!running && (
          <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="rounded-2xl border border-border bg-card/40 p-4">
              <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:flex-wrap">
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-card/60 px-3">
                  <Search className="size-3.5 shrink-0 text-muted-foreground" />
                  <input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="ابحث في مواقعك…"
                    className="w-full bg-transparent py-2 text-xs outline-none"
                  />
                </div>
                <button
                  onClick={() => setSelected(Object.fromEntries(SITES.map((s) => [s.url, true])))}
                  className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs hover:border-primary"
                >
                  اختيار الكل ({SITES.length})
                </button>
                <button
                  onClick={() => setSelected({})}
                  className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs hover:border-primary"
                >
                  مسح
                </button>
              </div>

              <ul className="max-h-[320px] space-y-1.5 overflow-y-auto pe-1">
                {list.map((s) => (
                  <li key={s.url}>
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 bg-background/40 p-2.5 hover:border-primary/60">
                      <input
                        type="checkbox"
                        checked={!!selected[s.url]}
                        onChange={(e) => setSelected((p) => ({ ...p, [s.url]: e.target.checked }))}
                        className="mt-1 accent-primary"
                      />
                      <span className="min-w-0 flex-1">
                        <span dir="ltr" className="block truncate text-xs font-semibold">
                          {s.name}
                        </span>
                        <span className="line-clamp-2 text-[11px] leading-5 text-muted-foreground">
                          {s.description}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>

              <div className="mt-3">
                <label className="mb-1 block text-[11px] text-muted-foreground">
                  مواقع جديدة لم تُضف بعد (رابط في كل سطر)
                </label>
                <textarea
                  value={extra}
                  onChange={(e) => setExtra(e.target.value)}
                  rows={2}
                  dir="ltr"
                  placeholder="https://my-new-site.lovable.app"
                  className="w-full resize-y rounded-lg border border-border bg-card/60 px-3 py-2 text-xs outline-none focus:border-primary"
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-2xl border border-border bg-card/40 p-4 text-xs">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">مدة كل فيديو</span>
                  <select
                    value={target}
                    onChange={(e) => setTarget(Number(e.target.value))}
                    className="rounded-lg border border-border bg-card/60 px-2 py-1.5 outline-none focus:border-primary"
                  >
                    {DURATIONS.map((d) => (
                      <option key={d.s} value={d.s}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">الجودة</span>
                  <select
                    value={quality}
                    onChange={(e) => setQuality(e.target.value as QualityKey)}
                    className="rounded-lg border border-border bg-card/60 px-2 py-1.5 outline-none focus:border-primary"
                  >
                    {(Object.keys(QUALITY) as QualityKey[]).map((k) => (
                      <option key={k} value={k}>
                        {QUALITY[k].label} · {QUALITY[k].fps}fps
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">
                    <Volume2 className="inline size-3.5" /> الصوت
                  </span>
                  <select
                    value={voice}
                    onChange={(e) => setVoice(e.target.value)}
                    className="rounded-lg border border-border bg-card/60 px-2 py-1.5 outline-none focus:border-primary"
                  >
                    {VOICES.map((v) => (
                      <option key={v.id} value={v.id}>
                        صوت {v.label}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => void chooseFolder()}
                  disabled={!supportsFolderSave()}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 hover:border-primary disabled:opacity-50"
                >
                  <FolderOpen className="size-3.5" />
                  {folder ? `مجلد الحفظ: ${folder}` : "اختر مجلد الحفظ (E:\\site presentation)"}
                </button>
                {!supportsFolderSave() && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    متصفحك لا يدعم اختيار مجلد — ستنزل الملفات في مجلد التنزيلات.
                  </p>
                )}
              </div>

              <button
                onClick={() => void startQueue()}
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-hero px-6 py-4 text-sm font-bold text-primary-foreground glow-primary disabled:opacity-60"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                ابدأ التسجيل المتواصل ({selectedCount || 0} موقع)
              </button>

              <button
                onClick={() => void generateTextsOnly()}
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-primary px-6 py-3 text-xs text-primary disabled:opacity-60"
              >
                {textOnly ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <FileText className="size-3.5" />
                )}
                توليد النصوص فقط (بدون تسجيل)
              </button>
            </div>
          </div>
        )}

        {/* queue progress */}
        {queue.length > 0 && (
          <div className="mt-6 rounded-2xl border border-border bg-card/40 p-4">
            <p className="mb-3 text-xs text-muted-foreground">
              التقدّم: {Math.max(0, current + 1)} من {queue.length}
            </p>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {queue.map((q, i) => (
                <li
                  key={q.url + i}
                  className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-xs"
                >
                  {q.status === "done" && (
                    <CheckCircle2 className="size-3.5 shrink-0 text-primary" />
                  )}
                  {q.status === "failed" && (
                    <XCircle className="size-3.5 shrink-0 text-destructive" />
                  )}
                  {q.status === "running" && (
                    <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
                  )}
                  {q.status === "pending" && (
                    <Clock className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span dir="ltr" className="min-w-0 flex-1 truncate">
                    {q.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{q.note ?? ""}</span>
                  <a
                    href={q.url}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-muted-foreground hover:text-primary"
                  >
                    <ExternalLink className="size-3.5" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!running && (
          <ol className="mt-8 list-decimal space-y-2 ps-5 text-xs text-muted-foreground">
            <li>اختر مواقعك (أو «اختيار الكل») وألصق أي موقع جديد في الخانة السفلية.</li>
            <li>اختر مجلد الحفظ مرة واحدة — بعدها تُحفظ كل الملفات فيه تلقائياً.</li>
            <li>
              اضغط «ابدأ التسجيل المتواصل» واختر «هذا التبويب» في نافذة المشاركة (مرة واحدة فقط).
            </li>
            <li>
              كل موقع: جولة ≥ ٣ دقائق + تعليق صوتي + نص أسفل الفيديو، ثم MP4 و TXT و SRT باسم
              الموقع.
            </li>
            <li>ينتقل للموقع التالي تلقائياً حتى ينتهي الطابور.</li>
          </ol>
        )}
      </section>
    </main>
  );
}
