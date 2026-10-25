import type { Metadata } from "next";
import { Info } from "lucide-react";
import { AccessDenied, PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/dal";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { UsersTable } from "./users-table";

export const metadata: Metadata = { title: "Users & roles" };

export default async function UsersPage() {
  const user = await requireUser();
  if (user.role !== "admin") return <AccessDenied message="Only admins can manage users." />;
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id, email, full_name, role, is_active, created_at").order("created_at");

  return (
    <>
      <PageHeader
        title="Users & roles"
        description={(["admin", "editor", "viewer"] as const).map((r) => `${ROLE_LABELS[r]}: ${ROLE_DESCRIPTIONS[r]}`).join(" · ")}
      />
      <UsersTable users={data ?? []} currentUserId={user.id} />
      <p className="mt-4 flex items-center gap-2 text-sm text-slate-600">
        <Info className="size-4 shrink-0 text-sky-600" />
        To add a user: Supabase → Authentication → Users → Add user. New users start as Viewer.
      </p>
    </>
  );
}
