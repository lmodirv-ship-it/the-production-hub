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

function extractLinks(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  const base = new URL(baseUrl);
  const re = /<a\s[^>]*href=["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const u = new URL(m[1], base);
      if (u.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) continue;
      if (/\.(png|jpe?g|gif|svg|webp|pdf|zip|mp4|css|js)(\?|$)/i.test(u.pathname)) continue;
      u.hash = ""; u.search = "";
      out.add(u.toString());
    } catch { /* skip */ }
  }
  return Array.from(out);
}

async function shotToDataUrl(targetUrl: string): Promise<string | null> {
  // thum.io: free screenshot service, no auth required
  const shotUrl = `https://image.thum.io/get/width/1280/crop/720/noanimate/${targetUrl}`;
  try {
    const res = await fetch(shotUrl);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength < 2000) return null; // probably placeholder
    let bin = ""; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    const b64 = btoa(bin);
    const mime = res.headers.get("content-type") ?? "image/jpeg";
    return `data:${mime};base64,${b64}`;
  } catch { return null; }
}

const ScreenshotsInput = z.object({ url: UrlInput, count: z.number().min(1).max(8).default(5) });

export const captureScreenshots = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ScreenshotsInput.parse(d))
  .handler(async ({ data }): Promise<{ shots: string[]; pages: string[] }> => {
    const url = data.url!;
    let html = "";
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 EcoAI/1.0" } });
      if (r.ok) html = await r.text();
    } catch { /* ignore */ }

    const links = extractLinks(html, url);
    const pages = [url, ...links.filter((l) => l !== url)].slice(0, data.count);
    while (pages.length < data.count) pages.push(url);

    const shots: string[] = [];
    for (const p of pages) {
      const s = await shotToDataUrl(p);
      shots.push(s ?? "");
    }
    return { shots, pages };
  });
