import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GATEWAY = "https://ai.gateway.lovable.dev/v1";

const ScriptInput = z.object({
  url: z.string().url().optional(),
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
};

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
    if (!key) throw new Error("AI not configured");

    let context = data.topic ?? "";
    if (data.url) {
      const pageText = await fetchPageText(data.url);
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
      if (res.status === 402) throw new Error("نفدت أرصدة الذكاء الاصطناعي. أضف رصيداً للمتابعة.");
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
    return parsed;
  });

const ImageInput = z.object({ prompt: z.string().min(3).max(1000) });

export const generateSceneImage = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => ImageInput.parse(d))
  .handler(async ({ data }): Promise<{ dataUrl: string }> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("AI not configured");

    const res = await fetch(`${GATEWAY}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-image",
        messages: [{
          role: "user",
          content: `Cinematic, modern, vibrant, high quality illustration. ${data.prompt}. Wide aspect, professional video still, deep purple and cyan accent lighting.`,
        }],
        modalities: ["image", "text"],
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      if (res.status === 429) throw new Error("الحد الأقصى للطلبات.");
      if (res.status === 402) throw new Error("نفدت أرصدة الذكاء الاصطناعي.");
      throw new Error(`Image error: ${res.status} ${txt.slice(0, 200)}`);
    }
    const json = await res.json() as {
      choices: Array<{ message: { images?: Array<{ image_url: { url: string } }> } }>;
    };
    const url = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!url) throw new Error("لم يتم توليد صورة");
    return { dataUrl: url };
  });
