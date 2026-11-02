// Moving between a dialog's buttons with the arrow keys: which button lies that way. Pure, so
// tests/dashboard/arrow-keys.test.mjs runs it in Node.

const WAYS = {
  ArrowLeft: { ahead: (from, to) => from.left - to.right, near: "top", far: "bottom" },
  ArrowRight: { ahead: (from, to) => to.left - from.right, near: "top", far: "bottom" },
  ArrowUp: { ahead: (from, to) => from.top - to.bottom, near: "left", far: "right" },
  ArrowDown: { ahead: (from, to) => to.top - from.bottom, near: "left", far: "right" },
};
const SIDEWAYS_COST = 2; // a step out of line counts double, so a grid moves along its row or column

export const isArrow = (key) => Object.hasOwn(WAYS, key);

/** The index in `rects` of the nearest box beyond `from` that way, or -1. Boxes are DOMRect-shaped. */
export function nearestWay(key, from, rects) {
  const { ahead, near, far } = WAYS[key];
  let best = -1;
  let bestCost = Infinity;
  rects.forEach((to, index) => {
    const gap = ahead(from, to);
    if (gap < 0) return;
    const sideways = Math.max(0, to[near] - from[far], from[near] - to[far]);
    const cost = gap + SIDEWAYS_COST * sideways;
    if (cost < bestCost) {
      best = index;
      bestCost = cost;
    }
  });
  return best;
}
