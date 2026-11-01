import type { Workbook, Worksheet } from "exceljs";
import { cellToValue } from "../inventory/excel-import";
import type { ColumnChoice } from "../import/sheet-columns";
import { customerKey, customerSchema, MAX_CUSTOMER_IMPORT_ROWS, type CustomerInput } from "./schema";

/** What a customer sheet's columns can hold; a city goes into the address. */
export type CustomerField = "name" | "contact_person" | "phone" | "email" | "address" | "city" | "note";
export type CustomerColumns = ColumnChoice<CustomerField>;

export type CustomerImportRow = { row: number; sheet: string; data: CustomerInput };
export type CustomerImportResult = {
  sheetName: string;
  rows: CustomerImportRow[];
  issues: { row: number; message: string }[];
  truncated: boolean;
  /** The columns read on each sheet. */
  columns: CustomerColumns[];
};

// Header text -> field; for each header the first rule whose field is still free wins, so in
// "COMPANY NAME | PARTY NAME" the company is the customer and the party the contact person.
const HEADER_RULES: [CustomerField, RegExp][] = [
  ["name", /^(customer(\s*\/\s*company)?|customer\s*name|company(\s*name)?|name|party(\s*name)?|client(\s*name)?|firm(\s*name)?|buyer(\s*name)?)$/i],
  ["contact_person", /^(contact(\s*person|\s*name)?|person|owner|party(\s*name)?|name|concerned\s*person)$/i],
  ["phone", /^(phone|mobile|mob\.?|cell|tel(ephone)?|whats\s*app|contact\s*no\.?|(phone|mobile|mob\.?|contact)\s*(no\.?|number|nos?\.?))$/i],
  ["email", /^(e-?mail(\s*id)?|mail(\s*id)?)$/i],
  ["address", /^(address|addr\.?|location|full\s*address)$/i],
  ["city", /^(city|town|place|station|district|area)$/i],
  ["note", /^(note|notes|remark|remarks)$/i],
];

const text = (v: unknown) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
/** "SI.NO:" -> "SI.NO", "PARTY NAME:" -> "PARTY NAME". */
const headerText = (v: unknown) => text(v).replace(/[:.\s]+$/, "");

function detectSheet(ws: Worksheet): CustomerColumns | null {
  for (let r = 1; r <= Math.min(ws.rowCount, 15); r++) {
    const columns: Partial<Record<CustomerField, number>> = {};
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
      const header = headerText(cellToValue(cell.value));
      for (const [field, re] of HEADER_RULES) {
        if (columns[field] == null && re.test(header)) {
          columns[field] = col;
          break;
        }
      }
    });
    if (columns.name != null) return { sheet: ws.name, headerRow: r, columns };
  }
  return null;
}

/** Joins two values once each ("NIKHIL JI / RAJESH SIR"), within the field's length. */
function both(a: string | null, b: string | null, max: number) {
  if (!a || !b) return a ?? b;
  if (a.toLowerCase().split(" / ").includes(b.toLowerCase())) return a;
  const joined = `${a} / ${b}`;
  return joined.length <= max ? joined : a;
}

/**
 * The same customer on two rows (two contacts of one company): contacts, phones and emails are
 * kept together; for the rest a later value fills an empty one.
 */
function combine(a: CustomerInput, b: CustomerInput): CustomerInput {
  return {
    name: a.name,
    contact_person: both(a.contact_person, b.contact_person, 120),
    phone: both(a.phone, b.phone, 60),
    email: both(a.email, b.email, 160),
    address: a.address ?? b.address,
    note: both(a.note, b.note, 500),
  };
}

/** Customers read from several files (or sheets) as one list: the same name is one customer, details combined. */
export function mergeCustomerRows(lists: CustomerImportRow[][]): CustomerImportRow[] {
  const byName = new Map<string, CustomerImportRow>();
  for (const row of lists.flat()) {
    const key = customerKey(row.data.name);
    const earlier = byName.get(key);
    byName.set(key, earlier ? { ...earlier, data: combine(earlier.data, row.data) } : row);
  }
  return [...byName.values()];
}

/** Every visible sheet that has a customer-name column, with the columns the headers say. */
export function detectCustomerColumns(workbook: Workbook): CustomerColumns[] {
  return workbook.worksheets
    .filter((ws) => ws.state !== "hidden" && ws.state !== "veryHidden")
    .map(detectSheet)
    .filter((c): c is CustomerColumns => c != null);
}

/**
 * Reads the customers from the given columns (default: what the headers say) on every sheet. A
 * name that appears twice - on one sheet or on two - is one customer: later rows fill in or
 * replace the details. A city is added to the address.
 */
export function parseCustomerWorkbook(workbook: Workbook, choice?: CustomerColumns[]): CustomerImportResult {
  const columns = (choice ?? detectCustomerColumns(workbook)).filter((c) => c.columns.name != null);
  if (!columns.length) {
    return { sheetName: "", rows: [], issues: [{ row: 0, message: 'No column with the customer name ("Customer", "Company", "Party name"...) was found.' }], truncated: false, columns: [] };
  }
  const byName = new Map<string, CustomerImportRow>();
  const issues: CustomerImportResult["issues"] = [];
  let truncated = false;
  for (const sheet of columns) {
    const ws = workbook.getWorksheet(sheet.sheet);
    if (!ws) continue;
    for (let r = sheet.headerRow + 1; r <= ws.rowCount && !truncated; r++) {
      const row = ws.getRow(r);
      const get = (f: CustomerField) => {
        const c = sheet.columns[f];
        return c ? text(cellToValue(row.getCell(c).value)) || null : null;
      };
      const name = get("name");
      // A name has letters: a number there is a serial, a total or another table under the list.
      if (!name || !/\p{L}/u.test(name)) continue;
      if (byName.size >= MAX_CUSTOMER_IMPORT_ROWS) {
        truncated = true;
        break;
      }
      const address = [get("address"), get("city")].filter((v, i, all) => v && all.findIndex((o) => o?.toLowerCase() === v.toLowerCase()) === i).join(", ") || null;
      const parsed = customerSchema.safeParse({
        name,
        contact_person: get("contact_person"),
        phone: get("phone"),
        email: get("email"),
        address,
        note: get("note"),
      });
      if (!parsed.success) {
        issues.push({ row: r, message: `${sheet.sheet}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` });
        continue;
      }
      const key = customerKey(parsed.data.name);
      const earlier = byName.get(key);
      const data = earlier ? combine(earlier.data, parsed.data) : parsed.data;
      byName.set(key, { row: earlier?.row ?? r, sheet: earlier?.sheet ?? sheet.sheet, data });
    }
  }
  return { sheetName: columns.map((c) => c.sheet).join(", "), rows: [...byName.values()], issues, truncated, columns };
}
