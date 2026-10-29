import type { Alignment, Borders, Cell, Fill, Font, Worksheet } from "exceljs";
import { fmtDate } from "../format";
import { amountInWords } from "./currency";
import { exportColumns, exportMerges, sheetColumnId, type ExportColumn } from "./export-columns";
import {
  adjustmentTitle,
  computeTotals,
  currencyLabel,
  lineAmount,
  lineNet,
  lineWeight,
} from "./calc";
import type { CellFmt, QuoteDocument } from "./types";

// Black and grey only (prints the same on any printer).
const BRAND = "FF111111";
const BRAND_LIGHT = "FFF2F2F2";
const BORDER = "FFBFBFBF";
const MUTED = "FF666666";
const ZEBRA = "FFFAFAFA";

const thin = { style: "thin" as const, color: { argb: BORDER } };
const allBorders: Partial<Borders> = {
  top: thin,
  left: thin,
  bottom: thin,
  right: thin,
};
const solid = (argb: string): Fill => ({
  type: "pattern",
  pattern: "solid",
  fgColor: { argb },
});

/** Applies a sheet cell's formatting (Home ribbon) on top of the cell's normal style. */
function applyCellFmt(cell: Cell, f: CellFmt | undefined) {
  if (!f) return;
  const argb = (hex: string) => `FF${hex.slice(1).toUpperCase()}`;
  const font: Partial<Font> = { ...cell.font };
  if (f.font) font.name = f.font;
  if (f.size) font.size = f.size;
  if (f.b) font.bold = true;
  if (f.i) font.italic = true;
  if (f.u) font.underline = f.u === 2 ? "double" : true;
  if (f.color) font.color = { argb: argb(f.color) };
  cell.font = font;
  if (f.fill) cell.fill = solid(argb(f.fill));
  const alignment: Partial<Alignment> = { ...cell.alignment };
  if (f.h) alignment.horizontal = f.h;
  if (f.v) alignment.vertical = f.v;
  if (f.wrap) alignment.wrapText = true;
  if (f.indent) alignment.indent = f.indent;
  if (f.rot != null) alignment.textRotation = f.rot === "v" ? "vertical" : f.rot;
  cell.alignment = alignment;
  const edge = (w?: 1 | 2) => (w ? { style: w === 2 ? ("medium" as const) : ("thin" as const), color: { argb: "FF000000" } } : undefined);
  if (f.bt || f.bb || f.bl || f.br) {
    cell.border = {
      ...cell.border,
      ...(f.bt ? { top: edge(f.bt) } : {}),
      ...(f.bb ? { bottom: edge(f.bb) } : {}),
      ...(f.bl ? { left: edge(f.bl) } : {}),
      ...(f.br ? { right: edge(f.br) } : {}),
    };
  }
}

function colLetter(n: number) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function estimateLines(text: string, widthChars: number) {
  return text
    .split(/\r?\n/)
    .reduce(
      (sum, line) =>
        sum +
        Math.max(1, Math.ceil(line.length / Math.max(widthChars * 1.15, 1))),
      0,
    );
}

/** Excel sheet names: max 31 characters, none of : \\ / ? * [ ], unique (case-insensitive). */
function excelSheetNames(names: string[]) {
  const used = new Set<string>();
  return names.map((raw, i) => {
    const base = (
      raw.replace(/[:\\/?*[\]]/g, " ").trim() || `Sheet ${i + 1}`
    ).slice(0, 31);
    let name = base;
    for (let k = 2; used.has(name.toLowerCase()); k++)
      name = `${base.slice(0, 31 - String(k).length - 1)} ${k}`;
    used.add(name.toLowerCase());
    return name;
  });
}

/**
 * Builds a styled .xlsx (live formulas for weights, amounts and totals), one worksheet
 * per quotation sheet. The last worksheet carries the quotation summary, whose final
 * total adds up the TOTAL row of every sheet.
 */
export async function buildQuotationWorkbook(
  doc: QuoteDocument,
): Promise<ArrayBuffer> {
  // CJS in Node, UMD bundle in the browser: the namespace may or may not sit under `default`.
  const mod =
    (await import("exceljs")) as unknown as typeof import("exceljs") & {
      default?: typeof import("exceljs");
    };
  const ExcelJS = mod.default ?? mod;

  const { header, company, totals } = doc;
  const cols = exportColumns(doc);
  const n = cols.length;
  const last = colLetter(n);
  const colIndex = (key: string) => cols.findIndex((c) => c.key === key) + 1;
  const widthOf = (from: number, to: number) =>
    cols.slice(from - 1, to).reduce((s, c) => s + c.width, 0);

  const wb = new ExcelJS.Workbook();
  wb.creator = company.company_name;
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;

  const sheetNames = excelSheetNames(
    header.sheet_names?.length ? header.sheet_names : ["Quotation"],
  );
  const netRefs: { ref: string; result: number }[] = []; // each sheet's Final Total (TOTAL row)

  for (let si = 0; si < sheetNames.length; si++) {
    const isLastSheet = si === sheetNames.length - 1;
    const lines = doc.lines.filter((l) => (l.sheet ?? 0) === si);
    const sheetTotals = computeTotals(lines, header);
    const ws: Worksheet = wb.addWorksheet(sheetNames[si], {
      views: [{ showGridLines: false }],
      pageSetup: {
        paperSize: 9,
        orientation: n > 11 ? "landscape" : "portrait",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        horizontalCentered: true,
        margins: {
          left: 0.4,
          right: 0.4,
          top: 0.5,
          bottom: 0.6,
          header: 0.3,
          footer: 0.3,
        },
      },
      headerFooter: {
        oddFooter: `&L&8${doc.quoteNo}&C&8${(company.footer_note ?? "").replace(/&/g, "&&")}&R&8Page &P of &N`,
      },
    });
    ws.columns = cols.map((c) => ({ width: c.width }));

    let r = 1;
    const merge = (row: number, from: number, to: number) => {
      if (to > from) ws.mergeCells(row, from, row, to);
      return ws.getCell(row, from);
    };
    const style = (
      cell: Cell,
      font: Partial<Font>,
      alignment: Partial<Alignment> = {},
      fill?: Fill,
    ) => {
      cell.font = { name: "Calibri", size: 10, ...font };
      cell.alignment = { vertical: "middle", ...alignment };
      if (fill) cell.fill = fill;
    };

    // ---- Company header -------------------------------------------------
    const title = merge(r, 1, n);
    title.value = company.company_name;
    style(
      title,
      { size: 18, bold: true, color: { argb: BRAND } },
      { horizontal: "left" },
    );
    ws.getRow(r).height = 28;
    r++;

    const companyLines = [
      company.tagline,
      company.address?.replace(/\r?\n/g, ", "),
      [
        company.phone && `Tel: ${company.phone}`,
        company.email && `Email: ${company.email}`,
        company.website,
      ]
        .filter(Boolean)
        .join("   |   "),
      company.tax_id && `Tax ID: ${company.tax_id}`,
    ].filter((s): s is string => Boolean(s));
    for (const text of companyLines) {
      const cell = merge(r, 1, n);
      cell.value = text;
      style(
        cell,
        { size: 9, color: { argb: MUTED } },
        { horizontal: "left", wrapText: true },
      );
      ws.getRow(r).height = 14 * estimateLines(text, widthOf(1, n));
      r++;
    }
    r++;

    const band = merge(r, 1, n);
    band.value = "QUOTATION";
    style(
      band,
      { size: 14, bold: true, color: { argb: "FFFFFFFF" } },
      { horizontal: "center" },
      solid(BRAND),
    );
    ws.getRow(r).height = 24;
    r += 2;

    // ---- Bill-to (left) and quotation details (right) --------------------
    const rightLabelFrom = Math.max(n - 3, 2);
    const leftTo = rightLabelFrom - 1;
    const billTo = [
      {
        text: "BILL TO",
        font: { bold: true, size: 9, color: { argb: MUTED } },
      },
      { text: header.customer_name, font: { bold: true, size: 11 } },
      {
        text: header.contact_person ? `Attn: ${header.contact_person}` : "",
        font: {},
      },
      { text: header.customer_address, font: {} },
      {
        text: header.customer_phone ? `Tel: ${header.customer_phone}` : "",
        font: {},
      },
      {
        text: header.customer_email ? `Email: ${header.customer_email}` : "",
        font: {},
      },
    ].filter((x) => x.text);
    const details: [string, string][] = [
      ["Quotation No", doc.quoteNo],
      ["Date", fmtDate(header.quote_date)],
      ["Valid Until", fmtDate(header.valid_until)],
      ["Reference", header.reference],
      ["Currency", header.currency],
      ["Prepared By", doc.preparedBy ?? ""],
    ].filter((d): d is [string, string] => Boolean(d[1]));

    const blockRows = Math.max(billTo.length, details.length);
    for (let i = 0; i < blockRows; i++) {
      const row = ws.getRow(r + i);
      let height = 16;
      if (billTo[i]) {
        const cell = merge(r + i, 1, leftTo);
        cell.value = billTo[i].text.replace(/\r?\n/g, ", ");
        style(cell, billTo[i].font, { horizontal: "left", wrapText: true });
        height = Math.max(
          height,
          15 * estimateLines(String(cell.value), widthOf(1, leftTo)),
        );
      }
      if (details[i]) {
        const label = merge(r + i, rightLabelFrom, rightLabelFrom + 1);
        label.value = details[i][0];
        style(
          label,
          { bold: true, size: 9, color: { argb: MUTED } },
          { horizontal: "left" },
          solid(BRAND_LIGHT),
        );
        const value = merge(r + i, rightLabelFrom + 2, n);
        value.value = details[i][1];
        style(
          value,
          { bold: i === 0 },
          { horizontal: "left" },
          solid(BRAND_LIGHT),
        );
      }
      row.height = height;
    }
    r += blockRows + 1;

    // ---- Items table --------------------------------------------------------
    const headerRow = r;
    cols.forEach((c, i) => {
      const cell = ws.getCell(r, i + 1);
      cell.value = c.header;
      style(
        cell,
        { bold: true, size: 9, color: { argb: "FFFFFFFF" } },
        { horizontal: "center", wrapText: true },
        solid(BRAND),
      );
      cell.border = allBorders;
    });
    ws.getRow(r).height = 30;
    r++;

    // Formulas point at the source cells; a deleted (hidden) source column is written as its value.
    const letterOf = (key: string) =>
      colIndex(key) ? colLetter(colIndex(key)) : null;
    const qtyCol = letterOf("qty");
    const uwCol = letterOf("unit_weight_kg");
    const priceCol = letterOf("unit_price");
    const amountColL = letterOf("amount");
    const ref = (col: string | null, row: number, value: number) =>
      col ? `${col}${row}` : String(value);
    const firstItemRow = r;

    lines.forEach((line, idx) => {
      const row = ws.getRow(r);
      cols.forEach((c: ExportColumn, i) => {
        const cell = ws.getCell(r, i + 1);
        switch (c.kind) {
          case "index":
            cell.value = idx + 1;
            break;
          case "totalWeight":
            cell.value = {
              formula: `${ref(qtyCol, r, line.qty ?? 0)}*${ref(uwCol, r, line.unit_weight_kg ?? 0)}`,
              result: lineWeight(line),
            };
            cell.numFmt = "#,##0.000";
            break;
          case "amount":
            cell.value = {
              formula: `ROUND(${ref(qtyCol, r, line.qty ?? 0)}*${ref(priceCol, r, line.unit_price ?? 0)},2)`,
              result: lineAmount(line),
            };
            cell.numFmt = "#,##0.00";
            break;
          case "net": // Final Total = Total Amount
            cell.value = {
              formula: ref(amountColL, r, lineAmount(line)),
              result: lineNet(line),
            };
            cell.numFmt = "#,##0.00";
            break;
          default: {
            const v = c.value?.(line) ?? null;
            cell.value = v;
            if (c.kind === "qty")
              cell.numFmt = Number.isInteger(Number(v)) ? "#,##0" : "#,##0.00";
            if (c.kind === "weight") cell.numFmt = "#,##0.000";
            if (c.kind === "money") cell.numFmt = "#,##0.00";
          }
        }
        style(
          cell,
          { size: 9.5 },
          { horizontal: c.align, wrapText: c.kind === "text" },
          idx % 2 ? solid(ZEBRA) : undefined,
        );
        cell.border = allBorders;
        applyCellFmt(cell, line.fmt?.[sheetColumnId(c)]);
      });
      // Merged cells (Merge & Center on the sheet).
      for (const [start, end] of exportMerges(line, cols)) ws.mergeCells(r, start + 1, r, end + 1);
      const descWidth = cols.find((c) => c.key === "description")?.width ?? 40;
      const fmts = Object.values(line.fmt ?? {});
      const biggest = Math.max(9.5, ...fmts.map((f) => f.size ?? 0));
      const upright = fmts.some((f) => f.rot === 90 || f.rot === -90 || f.rot === "v");
      row.height = Math.max(
        18,
        14 * (biggest / 9.5) * estimateLines(line.description, descWidth),
        upright ? 60 : 0,
      );
      r++;
    });
    const lastItemRow = r - 1;
    const hasItems = lines.length > 0;
    const sum = (letter: string) =>
      hasItems ? `SUM(${letter}${firstItemRow}:${letter}${lastItemRow})` : "0";

    // Totals row under the table.
    const descIdx = colIndex("description");
    const totalRow = r;
    cols.forEach((c, i) => {
      const cell = ws.getCell(r, i + 1);
      const letter = colLetter(i + 1);
      if (i + 1 === descIdx) cell.value = "TOTAL";
      if (c.key === "qty") {
        cell.value = { formula: sum(letter), result: sheetTotals.totalQty };
        cell.numFmt = Number.isInteger(sheetTotals.totalQty)
          ? "#,##0"
          : "#,##0.00";
      }
      if (c.kind === "totalWeight") {
        cell.value = { formula: sum(letter), result: sheetTotals.totalWeight };
        cell.numFmt = "#,##0.000";
      }
      if (c.kind === "amount" || c.kind === "net") {
        const result = c.kind === "amount" ? sheetTotals.grossAmount : sheetTotals.baseSubtotal;
        cell.value = { formula: sum(letter), result };
        cell.numFmt = "#,##0.00";
      }
      style(
        cell,
        { bold: true },
        { horizontal: c.kind === "text" ? "right" : c.align },
        solid(BRAND_LIGHT),
      );
      cell.border = allBorders;
    });
    ws.getRow(r).height = 20;
    r += 2;
    netRefs.push({
      ref: `'${sheetNames[si].replace(/'/g, "''")}'!${colLetter(colIndex("net"))}${totalRow}`,
      result: sheetTotals.baseSubtotal,
    });

    if (!isLastSheet) {
      ws.pageSetup.printArea = `A1:${last}${r}`;
      ws.pageSetup.printTitlesRow = `${headerRow}:${headerRow}`;
      continue;
    }

    // ---- Summary block (right aligned under the Final Total column) ---------
    const amountIdx = colIndex("net");
    const amountCol = colLetter(amountIdx);
    const labelFrom = Math.max(1, amountIdx - 3);
    type SummaryLine = {
      label: string;
      formula: string;
      result: number;
      numFmt?: string;
    };
    const base = currencyLabel(company.base_currency);
    const quote = currencyLabel(header.currency);
    const converts = header.currency !== company.base_currency;
    // Lines are in RMB; the final total is converted to the quotation currency here.
    const pre: SummaryLine[] = [];
    // One sheet: its own TOTAL cell. Several sheets: the TOTAL cells of all sheets added up.
    const allSheetsNet =
      netRefs.length > 1
        ? netRefs.map((x) => x.ref).join("+")
        : `${amountCol}${totalRow}`;
    let subtotalRef = allSheetsNet;
    if (converts) {
      pre.push({
        label: `Final total (${base})`,
        formula: allSheetsNet,
        result: totals.baseSubtotal,
      });
      pre.push({
        label: `Exchange rate (1 ${base} = ? ${quote})`,
        formula: String(totals.exchangeRate),
        result: totals.exchangeRate,
        numFmt: "0.0000",
      });
    }
    const preStart = r;
    pre.forEach((s) => {
      const label = merge(r, labelFrom, amountIdx - 1);
      label.value = s.label;
      style(
        label,
        { bold: true, size: 9.5, color: { argb: MUTED } },
        { horizontal: "right" },
      );
      const cell = ws.getCell(r, amountIdx);
      cell.value = s.label.startsWith("Exchange")
        ? totals.exchangeRate
        : { formula: s.formula, result: s.result };
      cell.numFmt = s.numFmt ?? "#,##0.00";
      style(cell, {}, { horizontal: "right" });
      cell.border = { bottom: thin };
      r++;
    });
    if (converts)
      subtotalRef = `ROUND(${amountCol}${preStart}*${amountCol}${preStart + 1},2)`;
    const summary: SummaryLine[] = [
      {
        label: converts ? `Amount (${quote})` : `Subtotal (${base})`,
        formula: subtotalRef,
        result: totals.subtotal,
      },
    ];
    // Discounts and charges are a % of the subtotal (or a fixed amount); discounts are negative.
    for (const a of totals.adjustments.filter((x) => x.kind !== "tax")) {
      const sign = a.kind === "discount" ? "-" : "";
      const formula =
        a.mode === "percent"
          ? `${sign}ROUND(${subtotalRef}*${a.value}/100,2)`
          : `${sign}${a.amount}`;
      summary.push({
        label: adjustmentTitle(a),
        formula,
        result: a.kind === "discount" ? -a.amount : a.amount,
      });
    }

    const summaryStart = r;
    summary.forEach((s) => {
      const label = merge(r, labelFrom, amountIdx - 1);
      label.value = s.label;
      style(
        label,
        { bold: true, size: 9.5, color: { argb: MUTED } },
        { horizontal: "right" },
      );
      const cell = ws.getCell(r, amountIdx);
      cell.value = { formula: s.formula, result: s.result };
      cell.numFmt = "#,##0.00";
      style(cell, {}, { horizontal: "right" });
      cell.border = { bottom: thin };
      r++;
    });
    const beforeTax = `SUM(${amountCol}${summaryStart}:${amountCol}${r - 1})`;
    // Taxes are a % of the taxable amount (subtotal - discounts + charges).
    for (const a of totals.adjustments.filter((x) => x.kind === "tax")) {
      const label = merge(r, labelFrom, amountIdx - 1);
      label.value = adjustmentTitle(a);
      style(
        label,
        { bold: true, size: 9.5, color: { argb: MUTED } },
        { horizontal: "right" },
      );
      const cell = ws.getCell(r, amountIdx);
      cell.value = {
        formula:
          a.mode === "percent"
            ? `ROUND(${beforeTax}*${a.value}/100,2)`
            : String(a.amount),
        result: a.amount,
      };
      cell.numFmt = "#,##0.00";
      style(cell, {}, { horizontal: "right" });
      cell.border = { bottom: thin };
      r++;
    }
    const grandLabel = merge(r, labelFrom, amountIdx - 1);
    grandLabel.value = `GRAND TOTAL (${quote})`;
    style(
      grandLabel,
      { bold: true, size: 11, color: { argb: "FFFFFFFF" } },
      { horizontal: "right" },
      solid(BRAND),
    );
    const grand = ws.getCell(r, amountIdx);
    grand.value = {
      formula: `SUM(${amountCol}${summaryStart}:${amountCol}${r - 1})`,
      result: totals.grandTotal,
    };
    grand.numFmt = "#,##0.00";
    style(
      grand,
      { bold: true, size: 11, color: { argb: "FFFFFFFF" } },
      { horizontal: "right" },
      solid(BRAND),
    );
    ws.getRow(r).height = 22;
    r += 2;

    // ---- Words, notes, terms, bank details ---------------------------------
    const paragraph = (
      heading: string,
      text: string | null | undefined,
      italic = false,
    ) => {
      if (!text?.trim()) return;
      const h = merge(r, 1, n);
      h.value = heading;
      style(
        h,
        { bold: true, size: 9.5, color: { argb: BRAND } },
        { horizontal: "left" },
      );
      r++;
      const body = merge(r, 1, n);
      body.value = text.trim();
      style(
        body,
        { size: 9.5, italic },
        { horizontal: "left", vertical: "top", wrapText: true },
      );
      ws.getRow(r).height = Math.max(
        16,
        13.5 * estimateLines(text.trim(), widthOf(1, n)),
      );
      r += 2;
    };
    paragraph(
      "Amount in words",
      amountInWords(totals.grandTotal, header.currency),
      true,
    );
    paragraph("Notes", header.notes);
    paragraph("Terms & Conditions", header.terms);
    paragraph("Bank Details", company.bank_details);

    // ---- Signature ------------------------------------------------------------
    const signFrom = Math.max(1, n - 3);
    const forCell = merge(r, signFrom, n);
    forCell.value = `For ${company.company_name}`;
    style(forCell, { bold: true }, { horizontal: "center" });
    r += 3;
    const sign = merge(r, signFrom, n);
    sign.value = "Authorised Signatory";
    style(sign, { size: 9, color: { argb: MUTED } }, { horizontal: "center" });
    sign.border = { top: { style: "thin", color: { argb: BRAND } } };

    ws.pageSetup.printArea = `A1:${last}${r}`;
    ws.pageSetup.printTitlesRow = `${headerRow}:${headerRow}`;
  }

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
