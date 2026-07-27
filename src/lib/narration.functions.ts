import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GATEWAY = "https://ai.gateway.lovable.dev/v1";

const NarrationInput = z.object({
  url: z.string().url(),
  paths: z.array(z.string()).min(1).max(20),
});

export type NarrationItem = { path: string; text: string };
export type NarrationResult = { items: NarrationItem[]; fallback: boolean };

function hostOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "موقعك"; }
}

function labelOf(path: string) {
  const clean = path.replace(/^\//, "").replace(/[-_/]+/g, " ").trim();
  return clean || "الصفحة الرئيسية";
}

function fallbackNarration(url: string, paths: string[]): NarrationResult {
  const site = hostOf(url);
  return {
    fallback: true,
    items: paths.map((path, i) => ({
      path,
      text: i === 0
        ? `أهلاً بكم في جولة سريعة داخل موقع ${site}. سنستعرض معاً أهم الصفحات والخدمات التي يقدمها الموقع بشكل مبسّط وواضح.`
        : `ننتقل الآن إلى قسم ${labelOf(path)} في موقع ${site}، حيث يجد الزائر تفاصيل إضافية معروضة بتصميم مرتّب وسهل التصفح.`,
    })),
  };
}

async function fetchPageText(url: string): Promise<string> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 EcoAI/1.0" } });
    if (!r.ok) return "";
    const html = await r.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);
  } catch { return ""; }
}

/** One AI call that writes a short Arabic voice-over line per page. */
export const generateNarration = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => NarrationInput.parse(d))
  .handler(async ({ data }): Promise<NarrationResult> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) return fallbackNarration(data.url, data.paths);

    const site = hostOf(data.url);
    const pageText = await fetchPageText(data.url);

    const system = `أنت كاتب تعليق صوتي لفيديوهات تعريفية قصيرة على يوتيوب.
اكتب بالعربية الفصحى البسيطة، بأسلوب حماسي هادئ ومناسب للقراءة الصوتية.
لكل مسار من مسارات الموقع اكتب جملتين إلى ثلاث (٢٥ إلى ٤٥ كلمة) تصف ما يراه المشاهد في تلك الصفحة.
أعد JSON فقط بالشكل التالي:
{"items":[{"path":"/","text":"..."}]}
بنفس ترتيب المسارات وبنفس عددها، بدون أي نص خارج JSON.`;

    const user = `الموقع: ${site} (${data.url})
مقتطف من محتوى الصفحة الرئيسية:
${pageText || "(لا يوجد محتوى مقروء)"}

المسارات المطلوبة بالترتيب:
${data.paths.map((p, i) => `${i + 1}. ${p}`).join("\n")}`;

    try {
      const res = await fetch(`${GATEWAY}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
        }),
      });
      if (!res.ok) return fallbackNarration(data.url, data.paths);

      const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = json.choices?.[0]?.message?.content ?? "{}";
      let parsed: { items?: NarrationItem[] };
      try { parsed = JSON.parse(content); }
      catch {
        const m = content.match(/\{[\s\S]*\}/);
        parsed = m ? JSON.parse(m[0]) : {};
      }
      const byPath = new Map((parsed.items ?? []).map((it) => [it.path, it.text]));
      const fb = fallbackNarration(data.url, data.paths).items;
      const items = data.paths.map((path, i) => ({
        path,
        text: (byPath.get(path) ?? parsed.items?.[i]?.text ?? fb[i].text).toString().trim(),
      }));
      return { items, fallback: false };
    } catch {
      return fallbackNarration(data.url, data.paths);
    }
  });

const SpeechInput = z.object({
  text: z.string().min(1).max(2000),
  voice: z.string().default("alloy"),
});

function toBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** Text → natural voice (mp3, base64) so it can be mixed into the recording. */
export const synthesizeSpeech = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => SpeechInput.parse(d))
  .handler(async ({ data }): Promise<{ audio: string; mime: string }> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("خدمة الصوت غير مفعّلة حالياً.");

    const res = await fetch(`${GATEWAY}/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini-tts",
        input: data.text,
        voice: data.voice,
        instructions: "تحدث بالعربية الفصحى بنبرة واضحة وودودة وبإيقاع متوسط مناسب لفيديو تعريفي.",
        response_format: "mp3",
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      if (res.status === 402) throw new Error("نفدت أرصدة الذكاء الاصطناعي — يمكنك التسجيل بدون تعليق آلي.");
      if (res.status === 429) throw new Error("الحد الأقصى للطلبات. جرّب بعد قليل.");
      throw new Error(`TTS error: ${res.status} ${txt.slice(0, 160)}`);
    }

    return { audio: toBase64(await res.arrayBuffer()), mime: "audio/mpeg" };
  });
