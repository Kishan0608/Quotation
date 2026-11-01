import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PickerItem } from "@/lib/inventory/types";
import { buildCatalog, CHUNK_LINES, itemNps, sizeTable, systemInstruction, textRequests } from "./ai-prompt";

const item = (id: string, description: string, note: string | null = null): PickerItem => ({
  id,
  description,
  weight_kg: null,
  unit_price: null,
  stock_qty: 0,
  note,
  actual_weight: null,
});

describe("itemNps", () => {
  it("reads the nominal size of mm and inch names", () => {
    assert.equal(itemNps("114X3.5MM"), "4");
    assert.equal(itemNps("76X3MM"), "2 1/2");
    assert.equal(itemNps('21/2"XSCH40'), "2 1/2");
    assert.equal(itemNps('24" SORF Flange CL300 Q235 ASME B16.5'), "24");
    assert.equal(itemNps("BLANK RAISE FACE BLRF 16\" CL150 FLANGE"), null);
  });
});

describe("buildCatalog", () => {
  it("numbers every item once, smallest size first, with its size and note", () => {
    const inventory = [item("a", '12"XSTD CAP'), item("b", "114X3.5MM", "300MM"), item("c", "PLAIN THING"), item("d", "33X2.5MM", "80MM")];
    const catalog = buildCatalog(inventory);
    assert.deepEqual(
      catalog.items.map((i) => i.id),
      ["d", "b", "a", "c"],
    );
    assert.deepEqual(catalog.text.split("\n"), ['1|1"|33X2.5MM|80MM', '2|4"|114X3.5MM|300MM', '3|12"|12"XSTD CAP|', "4|-|PLAIN THING|"]);
  });

  it("keeps the | separator out of item text", () => {
    const catalog = buildCatalog([item("a", "A|B\nC", "x|y")]);
    assert.equal(catalog.text, "1|-|A B C|x y");
  });

  it("puts the whole inventory and the size table in the instructions", () => {
    const catalog = buildCatalog([item("a", "114X3.5MM", "300MM")]);
    const system = systemInstruction(catalog);
    assert.ok(system.includes('1|4"|114X3.5MM|300MM'));
    assert.ok(system.includes(sizeTable()));
  });
});

describe("sizeTable", () => {
  it("links NPS, DN (NB) and OD", () => {
    const rows = sizeTable().split("\n");
    assert.ok(rows.some((r) => r.startsWith('20"|500|508|')));
    assert.ok(rows.some((r) => r.startsWith('4"|100|114.3|')));
  });
});

describe("textRequests", () => {
  it("sends a short document in one request", () => {
    const requests = textRequests(["a 1", "b 2"]);
    assert.equal(requests.length, 1);
    assert.ok(requests[0].endsWith("a 1\nb 2"));
  });

  it("splits a long list into parts, each later part with the document's headings", () => {
    const lines = ["TITLE", "ITEMS | QTY", ...Array.from({ length: 98 }, (_, i) => `row ${i + 1}`)];
    const requests = textRequests(lines);
    assert.equal(requests.length, Math.ceil(lines.length / CHUNK_LINES));
    assert.ok(requests[1].includes("TITLE\nITEMS | QTY"));
    assert.ok(requests[1].includes(`row ${CHUNK_LINES - 1}`));
    assert.ok(requests.at(-1)!.includes("row 98"));
    const read = requests.map((r) => r.split("The lines to read:\n").at(-1)!);
    assert.equal(read.join("\n").split("\n").filter((l) => l.startsWith("row ")).length, 98);
  });

  it("gives a later part the last block heading above it", () => {
    const rows = (from: number, n: number) => Array.from({ length: n }, (_, i) => `${from + i} 2" B/3 MM`);
    // Sized from the part length: the MS ELBOW block starts in part 1 and runs on into part 2.
    const lines = ["PURCHASE ORDER 12", "SL ITEM QTY", "MS TEE", ...rows(1, CHUNK_LINES - 10), "MS ELBOW", ...rows(CHUNK_LINES, CHUNK_LINES * 2)];
    const requests = textRequests(lines);
    assert.ok(requests.length > 1);
    assert.ok(requests[1].includes("last heading above this part: MS ELBOW"));
  });
});
