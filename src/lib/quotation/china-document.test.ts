import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import { blankLine } from "@/components/quotation/line-utils";
import { computeTotals } from "./calc";
import { chinaDocument } from "./china-document";
import { quoteFileName } from "./export-columns";
import { buildQuotationWorkbook } from "./export-excel";
import { buildQuotationPdf } from "./export-pdf";
import type { CompanyInfo, QuoteDocument, QuoteHeader, QuoteLine } from "./types";

const company = { company_name: "Co", base_currency: "CNY", signature_image: null } as unknown as CompanyInfo;
const header = {
  adjustments: [{ key: "gst", kind: "tax", label: "GST", mode: "percent", value: 18 }],
  exchange_rate: 12,
  currency: "INR",
  sheet_names: ["Ramesh", "Sheet 2"],
  extra_columns: [],
  hidden_columns: [],
  column_titles: {},
  customer_name: "Kamala Fittings",
  contact_person: "Ramesh",
  notes: "",
  terms: "",
} as unknown as QuoteHeader;
const line = (over: Partial<QuoteLine>): QuoteLine => ({ ...blankLine(0), description: '2"XSCH40', qty: 10, unit_weight_kg: 0.6, ...over });
const lines = [
  line({ base_price: 5.7, unit_price: 6.27, overrides: { net: 60 } }),
  line({ description: '3"XSCH40', base_price: 3.6, unit_price: 3.96, qty: 5 }),
  line({ sheet: 1, description: '4"XSCH40', base_price: 9, unit_price: 9.9 }),
];
const doc: QuoteDocument = { quoteNo: "QT-1", preparedBy: null, header, lines, totals: computeTotals(lines, header), company };

describe("the China price version of the downloads", () => {
  it("is the China tab: the first sheet's lines at the China price, in RMB, without the customer's GST or exchange rate", () => {
    const china = chinaDocument(doc);
    assert.deepEqual(china.lines.map((l) => l.unit_price), [5.7, 3.6]);
    assert.equal(china.lines[0].overrides, undefined, "a Final Total typed for the customer doesn't apply");
    assert.equal(china.header.currency, "CNY");
    assert.equal(china.totals.grandTotal, 75, "57 + 18");
    assert.equal(doc.lines[0].unit_price, 6.27, "the customer's lines are not touched");
  });

  it("the Excel file has both: the China sheet first, then the customer's; the customer's grand total leaves China out", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildQuotationWorkbook(doc, chinaDocument(doc)));
    assert.deepEqual(wb.worksheets.map((ws) => ws.name), ["China", "Ramesh", "Sheet 2"]);
    const values = (ws: ExcelJS.Worksheet) => {
      const out: unknown[] = [];
      ws.eachRow((row) => row.eachCell((cell) => out.push(cell.value)));
      return out;
    };
    const [china, customer, second] = wb.worksheets.map(values);
    assert.ok(china.includes("CHINA PRICE") && china.includes(5.7) && !china.includes(6.27), "China prices on the China sheet");
    assert.ok(customer.includes("QUOTATION") && customer.includes(6.27) && !customer.includes(5.7), "customer prices on the customer's sheet");
    const formulas = second.flatMap((v) => (v && typeof v === "object" && "formula" in v ? [String(v.formula)] : []));
    assert.ok(formulas.some((f) => f.includes("'Ramesh'!")), "the grand total adds up the customer's sheets");
    assert.ok(formulas.every((f) => !f.includes("China")), "and not the China sheet");
  });

  it("the PDF is one or the other, A4 portrait, with its own file name", async () => {
    for (const [version, title] of [
      [chinaDocument(doc), "China price QT-1"],
      [doc, "Quotation QT-1"],
    ] as const) {
      const pdf = await (await buildQuotationPdf(version, { orientation: "portrait" })).text();
      assert.ok(pdf.includes(`/Title (${title})`), title);
      const [, w, h] = pdf.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/) ?? [];
      assert.deepEqual([Math.round(Number(w)), Math.round(Number(h))], [595, 842], "A4 portrait");
    }
    assert.equal(quoteFileName("QT-1", "Kamala Fittings", "2026-11-02", "pdf", "CHINA"), "Kamala_Fittings_2026-11-02_CHINA.pdf");
    assert.equal(quoteFileName("QT-1", "Kamala Fittings", "2026-11-02", "pdf"), "Kamala_Fittings_2026-11-02.pdf");
  });
});
