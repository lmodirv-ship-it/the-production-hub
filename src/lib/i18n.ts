/** Tiny type-safe i18n for the studio UI (ar / en / fr). */

export type Lang = "ar" | "en" | "fr";

export const LANGS: { id: Lang; label: string }[] = [
  { id: "ar", label: "العربية" },
  { id: "en", label: "English" },
  { id: "fr", label: "Français" },
];

export function dirOf(lang: Lang) {
  return lang === "ar" ? "rtl" : "ltr";
}

const ar = {
  /* header + stage */
  headerTagline: "طابور تسجيل ← MP4 + نص",
  stageIdle: "ستُعرض هنا جولة كل موقع أثناء التصوير.",
  recording: "يسجّل",
  resume: "متابعة",
  pause: "إيقاف مؤقت",
  skip: "تخطّي",
  stopQueue: "إيقاف الطابور",

  /* sites panel */
  searchPlaceholder: "ابحث في مواقعك…",
  selectAll: (n: number) => `اختيار الكل (${n})`,
  clear: "مسح",
  extraLabel: "مواقع جديدة لم تُضف بعد (رابط في كل سطر)",

  /* settings */
  durationLabel: "مدة كل فيديو",
  minutes: (n: number) => `${n} دقائق`,
  qualityLabel: "الجودة",
  voiceLabel: "الصوت",
  voicePrefix: "صوت",
  voiceCalm: "هادئ",
  voiceLively: "حيوي",
  voiceSerious: "رصين",
  voiceWarm: "دافئ",
  languageLabel: "اللغة",
  micLabel: "تعليقي بالميكروفون",
  on: "مفعّل",
  off: "معطّل",
  chooseFolder: "اختر مجلد الحفظ (E:\\site presentation)",
  folderIs: (n: string) => `مجلد الحفظ: ${n}`,
  noFolderSupport: "متصفحك لا يدعم اختيار مجلد — ستنزل الملفات في مجلد التنزيلات.",

  /* actions */
  resumeNow: (s: number) => `استئناف الآن (تلقائي خلال ${s} ثانية)`,
  resumeSame: "استئناف من نفس الموقع",
  startQueue: (n: number) => `ابدأ التسجيل المتواصل (${n} موقع)`,
  estimate: (time: string, mb: number) => `تقدير: ${time} إجمالاً، حوالي ${mb} ميغابايت`,
  textsOnly: "توليد النصوص فقط (بدون تسجيل)",
  retryFailed: (n: number) => `إعادة محاولة المواقع الفاشلة (${n})`,

  /* progress */
  progress: (a: number, b: number) => `التقدّم: ${a} من ${b}`,
  statDone: "منتهية",
  statRunning: "قيد العمل",
  statPending: "في الانتظار",
  statFailed: "فاشلة",
  statSkipped: "متخطّاة",

  /* steps */
  step1: "اختر مواقعك (أو «اختيار الكل») وألصق أي موقع جديد في الخانة السفلية.",
  step2: "اختر مجلد الحفظ مرة واحدة — بعدها تُحفظ كل الملفات فيه تلقائياً.",
  step3: "كل موقع: جولة طويلة + تعليق صوتي + نص أسفل الفيديو، ثم MP4 و TXT و SRT باسم الموقع.",
  step4: "ينتقل للموقع التالي تلقائياً حتى ينتهي الطابور.",
  step5: "إذا نفدت أرصدة الذكاء الاصطناعي، يستمر التسجيل بدون صوت وتظهر وسوم مقترحة.",

  /* messages */
  msgIdle: "اختر مواقعك من القائمة ثم اضغط «ابدأ التسجيل المتواصل».",
  msgDiscover: (n: string) => `اكتشاف صفحات ${n}…`,
  msgWriting: (w: number, n: string) => `كتابة النص (${w} كلمة) لـ ${n}…`,
  msgVoice: (i: number, t: number, n: string) => `توليد الصوت ${i}/${t} — ${n}`,
  msgConverting: "جاري التحويل إلى MP4…",
  msgShooting: (n: string) => `جارٍ تصوير ${n} — لا تلمس شيئاً.`,
  msgSaving: (n: string) => `حفظ ملفات ${n}…`,
  msgStoppedManual: "توقّف التسجيل — اضغط «استئناف» للمتابعة من نفس الموقع.",
  msgAutoResume: (s: number) => `استئناف تلقائي خلال ${s} ثانية…`,
  msgSharing: "جارٍ تجهيز التسجيل…",
  msgNeedsClick: "المتصفح يحتاج نقرة لإعادة المشاركة — اضغط «استئناف» للمتابعة من نفس الموقع.",
  msgShareCancelled: "تم إلغاء المشاركة. اضغط «ابدأ» للمحاولة مجدداً.",
  msgQueueStopped: "تم إيقاف الطابور.",
  msgQueueDone: "اكتمل الطابور — كل الفيديوهات والنصوص جاهزة.",
  msgPaused: "تم الإيقاف المؤقت — اضغط متابعة للاستئناف.",
  msgResuming: "جارٍ الاستئناف…",
  msgWritingText: (n: string) => `كتابة نص ${n}…`,
  msgTextsDone: "تم توليد كل النصوص.",

  /* toasts */
  tFallback: (n: string) => `استُخدم سكربت احتياطي لـ ${n} بدون ذكاء اصطناعي.`,
  tMicDenied: "لم يُسمح بالميكروفون — سيتم التسجيل بدون صوتك.",
  tNoAudio: (n: string) => `تم تسجيل ${n} بدون تعليق صوتي.`,
  tBlocked: (n: string) => `${n}: الموقع يمنع التضمين — سيُعاد لاحقاً.`,
  tPickOne: "اختر موقعاً واحداً على الأقل.",
  tPickOrPaste: "اختر أو ألصق موقعاً واحداً على الأقل.",
  tNoSupport: "متصفحك لا يدعم التسجيل. استخدم Chrome أو Edge على الحاسوب.",
  tConfirm4k: "4K مكثف جداً للمتصفح وقد يتعطل لمدة طويلة. هل تريد الاستمرار بجودة 4K؟",
  tNoFailed: "لا يوجد مواقع فاشلة لإعادة المحاولة.",
  tFolderSet: (n: string) => `سيتم الحفظ في مجلد ${n}`,
  tFolderError: "تعذّر اختيار المجلد.",
  tAllDone: "اكتملت كل الفيديوهات.",

  /* queue notes */
  noteSavedNoAudio: "تم الحفظ (بدون تعليق صوتي)",
  noteSavedFolder: "حُفظ في المجلد",
  noteDownloaded: "نزل للتنزيلات",
  noteSkipped: "تم تخطّيه",
  noteBlocked: "الموقع يمنع التضمين",
  noteFailed: "تعذّر التسجيل",
  notePendingResume: "معلّق — استئناف تلقائي",
  noteTextReady: "نص جاهز",
  noteGenFailed: "تعذّر التوليد",

  /* auth */
  authTitle: "دخول المشرف",
  authSubtitle: "هذا الاستوديو خاص بالمالك فقط.",
  authEmail: "البريد الإلكتروني",
  authPassword: "كلمة المرور",
  authSubmit: "دخول",
  authDenied: "هذا الحساب غير مصرّح له بالدخول.",
  authNotOwner: "هذا البريد غير مصرّح له.",
  authCheckMail: "تم إنشاء الحساب. تحقق من بريدك لتأكيده ثم سجّل الدخول.",
  authFailed: "تعذّر تسجيل الدخول",
};

type Dict = typeof ar;

const en: Dict = {
  headerTagline: "Recording queue → MP4 + script",
  stageIdle: "Each site tour will play here while recording.",
  recording: "REC",
  resume: "Resume",
  pause: "Pause",
  skip: "Skip",
  stopQueue: "Stop queue",

  searchPlaceholder: "Search your sites…",
  selectAll: (n) => `Select all (${n})`,
  clear: "Clear",
  extraLabel: "New sites not in the list (one URL per line)",

  durationLabel: "Video length",
  minutes: (n) => `${n} minutes`,
  qualityLabel: "Quality",
  voiceLabel: "Voice",
  voicePrefix: "Voice",
  voiceCalm: "Calm",
  voiceLively: "Lively",
  voiceSerious: "Serious",
  voiceWarm: "Warm",
  languageLabel: "Language",
  micLabel: "Use my microphone",
  on: "On",
  off: "Off",
  chooseFolder: "Choose save folder (E:\\site presentation)",
  folderIs: (n) => `Save folder: ${n}`,
  noFolderSupport: "Your browser can't pick a folder — files go to Downloads.",

  resumeNow: (s) => `Resume now (auto in ${s}s)`,
  resumeSame: "Resume from the same site",
  startQueue: (n) => `Start continuous recording (${n} sites)`,
  estimate: (time, mb) => `Estimate: ${time} total, about ${mb} MB`,
  textsOnly: "Generate scripts only (no recording)",
  retryFailed: (n) => `Retry failed sites (${n})`,

  progress: (a, b) => `Progress: ${a} of ${b}`,
  statDone: "Done",
  statRunning: "Running",
  statPending: "Pending",
  statFailed: "Failed",
  statSkipped: "Skipped",

  step1: "Pick your sites (or “Select all”) and paste any new URL in the box below.",
  step2: "Choose the save folder once — every file lands there automatically.",
  step3: "Per site: a long tour + voice-over + burned captions, then MP4, TXT and SRT named after the site.",
  step4: "It moves to the next site automatically until the queue is finished.",
  step5: "If AI credits run out, recording continues without voice and suggested tags are shown.",

  msgIdle: "Pick your sites from the list, then press “Start continuous recording”.",
  msgDiscover: (n) => `Discovering pages of ${n}…`,
  msgWriting: (w, n) => `Writing the script (${w} words) for ${n}…`,
  msgVoice: (i, t, n) => `Generating audio ${i}/${t} — ${n}`,
  msgConverting: "Converting to MP4…",
  msgShooting: (n) => `Recording ${n} — please don't touch anything.`,
  msgSaving: (n) => `Saving ${n} files…`,
  msgStoppedManual: "Recording stopped — press “Resume” to continue from the same site.",
  msgAutoResume: (s) => `Auto-resuming in ${s}s…`,
  msgSharing: "Preparing the recording…",
  msgNeedsClick: "The browser needs a click to re-share — press “Resume” to continue.",
  msgShareCancelled: "Sharing was cancelled. Press “Start” to try again.",
  msgQueueStopped: "Queue stopped.",
  msgQueueDone: "Queue complete — every video and script is ready.",
  msgPaused: "Paused — press resume to continue.",
  msgResuming: "Resuming…",
  msgWritingText: (n) => `Writing the script for ${n}…`,
  msgTextsDone: "All scripts generated.",

  tFallback: (n) => `A fallback script was used for ${n} without AI.`,
  tMicDenied: "Microphone denied — recording will continue without your voice.",
  tNoAudio: (n) => `${n} was recorded without voice-over.`,
  tBlocked: (n) => `${n}: the site blocks embedding — it will be retried.`,
  tPickOne: "Pick at least one site.",
  tPickOrPaste: "Pick or paste at least one site.",
  tNoSupport: "Your browser doesn't support recording. Use Chrome or Edge on desktop.",
  tConfirm4k: "4K is very heavy for the browser and may freeze for a long time. Continue in 4K?",
  tNoFailed: "There are no failed sites to retry.",
  tFolderSet: (n) => `Files will be saved to ${n}`,
  tFolderError: "Couldn't pick the folder.",
  tAllDone: "All videos are complete.",

  noteSavedNoAudio: "Saved (no voice-over)",
  noteSavedFolder: "Saved to folder",
  noteDownloaded: "Downloaded",
  noteSkipped: "Skipped",
  noteBlocked: "Embedding blocked",
  noteFailed: "Recording failed",
  notePendingResume: "Pending — auto resume",
  noteTextReady: "Script ready",
  noteGenFailed: "Generation failed",

  authTitle: "Admin sign in",
  authSubtitle: "This studio is private to its owner.",
  authEmail: "Email",
  authPassword: "Password",
  authSubmit: "Sign in",
  authDenied: "This account is not allowed to sign in.",
  authNotOwner: "This email is not authorized.",
  authCheckMail: "Account created. Confirm your email, then sign in.",
  authFailed: "Sign-in failed",
};

const fr: Dict = {
  headerTagline: "File d'enregistrement → MP4 + script",
  stageIdle: "La visite de chaque site s'affichera ici pendant l'enregistrement.",
  recording: "REC",
  resume: "Reprendre",
  pause: "Pause",
  skip: "Passer",
  stopQueue: "Arrêter la file",

  searchPlaceholder: "Rechercher vos sites…",
  selectAll: (n) => `Tout sélectionner (${n})`,
  clear: "Effacer",
  extraLabel: "Nouveaux sites absents de la liste (une URL par ligne)",

  durationLabel: "Durée de chaque vidéo",
  minutes: (n) => `${n} minutes`,
  qualityLabel: "Qualité",
  voiceLabel: "Voix",
  voicePrefix: "Voix",
  voiceCalm: "Calme",
  voiceLively: "Dynamique",
  voiceSerious: "Sérieuse",
  voiceWarm: "Chaleureuse",
  languageLabel: "Langue",
  micLabel: "Utiliser mon micro",
  on: "Activé",
  off: "Désactivé",
  chooseFolder: "Choisir le dossier (E:\\site presentation)",
  folderIs: (n) => `Dossier d'enregistrement : ${n}`,
  noFolderSupport: "Votre navigateur ne gère pas le choix de dossier — les fichiers iront dans Téléchargements.",

  resumeNow: (s) => `Reprendre maintenant (auto dans ${s}s)`,
  resumeSame: "Reprendre au même site",
  startQueue: (n) => `Démarrer l'enregistrement continu (${n} sites)`,
  estimate: (time, mb) => `Estimation : ${time} au total, environ ${mb} Mo`,
  textsOnly: "Générer les scripts seulement (sans enregistrement)",
  retryFailed: (n) => `Réessayer les sites échoués (${n})`,

  progress: (a, b) => `Progression : ${a} sur ${b}`,
  statDone: "Terminés",
  statRunning: "En cours",
  statPending: "En attente",
  statFailed: "Échoués",
  statSkipped: "Ignorés",

  step1: "Choisissez vos sites (ou « Tout sélectionner ») et collez toute nouvelle URL ci-dessous.",
  step2: "Choisissez le dossier une seule fois — tous les fichiers y seront enregistrés.",
  step3: "Par site : une longue visite + voix off + sous-titres incrustés, puis MP4, TXT et SRT au nom du site.",
  step4: "Le passage au site suivant est automatique jusqu'à la fin de la file.",
  step5: "Si les crédits IA sont épuisés, l'enregistrement continue sans voix et des tags sont proposés.",

  msgIdle: "Choisissez vos sites puis cliquez sur « Démarrer l'enregistrement continu ».",
  msgDiscover: (n) => `Découverte des pages de ${n}…`,
  msgWriting: (w, n) => `Rédaction du script (${w} mots) pour ${n}…`,
  msgVoice: (i, t, n) => `Génération audio ${i}/${t} — ${n}`,
  msgConverting: "Conversion en MP4…",
  msgShooting: (n) => `Enregistrement de ${n} — ne touchez à rien.`,
  msgSaving: (n) => `Enregistrement des fichiers de ${n}…`,
  msgStoppedManual: "Enregistrement arrêté — cliquez sur « Reprendre » pour continuer au même site.",
  msgAutoResume: (s) => `Reprise automatique dans ${s}s…`,
  msgSharing: "Préparation de l'enregistrement…",
  msgNeedsClick: "Le navigateur demande un clic pour repartager — cliquez sur « Reprendre ».",
  msgShareCancelled: "Partage annulé. Cliquez sur « Démarrer » pour réessayer.",
  msgQueueStopped: "File arrêtée.",
  msgQueueDone: "File terminée — toutes les vidéos et scripts sont prêts.",
  msgPaused: "En pause — cliquez sur reprendre pour continuer.",
  msgResuming: "Reprise…",
  msgWritingText: (n) => `Rédaction du script de ${n}…`,
  msgTextsDone: "Tous les scripts ont été générés.",

  tFallback: (n) => `Un script de secours a été utilisé pour ${n}, sans IA.`,
  tMicDenied: "Micro refusé — l'enregistrement continuera sans votre voix.",
  tNoAudio: (n) => `${n} a été enregistré sans voix off.`,
  tBlocked: (n) => `${n} : le site bloque l'intégration — nouvelle tentative plus tard.`,
  tPickOne: "Choisissez au moins un site.",
  tPickOrPaste: "Choisissez ou collez au moins un site.",
  tNoSupport: "Votre navigateur ne gère pas l'enregistrement. Utilisez Chrome ou Edge sur ordinateur.",
  tConfirm4k: "La 4K est très lourde pour le navigateur et peut le figer longtemps. Continuer en 4K ?",
  tNoFailed: "Aucun site échoué à réessayer.",
  tFolderSet: (n) => `Les fichiers seront enregistrés dans ${n}`,
  tFolderError: "Impossible de choisir le dossier.",
  tAllDone: "Toutes les vidéos sont terminées.",

  noteSavedNoAudio: "Enregistré (sans voix off)",
  noteSavedFolder: "Enregistré dans le dossier",
  noteDownloaded: "Téléchargé",
  noteSkipped: "Ignoré",
  noteBlocked: "Intégration bloquée",
  noteFailed: "Échec de l'enregistrement",
  notePendingResume: "En attente — reprise auto",
  noteTextReady: "Script prêt",
  noteGenFailed: "Échec de la génération",

  authTitle: "Connexion administrateur",
  authSubtitle: "Ce studio est réservé à son propriétaire.",
  authEmail: "E-mail",
  authPassword: "Mot de passe",
  authSubmit: "Se connecter",
  authDenied: "Ce compte n'est pas autorisé à se connecter.",
  authNotOwner: "Cette adresse e-mail n'est pas autorisée.",
  authCheckMail: "Compte créé. Confirmez votre e-mail puis connectez-vous.",
  authFailed: "Échec de la connexion",
};

const DICTS: Record<Lang, Dict> = { ar, en, fr };

export function tr(lang: Lang): Dict {
  return DICTS[lang] ?? ar;
}

export const LANG_STORAGE_KEY = "eco-locale";

export function readStoredLang(): Lang {
  try {
    const raw = localStorage.getItem(LANG_STORAGE_KEY);
    const v = raw ? (JSON.parse(raw) as Lang) : "ar";
    return v === "en" || v === "fr" ? v : "ar";
  } catch {
    return "ar";
  }
}

/** Applies <html lang/dir> so the whole app flips direction with the language. */
export function applyDocumentLang(lang: Lang) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lang;
  document.documentElement.dir = dirOf(lang);
}
