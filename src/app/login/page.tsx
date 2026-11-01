import type { Metadata } from "next";
import { Boxes, FileSpreadsheet, Ruler, ShieldCheck } from "lucide-react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  link: "That sign-in link is invalid or has expired. Please request a new one.",
  inactive: "This account can't use the panel. Sign in with the panel's account.",
};

const FEATURES = [
  { icon: Boxes, title: "Inventory" },
  { icon: Ruler, title: "Pipe size chart" },
  { icon: FileSpreadsheet, title: "Excel & PDF quotations" },
  { icon: ShieldCheck, title: "Secure access" },
];

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  const errorKey = typeof params.error === "string" ? params.error : undefined;

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-brand-950 px-12 py-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
            backgroundSize: "36px 36px",
          }}
        />
        <div aria-hidden className="pointer-events-none absolute -top-32 -right-24 size-[28rem] rounded-full bg-brand-600/40 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-white/10 ring-1 ring-white/20">
            <FileSpreadsheet className="size-5" />
          </span>
          <span className="text-lg font-semibold tracking-tight">Quotation Panel</span>
        </div>
        <div className="relative max-w-lg">
          <h1 className="text-4xl leading-tight font-semibold tracking-tight">Pipe fitting quotations, made simple.</h1>
          <ul className="mt-10 grid gap-5">
            {FEATURES.map(({ icon: Icon, title }) => (
              <li key={title} className="flex items-center gap-3.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/10 ring-1 ring-white/15">
                  <Icon className="size-4" />
                </span>
                <p className="text-sm font-semibold">{title}</p>
              </li>
            ))}
          </ul>
        </div>
        <span />
      </section>

      <section className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="grid size-9 place-items-center rounded-lg bg-brand-700 text-white">
              <FileSpreadsheet className="size-4" />
            </span>
            <span className="text-base font-semibold">Quotation Panel</span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
          {errorKey && ERRORS[errorKey] ? (
            <p className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{ERRORS[errorKey]}</p>
          ) : null}
          <LoginForm next={next} />
        </div>
      </section>
    </main>
  );
}
