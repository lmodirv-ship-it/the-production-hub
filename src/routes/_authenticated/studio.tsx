import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Pause,
  SkipForward,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  Volume2,
  Mic,
} from "lucide-react";
import { SITES } from "@/data/sites";
import { discoverPages } from "@/lib/pages.functions";
import { generateLongNarration, synthesizeSpeech, type NarrationLocale } from "@/lib/narration.functions";
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
  runSinglePageScroll,
  sleep,
  splitDurationIntoChunks,
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

export const Route = createFileRoute("/_authenticated/studio")({
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

const VOICES = [
  { id: "alloy", label: "هادئ" },
  { id: "verse", label: "حيوي" },
  { id: "sage", label: "رصين" },
  { id: "coral", label: "دافئ" },
];

const DURATIONS = [
  { s: MIN_VIDEO_SECONDS, label: "٥ دقائق" },
  { s: 360, label: "٦ دقائق" },
  { s: 240, label: "٤ دقائق" },
];

const INTRO_MS = 3500;
const OUTRO_MS = 3500;
const CHUNK_SECONDS = 60;
const EMBED_TIMEOUT_MS = 8000;


const STORAGE_KEYS = {
  selected: "eco-selected",
  extra: "eco-extra",
  quality: "eco-quality",
  voice: "eco-voice",
  target: "eco-target",
  mic: "eco-mic",
  locale: "eco-locale",
};


function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

type QueueStatus = "pending" | "running" | "done" | "failed" | "skipped";
type QueueItem = {
  url: string;
  name: string;
  description: string;
  status: QueueStatus;
  note?: string;
};
type Clip = { url: string; seconds: number };
type RecordResult = { where: "folder" | "download"; audioFailed: boolean };

function StudioPage() {
  const sp = useSearch({ from: "/_authenticated/studio" });

  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    sp.url ? { [sp.url]: true } : {},
  );
  const [extra, setExtra] = useState("");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [current, setCurrent] = useState(-1);
  const currentIndexRef = useRef(-1);
  const [retryItems, setRetryItems] = useState<QueueItem[]>([]);


  const [quality, setQuality] = useState<QualityKey>("ultra");
  const [voice, setVoice] = useState("alloy");
  const [locale, setLocale] = useState<NarrationLocale>("ar");
  const [target, setTarget] = useState(MIN_VIDEO_SECONDS);
  const [depth] = useState(3);
  const [folder, setFolder] = useState("");
  const [mic, setMic] = useState(false);


  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [textOnly, setTextOnly] = useState(false);
  const [message, setMessage] = useState("اختر مواقعك من القائمة ثم اضغط «ابدأ التسجيل المتواصل».");
  const [seconds, setSeconds] = useState(0);
  const [caption, setCaption] = useState("");
  const [stageLabel, setStageLabel] = useState("");

  const [frameSrc, setFrameSrc] = useState("");
  const [frameState, setFrameState] = useState<"idle" | "loading" | "ready" | "blocked">("idle");
  const [activeItem, setActiveItem] = useState<{ name: string; url: string; description?: string } | null>(null);
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
  const secondsRef = useRef(0);
  const captionTimersRef = useRef<number[]>([]);
  const cancelScrollRef = useRef<{
    cancel: () => void;
    pause: () => void;
    resume: () => void;
  }>({ cancel: () => {}, pause: () => {}, resume: () => {} });
  const abortRef = useRef(false);
  const skipRef = useRef(false);
  const shareEndedRef = useRef(false);
  const pausedRef = useRef(false);

  const compositorRef = useRef<ReturnType<typeof startCompositor> | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const captionsRef = useRef<TimedCaption[]>([]);
  const currentPageTextRef = useRef("");
  const currentPageEndRef = useRef(0);

  const q = useMemo(() => QUALITY[quality], [quality]);
  const tall = q.height * depth;

  /* ---------------- persistence ---------------- */

  useEffect(() => {
    setSelected(loadJSON<Record<string, boolean>>(STORAGE_KEYS.selected, sp.url ? { [sp.url]: true } : {}));
    setExtra(loadJSON<string>(STORAGE_KEYS.extra, ""));
    setQuality(loadJSON<QualityKey>(STORAGE_KEYS.quality, "ultra"));
    setVoice(loadJSON<string>(STORAGE_KEYS.voice, "alloy"));
    setLocale(loadJSON<NarrationLocale>(STORAGE_KEYS.locale, "ar"));
    setTarget(loadJSON<number>(STORAGE_KEYS.target, MIN_VIDEO_SECONDS));
    setMic(loadJSON<boolean>(STORAGE_KEYS.mic, false));
    if (supportsFolderSave()) {
      void restoreFolder().then((n) => n && setFolder(n));
    }
  }, []);

  useEffect(() => saveJSON(STORAGE_KEYS.selected, selected), [selected]);
  useEffect(() => saveJSON(STORAGE_KEYS.extra, extra), [extra]);
  useEffect(() => saveJSON(STORAGE_KEYS.quality, quality), [quality]);
  useEffect(() => saveJSON(STORAGE_KEYS.voice, voice), [voice]);
  useEffect(() => saveJSON(STORAGE_KEYS.locale, locale), [locale]);
  useEffect(() => saveJSON(STORAGE_KEYS.target, target), [target]);
  useEffect(() => saveJSON(STORAGE_KEYS.mic, mic), [mic]);


  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    // preview: fit by width. recording: cover the whole surface so no black bars remain.
    const compute = () => {
      const byW = el.clientWidth / q.width;
      const byH = el.clientHeight / q.height;
      setScale(running ? Math.max(byW, byH) : byW);
    };
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    compute();
    return () => ro.disconnect();
  }, [q.width, q.height, running]);


  useEffect(() => {
    return () => {
      displayRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (timerRef.current) window.clearInterval(timerRef.current);
      Object.values(clipsRef.current).forEach((c) => URL.revokeObjectURL(c.url));
      void audioCtxRef.current?.close().catch(() => {});
    };
  }, []);

  /* ---------------- selection ---------------- */

  const list = useMemo(
    () => SITES.filter((s) => !filter.trim() || (s.name + s.description).includes(filter.trim())),
    [filter],
  );
  const selectedCount = useMemo(() => Object.values(selected).filter(Boolean).length, [selected]);

  const extraSites = useMemo(() => {
    return extra
      .split(/[\n,]/)
      .map((v) => normalizeUrl(v.trim()))
      .filter(Boolean)
      .filter((u) => !SITES.some((s) => s.url === u));
  }, [extra]);

  const totalEstimate = useMemo(() => {
    const count = selectedCount + extraSites.length;
    const sec = count * (target + 7);
    const bytes = sec * (q.videoBps + 192_000) / 8;
    return { count, sec, mb: Math.round(bytes / 1024 / 1024) };
  }, [selectedCount, extraSites.length, target, q.videoBps]);

  function buildQueue(): QueueItem[] {
    const picked = SITES.filter((s) => selected[s.url]).map((s) => ({
      url: s.url,
      name: s.name,
      description: s.description,
      status: "pending" as QueueStatus,
    }));
    const manual = extraSites.map((u) => ({
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
        locale,
      },
    });


    if (narration.fallback) {
      toast.info(`استُخدم سكربت احتياطي لـ ${item.name} بدون ذكاء اصطناعي.`);
    }

    Object.values(clipsRef.current).forEach((c) => URL.revokeObjectURL(c.url));
    clipsRef.current = {};

    const stops: TourStop[] = [];
    let audioFailed = !mic;
    for (let i = 0; i < narration.items.length; i++) {
      if (abortRef.current || skipRef.current) break;
      const it = narration.items[i];
      setMessage(`توليد الصوت ${i + 1}/${narration.items.length} — ${item.name}`);
      let secs = Math.max(12, Math.ceil(it.text.length / 14));

      if (mic) {
        // microphone will supply the narration
        clipsRef.current[it.path] = { url: "", seconds: 0 };
      } else {
        try {
          const { audio, mime } = await synthesizeSpeech({
            data: { text: it.text.slice(0, 1900), voice, locale },
          });

          const url = base64ToBlobUrl(audio, mime);
          const dur = await audioDuration(url);
          if (dur > 0) {
            clipsRef.current[it.path] = { url, seconds: dur };
            secs = Math.ceil(dur) + 3;
            audioFailed = false;
          }
        } catch (e) {
          console.error(e);
          audioFailed = true;
        }
      }
      stops.push({ path: it.path, seconds: secs, enabled: true });
    }

    return { stops: ensureTotalSeconds(stops, target), scripts: narration.items, audioFailed };
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
    if (!clip || !clip.url || !el) return;
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

  async function startMic() {
    if (!mic) return null;
    if (micStreamRef.current) return micStreamRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      return stream;
    } catch (e) {
      console.error(e);
      toast.error("لم يُسمح بالميكروفون — سيتم التسجيل بدون صوتك.");
      setMic(false);
      return null;
    }
  }

  /* ---------------- pausable sleep ---------------- */

  async function pauseAwareSleep(ms: number) {
    const start = performance.now();
    let pausedTime = 0;
    let pausedAt = 0;
    while (true) {
      if (abortRef.current || skipRef.current) return;
      if (pausedRef.current) {
        if (!pausedAt) pausedAt = performance.now();
        await sleep(100);
        continue;
      }
      if (pausedAt) {
        pausedTime += performance.now() - pausedAt;
        pausedAt = 0;
      }
      const elapsed = performance.now() - start - pausedTime;
      if (elapsed >= ms) return;
      await sleep(Math.min(100, ms - elapsed));
    }
  }

  /* ---------------- mp4 ---------------- */

  const convertToMp4 = useCallback(async (chunks: Blob | Blob[]): Promise<Blob> => {
    const inputChunks = Array.isArray(chunks) ? chunks : [chunks];
    if (inputChunks.length === 0) return new Blob([], { type: "video/mp4" });
    if (inputChunks.length === 1 && inputChunks[0].type.startsWith("video/mp4")) return inputChunks[0];

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

      for (let i = 0; i < inputChunks.length; i++) {
        await ffmpeg.writeFile(`chunk${i}.webm`, await fetchFile(inputChunks[i]));
      }

      if (inputChunks.length === 1) {
        await ffmpeg.exec([
          "-i",
          "chunk0.webm",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "20",
          "-pix_fmt",
          "yuv420p",
          "-r",
          String(q.fps),
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-movflags",
          "+faststart",
          "out.mp4",
        ]);
      } else {
        const list = inputChunks.map((_, i) => `file 'chunk${i}.webm'`).join("\n");
        await ffmpeg.writeFile("list.txt", list);
        await ffmpeg.exec([
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          "list.txt",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "20",
          "-pix_fmt",
          "yuv420p",
          "-r",
          String(q.fps),
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-movflags",
          "+faststart",
          "out.mp4",
        ]);
      }

      const data = await ffmpeg.readFile("out.mp4");
      const u8 = data as Uint8Array;
      return new Blob(
        [u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer],
        { type: "video/mp4" },
      );
    } catch (err) {
      console.error("ffmpeg convert failed", err);
      toast.error("تعذّر التحويل إلى MP4 — سيُحفظ الملف كما هو.");
      return inputChunks.length === 1 ? inputChunks[0] : new Blob(inputChunks, { type: "video/webm" });
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
    captionsRef.current = captions;
    let elapsed = 0;
    const singlePage = stops.length === 1;

    for (let i = 0; i < stops.length; i++) {
      if (abortRef.current || skipRef.current) break;
      const stop = stops[i];
      setStageLabel(`${item.name} · ${i + 1}/${stops.length}`);
      compositorRef.current?.setBadge(`${item.name} — ${stop.path}`);
      currentPageTextRef.current = scripts.find((s) => s.path === stop.path)?.text ?? "";
      setFade(true);
      setOffset(0);
      setFrameState("loading");
      setFrameSrc(`${origin}${stop.path}`);
      const loaded = await Promise.race([
        new Promise<boolean>((r) => {
          const el = iframeRef.current;
          if (!el) return r(false);
          const on = () => {
            el.removeEventListener("load", on);
            r(true);
          };
          el.addEventListener("load", on);
        }),
        pauseAwareSleep(EMBED_TIMEOUT_MS).then(() => false),
      ]);
      if (abortRef.current || skipRef.current) break;
      if (!loaded) {
        setFrameState("blocked");
        if (i === 0) throw new Error("embed-blocked");
        continue;
      }
      setFrameState("ready");
      setFade(false);
      // let the site paint its first frames before we start moving
      await pauseAwareSleep(900);


      if (abortRef.current || skipRef.current) break;

      currentPageEndRef.current = secondsRef.current + stop.seconds;
      playClip(stop.path);
      if (currentPageTextRef.current) {
        scheduleCaptions(currentPageTextRef.current, stop.seconds, elapsed, captions);
      }

      if (singlePage) {
        const anim = runSinglePageScroll(tall, q.height, stop.seconds, setOffset);
        cancelScrollRef.current = anim;
        await anim.done;
      } else {
        const scrollMs = Math.max(2500, stop.seconds * 1000 - 2200);
        const segments = Math.max(3, Math.round(stop.seconds / 7));
        const anim = animateScrollCinematic(tall - q.height, scrollMs, segments, setOffset);
        cancelScrollRef.current = anim;
        await anim.done;
      }
      if (abortRef.current || skipRef.current) break;
      await pauseAwareSleep(900);
      elapsed += stop.seconds;
      setFade(true);
      await pauseAwareSleep(400);
    }
    clearCaptionTimers();
    compositorRef.current?.setCaption("");
    setCaption("");
    return captions;
  }

  /* ---------------- one site ---------------- */

  async function recordOne(item: QueueItem): Promise<RecordResult> {
    const { stops, scripts, audioFailed: ttsFailed } = await planSite(item);
    if (abortRef.current || skipRef.current) throw new Error("skip");

    const comp = startCompositor(displayRef.current!, q.width, q.height, q.fps, locale);
    compositorRef.current = comp;

    const tracks: MediaStreamTrack[] = [
      ...comp.stream.getVideoTracks(),
      ...ensureNarrationTracks(),
    ];
    if (micStreamRef.current) {
      tracks.push(...micStreamRef.current.getAudioTracks());
    }
    const candidates = [
      "video/mp4;codecs=avc1,mp4a.40.2",
      "video/mp4",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    const mime = candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";

    const siteChunks: Blob[] = [];
    let activeRec: MediaRecorder | null = null;
    let activeChunks: Blob[] = [];
    let chunkTimer = 0;

    const startChunk = () => {
      activeChunks = [];
      const rec = new MediaRecorder(new MediaStream(tracks), {
        mimeType: mime,
        videoBitsPerSecond: q.videoBps,
        audioBitsPerSecond: 192_000,
      });
      rec.ondataavailable = (e) => {
        if (e.data.size) activeChunks.push(e.data);
      };
      rec.onstop = () => {
        if (activeChunks.length) {
          siteChunks.push(new Blob(activeChunks, { type: mime.split(";")[0] || "video/webm" }));
        }
        recRef.current = null;
      };
      recRef.current = rec;
      rec.start(1000);
      activeRec = rec;
      chunkTimer = window.setTimeout(() => {
        if (activeRec && activeRec.state !== "inactive") {
          activeRec.stop();
          if (!abortRef.current && !skipRef.current) {
            // restart next chunk unless we're ending
            setTimeout(() => startChunk(), 50);
          }
        }
      }, CHUNK_SECONDS * 1000);
    };


    const stopChunk = () => {
      window.clearTimeout(chunkTimer);
      if (activeRec && activeRec.state !== "inactive") {
        activeRec.stop();
        activeRec = null;
      }
    };

    startChunk();

    comp.setCard({ title: item.name, subtitle: item.url, kind: "intro" });
    await pauseAwareSleep(INTRO_MS);
    comp.setCard(null);


    setSeconds(0);
    if (timerRef.current) window.clearInterval(timerRef.current);
    secondsRef.current = 0;
    timerRef.current = window.setInterval(() => {
      secondsRef.current += 1;
      setSeconds((s) => s + 1);
    }, 1000);
    setMessage(`جارٍ تصوير ${item.name} — لا تلمس شيئاً.`);

    let captions: TimedCaption[] = [];
    try {
      captions = await runTour(item, stops, scripts);
    } finally {
      comp.setCard({ title: item.name, subtitle: item.url, kind: "outro" });
      await pauseAwareSleep(OUTRO_MS);
      comp.setCard(null);
      await pauseAwareSleep(600);
      stopChunk();
      // wait for the last onstop to flush
      await new Promise<void>((r) => setTimeout(r, 1200));
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      comp.stop();
      compositorRef.current = null;
      narrationElRef.current?.pause();
    }

    if (abortRef.current || skipRef.current) throw new Error("skip");

    const finalBlob =
      siteChunks.length === 1 && mime.startsWith("video/mp4")
        ? siteChunks[0]
        : await convertToMp4(siteChunks);
    const base = safeFileBase(item.url);
    const ext = finalBlob.type === "video/mp4" ? "mp4" : "webm";
    const fullScript = scripts.map((s) => s.text).join("\n\n");
    const total = stops.reduce((a, s) => a + s.seconds, 0) + Math.round((INTRO_MS + OUTRO_MS) / 1000);

    setMessage(`حفظ ملفات ${item.name}…`);
    const where = await saveFile(finalBlob, `${base}.${ext}`);
    await saveFile(
      buildDescriptionFile({ name: item.name, url: item.url, seconds: total, script: fullScript, locale }),
      `${base}.txt`,
    );

    if (captions.length) await saveFile(buildSrt(captions), `${base}.srt`);

    return { where, audioFailed: ttsFailed || (mic && !micStreamRef.current) };
  }


  /* ---------------- queue ---------------- */

  async function runQueue(items: QueueItem[]) {
    setQueue(items);
    abortRef.current = false;
    skipRef.current = false;

    for (let i = 0; i < items.length; i++) {
      if (abortRef.current) break;
      setCurrent(i);
      currentIndexRef.current = i;
      setQueue((prev) => prev.map((p, j) => (j === i ? { ...p, status: "running" } : p)));
      try {
        const { where, audioFailed } = await recordOne(items[i]);
        setQueue((prev) =>
          prev.map((p, j) =>
            j === i
              ? {
                  ...p,
                  status: "done",
                  note: audioFailed
                    ? "تم الحفظ (بدون تعليق صوتي)"
                    : where === "folder"
                      ? "حُفظ في المجلد"
                      : "نزل للتنزيلات",
                }
              : p,
          ),
        );
        if (audioFailed) {
          toast.warning(`تم تسجيل ${items[i].name} بدون تعليق صوتي.`);
        }
      } catch (e) {
        if (skipRef.current) {
          setQueue((prev) =>
            prev.map((p, j) => (j === i ? { ...p, status: "skipped", note: "تم تخطّيه" } : p)),
          );
          skipRef.current = false;
        } else {
          console.error(e);
          setQueue((prev) =>
            prev.map((p, j) => (j === i ? { ...p, status: "failed", note: "تعذّر التسجيل" } : p)),
          );
        }
      }
      await pauseAwareSleep(800);
    }

    if (shareEndedRef.current) {
      const idx = currentIndexRef.current;
      if (idx >= 0 && idx < items.length) {
        const failed = items.slice(idx);
        if (failed.length) {
          setRetryItems(failed.map((f) => ({ ...f, status: "pending" as const, note: "معلّق — أعد البدء" })));
          toast.info("أعد الضغط على «ابدأ» لاستئناف التسجيل من الموقع الحالي.");
        }
      }
      shareEndedRef.current = false;
    }



  }

  async function startQueue() {
    const items = retryItems.length ? retryItems : buildQueue();
    if (!items.length) {
      toast.error("اختر موقعاً واحداً على الأقل.");
      return;
    }
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
      toast.error("متصفحك لا يدعم التسجيل. استخدم Chrome أو Edge على الحاسوب.");
      return;
    }

    if (quality === "uhd") {
      const ok = window.confirm(
        "4K مكثف جداً للمتصفح وقد يتعطل لمدة طويلة. هل تريد الاستمرار بجودة 4K؟",
      );
      if (!ok) {
        setQuality("ultra");
        return;
      }
    }

    setRetryItems([]);
    setRunning(true);
    pausedRef.current = false;
    shareEndedRef.current = false;
    setPaused(false);
    setMessage("اختر «هذا التبويب» في نافذة المشاركة — مرة واحدة فقط لكل المواقع.");



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
      shareEndedRef.current = true;
      abortRef.current = true;
      toast.error("انتهت مشاركة الشاشة. سأُوقف الحالية وأضعها في قائمة إعادة المحاولة.");
    });


    if (mic) {
      await startMic();
    }

    if (stageRef.current) {
      try {
        await stageRef.current.requestFullscreen();
      } catch {
        /* windowed is fine */
      }
      await sleep(500);
    }

    await runQueue(items);

    display.getTracks().forEach((t) => t.stop());
    displayRef.current = null;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    setRunning(false);
    setPaused(false);
    setCurrent(-1);
    currentIndexRef.current = -1;
    setFrameSrc("");
    setMessage(abortRef.current ? "تم إيقاف الطابور." : "اكتمل الطابور — كل الفيديوهات والنصوص جاهزة.");
    if (!abortRef.current) toast.success("اكتملت كل الفيديوهات.");
  }

  function stopQueue() {
    abortRef.current = true;
    skipRef.current = false;
    pausedRef.current = false;
    setPaused(false);
    cancelScrollRef.current.cancel();
    clearCaptionTimers();
    narrationElRef.current?.pause();
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
  }

  function skipQueue() {
    skipRef.current = true;
    cancelScrollRef.current.cancel();
    clearCaptionTimers();
    narrationElRef.current?.pause();
    try {
      recRef.current?.stop();
    } catch {
      /* ignore */
    }
  }

  function pauseQueue() {
    if (pausedRef.current) return;
    pausedRef.current = true;
    setPaused(true);
    try {
      if (recRef.current?.state === "recording") recRef.current.pause();
    } catch {
      /* ignore */
    }
    narrationElRef.current?.pause();
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    cancelScrollRef.current.pause();
    clearCaptionTimers();
    compositorRef.current?.setCaption("");
    setCaption("");
    setMessage("تم الإيقاف المؤقت — اضغط متابعة للاستئناف.");
  }

  function resumeQueue() {
    if (!pausedRef.current) return;
    pausedRef.current = false;
    setPaused(false);
    try {
      if (recRef.current?.state === "paused") recRef.current.resume();
    } catch {
      /* ignore */
    }
    void narrationElRef.current?.play().catch(() => {});
    timerRef.current = window.setInterval(() => {
      secondsRef.current += 1;
      setSeconds((s) => s + 1);
    }, 1000);
    cancelScrollRef.current.resume();
    const remaining = currentPageEndRef.current - secondsRef.current;
    if (remaining > 0 && currentPageTextRef.current && captionsRef.current) {
      scheduleCaptions(currentPageTextRef.current, remaining, secondsRef.current, captionsRef.current);
    }
    setMessage("جارٍ الاستئناف…");
  }

  async function retryFailed() {
    const failed = queue.filter((p) => p.status === "failed");
    if (!failed.length) {
      toast.error("لا يوجد مواقع فاشلة لإعادة المحاولة.");
      return;
    }
    setRetryItems(failed.map((p) => ({ ...p, status: "pending" as QueueStatus, note: "" })));
    // startQueue will pick up retryItems
    await startQueue();
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
        currentIndexRef.current = i;
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
              locale,
            },
          });
          const base = safeFileBase(items[i].url);
          await saveFile(
            buildDescriptionFile({
              name: items[i].name,
              url: items[i].url,
              seconds: target,
              script: n.items.map((x) => x.text).join("\n\n"),
              locale,
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
    currentIndexRef.current = -1;
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
  const hasFailed = queue.some((p) => p.status === "failed");

  const stats = {
    total: queue.length,
    done: queue.filter((p) => p.status === "done").length,
    failed: queue.filter((p) => p.status === "failed").length,
    skipped: queue.filter((p) => p.status === "skipped").length,
    runningCount: queue.filter((p) => p.status === "running").length,
    pending: queue.filter((p) => p.status === "pending").length,
  };
  const finished = stats.done + stats.failed + stats.skipped;
  const percent = stats.total ? Math.round((finished / stats.total) * 100) : 0;

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
        {/* stage — TV screen */}
        <div className={running ? "" : "tv-set mx-auto w-[90vw] max-w-[1600px]"}>
        <div
          ref={stageRef}
          className={`relative mx-auto overflow-hidden bg-black ${
            running
              ? "fixed inset-0 z-50 w-screen rounded-none"
              : "tv-screen w-full aspect-video"
          }`}
        >
          <div ref={shellRef} className="relative h-full w-full overflow-hidden" style={{ contain: "layout paint size" }}>
            <div
              className={`absolute left-0 top-0 origin-top-left overflow-hidden ${running ? "" : "transition-opacity duration-500"}`}

              style={{
                width: q.width,
                height: q.height,
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
                  style={{ width: q.width, height: tall, transform: `translateY(${-offset}px)` }}
                />
              ) : null}
            </div>
          </div>

          {/* only show the overlay preview when not recording — the final MP4 burns the caption */}
          {caption && !running && (
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

          {!running && <div className="tv-glare pointer-events-none absolute inset-0" />}
        </div>
        {!running && (
          <>
            <div className="mx-auto mt-1 h-4 w-1/5 rounded-b-md bg-gradient-to-b from-neutral-700 to-neutral-900" />
            <div className="mx-auto h-2 w-2/5 rounded-full bg-neutral-800/80" />
          </>
        )}
        </div>


        {running && (
          <div className="fixed bottom-4 left-4 z-[60] flex items-center gap-2">
            <button
              onClick={paused ? resumeQueue : pauseQueue}
              className="rounded-full bg-primary/90 px-4 py-2 text-xs text-primary-foreground hover:opacity-100"
            >
              {paused ? <Play className="me-1 inline size-3.5" /> : <Pause className="me-1 inline size-3.5" />}
              {paused ? "متابعة" : "إيقاف مؤقت"}
            </button>
            <button
              onClick={skipQueue}
              className="rounded-full bg-muted/90 px-4 py-2 text-xs text-muted-foreground hover:bg-muted"
            >
              <SkipForward className="me-1 inline size-3.5" />
              تخطّي
            </button>
            <button
              onClick={stopQueue}
              className="rounded-full bg-destructive/90 px-4 py-2 text-xs text-destructive-foreground hover:opacity-100"
            >
              إيقاف الطابور
            </button>
          </div>
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
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">اللغة</span>
                  <select
                    value={locale}
                    onChange={(e) => setLocale(e.target.value as NarrationLocale)}
                    className="rounded-lg border border-border bg-card/60 px-2 py-1.5 outline-none focus:border-primary"
                  >
                    <option value="ar">العربية</option>
                    <option value="en">English</option>
                    <option value="fr">Français</option>
                  </select>
                </div>
                <div className="mb-3 flex items-center justify-between gap-2">

                  <span className="text-muted-foreground">
                    <Mic className="inline size-3.5" /> تعليقي بالميكروفون
                  </span>
                  <button
                    onClick={() => setMic((p) => !p)}
                    className={`rounded-lg border px-2 py-1.5 text-xs ${mic ? "border-primary bg-primary/20 text-primary" : "border-border bg-card/60 text-muted-foreground"}`}
                  >
                    {mic ? "مفعّل" : "معطّل"}
                  </button>
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
                ابدأ التسجيل المتواصل ({totalEstimate.count} موقع)
              </button>

              {totalEstimate.count > 0 && (
                <p className="text-center text-[11px] text-muted-foreground">
                  تقدير: {fmt(totalEstimate.sec)} إجمالاً، حوالي {totalEstimate.mb} ميغابايت
                </p>
              )}

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

              {hasFailed && !running && (
                <button
                  onClick={() => void retryFailed()}
                  disabled={busy}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-destructive px-6 py-3 text-xs text-destructive disabled:opacity-60"
                >
                  <XCircle className="size-3.5" />
                  إعادة محاولة المواقع الفاشلة ({queue.filter((p) => p.status === "failed").length})
                </button>
              )}
            </div>
          </div>
        )}

        {/* queue progress */}
        {queue.length > 0 && (
          <div className="mt-6 rounded-2xl border border-border bg-card/40 p-4">
            <div className="mb-4">
              <div className="mb-2 flex items-baseline justify-between">
                <p className="text-xs text-muted-foreground">
                  التقدّم: {Math.max(0, current + 1)} من {stats.total}
                </p>
                <p className="text-sm font-bold text-primary">{percent}%</p>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-background/60">
                <div
                  className="h-full rounded-full bg-gradient-hero transition-all duration-500"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {[
                  { label: "منتهية", value: stats.done, cls: "text-primary" },
                  { label: "قيد العمل", value: stats.runningCount, cls: "text-primary" },
                  { label: "في الانتظار", value: stats.pending, cls: "text-muted-foreground" },
                  { label: "فاشلة", value: stats.failed, cls: "text-destructive" },
                  { label: "متخطّاة", value: stats.skipped, cls: "text-muted-foreground" },
                ].map((s) => (
                  <div
                    key={s.label}
                    className="rounded-xl border border-border/60 bg-background/40 px-3 py-2 text-center"
                  >
                    <p className={`text-lg font-bold ${s.cls}`}>{s.value}</p>
                    <p className="text-[10px] text-muted-foreground">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {queue.map((qi, i) => (
                <li
                  key={qi.url + i}
                  className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2 text-xs"
                >
                  {qi.status === "done" && (
                    <CheckCircle2 className="size-3.5 shrink-0 text-primary" />
                  )}
                  {qi.status === "failed" && (
                    <XCircle className="size-3.5 shrink-0 text-destructive" />
                  )}
                  {qi.status === "skipped" && (
                    <SkipForward className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  {qi.status === "running" && (
                    <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
                  )}
                  {qi.status === "pending" && (
                    <Clock className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span dir="ltr" className="min-w-0 flex-1 truncate">
                    {qi.name}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{qi.note ?? ""}</span>
                  <a
                    href={qi.url}
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
            <li>إذا نفدت أرصدة الذكاء الاصطناعي، يستمر التسجيل بدون صوت وتظهر وسوم مقترحة.</li>
          </ol>
        )}
      </section>
    </main>
  );
}
