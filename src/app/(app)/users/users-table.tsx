"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { fmtDate } from "@/lib/format";
import type { AppRole } from "@/lib/supabase/database.types";
import { updateUserAccess } from "./actions";

type UserRow = { id: string; email: string; full_name: string | null; role: AppRole; is_active: boolean; created_at: string };

export function UsersTable({ users, currentUserId }: { users: UserRow[]; currentUserId: string }) {
  const [busy, setBusy] = useState<string | null>(null);

  const update = async (u: UserRow, patch: { role?: AppRole; is_active?: boolean }) => {
    setBusy(u.id);
    const res = await updateUserAccess(u.id, patch);
    setBusy(null);
    if (res.ok) toast.success(`${u.email}: ${res.message}`);
    else toast.error(res.error);
  };

  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr className="border-b border-slate-200">
            <th className="px-4 py-2.5 font-medium">User</th>
            <th className="px-3 py-2.5 font-medium">Role</th>
            <th className="px-3 py-2.5 font-medium">Status</th>
            <th className="px-4 py-2.5 font-medium">Added</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {users.map((u) => {
            const self = u.id === currentUserId;
            return (
              <tr key={u.id} className={busy === u.id ? "opacity-60" : undefined}>
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-900">
                    {u.full_name || u.email}
                    {self ? (
                      <Badge tone="brand" className="ml-2">
                        You
                      </Badge>
                    ) : null}
                  </div>
                  {u.full_name ? <div className="text-xs text-slate-500">{u.email}</div> : null}
                </td>
                <td className="px-3 py-3">
                  {self ? (
                    <Badge tone="brand">{ROLE_LABELS[u.role]}</Badge>
                  ) : (
                    <Select aria-label={`Role for ${u.email}`} value={u.role} disabled={busy === u.id} onChange={(e) => update(u, { role: e.target.value as AppRole })} className="h-8 w-32 text-xs">
                      {(["admin", "editor", "viewer"] as const).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </Select>
                  )}
                </td>
                <td className="px-3 py-3">
                  {self ? (
                    <Badge tone="green">Active</Badge>
                  ) : (
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        role="switch"
                        checked={u.is_active}
                        disabled={busy === u.id}
                        onChange={(e) => update(u, { is_active: e.target.checked })}
                        className="peer sr-only"
                      />
                      <span className="relative h-5 w-9 rounded-full bg-slate-300 transition-colors peer-checked:bg-emerald-500 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-4" />
                      <span className="text-xs text-slate-600">{u.is_active ? "Active" : "Deactivated"}</span>
                    </label>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-500">{fmtDate(u.created_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
