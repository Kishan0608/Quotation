import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/dal";
import { AccountForms } from "./account-forms";

export const metadata: Metadata = { title: "My account" };

export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const user = await requireUser();
  const reset = (await searchParams).reset === "1";
  return (
    <>
      <PageHeader title="My account" description={user.email} />
      <AccountForms fullName={user.fullName ?? ""} resetMode={reset} />
    </>
  );
}
