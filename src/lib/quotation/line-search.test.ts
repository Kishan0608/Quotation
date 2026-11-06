import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blankLine } from "@/components/quotation/line-utils";
import { NO_SEARCH, searchLines, sortFound } from "./line-search";
import type { QuoteLine } from "./types";

const line = (description: string, china: number, customer: number, remarks = ""): QuoteLine => ({ ...blankLine(0), description, base_price: china, unit_price: customer, qty: 10, remarks });
const lines = [
  line('2"XSCH40', 2.8, 3.5, "Standard"),
  line("33X2.5MM", 1.2, 1.5, "80MM, B CLASS"),
  blankLine(0),
  line('4"X3"XSCH40 REDUCER', 9.5, 11.88, "CONCENTRIC"),
  line('6"XSCH40 TEE', 18, 22.5),
];
const items = (s: Partial<typeof NO_SEARCH>) => searchLines(lines, { ...NO_SEARCH, ...s }).map((f) => f.line.description);

describe("search and range above the sheet", () => {
  it("text: every word, ignoring case, quote marks and spaces; notes count too", () => {
    assert.deepEqual(items({ text: "2 sch40" }), ['2"XSCH40']);
    assert.deepEqual(items({ text: "reducer" }), ['4"X3"XSCH40 REDUCER']);
    assert.deepEqual(items({ text: "b class" }), ["33X2.5MM"]);
  });

  it("size range in inches, written any way (1, 1/2, 2\"); 33X2.5MM is 1\"", () => {
    assert.deepEqual(items({ field: "size", from: "1", to: '4"' }), ['2"XSCH40', "33X2.5MM", '4"X3"XSCH40 REDUCER']);
    assert.deepEqual(items({ field: "size", from: "1/2", to: "1 1/2" }), ["33X2.5MM"]);
    assert.deepEqual(items({ field: "size", from: "5" }), ['6"XSCH40 TEE'], "only a lower end");
  });

  it("price ranges, row numbers as the sheet shows them, ends swapped if typed backwards", () => {
    assert.deepEqual(items({ field: "china", from: "2", to: "10" }), ['2"XSCH40', '4"X3"XSCH40 REDUCER']);
    assert.deepEqual(items({ field: "customer", to: "4" }), ['2"XSCH40', "33X2.5MM"]);
    assert.deepEqual(items({ field: "row", from: "5", to: "3" }), ["33X2.5MM", '4"X3"XSCH40 REDUCER'], "rows 3 to 5 (row 2 is the first item)");
  });

  it("text and range together; sorting small or large first", () => {
    assert.deepEqual(items({ text: "sch40", field: "size", from: "3" }), ['4"X3"XSCH40 REDUCER', '6"XSCH40 TEE']);
    const found = searchLines(lines, NO_SEARCH);
    assert.deepEqual(sortFound(found, "china", "desc").map((f) => f.line.base_price), [18, 9.5, 2.8, 1.2]);
    assert.deepEqual(sortFound(found, "size", "asc").map((f) => f.inches), [1, 2, 4, 6]);
  });
});

describe("searching the inventory", () => {
  const inventory = [
    line('6"XSCH40 TEE', 18, 22.5),
    line("48X2.5MM", 0.9, 1.1, "115MM"),
    line('2"XSCH80', 4, 5),
    line('3"X2"XSCH40 REDUCER', 5.7, 7.1, "CONCENTRIC"),
    line("114X3.5MM", 6.7, 8.4, "300MM"),
    line('11/2"XSCH40', 2, 2.5, "Standard"),
    line("219X5MM", 30, 37.5, "560MM"),
    line('4"XSCH40 45°', 12, 15),
  ];
  const find = (s: Partial<typeof NO_SEARCH>, sort: "standard" | "size" = "standard") =>
    sortFound(searchLines(inventory, { ...NO_SEARCH, ...s }), sort, "asc").map((f) => f.line.description);

  it("1 1/2 to 5 inch, in the pipe-chart order (B / C class, SCH40, SCH80, then 45°, reducers, tees)", () => {
    assert.deepEqual(find({ field: "size", from: "11/2", to: "5" }), ["48X2.5MM", "114X3.5MM", '11/2"XSCH40', '2"XSCH80', '4"XSCH40 45°', '3"X2"XSCH40 REDUCER']);
  });

  it("only B / C class (wall in mm), only one kind, or both with a range", () => {
    assert.deepEqual(find({ wall: "class" }), ["48X2.5MM", "114X3.5MM", "219X5MM"]);
    assert.deepEqual(find({ kind: "TEE" }), ['6"XSCH40 TEE']);
    assert.deepEqual(find({ wall: "sch40", kind: "ELBOW" }), ['11/2"XSCH40']);
    assert.deepEqual(find({ wall: "class", field: "size", from: "2", to: "8" }), ["114X3.5MM", "219X5MM"]);
  });

  it("size in mm (outside diameter): 100 to 250 mm", () => {
    assert.deepEqual(find({ field: "od", from: "100", to: "250mm" }, "size"), ["114X3.5MM", '4"XSCH40 45°', '6"XSCH40 TEE', "219X5MM"]);
  });
});
