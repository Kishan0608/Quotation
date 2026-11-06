"use client";

import {
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Eraser,
  Eye,
  ListFilter,
  ListOrdered,
  Pencil,
  Plus,
  Redo2,
  RotateCcw,
  Scissors,
  TableColumnsSplit,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import {
  fmtMoney,
  fmtNumber,
  fmtQty,
  fmtWeight,
  parseNumber,
  round2,
  round3,
} from "@/lib/format";
import {
  autoUnitPrice,
  calcAmount,
  calcWeight,
  isBlankLine,
  lineAmount,
  lineWeight,
} from "@/lib/quotation/calc";
import {
  DEFAULT_SIZE,
  FONT_SIZES,
  ptToPx,
  withFmt,
  type BorderPreset,
  type MergeMode,
} from "@/lib/quotation/cell-format";
import {
  extraColumnTitle,
  pricePerPieceLabel,
  sheetColLetter,
  sheetColumnOrder,
} from "@/lib/quotation/export-columns";
import { sortLines } from "@/lib/quotation/line-order";
import { MAX_EXTRA_COLUMNS, MAX_SHEETS } from "@/lib/quotation/schema";
import {
  HIDEABLE_COLUMNS,
  STANDARD_COLUMNS,
  type CellFmt,
  type ExtraColumn,
  type HideableColumn,
  type ColumnLayoutPatch,
  type QuoteHeader,
  type LineOverrides,
  type QuoteLine,
  type QuoteTotals,
} from "@/lib/quotation/types";
import { useLocalStorage, writeLocalStorage } from "@/lib/use-local-storage";
import type { PickerItem } from "@/lib/inventory/types";
import { ItemSuggestList, useItemSuggestions } from "./item-suggest";
import { SheetFilterMenu, type FilterValue } from "./sheet-filter";
import { blankLine, lineFromItem, newKey } from "./line-utils";
import { RibbonGroup, SheetRibbon } from "./sheet-ribbon";

type BuiltinId =
  | "idx"
  | "description"
  | "unit_weight_kg"
  | "actual_weight"
  | "unit_price"
  | "qty"
  | "total_weight"
  | "amount"
  | "remarks";

type Col = {
  /** Built-in id, or `x:<key>` for an extra column. */
  id: string;
  builtin: BuiltinId | null;
  /** Extra column key (kind "extra"). */
  key?: string;
  label: string;
  /** The label is the default "Column L" title, not a name the user typed. */
  placeholder?: boolean;
  width: number;
  kind: "index" | "text" | "number" | "computed" | "extra";
  align: "left" | "center" | "right";
};

const GHOST_ROWS = 5;
/** The sheet always shows at least this many rows (above TOTAL), like an empty workbook. */
const MIN_ROWS = 10;
const ROW_HEADER_W = 44;
const WIDTHS_KEY = "qp.sheet-widths";
const ACCENT = "#217346";
const FONT: CSSProperties = {
  fontFamily: 'Calibri, Carlito, "Segoe UI", Arial, sans-serif',
  fontSize: 14,
};

// Same order as the supplier sheet. Letters follow the visible columns (A = No., B = Items, ...).
function columns(currency: string): Col[] {
  const b = (
    builtin: BuiltinId,
    label: string,
    width: number,
    kind: Col["kind"],
    align: Col["align"],
  ): Col => ({ id: builtin, builtin, label, width, kind, align });
  return [
    b("idx", "No.", 48, "index", "center"),
    b("description", "Items", 300, "text", "left"),
    b("unit_weight_kg", "WT IN KGS", 96, "number", "right"),
    b("actual_weight", "Actual Weight", 150, "text", "left"),
    b("unit_price", pricePerPieceLabel(currency), 104, "number", "right"),
    b("qty", "QTY", 84, "number", "right"),
    b("total_weight", "Total KG", 104, "computed", "right"),
    b("amount", "Total Amount", 124, "computed", "right"),
    b("remarks", "Note / Length", 130, "text", "left"),
  ];
}

const sheetRow = (lineIndex: number) => lineIndex + 2; // row 1 holds the column headers
const isHideable = (id: BuiltinId | null): id is HideableColumn =>
  id != null && (HIDEABLE_COLUMNS as readonly string[]).includes(id);

function newColumnKey(taken: ExtraColumn[]) {
  let k = "";
  while (!k || taken.some((x) => x.key === k))
    k = Math.random().toString(36).slice(2, 10);
  return k;
}

/** Value shown in the TOTAL row for a column (null = nothing). */
function totalFor(id: string, totals: QuoteTotals): number | null {
  if (id === "unit_price") return totals.totalPrice;
  if (id === "qty") return totals.totalQty;
  if (id === "total_weight") return totals.totalWeight;
  if (id === "amount") return totals.grossAmount;
  return null;
}

function rawValue(line: QuoteLine, col: Col): string {
  if (col.kind === "extra") return line.extra?.[col.key!] ?? "";
  switch (col.builtin) {
    case "qty":
    case "unit_weight_kg":
    case "unit_price": {
      const v = line[col.builtin];
      return v == null ? "" : String(v);
    }
    case "total_weight":
      return String(lineWeight(line));
    case "amount":
      return String(lineAmount(line));
    case "description":
    case "actual_weight":
    case "remarks":
      return line[col.builtin] ?? "";
    default:
      return "";
  }
}

function displayValue(line: QuoteLine, col: Col): string {
  switch (col.builtin) {
    case "qty":
      return fmtQty(line.qty);
    case "unit_weight_kg":
      return fmtWeight(line.unit_weight_kg);
    case "unit_price":
      return line.unit_price == null ? "" : fmtMoney(line.unit_price);
    case "total_weight":
      return line.unit_weight_kg == null && line.overrides?.total_weight == null ? "" : fmtWeight(lineWeight(line));
    case "amount":
      return line.qty == null && line.unit_price == null && line.overrides?.amount == null
        ? ""
        : fmtMoney(lineAmount(line));
    default:
      return rawValue(line, col);
  }
}

/** Excel formula of a computed cell; null when a source column was deleted (the value is shown instead). */
function formulaFor(
  id: string,
  row: number,
  letterOf: (id: BuiltinId) => string | null,
) {
  const ref = (src: BuiltinId) => {
    const l = letterOf(src);
    return l ? `${l}${row}` : null;
  };
  const [qty, wt, price] = [ref("qty"), ref("unit_weight_kg"), ref("unit_price")];
  if (id === "total_weight") return qty && wt ? `=${qty}*${wt}` : null;
  if (id === "amount") return qty && price ? `=ROUND(${qty}*${price},2)` : null;
  return null;
}

const LIMITS: Partial<Record<BuiltinId, number>> = {
  description: 300,
  remarks: 300,
  actual_weight: 100,
};

/** Applies typed text to one cell (`extraKey` = the extra column it goes into). */
function applyEdit(
  line: QuoteLine,
  col: Col,
  raw: string,
  header: QuoteHeader,
  extraKey: string | null,
): QuoteLine | string {
  const text = raw.trim();
  if (extraKey) {
    const extra = { ...line.extra };
    if (text) extra[extraKey] = text.slice(0, 300);
    else delete extra[extraKey];
    return { ...line, extra };
  }
  const num = () => {
    if (!text) return null;
    const n = parseNumber(text);
    if (n == null) throw new Error("Enter a number");
    if (n < 0) throw new Error("Value cannot be negative");
    if (n > 1e11) throw new Error("Value is too large");
    return n;
  };
  try {
    switch (col.builtin) {
      case "description":
      case "remarks":
      case "actual_weight":
        return { ...line, [col.builtin]: text.slice(0, LIMITS[col.builtin]) };
      case "qty":
        return { ...line, qty: num() };
      case "unit_weight_kg": {
        const next = { ...line, unit_weight_kg: num() };
        if (!next.price_overridden && header.pricing_basis === "kg")
          next.unit_price = autoUnitPrice(next, header) ?? next.unit_price;
        return next;
      }
      // Typed over the calculation (Excel: a value replaces the formula); empty = calculate again.
      case "total_weight":
      case "amount": {
        const key = col.builtin;
        const n = num();
        const overrides = { ...line.overrides };
        const calculated = key === "total_weight" ? calcWeight(line) : calcAmount(line);
        const value = n == null ? null : key === "total_weight" ? round3(n) : round2(n);
        if (value == null || value === calculated) delete overrides[key];
        else overrides[key] = value;
        return { ...line, overrides };
      }
      case "unit_price": {
        const n = num();
        if (n == null)
          return {
            ...line,
            unit_price: autoUnitPrice(line, header),
            price_overridden: false,
          };
        const price = round2(n);
        const auto = autoUnitPrice(line, header);
        return {
          ...line,
          unit_price: price,
          price_overridden: auto == null || auto !== price,
        };
      }
      default:
        return line;
    }
  } catch (e) {
    return (e as Error).message;
  }
}

type Pos = { r: number; c: number };
type Range = { r1: number; r2: number; c1: number; c2: number };
type FillArea = Range & { dir: "down" | "up" | "right" | "left" };
type Editing = { r: number; c: number; value: string; source: "cell" | "bar" };
type Menu = { x: number; y: number; kind: "cell" | "row" | "col" };
type TabMenu = { i: number; x: number; y: number };

const rangeOf = (a: Pos, b: Pos): Range => ({
  r1: Math.min(a.r, b.r),
  r2: Math.max(a.r, b.r),
  c1: Math.min(a.c, b.c),
  c2: Math.max(a.c, b.c),
});
const cellName = (p: Pos) => `${sheetColLetter(p.c)}${sheetRow(p.r)}`;

type Props = {
  /** Lines are priced in this currency (RMB). */
  baseCurrency: string;
  lines: QuoteLine[];
  onChange: (lines: QuoteLine[]) => void;
  header: QuoteHeader;
  totals: QuoteTotals;
  readOnly: boolean;
  /** A line to flash briefly (none when not given). */
  highlightKey?: string | null;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Excel-style sheet tabs. */
  sheetNames: string[];
  activeSheet: number;
  onSelectSheet: (i: number) => void;
  onAddSheet: () => void;
  /** Total KG / Total Amount can't be typed over (the China sheet). */
  lockTotals?: boolean;
  onRenameSheet: (i: number, name: string) => void;
  onDeleteSheet: (i: number) => void;
  /** Extra columns added/renamed/deleted, or standard columns deleted (hidden) / shown again. */
  onColumnsChange: (
    patch: ColumnLayoutPatch,
  ) => void;
  /** Select this row (e.g. the item just added from the search). */
  jumpTo?: { row: number } | null;
  /** The row the user moved the selection to (items added from the search go there). */
  onCursorRow?: (r: number) => void;
};

export function SheetGrid({
  baseCurrency,
  lines,
  onChange,
  header,
  totals,
  readOnly,
  highlightKey,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  sheetNames,
  activeSheet,
  onSelectSheet,
  onAddSheet,
  lockTotals = false,
  onRenameSheet,
  onDeleteSheet,
  onColumnsChange,
  jumpTo = null,
  onCursorRow,
}: Props) {
  // Column widths are remembered on this computer (like a saved workbook layout).
  const widthsRaw = useLocalStorage(WIDTHS_KEY);
  const savedWidths = useMemo<Record<string, number>>(() => {
    try {
      const parsed = JSON.parse(widthsRaw ?? "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }, [widthsRaw]);
  const [resizing, setResizing] = useState<{
    id: string;
    width: number;
  } | null>(null);
  const extras = header.extra_columns;
  const hidden = header.hidden_columns;
  const titles = header.column_titles;
  const defaultTitle = (id: BuiltinId) => columns(baseCurrency).find((c) => c.id === id)?.label ?? id;
  const cols = useMemo(() => {
    // Standard columns show their renamed title when the user typed one.
    const std = new Map(columns(baseCurrency).map((c) => [c.id, { ...c, label: titles?.[c.id as BuiltinId]?.trim() || c.label }]));
    const layout = { extra_columns: extras, hidden_columns: hidden };
    // No. isn't shown on the sheet (the row numbers already count the rows); the downloads keep it.
    const list: Col[] = sheetColumnOrder(layout)
      .filter((slot) => !(slot.kind === "std" && slot.id === "idx"))
      .map((slot) =>
      slot.kind === "std"
        ? std.get(slot.id)!
        : {
            id: `x:${slot.col.key}`,
            builtin: null,
            key: slot.col.key,
            label: extraColumnTitle(layout, slot.index),
            placeholder: !slot.col.name.trim(),
            width: 120,
            kind: "extra",
            align: "left",
          },
    );
    return list.map((c) => ({
      ...c,
      width:
        resizing?.id === c.id ? resizing.width : (savedWidths[c.id] ?? c.width),
    }));
  }, [baseCurrency, extras, hidden, titles, savedWidths, resizing]);
  const lastRealCol = cols.length - 1;
  const letterOf = (id: BuiltinId) => {
    const i = cols.findIndex((c) => c.id === id);
    return i < 0 ? null : sheetColLetter(i);
  };

  const [selRaw, setSel] = useState<Pos>({ r: 0, c: 0 });
  const [anchorRaw, setAnchor] = useState<Pos>({ r: 0, c: 0 });
  // A new jump request selects that row (state adjusted during render, React's documented pattern).
  const [seenJump, setSeenJump] = useState(jumpTo);
  if (jumpTo !== seenJump) {
    setSeenJump(jumpTo);
    if (jumpTo) {
      const p = { r: jumpTo.row, c: selRaw.c };
      setSel(p);
      setAnchor(p);
    }
  }
  const [editing, setEditing] = useState<Editing | null>(null);
  const [titleEdit, setTitleEdit] = useState<{
    c: number;
    value: string;
  } | null>(null);
  /** Fill handle drag: the cell under the pointer (the fill goes down, up, right or left towards it). */
  const [fillTo, setFillTo] = useState<Pos | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  /** Format Painter: the copied formats (rows x columns), pasted onto the next selection. */
  const [painter, setPainter] = useState<(CellFmt | undefined)[][] | null>(
    null,
  );
  /** Last block copied from this sheet, so a paste also brings its formatting. */
  const clip = useRef<{ text: string; fmts: (CellFmt | undefined)[][] } | null>(
    null,
  );
  const [tabMenu, setTabMenu] = useState<TabMenu | null>(null);
  const [renaming, setRenaming] = useState<{ i: number; value: string } | null>(
    null,
  );
  const drag = useRef<"select" | "fill" | "rows" | "cols" | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const totalRowIndex = Math.max(lines.length + GHOST_ROWS, MIN_ROWS);
  const rowCount = totalRowIndex + 1;
  const lastCol = cols.length - 1;

  const clampPos = useCallback(
    (r: number, c: number): Pos => ({
      r: Math.max(0, Math.min(rowCount - 1, r)),
      c: Math.max(0, Math.min(cols.length - 1, c)),
    }),
    [rowCount, cols.length],
  );

  // ---- Filters (Excel's AutoFilter) --------------------------------------------------
  // The values shown per column. Like Excel, a filter hides rows when it is applied (a row
  // being edited doesn't vanish); nothing is deleted and the totals still count every line.
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() => new Set());
  const [filterMenu, setFilterMenu] = useState<{ c: number; style: CSSProperties } | null>(null);
  const isNumericCol = (col: Col) => col.kind === "number" || col.kind === "computed";
  const shownText = (line: QuoteLine, col: Col) => displayValue(line, col).trim();
  const applyFilters = (next: Record<string, string[]>) => {
    setFilters(next);
    const active = Object.entries(next)
      .map(([id, shown]) => [cols.find((c) => c.id === id), new Set(shown)] as const)
      .filter((x): x is readonly [Col, Set<string>] => x[0] != null);
    setHiddenKeys(new Set(lines.filter((line) => active.some(([col, shown]) => !shown.has(shownText(line, col)))).map((l) => l.key)));
  };
  const hiddenRows = useMemo(() => {
    const rows = new Set<number>();
    lines.forEach((l, r) => hiddenKeys.has(l.key) && rows.add(r));
    return rows;
  }, [lines, hiddenKeys]);
  const filtering = Object.keys(filters).length > 0;
  /** The row to move to in `dir`, skipping rows a filter hides (stays at `from` if every row that way is hidden). */
  const visibleRow = (to: number, dir: number, from: number) => {
    let r = to;
    while (hiddenRows.has(r) && r > 0 && r < rowCount - 1) r += dir < 0 ? -1 : 1;
    return hiddenRows.has(r) ? from : r;
  };

  /** The column's values for the filter list: as shown, numbers in number order, blanks last. */
  const filterValues = (col: Col): FilterValue[] => {
    const seen = new Map<string, { count: number; n: number | null }>();
    for (const line of lines) {
      const text = shownText(line, col);
      const entry = seen.get(text);
      if (entry) entry.count++;
      else seen.set(text, { count: 1, n: isNumericCol(col) ? parseNumber(rawValue(line, col)) : null });
    }
    return [...seen.entries()]
      .sort(([a, x], [b, y]) =>
        a === "" ? 1 : b === "" ? -1 : x.n != null && y.n != null ? x.n - y.n : a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
      )
      .map(([text, { count }]) => ({ text, count }));
  };

  /** Sorts the sheet's lines by a column (Excel's Sort A to Z / Z to A); empty rows go last. Undo puts it back. */
  const sortBy = (c: number, dir: "asc" | "desc") => {
    const col = cols[c];
    const numeric = isNumericCol(col);
    const key = (l: QuoteLine) => (numeric ? parseNumber(rawValue(l, col)) : shownText(l, col) || null);
    const filled = lines.filter((l) => !isBlankLine(l));
    const sorted = [...filled].sort((a, b) => {
      const x = key(a);
      const y = key(b);
      if (x == null || y == null) return x == null && y == null ? 0 : x == null ? 1 : -1;
      const cmp = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: "base" });
      return dir === "asc" ? cmp : -cmp;
    });
    onChange(sorted);
    setFilterMenu(null);
  };

  /** The quotation's standard order (line-order.ts): elbows, reducers, tees...; empty rows go last. Undo puts it back. */
  const sortStandard = () => {
    const sorted = sortLines(lines);
    if (sorted === lines) {
      toast.info("The items are already in standard order.");
      return;
    }
    onChange(sorted);
    toast.success("Sorted in standard order (Ctrl+Z to undo).");
  };

  /** Opens the sort & filter menu of column `c` where the right-click menu was. */
  const openFilter = (c: number, x: number, y: number) =>
    setFilterMenu({ c, style: { left: Math.max(8, Math.min(x, window.innerWidth - 264)), top: Math.max(8, Math.min(y, window.innerHeight - 440)) } });
  // Rows/columns can disappear (deleted), so the selection is always read clamped to the sheet.
  const sel = clampPos(selRaw.r, selRaw.c);
  const anchor = clampPos(anchorRaw.r, anchorRaw.c);
  const range = rangeOf(anchor, sel);
  const multi = range.r1 !== range.r2 || range.c1 !== range.c2;
  // Whole rows (row numbers clicked) / whole columns (column letters clicked), like Excel.
  const fullRows = range.c1 === 0 && range.c2 >= lastCol;
  const fullCols = range.r1 === 0 && range.r2 >= rowCount - 1;
  // The active (white) cell: for whole rows/columns it is where the selection started (like Excel;
  // Items rather than No. for a row), otherwise the cell the selection moved to.
  const cursor =
    fullRows || fullCols ? anchor : sel;
  // Whole rows/columns don't scroll the sheet (their far end is off screen).
  const followKey = fullRows || fullCols ? "" : `${sel.r}:${sel.c}`;

  const saveWidths = (next: Record<string, number>) =>
    writeLocalStorage(WIDTHS_KEY, JSON.stringify(next));

  const select = useCallback((p: Pos, extend = false) => {
    setSel(p);
    if (!extend) setAnchor(p);
  }, []);

  // Keep the active cell visible by scrolling the grid itself (never the page),
  // and only once the user has moved the selection.
  const selectionTouched = useRef(false);
  useEffect(() => {
    const grid = gridRef.current;
    const el = followKey
      ? grid?.querySelector<HTMLElement>(`[data-cell="${followKey}"]`)
      : null;
    if (!grid || !el) return;
    // A jump from the search above the sheet scrolls even when it is the first move.
    if (!selectionTouched.current) {
      selectionTouched.current = true;
      if (!seenJump) return;
    }
    const g = grid.getBoundingClientRect();
    const c = el.getBoundingClientRect();
    const headerHeight = 50; // column letters + column titles
    if (c.top < g.top + headerHeight)
      grid.scrollTop -= g.top + headerHeight - c.top;
    else if (c.bottom > g.bottom) grid.scrollTop += c.bottom - g.bottom;
    if (c.left < g.left + ROW_HEADER_W)
      grid.scrollLeft -= g.left + ROW_HEADER_W - c.left;
    else if (c.right > g.right) grid.scrollLeft += c.right - g.right;
  }, [followKey, seenJump]);

  const focusGrid = () => gridRef.current?.focus({ preventScroll: true });
  /** The fx bar: typing there edits the selected cell, like Excel's formula bar. */
  const barRef = useRef<HTMLInputElement>(null);

  // Tell the page which row is selected once the user has moved the selection.
  const cursorReported = useRef(false);
  useEffect(() => {
    if (!cursorReported.current) {
      cursorReported.current = true;
      return;
    }
    onCursorRow?.(cursor.r);
  }, [cursor.r, onCursorRow]);

  const lineAt = (r: number) => (r < lines.length ? lines[r] : null);
  const currentLine = lineAt(cursor.r);
  const currentCol = cols[cursor.c];
  const isTotalRow = cursor.r === totalRowIndex;

  const cellRaw = (r: number, c: number) => {
    const line = lineAt(r);
    const col = cols[c];
    if (r === totalRowIndex) {
      const total = totalFor(col.id, totals);
      if (total != null) return String(total);
      return col.id === "description" ? "TOTAL" : "";
    }
    return line ? rawValue(line, col) : "";
  };

  const formulaBarText = (() => {
    if (editing) return editing.value;
    const col = currentCol;
    if (isTotalRow && totalFor(col.id, totals) != null && lines.length) {
      const letter = sheetColLetter(cursor.c);
      return `=SUM(${letter}2:${letter}${sheetRow(lines.length - 1)})`;
    }
    if (currentLine && col.kind === "computed" && currentLine.overrides?.[col.id as keyof LineOverrides] == null)
      return (
        formulaFor(col.id, sheetRow(cursor.r), letterOf) ??
        cellRaw(cursor.r, cursor.c)
      );
    return cellRaw(cursor.r, cursor.c);
  })();

  // Every cell but the row numbers: Total KG / Total Amount take a typed value too.
  const isEditableCol = (c: number) => cols[c].kind !== "index" && !(lockTotals && cols[c].kind === "computed");
  const isEditable = (r: number, c: number) =>
    !readOnly && r !== totalRowIndex && isEditableCol(c);

  const startEdit = (
    r: number,
    c: number,
    initial?: string,
    source: "cell" | "bar" = "cell",
  ) => {
    if (!isEditable(r, c)) return;
    select({ r, c });
    setEditing({ r, c, value: initial ?? cellRaw(r, c), source });
  };

  // ---- Extra columns ---------------------------------------------------------------
  /** Writes a value into a cell; ghost rows become new lines. Returns an error message if invalid. */
  const writeCell = (
    base: QuoteLine[],
    r: number,
    c: number,
    raw: string,
  ): QuoteLine[] | string => {
    const col = cols[c];
    if (!isEditableCol(c)) return base;
    const existing = r < base.length ? base[r] : null;
    const line = existing ?? blankLine(activeSheet);
    const result = applyEdit(
      line,
      col,
      raw,
      header,
      col.kind === "extra" ? col.key! : null,
    );
    if (typeof result === "string") return result;
    if (existing) {
      const copy = base.slice();
      // Editing a row that Import marked red means it has been looked at.
      copy[r] = existing.check ? { ...result, check: undefined } : result;
      return copy;
    }
    if (isBlankLine(result)) return base;
    // Like Excel, the entry stays in the row it was typed in: the empty rows above it are kept.
    const copy = base.slice();
    while (copy.length < r) copy.push(blankLine(activeSheet));
    copy[r] = result;
    return copy;
  };

  /** Saves the cell being typed in. `refocus` = false when something outside the sheet (a ribbon
   *  box) is taking the keyboard, so the keys typed there don't land in the sheet. */
  const commit = (move?: { dr: number; dc: number }, refocus = true) => {
    if (!editing) return;
    const original = cellRaw(editing.r, editing.c);
    if (editing.value !== original) {
      const next = writeCell(lines, editing.r, editing.c, editing.value);
      if (typeof next === "string") {
        toast.error(next);
        return;
      }
      if (next !== lines) onChange(next);
    }
    const moved = move ? clampPos(editing.r + move.dr, editing.c + move.dc) : { r: editing.r, c: editing.c };
    const target = move?.dr ? { ...moved, r: visibleRow(moved.r, move.dr, editing.r) } : moved;
    setEditing(null);
    select(target);
    if (refocus) requestAnimationFrame(focusGrid);
  };

  const cancel = () => {
    setEditing(null);
    requestAnimationFrame(focusGrid);
  };

  // ---- Inventory suggestions while typing in an Items cell ------------------------------
  const descCol = cols.findIndex((col) => col.builtin === "description");
  const suggest = useItemSuggestions(editing && editing.source === "cell" && editing.c === descCol ? editing.value : null);
  /** The highlighted suggestion (-1 = none: Enter keeps the typed text) and Esc-closed, per typed text. */
  const [suggestRaw, setSuggestState] = useState({ q: "", active: -1, closed: false });
  const suggestState = suggestRaw.q === suggest.query ? suggestRaw : { q: suggest.query, active: -1, closed: false };
  const suggestOpen = suggest.query !== "" && !suggestState.closed && (suggest.items.length > 0 || suggest.loading || suggest.done);
  const [suggestPos, setSuggestPos] = useState<CSSProperties | null>(null);
  useEffect(() => {
    if (!suggestOpen) return;
    // Under the cell (above it near the bottom of the window), following the sheet as it scrolls.
    const place = () => {
      const el = gridRef.current?.querySelector<HTMLElement>("[data-cell-editor]");
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const width = Math.max(rect.width, 400);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
      const below = window.innerHeight - rect.bottom;
      // About eight items high; the rest scroll inside the list.
      const cap = 380;
      setSuggestPos(
        below >= 240 || below >= rect.top
          ? { left, width, top: rect.bottom + 2, maxHeight: Math.min(cap, below - 12) }
          : { left, width, bottom: window.innerHeight - rect.top + 2, maxHeight: Math.min(cap, rect.top - 12) },
      );
    };
    const raf = requestAnimationFrame(place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [suggestOpen, editing?.r, editing?.c]);

  /** The chosen inventory item fills the row (its quantity kept), then the Quantity cell is selected. */
  const pickSuggestion = (item: PickerItem) => {
    if (!editing) return;
    const { r, c } = editing;
    const existing = r < lines.length ? lines[r] : null;
    const fresh = lineFromItem(item, existing?.qty ?? 1, header, activeSheet);
    const line: QuoteLine = existing ? { ...fresh, key: existing.key, fmt: existing.fmt, extra: existing.extra } : fresh;
    const copy = lines.slice();
    while (copy.length < r) copy.push(blankLine(activeSheet));
    copy[r] = line;
    onChange(copy);
    setEditing(null);
    const qtyCol = cols.findIndex((col) => col.builtin === "qty");
    select({ r, c: qtyCol >= 0 ? qtyCol : c });
    requestAnimationFrame(focusGrid);
  };

  /** Keys for the suggestion list; true when the key was used by it. */
  const suggestKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!suggestOpen) return false;
    const n = suggest.items.length;
    const { active } = suggestState;
    if (e.key === "ArrowDown") {
      if (n) setSuggestState({ ...suggestState, active: Math.min(active + 1, n - 1) });
      return true;
    }
    if (e.key === "ArrowUp" && active >= 0) {
      setSuggestState({ ...suggestState, active: active - 1 });
      return true;
    }
    if ((e.key === "Enter" || e.key === "Tab") && active >= 0 && active < n) {
      pickSuggestion(suggest.items[active]);
      return true;
    }
    if (e.key === "Escape") {
      setSuggestState({ ...suggestState, closed: true });
      return true;
    }
    return false;
  };

  /** Column title (row 1): renames a standard column, or names an extra column. */
  const commitTitle = (refocus = true) => {
    if (!titleEdit) return;
    const col = cols[titleEdit.c];
    const name = titleEdit.value.trim().slice(0, 40);
    setTitleEdit(null);
    if (refocus) requestAnimationFrame(focusGrid);
    if (!col || readOnly) return;
    if (col.builtin) {
      // Empty or the normal title again = back to the normal title.
      const next = { ...titles };
      if (!name || name === defaultTitle(col.builtin)) delete next[col.builtin];
      else next[col.builtin] = name;
      if (JSON.stringify(next) !== JSON.stringify(titles ?? {})) onColumnsChange({ column_titles: next });
      return;
    }
    if (
      col.kind === "extra" &&
      name !== extras.find((x) => x.key === col.key)?.name
    ) {
      onColumnsChange({
        extra_columns: extras.map((x) =>
          x.key === col.key ? { ...x, name } : x,
        ),
      });
    }
  };
  const startTitleEdit = (c: number) => {
    const col = cols[c];
    if (readOnly || !col) return;
    setTitleEdit({
      c,
      value: col.builtin ? col.label : (extras.find((x) => x.key === col.key)?.name ?? ""),
    });
  };

  // ---- Block operations --------------------------------------------------------------
  const rangeText = (rg: Range) => {
    const rows: string[] = [];
    for (let r = rg.r1; r <= rg.r2; r++) {
      const cells: string[] = [];
      for (let c = rg.c1; c <= rg.c2; c++) cells.push(cellRaw(r, c));
      rows.push(cells.join("\t"));
    }
    return rows.join("\n");
  };

  const clearRange = (rg: Range) => {
    if (readOnly) return;
    let next = lines;
    for (let r = rg.r1; r <= Math.min(rg.r2, lines.length - 1); r++) {
      for (let c = rg.c1; c <= rg.c2; c++) {
        if (!isEditableCol(c)) continue;
        const result = writeCell(next, r, c, "");
        if (typeof result !== "string") next = result;
      }
    }
    if (next !== lines) onChange(next);
  };

  const pasteText = (text: string) => {
    if (readOnly || !text) return;
    const rows = text
      .replace(/\r\n?/g, "\n")
      .replace(/\n$/, "")
      .split("\n")
      .map((r) => r.split("\t"));
    if (rows.length > 500) {
      toast.error("You can paste at most 500 rows at once.");
      return;
    }
    let next = lines;
    let written = 0;
    const startRow = range.r1;
    // Copied from this sheet: bring the formatting along (like Excel's normal paste).
    const normalized = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
    const fmts =
      clip.current &&
      clip.current.text.replace(/\r\n?/g, "\n").replace(/\n$/, "") ===
        normalized
        ? clip.current.fmts
        : null;
    for (let i = 0; i < rows.length; i++) {
      for (let j = 0; j < rows[i].length; j++) {
        const c = range.c1 + j;
        if (c >= cols.length) break;
        const r = startRow + i;
        const result = writeCell(next, r, c, rows[i][j]);
        if (typeof result === "string") {
          toast.error(`Row ${i + 1}, column ${sheetColLetter(c)}: ${result}`);
          continue;
        }
        if (result !== next) written++;
        next = result;
        if (fmts && r < next.length) {
          const formatted = withFmt(next[r], cols[c].id, fmts[i]?.[j], true);
          if (formatted !== next[r]) {
            next = next.slice();
            next[r] = formatted;
          }
        }
      }
    }
    if (next !== lines) {
      onChange(next);
      setAnchor({ r: startRow, c: range.c1 });
      setSel(
        clampPos(
          startRow + rows.length - 1,
          range.c1 + Math.max(...rows.map((r) => r.length)) - 1,
        ),
      );
      toast.success(`Pasted ${written} cell${written === 1 ? "" : "s"}.`);
    }
  };

  /**
   * Fill handle: copies the selected block into the dragged area - down, up, right or left -
   * repeating it like Excel's copy-fill, values and formatting together.
   */
  const applyFill = (area: FillArea | null) => {
    if (readOnly || !area) return;
    const h = range.r2 - range.r1 + 1;
    const w = range.c2 - range.c1 + 1;
    const wrap = (x: number, start: number, size: number) => start + ((((x - start) % size) + size) % size);
    const sideways = area.dir === "left" || area.dir === "right";
    let next = lines;
    let skipped = 0;
    for (let r = area.r1; r <= area.r2; r++) {
      const src = lineAt(wrap(r, range.r1, h));
      for (let c = area.c1; c <= area.c2; c++) {
        if (!isEditableCol(c)) continue;
        const sc = wrap(c, range.c1, w);
        const row = r;
        const result = writeCell(next, row, c, src ? rawValue(src, cols[sc]) : "");
        if (typeof result === "string") {
          skipped++; // e.g. text dragged into a number column
          continue;
        }
        next = result;
        if (row < next.length) {
          const f = src?.fmt?.[cols[sc].id];
          // A merge belongs to its own columns, so it isn't copied sideways.
          const formatted = withFmt(next[row], cols[c].id, f && sideways ? { ...f, merge: undefined } : f, true);
          if (formatted !== next[row]) {
            next = next.slice();
            next[row] = formatted;
          }
        }
      }
    }
    if (next !== lines) onChange(next);
    if (skipped) toast.info(`${skipped} cell${skipped === 1 ? "" : "s"} skipped: the value doesn't fit that column (for example text in a number column).`);
    // The selection grows over the filled cells, like Excel.
    setAnchor({ r: Math.min(range.r1, area.r1), c: Math.min(range.c1, area.c1) });
    setSel({ r: Math.max(range.r2, area.r2), c: Math.max(range.c2, area.c2) });
  };

  const rowOp = (
    op: "above" | "below" | "duplicate" | "up" | "down" | "delete" | "reprice" | "checked",
  ) => {
    if (readOnly) return;
    const r1 = range.r1;
    const r2 = Math.min(range.r2, lines.length - 1);
    const next = lines.slice();
    if (op === "above" || op === "below") {
      const at = op === "above" ? r1 : range.r2 + 1;
      // Below the last line every row is already empty: nothing to move down.
      if (at < lines.length) {
        next.splice(at, 0, blankLine(activeSheet));
        onChange(next);
      }
      select(clampPos(at, sel.c));
      return;
    }
    if (r1 >= lines.length) return;
    if (op === "delete" && fullCols && !fullRows) {
      toast.info("To delete rows, select them by clicking the row numbers.");
      return;
    }
    if (op === "duplicate") {
      const copies = lines
        .slice(r1, r2 + 1)
        .map((l) => ({ ...l, key: newKey() }));
      next.splice(r2 + 1, 0, ...copies);
      setAnchor(clampPos(r2 + 1, range.c1));
      setSel(clampPos(r2 + copies.length, range.c2));
    } else if (op === "up" && r1 > 0) {
      const [moved] = next.splice(r1 - 1, 1);
      next.splice(r2, 0, moved);
      setAnchor({ ...anchor, r: anchor.r - 1 });
      setSel({ ...sel, r: sel.r - 1 });
    } else if (op === "down" && r2 < lines.length - 1) {
      const [moved] = next.splice(r2 + 1, 1);
      next.splice(r1, 0, moved);
      setAnchor({ ...anchor, r: anchor.r + 1 });
      setSel({ ...sel, r: sel.r + 1 });
    } else if (op === "delete") {
      next.splice(r1, r2 - r1 + 1);
      if (fullRows) {
        setAnchor({ r: r1, c: 0 });
        setSel({ r: r1, c: lastCol });
      } else select(clampPos(r1, sel.c));
    } else if (op === "checked") {
      for (let r = r1; r <= r2; r++) if (lines[r].check) next[r] = { ...lines[r], check: undefined };
    } else if (op === "reprice") {
      let missing = 0;
      for (let r = r1; r <= r2; r++) {
        const price = autoUnitPrice(lines[r], header);
        if (price == null) missing++;
        else
          next[r] = { ...lines[r], unit_price: price, price_overridden: false };
      }
      if (missing === r2 - r1 + 1) {
        toast.info("No inventory price or weight to calculate from.");
        return;
      }
    } else {
      return;
    }
    onChange(next);
    requestAnimationFrame(focusGrid);
  };

  /**
   * Column operations. Extra columns are really inserted/removed; the standard columns
   * (No., Items and Total Amount excepted) are hidden on this quotation, so the totals keep working.
   */
  const colOp = (op: "left" | "right" | "delete" | "showAll") => {
    if (readOnly) return;
    if (op === "showAll") {
      onColumnsChange({ hidden_columns: [] });
      return;
    }
    if (op === "left" || op === "right") {
      // A new empty column right before / after the selected column(s), at exactly that spot.
      if (extras.length >= MAX_EXTRA_COLUMNS) {
        toast.error(
          `A quotation can have at most ${MAX_EXTRA_COLUMNS} extra columns.`,
        );
        return;
      }
      const col = cols[op === "left" ? range.c1 : range.c2];
      const key = newColumnKey(extras);
      const next = extras.slice();
      if (col.kind === "extra") {
        const i = extras.findIndex((x) => x.key === col.key);
        const after = extras[i].after;
        next.splice(
          op === "left" ? i : i + 1,
          0,
          after ? { key, name: "", after } : { key, name: "" },
        );
      } else if (!col.builtin) {
        next.push({ key, name: "" });
      } else if (op === "right") {
        const first = next.findIndex((x) => x.after === col.builtin);
        next.splice(first < 0 ? next.length : first, 0, {
          key,
          name: "",
          after: col.builtin,
        });
      } else {
        const pos = STANDARD_COLUMNS.indexOf(col.builtin);
        if (pos <= 0) {
          toast.info("A column can't go before No.");
          return;
        }
        next.push({ key, name: "", after: STANDARD_COLUMNS[pos - 1] });
      }
      onColumnsChange({ extra_columns: next });
      const c = sheetColumnOrder({
        extra_columns: next,
        hidden_columns: hidden,
      }).findIndex((s) => s.kind === "extra" && s.col.key === key);
      if (fullCols) {
        setAnchor({ r: 0, c });
        setSel({ r: rowCount - 1, c });
      } else select({ r: sel.r, c });
      requestAnimationFrame(focusGrid);
      return;
    }
    if (fullRows && !fullCols) {
      toast.info(
        "To delete columns, select them by clicking the column letters.",
      );
      return;
    }
    const picked = cols.slice(range.c1, range.c2 + 1);
    const remove = new Set(
      picked.filter((c) => c.kind === "extra").map((c) => c.key!),
    );
    const hide = picked.map((c) => c.builtin).filter(isHideable);
    if (!remove.size && !hide.length) {
      toast.info(
        picked.some((c) => c.builtin)
          ? "The No., Items and Total Amount columns can't be deleted."
          : "These columns are empty.",
      );
      return;
    }
    const patch: ColumnLayoutPatch = {};
    if (remove.size)
      patch.extra_columns = extras.filter((x) => !remove.has(x.key));
    if (hide.length) patch.hidden_columns = [...new Set([...hidden, ...hide])];
    onColumnsChange(patch);
    if (hide.length)
      toast.success(
        `Column${hide.length > 1 ? "s" : ""} deleted from this quotation. The totals still use the values; right-click a column letter → Show all columns to bring them back.`,
      );
    if (fullCols) {
      setAnchor({ r: 0, c: range.c1 });
      setSel({ r: rowCount - 1, c: range.c1 });
    } else select({ r: sel.r, c: range.c1 });
    requestAnimationFrame(focusGrid);
  };

  // ---- Whole rows / columns (header clicks) -------------------------------------------
  const selectRows = (r: number, extend: boolean) => {
    setAnchor({ r: extend ? anchor.r : r, c: 0 });
    setSel({ r, c: lastCol });
  };
  const selectCols = (c: number, extend: boolean) => {
    setAnchor({ r: 0, c: extend ? anchor.c : c });
    setSel({ r: rowCount - 1, c });
  };
  const selectAll = () => {
    setAnchor({ r: 0, c: 0 });
    setSel({ r: rowCount - 1, c: lastCol });
  };

  // ---- Cell formatting (Home ribbon) ----------------------------------------------------------
  const fmtAt = (r: number, c: number) =>
    r < lines.length ? lines[r].fmt?.[cols[c].id] : undefined;
  const fmtBlock = (rg: Range) =>
    Array.from({ length: rg.r2 - rg.r1 + 1 }, (_, i) =>
      Array.from({ length: rg.c2 - rg.c1 + 1 }, (_, j) =>
        fmtAt(rg.r1 + i, rg.c1 + j),
      ),
    );

  /** Applies `fn` to the line of each selected row; empty rows below the lines become lines first. */
  const formatRows = (fn: (line: QuoteLine, r: number) => QuoteLine) => {
    if (readOnly) return;
    const last = fullCols
      ? Math.min(range.r2, lines.length - 1)
      : Math.min(range.r2, totalRowIndex - 1);
    const next = lines.slice();
    for (let r = range.r1; r <= last; r++) {
      while (next.length <= r) next.push(blankLine(activeSheet));
      next[r] = fn(next[r], r);
    }
    if (next.length !== lines.length || next.some((l, i) => l !== lines[i]))
      onChange(next);
  };
  /** Sets a format patch (or a replacement) on every selected cell. */
  const formatCells = (
    fn: (
      current: CellFmt,
      r: number,
      c: number,
    ) => Partial<CellFmt> | undefined,
    replace = false,
  ) =>
    formatRows((line, r) => {
      let l = line;
      for (let c = range.c1; c <= range.c2; c++)
        l = withFmt(
          l,
          cols[c].id,
          fn(l.fmt?.[cols[c].id] ?? {}, r, c),
          replace,
        );
      return l;
    });

  const fontStep = (dir: 1 | -1) =>
    formatCells((f) => {
      const size = f.size ?? DEFAULT_SIZE;
      const next =
        dir > 0
          ? (FONT_SIZES.find((x) => x > size) ?? size)
          : ([...FONT_SIZES].reverse().find((x) => x < size) ?? size);
      return { size: next === DEFAULT_SIZE ? undefined : next };
    });
  const indentBy = (dir: 1 | -1) =>
    formatCells((f) => ({
      indent: Math.max(0, Math.min(15, (f.indent ?? 0) + dir)) || undefined,
    }));

  const applyBorder = (preset: BorderPreset) =>
    formatCells((_f, r, c) => {
      const top = r === range.r1;
      const bottom =
        r === Math.min(range.r2, totalRowIndex - 1) ||
        (fullCols && r === lines.length - 1);
      const left = c === range.c1;
      const right = c === range.c2;
      switch (preset) {
        case "none":
          return { bt: undefined, bb: undefined, bl: undefined, br: undefined };
        case "all":
          return { bt: 1, bb: 1, bl: 1, br: 1 };
        case "outside":
        case "thick": {
          const w = preset === "thick" ? 2 : 1;
          return {
            ...(top ? { bt: w } : {}),
            ...(bottom ? { bb: w } : {}),
            ...(left ? { bl: w } : {}),
            ...(right ? { br: w } : {}),
          } as Partial<CellFmt>;
        }
        case "top":
          return top ? { bt: 1 } : {};
        case "bottom":
          return bottom ? { bb: 1 } : {};
        case "left":
          return left ? { bl: 1 } : {};
        case "right":
          return right ? { br: 1 } : {};
      }
    });

  /** Start/end column of the merged cell covering (r, c), or the cell itself. */
  const spanAt = (r: number, c: number) => {
    const fmt = r < lines.length ? lines[r].fmt : undefined;
    if (fmt) {
      for (let k = c; k >= 0; k--) {
        const to = fmt[cols[k].id]?.merge;
        if (!to) continue;
        const end = cols.findIndex((x) => x.id === to);
        if (end >= c) return { start: k, end };
      }
    }
    return { start: c, end: c };
  };
  /** Moving onto a merged cell lands on its first cell (or jumps past it when moving right). */
  const skipMerged = (p: Pos, dc: number): Pos => {
    const sp = spanAt(p.r, p.c);
    if (sp.start === p.c) return p;
    if (dc > 0 && sp.end + 1 <= lastCol) return { r: p.r, c: sp.end + 1 };
    return { r: p.r, c: sp.start };
  };

  const applyMerge = (mode: MergeMode) => {
    if (mode !== "unmerge" && range.c2 <= range.c1) {
      toast.info("Select two or more cells next to each other to merge them.");
      return;
    }
    formatRows((line) => {
      let l = line;
      // Unmerge whatever overlaps the selection in this row first.
      cols.forEach((col, c) => {
        const to = l.fmt?.[col.id]?.merge;
        if (!to) return;
        const end = cols.findIndex((x) => x.id === to);
        if (c <= range.c2 && end >= range.c1)
          l = withFmt(l, col.id, { merge: undefined });
      });
      if (mode !== "unmerge")
        l = withFmt(l, cols[range.c1].id, {
          merge: cols[range.c2].id,
          ...(mode === "center" ? { h: "center" as const } : {}),
        });
      return l;
    });
    if (mode !== "unmerge") {
      setAnchor({ r: range.r1, c: range.c1 });
      setSel({ r: range.r2, c: range.c1 });
    }
  };

  const togglePainter = () => {
    if (painter) setPainter(null);
    else {
      setPainter(fmtBlock(range));
      toast.info(
        "Format Painter: now select the cells to paste the format on (Esc to cancel).",
        { duration: 2500 },
      );
    }
  };
  /** Pastes the Format Painter's formats on the selection, repeating them like Excel. */
  const applyPainter = () => {
    if (!painter) return;
    const h = painter.length;
    const w = painter[0]?.length ?? 1;
    formatCells(
      (_f, r, c) => painter[(r - range.r1) % h]?.[(c - range.c1) % w],
      true,
    );
    setPainter(null);
  };

  // ---- Keyboard / clipboard ------------------------------------------------------------
  const onGridKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editing || titleEdit) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "z" && !readOnly) {
        e.preventDefault();
        if (e.shiftKey) onRedo();
        else onUndo();
      } else if (k === "y" && !readOnly) {
        e.preventDefault();
        onRedo();
      } else if ((k === "b" || k === "i" || k === "u") && !readOnly) {
        e.preventDefault();
        const f = fmtAt(cursor.r, cursor.c) ?? {};
        formatCells(() =>
          k === "b"
            ? { b: !f.b }
            : k === "i"
              ? { i: !f.i }
              : { u: f.u ? undefined : 1 },
        );
      } else if (k === "a") {
        e.preventDefault();
        setAnchor({ r: 0, c: 0 });
        setSel(clampPos(Math.max(lines.length - 1, 0), lastRealCol));
      } else if (k === " ") {
        e.preventDefault();
        selectCols(cursor.c, false);
      } else if (k === "-" && !readOnly) {
        // Ctrl+- deletes the selected columns or rows (like Excel).
        e.preventDefault();
        if (fullCols && !fullRows) colOp("delete");
        else rowOp("delete");
      } else if ((k === "+" || k === "=") && !readOnly) {
        e.preventDefault();
        if (fullCols && !fullRows) colOp("left");
        else rowOp("above");
      } else if (e.key === "Home") {
        e.preventDefault();
        select(clampPos(0, 0), e.shiftKey);
      } else if (e.key === "End") {
        e.preventDefault();
        select(
          clampPos(Math.max(lines.length - 1, 0), lastRealCol),
          e.shiftKey,
        );
      }
      return;
    }
    const moves: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    if (moves[e.key]) {
      e.preventDefault();
      const from = e.shiftKey ? sel : cursor;
      const moved = clampPos(
        from.r + moves[e.key][0],
        from.c + moves[e.key][1],
      );
      const target = { ...moved, r: visibleRow(moved.r, moves[e.key][0], from.r) };
      select(
        e.shiftKey ? target : skipMerged(target, moves[e.key][1]),
        e.shiftKey,
      );
    } else if (e.key === " " && e.shiftKey) {
      e.preventDefault();
      selectRows(cursor.r, false);
    } else if (e.key === "Tab") {
      e.preventDefault();
      select(
        skipMerged(
          clampPos(cursor.r, cursor.c + (e.shiftKey ? -1 : 1)),
          e.shiftKey ? -1 : 1,
        ),
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      const down = clampPos(cursor.r + (e.shiftKey ? -1 : 1), cursor.c);
      select(skipMerged({ ...down, r: visibleRow(down.r, e.shiftKey ? -1 : 1, cursor.r) }, 0));
    } else if (e.key === "F2") {
      e.preventDefault();
      startEdit(cursor.r, cursor.c);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      clearRange(range);
    } else if (e.key === "Escape") {
      setMenu(null);
      setPainter(null);
      select(sel);
    } else if (e.key === "Home") {
      e.preventDefault();
      select(clampPos(sel.r, 0), e.shiftKey);
    } else if (e.key === "End") {
      e.preventDefault();
      select(clampPos(sel.r, lastRealCol), e.shiftKey);
    } else if (e.key === "PageDown" || e.key === "PageUp") {
      e.preventDefault();
      select(
        clampPos(sel.r + (e.key === "PageDown" ? 10 : -10), sel.c),
        e.shiftKey,
      );
    } else if (e.key.length === 1 && !e.altKey) {
      if (isEditable(cursor.r, cursor.c)) {
        e.preventDefault();
        startEdit(cursor.r, cursor.c, e.key);
      }
    }
  };

  /** Text of the block for the clipboard; its formats are kept for a paste in this sheet. */
  const copyBlock = (rg: Range) => {
    const text = rangeText(rg);
    clip.current = { text, fmts: fmtBlock(rg) };
    return text;
  };
  const onCopy = (e: ClipboardEvent<HTMLDivElement>) => {
    if (editing || titleEdit) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", copyBlock(range));
  };
  const onCut = (e: ClipboardEvent<HTMLDivElement>) => {
    if (editing || titleEdit) return;
    onCopy(e);
    clearRange(range);
  };
  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    if (editing || titleEdit || readOnly) return;
    e.preventDefault();
    pasteText(e.clipboardData.getData("text/plain"));
  };

  // Right-click menu actions use the async clipboard (works on localhost and https).
  const menuCopy = async (cut = false) => {
    setMenu(null);
    try {
      await navigator.clipboard.writeText(copyBlock(range));
      if (cut) clearRange(range);
    } catch {
      toast.info(`Use Ctrl+${cut ? "X" : "C"} to ${cut ? "cut" : "copy"}.`);
    }
    focusGrid();
  };
  const menuPaste = async () => {
    setMenu(null);
    try {
      pasteText(await navigator.clipboard.readText());
    } catch {
      toast.info("Use Ctrl+V to paste.");
    }
    focusGrid();
  };
  const openMenu = (kind: Menu["kind"], e: ReactMouseEvent) => {
    e.preventDefault();
    setMenu({
      kind,
      x: Math.min(e.clientX, window.innerWidth - 250),
      y: Math.max(8, Math.min(e.clientY, window.innerHeight - 440)),
    });
  };

  // Fill preview: the direction the pointer went furthest beyond the selection (like Excel).
  const fillRange = ((): FillArea | null => {
    if (!fillTo) return null;
    const down = fillTo.r - range.r2;
    const up = range.r1 - fillTo.r;
    const right = fillTo.c - range.c2;
    const left = range.c1 - fillTo.c;
    const vertical = Math.max(down, up);
    const sideways = Math.max(right, left);
    if (vertical <= 0 && sideways <= 0) return null;
    const area: FillArea =
      vertical >= sideways
        ? down > 0
          ? { r1: range.r2 + 1, r2: Math.min(fillTo.r, totalRowIndex - 1), c1: range.c1, c2: range.c2, dir: "down" }
          : { r1: Math.max(0, fillTo.r), r2: range.r1 - 1, c1: range.c1, c2: range.c2, dir: "up" }
        : right > 0
          ? { r1: range.r1, r2: range.r2, c1: range.c2 + 1, c2: Math.min(fillTo.c, lastCol), dir: "right" }
          : { r1: range.r1, r2: range.r2, c1: Math.max(0, fillTo.c), c2: range.c1 - 1, dir: "left" };
    return area.r1 <= area.r2 && area.c1 <= area.c2 ? area : null;
  })();

  // ---- Mouse: drag-select, fill handle, column resize -------------------------------------
  const latest = useRef<{
    applyFill: () => void;
    selectEnd: () => void;
    totalRowIndex: number;
  }>({
    applyFill: () => {},
    selectEnd: () => {},
    totalRowIndex: 0,
  });
  useEffect(() => {
    const up = () => {
      if (
        drag.current === "select" ||
        drag.current === "rows" ||
        drag.current === "cols"
      )
        latest.current.selectEnd();
      if (drag.current === "fill") {
        latest.current.applyFill();
        setFillTo(null);
      }
      drag.current = null;
    };
    // A drag whose mouse-up never arrived (released outside the window, a menu took it...) is
    // dropped without doing anything, so a stale fill can never overwrite cells.
    const abandon = () => {
      if (!drag.current) return;
      drag.current = null;
      setFillTo(null);
    };
    window.addEventListener("mouseup", up);
    window.addEventListener("mousedown", abandon, true); // runs before the cell starts a new drag
    window.addEventListener("blur", abandon);
    return () => {
      window.removeEventListener("mouseup", up);
      window.removeEventListener("mousedown", abandon, true);
      window.removeEventListener("blur", abandon);
    };
  }, []);
  /** Mouse moved over the sheet with no button held: any drag in progress is stale. */
  const dropStaleDrag = (buttons: number) => {
    if (!drag.current || buttons & 1) return false;
    drag.current = null;
    setFillTo(null);
    return true;
  };

  useEffect(() => {
    if (!menu && !tabMenu) return;
    const close = () => {
      setMenu(null);
      setTabMenu(null);
    };
    const onKey = (e: globalThis.KeyboardEvent) =>
      e.key === "Escape" && close();
    window.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu, tabMenu]);

  const finishEditing = (r?: number, c?: number, refocus = true) => {
    if (editing && !(editing.r === r && editing.c === c)) commit(undefined, refocus);
    if (titleEdit) commitTitle(refocus);
  };

  // Rows are memoised; they call the latest handlers through this ref (set after each render).
  const handlers = useRef<Handlers>(NOOP_HANDLERS);
  const onCellDown: Handlers["down"] = (r, c, e) => {
    finishEditing(r, c);
    if (e.button === 2) {
      const inside =
        r >= range.r1 && r <= range.r2 && c >= range.c1 && c <= range.c2;
      if (!inside) select(clampPos(r, c));
      return;
    }
    if (e.button !== 0) return; // only the left button selects / drags
    if (editing && editing.r === r && editing.c === c) return;
    e.preventDefault();
    select(clampPos(r, c), e.shiftKey);
    drag.current = "select";
    focusGrid();
  };
  const onCellEnter: Handlers["enter"] = (r, c, buttons) => {
    if (dropStaleDrag(buttons)) return;
    if (drag.current === "select") setSel(clampPos(r, c));
    else if (drag.current === "rows") setSel({ r, c: lastCol });
    else if (drag.current === "cols") setSel({ r: rowCount - 1, c });
    else if (drag.current === "fill")
      setFillTo({ r: Math.min(r, latest.current.totalRowIndex - 1), c });
  };
  const onCellContext: Handlers["context"] = (_r, _c, e) => openMenu("cell", e);
  const onRowDown: Handlers["rowDown"] = (r, e) => {
    finishEditing();
    e.preventDefault();
    if (e.button === 2) {
      if (!(fullRows && r >= range.r1 && r <= range.r2)) selectRows(r, false);
      return;
    }
    if (e.button !== 0) return;
    selectRows(r, e.shiftKey);
    drag.current = "rows";
    focusGrid();
  };
  const onRowEnter: Handlers["rowEnter"] = (r, buttons) => {
    if (dropStaleDrag(buttons)) return;
    if (drag.current === "rows" || drag.current === "select")
      setSel({ r, c: lastCol });
  };
  const onFillStart: Handlers["fillStart"] = (e) => {
    if (e.button !== 0) return; // a right-click on the fill handle is a normal right-click
    e.preventDefault();
    e.stopPropagation();
    drag.current = "fill";
    setFillTo({ r: range.r2, c: range.c2 });
  };
  useLayoutEffect(() => {
    latest.current = {
      applyFill: () => applyFill(fillRange),
      selectEnd: applyPainter,
      totalRowIndex,
    };
    handlers.current = {
      down: onCellDown,
      enter: onCellEnter,
      dbl: (r, c) => startEdit(r, c),
      context: onCellContext,
      rowDown: onRowDown,
      rowEnter: onRowEnter,
      rowContext: (_r, e) => openMenu("row", e),
      fillStart: onFillStart,
      editChange: (value) => setEditing((ed) => (ed ? { ...ed, value } : ed)),
      cellBlur: (to) => {
        if (to instanceof HTMLElement && to === barRef.current) setEditing((ed) => (ed ? { ...ed, source: "bar" } : ed));
        else commit();
      },
      suggestKey,
      commit,
      cancel,
    };
  });

  const onColDown = (i: number, e: ReactMouseEvent) => {
    finishEditing();
    e.preventDefault();
    if (e.button === 2) {
      if (!(fullCols && i >= range.c1 && i <= range.c2)) selectCols(i, false);
      return;
    }
    if (e.button !== 0) return;
    selectCols(i, e.shiftKey);
    drag.current = "cols";
    focusGrid();
  };

  const startResize = (id: string, e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    // Start from the width on screen (Items stretches to fill the sheet).
    const startW = Math.round(
      (e.currentTarget as HTMLElement).parentElement?.getBoundingClientRect()
        .width ?? cols.find((c) => c.id === id)!.width,
    );
    let last = startW;
    const move = (ev: globalThis.MouseEvent) => {
      last = Math.max(40, Math.round(startW + ev.clientX - startX));
      setResizing({ id, width: last });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      saveWidths({ ...savedWidths, [id]: last });
      setResizing(null);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  const resetWidth = (id: string) => {
    const next = { ...savedWidths };
    delete next[id];
    saveWidths(next);
  };

  // ---- Status: Average / Count / Sum of the selected block (like Excel) ---------------------
  const stats = (() => {
    if (!multi) return null;
    let count = 0;
    let sum = 0;
    let nums = 0;
    for (let r = range.r1; r <= range.r2; r++) {
      if (r >= lines.length) continue;
      for (let c = range.c1; c <= range.c2; c++) {
        const raw = rawValue(lines[r], cols[c]);
        if (raw === "") continue;
        count++;
        const n = cols[c].kind === "text" ? null : parseNumber(raw);
        if (n != null) {
          sum += n;
          nums++;
        }
      }
    }
    return { count, sum, avg: nums ? sum / nums : null, nums };
  })();

  const onLine = range.r1 < lines.length;
  const flaggedInSel = lines.slice(range.r1, Math.min(range.r2, lines.length - 1) + 1).some((l) => l.check);
  const activeFmt = fmtAt(cursor.r, cursor.c) ?? {};
  const keepFocus = (e: ReactMouseEvent) => e.preventDefault();
  const tool =
    "grid size-6 place-items-center rounded-sm border border-transparent text-[#444] transition-colors hover:border-[#c6c6c6] hover:bg-[#e1e1e1] disabled:pointer-events-none disabled:opacity-35";
  const tableWidth = cols.reduce((s, c) => s + c.width, 0);
  const nameBox =
    fullCols && !fullRows
      ? `${sheetColLetter(range.c1)}:${sheetColLetter(range.c2)}`
      : fullRows && !fullCols
        ? `${sheetRow(range.r1)}:${sheetRow(range.r2)}`
        : multi
          ? `${cellName({ r: range.r1, c: range.c1 })}:${cellName({ r: range.r2, c: range.c2 })}`
          : cellName(sel);

  const pickedCols = cols.slice(range.c1, range.c2 + 1);
  const canDeleteCols =
    !readOnly &&
    !(fullRows && !fullCols) &&
    pickedCols.some((c) => c.kind === "extra" || isHideable(c.builtin));
  const canInsertCol = !readOnly && extras.length < MAX_EXTRA_COLUMNS;
  const singleExtra =
    range.c1 === range.c2 && cols[range.c1]?.kind === "extra" ? range.c1 : null;
  const plural = (n: number, word: string) => `${word}${n > 1 ? "s" : ""}`;
  const rowCountSel = Math.min(range.r2, lines.length - 1) - range.r1 + 1;
  const colCountSel = range.c2 - range.c1 + 1;

  const menuItem =
    "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] hover:bg-[#e6f2ea] disabled:pointer-events-none disabled:opacity-40";
  // Like Excel: headers of selected cells turn grey with green text; whole rows/columns turn solid green.
  const headerSel = "bg-[#d2d2d2] font-semibold text-[#217346]";
  const headerFull = "bg-[#217346] font-semibold text-white";

  return (
    <div className="overflow-hidden rounded-xl border border-[#c8c8c8] bg-white shadow-card">
      {/* Ribbon (Excel's Home tab). Pressing anything on it first saves the cell being typed in,
          so the action works on the up-to-date sheet and never drops or misplaces that entry. */}
      <div
        onMouseDownCapture={(e) =>
          // A font box takes the keyboard itself; after a button the keyboard comes back to the sheet.
          finishEditing(undefined, undefined, !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement))
        }
      >
        <SheetRibbon
          readOnly={readOnly}
          fmt={activeFmt}
          painterOn={painter != null}
          onPaste={menuPaste}
          onCut={() => menuCopy(true)}
          onCopy={() => menuCopy(false)}
          onPainter={togglePainter}
          onFormat={(patch) => formatCells(() => patch)}
          onFontStep={fontStep}
          onIndent={indentBy}
          onBorder={applyBorder}
          onMerge={applyMerge}
          onDone={() => requestAnimationFrame(focusGrid)}
          before={
            <RibbonGroup label="Undo">
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  className={tool}
                  onMouseDown={keepFocus}
                  onClick={onUndo}
                  disabled={readOnly || !canUndo}
                  title="Undo (Ctrl+Z)"
                  aria-label="Undo"
                >
                  <Undo2 className="size-4" />
                </button>
                <button
                  type="button"
                  className={tool}
                  onMouseDown={keepFocus}
                  onClick={onRedo}
                  disabled={readOnly || !canRedo}
                  title="Redo (Ctrl+Y)"
                  aria-label="Redo"
                >
                  <Redo2 className="size-4" />
                </button>
              </div>
            </RibbonGroup>
          }
          after={
            <RibbonGroup label="Cells">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    className={tool}
                    onMouseDown={keepFocus}
                    onClick={() => rowOp("above")}
                    disabled={readOnly}
                    title="Insert row above"
                    aria-label="Insert row above"
                  >
                    <ArrowUpToLine className="size-4" />
                  </button>
                  <button
                    type="button"
                    className={tool}
                    onMouseDown={keepFocus}
                    onClick={() => rowOp("below")}
                    disabled={readOnly}
                    title="Insert row below"
                    aria-label="Insert row below"
                  >
                    <ArrowDownToLine className="size-4" />
                  </button>
                  <button
                    type="button"
                    className={tool}
                    onMouseDown={keepFocus}
                    onClick={() => colOp("left")}
                    disabled={!canInsertCol}
                    title="Insert column left"
                    aria-label="Insert column left"
                  >
                    <ArrowLeftToLine className="size-4" />
                  </button>
                  <button
                    type="button"
                    className={tool}
                    onMouseDown={keepFocus}
                    onClick={() => colOp("right")}
                    disabled={!canInsertCol}
                    title="Insert column right"
                    aria-label="Insert column right"
                  >
                    <ArrowRightToLine className="size-4" />
                  </button>
                  <button
                    type="button"
                    className={tool}
                    onMouseDown={keepFocus}
                    onClick={() => rowOp("duplicate")}
                    disabled={readOnly || !onLine}
                    title="Duplicate row(s)"
                    aria-label="Duplicate row"
                  >
                    <CopyPlus className="size-4" />
                  </button>
                  <button
                    type="button"
                    className={tool}
                    onMouseDown={keepFocus}
                    onClick={() => rowOp("reprice")}
                    disabled={readOnly || !onLine}
                    title="Reset to automatic price"
                    aria-label="Reset to automatic price"
                  >
                    <RotateCcw className="size-4" />
                  </button>
                </div>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    className={tool}
                    onMouseDown={keepFocus}
                    onClick={() => rowOp("up")}
                    disabled={readOnly || !onLine || range.r1 === 0}
                    title="Move row up"
                    aria-label="Move row up"
                  >
                    <ChevronUp className="size-4" />
                  </button>
                  <button
                    type="button"
                    className={tool}
                    onMouseDown={keepFocus}
                    onClick={() => rowOp("down")}
                    disabled={
                      readOnly || !onLine || range.r2 >= lines.length - 1
                    }
                    title="Move row down"
                    aria-label="Move row down"
                  >
                    <ChevronDown className="size-4" />
                  </button>
                  <button
                    type="button"
                    className={cn(tool, "hover:bg-red-100 hover:text-red-700")}
                    onMouseDown={keepFocus}
                    onClick={() => colOp("delete")}
                    disabled={!canDeleteCols}
                    title="Delete column(s)"
                    aria-label="Delete column"
                  >
                    <TableColumnsSplit className="size-4" />
                  </button>
                  <button
                    type="button"
                    className={cn(tool, "hover:bg-red-100 hover:text-red-700")}
                    onMouseDown={keepFocus}
                    onClick={() => rowOp("delete")}
                    disabled={readOnly || !onLine || (fullCols && !fullRows)}
                    title="Delete row(s)"
                    aria-label="Delete row"
                  >
                    <Trash2 className="size-4" />
                  </button>
                  {hidden.length ? (
                    <button
                      type="button"
                      className={tool}
                      onMouseDown={keepFocus}
                      onClick={() => colOp("showAll")}
                      disabled={readOnly}
                      title={`Show all columns (${hidden.length} deleted)`}
                      aria-label="Show all columns"
                    >
                      <Eye className="size-4" />
                    </button>
                  ) : null}
                </div>
              </div>
            </RibbonGroup>
          }
        />
      </div>

      {/* Formula bar */}
      <div
        className="flex items-stretch border-b border-[#d4d4d4] bg-white text-sm"
        style={FONT}
      >
        <div className="flex w-24 shrink-0 items-center justify-center border-r border-[#d4d4d4] text-[13px] text-slate-700">
          {nameBox}
        </div>
        <div className="flex shrink-0 items-center border-r border-[#d4d4d4] px-2.5 font-serif text-sm text-slate-400 italic">
          fx
        </div>
        <input
          ref={barRef}
          aria-label="Formula bar"
          className="min-w-0 flex-1 px-2.5 py-1.5 text-[14px] outline-none read-only:text-slate-500 selection:bg-[#c6c6c6] selection:text-[#1f1f1f]"
          style={FONT}
          value={formulaBarText}
          readOnly={!isEditable(cursor.r, cursor.c)}
          onFocus={() => {
            if (!editing && isEditable(cursor.r, cursor.c))
              startEdit(cursor.r, cursor.c, undefined, "bar");
          }}
          onChange={(e) =>
            editing && setEditing({ ...editing, value: e.target.value })
          }
          onKeyDown={(e) => {
            if (!editing) return;
            if (e.key === "Enter") {
              e.preventDefault();
              commit({ dr: 1, dc: 0 });
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          onBlur={() => editing?.source === "bar" && commit()}
        />
      </div>

      {/* Grid */}
      <div
        ref={gridRef}
        tabIndex={0}
        role="grid"
        aria-label="Quotation lines"
        aria-rowcount={rowCount + 1}
        aria-colcount={cols.length}
        aria-multiselectable
        onKeyDown={onGridKeyDown}
        onCopy={onCopy}
        onCut={onCut}
        onPaste={onPaste}
        className={cn(
          "scroll-thin relative max-h-[62vh] overflow-auto bg-white outline-none select-none focus-visible:ring-0",
          painter && "cursor-copy [&_td]:cursor-copy",
        )}
      >
        <table
          className="border-separate border-spacing-0"
          style={{
            ...FONT,
            width: "100%",
            minWidth: tableWidth + ROW_HEADER_W,
            tableLayout: "fixed",
          }}
        >
          <colgroup>
            <col style={{ width: ROW_HEADER_W }} />
            {cols.map((c) => (
              // Items has no fixed width, so it takes the spare room and the sheet fills the whole width.
              <col
                key={c.id}
                style={{ width: c.id === "description" ? undefined : c.width }}
              />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-20">
            <tr>
              <th
                onMouseDown={(e) => {
                  e.preventDefault();
                  finishEditing();
                  selectAll();
                  focusGrid();
                }}
                title="Select all"
                className="sticky left-0 z-30 h-[22px] cursor-pointer border-r border-b border-[#c8c8c8] bg-[#e6e6e6]"
              >
                <span className="absolute right-0.5 bottom-0.5 size-0 border-b-[9px] border-l-[9px] border-b-[#b4b4b4] border-l-transparent" />
              </th>
              {cols.map((c, i) => {
                // A whole-row selection lights up only the row numbers, not every column letter.
                const active =
                  i >= range.c1 && i <= range.c2 && !(fullRows && !fullCols);
                return (
                  <th
                    key={c.id}
                    onMouseDown={(e) => onColDown(i, e)}
                    onMouseEnter={(e) =>
                      !dropStaleDrag(e.buttons) &&
                      drag.current === "cols" &&
                      setSel({ r: rowCount - 1, c: i })
                    }
                    onContextMenu={(e) => openMenu("col", e)}
                    className={cn(
                      "relative h-[22px] cursor-[s-resize] border-r border-b border-[#c8c8c8] text-center text-[12px]",
                      !active
                        ? "bg-[#f3f3f3] font-normal text-[#444]"
                        : fullCols
                          ? headerFull
                          : headerSel,
                      active && "shadow-[inset_0_-2px_0] shadow-[#217346]",
                    )}
                  >
                    {sheetColLetter(i)}
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      title="Drag to resize · double-click to reset"
                      onMouseDown={(e) => startResize(c.id, e)}
                      onDoubleClick={() => resetWidth(c.id)}
                      className="absolute top-0 -right-[3px] z-10 h-full w-[6px] cursor-col-resize hover:bg-[#217346]/40"
                    />
                  </th>
                );
              })}
            </tr>
            <tr>
              <th className="sticky left-0 z-30 h-[26px] border-r border-b border-[#c8c8c8] bg-[#f3f3f3] font-normal text-[#444] text-center text-[12px]">
                1
              </th>
              {cols.map((c, i) => {
                const titled = true; // every column title can be typed over
                return (
                  <th
                    key={c.id}
                    // A click (not mousedown) so the browser's own focus handling can't blur the new input.
                    onClick={() =>
                      titleEdit?.c !== i && (finishEditing(), startTitleEdit(i))
                    }
                    className={cn(
                      "relative h-[26px] truncate border-r border-b px-1.5 text-[14px] font-bold",
                      "border-[#bfbfbf] bg-[#f2f2f2] text-[#1f1f1f]",
                      titled && !readOnly && "cursor-text hover:bg-[#e6f2ea]",
                      c.align === "right"
                        ? "text-right"
                        : c.align === "center"
                          ? "text-center"
                          : "text-left",
                      titleEdit?.c === i && "p-0",
                      filters[c.id] && "pr-6",
                    )}
                    title={
                      titled && !readOnly
                        ? `${c.label || "Empty column"} · click to type a title`
                        : c.label
                    }
                  >
                    {titleEdit?.c === i ? (
                      <input
                        autoFocus
                        aria-label="Column title"
                        value={titleEdit.value}
                        maxLength={40}
                        placeholder={c.builtin ? defaultTitle(c.builtin) : c.label}
                        onChange={(e) =>
                          setTitleEdit({ c: i, value: e.target.value })
                        }
                        onBlur={() => commitTitle()}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter") commitTitle();
                          else if (e.key === "Escape") {
                            setTitleEdit(null);
                            requestAnimationFrame(focusGrid);
                          }
                        }}
                        style={FONT}
                        className="absolute inset-0 h-full w-full bg-white px-1.5 text-[14px] font-bold outline-2 -outline-offset-2 outline-[#217346] select-text selection:bg-[#c6c6c6] selection:text-[#1f1f1f]"
                      />
                    ) : (
                      <span
                        className={cn(
                          c.placeholder && "font-normal text-[#9a9a9a] italic",
                        )}
                      >
                        {c.label}
                      </span>
                    )}
                    {/* A filtered column shows the filter mark (sort & filter is in the right-click menu). */}
                    {filters[c.id] && titleEdit?.c !== i ? (
                      <ListFilter className="absolute top-1/2 right-1.5 size-3.5 -translate-y-1/2 text-[#217346]" aria-label="Filtered" />
                    ) : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rowCount }, (_, r) => {
              const line = lineAt(r);
              const isTotal = r === totalRowIndex;
              const inRows = r >= range.r1 && r <= range.r2;
              const inFill =
                fillRange && r >= fillRange.r1 && r <= fillRange.r2;
              return (
                <SheetRow
                  key={line?.key ?? `ghost-${r}`}
                  r={r}
                  line={line}
                  isTotal={isTotal}
                  totals={isTotal ? totals : null}
                  cols={cols}
                  rowSel={
                    inRows
                      ? {
                          c1: range.c1,
                          c2: range.c2,
                          top: r === range.r1,
                          bottom: r === range.r2,
                        }
                      : null
                  }
                  rowHeader={
                    !inRows || (fullCols && !fullRows)
                      ? "none"
                      : fullRows
                        ? "full"
                        : "sel"
                  }
                  activeCol={cursor.r === r ? cursor.c : -1}
                  multi={multi}
                  fill={
                    inFill
                      ? {
                          c1: fillRange!.c1,
                          c2: fillRange!.c2,
                          top: r === fillRange!.r1,
                          bottom: r === fillRange!.r2,
                        }
                      : null
                  }
                  showHandle={
                    !readOnly &&
                    !editing &&
                    r === range.r2 &&
                    r !== totalRowIndex
                  }
                  handleCol={range.c2}
                  editing={editing && editing.r === r ? editing : null}
                  flash={Boolean(line && line.key === highlightKey)}
                  rowLabel={sheetRow(r)}
                  hidden={hiddenRows.has(r)}
                  filtered={filtering}
                  header={header}
                  h={handlers}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Sheet tabs + status (Excel style) */}
      <div
        className="flex items-stretch border-t border-[#c8c8c8] bg-[#f3f3f3] text-[12px] text-[#444]"
        style={FONT}
      >
        <div className="scroll-thin flex min-w-0 items-stretch overflow-x-auto">
          {sheetNames.map((name, i) =>
            renaming?.i === i ? (
              <input
                key={i}
                autoFocus
                aria-label="Sheet name"
                value={renaming.value}
                maxLength={31}
                onChange={(e) => setRenaming({ i, value: e.target.value })}
                onBlur={() => {
                  onRenameSheet(i, renaming.value);
                  setRenaming(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    onRenameSheet(i, renaming.value);
                    setRenaming(null);
                  } else if (e.key === "Escape") setRenaming(null);
                }}
                className="w-32 border-x border-[#c8c8c8] bg-white px-2 text-[13px] font-semibold text-[#185c37] outline-none"
              />
            ) : (
              <button
                key={i}
                type="button"
                onClick={() => onSelectSheet(i)}
                onDoubleClick={() =>
                  !readOnly && setRenaming({ i, value: name })
                }
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (readOnly) return;
                  onSelectSheet(i);
                  setTabMenu({
                    i,
                    x: e.clientX,
                    y: Math.min(e.clientY, window.innerHeight - 110) - 70,
                  });
                }}
                title={
                  readOnly
                    ? name
                    : "Double-click to rename · right-click for more"
                }
                className={cn(
                  "-mt-px border-r border-[#c8c8c8] px-4 py-1.5 whitespace-nowrap transition-colors",
                  i === activeSheet
                    ? "border-b-2 border-b-[#217346] bg-white font-semibold text-[#185c37]"
                    : "hover:bg-[#e6e6e6]",
                )}
              >
                {name}
              </button>
            ),
          )}
          {!readOnly ? (
            <button
              type="button"
              onClick={onAddSheet}
              disabled={sheetNames.length >= MAX_SHEETS}
              title="New sheet"
              aria-label="New sheet"
              className="mx-1.5 my-1 grid size-6 shrink-0 place-items-center self-center rounded-full text-[#444] hover:bg-[#dcdcdc] disabled:opacity-40"
            >
              <Plus className="size-4" />
            </button>
          ) : null}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-4 px-3">
          {stats && stats.count > 0 ? (
            <>
              {stats.avg != null ? (
                <span>Average: {fmtNumber(stats.avg, 0, 2)}</span>
              ) : null}
              <span>Count: {stats.count}</span>
              {stats.nums > 0 ? (
                <span className="font-semibold">
                  Sum: {fmtNumber(stats.sum, 0, 3)}
                </span>
              ) : null}
            </>
          ) : null}
          {readOnly ? (
            <span className="rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
              Read only
            </span>
          ) : null}
        </div>
      </div>

      {filterMenu && cols[filterMenu.c] ? (
        <SheetFilterMenu
          key={filterMenu.c}
          title={cols[filterMenu.c].label || sheetColLetter(filterMenu.c)}
          values={filterValues(cols[filterMenu.c])}
          shown={filters[cols[filterMenu.c].id] ?? null}
          numeric={isNumericCol(cols[filterMenu.c])}
          style={{ ...filterMenu.style, ...FONT, fontSize: 13 }}
          onSort={(dir) => sortBy(filterMenu.c, dir)}
          onApply={(shown) => {
            const next = { ...filters };
            if (shown) next[cols[filterMenu.c].id] = shown;
            else delete next[cols[filterMenu.c].id];
            applyFilters(next);
            setFilterMenu(null);
          }}
          onClose={() => setFilterMenu(null)}
        />
      ) : null}

      {suggestOpen && suggestPos ? (
        <ItemSuggestList
          items={suggest.items}
          loading={suggest.loading}
          failed={suggest.failed}
          active={suggestState.active}
          style={{ ...suggestPos, ...FONT }}
          onHover={(i) => setSuggestState({ ...suggestState, active: i })}
          onPick={pickSuggestion}
        />
      ) : null}

      {/* Right-click menu: cells, row numbers or column letters */}
      {menu ? (
        <div
          role="menu"
          className="fixed z-50 w-60 animate-scale-in rounded-md border border-[#c8c8c8] bg-white py-1 shadow-pop"
          style={{ left: menu.x, top: menu.y, ...FONT }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className={menuItem}
            disabled={readOnly}
            onClick={() => menuCopy(true)}
          >
            <Scissors className="size-4 text-slate-500" /> Cut{" "}
            <span className="ml-auto text-[11px] text-slate-400">Ctrl+X</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={menuItem}
            onClick={() => menuCopy(false)}
          >
            <Copy className="size-4 text-slate-500" /> Copy{" "}
            <span className="ml-auto text-[11px] text-slate-400">Ctrl+C</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={menuItem}
            disabled={readOnly}
            onClick={menuPaste}
          >
            <ClipboardPaste className="size-4 text-slate-500" /> Paste{" "}
            <span className="ml-auto text-[11px] text-slate-400">Ctrl+V</span>
          </button>
          {!readOnly && cols[cursor.c] && cols[cursor.c].kind !== "index" ? (
            <button
              type="button"
              role="menuitem"
              className={menuItem}
              onClick={() => {
                openFilter(cursor.c, menu.x, menu.y);
                setMenu(null);
              }}
            >
              <ListFilter className="size-4 text-slate-500" /> Sort &amp; filter…
              {filters[cols[cursor.c].id] ? <span className="ml-auto text-[11px] text-[#217346]">on</span> : null}
            </button>
          ) : null}
          {!readOnly ? (
            <button
              type="button"
              role="menuitem"
              className={menuItem}
              disabled={!lines.some((l) => !isBlankLine(l))}
              onClick={() => (setMenu(null), sortStandard())}
            >
              <ListOrdered className="size-4 text-slate-500" /> Sort in standard order
            </button>
          ) : null}
          {menu.kind !== "col" ? (
            <>
              <div className="my-1 border-t border-[#e1e1e1]" />
              <button
                type="button"
                role="menuitem"
                className={menuItem}
                disabled={readOnly}
                onClick={() => (setMenu(null), rowOp("above"))}
              >
                <ArrowUpToLine className="size-4 text-slate-500" /> Insert row
                above
              </button>
              <button
                type="button"
                role="menuitem"
                className={menuItem}
                disabled={readOnly}
                onClick={() => (setMenu(null), rowOp("below"))}
              >
                <ArrowDownToLine className="size-4 text-slate-500" /> Insert row
                below
              </button>
              <button
                type="button"
                role="menuitem"
                className={menuItem}
                disabled={readOnly || !onLine}
                onClick={() => (setMenu(null), rowOp("duplicate"))}
              >
                <CopyPlus className="size-4 text-slate-500" /> Duplicate{" "}
                {plural(rowCountSel, "row")}
              </button>
              <button
                type="button"
                role="menuitem"
                className={menuItem}
                disabled={readOnly || !onLine || (fullCols && !fullRows)}
                onClick={() => (setMenu(null), rowOp("delete"))}
              >
                <Trash2 className="size-4 text-red-500" /> Delete{" "}
                {plural(rowCountSel, "row")}{" "}
                <span className="ml-auto text-[11px] text-slate-400">
                  Ctrl+-
                </span>
              </button>
            </>
          ) : null}
          {menu.kind !== "row" ? (
            <>
              <div className="my-1 border-t border-[#e1e1e1]" />
              <button
                type="button"
                role="menuitem"
                className={menuItem}
                disabled={!canInsertCol}
                onClick={() => (setMenu(null), colOp("left"))}
              >
                <ArrowLeftToLine className="size-4 text-slate-500" /> Insert
                column left
              </button>
              <button
                type="button"
                role="menuitem"
                className={menuItem}
                disabled={!canInsertCol}
                onClick={() => (setMenu(null), colOp("right"))}
              >
                <ArrowRightToLine className="size-4 text-slate-500" /> Insert
                column right
              </button>
              <button
                type="button"
                role="menuitem"
                className={menuItem}
                disabled={!canDeleteCols}
                onClick={() => (setMenu(null), colOp("delete"))}
              >
                <TableColumnsSplit className="size-4 text-red-500" /> Delete{" "}
                {plural(colCountSel, "column")}
              </button>
              {singleExtra != null ? (
                <button
                  type="button"
                  role="menuitem"
                  className={menuItem}
                  disabled={readOnly}
                  onClick={() => (setMenu(null), startTitleEdit(singleExtra))}
                >
                  <Pencil className="size-4 text-slate-500" /> Rename column
                </button>
              ) : null}
              {hidden.length ? (
                <button
                  type="button"
                  role="menuitem"
                  className={menuItem}
                  disabled={readOnly}
                  onClick={() => (setMenu(null), colOp("showAll"))}
                >
                  <Eye className="size-4 text-slate-500" /> Show all columns{" "}
                  <span className="ml-auto text-[11px] text-slate-400">
                    {hidden.length} deleted
                  </span>
                </button>
              ) : null}
            </>
          ) : null}
          <div className="my-1 border-t border-[#e1e1e1]" />
          <button
            type="button"
            role="menuitem"
            className={menuItem}
            disabled={readOnly || !onLine}
            onClick={() => (setMenu(null), clearRange(range))}
          >
            <Eraser className="size-4 text-slate-500" /> Clear contents{" "}
            <span className="ml-auto text-[11px] text-slate-400">Del</span>
          </button>
          {flaggedInSel ? (
            <button type="button" role="menuitem" className={menuItem} disabled={readOnly} onClick={() => (setMenu(null), rowOp("checked"))}>
              <CheckCheck className="size-4 text-excel-700" /> Mark as checked
            </button>
          ) : null}
          {menu.kind === "cell" ? (
            <button
              type="button"
              role="menuitem"
              className={menuItem}
              disabled={readOnly || !onLine}
              onClick={() => (setMenu(null), rowOp("reprice"))}
            >
              <RotateCcw className="size-4 text-slate-500" /> Reset to automatic
              price
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Right-click menu on sheet tabs */}
      {tabMenu ? (
        <div
          role="menu"
          className="fixed z-50 w-44 animate-scale-in rounded-md border border-[#c8c8c8] bg-white py-1 shadow-pop"
          style={{ left: tabMenu.x, top: tabMenu.y, ...FONT }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            className={menuItem}
            onClick={() => (
              setRenaming({ i: tabMenu.i, value: sheetNames[tabMenu.i] }),
              setTabMenu(null)
            )}
          >
            <Pencil className="size-4 text-slate-500" /> Rename
          </button>
          <button
            type="button"
            role="menuitem"
            className={menuItem}
            disabled={sheetNames.length <= 1}
            onClick={() => (onDeleteSheet(tabMenu.i), setTabMenu(null))}
          >
            <Trash2 className="size-4 text-red-500" /> Delete sheet
          </button>
        </div>
      ) : null}
    </div>
  );
}

type Handlers = {
  down: (r: number, c: number, e: ReactMouseEvent) => void;
  enter: (r: number, c: number, buttons: number) => void;
  dbl: (r: number, c: number) => void;
  context: (r: number, c: number, e: ReactMouseEvent) => void;
  rowDown: (r: number, e: ReactMouseEvent) => void;
  rowEnter: (r: number, buttons: number) => void;
  rowContext: (r: number, e: ReactMouseEvent) => void;
  fillStart: (e: ReactMouseEvent) => void;
  editChange: (v: string) => void;
  /** The cell being typed in lost the keyboard (to `to`): moving into the fx bar keeps editing there. */
  cellBlur: (to: EventTarget | null) => void;
  suggestKey: (e: KeyboardEvent<HTMLInputElement>) => boolean;
  commit: (m?: { dr: number; dc: number }) => void;
  cancel: () => void;
};

const noop = () => {};
const NOOP_HANDLERS: Handlers = {
  down: noop,
  enter: noop,
  dbl: noop,
  context: noop,
  rowDown: noop,
  rowEnter: noop,
  rowContext: noop,
  fillStart: noop,
  editChange: noop,
  cellBlur: noop,
  suggestKey: () => false,
  commit: noop,
  cancel: noop,
};

type RowProps = {
  r: number;
  line: QuoteLine | null;
  isTotal: boolean;
  totals: QuoteTotals | null;
  cols: Col[];
  rowSel: { c1: number; c2: number; top: boolean; bottom: boolean } | null;
  /** Row number highlight: "full" = whole row selected; none for a whole-column selection. */
  rowHeader: "none" | "sel" | "full";
  activeCol: number;
  multi: boolean;
  fill: { c1: number; c2: number; top: boolean; bottom: boolean } | null;
  showHandle: boolean;
  handleCol: number;
  editing: Editing | null;
  flash: boolean;
  rowLabel: number;
  /** Hidden by a filter. */
  hidden: boolean;
  /** A filter is on: row numbers turn blue, like Excel. */
  filtered: boolean;
  header: QuoteHeader;
  h: { current: Handlers };
};

/** Inline style of a formatted cell (Excel-like font, colours, alignment, wrap and indent). */
function cellStyle(f: CellFmt | undefined, selected: boolean): CSSProperties {
  if (!f) return {};
  const pad = f.indent ? 6 + f.indent * 9 : undefined;
  return {
    fontFamily: f.font ? `"${f.font}", ${FONT.fontFamily}` : undefined,
    fontSize: f.size ? ptToPx(f.size) : undefined,
    fontWeight: f.b ? 700 : undefined,
    fontStyle: f.i ? "italic" : undefined,
    textDecorationLine: f.u ? "underline" : undefined,
    textDecorationStyle: f.u === 2 ? "double" : undefined,
    color: f.color,
    backgroundColor: selected ? undefined : f.fill,
    textAlign: f.h,
    verticalAlign: f.v,
    whiteSpace: f.wrap ? "normal" : undefined,
    overflowWrap: f.wrap ? "anywhere" : undefined,
    paddingLeft: f.h !== "right" ? pad : undefined,
    paddingRight: f.h === "right" ? pad : undefined,
  };
}

/** Cell borders, drawn as inset shadows (thin 1px, thick 2px). */
function borderShadows(f: CellFmt | undefined): string[] {
  if (!f) return [];
  const w = (e: 1 | 2) => (e === 2 ? 2 : 1);
  const out: string[] = [];
  if (f.bt) out.push(`inset 0 ${w(f.bt)}px 0 #000`);
  if (f.bb) out.push(`inset 0 -${w(f.bb)}px 0 #000`);
  if (f.bl) out.push(`inset ${w(f.bl)}px 0 0 #000`);
  if (f.br) out.push(`inset -${w(f.br)}px 0 0 #000`);
  return out;
}

/** Text orientation: angled, vertical (stacked) or rotated up/down. */
function rotStyle(rot: NonNullable<CellFmt["rot"]>): CSSProperties {
  if (rot === "v")
    return {
      display: "inline-block",
      writingMode: "vertical-rl",
      textOrientation: "upright",
      whiteSpace: "nowrap",
    };
  if (rot === 90)
    return {
      display: "inline-block",
      writingMode: "vertical-rl",
      transform: "rotate(180deg)",
      whiteSpace: "nowrap",
    };
  if (rot === -90)
    return {
      display: "inline-block",
      writingMode: "vertical-rl",
      whiteSpace: "nowrap",
    };
  return { display: "inline-block", transform: `rotate(${-rot}deg)` };
}

const SheetRow = memo(function SheetRow({
  r,
  line,
  isTotal,
  totals,
  cols,
  rowSel,
  rowHeader,
  activeCol,
  multi,
  fill,
  showHandle,
  handleCol,
  editing,
  flash,
  rowLabel,
  hidden,
  filtered,
  header,
  h,
}: RowProps) {
  // Merged cells: the first cell spans to its `merge` column; the cells it covers aren't drawn.
  const spans = new Map<number, number>();
  const covered = new Set<number>();
  if (line?.fmt) {
    cols.forEach((col, c) => {
      const to = line.fmt[col.id]?.merge;
      if (!to || covered.has(c)) return;
      const end = cols.findIndex((x) => x.id === to);
      if (end <= c) return;
      spans.set(c, end - c + 1);
      for (let k = c + 1; k <= end; k++) covered.add(k);
    });
  }
  return (
    <tr hidden={hidden} className={cn(flash && "animate-fade-in [&>td]:bg-[#e2efda]")} title={line?.check ? `Check this line: ${line.check}` : undefined}>
      <th
        scope="row"
        onMouseDown={(e) => h.current.rowDown(r, e)}
        onMouseEnter={(e) => h.current.rowEnter(r, e.buttons)}
        onContextMenu={(e) => h.current.rowContext(r, e)}
        className={cn(
          "sticky left-0 z-10 h-[22px] cursor-[e-resize] border-r border-b border-[#c8c8c8] text-center text-[12px]",
          rowHeader === "none"
            ? line?.check
              ? "bg-[#ffd9d9] font-semibold text-[#c00000]"
              : filtered && line
                ? "bg-[#f3f3f3] font-normal text-[#0563c1]"
                : "bg-[#f3f3f3] font-normal text-[#444]"
            : rowHeader === "full"
              ? "bg-[#217346] font-semibold text-white"
              : "bg-[#d2d2d2] font-semibold text-[#217346]",
          rowHeader !== "none" && "shadow-[inset_-2px_0_0] shadow-[#217346]",
        )}
      >
        {rowLabel}
      </th>
      {cols.map((col, c) => {
        if (covered.has(c)) return null;
        const cEnd = c + (spans.get(c) ?? 1) - 1;
        const within = (x: number) => x >= c && x <= cEnd;
        const inSel = rowSel != null && rowSel.c1 <= cEnd && rowSel.c2 >= c;
        const active = within(activeCol);
        // Typing in the cell itself; typing in the fx bar only mirrors the text here (the bar keeps the keyboard).
        const isEditing = editing != null && editing.source === "cell" && within(editing.c);
        const mirrored = editing != null && editing.source === "bar" && within(editing.c);
        const f = isTotal ? undefined : line?.fmt?.[col.id];
        let content = "";
        if (isTotal && totals) {
          const total = totalFor(col.id, totals);
          if (col.id === "description") content = "TOTAL";
          else if (total != null)
            content =
              col.id === "qty"
                ? fmtQty(total)
                : col.id === "total_weight"
                  ? fmtWeight(total)
                  : fmtMoney(total);
        } else if (line) {
          content =
            col.kind === "index" ? String(r + 1) : displayValue(line, col);
        }
        if (mirrored) content = editing.value;
        const typedTotal =
          !isTotal && line != null && col.kind === "computed" && line.overrides?.[col.id as keyof LineOverrides] != null;
        const overridden =
          (line && col.id === "unit_price" && line.price_overridden) || typedTotal;
        const autoPrice = overridden && !typedTotal && line ? autoUnitPrice(line, header) : null;

        // Excel's green border around the selected block (on top), then the cell's own borders.
        const edges: string[] = [];
        if (inSel && rowSel) {
          if (rowSel.top) edges.push(`inset 0 2px 0 ${ACCENT}`);
          if (rowSel.bottom) edges.push(`inset 0 -2px 0 ${ACCENT}`);
          if (within(rowSel.c1)) edges.push(`inset 2px 0 0 ${ACCENT}`);
          if (within(rowSel.c2)) edges.push(`inset -2px 0 0 ${ACCENT}`);
        }
        edges.push(...borderShadows(f));
        const inFill = fill != null && fill.c1 <= cEnd && fill.c2 >= c;
        const selFill = inSel && multi && !active;
        // A line Import marked for checking: light red with a red edge.
        const flagged = Boolean(line?.check) && !isTotal;
        if (flagged && c === 0) edges.push("inset 3px 0 0 #e03131");
        return (
          <td
            key={col.id}
            colSpan={cEnd > c ? cEnd - c + 1 : undefined}
            data-cell={`${r}:${c}`}
            role="gridcell"
            aria-selected={inSel || undefined}
            onMouseDown={(e) => h.current.down(r, c, e)}
            onMouseEnter={(e) => h.current.enter(r, c, e.buttons)}
            onDoubleClick={() => h.current.dbl(r, c)}
            onContextMenu={(e) => h.current.context(r, c, e)}
            title={
              typedTotal && line
                ? `Typed value (calculated: ${col.id === "total_weight" ? fmtWeight(calcWeight(line)) : fmtMoney(calcAmount(line))}). Clear the cell to calculate it again.`
                : overridden
                  ? `Manual price${autoPrice != null ? ` (automatic: ${fmtMoney(autoPrice)})` : ""}`
                  : undefined
            }
            style={{
              ...cellStyle(f, selFill),
              ...(flagged && !selFill && !f?.fill ? { backgroundColor: "#ffe8e8" } : {}),
              boxShadow: edges.length ? edges.join(", ") : undefined,
            }}
            className={cn(
              "relative h-[22px] truncate border-r border-b border-[#e1e1e1] px-1.5 whitespace-nowrap text-[#1f1f1f]",
              col.align === "right"
                ? "text-right tabular-nums"
                : col.align === "center"
                  ? "text-center"
                  : "text-left",
              col.kind === "index" && "text-[#7f7f7f]",
              isTotal && "border-t border-t-[#7f7f7f] font-bold",
              selFill && "border-r-[#ababab] border-b-[#ababab] bg-[#c6c6c6]",
              inFill &&
                "outline-1 -outline-offset-2 outline-[#7f7f7f] outline-dashed",
              isEditing && "p-0",
            )}
          >
            {isEditing ? (
              <input
                autoFocus
                data-cell-editor
                autoComplete="off"
                value={editing.value}
                onChange={(e) => h.current.editChange(e.target.value)}
                onMouseDown={(e) => e.stopPropagation()}
                onFocus={(e) => {
                  const len = e.currentTarget.value.length;
                  e.currentTarget.setSelectionRange(len, len);
                }}
                onBlur={(e) => editing.source === "cell" && h.current.cellBlur(e.relatedTarget)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  // An Items cell: the inventory list under it takes ↓ ↑ Enter Tab Esc first.
                  if (h.current.suggestKey(e)) {
                    e.preventDefault();
                    return;
                  }
                  if (e.key === "Enter") {
                    e.preventDefault();
                    h.current.commit({ dr: e.shiftKey ? -1 : 1, dc: 0 });
                  } else if (e.key === "Tab") {
                    e.preventDefault();
                    h.current.commit({ dr: 0, dc: e.shiftKey ? -1 : 1 });
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    h.current.cancel();
                  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    h.current.commit({
                      dr: e.key === "ArrowDown" ? 1 : -1,
                      dc: 0,
                    });
                  }
                }}
                style={{
                  ...FONT,
                  ...cellStyle(f, true),
                  whiteSpace: undefined,
                  overflowWrap: undefined,
                  verticalAlign: undefined,
                  paddingLeft: undefined,
                  paddingRight: undefined,
                }}
                className={cn(
                  "absolute inset-0 h-full w-full bg-white px-1.5 text-[14px] outline-2 -outline-offset-2 outline-[#217346] select-text selection:bg-[#c6c6c6] selection:text-[#1f1f1f]",
                  col.align === "right"
                    ? "text-right"
                    : col.align === "center"
                      ? "text-center"
                      : "text-left",
                )}
              />
            ) : (
              <>
                {f?.rot != null && content ? (
                  <span style={rotStyle(f.rot)}>{content}</span>
                ) : (
                  content
                )}
                {overridden ? (
                  <span
                    className="absolute top-0 right-0 size-0 border-t-[7px] border-l-[7px] border-t-[#c00000] border-l-transparent"
                    aria-hidden
                  />
                ) : null}
                {showHandle && within(handleCol) ? (
                  <span
                    title="Drag to fill (down, up, left or right)"
                    onMouseDown={(e) => h.current.fillStart(e)}
                    className="absolute -right-[4px] -bottom-[4px] z-10 size-[8px] cursor-crosshair border border-white bg-[#217346]"
                  />
                ) : null}
              </>
            )}
          </td>
        );
      })}
    </tr>
  );
});
