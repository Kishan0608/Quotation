import "server-only";

type Paged = { page: number; pageSize: number };

/**
 * A list page, or the last page that has rows when the one asked for is past the end (its last
 * row was just deleted, or an old link): no empty page or "range not satisfiable" error.
 */
export async function pageOrLast<F extends Paged, L extends { rows: unknown[]; total: number }>(filters: F, load: (f: F) => Promise<L>): Promise<{ filters: F; list: L }> {
  const list = await load(filters);
  if (filters.page <= 1 || list.rows.length) return { filters, list };
  const first = await load({ ...filters, page: 1 });
  const last = { ...filters, page: Math.max(1, Math.ceil(first.total / filters.pageSize)) };
  return { filters: last, list: last.page === 1 ? first : await load(last) };
}
