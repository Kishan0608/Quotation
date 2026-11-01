export const CUSTOMER_PAGE_SIZES = [25, 50, 100, 200] as const;

export type CustomerFilters = { q: string; page: number; pageSize: number };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Whitelists every URL parameter before it gets near a query. */
export function parseCustomerFilters(params: Record<string, string | string[] | undefined>): CustomerFilters {
  const page = Number(first(params.page));
  const pageSize = Number(first(params.size));
  return {
    q: first(params.q).trim().slice(0, 100),
    page: Number.isInteger(page) && page > 0 ? Math.min(page, 10_000) : 1,
    pageSize: (CUSTOMER_PAGE_SIZES as readonly number[]).includes(pageSize) ? pageSize : 50,
  };
}
