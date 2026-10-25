"use client";

import {
  AArrowDown,
  AArrowUp,
  Baseline,
  Bold,
  ChevronDown,
  ClipboardPaste,
  Copy,
  Grid2x2,
  Italic,
  ListIndentDecrease,
  ListIndentIncrease,
  PaintBucket,
  Paintbrush,
  PanelBottom,
  PanelLeft,
  PanelRight,
  PanelTop,
  Scissors,
  Square,
  SquareDashed,
  TableCellsMerge,
  TableCellsSplit,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  TextWrap,
  Underline,
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import {
  DEFAULT_FONT,
  DEFAULT_SIZE,
  FONT_SIZES,
  FONTS,
  STANDARD_COLORS,
  THEME_COLORS,
  type BorderPreset,
  type MergeMode,
} from "@/lib/quotation/cell-format";
import type { CellFmt } from "@/lib/quotation/types";

type Props = {
  readOnly: boolean;
  /** Format of the active cell (drives the pressed buttons and the font boxes). */
  fmt: CellFmt;
  painterOn: boolean;
  onPaste: () => void;
  onCut: () => void;
  onCopy: () => void;
  onPainter: () => void;
  onFormat: (patch: Partial<CellFmt>) => void;
  onFontStep: (dir: 1 | -1) => void;
  onIndent: (dir: 1 | -1) => void;
  onBorder: (preset: BorderPreset) => void;
  onMerge: (mode: MergeMode) => void;
  /** Called after a font box is used, to give the keyboard back to the sheet. */
  onDone: () => void;
  /** Leading group (undo/redo) and trailing groups (rows/columns). */
  before?: ReactNode;
  after?: ReactNode;
};

type DropId = "underline" | "border" | "fill" | "color" | "orient" | "merge";

const ROT_OPTIONS: { rot: NonNullable<CellFmt["rot"]>; label: string }[] = [
  { rot: 45, label: "Angle Counterclockwise" },
  { rot: -45, label: "Angle Clockwise" },
  { rot: "v", label: "Vertical Text" },
  { rot: 90, label: "Rotate Text Up" },
  { rot: -90, label: "Rotate Text Down" },
];

const BORDER_OPTIONS: { preset: BorderPreset; label: string; icon: ReactNode }[] = [
  { preset: "bottom", label: "Bottom Border", icon: <PanelBottom className="size-4" /> },
  { preset: "top", label: "Top Border", icon: <PanelTop className="size-4" /> },
  { preset: "left", label: "Left Border", icon: <PanelLeft className="size-4" /> },
  { preset: "right", label: "Right Border", icon: <PanelRight className="size-4" /> },
  { preset: "none", label: "No Border", icon: <SquareDashed className="size-4" /> },
  { preset: "all", label: "All Borders", icon: <Grid2x2 className="size-4" /> },
  { preset: "outside", label: "Outside Borders", icon: <Square className="size-4" /> },
  { preset: "thick", label: "Thick Outside Borders", icon: <Square className="size-4" strokeWidth={3.2} /> },
];

const MERGE_OPTIONS: { mode: MergeMode; label: string }[] = [
  { mode: "center", label: "Merge & Center" },
  { mode: "across", label: "Merge Across" },
  { mode: "cells", label: "Merge Cells" },
  { mode: "unmerge", label: "Unmerge Cells" },
];

/** Excel's Home ribbon: Clipboard, Font and Alignment groups. */
export function SheetRibbon(p: Props) {
  const { fmt, readOnly } = p;
  const [open, setOpen] = useState<DropId | null>(null);
  const [lastBorder, setLastBorder] = useState<BorderPreset>("bottom");
  // Colours picked in this session; the main Fill / Font Color button re-applies them.
  const [lastFill, setLastFill] = useState<string | null>(null);
  const [lastColor, setLastColor] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [sizeText, setSizeText] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!(e.target instanceof Node) || !ref.current?.querySelector("[data-drop]")?.contains(e.target)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    // The menus float over the page, so they close when the page scrolls.
    const onScroll = () => setOpen(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  /** A picked fill / font colour also goes to Recent Colors (newest first, like Excel). */
  const pickColor = (kind: "fill" | "color", c: string) => {
    setOpen(null);
    setRecent((r) => [c, ...r.filter((x) => x !== c)].slice(0, 10));
    if (kind === "fill") setLastFill(c);
    else setLastColor(c);
    p.onFormat(kind === "fill" ? { fill: c } : { color: c });
  };

  const run = (fn: () => void) => () => {
    setOpen(null);
    fn();
  };
  const toggle = (id: DropId) => setOpen((o) => (o === id ? null : id));
  const font = fmt.font ?? DEFAULT_FONT;
  const size = fmt.size ?? DEFAULT_SIZE;

  const applySize = () => {
    if (sizeText == null) return;
    const n = Number(sizeText);
    setSizeText(null);
    if (Number.isFinite(n) && n >= 6 && n <= 72) p.onFormat({ size: Math.round(n) === DEFAULT_SIZE ? undefined : Math.round(n) });
    p.onDone();
  };

  return (
    <div ref={ref} className="scroll-thin flex items-stretch overflow-x-auto border-b border-[#d4d4d4] bg-[#f3f3f3] px-1 pt-1 text-[12px] text-[#262626] select-none">
      {p.before}

      {/* Clipboard */}
      <RibbonGroup label="Clipboard">
        <div className="flex h-full items-start gap-1">
          <button type="button" onMouseDown={keep} onClick={p.onPaste} disabled={readOnly} title="Paste (Ctrl+V)" className={cn(btn, "h-[58px] w-12 flex-col gap-0.5 px-1")}>
            <ClipboardPaste className="size-7 text-[#5f6368]" strokeWidth={1.4} />
            <span>Paste</span>
          </button>
          <div className="flex flex-col gap-px">
            <SmallBtn onClick={p.onCut} disabled={readOnly} title="Cut (Ctrl+X)" icon={<Scissors className="size-3.5" />} label="Cut" />
            <SmallBtn onClick={p.onCopy} title="Copy (Ctrl+C)" icon={<Copy className="size-3.5" />} label="Copy" />
            <SmallBtn
              onClick={p.onPainter}
              disabled={readOnly}
              pressed={p.painterOn}
              title="Format Painter: copy the format of the selected cells, then select the cells to paste it on"
              icon={<Paintbrush className="size-3.5 text-[#b8860b]" />}
              label="Format Painter"
            />
          </div>
        </div>
      </RibbonGroup>

      {/* Font */}
      <RibbonGroup label="Font">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <select
              aria-label="Font"
              value={FONTS.includes(font as (typeof FONTS)[number]) ? font : DEFAULT_FONT}
              disabled={readOnly}
              onChange={(e) => {
                p.onFormat({ font: e.target.value === DEFAULT_FONT ? undefined : e.target.value });
                p.onDone();
              }}
              className="h-6 w-36 rounded-sm border border-[#c8c8c8] bg-white px-1 text-[12px] outline-none focus:border-[#217346] disabled:opacity-50"
              style={{ fontFamily: `"${font}"` }}
            >
              {FONTS.map((f) => (
                <option key={f} value={f} style={{ fontFamily: `"${f}"` }}>
                  {f}
                </option>
              ))}
            </select>
            <input
              aria-label="Font size"
              list="qp-font-sizes"
              inputMode="numeric"
              disabled={readOnly}
              value={sizeText ?? String(size)}
              onChange={(e) => setSizeText(e.target.value.replace(/[^\d]/g, "").slice(0, 2))}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={applySize}
              onKeyDown={(e) => {
                if (e.key === "Enter") applySize();
                else if (e.key === "Escape") {
                  setSizeText(null);
                  p.onDone();
                }
              }}
              className="h-6 w-12 rounded-sm border border-[#c8c8c8] bg-white px-1.5 text-[12px] outline-none focus:border-[#217346] disabled:opacity-50"
            />
            <datalist id="qp-font-sizes">
              {FONT_SIZES.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <IconBtn onClick={() => p.onFontStep(1)} disabled={readOnly} title="Increase Font Size">
              <AArrowUp className="size-4" />
            </IconBtn>
            <IconBtn onClick={() => p.onFontStep(-1)} disabled={readOnly} title="Decrease Font Size">
              <AArrowDown className="size-4" />
            </IconBtn>
          </div>
          <div className="flex items-center gap-0.5">
            <IconBtn onClick={() => p.onFormat({ b: !fmt.b })} disabled={readOnly} pressed={fmt.b} title="Bold (Ctrl+B)">
              <Bold className="size-4" strokeWidth={2.6} />
            </IconBtn>
            <IconBtn onClick={() => p.onFormat({ i: !fmt.i })} disabled={readOnly} pressed={fmt.i} title="Italic (Ctrl+I)">
              <Italic className="size-4" />
            </IconBtn>
            <Split
              open={open === "underline"}
              onMain={() => p.onFormat({ u: fmt.u ? undefined : 1 })}
              onArrow={() => toggle("underline")}
              disabled={readOnly}
              pressed={Boolean(fmt.u)}
              title="Underline (Ctrl+U)"
              icon={<Underline className="size-4" />}
            >
              <MenuItem onClick={run(() => p.onFormat({ u: fmt.u === 1 ? undefined : 1 }))} checked={fmt.u === 1}>
                <Underline className="size-4" /> Underline
              </MenuItem>
              <MenuItem onClick={run(() => p.onFormat({ u: fmt.u === 2 ? undefined : 2 }))} checked={fmt.u === 2}>
                <span className="w-4 text-center font-semibold underline decoration-double">U</span> Double Underline
              </MenuItem>
            </Split>
            <Sep />
            <Split
              open={open === "border"}
              onMain={() => p.onBorder(lastBorder)}
              onArrow={() => toggle("border")}
              disabled={readOnly}
              title={BORDER_OPTIONS.find((b) => b.preset === lastBorder)?.label ?? "Borders"}
              icon={BORDER_OPTIONS.find((b) => b.preset === lastBorder)?.icon}
              wide
            >
              <p className="px-3 pt-1 pb-1.5 text-[11px] font-semibold text-[#616161]">Borders</p>
              {BORDER_OPTIONS.map((b) => (
                <MenuItem
                  key={b.preset}
                  onClick={run(() => {
                    setLastBorder(b.preset);
                    p.onBorder(b.preset);
                  })}
                >
                  {b.icon} {b.label}
                </MenuItem>
              ))}
            </Split>
            <Sep />
            <Split
              open={open === "fill"}
              onMain={() => lastFill && p.onFormat({ fill: lastFill })}
              onArrow={() => toggle("fill")}
              disabled={readOnly}
              arrowOnly={!lastFill}
              label="Fill Color"
              title={lastFill ? `Fill Color (click to apply ${lastFill})` : "Fill Color"}
              icon={<ColorIcon color={fmt.fill ?? null} icon={<PaintBucket className="size-4" />} />}
              wide
            >
              <Palette none="No Fill" onNone={run(() => p.onFormat({ fill: undefined }))} onPick={(c) => pickColor("fill", c)} recent={recent} current={fmt.fill} />
            </Split>
            <Split
              open={open === "color"}
              onMain={() => lastColor && p.onFormat({ color: lastColor })}
              onArrow={() => toggle("color")}
              disabled={readOnly}
              arrowOnly={!lastColor}
              label="Font Color"
              title={lastColor ? `Font Color (click to apply ${lastColor})` : "Font Color"}
              icon={<ColorIcon color={fmt.color ?? "#000000"} icon={<Baseline className="size-4" />} />}
              wide
            >
              <Palette none="Automatic" onNone={run(() => p.onFormat({ color: undefined }))} onPick={(c) => pickColor("color", c)} recent={recent} current={fmt.color} />
            </Split>
          </div>
        </div>
      </RibbonGroup>

      {/* Alignment */}
      <RibbonGroup label="Alignment">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-0.5">
            <IconBtn onClick={() => p.onFormat({ v: fmt.v === "top" ? undefined : "top" })} disabled={readOnly} pressed={fmt.v === "top"} title="Top Align">
              <VAlignIcon at="top" />
            </IconBtn>
            <IconBtn onClick={() => p.onFormat({ v: fmt.v === "middle" ? undefined : "middle" })} disabled={readOnly} pressed={fmt.v === "middle"} title="Middle Align">
              <VAlignIcon at="middle" />
            </IconBtn>
            <IconBtn onClick={() => p.onFormat({ v: fmt.v === "bottom" ? undefined : "bottom" })} disabled={readOnly} pressed={fmt.v === "bottom"} title="Bottom Align">
              <VAlignIcon at="bottom" />
            </IconBtn>
            <Sep />
            <Split open={open === "orient"} onArrow={() => toggle("orient")} disabled={readOnly} pressed={fmt.rot != null} title="Orientation" icon={<OrientIcon />} wide arrowOnly>
              {ROT_OPTIONS.map((o) => (
                <MenuItem key={String(o.rot)} onClick={run(() => p.onFormat({ rot: fmt.rot === o.rot ? undefined : o.rot }))} checked={fmt.rot === o.rot}>
                  <OrientIcon rot={o.rot} /> {o.label}
                </MenuItem>
              ))}
            </Split>
            <Sep />
            <button type="button" onMouseDown={keep} onClick={() => p.onFormat({ wrap: !fmt.wrap })} disabled={readOnly} title="Wrap Text" className={cn(btn, "h-6 gap-1 px-1.5", fmt.wrap && pressedCls)}>
              <TextWrap className="size-4" /> Wrap Text
            </button>
          </div>
          <div className="flex items-center gap-0.5">
            <IconBtn onClick={() => p.onFormat({ h: fmt.h === "left" ? undefined : "left" })} disabled={readOnly} pressed={fmt.h === "left"} title="Align Left">
              <TextAlignStart className="size-4" />
            </IconBtn>
            <IconBtn onClick={() => p.onFormat({ h: fmt.h === "center" ? undefined : "center" })} disabled={readOnly} pressed={fmt.h === "center"} title="Center">
              <TextAlignCenter className="size-4" />
            </IconBtn>
            <IconBtn onClick={() => p.onFormat({ h: fmt.h === "right" ? undefined : "right" })} disabled={readOnly} pressed={fmt.h === "right"} title="Align Right">
              <TextAlignEnd className="size-4" />
            </IconBtn>
            <Sep />
            <IconBtn onClick={() => p.onIndent(-1)} disabled={readOnly || !fmt.indent} title="Decrease Indent">
              <ListIndentDecrease className="size-4" />
            </IconBtn>
            <IconBtn onClick={() => p.onIndent(1)} disabled={readOnly} title="Increase Indent">
              <ListIndentIncrease className="size-4" />
            </IconBtn>
            <Sep />
            <Split
              open={open === "merge"}
              onMain={() => p.onMerge(fmt.merge ? "unmerge" : "center")}
              onArrow={() => toggle("merge")}
              disabled={readOnly}
              pressed={Boolean(fmt.merge)}
              title="Merge & Center"
              icon={
                <span className="flex items-center gap-1">
                  <TableCellsMerge className="size-4" /> Merge &amp; Center
                </span>
              }
              wide
            >
              {MERGE_OPTIONS.map((m) => (
                <MenuItem key={m.mode} onClick={run(() => p.onMerge(m.mode))}>
                  {m.mode === "unmerge" ? <TableCellsSplit className="size-4" /> : <TableCellsMerge className="size-4" />} {m.label}
                </MenuItem>
              ))}
            </Split>
          </div>
        </div>
      </RibbonGroup>

      {p.after}
    </div>
  );
}

/** A button with a drop-down arrow (Underline, Borders, Fill Color...). */
function Split(props: {
  open: boolean;
  onMain?: () => void;
  onArrow: () => void;
  disabled?: boolean;
  pressed?: boolean;
  title: string;
  /** Fixed accessible name (the tooltip may change, e.g. "click to apply #FF0000"). */
  label?: string;
  icon: ReactNode;
  wide?: boolean;
  arrowOnly?: boolean;
  children: ReactNode;
}) {
  const name = props.label ?? props.title;
  const wrap = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const width = props.wide ? 248 : 200;
  const toggleMenu = () => {
    const r = wrap.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) });
    props.onArrow();
  };
  return (
    <div ref={wrap} className="relative flex items-center" data-drop={props.open ? "" : undefined}>
      <button
        type="button"
        onMouseDown={keep}
        onClick={props.arrowOnly ? toggleMenu : props.onMain}
        disabled={props.disabled}
        title={props.title}
        aria-label={name}
        className={cn(btn, "h-6 rounded-r-none px-1", props.pressed && pressedCls)}
      >
        {props.icon}
      </button>
      <button
        type="button"
        onMouseDown={keep}
        onClick={toggleMenu}
        disabled={props.disabled}
        aria-label={`${name} options`}
        aria-expanded={props.open}
        className={cn(btn, "h-6 w-3.5 rounded-l-none px-0", props.open && pressedCls)}
      >
        <ChevronDown className="size-3" />
      </button>
      {props.open && pos ? (
        <div
          role="menu"
          onMouseDown={keep}
          style={{ top: pos.top, left: pos.left, width }}
          className="fixed z-[60] animate-scale-in rounded-md border border-[#c8c8c8] bg-white py-1 shadow-pop"
        >
          {props.children}
        </div>
      ) : null}
    </div>
  );
}

/** Keeps the keyboard focus (and the selection) in the sheet when a ribbon button is pressed. */
const keep = (e: { preventDefault: () => void }) => e.preventDefault();

const btn =
  "inline-flex items-center justify-center rounded-sm border border-transparent text-[12px] text-[#262626] transition-colors hover:border-[#c6c6c6] hover:bg-[#e1e1e1] disabled:pointer-events-none disabled:opacity-40";
const pressedCls = "border-[#a6a6a6] bg-[#d2d2d2] hover:bg-[#c8c8c8]";

export function RibbonGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col border-r border-[#d4d4d4] px-2 last:border-r-0">
      <div className="flex min-h-[58px] items-start">{children}</div>
      <p className="pt-0.5 pb-1 text-center text-[11px] text-[#616161]">{label}</p>
    </div>
  );
}

function IconBtn({ onClick, disabled, pressed, title, children }: { onClick: () => void; disabled?: boolean; pressed?: boolean; title: string; children: ReactNode }) {
  return (
    <button type="button" onMouseDown={keep} onClick={onClick} disabled={disabled} title={title} aria-label={title} aria-pressed={pressed} className={cn(btn, "size-6", pressed && pressedCls)}>
      {children}
    </button>
  );
}

function SmallBtn({ onClick, disabled, pressed, title, icon, label }: { onClick: () => void; disabled?: boolean; pressed?: boolean; title: string; icon: ReactNode; label: string }) {
  return (
    <button type="button" onMouseDown={keep} onClick={onClick} disabled={disabled} title={title} aria-pressed={pressed} className={cn(btn, "h-[19px] justify-start gap-1.5 px-1.5", pressed && pressedCls)}>
      {icon}
      {label}
    </button>
  );
}

function Sep() {
  return <span className="mx-0.5 h-4 w-px bg-[#d0d0d0]" />;
}

function MenuItem({ onClick, checked, children }: { onClick: () => void; checked?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      role="menuitem"
      onMouseDown={keep}
      onClick={onClick}
      className={cn("flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12.5px] hover:bg-[#e6f2ea]", checked && "bg-[#e6f2ea] font-medium")}
    >
      {children}
    </button>
  );
}

/** Icon with a colour bar showing the selected cell's colour (an outlined empty bar = no fill). */
function ColorIcon({ color, icon }: { color: string | null; icon: ReactNode }) {
  return (
    <span className="relative flex flex-col items-center">
      {icon}
      <span className={cn("-mt-0.5 h-[3px] w-4", !color && "border border-[#a6a6a6] bg-white")} style={color ? { background: color } : undefined} />
    </span>
  );
}

/** Lighter (t > 0, towards white) or darker (t < 0, towards black) version of a colour. */
function shade(hex: string, t: number) {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `#${rgb
    .map((v) => Math.round(t > 0 ? v + (255 - v) * t : v * (1 + t)))
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()}`;
}
/** Excel's five tint/shade rows under each theme colour (white and black have their own). */
const shadeSteps = (i: number) => (i === 0 ? [-0.05, -0.15, -0.25, -0.35, -0.5] : i === 1 ? [0.5, 0.35, 0.25, 0.15, 0.05] : [0.8, 0.6, 0.4, -0.25, -0.5]);
const THEME_SHADES = [0, 1, 2, 3, 4].flatMap((row) => THEME_COLORS.map((c, i) => shade(c, shadeSteps(i)[row])));

function Palette({ none, onNone, onPick, recent, current }: { none: string; onNone: () => void; onPick: (c: string) => void; recent: string[]; current?: string }) {
  const more = useRef<HTMLInputElement>(null);
  // "More Colors...": the browser's colour dialog; applied once when it is closed (one undo step).
  useEffect(() => {
    const el = more.current;
    if (!el) return;
    const onChange = () => onPick(el.value.toUpperCase());
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, [onPick]);
  const swatch = (c: string, i: number) => (
    <button
      key={`${c}-${i}`}
      type="button"
      onMouseDown={keep}
      onClick={() => onPick(c)}
      title={c}
      aria-label={c}
      className={cn("size-[18px] border border-[#d4d4d4] hover:z-10 hover:outline-2 hover:outline-[#f29436]", current?.toUpperCase() === c && "outline-2 outline-[#262626]")}
      style={{ background: c }}
    />
  );
  const heading = "mb-1.5 text-[12px] font-semibold text-[#262626]";
  return (
    <div className="px-3 py-2">
      <button type="button" onMouseDown={keep} onClick={onNone} className="mb-2 flex w-full items-center gap-2 rounded-sm px-1 py-1 text-[12.5px] hover:bg-[#e6f2ea]">
        <span className="size-4 border border-[#a6a6a6] bg-[linear-gradient(135deg,transparent_45%,#c00000_45%,#c00000_55%,transparent_55%)]" />
        {none}
      </button>
      <p className={heading}>Theme Colors</p>
      <div className="mb-1.5 grid grid-cols-10 gap-x-[4px]">{THEME_COLORS.map(swatch)}</div>
      <div className="mb-3 grid grid-cols-10 gap-x-[4px]">{THEME_SHADES.map(swatch)}</div>
      <p className={heading}>Standard Colors</p>
      <div className="mb-3 grid grid-cols-10 gap-x-[4px]">{STANDARD_COLORS.map(swatch)}</div>
      {recent.length ? (
        <>
          <p className={heading}>Recent Colors</p>
          <div className="mb-3 grid grid-cols-10 gap-x-[4px]">{recent.map(swatch)}</div>
        </>
      ) : null}
      <label className="flex w-full cursor-pointer items-center gap-2 rounded-sm border-t border-[#e1e1e1] px-1 pt-2 pb-0.5 text-[12.5px] hover:text-[#185c37]">
        <span className="size-4 rounded-full bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)]" />
        More Colors...
        <input ref={more} type="color" defaultValue={current ?? "#000000"} className="sr-only" />
      </label>
    </div>
  );
}

/** Excel's Top / Middle / Bottom Align icons: two text lines against the top, middle or bottom. */
function VAlignIcon({ at }: { at: "top" | "middle" | "bottom" }) {
  const y = at === "top" ? 5 : at === "middle" ? 6.5 : 8;
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden>
      {at === "top" ? <line x1="2" y1="2" x2="14" y2="2" /> : null}
      {at === "bottom" ? <line x1="2" y1="14" x2="14" y2="14" /> : null}
      <line x1="4.5" y1={y} x2="11.5" y2={y} />
      <line x1="4.5" y1={y + 3} x2="11.5" y2={y + 3} />
    </svg>
  );
}

/** "ab" with a slanted arrow, like Excel's Orientation button. */
function OrientIcon({ rot = 45 }: { rot?: CellFmt["rot"] }) {
  const style: CSSProperties =
    rot === "v" ? { writingMode: "vertical-rl", textOrientation: "upright", fontSize: 8, lineHeight: 1 } : { transform: `rotate(${-(rot ?? 45)}deg)`, fontSize: 10 };
  return (
    <span className="grid size-4 place-items-center font-semibold italic" aria-hidden>
      <span style={style}>ab</span>
    </span>
  );
}
