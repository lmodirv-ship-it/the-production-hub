import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { isOwner } from "@/lib/owner";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    if (!isOwner(data.user.email)) {
      await supabase.auth.signOut();
      throw redirect({ to: "/auth", search: { denied: "1" } });
    }
    return { user: data.user };
  },
  component: () => <Outlet />,
});
