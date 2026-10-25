"use client";

import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { Fragment, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/cn";
import { fmtNumber } from "@/lib/format";
import { formatNps, type PipeSize } from "@/lib/pipe/sizes";
import { SCHEDULES, type ScheduleKey } from "@/lib/pipe/schedules";
import { deletePipeSize, savePipeSize } from "./actions";

type Draft = Record<"nps" | "dn" | "od_mm" | ScheduleKey, string>;

const toDraft = (s?: PipeSize): Draft =>
  Object.fromEntries([
    ["nps", s?.nps ?? ""],
    ["dn", s?.dn == null ? "" : String(s.dn)],
    ["od_mm", s ? String(s.od_mm) : ""],
    ...SCHEDULES.map((k) => [k.key, s?.[k.key] == null ? "" : String(s[k.key])]),
  ]) as Draft;

export function SizeChart({ sizes, isAdmin }: { sizes: PipeSize[]; isAdmin: boolean }) {
  const [editing, setEditing] = useState<{ id: number | "new"; draft: Draft } | null>(null);
  const [saving, setSaving] = useState(false);
  const [hoverCol, setHoverCol] = useState<number | null>(null);
  const [toDelete, setToDelete] = useState<PipeSize | null>(null);
  const [deleting, setDeleting] = useState(false);

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    const res = await savePipeSize(editing.id === "new" ? null : editing.id, editing.draft);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(res.message);
    setEditing(null);
  };

  const runDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    const res = await deletePipeSize(toDelete.id);
    setDeleting(false);
    if (res.ok) {
      toast.success(res.message);
      setToDelete(null);
    } else toast.error(res.error);
  };

  const cellInput = (key: keyof Draft, width = "w-16") =>
    editing ? (
      <input
        aria-label={key}
        value={editing.draft[key]}
        onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, [key]: e.target.value } })}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(null);
        }}
        className={cn("num h-7 rounded border border-brand-300 bg-white px-1.5 text-center text-xs outline-none focus:ring-2 focus:ring-brand-500/20", width)}
      />
    ) : null;

  const editRow = () => (
    <tr className="bg-brand-50/60">
      <td className="sticky left-0 z-10 bg-brand-50 px-2 py-1.5">{cellInput("nps", "w-16")}</td>
      <td className="px-1 py-1.5">{cellInput("dn", "w-14")}</td>
      <td className="px-1 py-1.5">{cellInput("od_mm", "w-16")}</td>
      {SCHEDULES.map((s) => (
        <td key={s.key} className="px-1 py-1.5 text-center">
          {cellInput(s.key, "w-14")}
        </td>
      ))}
      <td className="px-2 py-1.5">
        <div className="flex justify-end gap-1">
          <Button size="icon-sm" onClick={save} loading={saving} aria-label="Save size">
            {!saving ? <Check /> : null}
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => setEditing(null)} aria-label="Cancel">
            <X />
          </Button>
        </div>
      </td>
    </tr>
  );

  return (
    <>
      <PageHeader
        title="Pipe size chart"
        actions={
          isAdmin ? (
            <Button onClick={() => setEditing({ id: "new", draft: toDraft() })} disabled={editing != null}>
              <Plus /> Add size
            </Button>
          ) : null
        }
      />
      <Card className="overflow-hidden">
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full min-w-[1200px] border-separate border-spacing-0 text-xs" onMouseLeave={() => setHoverCol(null)}>
            <thead>
              <tr className="bg-brand-900 text-white">
                <th className="sticky left-0 z-30 bg-brand-900 px-3 py-2.5 text-left font-semibold">NPS</th>
                <th className="px-2 py-2.5 font-semibold">DN</th>
                <th className="px-2 py-2.5 font-semibold">OD (mm)</th>
                {SCHEDULES.map((s, i) => (
                  <th key={s.key} className={cn("px-1.5 py-2.5 font-semibold whitespace-nowrap", hoverCol === i && "bg-brand-700")}>
                    {s.label.replace("SCH ", "")}
                  </th>
                ))}
                <th className="w-20 px-2 py-2.5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {editing?.id === "new" ? editRow() : null}
              {sizes.map((s) =>
                editing?.id === s.id ? (
                  <Fragment key={s.id}>{editRow()}</Fragment>
                ) : (
                  <tr
                    key={s.id}
                    className="group odd:bg-white even:bg-slate-50/70 hover:bg-brand-50"
                  >
                    <td className="sticky left-0 z-10 border-b border-slate-100 bg-inherit px-3 py-2 font-semibold text-slate-900">{formatNps(s.nps)}</td>
                    <td className="num border-b border-slate-100 px-2 py-2 text-center">{s.dn ?? <span className="text-slate-300">—</span>}</td>
                    <td className="num border-b border-slate-100 px-2 py-2 text-center font-medium">{s.od_mm}</td>
                    {SCHEDULES.map((k, i) => (
                      <td
                        key={k.key}
                        onMouseEnter={() => setHoverCol(i)}
                        className={cn("num border-b border-slate-100 px-1.5 py-2 text-center text-slate-700", hoverCol === i && "bg-brand-50")}
                      >
                        {s[k.key] != null ? fmtNumber(s[k.key], 2, 2) : ""}
                      </td>
                    ))}
                    <td className="border-b border-slate-100 px-2 py-1">
                      {isAdmin ? (
                        <div className="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Edit ${s.nps}`}
                            onClick={() => setEditing({ id: s.id, draft: toDraft(s) })}
                            disabled={editing != null}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Delete ${s.nps}`}
                            className="hover:bg-red-50 hover:text-red-600"
                            onClick={() => setToDelete(s)}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <ConfirmDialog
        open={toDelete != null}
        title={`Remove ${toDelete ? formatNps(toDelete.nps) : ""} from the chart?`}
        message="This cannot be undone."
        confirmLabel="Remove size"
        loading={deleting}
        onConfirm={runDelete}
        onClose={() => setToDelete(null)}
      />
    </>
  );
}
