/** Composites the captured screen + a burned-in caption bar + intro/outro cards onto a canvas. */

export type CardLocale = "ar" | "en" | "fr";

export type Card = {
  title: string;
  subtitle: string;
  kind: "intro" | "outro";
};

export type Compositor = {
  stream: MediaStream;
  setCaption: (text: string) => void;
  setBadge: (text: string) => void;
  setCard: (card: Card | null) => void;
  stop: () => void;
};


function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines.slice(-3);
}

function drawCard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  card: Card,
  fontSize: number,
  locale: CardLocale,
) {
  const grad = ctx.createLinearGradient(0, 0, width, height);
  if (card.kind === "intro") {
    grad.addColorStop(0, "#140c24");
    grad.addColorStop(1, "#240e4e");
  } else {
    grad.addColorStop(0, "#0d1a24");
    grad.addColorStop(1, "#0d2a2a");
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // subtle accent line
  ctx.strokeStyle = card.kind === "intro" ? "#a78bfa" : "#34d399";
  ctx.lineWidth = Math.max(2, height * 0.005);
  ctx.beginPath();
  ctx.moveTo(width * 0.2, height * 0.55);
  ctx.lineTo(width * 0.8, height * 0.55);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.direction = locale === "ar" ? "rtl" : "ltr";

  const titleSize = Math.round(height * 0.065);
  ctx.font = `800 ${titleSize}px "Segoe UI", Tahoma, system-ui, sans-serif`;
  ctx.fillStyle = "#ffffff";
  const titleLines = wrap(ctx, card.title, width * 0.8);
  titleLines.forEach((l, i) => {
    ctx.fillText(l, width / 2, height * 0.45 - titleLines.length * 0.55 * titleSize + i * (titleSize * 1.2));
  });

  ctx.direction = "ltr";
  const subSize = Math.round(height * 0.03);
  ctx.font = `500 ${subSize}px "Segoe UI", Tahoma, system-ui, sans-serif`;
  ctx.fillStyle = "#d1d5db";
  const subLines = wrap(ctx, card.subtitle, width * 0.8);
  subLines.forEach((l, i) => {
    ctx.fillText(l, width / 2, height * 0.6 + i * (subSize * 1.5));
  });

  const labels: Record<CardLocale, { intro: string; outro: string }> = {
    ar: { intro: "جولة تعريفية", outro: "شكراً للمشاهدة" },
    en: { intro: "Intro Tour", outro: "Thanks for watching" },
    fr: { intro: "Visite guidée", outro: "Merci d'avoir regardé" },
  };
  const label = labels[locale][card.kind];
  const labelSize = Math.round(height * 0.024);
  ctx.font = `700 ${labelSize}px "Segoe UI", Tahoma, system-ui, sans-serif`;
  ctx.fillStyle = card.kind === "intro" ? "#a78bfa" : "#34d399";
  ctx.fillText(label, width / 2, height * 0.78);
}


export function startCompositor(
  source: MediaStream,
  width: number,
  height: number,
  fps: number,
  locale: CardLocale = "ar",
): Compositor {
  const video = document.createElement("video");
  video.srcObject = source;
  video.muted = true;
  video.playsInline = true;
  void video.play().catch(() => {});

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false })!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  let caption = "";
  let badge = "";
  let card: Card | null = null;
  let raf = 0;
  let stopped = false;

  const fontSize = Math.round(height * 0.038);
  const pad = Math.round(height * 0.022);

  const draw = () => {
    if (stopped) return;
    raf = requestAnimationFrame(draw);

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);

    if (card) {
      drawCard(ctx, width, height, card, fontSize, locale);
    } else {

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw && vh) {
        const scale = Math.min(width / vw, height / vh);
        const w = vw * scale;
        const h = vh * scale;
        ctx.drawImage(video, (width - w) / 2, (height - h) / 2, w, h);
      }

      if (caption) {
        ctx.font = `600 ${fontSize}px "Segoe UI", Tahoma, system-ui, sans-serif`;
        ctx.direction = "rtl";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const lines = wrap(ctx, caption, width * 0.86);
        const lineH = fontSize * 1.45;
        const boxH = lines.length * lineH + pad * 1.6;
        const top = height - boxH - pad;

        const grad = ctx.createLinearGradient(0, top - pad * 2, 0, height);
        grad.addColorStop(0, "rgba(0,0,0,0)");
        grad.addColorStop(0.35, "rgba(0,0,0,0.55)");
        grad.addColorStop(1, "rgba(0,0,0,0.82)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, top - pad * 2, width, boxH + pad * 3);

        lines.forEach((l, i) => {
          const y = top + pad * 0.8 + lineH * (i + 0.5);
          ctx.lineWidth = Math.max(2, fontSize * 0.14);
          ctx.strokeStyle = "rgba(0,0,0,0.85)";
          ctx.strokeText(l, width / 2, y);
          ctx.fillStyle = "#ffffff";
          ctx.fillText(l, width / 2, y);
        });
      }

      if (badge) {
        const bf = Math.round(height * 0.026);
        ctx.font = `700 ${bf}px "Segoe UI", Tahoma, system-ui, sans-serif`;
        ctx.direction = "ltr";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        const tw = ctx.measureText(badge).width;
        const bx = Math.round(width * 0.03);
        const by = Math.round(height * 0.045);
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.beginPath();
        ctx.roundRect(bx, by - bf, tw + bf * 1.6, bf * 2, bf * 0.7);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.fillText(badge, bx + bf * 0.8, by);
      }
    }
  };
  raf = requestAnimationFrame(draw);

  return {
    stream: canvas.captureStream(fps),
    setCaption: (t) => {
      caption = t;
    },
    setBadge: (t) => {
      badge = t;
    },
    setCard: (c) => {
      card = c;
    },
    stop: () => {
      stopped = true;
      cancelAnimationFrame(raf);
      video.srcObject = null;
    },
  };
}

