import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: company } = await supabase.from("company_settings").select("company_name").maybeSingle();

  return (
    <AppShell user={{ name: user.fullName ?? "", email: user.email }} companyName={company?.company_name ?? ""}>
      {children}
    </AppShell>
  );
}
