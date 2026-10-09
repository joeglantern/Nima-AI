/**
 * Cursor pagination.
 *
 * A cursor is an opaque base64 string holding the sort key and the id of the
 * last row. Opaque because the client must never build one by hand, and
 * because the shape changes per list without breaking anyone.
 */

export interface Cursor {
  /** ISO timestamp, numeric score, or whatever the list sorts by. */
  key: string;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.key}|${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(value: string | undefined): Cursor | null {
  if (!value) return null;

  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    const separator = decoded.lastIndexOf('|');
    if (separator < 1) return null;

    return {
      key: decoded.slice(0, separator),
      id: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

/**
 * Take one more row than asked for, then use the extra row to decide whether
 * there is a next page. Avoids a second count query.
 */
export function page<T>(rows: T[], limit: number, toCursor: (row: T) => Cursor) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);

  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(toCursor(last)) : null,
  };
}
