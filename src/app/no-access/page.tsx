import type { Metadata } from "next";
import { Database, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOut } from "../login/actions";

export const metadata: Metadata = { title: "No access" };

export default async function NoAccessPage({ searchParams }: PageProps<"/no-access">) {
  const setupNeeded = (await searchParams).reason === "setup";

  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-card">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-amber-50 text-amber-600">
          {setupNeeded ? <Database className="size-6" /> : <ShieldAlert className="size-6" />}
        </span>
        {setupNeeded ? (
          <>
            <h1 className="mt-4 text-lg font-semibold">The database is not set up yet</h1>
            <p className="mt-2 text-sm text-slate-500">
              Run <code className="rounded bg-slate-100 px-1 text-xs">supabase/setup_all.sql</code> in Supabase → SQL Editor, then reload this page.
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-4 text-lg font-semibold">Your account is not active</h1>
            <p className="mt-2 text-sm text-slate-500">
              Ask an admin to activate your account.
            </p>
          </>
        )}
        <form action={signOut} className="mt-6">
          <Button type="submit" variant="outline" className="w-full">
            Sign out
          </Button>
        </form>
      </div>
    </main>
  );
}
