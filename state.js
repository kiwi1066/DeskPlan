/**
 * state.js
 * Single source of truth for all app data.
 * Nothing outside this module should mutate AppState directly —
 * use the exported helpers so saves and history are never missed.
 */

export const DAYS = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
];

const STORAGE_KEY = "deskPlannerData";

// Override this with a per-floor key once buildings are loaded
let _storageKey = STORAGE_KEY;
export function setStorageKey(key) { _storageKey = key; }

export const AppState = {
  deskData:      {},   // { "desk-001": { mon:"T1", tue:"", ... }, ... }
  teamNames:     {},   // { "T1": "Finance", "T2": "HR", ... }
  teamColors:    {},   // { "T1": "#fc2003", ... } — manual overrides only
  selectedDesks: [],
  history:       [],
  multiMode:     false,
  currentDay:    "mon",
  currentDay2:   "tue",
  mode:          "single",
  deskSelector:  "g[id^='desk']",
  categoryLabel: "Teams",
};

// ── Desk registration ────────────────────────────────────────────────────────

export function registerDesk(id) {
  if (!AppState.deskData[id]) {
    AppState.deskData[id] = { mon: "", tue: "", wed: "", thu: "", fri: "" };
  }
}

// ── Team helpers ─────────────────────────────────────────────────────────────

export function addTeam(id, name, color) {
  AppState.teamNames[id] = name;
  if (color) AppState.teamColors[id] = color;
}

export function setTeamColor(id, color) {
  if (color) AppState.teamColors[id] = color;
  else delete AppState.teamColors[id];
}

export function renameTeam(id, newName) {
  if (AppState.teamNames[id] !== undefined) AppState.teamNames[id] = newName;
}

export function deleteTeam(id, unassignDesks = false) {
  delete AppState.teamNames[id];
  delete AppState.teamColors[id];
  if (unassignDesks) {
    DAYS.forEach(({ key }) => {
      Object.keys(AppState.deskData).forEach(deskId => {
        if (AppState.deskData[deskId][key] === id) {
          AppState.deskData[deskId][key] = "";
        }
      });
    });
  }
}

/** Total desk-day assignments across all days for a team */
export function teamDeskCount(teamId) {
  let count = 0;
  DAYS.forEach(({ key }) => {
    Object.values(AppState.deskData).forEach(v => {
      if (v[key] === teamId) count++;
    });
  });
  return count;
}

export function removeAllTeams() {
  AppState.teamNames  = {};
  AppState.teamColors = {};
}

export function getSortedTeamIds() {
  return Object.keys(AppState.teamNames).sort(
    (a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1))
  );
}

export function nextTeamId() {
  const existing = Object.keys(AppState.teamNames)
    .map(t => parseInt(t.replace("T", "")))
    .filter(n => !isNaN(n));
  let n = 1;
  while (existing.includes(n)) n++;
  return "T" + n;
}

// ── Team colour ──────────────────────────────────────────────────────────────
// Curated palette of 20 distinguishable colours, cycling hue + lightness +
// saturation so adjacent IDs never end up looking the same. Beyond 20 teams
// we fall back to a hash-based HSL so colours stay stable but may repeat.

export const TEAM_PALETTE = [
  "#fc2003",
  "#fc9003",
  "#fcdb03",
  "#03fc17",
  "#03fc7b",
  "#03fce8",
  "#03c6fc",
  "#0377fc",
  "#0320fc",
  "#9803fc",
  "#f003fc",
  "#fc03b6",
  "#fc0341",
  "#8a1601",
  "#638a01",
  "#018a28",
  "#018a83",
  "#01488a",
  "#06018a",
  "#53018a",
  "#8a0165",
  "#8a012a",
];

export const PALETTE_SIZE = TEAM_PALETTE.length;

/** Returns the next palette colour not already in use (manual or auto). */
export function nextAutoColor() {
  const used = new Set();
  Object.keys(AppState.teamNames).forEach(id => {
    used.add((AppState.teamColors[id] || autoColor(id)).toLowerCase());
  });
  for (const c of TEAM_PALETTE) {
    if (!used.has(c.toLowerCase())) return c;
  }
  // All palette colours used — fall through to hash-based
  return autoColor("T" + (Object.keys(AppState.teamNames).length + 1));
}

function autoColor(teamId) {
  const num = parseInt(teamId.replace("T", "")) || 0;
  if (num >= 1 && num <= TEAM_PALETTE.length) return TEAM_PALETTE[num - 1];
  const hue = (num * 47) % 360;
  const lt  = 45 + (num % 3) * 8;
  return `hsl(${hue}, 60%, ${lt}%)`;
}

export function teamColor(teamId) {
  if (!teamId) return "transparent";
  // Manual override wins
  if (AppState.teamColors[teamId]) return AppState.teamColors[teamId];
  return autoColor(teamId);
}

// ── Desk assignment ───────────────────────────────────────────────────────────

export function assignDesks(deskIds, teamId, day) {
  pushHistory();
  deskIds.forEach(id => {
    if (AppState.deskData[id]) {
      AppState.deskData[id][day] = teamId;
    } else {
      console.warn(`assignDesks: desk "${id}" not found in deskData`);
    }
  });
  saveState();
}

export function clearDeskDay(deskIds, day) {
  pushHistory();
  deskIds.forEach(id => {
    if (AppState.deskData[id]) AppState.deskData[id][day] = "";
  });
  saveState();
}

export function clearAllDesksForDay(day) {
  pushHistory();
  Object.keys(AppState.deskData).forEach(id => {
    AppState.deskData[id][day] = "";
  });
  saveState();
}

export function copyDayToOtherDays(fromDay, toDays) {
  pushHistory();
  Object.keys(AppState.deskData).forEach(id => {
    toDays.forEach(d => {
      AppState.deskData[id][d] = AppState.deskData[id][fromDay];
    });
  });
  saveState();
}

// ── Selection ────────────────────────────────────────────────────────────────

export function toggleDeskSelection(id, additive) {
  const idx = AppState.selectedDesks.indexOf(id);
  if (additive) {
    idx === -1
      ? AppState.selectedDesks.push(id)
      : AppState.selectedDesks.splice(idx, 1);
  } else {
    AppState.selectedDesks = [id];
  }
}

export function clearSelection() {
  AppState.selectedDesks = [];
}

// ── History / Undo ────────────────────────────────────────────────────────────

function pushHistory() {
  AppState.history.push(JSON.parse(JSON.stringify(AppState.deskData)));
  if (AppState.history.length > 50) AppState.history.shift();
}

export function undo() {
  if (!AppState.history.length) return false;
  AppState.deskData = AppState.history.pop();
  saveState();
  return true;
}

// ── Persistence ───────────────────────────────────────────────────────────────

export function saveState() {
  try {
    localStorage.setItem(_storageKey, JSON.stringify({
      deskData:      AppState.deskData,
      teamNames:     AppState.teamNames,
      teamColors:    AppState.teamColors,
      categoryLabel: AppState.categoryLabel,
    }));
  } catch (e) {
    console.warn("Could not save state:", e);
  }
}

export function loadState() {
  try {
    const raw = localStorage.getItem(_storageKey);
    if (!raw) return;
    const saved = JSON.parse(raw);

    const savedDesks  = saved.deskData || saved;
    const savedTeams  = saved.teamNames  || {};
    const savedColors = saved.teamColors || {};

    Object.keys(savedDesks).forEach(id => {
      if (AppState.deskData[id]) {
        AppState.deskData[id] = savedDesks[id];
      }
    });

    AppState.teamNames  = savedTeams;
    AppState.teamColors = savedColors;

    // Restore user-edited category label if present
    if (saved.categoryLabel) AppState.categoryLabel = saved.categoryLabel;
  } catch (e) {
    console.warn("Could not load state:", e);
  }
}

export function resetAll() {
  localStorage.removeItem(_storageKey);
  location.reload();
}

export function clearAllData() {
  Object.keys(AppState.deskData).forEach(id => {
    DAYS.forEach(({ key }) => { AppState.deskData[id][key] = ""; });
  });
  AppState.teamNames     = {};
  AppState.teamColors    = {};
  AppState.selectedDesks = [];
  AppState.history       = [];
  saveState();
}

/** Called when switching floors — wipes all runtime state ready for new SVG */
export function resetFloorData() {
  AppState.deskData      = {};
  AppState.teamNames     = {};
  AppState.teamColors    = {};
  AppState.selectedDesks = [];
  AppState.history       = [];
  AppState.mode          = "single";
  AppState.currentDay    = "mon";
  AppState.deskSelector  = "g[id^='desk']";
  AppState.categoryLabel = "Teams";
}

// ── Summary helpers ───────────────────────────────────────────────────────────

// ── Desk vs other-space classification ───────────────────────────────────────
// Every bookable shape in the SVG is a <g id="desk-…">. Real desks are
// "desk-" + number (+ optional letter), e.g. desk-012, desk-093A.
// Other spaces use a type token: desk-<type>-NN, e.g. desk-meet-01.
// Order here is the display order in the summary.

export const SPACE_TYPES = {
  meet:   { one: "Meeting room",       many: "Meeting rooms" },
  quiet:  { one: "Quiet room",         many: "Quiet rooms" },
  booth:  { one: "Booth",              many: "Booths" },
  office: { one: "Office",             many: "Offices" },
  mp:     { one: "Multi-purpose room", many: "Multi-purpose rooms" },
};

const DESK_ID_RE  = /^desk-\d+[A-Za-z]?$/;
const SPACE_ID_RE = /^desk-([a-z]+)-/;

/**
 * Classifies an ID: returns "desk", a SPACE_TYPES key, or null if the ID
 * matches neither naming convention.
 */
export function deskKind(id) {
  if (DESK_ID_RE.test(id)) return "desk";
  const m = SPACE_ID_RE.exec(id);
  if (m && SPACE_TYPES[m[1]]) return m[1];
  return null;
}

/** Logs any IDs on the current floor that don't follow the naming convention */
export function warnUnknownDeskIds() {
  const bad = Object.keys(AppState.deskData).filter(id => !deskKind(id));
  if (bad.length) {
    console.warn(
      `Unrecognised desk IDs (counted as desks): ${bad.join(", ")}. ` +
      `Use desk-<number> for desks or desk-<${Object.keys(SPACE_TYPES).join("|")}>-NN for other spaces.`
    );
  }
}

/**
 * Summary for a day.
 *   total / assigned / free  — real desks only
 *   teamCounts               — desks per team
 *   teamSpaceCounts          — other spaces per team
 *   spaces                   — [{ type, label, total, assigned }] for types present on this floor
 * Unrecognised IDs are counted as desks (and warned about on floor load).
 */
export function getDaySummary(day) {
  let total = 0, assigned = 0;
  const teamCounts      = {};
  const teamSpaceCounts = {};
  const spaceTally      = {};

  Object.entries(AppState.deskData).forEach(([id, v]) => {
    const kind   = deskKind(id) || "desk";
    const teamId = v[day];

    if (kind === "desk") {
      total++;
      if (teamId) {
        assigned++;
        teamCounts[teamId] = (teamCounts[teamId] || 0) + 1;
      }
    } else {
      const s = spaceTally[kind] || (spaceTally[kind] = { total: 0, assigned: 0 });
      s.total++;
      if (teamId) {
        s.assigned++;
        teamSpaceCounts[teamId] = (teamSpaceCounts[teamId] || 0) + 1;
      }
    }
  });

  const spaces = Object.keys(SPACE_TYPES)
    .filter(type => spaceTally[type])
    .map(type => {
      const t = spaceTally[type];
      return { type, label: t.total === 1 ? SPACE_TYPES[type].one : SPACE_TYPES[type].many, ...t };
    });

  return { total, assigned, free: total - assigned, teamCounts, teamSpaceCounts, spaces };
}
