import type { jsPDF as JsPDF } from "jspdf";
import type { CellInput, Styles } from "jspdf-autotable";
import { fmtDate, fmtMoney, fmtQty, fmtWeight } from "../format";
import { amountInWords } from "./currency";
import { exportColumns, exportMerges, sheetColumnId } from "./export-columns";
import {
  adjustmentTitle,
  computeTotals,
  currencyLabel,
  lineAmount,
  lineNet,
  lineWeight,
} from "./calc";
import type { CellFmt, QuoteDocument } from "./types";

type RGB = [number, number, number];
// Black and grey only (prints the same on any printer).
const BRAND: RGB = [17, 17, 17];
const BRAND_LIGHT: RGB = [242, 242, 242];
const INK: RGB = [17, 17, 17];
const MUTED: RGB = [102, 102, 102];
const LINE: RGB = [191, 191, 191];
const ZEBRA: RGB = [250, 250, 250];

/** The built-in PDF fonts only cover Latin-1; map the usual suspects and drop the rest. */
export function pdfSafe(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/[“”″]/g, '"')
    .replace(/[‘’′]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/€/g, "EUR ")
    .replace(/₹/g, "INR ")
    .replace(/标准/g, "Standard")
    .replace(/[^\n\r\t\x20-\x7E\xA0-\xFF]/g, "");
}

export type PdfOptions = { orientation?: "portrait" | "landscape" };

const hexRgb = (hex: string): RGB => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/** A sheet cell's formatting as PDF table cell styles (the built-in fonts: Helvetica, Times, Courier). */
function pdfCellStyles(f: CellFmt | undefined, baseSize: number): Partial<Styles> | undefined {
  if (!f) return undefined;
  const styles: Partial<Styles> = {};
  if (f.b || f.i) styles.fontStyle = f.b && f.i ? "bolditalic" : f.b ? "bold" : "italic";
  if (f.font) styles.font = /times|cambria|georgia/i.test(f.font) ? "times" : /courier/i.test(f.font) ? "courier" : "helvetica";
  if (f.size) styles.fontSize = Math.round(((f.size * baseSize) / 11) * 10) / 10;
  if (f.color) styles.textColor = hexRgb(f.color);
  if (f.fill) styles.fillColor = hexRgb(f.fill);
  if (f.h) styles.halign = f.h;
  if (f.v) styles.valign = f.v;
  return Object.keys(styles).length ? styles : undefined;
}

export async function buildQuotationPdf(
  doc: QuoteDocument,
  options: PdfOptions = {},
): Promise<Blob> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const { header, company, lines, totals } = doc;
  const cols = exportColumns(doc);
  const orientation =
    options.orientation ?? (cols.length > 8 ? "landscape" : "portrait");

  const pdf: JsPDF = new jsPDF({
    orientation,
    unit: "mm",
    format: "a4",
    compress: true,
  });
  pdf.setProperties({
    title: `Quotation ${doc.quoteNo}`,
    subject: `Quotation for ${header.customer_name}`,
    author: company.company_name,
    creator: "Quotation Panel",
  });

  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const M = 12;
  const contentW = pageW - M * 2;
  let y = M;

  const text = (
    value: string,
    x: number,
    yy: number,
    opts: {
      size?: number;
      bold?: boolean;
      color?: RGB;
      align?: "left" | "right" | "center";
      maxWidth?: number;
    } = {},
  ) => {
    pdf.setFont("helvetica", opts.bold ? "bold" : "normal");
    pdf.setFontSize(opts.size ?? 9);
    pdf.setTextColor(...(opts.color ?? INK));
    const safe = pdfSafe(value);
    const linesOut = opts.maxWidth
      ? pdf.splitTextToSize(safe, opts.maxWidth)
      : [safe];
    pdf.text(linesOut, x, yy, { align: opts.align ?? "left", baseline: "top" });
    return linesOut.length * (opts.size ?? 9) * 0.3528 * 1.25;
  };

  const ensureSpace = (needed: number) => {
    if (y + needed > pageH - 18) {
      pdf.addPage();
      y = M;
    }
  };

  // ---- Header: company name and details, centred -------------------------------------
  const cx = pageW / 2;
  const centred = { align: "center" as const, maxWidth: contentW };
  y += text(company.company_name, cx, y, { size: 16, bold: true, color: BRAND, ...centred });
  y += 1;
  if (company.tagline) y += text(company.tagline, cx, y, { size: 8.5, color: MUTED, ...centred });
  if (company.address) y += text(company.address.replace(/\r?\n/g, ", "), cx, y, { size: 8.5, color: MUTED, ...centred });
  const contact = [company.phone && `Tel: ${company.phone}`, company.email, company.website].filter(Boolean).join("  |  ");
  if (contact) y += text(contact, cx, y, { size: 8.5, color: MUTED, ...centred });
  if (company.tax_id) y += text(`Tax ID: ${company.tax_id}`, cx, y, { size: 8.5, color: MUTED, ...centred });

  y += 3;
  pdf.setDrawColor(...BRAND);
  pdf.setLineWidth(0.6);
  pdf.line(M, y, pageW - M, y);
  y += 5;

  // ---- Bill to / details boxes ---------------------------------------------------
  const gap = 5;
  const boxW = (contentW - gap) / 2;
  const pad = 3.5;
  const measure = (s: string, size: number, w: number) => {
    pdf.setFontSize(size);
    return pdf.splitTextToSize(pdfSafe(s), w).length * size * 0.3528 * 1.25;
  };
  const billLines: [string, number, boolean][] = [
    [header.customer_name, 10.5, true],
    ...(header.contact_person
      ? [
          [`Attn: ${header.contact_person}`, 8.5, false] as [
            string,
            number,
            boolean,
          ],
        ]
      : []),
    ...(header.customer_address
      ? [[header.customer_address, 8.5, false] as [string, number, boolean]]
      : []),
    ...(header.customer_phone
      ? [
          [`Tel: ${header.customer_phone}`, 8.5, false] as [
            string,
            number,
            boolean,
          ],
        ]
      : []),
    ...(header.customer_email
      ? [
          [`Email: ${header.customer_email}`, 8.5, false] as [
            string,
            number,
            boolean,
          ],
        ]
      : []),
  ];
  const details: [string, string][] = [
    ["Quotation No", doc.quoteNo],
    ["Date", fmtDate(header.quote_date)],
    ["Valid Until", fmtDate(header.valid_until)],
    ["Reference", header.reference],
    ["Currency", header.currency],
    ["Prepared By", doc.preparedBy ?? ""],
  ].filter((d): d is [string, string] => Boolean(d[1]));

  const billH =
    6 +
    billLines.reduce(
      (s, [t, size]) => s + measure(t, size, boxW - pad * 2) + 0.6,
      0,
    ) +
    pad;
  const detailsH = 6 + details.length * 4.6 + pad;
  const boxH = Math.max(billH, detailsH);

  pdf.setFillColor(...BRAND_LIGHT);
  pdf.setDrawColor(...LINE);
  pdf.setLineWidth(0.2);
  pdf.rect(M, y, boxW, boxH, "FD");
  pdf.rect(M + boxW + gap, y, boxW, boxH, "FD");

  text("BILL TO", M + pad, y + pad, { size: 7.5, bold: true, color: MUTED });
  let by = y + pad + 4.5;
  for (const [t, size, bold] of billLines) {
    by += text(t, M + pad, by, { size, bold, maxWidth: boxW - pad * 2 }) + 0.6;
  }

  const dx = M + boxW + gap + pad;
  text("QUOTATION DETAILS", dx, y + pad, {
    size: 7.5,
    bold: true,
    color: MUTED,
  });
  let dy = y + pad + 4.8;
  for (const [label, value] of details) {
    text(label, dx, dy, { size: 8.5, color: MUTED });
    text(value, M + contentW - pad, dy, {
      size: 8.5,
      bold: label === "Quotation No",
      align: "right",
    });
    dy += 4.6;
  }
  y += boxH + 6;

  // ---- Items table ---------------------------------------------------------------
  const fixed = cols.reduce(
    (s, c) => s + (c.pdfWidth === "auto" ? 0 : c.pdfWidth),
    0,
  );
  const scale = fixed > contentW - 40 ? (contentW - 40) / fixed : 1;
  const columnStyles: Record<
    number,
    { cellWidth: number | "auto"; halign: "left" | "center" | "right" }
  > = {};
  cols.forEach((c, i) => {
    columnStyles[i] = {
      cellWidth: c.pdfWidth === "auto" ? "auto" : c.pdfWidth * scale,
      halign: c.align,
    };
  });

  // One table per sheet (with its own TOTAL row); the sheet name is shown when there are several.
  const sheetNames = header.sheet_names?.length
    ? header.sheet_names
    : ["Quotation"];
  for (let si = 0; si < sheetNames.length; si++) {
    const sheetLines = lines.filter((l) => (l.sheet ?? 0) === si);
    const sheetTotals = computeTotals(sheetLines, header);
    if (sheetNames.length > 1) {
      ensureSpace(16);
      text(sheetNames[si], M, y, { size: 10, bold: true, color: BRAND });
      y += 5.5;
    }
    const baseFont = cols.length > 12 ? 7 : 7.8;
    const body = sheetLines.map((line, idx) => {
      const values = cols.map((c) => {
        switch (c.kind) {
          case "index":
            return String(idx + 1);
          case "qty":
            return fmtQty(line.qty ?? 0);
          case "weight":
            return fmtWeight(line.unit_weight_kg);
          case "money":
            return fmtMoney(line.unit_price ?? 0);
          case "totalWeight":
            return fmtWeight(lineWeight(line));
          case "amount":
            return fmtMoney(lineAmount(line));
          case "loading":
            return fmtMoney(line.loading_charges ?? 0);
          case "net":
            return fmtMoney(lineNet(line));
          default:
            return pdfSafe(String(c.value?.(line) ?? ""));
        }
      });
      // Cell formatting and merged cells from the sheet.
      const merges = exportMerges(line, cols);
      const covered = new Set([...merges].flatMap(([a, b]) => Array.from({ length: b - a }, (_, k) => a + 1 + k)));
      return values.flatMap<CellInput>((content, i) => {
        if (covered.has(i)) return [];
        const styles = pdfCellStyles(line.fmt?.[sheetColumnId(cols[i])], baseFont);
        const span = merges.get(i);
        return styles || span ? [{ content, ...(span ? { colSpan: span - i + 1 } : {}), ...(styles ? { styles } : {}) }] : [content];
      });
    });
    const foot = [
      cols.map((c) => {
        if (c.key === "description") return "TOTAL";
        if (c.key === "qty") return fmtQty(sheetTotals.totalQty);
        if (c.kind === "totalWeight") return fmtWeight(sheetTotals.totalWeight);
        if (c.kind === "amount") return fmtMoney(sheetTotals.grossAmount);
        if (c.kind === "loading") return fmtMoney(sheetTotals.totalLoading);
        if (c.kind === "net") return fmtMoney(sheetTotals.baseSubtotal);
        return "";
      }),
    ];

    autoTable(pdf, {
      startY: y,
      margin: { left: M, right: M, top: M, bottom: 18 },
      head: [cols.map((c) => pdfSafe(c.header))],
      body,
      foot,
      showFoot: "lastPage",
      showHead: "everyPage",
      rowPageBreak: "avoid",
      theme: "grid",
      styles: {
        font: "helvetica",
        fontSize: baseFont,
        cellPadding: { top: 1.6, bottom: 1.6, left: 1.4, right: 1.4 },
        lineColor: LINE,
        lineWidth: 0.15,
        textColor: INK,
        valign: "middle",
        overflow: "linebreak",
      },
      headStyles: {
        fillColor: BRAND,
        textColor: 255,
        fontStyle: "bold",
        halign: "center",
        valign: "middle",
      },
      footStyles: { fillColor: BRAND_LIGHT, textColor: INK, fontStyle: "bold" },
      alternateRowStyles: { fillColor: ZEBRA },
      columnStyles,
      didParseCell: (data) => {
        if (data.section === "foot")
          data.cell.styles.halign =
            cols[data.column.index]?.key === "description"
              ? "right"
              : cols[data.column.index]?.align;
      },
    });
    y =
      ((pdf as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable
        ?.finalY ?? y) + 6;
  }

  // ---- Totals ----------------------------------------------------------------------
  const base = currencyLabel(company.base_currency);
  const quote = currencyLabel(header.currency);
  const summary: [string, string, boolean][] =
    header.currency !== company.base_currency
      ? [
          [`Final total (${base})`, fmtMoney(totals.baseSubtotal), false],
          [
            `Exchange rate (1 ${base})`,
            `${totals.exchangeRate} ${quote}`,
            false,
          ],
          [`Amount (${quote})`, fmtMoney(totals.subtotal), true],
        ]
      : [[`Subtotal (${base})`, fmtMoney(totals.subtotal), false]];
  for (const a of totals.adjustments) {
    summary.push([
      adjustmentTitle(a),
      a.kind === "discount" ? `- ${fmtMoney(a.amount)}` : fmtMoney(a.amount),
      false,
    ]);
  }

  const totalsW = 78;
  const totalsH = summary.length * 6 + 9;
  ensureSpace(totalsH + 4);
  const tx = pageW - M - totalsW;
  let ty = y;
  for (const [label, value] of summary) {
    text(label, tx + 2, ty + 1, { size: 8.5, color: MUTED });
    text(value, pageW - M - 2, ty + 1, { size: 8.5, align: "right" });
    pdf.setDrawColor(...LINE);
    pdf.setLineWidth(0.15);
    pdf.line(tx, ty + 5.6, pageW - M, ty + 5.6);
    ty += 6;
  }
  pdf.setFillColor(...BRAND);
  pdf.rect(tx, ty + 0.8, totalsW, 8, "F");
  text(`GRAND TOTAL (${quote})`, tx + 2.5, ty + 2.6, {
    size: 9,
    bold: true,
    color: [255, 255, 255],
  });
  text(fmtMoney(totals.grandTotal), pageW - M - 2.5, ty + 2.6, {
    size: 10,
    bold: true,
    color: [255, 255, 255],
    align: "right",
  });

  // Left of the totals: the amount in words (quantity and weight are in the TOTAL row above).
  const leftBoxW = contentW - totalsW - 8;
  let ly = y;
  text("Amount in words", M, ly, { size: 7.5, bold: true, color: MUTED });
  ly += 4;
  ly += text(amountInWords(totals.grandTotal, header.currency), M, ly, {
    size: 8.5,
    bold: true,
    maxWidth: leftBoxW,
  });
  y = Math.max(ty + 12, ly + 4);

  // ---- Notes / terms / bank details --------------------------------------------------
  const section = (heading: string, body: string | null | undefined) => {
    if (!body?.trim()) return;
    const height = measure(body.trim(), 8.5, contentW) + 7;
    ensureSpace(Math.min(height, 40));
    text(heading.toUpperCase(), M, y, { size: 7.5, bold: true, color: BRAND });
    y += 4.5;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    pdf.setTextColor(...INK);
    for (const line of pdf.splitTextToSize(
      pdfSafe(body.trim()),
      contentW,
    ) as string[]) {
      ensureSpace(4.5);
      pdf.text(line, M, y, { baseline: "top" });
      y += 3.9;
    }
    y += 3;
  };
  section("Notes", header.notes);
  section("Terms & Conditions", header.terms);
  section("Bank Details", company.bank_details);

  // ---- Signature ---------------------------------------------------------------------
  ensureSpace(26);
  const sx = pageW - M - 62;
  text(`For ${company.company_name}`, sx + 31, y + 2, {
    size: 9,
    bold: true,
    align: "center",
    maxWidth: 62,
  });
  pdf.setDrawColor(...INK);
  pdf.setLineWidth(0.3);
  pdf.line(sx, y + 20, pageW - M, y + 20);
  text("Authorised Signatory", sx + 31, y + 21.5, {
    size: 8,
    color: MUTED,
    align: "center",
  });

  // ---- Footer on every page ------------------------------------------------------------
  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    pdf.setDrawColor(...LINE);
    pdf.setLineWidth(0.2);
    pdf.line(M, pageH - 11, pageW - M, pageH - 11);
    text(company.company_name, M, pageH - 9, {
      size: 7.5,
      color: MUTED,
    });
    if (company.footer_note)
      text(company.footer_note, pageW / 2, pageH - 9, {
        size: 7.5,
        color: MUTED,
        align: "center",
        maxWidth: contentW / 2,
      });
    text(`Page ${p} of ${pages}`, pageW - M, pageH - 9, {
      size: 7.5,
      color: MUTED,
      align: "right",
    });
  }

  return pdf.output("blob");
}
