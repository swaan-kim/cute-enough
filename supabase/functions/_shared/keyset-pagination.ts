/** Exhaust stable pages without depending on PostgREST's default response cap. */
export async function collectKeysetPages<T extends { id: string; created_at: string }>(
  load: (cursor: T | undefined, size: number) => Promise<T[]>, size = 200,
): Promise<T[]> {
  const result: T[] = [];
  const seen = new Set<string>();
  let cursor: T | undefined;
  for (;;) {
    const page = await load(cursor, size);
    for (const row of page) {
      if (!seen.has(row.id)) { seen.add(row.id); result.push(row); }
    }
    if (page.length < size) return result;
    const next = page[page.length - 1];
    if (cursor?.id === next.id && cursor.created_at === next.created_at) throw new Error('PAGINATION_DID_NOT_ADVANCE');
    cursor = next;
  }
}
