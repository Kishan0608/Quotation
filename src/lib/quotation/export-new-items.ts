type NewItem = { description: string; qty: number; length: string };

/** One row per item (same name ignoring spaces, same length), quantities added. */
export function mergeNewItems(items: NewItem[]): NewItem[] {
  const byKey = new Map<string, NewItem>();
  for (const item of items) {
    const description = item.description.trim();
    if (!description) continue;
    const length = item.length.trim();
    const key = `${description.toUpperCase().replace(/\s+/g, "")}|${length.toUpperCase()}`;
    const seen = byKey.get(key);
    if (seen) seen.qty += item.qty;
    else byKey.set(key, { description, qty: item.qty, length });
  }
  return [...byKey.values()];
}

/**
 * The items a quotation needs that are not in the inventory, as an Excel sheet to send to the
 * supplier for prices. It has the supplier sheet's columns, so the filled-in file goes straight
 * back in through Inventory → Import Excel. The columns the supplier fills are yellow.
 */
export async function buildNewItemsWorkbook(items: NewItem[], title: string): Promise<ArrayBuffer> {
  // CJS in Node, UMD bundle in the browser: the namespace may or may not sit under `default`.
  const mod = (await import("exceljs")) as unknown as typeof import("exceljs") & { default?: typeof import("exceljs") };
  const ExcelJS = mod.default ?? mod;

  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const ws = wb.addWorksheet("New items", { views: [{ state: "frozen", ySplit: 2 }] });
  const headers: [string, number, boolean][] = [
    ["ITEMS", 38, false],
    ["WT IN KGS", 12, true],
    ["RMB/PCS", 12, true],
    ["QTY", 10, false],
    ["ACTUAL WEIGHT", 18, true],
    ["NOTE / LENGTH", 22, false],
  ];
  ws.columns = headers.map(([, width]) => ({ width }));

  ws.mergeCells(1, 1, 1, headers.length);
  const top = ws.getCell(1, 1);
  top.value = title;
  top.font = { bold: true, size: 13 };
  top.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 24;

  const yellow = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } } as const;
  const thin = { style: "thin", color: { argb: "FFBFBFBF" } } as const;
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const head = ws.getRow(2);
  headers.forEach(([label, , fill], i) => {
    const cell = head.getCell(i + 1);
    cell.value = label;
    cell.font = { bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = border;
    cell.fill = fill ? { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFD966" } } : { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
  });
  head.height = 20;

  items.forEach((item, idx) => {
    const row = ws.getRow(idx + 3);
    row.values = [item.description, null, null, item.qty || null, null, item.length || null];
    headers.forEach(([, , fill], i) => {
      const cell = row.getCell(i + 1);
      cell.border = border;
      if (fill) cell.fill = yellow;
    });
    row.getCell(2).numFmt = "0.000";
    row.getCell(3).numFmt = "#,##0.00";
    row.getCell(4).numFmt = "#,##0";
  });

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
