import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  Sparkles, Wand2, Play, Pause, Download, Loader2, ImageIcon,
  Mic2, Volume2, RefreshCw, Film, Type,
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
  const playRef = useRef<{ cancelled: boolean }>({ cancelled: false });

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

      {/* Studio grid */}
      <section className="container mx-auto px-6 mt-6 grid grid-cols-12 gap-4 pb-12">
        {/* Voice & audio (left) */}
        <aside className="col-span-12 lg:col-span-3 glass-panel p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Mic2 className="size-4 text-neon" /> الصوت والتعليق
          </div>
          <div>
            <label className="text-xs text-muted-foreground">صوت الراوي</label>
            <select
              value={voice?.name ?? ""}
              onChange={(e) => setVoice(voices.find((v) => v.name === e.target.value) ?? null)}
              className="mt-1 w-full bg-input/60 border border-border rounded-lg px-3 py-2 text-sm"
            >
              {arabicVoices.length > 0 && (
                <optgroup label="عربي">
                  {arabicVoices.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}
                </optgroup>
              )}
              {otherVoices.length > 0 && (
                <optgroup label="أخرى">
                  {otherVoices.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}
                </optgroup>
              )}
              {voices.length === 0 && <option>الأصوات قيد التحميل…</option>}
            </select>
          </div>
          <div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>السرعة</span><span>{rate.toFixed(2)}x</span>
            </div>
            <input type="range" min={0.5} max={1.5} step={0.05} value={rate} onChange={(e) => setRate(+e.target.value)} className="w-full accent-[oklch(0.84_0.18_200)]" />
          </div>
          <div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>النغمة</span><span>{pitch.toFixed(2)}</span>
            </div>
            <input type="range" min={0.5} max={1.5} step={0.05} value={pitch} onChange={(e) => setPitch(+e.target.value)} className="w-full accent-[oklch(0.84_0.18_200)]" />
          </div>
          <button
            onClick={() => active && speak(active.narration)}
            disabled={!active}
            className="w-full rounded-lg border border-border py-2 text-sm hover:bg-accent inline-flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Volume2 className="size-4" /> معاينة المشهد الحالي
          </button>

          <div className="pt-3 border-t border-border space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Film className="size-4 text-neon" /> توليد الفيديو
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-gradient-hero transition-all" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">{playing ? "جاري التشغيل…" : progress === 100 ? "اكتمل" : "جاهز للتشغيل"}</p>
          </div>
        </aside>

        {/* Preview center */}
        <div className="col-span-12 lg:col-span-6 space-y-4">
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

        {/* Scene editor right */}
        <aside className="col-span-12 lg:col-span-3 glass-panel p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Type className="size-4 text-neon" /> محرر المشاهد
          </div>
          {scenes.length === 0 ? (
            <p className="text-xs text-muted-foreground">ستظهر المشاهد هنا بعد التوليد. يمكنك تعديل النص ووصف الصورة لكل مشهد.</p>
          ) : (
            <>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">عنوان المشهد</label>
                <input
                  value={active?.title ?? ""}
                  onChange={(e) => setScenes((prev) => prev.map((s, i) => i === activeIdx ? { ...s, title: e.target.value } : s))}
                  className="w-full bg-input/60 border border-border rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">نص التعليق</label>
                <textarea
                  value={active?.narration ?? ""}
                  onChange={(e) => setScenes((prev) => prev.map((s, i) => i === activeIdx ? { ...s, narration: e.target.value } : s))}
                  rows={5}
                  className="w-full bg-input/60 border border-border rounded-lg px-3 py-2 text-sm resize-y"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">وصف الصورة (إنجليزي)</label>
                <textarea
                  value={active?.imagePrompt ?? ""}
                  onChange={(e) => setScenes((prev) => prev.map((s, i) => i === activeIdx ? { ...s, imagePrompt: e.target.value } : s))}
                  rows={3}
                  dir="ltr"
                  className="w-full bg-input/60 border border-border rounded-lg px-3 py-2 text-sm resize-y text-left"
                />
              </div>
            </>
          )}
        </aside>
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
