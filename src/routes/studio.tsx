import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Sparkles, Wand2, Loader2, Video, Download, RefreshCw } from "lucide-react";
import { generateScript, captureScreenshots, type Scene, type ScriptResult, type Branding } from "@/lib/ai.functions";

const search = z.object({ url: z.string().optional() }).partial();

export const Route = createFileRoute("/studio")({
  validateSearch: (s) => search.parse(s),
  component: StudioPage,
});

type SceneState = Scene & { imageUrl?: string; isIntro?: boolean; isOutro?: boolean };
type Stage = "idle" | "capture" | "script" | "merge" | "done";

const STAGE_LABEL: Record<Stage, string> = {
  idle: "جاهز",
  capture: "التقاط صور وهوية الموقع…",
  script: "كتابة النص…",
  merge: "تركيب الفيديو…",
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState("video.mp4");

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
    setPreviewUrl(null);
    setMessage("بدأ العمل على فيديو تعريفي لموقعك…");
    try {
      setStage("capture"); setProgress(5);
      setMessage("جاري التقاط صور حقيقية واستخراج هوية الموقع عبر Firecrawl…");
      const shotsRes = await capture({ data: { url, count: 5 } }).catch(() => ({
        shots: [] as string[], pages: [] as string[], branding: {} as Branding, content: "", title: "",
      }));
      setProgress(35);

      setStage("script");
      setMessage("جاري كتابة سكربت الفيديو…");
      const result: ScriptResult = await genScript({ data: { url, language: "ar" } });
      const siteTitle = shotsRes.title || result.title || hostFrom(url);
      const list: SceneState[] = result.scenes.map((s, i) => ({
        ...s,
        imageUrl: shotsRes.shots[i] || shotsRes.shots.find(Boolean) || undefined,
      }));
      if (!list.length) throw new Error("لم أستطع تكوين مشاهد للفيديو من هذا الرابط.");
      setScenes(list);
      setActiveIdx(0);
      setMessage(result.fallback ? "سكربت احتياطي مع صور حقيقية لموقعك." : "تمت كتابة السكربت ✓");
      setProgress(55);

      setStage("merge");
      setMessage("جاري تركيب المشاهد بالموسيقى والهوية البصرية لموقعك…");
      const branding = shotsRes.branding ?? {};
      const logo = branding.logo ? await loadImg(branding.logo).catch(() => null) : null;
      const blob = await renderVideo(list, url, siteTitle, branding, logo, (p) => setProgress(55 + p * 0.45));

      const host = hostFrom(url);
      const name = `${host.replace(/[^a-z0-9.-]+/gi, "_")}.mp4`;
      setDownloadName(name);
      setPreviewUrl(URL.createObjectURL(blob));

      setStage("done"); setProgress(100);
      setMessage("الفيديو جاهز! شاهد المعاينة ثم اضغط تنزيل.");
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

  function hostFrom(u: string) {
    try { return new URL(u.startsWith("http") ? u : `https://${u}`).hostname.replace(/^www\./, ""); }
    catch { return "موقعك"; }
  }

  async function renderVideo(
    list: SceneState[],
    url: string,
    siteTitle: string,
    branding: Branding,
    logo: HTMLImageElement | null,
    onProgress: (p: number) => void,
  ): Promise<Blob> {
    const imgs: (HTMLImageElement | null)[] = [];
    for (const s of list) imgs.push(s.imageUrl ? await loadImg(s.imageUrl).catch(() => null) : null);

    const W = 1280, H = 720;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    const fps = 30;
    const stream = canvas.captureStream(fps);

    // silent audio track so MediaRecorder always has audio
    try {
      const ac = new AudioContext();
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      gain.gain.value = 0; osc.connect(gain);
      const dest = ac.createMediaStreamDestination();
      gain.connect(dest); osc.start();
      dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    } catch { /* ignore */ }

    const mimeCandidates = [
      "video/mp4;codecs=avc1.42E01E", "video/mp4",
      "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm",
    ];
    const mime = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise<Blob>((resolve) => { rec.onstop = () => resolve(new Blob(chunks, { type: mime })); });
    rec.start(100);

    const host = hostFrom(url);
    const bgColor = branding.background || "#0a0a14";
    const primary = branding.primary || "#a78bfa";
    const accent = branding.accent || "#ec4899";
    const textColor = branding.textPrimary || "#ffffff";

    // build full timeline: intro (3s) + scenes + outro (3.5s)
    const sceneDurs = list.map((s) => {
      const words = s.narration.trim().split(/\s+/).length;
      return Math.max(3.5, Math.min(8.5, words / 2.2));
    });
    const introDur = 3, outroDur = 3.5;
    const totalSec = introDur + sceneDurs.reduce((a, b) => a + b, 0) + outroDur;
    let elapsed = 0;

    const drawBg = (p: number) => {
      const grad = ctx.createLinearGradient(0, 0, W, H);
      grad.addColorStop(0, bgColor);
      grad.addColorStop(1, shade(bgColor, -25));
      ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
      // accent blob
      const r = 350 + Math.sin(p * Math.PI * 2) * 30;
      const cg = ctx.createRadialGradient(W * (0.2 + p * 0.6), H * 0.3, 0, W * (0.2 + p * 0.6), H * 0.3, r);
      cg.addColorStop(0, hexA(primary, 0.35));
      cg.addColorStop(1, hexA(primary, 0));
      ctx.fillStyle = cg; ctx.fillRect(0, 0, W, H);
    };

    const drawLogo = () => {
      if (!logo) return;
      const maxH = 56, ratio = logo.width / logo.height;
      const lh = maxH, lw = lh * ratio;
      ctx.globalAlpha = 0.95;
      ctx.drawImage(logo, 40, 36, lw, lh);
      ctx.globalAlpha = 1;
    };

    const drawProgress = (overall: number) => {
      ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fillRect(40, H - 14, W - 80, 4);
      const pg = ctx.createLinearGradient(40, 0, W - 40, 0);
      pg.addColorStop(0, primary); pg.addColorStop(1, accent);
      ctx.fillStyle = pg; ctx.fillRect(40, H - 14, (W - 80) * overall, 4);
    };

    const fadeAlpha = (sceneProgress: number, dur: number) => {
      const fadeIn = Math.min(1, (sceneProgress * dur) / 0.4);
      const fadeOut = Math.min(1, ((1 - sceneProgress) * dur) / 0.4);
      return Math.min(fadeIn, fadeOut);
    };

    // INTRO
    {
      const start = performance.now();
      while (true) {
        const t = (performance.now() - start) / 1000;
        if (t >= introDur) break;
        const p = t / introDur;
        const fa = fadeAlpha(p, introDur);
        drawBg(p);
        drawLogo();

        ctx.save();
        ctx.globalAlpha = fa;
        ctx.textAlign = "center";
        ctx.direction = "rtl";
        ctx.fillStyle = textColor;
        ctx.font = "700 64px system-ui, sans-serif";
        const title = truncate(siteTitle, 40);
        const ty = H * 0.45 + (1 - fa) * 20;
        ctx.fillText(title, W / 2, ty);

        ctx.font = "500 28px system-ui, sans-serif";
        ctx.fillStyle = hexA(textColor, 0.7);
        ctx.fillText(host, W / 2, ty + 60);
        ctx.restore();

        drawProgress(elapsed / totalSec + t / totalSec);
        onProgress((elapsed + t) / totalSec);
        await new Promise((r) => setTimeout(r, 1000 / fps));
      }
      elapsed += introDur;
    }

    // SCENES
    for (let i = 0; i < list.length; i++) {
      setActiveIdx(i);
      void speak(list[i].narration);
      const dur = sceneDurs[i];
      const start = performance.now();
      const img = imgs[i];
      const scene = list[i];

      while (true) {
        const t = (performance.now() - start) / 1000;
        if (t >= dur) break;
        const p = t / dur;
        const fa = fadeAlpha(p, dur);

        // bg fallback
        drawBg(p);

        // image with ken-burns
        if (img) {
          ctx.save();
          ctx.globalAlpha = fa;
          const zoom = 1.0 + 0.10 * p;
          const scale = Math.max(W / img.width, (H * 0.85) / img.height) * zoom;
          const dw = img.width * scale, dh = img.height * scale;
          const dx = (W - dw) / 2 + (p - 0.5) * 30;
          const dy = (H * 0.45 - dh / 2) + (p - 0.5) * 15;
          // image card
          ctx.fillStyle = "rgba(0,0,0,0.4)";
          ctx.fillRect(0, 0, W, H * 0.78);
          ctx.beginPath();
          ctx.rect(60, 60, W - 120, H * 0.6);
          ctx.clip();
          ctx.drawImage(img, dx, dy, dw, dh);
          ctx.restore();
        }

        drawLogo();

        // caption strip
        ctx.save();
        ctx.globalAlpha = fa;
        const stripY = H * 0.78;
        const sg = ctx.createLinearGradient(0, stripY - 30, 0, H);
        sg.addColorStop(0, "rgba(0,0,0,0)");
        sg.addColorStop(0.3, hexA(bgColor, 0.95));
        sg.addColorStop(1, hexA(bgColor, 1));
        ctx.fillStyle = sg; ctx.fillRect(0, stripY - 30, W, H - stripY + 30);

        ctx.fillStyle = textColor;
        ctx.font = "600 28px system-ui, sans-serif";
        ctx.textAlign = "right";
        ctx.direction = "rtl";
        const lines = wrapText(ctx, scene.narration, W - 100);
        const lineH = 40;
        const captionBaseY = stripY + 25;
        for (let li = 0; li < Math.min(lines.length, 3); li++) {
          ctx.fillText(lines[li], W - 50, captionBaseY + li * lineH);
        }
        ctx.restore();

        drawProgress((elapsed + t) / totalSec);
        onProgress((elapsed + t) / totalSec);
        await new Promise((r) => setTimeout(r, 1000 / fps));
      }
      elapsed += dur;
    }

    // OUTRO
    {
      const start = performance.now();
      while (true) {
        const t = (performance.now() - start) / 1000;
        if (t >= outroDur) break;
        const p = t / outroDur;
        const fa = fadeAlpha(p, outroDur);

        drawBg(p);
        drawLogo();

        ctx.save();
        ctx.globalAlpha = fa;
        ctx.textAlign = "center";
        ctx.direction = "rtl";
        ctx.fillStyle = textColor;
        ctx.font = "600 36px system-ui, sans-serif";
        ctx.fillText("زر الموقع الآن", W / 2, H * 0.42);

        ctx.font = "700 56px system-ui, sans-serif";
        const pg = ctx.createLinearGradient(W * 0.3, 0, W * 0.7, 0);
        pg.addColorStop(0, primary); pg.addColorStop(1, accent);
        ctx.fillStyle = pg;
        ctx.fillText(host, W / 2, H * 0.42 + 80);
        ctx.restore();

        drawProgress((elapsed + t) / totalSec);
        onProgress((elapsed + t) / totalSec);
        await new Promise((r) => setTimeout(r, 1000 / fps));
      }
    }

    rec.stop();
    const blob = await done;
    const isMp4 = mime.startsWith("video/mp4");
    if (isMp4) return blob;

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
      return new Blob([u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer], { type: "video/mp4" });
    } catch (err) {
      console.error("ffmpeg convert failed", err);
      toast.error("تعذّر التحويل — سيتم تنزيل WebM");
      return blob;
    }
  }

  function downloadPreview() {
    if (!previewUrl) return;
    const a = document.createElement("a");
    a.href = previewUrl; a.download = downloadName; a.click();
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
            {previewUrl ? (
              <video src={previewUrl} controls className="w-full h-full" />
            ) : active?.imageUrl ? (
              <img src={active.imageUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="absolute inset-0 grid place-items-center text-muted-foreground/70 text-sm bg-gradient-hero/10">
                {running ? <Loader2 className="size-10 animate-spin" /> : <span className="inline-flex items-center gap-2"><Wand2 className="size-5" /> ألصق رابط موقعك واضغط "إنشاء الفيديو"</span>}
              </div>
            )}
            {active && !previewUrl && (
              <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/80 to-transparent">
                <p className="text-sm leading-relaxed">{active.narration}</p>
              </div>
            )}
          </div>

          <div className="p-4 border-t border-border space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{STAGE_LABEL[stage]}</span>
              <span>{progress.toFixed(0)}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
              <div className="h-full bg-gradient-hero transition-[width] duration-300" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed text-right">{message}</p>

            {previewUrl && (
              <div className="flex flex-wrap gap-2 pt-2">
                <button onClick={downloadPreview} className="rounded-lg bg-gradient-hero px-4 py-2 font-semibold text-primary-foreground inline-flex items-center gap-2">
                  <Download className="size-4" /> تنزيل {downloadName}
                </button>
                <button onClick={() => runPipeline(input)} disabled={running} className="rounded-lg border border-border px-4 py-2 inline-flex items-center gap-2 hover:bg-muted/30">
                  <RefreshCw className="size-4" /> إعادة الإنشاء
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

// ----- helpers -----
function truncate(s: string, n: number) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

function hexA(hex: string, a: number) {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(v.slice(0, 2), 16) || 0;
  const g = parseInt(v.slice(2, 4), 16) || 0;
  const b = parseInt(v.slice(4, 6), 16) || 0;
  return `rgba(${r},${g},${b},${a})`;
}

function shade(hex: string, percent: number) {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  let r = parseInt(v.slice(0, 2), 16) || 0;
  let g = parseInt(v.slice(2, 4), 16) || 0;
  let b = parseInt(v.slice(4, 6), 16) || 0;
  const t = percent < 0 ? 0 : 255, p = Math.abs(percent) / 100;
  r = Math.round((t - r) * p + r);
  g = Math.round((t - g) * p + g);
  b = Math.round((t - b) * p + b);
  return `rgb(${r},${g},${b})`;
}
