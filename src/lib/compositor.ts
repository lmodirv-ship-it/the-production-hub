/** Composites the captured screen + a burned-in Arabic caption bar onto a canvas. */

export type Compositor = {
  stream: MediaStream;
  setCaption: (text: string) => void;
  setBadge: (text: string) => void;
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

export function startCompositor(
  source: MediaStream,
  width: number,
  height: number,
  fps: number,
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
  let raf = 0;
  let stopped = false;

  const fontSize = Math.round(height * 0.038);
  const pad = Math.round(height * 0.022);

  const draw = () => {
    if (stopped) return;
    raf = requestAnimationFrame(draw);
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (vw && vh) {
      const scale = Math.min(width / vw, height / vh);
      const w = vw * scale;
      const h = vh * scale;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, width, height);
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
  };
  raf = requestAnimationFrame(draw);

  return {
    stream: canvas.captureStream(fps),
    setCaption: (t) => { caption = t; },
    setBadge: (t) => { badge = t; },
    stop: () => {
      stopped = true;
      cancelAnimationFrame(raf);
      video.srcObject = null;
    },
  };
}
