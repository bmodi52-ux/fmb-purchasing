/**
 * Every row a query returns, a page at a time.
 *
 * Supabase caps a response at 1,000 rows and says nothing when it does: past
 * that, a query simply returns the first thousand. Anything that has to see the
 * whole Pricelist — matching a receipt against it, offering every item to
 * price — pages through it instead. The query must be ordered by something
 * unique, or a row can land on two pages or none.
 */
const PAGE_SIZE = 1000;

export async function allRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
}
