import type { Metadata } from "next";
import { ArrowRight, Boxes, Building2, CheckCircle2, Circle, FilePlus2, FileText, FileUp, Ruler, Scale, Wallet } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/dal";
import { hasRole } from "@/lib/auth/roles";
import { cn } from "@/lib/cn";
import { fmtDate, fmtMoney, fmtQty, fmtWeight } from "@/lib/format";
import type { DashboardSummary } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard" };

const EMPTY: DashboardSummary = {
  inventory: { items: 0, total_qty: 0, total_weight_kg: 0, total_value: 0, low_stock: 0 },
  quotations: { total: 0, draft: 0, sent: 0, accepted: 0, this_month: 0 },
};

function Stat({ icon, label, value, hint, tone = "brand" }: { icon: ReactNode; label: string; value: ReactNode; hint?: ReactNode; tone?: "brand" | "green" | "amber" | "violet" }) {
  const tones = {
    brand: "bg-brand-50 text-brand-700",
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    violet: "bg-violet-50 text-violet-700",
  };
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className="num mt-1.5 truncate text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
          {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
        </div>
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl [&_svg]:size-5", tones[tone])}>{icon}</span>
      </div>
    </Card>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const [summaryRes, recentRes, companyRes] = await Promise.all([
    supabase.rpc("dashboard_summary"),
    supabase.from("quotations").select("id, quote_no, customer_name, quote_date, status, currency, grand_total").order("created_at", { ascending: false }).limit(6),
    supabase.from("company_settings").select("company_name, base_currency, address").maybeSingle(),
  ]);
  const summary = (summaryRes.data as DashboardSummary | null) ?? EMPTY;
  const recent = recentRes.data ?? [];
  const base = companyRes.data?.base_currency ?? "CNY";
  const canEdit = hasRole(user.role, "editor");

  const setup = [
    { done: Boolean(companyRes.data && companyRes.data.company_name !== "Your Company Name"), label: "Add your company details", href: "/settings", admin: true },
    { done: summary.inventory.items > 0, label: "Import or add your inventory", href: "/inventory" },
    { done: summary.quotations.total > 0, label: "Create your first quotation", href: "/quotations/new" },
  ].filter((s) => !s.admin || user.role === "admin");
  const showSetup = setup.some((s) => !s.done);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <>
      <PageHeader
        title={`${greeting}${user.fullName ? `, ${user.fullName.split(" ")[0]}` : ""}`}
        actions={
          canEdit ? (
            <>
              <ButtonLink href="/inventory" variant="outline">
                <Boxes /> Inventory
              </ButtonLink>
              <ButtonLink href="/quotations/new">
                <FilePlus2 /> New quotation
              </ButtonLink>
            </>
          ) : null
        }
      />

      {showSetup ? (
        <Card className="mb-6 overflow-hidden border-brand-200">
          <div className="flex flex-col gap-4 bg-gradient-to-r from-brand-50 to-white p-5 md:flex-row md:items-center">
            <div className="md:w-64">
              <h2 className="text-sm font-semibold text-brand-950">Getting started</h2>
            </div>
            <ol className="grid flex-1 gap-2 sm:grid-cols-3">
              {setup.map((s) => (
                <li key={s.label}>
                  <Link
                    href={s.href}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg border bg-white px-3 py-2.5 text-sm transition-colors",
                      s.done ? "border-emerald-200 text-emerald-800" : "border-slate-200 hover:border-brand-300 hover:text-brand-800",
                    )}
                  >
                    {s.done ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Circle className="size-4 text-slate-300" />}
                    <span className={cn(s.done && "line-through decoration-emerald-300")}>{s.label}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={<Boxes />} label="Inventory items" value={fmtQty(summary.inventory.items)} hint={`${fmtQty(summary.inventory.total_qty)} pcs in stock${summary.inventory.low_stock ? ` · ${summary.inventory.low_stock} out of stock` : ""}`} />
        <Stat icon={<Wallet />} label={`Stock value (${base})`} value={fmtMoney(summary.inventory.total_value)} hint="Price × quantity" tone="green" />
        <Stat icon={<Scale />} label="Stock weight" value={`${fmtWeight(Math.round(Number(summary.inventory.total_weight_kg)))} kg`} hint={`${fmtWeight(Math.round(Number(summary.inventory.total_weight_kg) / 100) / 10)} tonnes`} tone="violet" />
        <Stat
          icon={<FileText />}
          label="Quotations this month"
          value={fmtQty(summary.quotations.this_month)}
          hint={`${summary.quotations.total} total · ${summary.quotations.accepted} accepted · ${summary.quotations.draft} drafts`}
          tone="amber"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader
            title="Recent quotations"
            actions={
              <Link href="/quotations" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-800">
                View all <ArrowRight className="size-3" />
              </Link>
            }
          />
          {recent.length ? (
            <ul className="divide-y divide-slate-100">
              {recent.map((q) => (
                <li key={q.id}>
                  <Link href={`/quotations/${q.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-slate-50">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500">
                      <FileText className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{q.customer_name}</p>
                      <p className="text-xs text-slate-500">
                        {q.quote_no} · {fmtDate(q.quote_date)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="num text-sm font-semibold">
                        <span className="mr-1 text-xs font-normal text-slate-500">{q.currency}</span>
                        {fmtMoney(q.grand_total)}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <CardBody className="text-sm text-slate-500">No quotations yet.</CardBody>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Shortcuts" />
            <CardBody className="grid grid-cols-2 gap-2">
              {[
                { href: "/quotations/new", icon: FilePlus2, label: "New quotation", show: canEdit },
                { href: "/inventory", icon: FileUp, label: "Import Excel", show: canEdit },
                { href: "/sizes", icon: Ruler, label: "Size chart", show: true },
                { href: "/settings", icon: Building2, label: "Company", show: user.role === "admin" },
              ]
                .filter((s) => s.show)
                .map(({ href, icon: Icon, label }) => (
                  <Link key={href} href={href} className="flex items-center gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-700 hover:border-brand-300 hover:bg-brand-50/50 hover:text-brand-800">
                    <Icon className="size-4 text-brand-600" /> {label}
                  </Link>
                ))}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
