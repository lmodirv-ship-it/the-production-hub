import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GATEWAY = "https://ai.gateway.lovable.dev/v1";

const UrlInput = z.preprocess((value) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}, z.string().url().optional());

const ScriptInput = z.object({
  url: UrlInput,
  topic: z.string().min(3).max(500).optional(),
  language: z.enum(["ar", "en"]).default("ar"),
}).refine((v) => v.url || v.topic, { message: "url or topic required" });

export type Scene = {
  id: number;
  title: string;
  narration: string;
  imagePrompt: string;
};
export type ScriptResult = {
  title: string;
  summary: string;
  scenes: Scene[];
  fallback?: boolean;
};

function hostnameFromUrl(url?: string) {
  if (!url) return "موقعك";
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return "موقعك"; }
}

function pickTextParts(text: string) {
  const parts = text
    .split(/[.!؟!،\n]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 35 && part.length < 220);
  return parts.length ? parts : [text.slice(0, 180)].filter(Boolean);
}

function fallbackScript(url: string | undefined, topic: string | undefined, pageText: string): ScriptResult {
  const site = hostnameFromUrl(url);
  const parts = pickTextParts(pageText || topic || site);
  const sceneIdeas = [
    ["البداية", `في هذا الفيديو السريع نأخذك في جولة داخل ${site}، ونوضح الفكرة الأساسية التي يقدمها الموقع بطريقة مختصرة وواضحة.`],
    ["الفكرة الرئيسية", parts[0] ? `يعرض الموقع فكرة مهمة: ${parts[0]}` : `يعرض ${site} تجربة رقمية منظمة تساعد الزائر على فهم الخدمة بسرعة.`],
    ["ما يميّزه", parts[1] ? `من أبرز ما يظهر في الموقع: ${parts[1]}` : "التصميم يركز على الوضوح، سهولة التصفح، وإبراز أهم عناصر الخدمة للزائر."],
    ["تجربة الزائر", parts[2] ? `أثناء التصفح يكتشف الزائر تفاصيل إضافية مثل: ${parts[2]}` : "الزائر يستطيع الانتقال بين الأقسام بسلاسة والوصول للمعلومة المطلوبة دون تعقيد."],
    ["الخلاصة", `باختصار، ${site} يقدم حضوراً رقمياً واضحاً ومناسباً للتعريف بالخدمة، وهذا الفيديو يمنح المشاهد لمحة سريعة قبل زيارة الموقع.`],
  ];
  return {
    title: `فيديو تعريفي عن ${site}`,
    summary: `شرح مختصر لموقع ${site}.`,
    fallback: true,
    scenes: sceneIdeas.map(([title, narration], index) => ({
      id: index + 1,
      title,
      narration,
      imagePrompt: `Professional website presentation slide for ${site}: ${title}. ${narration}`,
    })),
  };
}

async function fetchPageText(url: string): Promise<string> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 EcoAI/1.0" } });
    if (!r.ok) return "";
    const html = await r.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, 6000);
  } catch { return ""; }
}

export const generateScript = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ScriptInput.parse(d))
  .handler(async ({ data }): Promise<ScriptResult> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("خدمة الذكاء الاصطناعي غير مفعّلة حالياً.");

    let context = data.topic ?? "";
    let pageText = "";
    if (data.url) {
      pageText = await fetchPageText(data.url);
      context = `URL: ${data.url}\n\nContent excerpt:\n${pageText || "(no readable content)"}\n\n${context}`;
    }

    const langInstruction = data.language === "ar"
      ? "اكتب السكربت بالعربية الفصحى البسيطة، بأسلوب جذاب ومناسب لراوي فيديو."
      : "Write the script in clear, engaging English.";

    const systemPrompt = `You are an expert video script writer. Given a topic or website content, produce a short explainer video script of 5 scenes. ${langInstruction}

Return ONLY valid JSON matching this exact shape:
{
  "title": "string (catchy video title)",
  "summary": "string (1-2 sentence overview)",
  "scenes": [
    {
      "id": 1,
      "title": "short scene title",
      "narration": "voiceover text, 2-3 sentences, ~25-40 words",
      "imagePrompt": "detailed English visual description for image generation, cinematic, modern, professional"
    }
  ]
}
Exactly 5 scenes. No markdown, no commentary outside JSON.`;

    const res = await fetch(`${GATEWAY}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: context || "topic: a modern technology product" },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      if (res.status === 429) throw new Error("الحد الأقصى للطلبات. جرّب بعد قليل.");
      if (res.status === 402) return fallbackScript(data.url, data.topic, pageText);
      throw new Error(`AI error: ${res.status} ${txt.slice(0, 200)}`);
    }
    const json = await res.json() as { choices: Array<{ message: { content: string } }> };
    const content = json.choices?.[0]?.message?.content ?? "{}";
    let parsed: ScriptResult;
    try { parsed = JSON.parse(content); }
    catch {
      const m = content.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : { title: "Video", summary: "", scenes: [] };
    }
    parsed.scenes = (parsed.scenes ?? []).slice(0, 6).map((s, i) => ({
      id: i + 1,
      title: s.title ?? `Scene ${i + 1}`,
      narration: s.narration ?? "",
      imagePrompt: s.imagePrompt ?? s.title ?? "",
    }));
    if (!parsed.scenes.length) return fallbackScript(data.url, data.topic, pageText);
    return parsed;
  });

export type Branding = {
  primary?: string;
  accent?: string;
  background?: string;
  textPrimary?: string;
  logo?: string;
};

const ScreenshotsInput = z.object({ url: UrlInput, count: z.number().min(1).max(8).default(5) });

async function urlToDataUrl(u: string): Promise<string> {
  if (!u) return "";
  if (u.startsWith("data:")) return u;
  try {
    const r = await fetch(u);
    if (!r.ok) return "";
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.byteLength < 1000) return "";
    let bin = ""; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    const mime = r.headers.get("content-type") ?? "image/png";
    return `data:${mime};base64,${btoa(bin)}`;
  } catch { return ""; }
}

export const captureScreenshots = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ScreenshotsInput.parse(d))
  .handler(async ({ data }): Promise<{ shots: string[]; pages: string[]; branding: Branding; content: string; title: string }> => {
    const url = data.url!;
    const key = process.env.FIRECRAWL_API_KEY;
    if (!key) {
      return { shots: [], pages: [url], branding: {}, content: "", title: hostnameFromUrl(url) };
    }

    const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

    // 1) Discover internal pages via map
    let pages: string[] = [url];
    try {
      const mapRes = await fetch("https://api.firecrawl.dev/v2/map", {
        method: "POST", headers,
        body: JSON.stringify({ url, limit: data.count + 3 }),
      });
      if (mapRes.ok) {
        const j = await mapRes.json() as { links?: Array<string | { url: string }> };
        const links = (j.links ?? []).map((l) => typeof l === "string" ? l : l.url).filter(Boolean);
        const uniq = Array.from(new Set([url, ...links]));
        pages = uniq.slice(0, data.count);
      }
    } catch { /* ignore */ }
    while (pages.length < data.count) pages.push(url);

    // 2) Scrape each page: screenshot, plus markdown+branding for the first
    const shots: string[] = [];
    let branding: Branding = {};
    let content = "";
    let title = hostnameFromUrl(url);

    for (let i = 0; i < pages.length; i++) {
      const isFirst = i === 0;
      const formats: unknown[] = ["screenshot"];
      if (isFirst) { formats.push("markdown"); formats.push("branding"); }
      try {
        const r = await fetch("https://api.firecrawl.dev/v2/scrape", {
          method: "POST", headers,
          body: JSON.stringify({ url: pages[i], formats, onlyMainContent: true }),
        });
        if (!r.ok) { shots.push(""); continue; }
        const j = await r.json() as {
          data?: {
            screenshot?: string;
            markdown?: string;
            metadata?: { title?: string };
            branding?: {
              logo?: string;
              colors?: { primary?: string; accent?: string; background?: string; textPrimary?: string };
            };
          };
        };
        const d = j.data ?? {};
        shots.push(await urlToDataUrl(d.screenshot ?? ""));
        if (isFirst) {
          content = (d.markdown ?? "").slice(0, 4000);
          title = d.metadata?.title ?? title;
          const c = d.branding?.colors ?? {};
          branding = {
            primary: c.primary, accent: c.accent,
            background: c.background, textPrimary: c.textPrimary,
            logo: d.branding?.logo,
          };
        }
      } catch { shots.push(""); }
    }

    return { shots, pages, branding, content, title };
  });
