import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blankLine } from "@/components/quotation/line-utils";
import { sortLines } from "./line-order";
import type { QuoteLine } from "./types";

const line = (description: string, remarks = ""): QuoteLine => ({ ...blankLine(0), description, remarks, qty: 1 });
const names = (lines: QuoteLine[]) => sortLines(lines).map((l) => l.description);

describe("standard order of a quotation's lines", () => {
  it("B / C class by size (B before C), then SCH40 by size, SCH80 by size, eccentric then concentric reducers, tees last", () => {
    const lines = [
      line('2"XSCH40 TEE'),
      line('2"XSCH80'),
      line('4"X2"XSCH40 REDUCER', "CONCENTRIC"),
      line("60X4MM", "145MM, C CLASS"),
      line('1"XSCH40'),
      line("33X3MM", "80MM, C CLASS"),
      line('4"X3"XSCH40 REDUCER', "ECCENTRIC"),
      line("60X2.5MM", "145MM, B CLASS"),
      line('1"XSCH80'),
      line('2"XSCH40'),
      line("33X2.5MM", "80MM, B CLASS"),
    ];
    assert.deepEqual(names(lines), [
      "33X2.5MM",
      "33X3MM",
      "60X2.5MM",
      "60X4MM",
      '1"XSCH40',
      '2"XSCH40',
      '1"XSCH80',
      '2"XSCH80',
      '4"X3"XSCH40 REDUCER',
      '4"X2"XSCH40 REDUCER',
      '2"XSCH40 TEE',
    ]);
  });

  it("the customer's own writing: 1’’ B/2.5 MM before 1’’ C/3.2 MM, SL/40 is SCH40", () => {
    const lines = [line("1.1/2’’ SL/40"), line("1’’ C/3.2 MM"), line("1’’ SL/40"), line("1’’ B/2.5 MM")];
    assert.deepEqual(names(lines), ["1’’ B/2.5 MM", "1’’ C/3.2 MM", "1’’ SL/40", "1.1/2’’ SL/40"]);
  });

  it("STD sorts with SCH40 and XS with SCH80; SCH20 comes before SCH40, SCH160 after SCH80", () => {
    const lines = [line('12"XSTD'), line('3"XSCH160'), line('8"XSCH20 90°'), line('2"XSCHXS 90°'), line('10"XSCH80'), line('1/2"XSCH40'), line('3"XSCH80')];
    assert.deepEqual(names(lines), ['8"XSCH20 90°', '1/2"XSCH40', '12"XSTD', '2"XSCHXS 90°', '3"XSCH80', '10"XSCH80', '3"XSCH160']);
  });

  it("1D, 45° and 180° elbows and bends after the 90° elbows; caps and flanges after tees; other lines last as they were, empty rows at the end", () => {
    const lines = [
      blankLine(0),
      line("Packing charges"),
      line('2"XSCH40 CAP'),
      line('2"XSCH40 TEE'),
      line('2"XSCH40 45°'),
      line('3"XSCH40 3D BEND'),
      line('2"XSCH40 180°'),
      line('2"XSCH40 1D'),
      line('24" SORF Flange CL300 Q235 ASME B16.5', "FLANGE"),
      line("Test certificate"),
      line('2"XSCH40'),
    ];
    assert.deepEqual(names(lines), [
      '2"XSCH40',
      '2"XSCH40 1D',
      '2"XSCH40 45°',
      '2"XSCH40 180°',
      '3"XSCH40 3D BEND',
      '2"XSCH40 TEE',
      '2"XSCH40 CAP',
      '24" SORF Flange CL300 Q235 ASME B16.5',
      "Packing charges",
      "Test certificate",
      "",
    ]);
  });

  it("equal tees first, then the branch from large to small", () => {
    const lines = [line('2"X1/2"XSCH40 TEE'), line('2"XSCH40 TEE'), line('2"X11/2"XSCH40 TEE'), line('1"XSCH40 TEE'), line('2"X1"XSCH40 TEE')];
    assert.deepEqual(names(lines), ['1"XSCH40 TEE', '2"XSCH40 TEE', '2"X11/2"XSCH40 TEE', '2"X1"XSCH40 TEE', '2"X1/2"XSCH40 TEE']);
  });

  it("inventory names written other ways: an angle is not a size, an oil pipe item is an elbow, ECCENTRIC as the length makes a reducer", () => {
    const lines = [
      line('ECC Reducer 30"X24"-8 mm x 6.35mm', "ECCENTRIC"),
      line('90° Elbow LR 30"X8 mm', "Standard"),
      line('3"X11/2"X4MM', "ECCENTRIC"),
      line("114XSCH40(OIL PIPE)", "Standard"),
      line('6"XSCH40', "Standard"),
      line('2"XSCH40', "Standard"),
      line("219X5MM", "560MM"),
      line('3"XSTDX2"XSCHXS REDUCER WPL6', "CONCENTRIC"),
    ];
    assert.deepEqual(names(lines), [
      "219X5MM",
      '90° Elbow LR 30"X8 mm',
      '2"XSCH40',
      "114XSCH40(OIL PIPE)",
      '6"XSCH40',
      '3"X11/2"X4MM',
      'ECC Reducer 30"X24"-8 mm x 6.35mm',
      '3"XSTDX2"XSCHXS REDUCER WPL6',
    ]);
  });

  it("already in order: the same lines back; sorting twice changes nothing", () => {
    const lines = [line("33X2.5MM"), line('1"XSCH40'), line('2"XSCH40 TEE')];
    assert.equal(sortLines(lines), lines);
    const once = sortLines([line('2"XSCH40 TEE'), line("33X2.5MM"), line('1"XSCH40')]);
    assert.equal(sortLines(once), once);
  });
});
