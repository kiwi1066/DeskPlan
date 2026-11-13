/**
 * labels.js
 * "Show team names": a small name bubble on each assigned desk, drawn in a
 * <g id="team-labels"> layer on top of the floor SVG.
 *
 * Each bubble sits inside its desk, normally centred and running along the
 * desk's long side (like the desk numbers printed on the plan), sized as large
 * as fits. Handles rotated rects (275G L11/L12), angled polygons (1WS) and the
 * bent Y-pod desks (275G).
 *
 * Only real desks (incl. hot desks) and offices get labels; meeting rooms,
 * booths, quiet and multi-purpose rooms are skipped. Teams with no name
 * (deleted with "keep colours") are skipped too.
 */

import { AppState, teamColor, readableTextColor, deskKind } from "./state.js";

const SVG_NS      = "http://www.w3.org/2000/svg";
const LAYER_ID    = "team-labels";
const PREF_KEY    = "deskPlannerV2_showTeamLabels";
const LABEL_KINDS = new Set(["desk", "hot", "office"]);

// Bubble sizing, as fractions of font size / desk size
const PAD_X      = 0.3;    // horizontal padding each side (× font size)
const BOX_H      = 1.25;   // bubble height (× font size)
const FIT_LONG   = 0.9;    // bubble length uses at most 90% of the room available
const MARGIN_H   = 0.7;    // bubble height uses at most 70% of the room available
const MAX_VB     = 0.008;  // font size ≤ this × floor width (stops big offices getting huge text)
const MIN_FONT   = 1.5;

// ── Preference ───────────────────────────────────────────────────────────────

export function getShowTeamLabels() {
  try { return localStorage.getItem(PREF_KEY) === "on"; } catch { return false; }
}

export function setShowTeamLabels(on) {
  try { localStorage.setItem(PREF_KEY, on ? "on" : "off"); } catch { /* ignore */ }
}

// ── Drawing ──────────────────────────────────────────────────────────────────

/**
 * Clears and (if the toggle is on) redraws the label layer in one container.
 * @param {string} containerId  svgLayer div id
 * @param {string} day          option key, e.g. "mon"
 */
export function drawTeamLabels(containerId, day) {
  const container = document.getElementById(containerId);
  const svg = container?.querySelector("svg");
  if (!svg) return;

  svg.querySelector(`#${LAYER_ID}`)?.remove();
  if (!getShowTeamLabels()) return;

  const layer = document.createElementNS(SVG_NS, "g");
  layer.setAttribute("id", LAYER_ID);
  layer.setAttribute("pointer-events", "none");
  svg.appendChild(layer);

  const vbWidth = svg.viewBox?.baseVal?.width || 550;
  const maxFont = vbWidth * MAX_VB;

  svg.querySelectorAll(AppState.deskSelector).forEach(el => {
    if (!LABEL_KINDS.has(deskKind(el.id) || "desk")) return;
    const teamId = AppState.deskData[el.id]?.[day];
    if (!teamId || !(AppState.teamNames[teamId] || "").trim()) return;

    const shape   = el.querySelector("rect,polygon,path");
    const outline = shape && deskOutline(shape, svg);
    if (outline) drawBubble(layer, teamId, outline, maxFont);
  });

  if (!layer.childNodes.length) layer.remove();
}

function drawBubble(layer, teamId, outline, maxFont) {
  const fill = teamColor(teamId);
  const name = AppState.teamNames[teamId].trim();

  const g    = document.createElementNS(SVG_NS, "g");
  const rect = document.createElementNS(SVG_NS, "rect");
  const text = document.createElementNS(SVG_NS, "text");

  text.textContent = name;
  text.setAttribute("x", "0");
  text.setAttribute("y", "0");
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("dominant-baseline", "central");
  text.setAttribute("font-family", "Helvetica, Arial, sans-serif");
  text.setAttribute("font-weight", "bold");
  text.setAttribute("font-size", "10");
  text.setAttribute("fill", readableTextColor(fill));

  g.append(rect, text);
  layer.appendChild(g);

  // Text length per unit of font size (scales linearly, so measure once)
  const perEm = (text.getComputedTextLength() || name.length * 6) / 10;

  const fit = bestPlacement(outline, perEm, maxFont);
  if (!fit) { g.remove(); return; }
  const { cx, cy, angle, fontSize } = fit;

  const w = (perEm + PAD_X * 2) * fontSize;
  const h = BOX_H * fontSize;

  g.setAttribute("transform", `translate(${cx.toFixed(2)} ${cy.toFixed(2)}) rotate(${angle.toFixed(2)})`);
  text.setAttribute("font-size", fontSize.toFixed(2));
  rect.setAttribute("x", (-w / 2).toFixed(2));
  rect.setAttribute("y", (-h / 2).toFixed(2));
  rect.setAttribute("width",  w.toFixed(2));
  rect.setAttribute("height", h.toFixed(2));
  rect.setAttribute("rx", (fontSize * 0.3).toFixed(2));
  rect.setAttribute("fill", fill);
  rect.setAttribute("stroke", "#ffffff");
  rect.setAttribute("stroke-width", (fontSize * 0.08).toFixed(2));
}

// ── Placement ────────────────────────────────────────────────────────────────
// Desks come in many shapes: plain and rotated rectangles, angled polygons
// (1WS) and bent "Y-pod" desks (275G). For each desk we try a few centre
// points (the most open spots inside the outline) and each edge direction,
// and keep the placement that allows the largest label whose bubble stays
// inside the desk. For a rectangle this is the centre, along the long side.

function bestPlacement(poly, perEm, maxFont) {
  const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.min(maxX - minX, maxY - minY);
  if (!(span > 0)) return null;

  // Candidate centres: grid points furthest from the outline
  const step = span / 16;
  const pts  = [];
  let best   = 0;
  for (let x = minX + step / 2; x < maxX; x += step) {
    for (let y = minY + step / 2; y < maxY; y += step) {
      if (!inside(x, y, poly)) continue;
      const d = edgeDistance(x, y, poly);
      pts.push([x, y, d]);
      if (d > best) best = d;
    }
  }
  if (!pts.length) return null;
  // The desk's own centre goes first so plain desks get a centred label;
  // other spots only win if they allow a clearly bigger label
  const [mx, my] = centroid(poly);
  const q = step / 2;   // treat near-equal distances as equal, then prefer the middle
  const centres = pts
    .filter(p => p[2] >= best * 0.85)
    .sort((a, b) => Math.round(b[2] / q) - Math.round(a[2] / q) ||
                    Math.hypot(a[0] - mx, a[1] - my) - Math.hypot(b[0] - mx, b[1] - my))
    .filter((p, i, arr) => arr.slice(0, i).every(o => Math.hypot(p[0] - o[0], p[1] - o[1]) > step * 1.5))
    .slice(0, 8);
  if (inside(mx, my, poly)) centres.unshift([mx, my]);

  // Candidate angles: each edge direction, longest edges first
  const angles = [];
  poly.map((p, i) => {
    const q = poly[(i + 1) % poly.length];
    return { len: Math.hypot(q[0] - p[0], q[1] - p[1]), a: readableAngle(Math.atan2(q[1] - p[1], q[0] - p[0]) * 180 / Math.PI) };
  })
    .sort((a, b) => b.len - a.len)
    .forEach(({ len, a }) => {
      if (len > span * 0.2 && !angles.some(b => Math.abs(b - a) < 3 || Math.abs(Math.abs(b - a) - 180) < 3)) angles.push(a);
    });
  if (!angles.length) angles.push(0);

  let pick = null;
  centres.forEach(([cx, cy]) => {
    angles.forEach((angle, ai) => {
      const fontSize = largestFont(poly, cx, cy, angle, perEm, maxFont);
      // Earlier candidates (centre, long direction) win unless a later one
      // gives a label at least 10% bigger
      if (!pick || fontSize > pick.fontSize * 1.1) pick = { cx, cy, angle, fontSize };
    });
  });
  if (!pick || pick.fontSize < MIN_FONT) {
    // Nothing fits: smallest label at the most open spot, along the longest edge
    const [cx, cy] = centres[0];
    return { cx, cy, angle: angles[0], fontSize: MIN_FONT };
  }
  return pick;
}

/** Binary-search the largest font whose bubble (plus margin) fits in poly. */
function largestFont(poly, cx, cy, angle, perEm, maxFont) {
  let lo = 0, hi = maxFont;
  if (fits(poly, cx, cy, angle, perEm, hi)) return hi;
  for (let i = 0; i < 9; i++) {
    const mid = (lo + hi) / 2;
    if (fits(poly, cx, cy, angle, perEm, mid)) lo = mid; else hi = mid;
  }
  return lo;
}

function fits(poly, cx, cy, angle, perEm, fs) {
  const hw = (perEm + PAD_X * 2) * fs / 2 / FIT_LONG;  // margin built in
  const hh = BOX_H * fs / 2 / MARGIN_H;
  const r  = angle * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  const toWorld = (u, v) => [cx + u * c - v * s, cy + u * s + v * c];

  // Sample the bubble outline
  for (const [u, v] of [[-hw, -hh], [0, -hh], [hw, -hh], [hw, 0], [hw, hh], [0, hh], [-hw, hh], [-hw, 0],
                        [-hw / 2, -hh], [hw / 2, -hh], [-hw / 2, hh], [hw / 2, hh]]) {
    const [x, y] = toWorld(u, v);
    if (!inside(x, y, poly)) return false;
  }
  // No desk corner may poke into the bubble (concave shapes)
  for (const [x, y] of poly) {
    const dx = x - cx, dy = y - cy;
    const u = dx * c + dy * s, v = -dx * s + dy * c;
    if (Math.abs(u) < hw - 1e-6 && Math.abs(v) < hh - 1e-6) return false;
  }
  return true;
}

/** Text reads left-to-right or bottom-to-top, never upside down. */
function readableAngle(a) {
  while (a > 90.5)   a -= 180;
  while (a <= -89.5) a += 180;
  if (a > 89.5) a -= 180;   // vertical → bottom-to-top, like the plan's desk numbers
  return a;
}

/** Area centroid of a polygon (falls back to the vertex average). */
function centroid(poly) {
  let a = 0, x = 0, y = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
    a += f; x += (poly[j][0] + poly[i][0]) * f; y += (poly[j][1] + poly[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) {
    return [poly.reduce((s, p) => s + p[0], 0) / poly.length, poly.reduce((s, p) => s + p[1], 0) / poly.length];
  }
  return [x / (3 * a), y / (3 * a)];
}

function inside(x, y, poly) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}

function edgeDistance(x, y, poly) {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x1, y1] = poly[j], [x2, y2] = poly[i];
    const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / l2)) : 0;
    d = Math.min(d, Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)));
  }
  return d;
}

// ── Desk outline ─────────────────────────────────────────────────────────────

/** Outline of a desk shape as [[x, y], ...] in root SVG coordinates. */
function deskOutline(shape, svg) {
  const pts = localPoints(shape);
  if (!pts || pts.length < 3) return null;
  // Local → root user space (both screen CTMs include viewBox scaling and
  // CSS zoom, which cancel out)
  const sCTM = shape.getScreenCTM(), rCTM = svg.getScreenCTM();
  if (!sCTM || !rCTM) return pts;
  const m = rCTM.inverse().multiply(sCTM);
  return pts.map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
}

/** Outline points of a shape in its own coordinate space. */
function localPoints(shape) {
  const tag = shape.tagName.toLowerCase();
  let out = [];
  if (tag === "polygon" && shape.points?.numberOfItems >= 3) {
    for (let i = 0; i < shape.points.numberOfItems; i++) {
      const p = shape.points.getItem(i);
      out.push([p.x, p.y]);
    }
  } else if (tag === "path" && shape.getTotalLength) {
    const len = shape.getTotalLength();
    for (let i = 0; i < 48; i++) {
      const p = shape.getPointAtLength(len * i / 48);
      out.push([p.x, p.y]);
    }
  } else {
    let bb;
    try { bb = shape.getBBox(); } catch { return null; }
    if (!bb.width || !bb.height) return null;
    out = [[bb.x, bb.y], [bb.x + bb.width, bb.y], [bb.x + bb.width, bb.y + bb.height], [bb.x, bb.y + bb.height]];
  }
  // Drop repeated points, including a closing point equal to the first
  out = out.filter((p, i) => i === 0 || Math.hypot(p[0] - out[i - 1][0], p[1] - out[i - 1][1]) > 0.01);
  if (out.length > 3 && Math.hypot(out[0][0] - out.at(-1)[0], out[0][1] - out.at(-1)[1]) < 0.01) out.pop();
  return out;
}
