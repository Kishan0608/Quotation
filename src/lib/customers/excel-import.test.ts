import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import { fillGaps } from "../import/sheet-columns";
import { parseCustomerWorkbook } from "./excel-import";

function book(rows: (string | number | null)[][], more: (string | number | null)[][] = []) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  for (const r of rows) ws.addRow(r);
  if (more.length) {
    const ws2 = wb.addWorksheet("Sheet2");
    for (const r of more) ws2.addRow(r);
  }
  return wb;
}

describe("parseCustomerWorkbook", () => {
  it("reads the export's own columns", () => {
    const r = parseCustomerWorkbook(
      book([
        ["CUSTOMER / COMPANY", "CONTACT PERSON", "PHONE", "EMAIL", "ADDRESS", "NOTE"],
        ["Royal Tube Fittings LLP", "Raj", "9876543210", "raj@royal.in", "Mumbai", "GST 27AB"],
      ]),
    );
    assert.equal(r.rows.length, 1);
    assert.deepEqual(r.rows[0].data, { name: "Royal Tube Fittings LLP", contact_person: "Raj", phone: "9876543210", email: "raj@royal.in", address: "Mumbai", note: "GST 27AB" });
  });

  it("finds other header names in any order, below a title row", () => {
    const r = parseCustomerWorkbook(
      book([
        ["MY PARTY LIST"],
        ["Mobile No", "Party Name", "Address"],
        [9123456789, "Deepak Pipe Fitting", "Ahmedabad"],
        [null, "", "skipped: no name"],
      ]),
    );
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].data.name, "Deepak Pipe Fitting");
    assert.equal(r.rows[0].data.phone, "9123456789");
    assert.equal(r.rows[0].data.address, "Ahmedabad");
    assert.equal(r.rows[0].data.contact_person, null);
  });

  it("one customer for a name written twice; the later row fills in", () => {
    const r = parseCustomerWorkbook(
      book([
        ["Customer", "Phone", "Email"],
        ["Naveen Steel", "111", null],
        ["NAVEEN  steel", null, "n@steel.in"],
      ]),
    );
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].data.phone, "111");
    assert.equal(r.rows[0].data.email, "n@steel.in");
  });

  it("says so when there is no name column", () => {
    const r = parseCustomerWorkbook(book([["Phone", "Email"], ["1", "a@b.c"]]));
    assert.equal(r.rows.length, 0);
    assert.match(r.issues[0].message, /Customer/);
  });

  it("an MIS-style list: company + party + city, every sheet, follow-up tables below skipped, two contacts kept", () => {
    const head = ["SI.NO:", "CITY", "COMPANY NAME", "PARTY NAME", "MOBILE NO", "LAST YEAR TOTAL", "FOLLOW UP BY", "AUGUST"];
    const r = parseCustomerWorkbook(
      book(
        [head, [1, "AHMEDABAD", "MAYANK STEEL", "MAYANK SIR", 8511603312, 29, "RAJ SIR", 2], [null, null, null, null, null, 443], [], [null, "DUBAI", 4, null, "RAJ JI"]],
        [head, [6, "AHMEDABAD", "DEEPAK PIPE FITTING", "NIKHIL JI", 9374117171], [7, "AHMEDABAD", "DEEPAK PIPE FITTING", "RAJESH SIR", 9099728954]],
      ),
    );
    assert.equal(r.rows.length, 2);
    assert.deepEqual(r.rows[0].data, { name: "MAYANK STEEL", contact_person: "MAYANK SIR", phone: "8511603312", email: null, address: "AHMEDABAD", note: null });
    assert.equal(r.rows[1].sheet, "Sheet2");
    assert.equal(r.rows[1].data.contact_person, "NIKHIL JI / RAJESH SIR");
    assert.equal(r.rows[1].data.phone, "9374117171 / 9099728954");
  });

  it("the AI fills only columns the headings missed", () => {
    const merged = fillGaps({ sheet: "S", headerRow: 1, columns: { name: 3, phone: 5 } }, { sheet: "S", headerRow: 1, columns: { name: 2, phone: 5, city: 2, contact_person: 4 } });
    assert.deepEqual(merged?.columns, { name: 3, phone: 5, city: 2, contact_person: 4 });
    assert.equal(fillGaps(null, { sheet: "S", headerRow: 2, columns: { name: 1 } })?.headerRow, 2);
  });
});
