import type { Metadata } from "next";
import { AccessDenied, PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/dal";
import { getCompanySettings } from "@/lib/data/quotations";
import { createClient } from "@/lib/supabase/server";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Company settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  if (user.role !== "admin") return <AccessDenied message="Only admins can change company settings." />;
  const settings = await getCompanySettings(await createClient());
  if (!settings) return <AccessDenied message="Company settings are missing. Run the database migration first." />;

  return (
    <>
      <PageHeader title="Company settings" />
      <SettingsForm settings={settings} />
    </>
  );
}
