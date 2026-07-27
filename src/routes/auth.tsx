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

  useEffect(() => {
    if (denied) toast.error("هذا الحساب غير مصرّح له بالدخول.");
  }, [denied]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user && isOwner(data.user.email)) navigate({ to: "/studio", replace: true });
    });
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isOwner(email)) {
      toast.error("هذا البريد غير مصرّح له.");
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
          toast.success("تم إنشاء الحساب. تحقق من بريدك لتأكيده ثم سجّل الدخول.");
          return;
        }
      }
      navigate({ to: "/studio", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "تعذّر تسجيل الدخول");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main dir="rtl" className="min-h-screen flex items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-border bg-card/70 backdrop-blur p-6 space-y-4"
      >
        <div className="flex items-center gap-2 text-primary">
          <Lock className="h-5 w-5" />
          <h1 className="text-xl font-bold">دخول المشرف</h1>
        </div>
        <p className="text-sm text-muted-foreground">هذا الاستوديو خاص بالمالك فقط.</p>
        <div className="space-y-2">
          <Label htmlFor="email">البريد الإلكتروني</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">كلمة المرور</Label>
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
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "دخول"}
        </Button>
      </form>
    </main>
  );
}
