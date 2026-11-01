// Word-based search: every word in `query` must appear in some field, any order.
// "maggi noodles" matches "MAGGI ATTA NOODLES". Same rule as backend app/utils/search.py.
export function matchesSearch(query: string | null | undefined, ...fields: unknown[]): boolean {
  const words = (query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fields.map(f => (f == null ? '' : String(f).toLowerCase()));
  return words.every(w => hay.some(h => h.includes(w)));
}
