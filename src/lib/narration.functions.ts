import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GATEWAY = "https://ai.gateway.lovable.dev/v1";

export type NarrationLocale = "ar" | "en" | "fr";

const NarrationInput = z.object({
  url: z.string().url(),
  paths: z.array(z.string()).min(1).max(20),
  locale: z.enum(["ar", "en", "fr"]).default("ar"),
});

export type NarrationItem = { path: string; text: string };
export type NarrationResult = { items: NarrationItem[]; fallback: boolean };

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "موقعك";
  }
}

function labelOf(path: string, locale: NarrationLocale) {
  const clean = path
    .replace(/^\//, "")
    .replace(/[-_/]+/g, " ")
    .trim();
  if (!clean) {
    return locale === "ar" ? "الصفحة الرئيسية" : locale === "fr" ? "Page d'accueil" : "Homepage";
  }
  return clean;
}

function localeVoiceInstructions(locale: NarrationLocale) {
  if (locale === "fr") return "Parle en français courant, clair et professionnel, à un rythme adapté à une vidéo de présentation.";
  if (locale === "en") return "Speak in clear, friendly English at a moderate pace suitable for a website walkthrough video.";
  return "تحدث بالعربية الفصحى بنبرة واضحة وودودة وبإيقاع متوسط مناسب لفيديو تعريفي.";
}

function fallbackText(path: string, site: string, index: number, locale: NarrationLocale) {
  const label = labelOf(path, locale);
  if (index === 0) {
    if (locale === "fr") return `Bienvenue dans cette visite rapide de ${site}. Nous allons découvrir ensemble les pages et services essentiels du site, de manière simple et claire.`;
    if (locale === "en") return `Welcome to this quick tour of ${site}. We'll explore together the most important pages and services in a simple, clear way.`;
    return `أهلاً بكم في جولة سريعة داخل موقع ${site}. سنستعرض معاً أهم الصفحات والخدمات التي يقدمها الموقع بشكل مبسّط وواضح.`;
  }
  if (locale === "fr") return `Nous passons maintenant à la section ${label} de ${site}, où le visiteur trouve des détails supplémentaires présentés dans une interface soignée et facile à parcourir.`;
  if (locale === "en") return `We now move to the ${label} section of ${site}, where visitors find additional details presented in a clean, easy-to-browse interface.`;
  return `ننتقل الآن إلى قسم ${label} في موقع ${site}، حيث يجد الزائر تفاصيل إضافية معروضة بتصميم مرتّب وسهل التصفح.`;
}

function fallbackNarration(url: string, paths: string[], locale: NarrationLocale): NarrationResult {
  const site = hostOf(url);
  return {
    fallback: true,
    items: paths.map((path, i) => ({
      path,
      text: fallbackText(path, site, i, locale),
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
  } catch {
    return "";
  }
}

function narrationSystemPrompt(locale: NarrationLocale, perWord: number) {
  if (locale === "fr") {
    return `Tu es un rédacteur de voix-off pour des vidéos de présentation de sites web sur YouTube.
Écris en français courant, clair et professionnel, adapté à la lecture vocale.
Pour chaque chemin du site, rédige 2 à 3 phrases (25 à 45 mots) décrivant ce que le spectateur voit sur cette page.
Réponds uniquement au format JSON suivant:
{"items":[{"path":"/","text":"..."}]}
Dans le même ordre et le même nombre que les chemins fournis, sans texte hors JSON.`;
  }
  if (locale === "en") {
    return `You are a voice-over script writer for short YouTube website walkthrough videos.
Write in clear, friendly English suitable for text-to-speech.
For each page path, write 2-3 sentences (25-45 words) describing what the viewer sees on that page.
Return JSON only in this format:
{"items":[{"path":"/","text":"..."}]}
Same order and same count as the provided paths, no text outside JSON.`;
  }
  return `أنت كاتب تعليق صوتي لفيديوهات تعريفية قصيرة على يوتيوب.
اكتب بالعربية الفصحى البسيطة، بأسلوب حماسي هادئ ومناسب للقراءة الصوتية.
لكل مسار من مسارات الموقع اكتب جملتين إلى ثلاث (٢٥ إلى ٤٥ كلمة) تصف ما يراه المشاهد في تلك الصفحة.
أعد JSON فقط بالشكل التالي:
{"items":[{"path":"/","text":"..."}]}
بنفس ترتيب المسارات وبنفس عددها، بدون أي نص خارج JSON.`;
}

function narrationUserPrompt(url: string, site: string, pageText: string, paths: string[], locale: NarrationLocale) {
  const siteLine = locale === "fr" ? `Site : ${site} (${url})` : locale === "en" ? `Site: ${site} (${url})` : `الموقع: ${site} (${url})`;
  const contentLine = locale === "fr" ? "Extrait du contenu de la page d'accueil:" : locale === "en" ? "Excerpt from homepage content:" : "مقتطف من محتوى الصفحة الرئيسية:";
  const pathsLine = locale === "fr" ? "Chemins demandés dans l'ordre:" : locale === "en" ? "Requested paths in order:" : "المسارات المطلوبة بالترتيب:";

  return `${siteLine}
${contentLine}
${pageText || (locale === "fr" ? "(aucun contenu lisible)" : locale === "en" ? "(no readable content)" : "(لا يوجد محتوى مقروء)")}

${pathsLine}
${paths.map((p, i) => `${i + 1}. ${p}`).join("\n")}`;
}

/** One AI call that writes a short voice-over line per page. */
export const generateNarration = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => NarrationInput.parse(d))
  .handler(async ({ data }): Promise<NarrationResult> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) return fallbackNarration(data.url, data.paths, data.locale);

    const site = hostOf(data.url);
    const pageText = await fetchPageText(data.url);
    const system = narrationSystemPrompt(data.locale, 35);
    const user = narrationUserPrompt(data.url, site, pageText, data.paths, data.locale);

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
      if (!res.ok) return fallbackNarration(data.url, data.paths, data.locale);

      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = json.choices?.[0]?.message?.content ?? "{}";
      let parsed: { items?: NarrationItem[] };
      try {
        parsed = JSON.parse(content);
      } catch {
        const m = content.match(/\{[\s\S]*\}/);
        parsed = m ? JSON.parse(m[0]) : {};
      }
      const byPath = new Map((parsed.items ?? []).map((it) => [it.path, it.text]));
      const fb = fallbackNarration(data.url, data.paths, data.locale).items;
      const items = data.paths.map((path, i) => ({
        path,
        text: (byPath.get(path) ?? parsed.items?.[i]?.text ?? fb[i].text).toString().trim(),
      }));
      return { items, fallback: false };
    } catch {
      return fallbackNarration(data.url, data.paths, data.locale);
    }
  });

const LongInput = z.object({
  url: z.string().url(),
  paths: z.array(z.string()).min(1).max(20),
  totalWords: z.number().min(60).max(1600),
  description: z.string().max(4000).optional(),
  locale: z.enum(["ar", "en", "fr"]).default("ar"),
});

function fillerSentences(locale: NarrationLocale, site: string, label: string) {
  if (locale === "fr") {
    return [
      `Le design de ${label} sur ${site} privilégie la clarté de l'information et un accès facile.`,
      `Chaque élément est soigneusement organisé pour que le visiteur trouve ce qu'il cherche en quelques secondes.`,
      `L'interface est réactive et fonctionne aussi bien sur ordinateur que sur mobile.`,
      `Vous pouvez essayer le site directement depuis le navigateur, sans inscription compliquée.`,
      `Cette section donne une idée pratique de l'utilisation quotidienne de la plateforme.`,
    ];
  }
  if (locale === "en") {
    return [
      `The design of ${label} on ${site} prioritizes clear information and easy access.`,
      `Every element is carefully organized so visitors find what they need in seconds.`,
      `The interface is responsive and works on desktop and mobile with the same quality.`,
      `You can try the site directly from the browser without a complicated signup process.`,
      `This section gives a practical idea of the platform's daily use.`,
    ];
  }
  return [
    `تصميم ${label} في موقع ${site} يعتمد على وضوح المعلومة وسهولة الوصول إليها.`,
    `كل عنصر هنا مرتّب بعناية ليجد الزائر ما يبحث عنه في ثوانٍ معدودة.`,
    `الواجهة سريعة الاستجابة وتعمل على الحاسوب والهاتف بنفس الجودة.`,
    `يمكنك تجربة الموقع مباشرة من المتصفح دون تسجيل معقّد أو خطوات إضافية.`,
    `هذا القسم يمنح فكرة عملية عن طريقة الاستخدام اليومي للمنصة.`,
  ];
}

function padTo(text: string, words: number, site: string, label: string, locale: NarrationLocale) {
  const filler = fillerSentences(locale, site, label);
  let out = text.trim();
  let i = 0;
  const count = (s: string) => (s.match(/\S+/g) ?? []).length;
  while (count(out) < words && i < 60) {
    out += " " + filler[i % filler.length];
    i++;
  }
  return out;
}

function longSystemPrompt(locale: NarrationLocale, perWord: number) {
  if (locale === "fr") {
    return `Tu es un rédacteur de voix-off pour des vidéos de présentation YouTube en français.
Écris un style narratif fluide, clair et adapté à la lecture vocale, sans titres ni numérotation à l'intérieur du texte.
Pour chaque chemin, rédige un paragraphe d'environ ${perWord} mots (±10%) décrivant ce que l'on voit sur cette page et son utilité.
Le premier paragraphe doit être une introduction accueillante, le dernier une conclusion invitant à visiter le site.
Réponds uniquement au format JSON: {"items":[{"path":"/","text":"..."}]} dans le même ordre et nombre que les chemins.`;
  }
  if (locale === "en") {
    return `You are a voice-over script writer for English YouTube website walkthrough videos.
Write in a flowing, clear narrative style suitable for text-to-speech, with no titles or numbering inside the text.
For each path, write a paragraph of about ${perWord} words (±10%) describing what appears on that page and its benefit to users.
Make the first paragraph a welcoming introduction and the last paragraph a closing call to visit the site.
Return JSON only: {"items":[{"path":"/","text":"..."}]} in the same order and count as the paths.`;
  }
  return `أنت كاتب سيناريو تعليق صوتي لفيديوهات يوتيوب تعريفية بالعربية الفصحى المبسّطة.
اكتب بأسلوب سردي متدفّق وواضح ومناسب للقراءة الصوتية، بدون عناوين أو رموز أو ترقيم داخل النص.
لكل مسار اكتب فقرة من حوالي ${perWord} كلمة (±10%) تصف ما يظهر في تلك الصفحة وفائدتها للمستخدم.
اجعل أول فقرة مقدمة ترحيبية وآخر فقرة خاتمة تدعو لزيارة الموقع.
أعد JSON فقط: {"items":[{"path":"/","text":"..."}]} بنفس ترتيب وعدد المسارات.`;
}

function longUserPrompt(url: string, site: string, pageText: string, paths: string[], totalWords: number, description: string, locale: NarrationLocale) {
  const siteLine = locale === "fr" ? `Site : ${site} (${url})` : locale === "en" ? `Site: ${site} (${url})` : `الموقع: ${site} (${url})`;
  const descLabel = locale === "fr" ? "Description du site :" : locale === "en" ? "Site description:" : "تعريف الموقع:";
  const contentLine = locale === "fr" ? "Extrait du contenu de la page d'accueil:" : locale === "en" ? "Excerpt from homepage content:" : "مقتطف من محتوى الصفحة الرئيسية:";
  const pathsLine = locale === "fr" ? "Chemins dans l'ordre :" : locale === "en" ? "Paths in order:" : "المسارات بالترتيب:";
  const wordsLine = locale === "fr" ? `Nombre total de mots environ : ${totalWords}` : locale === "en" ? `Total words requested: ${totalWords}` : `إجمالي الكلمات المطلوب تقريباً: ${totalWords}`;

  return `${siteLine}
${description ? `${descLabel}\n${description}\n` : ""}
${contentLine}
${pageText || (locale === "fr" ? "(aucun contenu lisible)" : locale === "en" ? "(no readable content)" : "(لا يوجد محتوى مقروء)")}

${pathsLine}
${paths.map((p, i) => `${i + 1}. ${p}`).join("\n")}

${wordsLine}`;
}

/** Long narration: a target word count spread over the tour pages. */
export const generateLongNarration = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => LongInput.parse(d))
  .handler(async ({ data }): Promise<NarrationResult> => {
    const site = hostOf(data.url);
    const per = Math.max(30, Math.round(data.totalWords / data.paths.length));
    const key = process.env.LOVABLE_API_KEY;

    const makeFallback = (): NarrationResult => {
      const base = fallbackNarration(data.url, data.paths, data.locale);
      const desc = (data.description ?? "").trim();
      return {
        fallback: true,
        items: base.items.map((it, i) => ({
          path: it.path,
          text: padTo(
            i === 0 && desc ? `${it.text} ${desc}` : it.text,
            per,
            site,
            labelOf(it.path, data.locale),
            data.locale,
          ),
        })),
      };
    };

    if (!key) return makeFallback();

    const pageText = await fetchPageText(data.url);
    const system = longSystemPrompt(data.locale, per);
    const user = longUserPrompt(data.url, site, pageText, data.paths, data.totalWords, data.description ?? "", data.locale);

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
      if (!res.ok) return makeFallback();

      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = json.choices?.[0]?.message?.content ?? "{}";
      let parsed: { items?: NarrationItem[] };
      try {
        parsed = JSON.parse(content);
      } catch {
        const m = content.match(/\{[\s\S]*\}/);
        parsed = m ? JSON.parse(m[0]) : {};
      }
      const byPath = new Map((parsed.items ?? []).map((it) => [it.path, it.text]));
      const fb = makeFallback().items;
      const items = data.paths.map((path, i) => {
        const raw = (byPath.get(path) ?? parsed.items?.[i]?.text ?? fb[i].text).toString().trim();
        return { path, text: padTo(raw, Math.round(per * 0.9), site, labelOf(path, data.locale), data.locale) };
      });
      return { items, fallback: false };
    } catch {
      return makeFallback();
    }
  });

const SpeechInput = z.object({
  text: z.string().min(1).max(2000),
  voice: z.string().default("alloy"),
  locale: z.enum(["ar", "en", "fr"]).default("ar"),
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
        instructions: localeVoiceInstructions(data.locale),
        response_format: "mp3",
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      if (res.status === 402)
        throw new Error("نفدت أرصدة الذكاء الاصطناعي — يمكنك التسجيل بدون تعليق آلي.");
      if (res.status === 429) throw new Error("الحد الأقصى للطلبات. جرّب بعد قليل.");
      throw new Error(`TTS error: ${res.status} ${txt.slice(0, 160)}`);
    }

    return { audio: toBase64(await res.arrayBuffer()), mime: "audio/mpeg" };
  });
