/** URL sort key -> column. "added" keeps the order items were added / imported (Excel order). */
export const INVENTORY_SORTS = {
  added: "created_at",
  description: "description",
  weight: "weight_kg",
  price: "unit_price",
  quantity: "stock_qty",
  amount: "total_amount",
} as const;
export type InventorySort = keyof typeof INVENTORY_SORTS;
export const DEFAULT_SORT: InventorySort = "added";

export const PAGE_SIZES = [25, 50, 100, 200] as const;

export type InventoryFilters = {
  q: string;
  sort: InventorySort;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Whitelists every URL parameter before it gets near a query. */
export function parseInventoryFilters(params: Record<string, string | string[] | undefined>): InventoryFilters {
  const sort = first(params.sort) as InventorySort;
  const pageSize = Number(first(params.size));
  const page = Number(first(params.page));
  return {
    q: first(params.q).trim().slice(0, 100),
    sort: sort in INVENTORY_SORTS ? sort : DEFAULT_SORT,
    dir: first(params.dir) === "desc" ? "desc" : "asc",
    page: Number.isInteger(page) && page > 0 ? Math.min(page, 10_000) : 1,
    pageSize: (PAGE_SIZES as readonly number[]).includes(pageSize) ? pageSize : 50,
  };
}
