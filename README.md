# Quotation Panel

Inventory and quotation management for butt-weld pipe fittings, built with **Next.js 16** and **Supabase**.

- **Inventory**: add, edit (inline or in a form), duplicate and delete items; import your supplier loading plan (`.xlsx`) and export to Excel.
- **Inventory** with the same columns as your supplier Excel: Item No., Items, WT IN KGS, RMB/PCS, QTY, TOTAL KG, AMOUNT, LOADING CHARGES, Actual Weight, NOTE (or LENGTH).
- **Pipe size chart** (ASME B36.10 / B36.19): a reference page where NPS, DN and OD are linked. Pick any one and the other two fill in.
- **Quotations in 3 steps**: customer → add items from inventory (search several at once: `D4, D6, A8`) → edit in an Excel-style sheet → download **Excel** (with live formulas) or **PDF**.
- **Automatic pricing**: inventory price × (1 + margin %) × exchange rate. Currency, exchange rate and margin are set once in **Company settings**; discount, freight and tax are set per quotation.
- Generated Excel/PDF files are **never stored**. Only inventory and the small quotation data rows are saved.

---

## 1. Set up the database (Supabase)

Open your Supabase project → **SQL Editor** → *New query*, and run these files **in order**:

| # | File | What it does |
|---|------|--------------|
| 1 | `supabase/migrations/20261019000001_schema.sql` | Tables, roles, row-level security, functions |
| 2 | `supabase/migrations/20261019000002_pipe_chart.sql` | The pipe dimension chart (39 sizes) |
| 3 | `supabase/seed/inventory_loading_plan.sql` | *Optional*: the 202 items from `LOADING PLAN FOR MOTI 2026-10-14.xlsx` |

You can skip step 3 and use **Inventory → Import Excel** in the app instead (same result).

## 2. Configure Supabase Auth

In **Authentication → Sign In / Providers**, turn **off** "Allow new users to sign up". Staff accounts are created by you.

In **Authentication → URL Configuration**:
- Site URL: `http://localhost:3000` (or your real domain)
- Redirect URLs: add `http://localhost:3000/auth/confirm` (and `https://your-domain/auth/confirm` later)

Create your own account in **Authentication → Users → Add user** with *Auto Confirm User* ticked. **The first account becomes Admin.** Everyone added after that starts as Viewer; promote them in the app under **Users & roles**.

## 3. Run the app

```bash
cp .env.example .env.local     # then fill in SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY
npm install
npm run dev                    # http://localhost:3000
```

Production: `npm run build && npm start`. On Vercel or any Node host, set the same three environment variables. Use an `https://` `SITE_URL`.

> Only the **publishable/anon** key is needed. Never put the `service_role`/secret key in this app.

## 4. First steps in the app

1. **Company settings** (admin): company name, address, tax number, bank details, default currency, margin, tax and terms. These print on every quotation.
2. **Inventory → Import Excel**: drop in the loading plan. Columns are matched by their headers (ITEMS NO., ITEMS, WT IN KGS, RMB/PCS, QTY, NOTE) and rows keep the Excel order.
3. **Quotations → New quotation**: fill in the customer, then add items by type + size. They appear in the sheet below, where you can edit any cell.

### Sheet shortcuts
Type to overwrite a cell · **F2** / double-click to edit · **Enter / Tab** move · **Ctrl+C / Ctrl+V** copy and paste blocks to and from Excel · **Ctrl+Z / Ctrl+Y** undo/redo · **Ctrl+S** save. Typing in an empty row adds a new line. A price you type yourself is kept (orange corner) until you press *Reset to automatic price*.

## Roles

| Role | Can do |
|------|--------|
| Admin | Everything, including the size chart, company settings and users |
| Editor | Add/edit/delete inventory; create quotations; edit/delete their **own** quotations |
| Viewer | Read-only inventory, size chart and quotations (can still download Excel/PDF) |

## Security

- Supabase Auth with cookie sessions, refreshed and verified on every request (`src/proxy.ts`). Signed-out users only reach `/login`.
- **Row Level Security on every table.** Roles are enforced inside Postgres, not only in the UI. Deactivated users lose access immediately.
- Every Server Action and API route re-checks the user and validates input with **zod**. Search input is escaped, and sort/filter values are whitelisted.
- Strict **Content-Security-Policy** with a per-request nonce, plus `X-Frame-Options: DENY`, HSTS, `nosniff`, a strict referrer policy and permissions policy.
- Supabase keys are read **server-side only**; the browser never talks to the database directly.
- Quotation numbers, totals, `created_by` and audit fields are set by the database and cannot be forged by the client.
- Login errors don't reveal which emails exist; password reset links can't be used to redirect off-site.

## Project structure

```
src/
  proxy.ts                  session refresh, auth redirects, CSP nonce
  app/login, app/auth       sign in, password reset
  app/(app)/                authenticated pages: dashboard, inventory, quotations, sizes, settings, users, account
  app/api/inventory/        search (item picker) and Excel export
  components/quotation/     builder, Excel-style sheet, item picker, export menu
  lib/pipe/                 pipe chart data, chart data, schedules (size chart page)
  lib/inventory/            Excel import, filters, validation
  lib/quotation/            pricing & totals, Excel and PDF generators, amount in words
  lib/supabase, lib/auth    clients, data access layer, roles
supabase/                   SQL migrations and seed
scripts/generate-seed.ts    rebuilds the SQL seed from the chart and an .xlsx
```

Regenerate the seed SQL from another loading plan: `npm run seed:generate -- "path/to/file.xlsx"`.

## Notes on the data

- The chart follows `chart.pdf`, with standard ASME B36.10M corrections:
  - DN values are filled in where the PDF left them blank (22", 26", 30"…).
  - NPS 34 OD is 864 mm (the PDF says 884).
  - Shifted cells for 40" and 48" are moved to STD/XS.
  - For 56" and 60", the PDF prints the OD in the DN column.
- Admins can edit the chart on the **Pipe size chart** page.
- `标准` in notes is translated to "Standard". Notes that only repeat the type (TEE, CAP…) are dropped.
