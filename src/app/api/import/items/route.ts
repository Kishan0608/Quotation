import { NextResponse, type NextRequest } from "next/server";
import { authorize } from "@/lib/auth/dal";
import { readWithAi } from "@/lib/import/ai-reader";
import { extractCandidates, importKind, IMPORT_MAX_BYTES, type Extracted } from "@/lib/import/extract";
import { matchCandidates } from "@/lib/import/match";
import type { PickerItem } from "@/lib/inventory/types";

export const dynamic = "force-dynamic";
// The AI read (up to 80 s for long lists) and, when it fails, reading a photo with OCR can take a while.
export const maxDuration = 120;

const FIELDS = "id, description, weight_kg, unit_price, stock_qty, note, actual_weight";
const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * Import for the quotation: reads an uploaded enquiry list (Excel, CSV, text, PDF or a photo),
 * finds the item lines and matches each one to the inventory. Nothing is saved; the page shows
 * the matches for review before they go on the sheet.
 */
export async function POST(request: NextRequest) {
  const auth = await authorize();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401, headers: NO_STORE });

  let file: File | null = null;
  try {
    const form = await request.formData();
    const f = form.get("file");
    file = f instanceof File ? f : null;
  } catch {
    return NextResponse.json({ error: "Could not read the upload." }, { status: 400, headers: NO_STORE });
  }
  if (!file || file.size === 0) return NextResponse.json({ error: "Choose a file to import." }, { status: 400, headers: NO_STORE });
  if (file.size > IMPORT_MAX_BYTES) return NextResponse.json({ error: "The file is larger than 10 MB." }, { status: 413, headers: NO_STORE });
  const kind = importKind(file.name, file.type);
  if (!kind) {
    return NextResponse.json({ error: "Use an Excel (.xlsx), CSV, text, PDF or image (PNG / JPG) file." }, { status: 415, headers: NO_STORE });
  }

  const { data, error } = await auth.supabase.from("inventory_items").select(FIELDS).order("created_at").limit(10_000);
  if (error) return NextResponse.json({ error: "Could not load the inventory." }, { status: 500, headers: NO_STORE });
  const inventory = (data ?? []) as PickerItem[];
  const buf = Buffer.from(await file.arrayBuffer());

  // The AI reader first; when it isn't set up or fails, the standard reader below reads the file.
  const ai = await readWithAi(buf, kind, file.type, inventory);
  if (ai) {
    return NextResponse.json({ kind, ocr: false, ai: true, rows: ai.rows, text: ai.text.slice(0, 20_000), note: ai.note ?? null }, { headers: NO_STORE });
  }

  let extracted: Extracted;
  try {
    // The reader keeps the OCR read that finds the most inventory items for sure.
    const judge = (c: Parameters<typeof matchCandidates>[0]) => matchCandidates(c, inventory).reduce((s, r) => s + (r.status === "matched" ? 2 : r.status === "check" ? 1 : 0), 0);
    extracted = await extractCandidates(buf, kind, judge);
  } catch (e) {
    console.error("import: could not read file", e);
    return NextResponse.json({ error: "Could not read this file. Check that it isn't damaged or password-protected." }, { status: 422, headers: NO_STORE });
  }

  const rows = matchCandidates(extracted.candidates, inventory);
  return NextResponse.json(
    { kind, ocr: extracted.ocr, rows, text: extracted.text.slice(0, 20_000), note: extracted.note ?? null },
    { headers: NO_STORE },
  );
}
