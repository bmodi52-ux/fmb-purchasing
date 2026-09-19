/**
 * The order a person has put a table's columns in (#56).
 *
 * Saved in the same preference as which columns show: visible_columns is a
 * list, and it is now kept in the order chosen rather than the order the page
 * defines. Hidden columns aren't saved, so their place is worked out again —
 * each goes back beside the column it follows on the page — which means a
 * column shown again turns up where anyone would expect it, not at the end.
 */
export function mergeColumnOrder(allKeys: string[], savedVisible: string[]): string[] {
  const known = new Set(allKeys);
  const order: string[] = [];
  for (const key of savedVisible) {
    if (known.has(key) && !order.includes(key)) order.push(key);
  }

  allKeys.forEach((key, index) => {
    if (order.includes(key)) return;
    // After the nearest column that comes before it on the page and is
    // already placed; first of all if there is none.
    let at = 0;
    for (let i = index - 1; i >= 0; i--) {
      const placed = order.indexOf(allKeys[i]);
      if (placed !== -1) {
        at = placed + 1;
        break;
      }
    }
    order.splice(at, 0, key);
  });

  return order;
}

/** `order` with `key` moved to `toIndex`, clamped to the ends. */
export function moveColumn(order: string[], key: string, toIndex: number): string[] {
  const from = order.indexOf(key);
  if (from === -1) return order;
  const next = order.filter((k) => k !== key);
  const to = Math.max(0, Math.min(toIndex, next.length));
  next.splice(to, 0, key);
  return next;
}
