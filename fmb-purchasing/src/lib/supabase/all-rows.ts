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

type PageQuery = (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

export async function allRows<T>(page: PageQuery): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
}

/**
 * Ids per request. They travel in the URL, which will not carry a year of
 * expense ids in one go.
 */
export const ID_CHUNK = 150;

/**
 * Every row belonging to a list of ids — the lines of a period's expenses, say.
 *
 * Two limits meet here, and each has cost a report rows before: the id list is
 * sent a slice at a time because it rides in the URL, and each slice is paged
 * because one slice of expenses can hold far more than a thousand lines. The
 * All expenses ledger once did the first and not the second, and dropped lines
 * without a word. Slices are requested together; rows come back in id-slice
 * order.
 */
export async function allRowsForIds<T>(
  ids: string[],
  query: (ids: string[], from: number, to: number) => ReturnType<PageQuery>,
  chunkSize = ID_CHUNK
): Promise<T[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += chunkSize) chunks.push(ids.slice(i, i + chunkSize));
  const results = await Promise.all(chunks.map((slice) => allRows<T>((from, to) => query(slice, from, to))));
  return results.flat();
}
