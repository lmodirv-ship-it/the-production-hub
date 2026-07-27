import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Sparkles, Video, Download, Square, Loader2, Mic, MicOff, ExternalLink } from "lucide-react";

const search = z.object({ url: z.string().optional() }).partial();

export const Route = createFileRoute("/studio")({
  validateSearch: (s) => search.parse(s),
  head: () => ({
    meta: [
      { title: "استوديو التسجيل — Eco AI" },
      { name: "description", content: "سجّل جولة على موقعك مباشرة من الشاشة واحصل على ملف MP4 جاهز للنشر." },
      { property: "og:title", content: "استوديو التسجيل — Eco AI" },
      { property: "og:description", content: "سجّل جولة على موقعك مباشرة من الشاشة واحصل على ملف MP4 جاهز للنشر." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StudioPage,
});

type Phase = "idle" | "recording" | "processing" | "done";

function normalizeUrl(raw: string) {
  const t = raw.trim();
  if (!t) return "";
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

function fileNameFor(raw: string) {
  try {
    const h = new URL(normalizeUrl(raw)).hostname.replace(/^www\./, "");
    return `${h.replace(/[^a-z0-9]+/gi, "_")}.mp4`;
  } catch {
    return "video.mp4";
  }
}

function fmt(sec: number) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function StudioPage() {
  const sp = useSearch({ from: "/studio" });

  const [input, setInput] = useState(sp.url ?? "");
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [useMic, setUseMic] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState("video.mp4");
  const [message, setMessage] = useState("ألصق رابط موقعك ثم اضغط «ابدأ التسجيل».");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamsRef = useRef<MediaStream[]>([]);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const siteWinRef = useRef<Window | null>(null);

  useEffect(() => {
    return () => {
      streamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    toast.success("اكتمل الفيديو وتم تنزيله.");
  }, [convertToMp4, downloadName]);

  const stopAll = useCallback(() => {
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    streamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streamsRef.current = [];
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const stopRecording = useCallback(() => {
    const rec = recRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }, []);

  async function startRecording() {
    const url = normalizeUrl(input);
    if (!url) { toast.error("أدخل رابط موقعك أولاً."); return; }
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
      toast.error("متصفحك لا يدعم تسجيل الشاشة. استخدم Chrome أو Edge على الحاسوب.");
      return;
    }

    if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }
    setDownloadName(fileNameFor(url));

    // 1) open the site so the user can pick that tab in the share dialog
    siteWinRef.current = window.open(url, "_blank", "noopener");
    setMessage("اختر تبويب موقعك في نافذة المشاركة…");

    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30, width: { ideal: 1920 }, height: { ideal: 1080 }, displaySurface: "browser" },
        audio: true,
        // record only the chosen tab, never this studio tab (avoids mirror-in-mirror)
        selfBrowserSurface: "exclude",
        surfaceSwitching: "exclude",
        preferCurrentTab: false,
      } as DisplayMediaStreamOptions);
    } catch (err) {
      console.error(err);
      setMessage("تم إلغاء المشاركة. اضغط «ابدأ التسجيل» للمحاولة مجدداً.");
      toast.error("لم يتم منح إذن مشاركة الشاشة.");
      return;
    }
    streamsRef.current.push(display);

    // 2) optional microphone narration mixed with tab audio
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

    const mixed = new MediaStream(tracks);
    // no live mirror while recording — showing it here creates the tunnel effect
    if (videoRef.current) videoRef.current.srcObject = null;

    const candidates = [
      "video/mp4;codecs=avc1,mp4a.40.2",
      "video/mp4",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    const mime = candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";

    const rec = new MediaRecorder(mixed, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
    recRef.current = rec;
    chunksRef.current = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
    rec.onstop = () => { stopAll(); void finalize(mime); };
    display.getVideoTracks()[0]?.addEventListener("ended", () => stopRecording());

    rec.start(1000);
    setPhase("recording");
    setSeconds(0);
    setMessage("جارٍ التسجيل — تصفّح موقعك بشكل طبيعي ثم اضغط «إيقاف وتنزيل».");
    timerRef.current = window.setInterval(() => {
      setSeconds((s) => {
        const next = s + 1;
        if (next === 300) toast.warning("تجاوز التسجيل 5 دقائق — قد يصبح حجم الملف كبيراً.");
        return next;
      });
    }, 1000);
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

  return (
    <main className="min-h-screen grid-bg">
      <header className="container mx-auto flex items-center justify-between py-5 px-6">
        <Link to="/" className="flex items-center gap-2 hover:opacity-80">
          <div className="size-9 rounded-xl bg-gradient-hero grid place-items-center glow-primary">
            <Sparkles className="size-5 text-primary-foreground" />
          </div>
          <span className="text-lg font-bold">Eco AI</span>
        </Link>
        <span className="text-xs text-muted-foreground">تسجيل شاشة → MP4</span>
      </header>

      <section className="container mx-auto px-6 pb-16 max-w-4xl">
        <h1 className="text-2xl md:text-3xl font-bold mb-2">سجّل جولة على موقعك</h1>
        <p className="text-sm text-muted-foreground mb-6">
          كل شيء يتم داخل متصفحك — بدون خدمات خارجية وبدون أي تكلفة.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !recording && !busy) void startRecording(); }}
            placeholder="example.com"
            dir="ltr"
            disabled={recording || busy}
            className="flex-1 rounded-xl border border-border bg-card/60 px-4 py-3 text-sm outline-none focus:border-primary disabled:opacity-60"
          />
          {!recording ? (
            <button
              onClick={() => void startRecording()}
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-hero px-6 py-3 text-sm font-semibold text-primary-foreground glow-primary disabled:opacity-60"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Video className="size-4" />}
              ابدأ التسجيل
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

        <button
          onClick={() => setUseMic((v) => !v)}
          disabled={recording || busy}
          className="mb-6 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-60"
        >
          {useMic ? <Mic className="size-3.5 text-primary" /> : <MicOff className="size-3.5" />}
          {useMic ? "التعليق بصوتي مفعّل" : "تسجيل تعليق بصوتي (اختياري)"}
        </button>

        <div className="relative overflow-hidden rounded-2xl border border-border bg-black aspect-video">
          {previewUrl && phase === "done" ? (
            <video src={previewUrl} controls className="h-full w-full object-contain" />
          ) : (
            <video ref={videoRef} muted playsInline className="h-full w-full object-contain" />
          )}

          {phase === "idle" && (
            <div className="absolute inset-0 grid place-items-center text-center px-6">
              <div className="text-muted-foreground text-sm">
                <Video className="size-8 mx-auto mb-3 opacity-50" />
                يُسجَّل تبويب موقعك فقط — بدون عرضه هنا حتى لا يتكرر داخل نفسه.
              </div>
            </div>
          )}

          {recording && (
            <div className="absolute inset-0 grid place-items-center text-center px-6">
              <div className="text-sm text-muted-foreground">
                <span className="mx-auto mb-3 block size-3 rounded-full bg-red-500 animate-pulse" />
                جارٍ تسجيل تبويب موقعك… انتقل إليه وتصفّح، ثم عُد واضغط «إيقاف وتنزيل».
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

          {recording && (
            <div className="absolute top-3 right-3 flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-xs">
              <span className="size-2 rounded-full bg-red-500 animate-pulse" />
              {fmt(seconds)}
            </div>
          )}
        </div>

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
          <li>ضع رابط موقعك واضغط «ابدأ التسجيل» — سيُفتح الموقع في تبويب جديد.</li>
          <li>في نافذة المشاركة اختر «تبويب Chrome» ثم تبويب موقعك، وفعّل «مشاركة صوت التبويب» إن أردت.</li>
          <li>تصفّح صفحات موقعك بهدوء — كل انتقال يُسجَّل.</li>
          <li>ارجع إلى هذه الصفحة واضغط «إيقاف وتنزيل» ليُحفظ ملف MP4 تلقائياً.</li>
        </ol>
      </section>
    </main>
  );
}
