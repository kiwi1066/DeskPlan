/**
 * labels.js
 * "Show team names": one bubble per cluster of adjacent desks assigned to the
 * same team, drawn in a <g id="team-labels"> layer on top of the floor SVG.
 *
 * Only real desks (incl. hot desks) and offices get labels; meeting rooms,
 * booths, quiet and multi-purpose rooms are skipped. Teams with no name
 * (deleted with "keep colours") are skipped too.
 */

import { AppState, teamColor, readableTextColor, deskKind } from "./state.js";

const SVG_NS       = "http://www.w3.org/2000/svg";
const LAYER_ID     = "team-labels";
const PREF_KEY     = "deskPlannerV2_showTeamLabels";
const GAP          = 1.5;   // bbox expansion per side → desks within 3 units cluster
const LABEL_KINDS  = new Set(["desk", "hot", "office"]);

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

  // Collect labelled desks with their bounds in root SVG coordinates
  const byTeam = {};
  svg.querySelectorAll(AppState.deskSelector).forEach(el => {
    const kind = deskKind(el.id) || "desk";
    if (!LABEL_KINDS.has(kind)) return;
    const teamId = AppState.deskData[el.id]?.[day];
    if (!teamId || !(AppState.teamNames[teamId] || "").trim()) return;
    const box = rootBBox(el, svg);
    if (!box) return;
    (byTeam[teamId] ||= []).push(box);
  });

  const teamIds = Object.keys(byTeam);
  if (!teamIds.length) return;

  const layer = document.createElementNS(SVG_NS, "g");
  layer.setAttribute("id", LAYER_ID);
  layer.setAttribute("pointer-events", "none");
  svg.appendChild(layer);

  const vbWidth  = svg.viewBox?.baseVal?.width || svg.getBBox().width || 550;
  // ~1% of floor width ≈ half a desk's width on 275G/400G; clamp keeps
  // wide floors (1WS, 57S) from getting oversized bubbles
  const fontSize = clamp(vbWidth * 0.010, 5, 10);

  teamIds.forEach(teamId => {
    clusterBoxes(byTeam[teamId]).forEach(box => {
      drawBubble(layer, teamId, box, fontSize);
    });
  });
}

function drawBubble(layer, teamId, box, fontSize) {
  const fill = teamColor(teamId);
  const name = AppState.teamNames[teamId].trim();
  const cx   = box.x + box.w / 2;
  const cy   = box.y + box.h / 2;

  const g    = document.createElementNS(SVG_NS, "g");
  const rect = document.createElementNS(SVG_NS, "rect");
  const text = document.createElementNS(SVG_NS, "text");

  text.textContent = name;
  text.setAttribute("x", cx);
  text.setAttribute("y", cy);
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("dominant-baseline", "central");
  text.setAttribute("font-family", "Helvetica, Arial, sans-serif");
  text.setAttribute("font-size", fontSize.toFixed(2));
  text.setAttribute("font-weight", "bold");
  text.setAttribute("fill", readableTextColor(fill));

  g.append(rect, text);
  layer.appendChild(g);

  // Measure after insertion so the text has a rendered length
  const textW = text.getComputedTextLength() || name.length * fontSize * 0.6;
  const padX  = fontSize * 0.35;
  const w     = textW + padX * 2;
  const h     = fontSize * 1.3;

  rect.setAttribute("x", (cx - w / 2).toFixed(2));
  rect.setAttribute("y", (cy - h / 2).toFixed(2));
  rect.setAttribute("width",  w.toFixed(2));
  rect.setAttribute("height", h.toFixed(2));
  rect.setAttribute("rx", (fontSize * 0.3).toFixed(2));
  rect.setAttribute("fill", fill);
  rect.setAttribute("stroke", "#ffffff");
  rect.setAttribute("stroke-width", (fontSize * 0.08).toFixed(2));
}

// ── Geometry ─────────────────────────────────────────────────────────────────

/** Axis-aligned bbox of el in the root SVG's user space (handles transforms). */
function rootBBox(el, svg) {
  let bb;
  try { bb = el.getBBox(); } catch { return null; }
  if (!bb || (!bb.width && !bb.height)) return null;

  // Both screen CTMs include the viewBox scaling and any CSS zoom, which cancel out
  const elCTM   = el.getScreenCTM();
  const rootCTM = svg.getScreenCTM();
  if (!elCTM || !rootCTM) return { x: bb.x, y: bb.y, w: bb.width, h: bb.height };

  // Matrix from el's local space to root user space
  const m  = rootCTM.inverse().multiply(elCTM);
  const pt = svg.createSVGPoint();
  const xs = [], ys = [];
  [[bb.x, bb.y], [bb.x + bb.width, bb.y], [bb.x, bb.y + bb.height], [bb.x + bb.width, bb.y + bb.height]]
    .forEach(([x, y]) => {
      pt.x = x; pt.y = y;
      const p = pt.matrixTransform(m);
      xs.push(p.x); ys.push(p.y);
    });
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function touches(a, b) {
  return a.x - GAP <= b.x + b.w + GAP && b.x - GAP <= a.x + a.w + GAP &&
         a.y - GAP <= b.y + b.h + GAP && b.y - GAP <= a.y + a.h + GAP;
}

/** Union-find over boxes; returns one combined bbox per cluster. */
function clusterBoxes(boxes) {
  const parent = boxes.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (touches(boxes[i], boxes[j])) parent[find(i)] = find(j);
    }
  }

  const groups = {};
  boxes.forEach((b, i) => {
    const r = find(i);
    const g = groups[r];
    if (!g) { groups[r] = { x1: b.x, y1: b.y, x2: b.x + b.w, y2: b.y + b.h }; return; }
    g.x1 = Math.min(g.x1, b.x);       g.y1 = Math.min(g.y1, b.y);
    g.x2 = Math.max(g.x2, b.x + b.w); g.y2 = Math.max(g.y2, b.y + b.h);
  });
  return Object.values(groups).map(g => ({ x: g.x1, y: g.y1, w: g.x2 - g.x1, h: g.y2 - g.y1 }));
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
