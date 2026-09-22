// Supabase caps every request at 1000 rows by default, and `.limit(n)` above
// that silently still returns 1000. Pages through `.range()` until a short
// page comes back. The query must have a stable order (end with `.order("id")`)
// or rows can repeat or go missing between pages.
const PAGE_SIZE = 1000;

type PageResult<T> = { data: T[] | null; error: unknown };

export async function fetchAllPages<T>(page: (from: number, to: number) => PromiseLike<PageResult<T>>): Promise<{ data: T[]; error: unknown }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) return { data: rows, error };
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return { data: rows, error: null };
  }
}
