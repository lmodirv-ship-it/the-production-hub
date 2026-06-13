import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  Sparkles, Wand2, Play, Pause, Download, Loader2, ImageIcon,
  Mic2, Volume2, RefreshCw, Film, Type, Video,
} from "lucide-react";
import { generateScript, generateSceneImage, type Scene, type ScriptResult } from "@/lib/ai.functions";

const search = z.object({
  url: z.string().optional(),
  topic: z.string().optional(),
}).partial();

export const Route = createFileRoute("/studio")({
  validateSearch: (s) => search.parse(s),
  component: StudioPage,
});

type SceneState = Scene & { imageUrl?: string; imageLoading?: boolean };

function StudioPage() {
  const sp = useSearch({ from: "/studio" });
  const genScript = useServerFn(generateScript);
  const genImage = useServerFn(generateSceneImage);

  const [input, setInput] = useState(sp.url ?? "");
  const [topic, setTopic] = useState(sp.topic ?? "");
  const [mode, setMode] = useState<"url" | "topic">(sp.topic ? "topic" : "url");
  const [meta, setMeta] = useState<{ title: string; summary: string } | null>(null);
  const [scenes, setScenes] = useState<SceneState[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [scriptLoading, setScriptLoading] = useState(false);
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const playRef = useRef<{ cancelled: boolean }>({ cancelled: false });
  const exportRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  // Load voices
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const load = () => {
      const v = window.speechSynthesis.getVoices();
      setVoices(v);
      if (!voice && v.length) {
        const ar = v.find((x) => x.lang.startsWith("ar")) ?? v[0];
        setVoice(ar);
      }
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, [voice]);

  // Auto-run if a URL was supplied via query
  useEffect(() => {
    if (sp.url && scenes.length === 0 && !scriptLoading) {
      handleGenerate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleGenerate() {
    const url = mode === "url" ? input.trim() : undefined;
    const topicVal = mode === "topic" ? (topic.trim() || input.trim()) : undefined;
    if (!url && !topicVal) {
      toast.error("أدخل رابطاً أو موضوعاً أولاً");
      return;
    }
    setScriptLoading(true);
    setScenes([]);
    setMeta(null);
    try {
      const result: ScriptResult = await genScript({ data: { url, topic: topicVal, language: "ar" } });
      setMeta({ title: result.title, summary: result.summary });
      setScenes(result.scenes.map((s) => ({ ...s })));
      setActiveIdx(0);
      toast.success("تم توليد السكربت ✨");
      // Save to history
      try {
        const hist = JSON.parse(localStorage.getItem("ecoai_projects") ?? "[]");
        hist.unshift({ id: crypto.randomUUID(), createdAt: Date.now(), ...result, source: url ?? topicVal });
        localStorage.setItem("ecoai_projects", JSON.stringify(hist.slice(0, 20)));
      } catch {}
      // Auto-generate first image
      void generateImageFor(0, result.scenes[0]);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "فشل توليد السكربت");
    } finally {
      setScriptLoading(false);
    }
  }

  async function generateImageFor(idx: number, scene: Scene) {
    setScenes((prev) => prev.map((s, i) => (i === idx ? { ...s, imageLoading: true } : s)));
    try {
      const { dataUrl } = await genImage({ data: { prompt: scene.imagePrompt } });
      setScenes((prev) => prev.map((s, i) => (i === idx ? { ...s, imageUrl: dataUrl, imageLoading: false } : s)));
    } catch (e: unknown) {
      setScenes((prev) => prev.map((s, i) => (i === idx ? { ...s, imageLoading: false } : s)));
      toast.error(e instanceof Error ? e.message : "فشل توليد الصورة");
    }
  }

  function speak(text: string): Promise<void> {
    return new Promise((resolve) => {
      if (typeof window === "undefined" || !window.speechSynthesis) { resolve(); return; }
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.rate = rate;
      u.pitch = pitch;
      u.lang = voice?.lang ?? "ar-SA";
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
    });
  }

  async function playAll() {
    if (!scenes.length) return;
    window.speechSynthesis?.cancel();
    playRef.current = { cancelled: false };
    setPlaying(true);
    for (let i = 0; i < scenes.length; i++) {
      if (playRef.current.cancelled) break;
      setActiveIdx(i);
      setProgress(((i) / scenes.length) * 100);
      // Ensure image exists
      if (!scenes[i].imageUrl && !scenes[i].imageLoading) {
        void generateImageFor(i, scenes[i]);
      }
      await speak(scenes[i].narration);
    }
    setProgress(100);
    setPlaying(false);
  }

  function stop() {
    playRef.current.cancelled = true;
    window.speechSynthesis?.cancel();
    setPlaying(false);
  }

  function exportScript() {
    if (!scenes.length) return;
    const txt = `${meta?.title ?? ""}\n\n${meta?.summary ?? ""}\n\n` +
      scenes.map((s, i) => `--- Scene ${i + 1}: ${s.title} ---\n${s.narration}\n\n[Visual] ${s.imagePrompt}`).join("\n\n");
    const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(meta?.title ?? "script").replace(/[^a-z0-9\u0600-\u06FF]+/gi, "_")}.txt`;
    a.click();
  }

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
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = w;
      } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  async function exportVideo() {
    if (!scenes.length) { toast.error("لا توجد مشاهد لتصديرها"); return; }
    setExporting(true);
    setExportProgress(0);
    exportRef.current = { cancelled: false };
    try {
      // 1) Ensure all images are generated
      const ready: SceneState[] = [...scenes];
      for (let i = 0; i < ready.length; i++) {
        if (exportRef.current.cancelled) throw new Error("cancelled");
        if (!ready[i].imageUrl) {
          toast.info(`توليد صورة المشهد ${i + 1}…`);
          try {
            const { dataUrl } = await genImage({ data: { prompt: ready[i].imagePrompt } });
            ready[i] = { ...ready[i], imageUrl: dataUrl };
            setScenes((prev) => prev.map((s, idx) => idx === i ? { ...s, imageUrl: dataUrl } : s));
          } catch {
            toast.error(`تعذّر توليد صورة المشهد ${i + 1}`);
          }
        }
        setExportProgress(((i + 1) / (ready.length * 2)) * 100);
      }

      // 2) Pre-load image elements
      const imgs: (HTMLImageElement | null)[] = [];
      for (const s of ready) {
        imgs.push(s.imageUrl ? await loadImg(s.imageUrl).catch(() => null) : null);
      }

      // 3) Setup canvas + MediaRecorder
      const W = 1280, H = 720;
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d")!;
      const fps = 30;
      const stream = canvas.captureStream(fps);

      // Try to add silent audio track for compatibility
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
      } catch {}

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
      const done = new Promise<Blob>((resolve) => {
        rec.onstop = () => resolve(new Blob(chunks, { type: mime }));
      });
      rec.start(100);

      // 4) Animate each scene with Ken Burns + caption
      const totalScenes = ready.length;
      // Estimate duration per scene from narration length (Arabic ~3 chars/sec spoken slow → use words)
      const durations = ready.map((s) => {
        const words = s.narration.trim().split(/\s+/).length;
        return Math.max(3.5, Math.min(9, words / 2.2));
      });

      const startTime = performance.now();
      for (let i = 0; i < totalScenes; i++) {
        if (exportRef.current.cancelled) break;
        const sceneDur = durations[i] * 1000;
        const sceneStart = performance.now();
        const img = imgs[i];
        const scene = ready[i];

        while (true) {
          if (exportRef.current.cancelled) break;
          const t = performance.now() - sceneStart;
          if (t >= sceneDur) break;
          const p = t / sceneDur; // 0..1

          // BG
          ctx.fillStyle = "#0a0a14";
          ctx.fillRect(0, 0, W, H);

          if (img) {
            // Ken Burns: zoom 1.0 → 1.12, slight pan
            const zoom = 1.0 + 0.12 * p;
            const iw = img.width, ih = img.height;
            const scale = Math.max(W / iw, H / ih) * zoom;
            const dw = iw * scale, dh = ih * scale;
            const panX = (p - 0.5) * 40;
            const panY = (p - 0.5) * 20;
            const dx = (W - dw) / 2 + panX;
            const dy = (H - dh) / 2 + panY;
            ctx.drawImage(img, dx, dy, dw, dh);
          } else {
            const grad = ctx.createLinearGradient(0, 0, W, H);
            grad.addColorStop(0, "#1a103d");
            grad.addColorStop(1, "#0a0a14");
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, W, H);
          }

          // Bottom gradient overlay
          const og = ctx.createLinearGradient(0, H * 0.45, 0, H);
          og.addColorStop(0, "rgba(0,0,0,0)");
          og.addColorStop(1, "rgba(0,0,0,0.85)");
          ctx.fillStyle = og;
          ctx.fillRect(0, H * 0.45, W, H * 0.55);

          // Title (top-left fade-in)
          const fadeIn = Math.min(1, p * 4);
          ctx.globalAlpha = fadeIn;
          ctx.fillStyle = "#a78bfa";
          ctx.font = "600 26px 'Tajawal', system-ui, sans-serif";
          ctx.textAlign = "right";
          ctx.direction = "rtl";
          ctx.fillText(`المشهد ${i + 1} / ${totalScenes}`, W - 40, 50);

          ctx.fillStyle = "#fff";
          ctx.font = "700 42px 'Tajawal', system-ui, sans-serif";
          ctx.fillText(scene.title, W - 40, 100);
          ctx.globalAlpha = 1;

          // Narration caption (bottom, wrapped)
          ctx.fillStyle = "#fff";
          ctx.font = "500 30px 'Tajawal', system-ui, sans-serif";
          ctx.textAlign = "right";
          const maxW = W - 80;
          const lines = wrapText(ctx, scene.narration, maxW);
          const lineH = 42;
          const baseY = H - 60 - (lines.length - 1) * lineH;
          for (let li = 0; li < lines.length; li++) {
            ctx.fillText(lines[li], W - 40, baseY + li * lineH);
          }

          // Progress bar
          const overall = (i + p) / totalScenes;
          ctx.fillStyle = "rgba(255,255,255,0.15)";
          ctx.fillRect(40, H - 14, W - 80, 4);
          ctx.fillStyle = "#a78bfa";
          ctx.fillRect(40, H - 14, (W - 80) * overall, 4);

          // Branding
          ctx.textAlign = "left";
          ctx.fillStyle = "rgba(255,255,255,0.6)";
          ctx.font = "600 20px system-ui, sans-serif";
          ctx.fillText("EcoAI Studio", 40, 50);

          setExportProgress(50 + overall * 50);
          await new Promise((r) => setTimeout(r, 1000 / fps));
        }
      }

      rec.stop();
      const blob = await done;
      const isMp4 = mime.startsWith("video/mp4");
      const safeName = (meta?.title ?? "video").replace(/[^a-z0-9\u0600-\u06FF]+/gi, "_");

      let finalBlob = blob;
      let ext = isMp4 ? "mp4" : "webm";

      if (!isMp4) {
        toast.info("جاري التحويل إلى MP4… قد يستغرق دقيقة");
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
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "23",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            "out.mp4",
          ]);
          const data = await ffmpeg.readFile("out.mp4");
          const u8 = data as Uint8Array;
          finalBlob = new Blob([u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer], { type: "video/mp4" });
          ext = "mp4";
        } catch (err) {
          console.error("ffmpeg convert failed", err);
          toast.error("تعذّر التحويل إلى MP4 — سيتم تنزيل WebM بدلاً منه");
        }
      }

      const a = document.createElement("a");
      a.href = URL.createObjectURL(finalBlob);
      a.download = `${safeName}.${ext}`;
      a.click();
      toast.success(`تم تصدير الفيديو (${ext.toUpperCase()}) 🎬`);
      const _elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
      void _elapsed;
    } catch (e: unknown) {
      if ((e as Error)?.message !== "cancelled") {
        toast.error(e instanceof Error ? e.message : "فشل تصدير الفيديو");
      }
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  }

  function cancelExport() {
    exportRef.current.cancelled = true;
  }

  const active = scenes[activeIdx];
  const arabicVoices = useMemo(() => voices.filter((v) => v.lang.startsWith("ar")), [voices]);
  const otherVoices = useMemo(() => voices.filter((v) => !v.lang.startsWith("ar")).slice(0, 8), [voices]);

  return (
    <main className="min-h-screen grid-bg">
      {/* Top bar */}
      <header className="container mx-auto flex items-center justify-between py-5 px-6">
        <Link to="/" className="flex items-center gap-2 hover:opacity-80">
          <div className="size-9 rounded-xl bg-gradient-hero grid place-items-center glow-primary">
            <Sparkles className="size-5 text-primary-foreground" />
          </div>
          <span className="font-display text-xl font-bold">Eco<span className="text-gradient">AI</span></span>
        </Link>
        <div className="flex items-center gap-2">
          <button onClick={exportScript} disabled={!scenes.length} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent inline-flex items-center gap-2 disabled:opacity-50">
            <Download className="size-4" /> تنزيل السكربت
          </button>
          {exporting ? (
            <button onClick={cancelExport} className="rounded-lg bg-destructive px-3 py-2 text-sm inline-flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" /> إلغاء ({exportProgress.toFixed(0)}%)
            </button>
          ) : (
            <button onClick={exportVideo} disabled={!scenes.length} className="rounded-lg bg-gradient-hero px-3 py-2 text-sm font-semibold text-primary-foreground inline-flex items-center gap-2 disabled:opacity-50">
              <Video className="size-4" /> تصدير فيديو
            </button>
          )}
        </div>
      </header>

      {/* Input bar */}
      <section className="container mx-auto px-6">
        <div className="glass-panel p-3 flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border overflow-hidden text-xs">
            <button onClick={() => setMode("url")} className={`px-3 py-2 ${mode === "url" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>رابط موقع</button>
            <button onClick={() => setMode("topic")} className={`px-3 py-2 ${mode === "topic" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>موضوع نصي</button>
          </div>
          {mode === "url" ? (
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="https://example.com"
              dir="ltr"
              className="flex-1 min-w-[200px] bg-input/50 rounded-lg px-3 py-2 outline-none text-right placeholder:text-muted-foreground border border-border"
            />
          ) : (
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="مثال: تطبيق توصيل طلبات الطعام بسرعة فائقة"
              className="flex-1 min-w-[200px] bg-input/50 rounded-lg px-3 py-2 outline-none border border-border"
            />
          )}
          <button
            onClick={handleGenerate}
            disabled={scriptLoading}
            className="rounded-lg bg-gradient-hero px-5 py-2.5 font-semibold text-primary-foreground hover:opacity-90 inline-flex items-center gap-2 disabled:opacity-60"
          >
            {scriptLoading ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
            {scenes.length ? "أعد التوليد" : "ولّد السكربت"}
          </button>
        </div>
      </section>

      {/* Studio grid — only the preview is visible; scene & image editors run in the background */}
      <section className="container mx-auto px-6 mt-6 grid grid-cols-12 gap-4 pb-12">


        {/* Preview center */}
        <div className="col-span-12 space-y-4">
          <div className="glass-panel overflow-hidden">
            <div className="aspect-video bg-black relative">
              {active?.imageUrl ? (
                <img src={active.imageUrl} alt={active.title} className="w-full h-full object-cover" />
              ) : active?.imageLoading ? (
                <div className="absolute inset-0 grid place-items-center text-muted-foreground">
                  <Loader2 className="size-8 animate-spin" />
                </div>
              ) : scenes.length ? (
                <div className="absolute inset-0 grid place-items-center text-muted-foreground gap-2 flex-col flex">
                  <ImageIcon className="size-10" />
                  <button onClick={() => active && generateImageFor(activeIdx, active)} className="text-xs underline">توليد صورة المشهد</button>
                </div>
              ) : (
                <div className="absolute inset-0 grid place-items-center text-muted-foreground/60 text-sm bg-gradient-hero/10">
                  ألصق رابطاً أعلاه ثم اضغط "ولّد السكربت" للبدء
                </div>
              )}
              {active && (
                <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
                  <p className="text-sm leading-relaxed">{active.narration}</p>
                </div>
              )}
              {active && (
                <div className="absolute top-3 right-3 rounded-full bg-black/60 px-3 py-1 text-xs backdrop-blur">
                  المشهد {activeIdx + 1} / {scenes.length}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between p-3 border-t border-border">
              <div className="flex items-center gap-2">
                {playing ? (
                  <button onClick={stop} className="rounded-lg bg-destructive px-4 py-2 text-sm font-medium inline-flex items-center gap-2"><Pause className="size-4" /> إيقاف</button>
                ) : (
                  <button onClick={playAll} disabled={!scenes.length} className="rounded-lg bg-gradient-hero px-4 py-2 text-sm font-semibold text-primary-foreground inline-flex items-center gap-2 disabled:opacity-50">
                    <Play className="size-4" /> تشغيل الفيديو
                  </button>
                )}
                <button onClick={() => active && generateImageFor(activeIdx, active)} disabled={!active} className="rounded-lg border border-border px-3 py-2 text-sm hover:bg-accent inline-flex items-center gap-2 disabled:opacity-50">
                  <RefreshCw className="size-4" /> تجديد الصورة
                </button>
              </div>
              <div className="text-xs text-muted-foreground">{meta?.title}</div>
            </div>
          </div>

          {/* Timeline */}
          <div className="glass-panel p-3">
            <div className="text-xs text-muted-foreground mb-2 px-1">الخط الزمني</div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {scenes.length === 0 && Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="shrink-0 w-32 h-20 rounded-lg bg-muted/40 border border-border" />
              ))}
              {scenes.map((s, i) => (
                <button
                  key={s.id}
                  onClick={() => setActiveIdx(i)}
                  className={`shrink-0 w-32 h-20 rounded-lg overflow-hidden border-2 relative ${i === activeIdx ? "border-neon glow-neon" : "border-border hover:border-primary/60"}`}
                >
                  {s.imageUrl ? (
                    <img src={s.imageUrl} className="w-full h-full object-cover" alt="" />
                  ) : (
                    <div className="w-full h-full bg-muted/50 grid place-items-center">
                      {s.imageLoading ? <Loader2 className="size-4 animate-spin" /> : <ImageIcon className="size-4 text-muted-foreground" />}
                    </div>
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-[10px] py-0.5">مشهد {i + 1}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Scene editor & image editor work silently in the background — UI hidden by request */}

      </section>

      {meta && (
        <section className="container mx-auto px-6 pb-16">
          <div className="glass-panel p-5">
            <h2 className="font-display text-2xl font-bold">{meta.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{meta.summary}</p>
          </div>
        </section>
      )}
    </main>
  );
}
