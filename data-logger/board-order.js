// The order of the Boards list, which can be dragged and is remembered in this browser by board
// ID, so a board that reconnects (or the page reloaded) comes back in its place. Pure functions
// only, so tests/dashboard/board-order.test.mjs can run them in Node.

/**
 * `items` (as listed now) sorted by `order`, a list of IDs (`idOf(item)`): those it names in its
 * order, the rest after, as they were.
 */
export function sortByOrder(items, order, idOf = (item) => item) {
  const rank = new Map(order.map((id, i) => [id, i]));
  return items
    .map((item, i) => ({ item, i, rank: rank.get(idOf(item)) ?? Infinity }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map(({ item }) => item);
}

/**
 * The order after dragging `id` to sit before `beforeId` (null: last) in the list as shown
 * (`shown`, already sorted). Boards remembered but not shown keep their place after it.
 */
export function moveBoard(order, shown, id, beforeId) {
  const list = shown.filter((each) => each !== id);
  const at = beforeId === null ? list.length : list.indexOf(beforeId);
  list.splice(at < 0 ? list.length : at, 0, id);
  return [...list, ...order.filter((each) => !list.includes(each))];
}

/** A saved order, or [] if it isn't one. */
export function parseSavedOrder(text) {
  try {
    const order = JSON.parse(text);
    return Array.isArray(order) && order.every((id) => typeof id === "string") ? order : [];
  } catch {
    return [];
  }
}
