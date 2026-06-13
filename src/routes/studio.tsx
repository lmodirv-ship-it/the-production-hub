import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Sparkles, Wand2, Loader2, Video } from "lucide-react";
import { generateScript, captureScreenshots, type Scene, type ScriptResult } from "@/lib/ai.functions";

const search = z.object({ url: z.string().optional() }).partial();

export const Route = createFileRoute("/studio")({
  validateSearch: (s) => search.parse(s),
  component: StudioPage,
});

type SceneState = Scene & { imageUrl?: string };
type Stage = "idle" | "capture" | "script" | "voice" | "merge" | "done";

const STAGE_LABEL: Record<Stage, string> = {
  idle: "جاهز",
  capture: "التقاط صور الموقع…",
  script: "كتابة النص…",
  voice: "تجهيز الصوت…",
  merge: "دمج الفيديو…",
  done: "اكتمل ✓",
};

function StudioPage() {
  const sp = useSearch({ from: "/studio" });
  const genScript = useServerFn(generateScript);
  const capture = useServerFn(captureScreenshots);

  const [input, setInput] = useState(sp.url ?? "");
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [scenes, setScenes] = useState<SceneState[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [running, setRunning] = useState(false);
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null);
  const [message, setMessage] = useState("ألصق رابط موقعك واضغط إنشاء الفيديو.");

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const load = () => {
      const v = window.speechSynthesis.getVoices();
      if (v.length) setVoice(v.find((x) => x.lang.startsWith("ar")) ?? v[0]);
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  useEffect(() => {
    if (sp.url && stage === "idle") void runPipeline(sp.url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadImg(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  function speak(text: string): Promise<void> {
    return new Promise((resolve) => {
      if (typeof window === "undefined" || !window.speechSynthesis) { resolve(); return; }
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.lang = voice?.lang ?? "ar-SA";
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
    });
  }

  async function runPipeline(rawUrl: string) {
    const url = rawUrl.trim();
    if (!url) { toast.error("أدخل رابط الموقع"); return; }
    setRunning(true);
    setScenes([]);
    setActiveIdx(0);
    setMessage("بدأ العمل على فيديو تعريفي لموقعك…");
    try {
      // Stage 1: capture real screenshots of the website
      setStage("capture"); setProgress(5);
      setMessage("جاري التقاط صور حقيقية من موقعك…");
      const shotsRes = await capture({ data: { url, count: 5 } }).catch(() => ({ shots: [] as string[], pages: [] as string[] }));
      setProgress(30);

      // Stage 2: script
      setStage("script");
      setMessage("جاري كتابة سكربت الفيديو…");
      const result: ScriptResult = await genScript({ data: { url, language: "ar" } });
      const list: SceneState[] = result.scenes.map((s, i) => ({
        ...s,
        imageUrl: shotsRes.shots[i] || shotsRes.shots[0] || undefined,
      }));
      if (!list.length) throw new Error("لم أستطع تكوين مشاهد للفيديو من هذا الرابط.");
      setScenes(list);
      setActiveIdx(0);
      setMessage(result.fallback ? "سكربت احتياطي (الذكاء الاصطناعي غير متاح حالياً) — مع صور حقيقية لموقعك." : "تمت كتابة السكربت ✓");
      setProgress(60);

      // Stage 3: voice (preparing — actual TTS runs inside merge)
      setStage("voice"); setProgress(65);
      await new Promise((r) => setTimeout(r, 300));

      // Stage 4: merge
      setStage("merge");
      setMessage("يتم الآن تركيب المشاهد وتنزيل ملف الفيديو تلقائياً…");
      await renderVideo(list, url, (p) => setProgress(65 + p * 0.35));

      setStage("done"); setProgress(100);
      setMessage("تم إنشاء الملف وتنزيله. إذا لم يظهر، تحقق من مجلد التنزيلات في المتصفح.");
      toast.success("تم إنشاء الفيديو 🎬");
    } catch (e: unknown) {
      const text = e instanceof Error ? e.message : "فشل الإنشاء";
      setMessage(text);
      toast.error(text);
      setStage("idle");
    } finally {
      setRunning(false);
    }
  }

  async function renderVideo(list: SceneState[], url: string, onProgress: (p: number) => void) {
    const imgs: (HTMLImageElement | null)[] = [];
    for (const s of list) imgs.push(s.imageUrl ? await loadImg(s.imageUrl).catch(() => null) : null);

    const W = 1280, H = 720;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    const fps = 30;
    const stream = canvas.captureStream(fps);

    try {
      const ac = new AudioContext();
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      const dest = ac.createMediaStreamDestination();
      gain.connect(dest);
      osc.start();
      dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    } catch { /* ignore */ }

    const mimeCandidates = [
      "video/mp4;codecs=avc1.42E01E",
      "video/mp4",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ];
    const mime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise<Blob>((resolve) => { rec.onstop = () => resolve(new Blob(chunks, { type: mime })); });
    rec.start(100);

    const total = list.length;
    const durations = list.map((s) => {
      const words = s.narration.trim().split(/\s+/).length;
      return Math.max(3.5, Math.min(9, words / 2.2));
    });

    for (let i = 0; i < total; i++) {
      setActiveIdx(i);
      // start narration in background
      void speak(list[i].narration);
      const sceneDur = durations[i] * 1000;
      const sceneStart = performance.now();
      const img = imgs[i];
      const scene = list[i];

      while (true) {
        const t = performance.now() - sceneStart;
        if (t >= sceneDur) break;
        const p = t / sceneDur;

        ctx.fillStyle = "#0a0a14"; ctx.fillRect(0, 0, W, H);
        if (img) {
          const zoom = 1.0 + 0.12 * p;
          const scale = Math.max(W / img.width, H / img.height) * zoom;
          const dw = img.width * scale, dh = img.height * scale;
          const dx = (W - dw) / 2 + (p - 0.5) * 40;
          const dy = (H - dh) / 2 + (p - 0.5) * 20;
          ctx.drawImage(img, dx, dy, dw, dh);
        } else {
          const grad = ctx.createLinearGradient(0, 0, W, H);
          grad.addColorStop(0, "#1a103d"); grad.addColorStop(1, "#0a0a14");
          ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
        }

        const og = ctx.createLinearGradient(0, H * 0.45, 0, H);
        og.addColorStop(0, "rgba(0,0,0,0)");
        og.addColorStop(1, "rgba(0,0,0,0.85)");
        ctx.fillStyle = og; ctx.fillRect(0, H * 0.45, W, H * 0.55);

        ctx.fillStyle = "#fff";
        ctx.font = "500 30px 'Tajawal', system-ui, sans-serif";
        ctx.textAlign = "right";
        ctx.direction = "rtl";
        const lines = wrapText(ctx, scene.narration, W - 80);
        const lineH = 42;
        const baseY = H - 60 - (lines.length - 1) * lineH;
        for (let li = 0; li < lines.length; li++) ctx.fillText(lines[li], W - 40, baseY + li * lineH);

        const overall = (i + p) / total;
        ctx.fillStyle = "rgba(255,255,255,0.15)"; ctx.fillRect(40, H - 14, W - 80, 4);
        ctx.fillStyle = "#a78bfa"; ctx.fillRect(40, H - 14, (W - 80) * overall, 4);

        onProgress(overall);
        await new Promise((r) => setTimeout(r, 1000 / fps));
      }
    }

    rec.stop();
    const blob = await done;
    const isMp4 = mime.startsWith("video/mp4");

    let safeName = "video";
    try {
      const h = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./, "");
      if (h) safeName = h.replace(/[^a-z0-9.-]+/gi, "_");
    } catch { /* ignore */ }

    let finalBlob = blob;
    let ext = isMp4 ? "mp4" : "webm";

    if (!isMp4) {
      toast.info("جاري التحويل إلى MP4…");
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
          "-i", "in.webm", "-c:v", "libx264", "-preset", "veryfast",
          "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "out.mp4",
        ]);
        const data = await ffmpeg.readFile("out.mp4");
        const u8 = data as Uint8Array;
        finalBlob = new Blob([u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer], { type: "video/mp4" });
        ext = "mp4";
      } catch (err) {
        console.error("ffmpeg convert failed", err);
        toast.error("تعذّر التحويل إلى MP4 — سيتم تنزيل WebM");
      }
    }

    const a = document.createElement("a");
    a.href = URL.createObjectURL(finalBlob);
    a.download = `${safeName}.${ext}`;
    a.click();
  }

  const active = scenes[activeIdx];

  return (
    <main className="min-h-screen grid-bg">
      <header className="container mx-auto flex items-center justify-between py-5 px-6">
        <Link to="/" className="flex items-center gap-2 hover:opacity-80">
          <div className="size-9 rounded-xl bg-gradient-hero grid place-items-center glow-primary">
            <Sparkles className="size-5 text-primary-foreground" />
          </div>
          <span className="font-display text-xl font-bold">Eco<span className="text-gradient">AI</span></span>
        </Link>
      </header>

      <section className="container mx-auto px-6">
        <div className="glass-panel p-3 flex flex-wrap items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="https://example.com"
            dir="ltr"
            disabled={running}
            className="flex-1 min-w-[200px] bg-input/50 rounded-lg px-3 py-2 outline-none text-right placeholder:text-muted-foreground border border-border disabled:opacity-60"
          />
          <button
            onClick={() => runPipeline(input)}
            disabled={running}
            className="rounded-lg bg-gradient-hero px-5 py-2.5 font-semibold text-primary-foreground hover:opacity-90 inline-flex items-center gap-2 disabled:opacity-60"
          >
            {running ? <Loader2 className="size-4 animate-spin" /> : <Video className="size-4" />}
            {running ? "جارٍ الإنشاء…" : "إنشاء الفيديو"}
          </button>
        </div>
      </section>

      <section className="container mx-auto px-6 mt-6 pb-12">
        <div className="glass-panel overflow-hidden">
          <div className="aspect-video bg-black relative">
            {active?.imageUrl ? (
              <img src={active.imageUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="absolute inset-0 grid place-items-center text-muted-foreground/70 text-sm bg-gradient-hero/10">
                {running ? <Loader2 className="size-10 animate-spin" /> : <span className="inline-flex items-center gap-2"><Wand2 className="size-5" /> ألصق رابط موقعك واضغط "إنشاء الفيديو"</span>}
              </div>
            )}
            {active && (
              <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
                <p className="text-sm leading-relaxed">{active.narration}</p>
              </div>
            )}
          </div>

          {/* Progress */}
          <div className="p-4 border-t border-border space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{STAGE_LABEL[stage]}</span>
              <span>{progress.toFixed(0)}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
              <div className="h-full bg-gradient-hero transition-[width] duration-300" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed text-right">{message}</p>
          </div>
        </div>
      </section>
    </main>
  );
}
