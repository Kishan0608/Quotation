import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";
import { authorize } from "@/lib/auth/dal";
import { listAllCustomers } from "@/lib/data/customers";
import { todayISO } from "@/lib/format";

/** The (filtered) customer list as .xlsx, in the same columns Import reads. Never stored. */
export async function GET(request: NextRequest) {
  const auth = await authorize();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 });

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  const [{ rows, error }, company] = await Promise.all([
    listAllCustomers(auth.supabase, q),
    auth.supabase.from("company_settings").select("company_name").maybeSingle(),
  ]);
  if (error) return NextResponse.json({ error: "Could not export customers." }, { status: 500 });

  const wb = new ExcelJS.Workbook();
  wb.creator = company.data?.company_name ?? "Quotation Panel";
  wb.created = new Date();
  const ws = wb.addWorksheet("Customers", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: "CUSTOMER / COMPANY", key: "name", width: 36 },
    { header: "CONTACT PERSON", key: "contact_person", width: 22 },
    { header: "PHONE", key: "phone", width: 18 },
    { header: "EMAIL", key: "email", width: 28 },
    { header: "ADDRESS", key: "address", width: 48 },
    { header: "NOTE", key: "note", width: 28 },
  ];
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A8A" } };
  head.alignment = { vertical: "middle" };
  head.height = 20;
  for (const r of rows) ws.addRow({ name: r.name, contact_person: r.contact_person, phone: r.phone, email: r.email, address: r.address, note: r.note });
  ws.getColumn("phone").numFmt = "@";
  ws.getColumn("address").alignment = { wrapText: true, vertical: "top" };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 6 } };

  const buffer = await wb.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="customers-${todayISO()}.xlsx"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
