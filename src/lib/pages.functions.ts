import { createServerFn } from "@tanstack/react-start";

/** Discover a small, ordered list of page paths for a site (sitemap first, then homepage links). */
export const discoverPages = createServerFn({ method: "POST" })
  .inputValidator((input: { url: string }) => {
    const u = new URL(input.url);
    if (!/^https?:$/.test(u.protocol)) throw new Error("رابط غير صالح");
    return { url: u.origin };
  })
  .handler(async ({ data }) => {
    const origin = data.url;
    const paths = new Set<string>(["/"]);

    const add = (href: string) => {
      try {
        const u = new URL(href, origin);
        if (u.origin !== origin) return;
        if (/\.(png|jpe?g|svg|webp|gif|ico|css|js|json|xml|txt|pdf|zip)$/i.test(u.pathname)) return;
        const p = u.pathname.replace(/\/+$/, "") || "/";
        if (p.length > 60) return;
        paths.add(p);
      } catch {
        /* ignore malformed href */
      }
    };

    const get = async (path: string) => {
      try {
        const res = await fetch(`${origin}${path}`, {
          headers: { "user-agent": "Mozilla/5.0 (compatible; EcoAI-TourBot/1.0)" },
        });
        if (!res.ok) return null;
        return await res.text();
      } catch {
        return null;
      }
    };

    const sitemap = await get("/sitemap.xml");
    if (sitemap) {
      for (const m of sitemap.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) add(m[1]);
    }

    if (paths.size <= 1) {
      const html = await get("/");
      if (html) {
        for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) add(m[1]);
      }
    }

    const ordered = [...paths].sort((a, b) => {
      if (a === "/") return -1;
      if (b === "/") return 1;
      return a.split("/").length - b.split("/").length || a.localeCompare(b);
    });

    return { paths: ordered.slice(0, 12) };
  });
