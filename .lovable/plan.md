
# خطة الترقية الشاملة لمولّد الفيديو

سننتقل من النموذج الحالي (صور thum.io + صوت متصفح غير مسجَّل) إلى خط إنتاج احترافي مدموج بالكامل في ملف MP4.

## 1) صور حقيقية عبر Firecrawl

استبدال `captureScreenshots` في `src/lib/ai.functions.ts`:

- استخدام Firecrawl SDK (`@mendable/firecrawl-js`) server-side فقط.
- خطوتان:
  1. `firecrawl.map(url, { limit: 8 })` لاكتشاف الصفحات الداخلية المهمة.
  2. لكل صفحة (حد أقصى 5): `firecrawl.scrape(url, { formats: ['screenshot', 'markdown', 'branding'] })`.
- نُعيد:
  - `shots[]`: روابط لقطات شاشة عالية الجودة.
  - `branding`: ألوان وشعار الموقع (لاستخدامها في التصميم).
  - `content`: نص الصفحة (لتغذية مولّد السكربت بدل التخمين).

**الفائدة:** السكربت يصير مبنياً على محتوى موقعك الفعلي (عنوان، ميزات، خدمات)، حتى لو رصيد AI نفد.

## 2) صوت احترافي مدموج عبر ElevenLabs

إضافة `synthesizeNarration` كـ server function:

- لكل مشهد، نولّد MP3 عبر `https://api.elevenlabs.io/v1/text-to-speech/{voiceId}` بنموذج `eleven_multilingual_v2` (يدعم العربية).
- صوت افتراضي: **Sarah** (`EXAVITQu4vr4xnSDxMaL`) + خيار صوت ذكر **George** (`JBFqnCBsd6RMkjVDRZzb`).
- نُعيد للعميل: `audioBase64[]` (Base64 لكل مشهد).

**في المتصفح:**
- نُحمّل كل MP3 في `Audio` element + `AudioContext`.
- نقيس مدة كل ملف فعلياً (`audio.duration`) ونستخدمها كمدة المشهد بدل التقدير من عدد الكلمات.
- نوصل مصدر الصوت إلى `MediaStreamDestination` ونضيفه لـ `canvas.captureStream()` → الصوت يصبح **داخل ملف MP4 فعلياً**.

**Fallback:** إذا فشل ElevenLabs (لا اتصال أو رصيد)، نعود لـ `speechSynthesis` كما هو الآن.

## 3) جماليات الفيديو

داخل `renderVideo` في `src/routes/studio.tsx`:

- **شاشة افتتاح (3 ثوان):** شعار الموقع + اسم النطاق + خلفية بألوان الـ branding.
- **شاشة ختام (3 ثوان):** "زر الآن: example.com" + رابط الموقع.
- **انتقالات fade** بين المشاهد (0.5 ثانية تداخل).
- **موسيقى خلفية:** ملف ثابت في `public/audio/bg.mp3` بحجم منخفض (-20dB)، مدموج عبر `AudioContext` مع صوت السرد.
- **شعار الموقع** (من branding) ثابت في الزاوية العلوية طوال الفيديو.
- **شريط تقدم سفلي** وألوان نصوص مشتقة من branding.

## 4) تجربة المستخدم في `studio.tsx`

- **معاينة قبل التنزيل:** بعد انتهاء الدمج، نعرض `<video>` element داخل المعاينة مع زرين: "تنزيل MP4" و"إعادة الإنشاء".
- **خيارات قبل البدء:**
  - اللغة (عربي/إنجليزي) — تمرَّر إلى مولّد السكربت و ElevenLabs.
  - الصوت (ذكر/أنثى).
  - عدد المشاهد (3 / 5 / 7).
- **رسائل تقدم أدق** لكل مرحلة فرعية (Firecrawl map → scrape → script → TTS × N → render).

## 5) الاتصالات المطلوبة

- **Firecrawl:** متصل بالفعل ✅
- **ElevenLabs:** سيُطلب الربط عبر `standard_connectors--connect` (بدون مفتاح يدوي).

---

## الملفات التي ستُعدَّل

```text
src/lib/ai.functions.ts        ← استبدال captureScreenshots بـ Firecrawl + إضافة synthesizeNarration
src/routes/studio.tsx          ← خيارات قبل البدء + معاينة + شاشات افتتاح/ختام + دمج صوت ElevenLabs
public/audio/bg.mp3            ← موسيقى خلفية (سأولّدها أو نضع ملفاً بسيطاً)
```

## ترتيب التنفيذ

1. ربط ElevenLabs.
2. تحديث `ai.functions.ts` (Firecrawl + TTS).
3. تحديث `studio.tsx` بخط الإنتاج الجديد + المعاينة.
4. إضافة شاشات الافتتاح/الختام والانتقالات.
5. اختبار على `https://hn-ai.pro` والتأكد من خروج MP4 يحتوي صوتاً.

هل أبدأ التنفيذ؟
