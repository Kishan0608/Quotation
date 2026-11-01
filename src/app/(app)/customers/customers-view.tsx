"use client";

import { Download, FileUp, Pencil, Plus, Search, Trash2, Users, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { cn } from "@/lib/cn";
import { CUSTOMER_PAGE_SIZES, type CustomerFilters } from "@/lib/customers/filters";
import type { CustomerRow } from "@/lib/supabase/database.types";
import { deleteCustomers } from "./actions";
import { CustomerForm, type CustomerFormMode } from "./customer-form";
import { CustomerImportDialog } from "./import-dialog";

type Props = { rows: CustomerRow[]; total: number; filters: CustomerFilters; loadError: string | null };

/** The saved customers: search, add, edit, delete, import and export Excel. */
export function CustomersView({ rows: initialRows, total, filters, loadError }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  // Local copy so an edit shows instantly; re-synced whenever the server sends new rows.
  const [rows, setRows] = useState(initialRows);
  const [syncedFrom, setSyncedFrom] = useState(initialRows);
  if (syncedFrom !== initialRows) {
    setSyncedFrom(initialRows);
    setRows(initialRows);
  }

  const [form, setForm] = useState<CustomerFormMode | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [toDelete, setToDelete] = useState<CustomerRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState(filters.q);

  const pushParams = (patch: Partial<Record<string, string | number>>) => {
    const merged = { q: filters.q, page: filters.page, size: filters.pageSize, ...patch };
    const params = new URLSearchParams();
    if (merged.q) params.set("q", String(merged.q));
    if (Number(merged.page) > 1) params.set("page", String(merged.page));
    if (Number(merged.size) !== 50) params.set("size", String(merged.size));
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
  }, []);
  const onSearch = (value: string) => {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => pushParams({ q: value.trim(), page: 1 }), 350);
  };

  const runDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    const res = await deleteCustomers([toDelete.id]);
    setDeleting(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(res.message);
    setToDelete(null);
  };

  const exportHref = `/api/customers/export${filters.q ? `?${new URLSearchParams({ q: filters.q })}` : ""}`;

  return (
    <>
      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="w-full max-w-md">
            <label htmlFor="cust-search" className="mb-1.5 block text-xs font-medium text-slate-700">
              Search
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
              <Input id="cust-search" value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Name, contact, phone, email or address…" className="pl-9" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {filters.q ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  pushParams({ q: "", page: 1 });
                }}
              >
                <X /> Clear
              </Button>
            ) : null}
            <a href={exportHref} className={buttonClasses("outline", "md")} download>
              <Download /> Export
            </a>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <FileUp /> Import Excel
            </Button>
            <Button onClick={() => setForm({ kind: "create" })}>
              <Plus /> Add customer
            </Button>
          </div>
        </div>

        {loadError ? <p className="m-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p> : null}

        <div className={cn("scroll-thin overflow-x-auto transition-opacity", pending && "opacity-60")}>
          {rows.length === 0 ? (
            <EmptyState
              icon={<Users />}
              title={filters.q ? "No customers match" : "No customers yet"}
              description={filters.q ? "Try another search." : "Add a customer or import an Excel list with the buttons above."}
            />
          ) : (
            <table className="w-full min-w-[900px] text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="w-[24%] py-2.5 pr-3 pl-4 font-medium">Customer / company</th>
                  <th className="w-[15%] px-3 py-2.5 font-medium">Contact person</th>
                  <th className="w-[13%] px-3 py-2.5 font-medium">Phone</th>
                  <th className="w-[18%] px-3 py-2.5 font-medium">Email</th>
                  <th className="w-[22%] px-3 py-2.5 font-medium">Address</th>
                  <th className="w-[8%] px-3 py-2.5">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((c) => (
                  <tr key={c.id} className="group hover:bg-slate-50/80">
                    <td className="py-2.5 pr-3 pl-4">
                      <p className="font-medium text-slate-900">{c.name}</p>
                      {c.note ? <p className="truncate text-xs text-slate-500">{c.note}</p> : null}
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">{c.contact_person}</td>
                    <td className="num px-3 py-2.5 text-slate-700">{c.phone}</td>
                    <td className="truncate px-3 py-2.5 text-slate-700">{c.email}</td>
                    <td className="px-3 py-2.5 text-xs text-slate-600">
                      <span className="line-clamp-2">{c.address}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
                        <Button variant="ghost" size="icon-sm" title="Edit" aria-label={`Edit ${c.name}`} onClick={() => setForm({ kind: "edit", customer: c })}>
                          <Pencil />
                        </Button>
                        <Button variant="ghost" size="icon-sm" title="Delete" aria-label={`Delete ${c.name}`} className="hover:bg-red-50 hover:text-red-600" onClick={() => setToDelete(c)}>
                          <Trash2 />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <Pagination
          page={filters.page}
          pageSize={filters.pageSize}
          total={total}
          noun={total === 1 ? "customer" : "customers"}
          pageSizes={CUSTOMER_PAGE_SIZES}
          onPage={(page) => pushParams({ page })}
          onPageSize={(size) => pushParams({ size, page: 1 })}
        />
      </Card>

      {form ? (
        <CustomerForm
          mode={form}
          onClose={() => setForm(null)}
          onSaved={(c) => {
            if (form.kind === "edit") setRows((list) => list.map((r) => (r.id === c.id ? c : r)));
          }}
        />
      ) : null}

      <CustomerImportDialog open={importOpen} onClose={() => setImportOpen(false)} />

      <ConfirmDialog
        open={toDelete != null}
        title={`Delete ${toDelete?.name ?? ""}?`}
        message="This cannot be undone. Saved quotations keep the customer details they have."
        confirmLabel="Delete"
        loading={deleting}
        onConfirm={runDelete}
        onClose={() => setToDelete(null)}
      />
    </>
  );
}
