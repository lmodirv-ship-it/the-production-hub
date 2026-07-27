/** Script timing helpers: word budget, timed captions, txt/srt builders. */

export type ScriptLocale = "ar" | "en" | "fr";

export const WORDS_PER_SECOND = 2.4;
export const MIN_VIDEO_SECONDS = 195; // 3:15

export function wordsForSeconds(seconds: number) {
  return Math.round(seconds * WORDS_PER_SECOND);
}

export function countWords(text: string) {
  return (text.match(/\S+/g) ?? []).length;
}

export function secondsForText(text: string) {
  return countWords(text) / WORDS_PER_SECOND;
}

/** Split narration into caption-sized chunks (short enough to read on screen). */
export function splitCaptions(text: string, maxWords = 9): string[] {
  const sentences = text.match(/[^.!?،؛…]+[.!?،؛…]*\s*/g) ?? [text];
  const out: string[] = [];
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    const words = s.match(/\S+/g) ?? [];
    if (words.length <= maxWords) {
      out.push(s);
      continue;
    }
    for (let i = 0; i < words.length; i += maxWords) {
      out.push(words.slice(i, i + maxWords).join(" "));
    }
  }
  return out.length ? out : [text];
}

export type TimedCaption = { text: string; start: number; end: number };

/** Distribute captions across a known duration, weighted by word count. */
export function timeCaptions(text: string, startAt: number, duration: number): TimedCaption[] {
  const parts = splitCaptions(text);
  const weights = parts.map((p) => Math.max(1, countWords(p)));
  const total = weights.reduce((a, b) => a + b, 0);
  let t = startAt;
  return parts.map((p, i) => {
    const d = (weights[i] / total) * duration;
    const item = { text: p, start: t, end: t + d };
    t += d;
    return item;
  });
}

function srtTime(sec: number) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  const t = String(ms % 1000).padStart(3, "0");
  return `${h}:${m}:${s},${t}`;
}

export function buildSrt(captions: TimedCaption[]) {
  return captions
    .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`)
    .join("\n");
}

export function buildDescriptionFile(opts: {
  name: string;
  url: string;
  seconds: number;
  script: string;
  locale?: ScriptLocale;
}) {
  const locale = opts.locale ?? "ar";
  const mm = Math.floor(opts.seconds / 60);
  const ss = Math.round(opts.seconds % 60)
    .toString()
    .padStart(2, "0");
  const labels = {
    ar: { title: "جولة تعريفية", link: "الرابط", duration: "المدة", full: "النص الكامل", tags: "وسوم مقترحة", tagList: [opts.name, "HN Groupe", "Lovable", "تطبيق ويب", "شرح موقع", "ذكاء اصطناعي"] },
    en: { title: "Site Tour", link: "Link", duration: "Duration", full: "Full Script", tags: "Suggested Tags", tagList: [opts.name, "HN Groupe", "Lovable", "web app", "site walkthrough", "AI"] },
    fr: { title: "Visite guidée", link: "Lien", duration: "Durée", full: "Texte complet", tags: "Tags suggérés", tagList: [opts.name, "HN Groupe", "Lovable", "application web", "présentation site", "IA"] },
  }[locale];

  return [
    `${opts.name} — ${labels.title}`,
    `${labels.link}: ${opts.url}`,
    `${labels.duration}: ${mm}:${ss}`,
    "",
    `— ${labels.full} —`,
    "",
    opts.script.trim(),
    "",
    `— ${labels.tags} —`,
    labels.tagList.map((t) => `#${t.replace(/\s+/g, "_")}`).join(" "),
    "",
  ].join("\n");
}


export function safeFileBase(url: string) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    return h.replace(/\.lovable\.app$/, "").replace(/[^a-z0-9\-_]+/gi, "_");
  } catch {
    return "video";
  }
}
