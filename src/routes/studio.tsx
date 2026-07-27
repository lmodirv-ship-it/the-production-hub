import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  Sparkles, Video, Download, Square, Loader2, Mic, MicOff, ExternalLink,
  Search, Plus, Trash2, ArrowUp, ArrowDown, MonitorPlay, AppWindow,
} from "lucide-react";
import { discoverPages } from "@/lib/pages.functions";
import {
  DEFAULT_SECONDS, animateScroll, fileNameFor, fmt, loadStops, normalizeUrl,
  originOf, saveStops, sleep, totalDuration, type TourStop,
} from "@/lib/tour";

const search = z.object({ url: z.string().optional() }).partial();

export const Route = createFileRoute("/studio")({
  validateSearch: (s) => search.parse(s),
  head: () => ({
    meta: [
      { title: "استوديو الجولات — Eco AI" },
      { name: "description", content: "جولة تلقائية بين صفحات موقعك مع تمرير سينمائي وتسجيل MP4 جاهز للنشر." },
      { property: "og:title", content: "استوديو الجولات — Eco AI" },
      { property: "og:description", content: "جولة تلقائية بين صفحات موقعك مع تمرير سينمائي وتسجيل MP4 جاهز للنشر." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StudioPage,
});

type Phase = "idle" | "recording" | "processing" | "done";
type Mode = "cinema" | "tab";

const BASE_W = 1280;
const BASE_H = 720;

function StudioPage() {
  const sp = useSearch({ from: "/studio" });

  const [input, setInput] = useState(sp.url ?? "");
  const [mode, setMode] = useState<Mode>("cinema");
  const [stops, setStops] = useState<TourStop[]>([{ path: "/", seconds: DEFAULT_SECONDS, enabled: true }]);
  const [newPath, setNewPath] = useState("");
  const [depth, setDepth] = useState(3);
  const [discovering, setDiscovering] = useState(false);

  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [useMic, setUseMic] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState("video.mp4");
  const [message, setMessage] = useState("ألصق رابط موقعك، اكتشف صفحاته، ثم اضغط «ابدأ الجولة».");
  const [stopLabel, setStopLabel] = useState("");

  const [frameSrc, setFrameSrc] = useState("");
  const [offset, setOffset] = useState(0);
  const [fade, setFade] = useState(false);
  const [scale, setScale] = useState(1);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamsRef = useRef<MediaStream[]>([]);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const siteWinRef = useRef<Window | null>(null);
  const abortRef = useRef(false);
  const cancelScrollRef = useRef<() => void>(() => {});

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
    return () => {
      streamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    const saved = loadStops(input);
    if (saved) setStops(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originOf(input)]);

  /* ---------------- pages list ---------------- */

  async function handleDiscover() {
    const url = normalizeUrl(input);
    if (!url) { toast.error("أدخل رابط موقعك أولاً."); return; }
    setDiscovering(true);
    try {
      const res = await discoverPages({ data: { url } });
      if (!res.paths.length) throw new Error("empty");
      const next = res.paths.map((p) => ({ path: p, seconds: DEFAULT_SECONDS, enabled: true }));
      setStops(next);
      saveStops(url, next);
      toast.success(`تم العثور على ${next.length} صفحة.`);
    } catch {
      toast.error("تعذّر اكتشاف الصفحات — أضفها يدوياً.");
    } finally {
      setDiscovering(false);
    }
  }

  const update = (next: TourStop[]) => { setStops(next); saveStops(input, next); };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= stops.length) return;
    const next = [...stops];
    [next[i], next[j]] = [next[j], next[i]];
    update(next);
  };
  const addPath = () => {
    const p = ("/" + newPath.trim().replace(/^\/+/, "")).replace(/\/+$/, "") || "/";
    if (stops.some((s) => s.path === p)) { toast.info("الصفحة موجودة بالفعل."); return; }
    update([...stops, { path: p, seconds: DEFAULT_SECONDS, enabled: true }]);
    setNewPath("");
  };

  /* ---------------- export ---------------- */

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
        "-i", "in.webm",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart", "out.mp4",
      ]);
      const data = await ffmpeg.readFile("out.mp4");
      const u8 = data as Uint8Array;
      return new Blob([u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer], { type: "video/mp4" });
    } catch (err) {
      console.error("ffmpeg convert failed", err);
      toast.error("تعذّر التحويل إلى MP4 — سيتم تنزيل الملف كما هو.");
      return blob;
    }
  }, []);

  const finalize = useCallback(async (mime: string) => {
    setPhase("processing");
    const raw = new Blob(chunksRef.current, { type: mime.split(";")[0] || "video/webm" });
    chunksRef.current = [];
    const finalBlob = mime.startsWith("video/mp4") ? raw : await convertToMp4(raw);
    const name = finalBlob.type === "video/mp4" ? downloadName : downloadName.replace(/\.mp4$/, ".webm");
    const url = URL.createObjectURL(finalBlob);
    setPreviewUrl(url);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setPhase("done");
    setMessage(`تم! نزل الملف باسم ${name}`);
    toast.success("اكتملت الجولة وتم تنزيل الفيديو.");
  }, [convertToMp4, downloadName]);

  const stopAll = useCallback(() => {
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    streamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streamsRef.current = [];
    if (videoRef.current) videoRef.current.srcObject = null;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, []);

  const stopRecording = useCallback(() => {
    abortRef.current = true;
    cancelScrollRef.current();
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }, []);

  /* ---------------- tour engines ---------------- */

  async function runCinemaTour(origin: string, list: TourStop[]) {
    for (let i = 0; i < list.length; i++) {
      if (abortRef.current) return;
      const stop = list[i];
      setStopLabel(`${i + 1}/${list.length} — ${stop.path}`);
      setFade(true);
      setOffset(0);
      setFrameSrc(`${origin}${stop.path}`);
      await Promise.race([
        new Promise<void>((r) => {
          const el = iframeRef.current;
          if (!el) return r();
          const on = () => { el.removeEventListener("load", on); r(); };
          el.addEventListener("load", on);
        }),
        sleep(6000),
      ]);
      if (abortRef.current) return;
      setFade(false);
      await sleep(1200);
      if (abortRef.current) return;

      const scrollMs = Math.max(1500, stop.seconds * 1000 - 2200);
      const anim = animateScroll(tall - BASE_H, scrollMs, setOffset);
      cancelScrollRef.current = anim.cancel;
      await anim.done;
      if (abortRef.current) return;
      await sleep(600);
      setFade(true);
      await sleep(400);
    }
  }

  async function runTabTour(origin: string, list: TourStop[]) {
    for (let i = 0; i < list.length; i++) {
      if (abortRef.current) return;
      const stop = list[i];
      setStopLabel(`${i + 1}/${list.length} — ${stop.path}`);
      try { siteWinRef.current!.location.href = `${origin}${stop.path}`; } catch { /* closed */ }
      await sleep(stop.seconds * 1000);
    }
  }

  /* ---------------- start ---------------- */

  async function startTour() {
    const url = normalizeUrl(input);
    const origin = originOf(url);
    if (!origin) { toast.error("أدخل رابط موقعك أولاً."); return; }
    const list = stops.filter((s) => s.enabled);
    if (!list.length) { toast.error("فعّل صفحة واحدة على الأقل."); return; }
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
      toast.error("متصفحك لا يدعم التسجيل. استخدم Chrome أو Edge على الحاسوب.");
      return;
    }

    if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }
    setDownloadName(fileNameFor(url));
    abortRef.current = false;

    if (mode === "tab") {
      siteWinRef.current = window.open(`${origin}${list[0].path}`, "_blank");
      window.focus();
      await sleep(500);
    } else {
      setFrameSrc(`${origin}${list[0].path}`);
    }

    setMessage(mode === "cinema"
      ? "اختر «هذا التبويب» في نافذة المشاركة…"
      : "اختر تبويب موقعك في نافذة المشاركة…");

    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30, width: { ideal: 1920 }, height: { ideal: 1080 }, displaySurface: "browser" },
        audio: true,
        preferCurrentTab: mode === "cinema",
        selfBrowserSurface: mode === "cinema" ? "include" : "exclude",
        surfaceSwitching: "exclude",
      } as DisplayMediaStreamOptions);
    } catch (err) {
      console.error(err);
      setMessage("تم إلغاء المشاركة. اضغط «ابدأ الجولة» للمحاولة مجدداً.");
      toast.error("لم يتم منح إذن التسجيل.");
      return;
    }
    streamsRef.current.push(display);

    const tracks = [...display.getVideoTracks(), ...display.getAudioTracks()];
    if (useMic) {
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamsRef.current.push(mic);
        tracks.push(...mic.getAudioTracks());
      } catch {
        toast.warning("تعذّر الوصول للميكروفون — سيتم التسجيل بدون تعليق صوتي.");
      }
    }

    const candidates = [
      "video/mp4;codecs=avc1,mp4a.40.2",
      "video/mp4",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    const mime = candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";

    const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: 6_000_000 });
    recRef.current = rec;
    chunksRef.current = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
    rec.onstop = () => { stopAll(); void finalize(mime); };
    display.getVideoTracks()[0]?.addEventListener("ended", () => stopRecording());

    setPhase("recording");
    setSeconds(0);
    setMessage(mode === "cinema"
      ? "جارٍ تصوير الجولة — لا تلمس شيئاً حتى تنتهي."
      : "جارٍ التسجيل — الصفحات تتنقل تلقائياً، مرّر بنفسك داخل كل صفحة.");
    timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);

    if (mode === "cinema" && stageRef.current) {
      try { await stageRef.current.requestFullscreen(); } catch { /* user can still record windowed */ }
      await sleep(400);
    }

    rec.start(1000);

    try {
      if (mode === "cinema") await runCinemaTour(origin, list);
      else await runTabTour(origin, list);
    } finally {
      if (!abortRef.current) {
        await sleep(400);
        stopRecording();
      }
    }
  }

  function downloadAgain() {
    if (!previewUrl) return;
    const a = document.createElement("a");
    a.href = previewUrl;
    a.download = downloadName;
    a.click();
  }

  const recording = phase === "recording";
  const busy = phase === "processing";
  const cinemaLive = recording && mode === "cinema";

  return (
    <main className="min-h-screen grid-bg">
      <header className="container mx-auto flex items-center justify-between py-5 px-6">
        <Link to="/" className="flex items-center gap-2 hover:opacity-80">
          <div className="size-9 rounded-xl bg-gradient-hero grid place-items-center glow-primary">
            <Sparkles className="size-5 text-primary-foreground" />
          </div>
          <span className="text-lg font-bold">Eco AI</span>
        </Link>
        <span className="text-xs text-muted-foreground">جولة تلقائية → MP4</span>
      </header>

      <section className="container mx-auto px-6 pb-16 max-w-4xl">
        <h1 className="text-2xl md:text-3xl font-bold mb-2">جولة تلقائية داخل موقعك</h1>
        <p className="text-sm text-muted-foreground mb-6">
          المتصفح يتنقل بين الصفحات ويمرّر داخل كل صفحة تلقائياً، والفيديو ينزل MP4 في النهاية.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="example.com"
            dir="ltr"
            disabled={recording || busy}
            className="flex-1 rounded-xl border border-border bg-card/60 px-4 py-3 text-sm outline-none focus:border-primary disabled:opacity-60"
          />
          <button
            onClick={() => void handleDiscover()}
            disabled={recording || busy || discovering}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-3 text-sm hover:border-primary disabled:opacity-60"
          >
            {discovering ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            اكتشف الصفحات
          </button>
          {!recording ? (
            <button
              onClick={() => void startTour()}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-hero px-6 py-3 text-sm font-semibold text-primary-foreground glow-primary disabled:opacity-60"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Video className="size-4" />}
              ابدأ الجولة
            </button>
          ) : (
            <button
              onClick={stopRecording}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-destructive px-6 py-3 text-sm font-semibold text-destructive-foreground"
            >
              <Square className="size-4" />
              إيقاف وتنزيل
            </button>
          )}
        </div>

        {!recording && !busy && (
          <div className="mb-6 rounded-2xl border border-border bg-card/40 p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button
                onClick={() => setMode("cinema")}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${mode === "cinema" ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
              >
                <MonitorPlay className="size-3.5" /> عارض سينمائي (تمرير تلقائي)
              </button>
              <button
                onClick={() => setMode("tab")}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${mode === "tab" ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
              >
                <AppWindow className="size-3.5" /> تبويب منفصل (تنقّل فقط)
              </button>
              <button
                onClick={() => setUseMic((v) => !v)}
                className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground"
              >
                {useMic ? <Mic className="size-3.5 text-primary" /> : <MicOff className="size-3.5" />}
                {useMic ? "التعليق بصوتي مفعّل" : "تعليق بصوتي"}
              </button>
              {mode === "cinema" && (
                <label className="ms-auto flex items-center gap-2 text-xs text-muted-foreground">
                  عمق التمرير
                  <input
                    type="range" min={1.5} max={5} step={0.5}
                    value={depth}
                    onChange={(e) => setDepth(Number(e.target.value))}
                    className="accent-primary"
                  />
                  <span className="tabular-nums">{depth}×</span>
                </label>
              )}
            </div>

            <ul className="space-y-2">
              {stops.map((s, i) => (
                <li key={s.path + i} className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    onChange={(e) => update(stops.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))}
                    className="accent-primary"
                  />
                  <span dir="ltr" className="flex-1 truncate text-xs">{s.path}</span>
                  <input
                    type="number" min={3} max={60}
                    value={s.seconds}
                    onChange={(e) => update(stops.map((x, j) => (j === i ? { ...x, seconds: Math.max(3, Number(e.target.value) || DEFAULT_SECONDS) } : x)))}
                    className="w-16 rounded-md border border-border bg-card/60 px-2 py-1 text-xs"
                  />
                  <span className="text-[10px] text-muted-foreground">ثانية</span>
                  <button onClick={() => move(i, -1)} className="text-muted-foreground hover:text-foreground"><ArrowUp className="size-3.5" /></button>
                  <button onClick={() => move(i, 1)} className="text-muted-foreground hover:text-foreground"><ArrowDown className="size-3.5" /></button>
                  <button onClick={() => update(stops.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></button>
                </li>
              ))}
            </ul>

            <div className="mt-3 flex items-center gap-2">
              <input
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addPath(); }}
                placeholder="/pricing"
                dir="ltr"
                className="flex-1 rounded-lg border border-border bg-card/60 px-3 py-2 text-xs outline-none focus:border-primary"
              />
              <button onClick={addPath} className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs hover:border-primary">
                <Plus className="size-3.5" /> إضافة
              </button>
              <span className="text-xs text-muted-foreground">مدة الفيديو ≈ {fmt(totalDuration(stops))}</span>
            </div>
          </div>
        )}

        <div
          ref={stageRef}
          className={`relative overflow-hidden bg-black ${cinemaLive ? "fixed inset-0 z-50 rounded-none" : "rounded-2xl border border-border aspect-video"}`}
        >
          {previewUrl && phase === "done" ? (
            <video src={previewUrl} controls className="h-full w-full object-contain" />
          ) : mode === "cinema" ? (
            <div ref={shellRef} className="relative h-full w-full overflow-hidden">
              <div
                className="absolute left-0 top-0 origin-top-left overflow-hidden transition-opacity duration-300"
                style={{ width: BASE_W, height: BASE_H, transform: `scale(${scale})`, opacity: fade ? 0 : 1 }}
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
          ) : (
            <video ref={videoRef} muted playsInline className="h-full w-full object-contain" />
          )}

          {phase === "idle" && !frameSrc && (
            <div className="absolute inset-0 grid place-items-center text-center px-6">
              <div className="text-muted-foreground text-sm">
                <Video className="size-8 mx-auto mb-3 opacity-50" />
                ستُعرض هنا جولة موقعك أثناء التصوير.
              </div>
            </div>
          )}

          {busy && (
            <div className="absolute inset-0 grid place-items-center bg-black/70 text-sm">
              <div className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" /> {message}
              </div>
            </div>
          )}

          {recording && !cinemaLive && (
            <div className="absolute top-3 right-3 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-xs">
              <span className="size-2 rounded-full bg-red-500 animate-pulse" />
              {fmt(seconds)} · {stopLabel}
            </div>
          )}
        </div>

        {cinemaLive && (
          <button
            onClick={stopRecording}
            className="fixed bottom-4 left-4 z-[60] rounded-full bg-destructive/90 px-4 py-2 text-xs text-destructive-foreground opacity-20 hover:opacity-100"
          >
            إيقاف
          </button>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">{message}</p>
          <div className="flex gap-2">
            {input && (
              <a
                href={normalizeUrl(input)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs hover:border-primary"
              >
                <ExternalLink className="size-3.5" /> فتح الموقع
              </a>
            )}
            {phase === "done" && previewUrl && (
              <button
                onClick={downloadAgain}
                className="inline-flex items-center gap-2 rounded-lg border border-primary px-3 py-2 text-xs text-primary"
              >
                <Download className="size-3.5" /> تنزيل مرة أخرى
              </button>
            )}
          </div>
        </div>

        <ol className="mt-8 space-y-2 text-xs text-muted-foreground list-decimal ps-5">
          <li>ضع الرابط ثم «اكتشف الصفحات»، ورتّب القائمة وحدّد مدة كل صفحة.</li>
          <li>اضغط «ابدأ الجولة» واختر «هذا التبويب» في نافذة المشاركة.</li>
          <li>يتحول العرض لملء الشاشة ويبدأ التنقّل والتمرير التلقائي.</li>
          <li>عند انتهاء آخر صفحة يتوقف التسجيل وينزل MP4 باسم موقعك تلقائياً.</li>
          <li>إن لم يظهر موقعك داخل العارض، بدّل إلى «تبويب منفصل».</li>
        </ol>
      </section>
    </main>
  );
}
