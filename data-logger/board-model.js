// The XIAO as the pose view draws it: a few convex solids in the IMU frame (mm), each a list of
// vertices and outward faces, with flat details (pads, the USB-C opening) painted on a face. Pure,
// so tests/dashboard/board-model.test.mjs can run it in Node; app.js only paints what drawList()
// returns.

// Points per quarter circle: 15 degree steps, below the crease angle, so curves draw unbroken.
const ARC_STEPS = 6;
// Neighbouring visible faces further apart than this get a line between them (a box's edges, not
// the steps of a rounded corner).
const CREASE_COS = Math.cos((35 * Math.PI) / 180);
// Light from the upper left, a little toward the viewer, in view coordinates (right, up, toward).
const LIGHT = normalize([-0.35, 0.6, 0.72]);

function normalize(v) {
  const length = Math.hypot(...v);
  return v.map((c) => c / length);
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mean = (points) => [0, 1, 2].map((i) => points.reduce((sum, p) => sum + p[i], 0) / points.length);

/**
 * A rounded rectangle centered on the origin, counter-clockwise: half-sizes a x b and corner radius
 * r. r equal to the smaller half-size makes a stadium, and to both a circle.
 */
export function roundedRect(a, b, r) {
  const points = [];
  for (const [su, sv, start] of [[1, 1, 0], [-1, 1, 90], [-1, -1, 180], [1, -1, 270]]) {
    for (let step = 0; step <= ARC_STEPS; step++) {
      const angle = ((start + (step * 90) / ARC_STEPS) * Math.PI) / 180;
      const point = [su * (a - r) + r * Math.cos(angle), sv * (b - r) + r * Math.sin(angle)];
      const last = points.at(-1);
      // Where a corner meets the next one (no straight side between), the point would repeat.
      if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) > 1e-9) points.push(point);
    }
  }
  if (Math.hypot(points[0][0] - points.at(-1)[0], points[0][1] - points.at(-1)[1]) < 1e-9) points.pop();
  return points;
}

// Faces as vertex index lists, each turned so its Newell normal points away from the solid's center
// (fine for convex solids, which are all this draws), and every edge with the two faces it joins.
function solid(vertices, faceIndices) {
  const center = mean(vertices);
  const faces = faceIndices.map((indices) => {
    const points = indices.map((i) => vertices[i]);
    let normal = [0, 0, 0];
    points.forEach((p, i) => {
      const q = points[(i + 1) % points.length];
      normal = [normal[0] + (p[1] - q[1]) * (p[2] + q[2]), normal[1] + (p[2] - q[2]) * (p[0] + q[0]), normal[2] + (p[0] - q[0]) * (p[1] + q[1])];
    });
    normal = normalize(normal);
    const faceCenter = mean(points);
    if (dot(normal, sub(faceCenter, center)) < 0) return { indices: [...indices].reverse(), normal: normal.map((c) => -c), center: faceCenter };
    return { indices, normal, center: faceCenter };
  });
  const edges = new Map();
  faces.forEach(({ indices }, face) =>
    indices.forEach((a, i) => {
      const b = indices[(i + 1) % indices.length];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (!edges.has(key)) edges.set(key, { a, b, faces: [] });
      edges.get(key).faces.push(face);
    }),
  );
  return { vertices, faces, edges: [...edges.values()], center };
}

// An outline (u, v) extruded from w0 to w1, placed in the IMU frame by place(u, v, w) -> [x, y, z].
function prism(outline, w0, w1, place) {
  const n = outline.length;
  const vertices = [...outline.map(([u, v]) => place(u, v, w0)), ...outline.map(([u, v]) => place(u, v, w1))];
  const faces = [
    outline.map((_, i) => i),
    outline.map((_, i) => n + i),
    ...outline.map((_, i) => [i, (i + 1) % n, n + ((i + 1) % n), n + i]),
  ];
  return solid(vertices, faces);
}

// The face of a solid that looks most nearly along `direction`, for a decal to sit on.
function faceToward({ faces }, direction) {
  let best = 0;
  faces.forEach(({ normal }, i) => {
    if (dot(normal, direction) > dot(faces[best].normal, direction)) best = i;
  });
  return best;
}

// The XIAO in the IMU's x/y plane, its top at z = 0: a ~1 mm PCB, 17.8 x 21 mm with ~2 mm corners,
// its long side along y. Its USB-C receptacle sits on top at the +y end, overhanging the edge by
// ~1 mm: an 8.9 x 3.2 mm stadium-section shell 7.3 mm deep, its opening (with the contact tongue)
// facing out along +y. Seen from above with the port away from you, the red LED is to its left
// (-x) and the RGB LED to its right. Seven castellated pads run down each long side at 2.54 mm,
// drawn centered.
const BOARD_HALF_WIDTH = 8.9;
const BOARD_HALF_LENGTH = 10.5;
const BOARD_THICKNESS = 1;
const PAD_PITCH = 2.54;
const PADS_PER_SIDE = 7;
const USB_FRONT = 11.5;
const USB_DEPTH = 7.3;
const USB_HALF_WIDTH = 4.45;
const USB_HALF_HEIGHT = 1.6;

function boardPart() {
  const board = prism(roundedRect(BOARD_HALF_WIDTH, BOARD_HALF_LENGTH, 2), -BOARD_THICKNESS, 0, (u, v, w) => [u, v, w]);
  const top = faceToward(board, [0, 0, 1]);
  const decals = [];
  for (const side of [1, -1]) {
    const edge = faceToward(board, [side, 0, 0]);
    const x = side * BOARD_HALF_WIDTH;
    for (let i = 0; i < PADS_PER_SIDE; i++) {
      const y = (i - (PADS_PER_SIDE - 1) / 2) * PAD_PITCH;
      // A copper pad reaching in from the edge, the half hole through it, and its plating down the edge.
      const pad = roundedRect(0.8, 0.75, 0.3).map(([u, v]) => [x - side * (0.8 - u), y + v, 0]);
      const hole = roundedRect(0.45, 0.45, 0.45).filter(([u]) => u <= 1e-9).map(([u, v]) => [x + side * u, y + v, 0]);
      const plating = [[x, y - 0.45, -BOARD_THICKNESS], [x, y + 0.45, -BOARD_THICKNESS], [x, y + 0.45, 0], [x, y - 0.45, 0]];
      decals.push({ face: top, points: pad, material: "pad" }, { face: top, points: hole, material: "hole" }, { face: edge, points: plating, material: "pad" });
    }
  }
  return { name: "board", base: true, solid: board, material: "pcb", decals };
}

function usbPart() {
  const centerZ = USB_HALF_HEIGHT;
  const shell = prism(roundedRect(USB_HALF_WIDTH, USB_HALF_HEIGHT, USB_HALF_HEIGHT), USB_FRONT - USB_DEPTH, USB_FRONT, (u, v, w) => [u, w, centerZ + v]);
  const front = faceToward(shell, [0, 1, 0]);
  const onFront = ([u, v]) => [u, USB_FRONT, centerZ + v];
  return {
    name: "usb",
    solid: shell,
    material: "metal",
    decals: [
      { face: front, points: roundedRect(4.1, 1.25, 1.25).map(onFront), material: "hole" },
      { face: front, points: roundedRect(3.3, 0.35, 0.2).map(onFront), material: "tongue" },
    ],
  };
}

function ledPart(name, x, y) {
  return { name, solid: prism(roundedRect(0.8, 0.8, 0.25), 0, 0.5, (u, v, w) => [x + u, y + v, w]), material: name, decals: [] };
}

export const BOARD_PARTS = [boardPart(), usbPart(), ledPart("led-red", -6.4, 9), ledPart("led-rgb", 6.4, 9)];

/**
 * What to paint, back to front, for a board seen through view(point) -> { right, up, depth } (the
 * rotation and camera together; linear, so it turns normals too, and larger depth is farther).
 * Faces come as { points: [[right, up], ...], material, shade 0-1 }, decals likewise after their
 * face, and each part's outline and creases as { line: [[right, up], [right, up]], part } after its
 * faces. The parts on top of the board paint after it when its top faces the camera, else before.
 */
export function drawList(view, parts = BOARD_PARTS) {
  const base = parts.find((part) => part.base);
  const onTop = parts.filter((part) => part !== base).sort((a, b) => view(b.solid.center).depth - view(a.solid.center).depth);
  const topFacesCamera = view([0, 0, 1]).depth < 0;
  const order = topFacesCamera ? [base, ...onTop] : [...onTop, base];
  const items = [];
  for (const part of order) {
    const { vertices, faces, edges } = part.solid;
    const seen = vertices.map(view);
    const flat = ({ right, up }) => [right, up];
    const normals = faces.map(({ normal }) => {
      const { right, up, depth } = view(normal);
      return normalize([right, up, -depth]);
    });
    const visible = normals.map((normal) => normal[2] > 1e-9);
    faces.forEach(({ indices }, face) => {
      if (!visible[face]) return;
      const shade = Math.max(0, dot(normals[face], LIGHT));
      items.push({ points: indices.map((i) => flat(seen[i])), material: part.material, shade });
      for (const decal of part.decals) {
        if (decal.face === face) items.push({ points: decal.points.map((p) => flat(view(p))), material: decal.material, shade });
      }
    });
    for (const { a, b, faces: [f1, f2] } of edges) {
      const outline = visible[f1] !== visible[f2];
      const crease = visible[f1] && visible[f2] && dot(normals[f1], normals[f2]) < CREASE_COS;
      if (outline || crease) items.push({ line: [flat(seen[a]), flat(seen[b])], part: part.name });
    }
  }
  return items;
}

/** CSS color a mixed toward b by t (0-1), from #rgb, #rrggbb or rgb() colors; null if unreadable. */
export function mixColors(a, b, t) {
  const [ca, cb] = [parseColor(a), parseColor(b)];
  if (!ca || !cb) return null;
  const mixed = ca.map((channel, i) => Math.round(channel + (cb[i] - channel) * t));
  return `rgb(${mixed.join(" ")})`;
}

function parseColor(color) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color?.trim() ?? "");
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((d) => d + d) : hex[1].match(/../g);
    return digits.map((pair) => parseInt(pair, 16));
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(color?.trim() ?? "");
  return rgb ? rgb.slice(1, 4).map(Number) : null;
}
