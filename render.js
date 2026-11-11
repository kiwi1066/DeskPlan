/**
 * render.js
 * All DOM rendering: floor plan colours, legend chips, summary panel.
 * Call render() whenever AppState changes.
 */

import {
  AppState,
  getSortedTeamIds,
  teamColor,
  getDaySummary,
  PALETTE_SIZE,
  displayName,
  readableTextColor,
  deskKind,
} from "./state.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// ── Desk number labels ────────────────────────────────────────────────────────
// The numbers printed on the PNG are tiny and get hidden once a desk is
// coloured, so each desk gets its own readable label in the SVG overlay.
// Meeting rooms etc. (desk-meet-01) are left unlabelled.

/** "desk-091" -> "91", "desk-093A" -> "93A", "deskN12" -> "N12" */
function deskLabelText(deskId) {
  const kind = deskKind(deskId);
  if (kind && kind !== "desk") return null;
  const raw = deskId.replace(/^desk[-_]*/i, "");
  return raw.replace(/^0+(?=\d)/, "") || null;
}

/**
 * Adds a label to every desk in the container that doesn't have one yet.
 * Font size is fitted to each desk, then capped near the floor's typical
 * size so oddly shaped desks don't get giant numbers.
 */
function ensureDeskLabels(container) {
  const pending = [];

  container.querySelectorAll("g[id]").forEach(desk => {
    if (!(desk.id in AppState.deskData)) return;
    if (desk.querySelector("text.desk-label")) return;

    const text  = deskLabelText(desk.id);
    const shape = desk.querySelector("rect,polygon,path");
    if (!text || !shape) return;

    // getBBox is zero while the SVG is hidden (e.g. compare panel not shown
    // yet) — skip for now, the next render will try again.
    let bb;
    try { bb = shape.getBBox(); } catch { return; }
    if (!bb.width || !bb.height) return;

    // Tall desks get vertical text so every desk in a bank reads the same way.
    const vertical = bb.height > bb.width * 1.3;
    const across   = vertical ? bb.width  : bb.height;
    const along    = vertical ? bb.height : bb.width;
    const size     = Math.min(across * 0.62, (along * 0.9) / (text.length * 0.62));

    pending.push({ desk, shape, text, bb, vertical, size });
  });

  if (!pending.length) return;

  const sorted = pending.map(p => p.size).sort((a, b) => a - b);
  const cap    = sorted[Math.floor(sorted.length / 2)] * 1.2;

  pending.forEach(({ desk, shape, text, bb, vertical, size }) => {
    const cx = bb.x + bb.width  / 2;
    const cy = bb.y + bb.height / 2;

    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("class", "desk-label");
    label.setAttribute("x", cx);
    label.setAttribute("y", cy);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("dominant-baseline", "central");
    label.setAttribute("font-family", "Segoe UI, Arial, sans-serif");
    label.setAttribute("font-weight", "700");
    label.setAttribute("font-size", Math.min(size, cap).toFixed(2));
    label.setAttribute("pointer-events", "none");
    label.setAttribute("paint-order", "stroke");
    label.setAttribute("stroke-linejoin", "round");

    // Keep the label in the shape's own coordinate space, then rotate if needed.
    const shapeTf = shape.getAttribute("transform") || "";
    const rotate  = vertical ? ` rotate(-90 ${cx} ${cy})` : "";
    if (shapeTf || rotate) label.setAttribute("transform", (shapeTf + rotate).trim());

    label.textContent = text;
    desk.appendChild(label);
  });
}

function styleDeskLabel(label, teamColorOrNull) {
  if (!label) return;
  if (teamColorOrNull) {
    // On a coloured desk: black or white, whichever reads better
    label.setAttribute("fill", readableTextColor(teamColorOrNull));
    label.setAttribute("stroke", "none");
  } else {
    // On the bare plan: dark text with a white halo so line work doesn't
    // cut through it
    label.setAttribute("fill", "#1a1a1a");
    label.setAttribute("stroke", "#ffffff");
    label.setAttribute("stroke-width", (parseFloat(label.getAttribute("font-size")) * 0.28).toFixed(2));
  }
}

// ── Floor plan colouring ──────────────────────────────────────────────────────

/**
 * Colours every desk in a given SVG container for the given day.
 * @param {string} containerId  - DOM id of the svgLayer div
 * @param {string} day          - day key e.g. "mon"
 */
export function renderContainer(containerId, day) {
  const container = document.getElementById(containerId);
  if (!container) return;

  ensureDeskLabels(container);

  Object.keys(AppState.deskData).forEach(deskId => {
    const desk = container.querySelector(`#${deskId}`);
    if (!desk) return;

    const shape = desk.querySelector("rect,polygon,path");
    if (!shape) return;

    const teamId = AppState.deskData[deskId][day];
    const color  = teamColor(teamId);

    // Use fill-opacity instead of transparent fill so the shape still
    // receives pointer events even when unassigned
    if (teamId) {
      shape.setAttribute("fill", color);
      shape.setAttribute("fill-opacity", "1");
    } else {
      shape.setAttribute("fill", "#000000");
      shape.setAttribute("fill-opacity", "0");
    }
    shape.setAttribute("pointer-events", "all");

    styleDeskLabel(desk.querySelector("text.desk-label"), teamId ? color : null);

    // Tooltip
    let title = shape.querySelector("title");
    if (teamId) {
      if (!title) {
        title = document.createElementNS(SVG_NS, "title");
        shape.appendChild(title);
      }
      title.textContent = displayName(teamId);
    } else if (title) {
      title.remove();
    }
  });
}

// Callbacks set by app.js so render.js never imports state-mutation functions
let _onTeamClick = null;
let _onTeamEdit  = null;

export function setTeamClickHandler(fn) { _onTeamClick = fn; }
export function setTeamEditHandler(fn)  { _onTeamEdit  = fn; }

/** Renders the main (single) view */
export function render() {
  if (AppState.mode === "compare") {
    renderContainer("svgContainer1", AppState.currentDay);
    renderContainer("svgContainer2", AppState.currentDay2);
  } else {
    renderContainer("svgContainer", AppState.currentDay);
  }

  buildLegend(_onTeamClick, _onTeamEdit);
  updateSummary();
  applyHighlight();
}

// ── Selection highlight ───────────────────────────────────────────────────────

export function applyHighlight() {
  const container = document.getElementById("svgContainer");
  if (!container) return;

  container.querySelectorAll(AppState.deskSelector).forEach(deskEl => {
    const shape = deskEl.querySelector("rect,polygon,path");
    if (!shape) return;

    const selected = AppState.selectedDesks.includes(deskEl.id);
    shape.setAttribute("stroke",       selected ? "#444" : "none");
    shape.setAttribute("stroke-width", selected ? "0.6"  : "0");
    shape.style.opacity = selected ? "1" : "0.85";
  });
}

// ── Legend ────────────────────────────────────────────────────────────────────

/**
 * @param {Function} [onTeamClick]  called with (teamId) when chip label is clicked
 * @param {Function} [onTeamEdit]   called with (teamId) when edit ✏ button is clicked
 */
export function buildLegend(onTeamClick, onTeamEdit) {
  const legend = document.getElementById("legend");
  if (!legend) return;

  legend.innerHTML = "";
  const teamIds = getSortedTeamIds();

  if (!teamIds.length) {
    legend.innerHTML = `<span style="color:#999;font-size:12px;">No teams added yet.</span>`;
    return;
  }

  teamIds.forEach(teamId => {
    const color = teamColor(teamId);

    const chip = document.createElement("div");
    chip.className    = "chip";
    chip.dataset.team = teamId;

    chip.innerHTML = `
      <span class="chip-dot" style="background:${color}"></span>
      <span class="chip-label" title="Assign to ${displayName(teamId)}">${displayName(teamId)}</span>
      <button class="chip-edit-btn" title="Rename or delete ${displayName(teamId)}" aria-label="Edit ${displayName(teamId)}">✏️</button>
    `;

    // Left-click on the label area → assign
    const label = chip.querySelector(".chip-label");
    if (onTeamClick) {
      label.addEventListener("click", e => {
        e.stopPropagation();
        onTeamClick(teamId);
      });
    }

    // Click on edit button → open edit modal
    const editBtn = chip.querySelector(".chip-edit-btn");
    if (onTeamEdit) {
      editBtn.addEventListener("click", e => {
        e.stopPropagation();
        onTeamEdit(teamId);
      });
    }

    legend.appendChild(chip);
  });

  // Soft warning when palette is exceeded
  if (teamIds.length > PALETTE_SIZE) {
    const warn = document.createElement("div");
    warn.style.cssText = "width:100%;margin-top:6px;padding:6px 10px;background:#fff8ec;border-left:3px solid #f0a500;border-radius:4px;font-size:11px;color:#7a5a00;line-height:1.4;";
    warn.innerHTML = `⚠ You have ${teamIds.length} ${(AppState.categoryLabel || "teams").toLowerCase()} — colours beyond ${PALETTE_SIZE} may start to look similar.`;
    legend.appendChild(warn);
  }
}

// ── Summary panel ─────────────────────────────────────────────────────────────

export function updateSummary() {
  const el = document.getElementById("summary");
  if (!el) return;

  const { total, assigned, free, teamCounts, teamSpaceCounts, spaces } =
    getDaySummary(AppState.currentDay);
  const teamIds = getSortedTeamIds();

  let html = `
    <div class="summary-totals">
      <span class="summary-row-label">Desks</span>
      <span><strong>${total}</strong> Total</span>
      <span><strong>${assigned}</strong> Assigned</span>
      <span><strong>${free}</strong> Free</span>
    </div>
  `;

  if (spaces.length) {
    html += `<div class="summary-totals summary-spaces">
      <span class="summary-row-label">Other spaces</span>`;
    spaces.forEach(s => {
      html += `<span title="${s.assigned} of ${s.total} assigned"><strong>${s.total}</strong> ${s.label}
        <span class="summary-space-assigned">(${s.assigned} assigned)</span></span>`;
    });
    html += `</div>`;
  }

  html += `<div class="summary-teams">`;

  teamIds.forEach(t => {
    const color  = teamColor(t);
    const desks  = teamCounts[t] || 0;
    const spaceN = teamSpaceCounts[t] || 0;
    const text   = spaceN
      ? `${displayName(t)}: ${desks} desk${desks === 1 ? "" : "s"} · ${spaceN} space${spaceN === 1 ? "" : "s"}`
      : `${displayName(t)}: ${desks} desk${desks === 1 ? "" : "s"}`;
    html += `
      <span class="summary-badge" style="background:${color};color:${readableTextColor(color)}">
        ${text}
      </span>
    `;
  });

  html += `</div>`;
  el.innerHTML = html;
}
