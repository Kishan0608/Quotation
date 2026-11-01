"use client";

import {
  Boxes,
  Building2,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Ruler,
  UserCircle,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { signOut } from "@/app/login/actions";
import { cn } from "@/lib/cn";

type NavItem = { href: string; label: string; icon: LucideIcon };

const MAIN_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/quotations", label: "Quotations", icon: FileText },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/inventory", label: "Inventory", icon: Boxes },
  { href: "/sizes", label: "Pipe size chart", icon: Ruler },
  { href: "/settings", label: "Company settings", icon: Building2 },
];

type ShellUser = { name: string; email: string };

export function AppShell({ user, companyName, children }: { user: ShellUser; companyName: string; children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the mobile drawer after navigating.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const isActive = (item: NavItem) => pathname === item.href || pathname.startsWith(`${item.href}/`);

  const renderNav = (items: NavItem[]) =>
    items.map((item) => {
        const active = isActive(item);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-white/10 text-white" : "text-brand-100/70 hover:bg-white/5 hover:text-white",
            )}
          >
            {active ? <span className="absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full bg-brand-400" /> : null}
            <Icon className={cn("size-4.5 shrink-0", active ? "text-brand-300" : "text-brand-200/60 group-hover:text-brand-200")} />
            {item.label}
          </Link>
        );
      });

  const initials = (user.name || user.email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

  const sidebar = (
    <div className="flex h-full flex-col bg-brand-950 text-white">
      <div className="flex h-16 items-center gap-3 px-5">
        <span className="grid size-9 place-items-center rounded-xl bg-brand-600 shadow-lg shadow-brand-900/50">
          <FileSpreadsheet className="size-4.5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">Quotation Panel</p>
          <p className="truncate text-[11px] text-brand-200/60">{companyName}</p>
        </div>
      </div>
      <nav className="scroll-thin flex-1 space-y-6 overflow-y-auto px-3 py-4" aria-label="Main">
        <div className="space-y-1">{renderNav(MAIN_NAV)}</div>
      </nav>
      <div className="border-t border-white/10 p-3">
        <Link href="/account" className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-700 text-xs font-semibold ring-2 ring-brand-500/40">
            {initials || <UserCircle className="size-4" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user.name || user.email}</p>
            {user.name ? <p className="truncate text-[11px] text-brand-200/60">{user.email}</p> : null}
          </div>
        </Link>
        <form action={signOut}>
          <button
            type="submit"
            className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-brand-100/70 transition-colors hover:bg-white/5 hover:text-white"
          >
            <LogOut className="size-4" /> Sign out
          </button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{sidebar}</aside>

      {/* Mobile top bar + drawer */}
      <div className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:hidden no-print">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="grid size-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100"
          aria-label="Open menu"
        >
          <Menu className="size-5" />
        </button>
        <span className="text-sm font-semibold">Quotation Panel</span>
      </div>
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 animate-fade-in bg-slate-900/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] animate-slide-in-right shadow-2xl">
            {sidebar}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute top-3.5 right-3 grid size-9 place-items-center rounded-lg text-brand-100 hover:bg-white/10"
              aria-label="Close menu"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>
      ) : null}

      <main className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}
