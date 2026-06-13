import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Sparkles, Wand2, Video, Mic2, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  const [url, setUrl] = useState("");

  const startStudio = () => {
    const trimmed = url.trim();
    const target = trimmed ? `/studio?url=${encodeURIComponent(trimmed)}` : `/studio`;
    window.location.href = target;
  };

  return (
    <main className="min-h-screen grid-bg">
      <header className="container mx-auto flex items-center justify-between py-6 px-6">
        <div className="flex items-center gap-2">
          <div className="size-9 rounded-xl bg-gradient-hero grid place-items-center glow-primary">
            <Sparkles className="size-5 text-primary-foreground" />
          </div>
          <span className="font-display text-xl font-bold tracking-tight">Eco<span className="text-gradient">AI</span></span>
        </div>
        <nav className="flex items-center gap-3 text-sm">
          <Link to="/studio" className="hidden sm:inline text-muted-foreground hover:text-foreground">الاستوديو</Link>
          <a href="#features" className="hidden sm:inline text-muted-foreground hover:text-foreground">المميزات</a>
          <Link to="/studio" className="rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground hover:opacity-90">
            ابدأ مجاناً
          </Link>
        </nav>
      </header>

      <section className="container mx-auto px-6 pt-16 pb-24 text-center max-w-4xl">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/40 px-4 py-1.5 text-xs text-muted-foreground backdrop-blur">
          <span className="size-1.5 rounded-full bg-neon animate-pulse" />
          مدعوم بالذكاء الاصطناعي • عربي بالكامل
        </div>
        <h1 className="mt-6 font-display text-5xl sm:text-7xl font-black leading-[1.05] tracking-tight">
          حوّل أي <span className="text-gradient">رابط موقع</span><br />
          إلى فيديو شرح احترافي
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
          ألصق رابطاً، واترك الذكاء الاصطناعي يكتب السكربت، ويولّد المشاهد البصرية، ويُنطق التعليق الصوتي. كل ذلك في دقائق.
        </p>

        <div className="mt-10 mx-auto max-w-2xl glass-panel p-2 flex items-center gap-2 glow-primary">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && startStudio()}
            placeholder="https://your-website.com"
            dir="ltr"
            className="flex-1 bg-transparent px-4 py-3 outline-none text-right placeholder:text-muted-foreground"
          />
          <button onClick={startStudio} className="rounded-lg bg-gradient-hero px-5 py-3 font-semibold text-primary-foreground hover:opacity-90 inline-flex items-center gap-2">
            <Wand2 className="size-4" />
            ولّد الفيديو
            <ArrowLeft className="size-4" />
          </button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          أو <button onClick={() => (window.location.href = "/studio")} className="underline hover:text-foreground">ابدأ من موضوع نصي</button>
        </p>
      </section>

      <section id="features" className="container mx-auto px-6 pb-24 grid sm:grid-cols-3 gap-4">
        {[
          { icon: Sparkles, title: "سكربت بالذكاء الاصطناعي", desc: "يقرأ موقعك ويكتب 5 مشاهد جذّابة بالعربية." },
          { icon: Video, title: "صور مشاهد مولّدة", desc: "صور سينمائية لكل مشهد بضغطة زر." },
          { icon: Mic2, title: "تعليق صوتي تلقائي", desc: "أصوات عربية واضحة تشتغل في المتصفح فوراً." },
        ].map((f) => (
          <div key={f.title} className="glass-panel p-6">
            <div className="size-10 rounded-lg bg-primary/15 grid place-items-center mb-4">
              <f.icon className="size-5 text-primary" />
            </div>
            <h3 className="font-semibold text-lg">{f.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{f.desc}</p>
          </div>
        ))}
      </section>

      <footer className="container mx-auto px-6 pb-10 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} EcoAI Studio
      </footer>
    </main>
  );
}
