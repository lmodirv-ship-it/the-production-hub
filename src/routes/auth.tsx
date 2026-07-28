import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isOwner, OWNER_EMAIL } from "@/lib/owner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LANGS, applyDocumentLang, dirOf, readStoredLang, tr, type Lang } from "@/lib/i18n";

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: z.object({ denied: z.string().optional() }),

  head: () => ({
    meta: [
      { title: "دخول المشرف | Eco AI Studio" },
      { name: "description", content: "صفحة دخول خاصة بمالك استوديو Eco AI لإنتاج فيديوهات المواقع." },
      { property: "og:title", content: "دخول المشرف | Eco AI Studio" },
      { property: "og:description", content: "صفحة دخول خاصة بمالك استوديو Eco AI." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { denied } = Route.useSearch();
  const [email, setEmail] = useState(OWNER_EMAIL);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [lang, setLang] = useState<Lang>("ar");
  const t = tr(lang);

  useEffect(() => {
    setLang(readStoredLang());
  }, []);

  useEffect(() => {
    applyDocumentLang(lang);
  }, [lang]);

  useEffect(() => {
    if (denied) toast.error(t.authDenied);
  }, [denied, t]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user && isOwner(data.user.email)) navigate({ to: "/studio", replace: true });
    });
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isOwner(email)) {
      toast.error(t.authNotOwner);
      return;
    }
    setBusy(true);
    try {
      let { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        // أول مرة: إنشاء حساب المالك ثم الدخول
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (signUpError) throw error;
        ({ error } = await supabase.auth.signInWithPassword({ email, password }));
        if (error) {
          toast.success(t.authCheckMail);
          return;
        }
      }
      navigate({ to: "/studio", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.authFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main dir={dirOf(lang)} className="min-h-screen flex items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-border bg-card/70 backdrop-blur p-6 space-y-4"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-primary">
            <Lock className="h-5 w-5" />
            <h1 className="text-xl font-bold">{t.authTitle}</h1>
          </div>
          <div className="flex rounded-lg border border-border p-0.5">
            {LANGS.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setLang(l.id)}
                className={`rounded-md px-2 py-1 text-[11px] font-semibold ${
                  lang === l.id ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{t.authSubtitle}</p>
        <div className="space-y-2">
          <Label htmlFor="email">{t.authEmail}</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">{t.authPassword}</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t.authSubmit}
        </Button>
      </form>
    </main>
  );
}
