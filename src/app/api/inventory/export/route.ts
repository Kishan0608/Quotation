import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";
import { authorize } from "@/lib/auth/dal";
import { listAllInventory } from "@/lib/data/inventory";
import { todayISO } from "@/lib/format";

/** Streams the (filtered) inventory as .xlsx. Generated on the fly, never stored. */
export async function GET(request: NextRequest) {
  const auth = await authorize("viewer");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  const [{ rows, error }, company] = await Promise.all([
    listAllInventory(auth.supabase, q),
    auth.supabase.from("company_settings").select("company_name, base_currency").maybeSingle(),
  ]);
  if (error) return NextResponse.json({ error: "Could not export inventory." }, { status: 500 });

  const currency = company.data?.base_currency ?? "CNY";
  const wb = new ExcelJS.Workbook();
  wb.creator = company.data?.company_name ?? "Quotation Panel";
  wb.created = new Date();
  const ws = wb.addWorksheet("Inventory", { views: [{ state: "frozen", ySplit: 2 }] });

  // Same columns as the supplier loading plan.
  const headers = [
    ["ITEMS NO.", 11], ["ITEMS", 40], ["WT IN KGS", 11], [`${currency}/PCS`, 12], ["QTY", 10],
    ["TOTAL KG", 12], ["AMOUNT", 14], ["LOADING CHARGES", 13], ["ACTUAL WEIGHT", 22], ["NOTE / LENGTH", 22],
  ] as const;
  ws.columns = headers.map(([, width]) => ({ width }));

  ws.mergeCells(1, 1, 1, headers.length);
  const title = ws.getCell(1, 1);
  title.value = `INVENTORY — ${company.data?.company_name ?? ""} — ${todayISO()}`;
  title.font = { bold: true, size: 14, color: { argb: "FF1E3A8A" } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 26;

  const head = ws.getRow(2);
  headers.forEach(([label], i) => {
    const cell = head.getCell(i + 1);
    cell.value = label;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  head.height = 22;

  rows.forEach((r, idx) => {
    const n = idx + 3;
    const row = ws.getRow(n);
    row.values = [
      r.item_code, r.description, r.weight_kg, r.unit_price, r.stock_qty,
      { formula: `C${n}*E${n}`, result: Number(r.total_weight_kg) }, // TOTAL KG = WT x QTY
      { formula: `D${n}*E${n}`, result: Number(r.total_amount) }, // AMOUNT = PRICE x QTY
      Number(r.loading_charges),
      r.actual_weight,
      r.note,
    ];
    row.getCell(3).numFmt = "0.000";
    row.getCell(4).numFmt = "#,##0.00";
    row.getCell(5).numFmt = "#,##0";
    row.getCell(6).numFmt = "#,##0.000";
    row.getCell(7).numFmt = "#,##0.00";
    row.getCell(8).numFmt = "#,##0.00";
  });

  const last = rows.length + 2;
  const totals = ws.getRow(last + 1);
  totals.getCell(2).value = "TOTAL";
  if (rows.length) {
    totals.getCell(5).value = { formula: `SUM(E3:E${last})`, result: rows.reduce((s, r) => s + Number(r.stock_qty), 0) };
    totals.getCell(6).value = { formula: `SUM(F3:F${last})`, result: rows.reduce((s, r) => s + Number(r.total_weight_kg), 0) };
    totals.getCell(7).value = { formula: `SUM(G3:G${last})`, result: rows.reduce((s, r) => s + Number(r.total_amount), 0) };
    totals.getCell(8).value = { formula: `SUM(H3:H${last})`, result: rows.reduce((s, r) => s + Number(r.loading_charges), 0) };
  }
  totals.font = { bold: true };
  totals.getCell(6).numFmt = "#,##0.000";
  totals.getCell(7).numFmt = "#,##0.00";
  totals.getCell(8).numFmt = "#,##0.00";
  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: headers.length } };

  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="inventory-${todayISO()}.xlsx"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
