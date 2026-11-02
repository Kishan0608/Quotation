import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import { blankLine } from "@/components/quotation/line-utils";
import { computeTotals, isBlankLine, lineAmount, lineNet, lineWeight } from "./calc";
import { buildQuotationWorkbook } from "./export-excel";
import type { CompanyInfo, QuoteHeader, QuoteLine } from "./types";

const line = (over: Partial<QuoteLine>): QuoteLine => ({ ...blankLine(0), description: "2\"XSCH40 TEE", qty: 10, unit_weight_kg: 0.9, unit_price: 5, ...over });
const header = { adjustments: [], exchange_rate: 12 } as Pick<QuoteHeader, "adjustments" | "exchange_rate">;
const fullHeader = { adjustments: [], exchange_rate: 12, currency: "INR", sheet_names: ["Quotation"], extra_columns: [], hidden_columns: [], column_titles: {}, customer_name: "Test", notes: "", terms: "" } as unknown as QuoteHeader;
const company = { company_name: "Co", base_currency: "CNY", signature_image: null } as unknown as CompanyInfo;

describe("values typed over Total KG / Total Amount / Final Total", () => {
  it("replace the calculation; without them it is calculated", () => {
    const calc = line({});
    assert.equal(lineWeight(calc), 9);
    assert.equal(lineAmount(calc), 50);
    assert.equal(lineNet(calc), 50);
    const typed = line({ overrides: { total_weight: 8.5, amount: 48 } });
    assert.equal(lineWeight(typed), 8.5);
    assert.equal(lineAmount(typed), 48);
    assert.equal(lineNet(typed), 48, "Final Total follows a typed Total Amount");
    assert.equal(lineNet(line({ overrides: { amount: 48, net: 45 } })), 45);
  });

  it("count in the quotation totals", () => {
    const t = computeTotals([line({ overrides: { net: 45, total_weight: 8 } }), line({})], header);
    assert.equal(t.totalWeight, 17);
    assert.equal(t.grossAmount, 100);
    assert.equal(t.baseSubtotal, 95);
    assert.equal(t.subtotal, 1140);
  });

  it("a row with only a typed total is not empty", () => {
    assert.equal(isBlankLine({ ...blankLine(0), overrides: { amount: 10 } }), false);
  });

  it("go into the Excel download as values, and the item table has filter buttons", async () => {
    const lines = [line({ overrides: { amount: 48 } }), line({ description: "4\"XSCH40 TEE" })];
    const buffer = await buildQuotationWorkbook({ quoteNo: "QT-1", preparedBy: null, header: fullHeader, lines, totals: computeTotals(lines, fullHeader), company });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.worksheets[0];
    assert.ok(ws.autoFilter, "autofilter set");
    const values: unknown[] = [];
    ws.eachRow((row) => row.eachCell((cell) => values.push(cell.value)));
    assert.ok(values.includes(48), "the typed Total Amount is a plain value");
  });
});

describe("the TOTAL row adds up RMB/PCS too", () => {
  // The user's China prices (screenshot, 2026-11-02): 116.60 in all.
  const lines = [5.7, 3.6, 4.9, 2.8, 4.1, 8, 13.2, 5, 8.5, 10.5, 18, 8.1, 9.5, 14.7].map((p) => line({ unit_price: p }));

  it("on the sheet, and as a SUM formula in the Excel download", async () => {
    const totals = computeTotals(lines, fullHeader);
    assert.equal(totals.totalPrice, 116.6);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildQuotationWorkbook({ quoteNo: "QT-1", preparedBy: null, header: fullHeader, lines, totals, company }));
    const sums: unknown[] = [];
    wb.worksheets[0].eachRow((row) => row.eachCell((cell) => {
      const v = cell.value as { formula?: string; result?: unknown } | null;
      if (v && typeof v === "object" && v.formula?.startsWith("SUM(")) sums.push(v.result);
    }));
    assert.ok(sums.includes(116.6), `a SUM of the RMB/PCS column in the TOTAL row (sums: ${sums.join(", ")})`);
  });
});
