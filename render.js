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
} from "./state.js";
import { drawTeamLabels } from "./labels.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// ── Floor plan colouring ──────────────────────────────────────────────────────

/**
 * Colours every desk in a given SVG container for the given day.
 * @param {string} containerId  - DOM id of the svgLayer div
 * @param {string} day          - day key e.g. "mon"
 */
export function renderContainer(containerId, day) {
  const container = document.getElementById(containerId);
  if (!container) return;

  Object.keys(AppState.deskData).forEach(deskId => {
    const desk = container.querySelector(`#${deskId}`);
    if (!desk) return;

    const shape = desk.querySelector(":is(rect,polygon,path):not(.sel-halo)");
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

  // Team name bubbles (no-op layer clear when the toggle is off)
  drawTeamLabels(containerId, day);
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

// Selected desks get a translucent tint plus a two-tone outline (white halo
// under a dark line). The tint shows only on unassigned desks, because an
// assigned desk's team colour sits on top of it. The halo keeps the outline
// visible against black plan line work and every team colour. Widths are in
// screen pixels (non-scaling-stroke), so they look the same on every floor
// and at every zoom level.
const SEL_TINT       = "#1e6fd9";
const SEL_TINT_ALPHA = "0.3";
const SEL_LINE       = "#111";
const SEL_LINE_PX    = "2.5";
const SEL_HALO       = "#fff";
const SEL_HALO_PX    = "5.5";

export function applyHighlight() {
  const container = document.getElementById("svgContainer");
  if (!container) return;

  container.querySelectorAll(".sel-halo").forEach(el => el.remove());

  let count = 0;
  container.querySelectorAll(AppState.deskSelector).forEach(deskEl => {
    const shape = deskEl.querySelector(":is(rect,polygon,path):not(.sel-halo)");
    if (!shape) return;

    const selected = AppState.selectedDesks.includes(deskEl.id);
    shape.classList.toggle("sel-shape", selected);
    shape.style.opacity = selected ? "1" : "0.85";

    if (!selected) {
      shape.setAttribute("stroke", "none");
      shape.setAttribute("stroke-width", "0");
      shape.removeAttribute("vector-effect");
      return;
    }
    count++;

    // Halo + tint: a copy of the shape drawn behind the real one
    const halo = shape.cloneNode(false);
    halo.removeAttribute("opacity");
    halo.style.opacity = "1";
    halo.setAttribute("class", "sel-halo");
    halo.setAttribute("fill", SEL_TINT);
    halo.setAttribute("fill-opacity", SEL_TINT_ALPHA);
    halo.setAttribute("stroke", SEL_HALO);
    halo.setAttribute("stroke-width", SEL_HALO_PX);
    halo.setAttribute("stroke-linejoin", "round");
    halo.setAttribute("vector-effect", "non-scaling-stroke");
    halo.setAttribute("pointer-events", "none");
    shape.before(halo);

    shape.setAttribute("stroke", SEL_LINE);
    shape.setAttribute("stroke-width", SEL_LINE_PX);
    shape.setAttribute("stroke-linejoin", "round");
    shape.setAttribute("vector-effect", "non-scaling-stroke");
  });

  const counter = document.getElementById("selectionCount");
  if (counter) {
    counter.textContent = count ? `${count} selected` : "";
    counter.hidden = !count;
  }
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
