/**
 * buildings.js
 * Fetches buildings.json and manages the active building/floor selection.
 *
 * Exposes:
 *   loadBuildings()          → fetches config, returns { buildings, defaultBuilding, defaultFloor }
 *   getCurrentFloor()        → { buildingId, buildingLabel, floorId, floorLabel, plan }
 *   setCurrentFloor(b, f)    → updates active selection
 *   getFloors(buildingId)    → array of floor objects for a building
 *   storageKey()             → "deskPlanner_{buildingId}_{floorId}" — unique per floor
 */

let _buildings = {};       // raw config from JSON
let _buildingId = null;
let _floorId    = null;

// ── Load config ───────────────────────────────────────────────────────────────

export async function loadBuildings() {
  const res = await fetch("buildings.json");
  if (!res.ok) throw new Error(`buildings.json returned HTTP ${res.status}`);
  _buildings = await res.json();

  // Start on the user's saved default floor if it still exists,
  // otherwise the first floor of the first building
  let startBldg  = Object.keys(_buildings)[0];
  let startFloor = _buildings[startBldg]?.floors?.[0]?.id ?? null;

  const saved = getDefaultFloor();
  if (saved && floorExists(saved.buildingId, saved.floorId)) {
    startBldg  = saved.buildingId;
    startFloor = saved.floorId;
  }

  _buildingId = startBldg;
  _floorId    = startFloor;

  return {
    buildings:       _buildings,
    defaultBuilding: startBldg,
    defaultFloor:    startFloor,
  };
}

// ── User's default (startup) floor ────────────────────────────────────────────
// Stored per browser. Not tied to any one floor's data.

const DEFAULT_FLOOR_KEY = "deskPlannerV2_defaultFloor";

/** { buildingId, floorId } or null */
export function getDefaultFloor() {
  try {
    const raw = localStorage.getItem(DEFAULT_FLOOR_KEY);
    const v   = raw ? JSON.parse(raw) : null;
    return v?.buildingId && v?.floorId ? v : null;
  } catch {
    return null;
  }
}

export function setDefaultFloor(buildingId, floorId) {
  try {
    localStorage.setItem(DEFAULT_FLOOR_KEY, JSON.stringify({ buildingId, floorId }));
  } catch (e) {
    console.warn("Could not save default floor:", e);
  }
}

export function clearDefaultFloor() {
  try { localStorage.removeItem(DEFAULT_FLOOR_KEY); } catch { /* ignore */ }
}

/** True if the current floor is the saved default */
export function isCurrentFloorDefault() {
  const d = getDefaultFloor();
  return !!d && d.buildingId === _buildingId && d.floorId === _floorId;
}

// ── Getters / setters ─────────────────────────────────────────────────────────

export function setCurrentFloor(buildingId, floorId) {
  _buildingId = buildingId;
  _floorId    = floorId;
}

export function getCurrentFloor() {
  const bldg  = _buildings[_buildingId] ?? {};
  const floor = (bldg.floors ?? []).find(f => f.id === _floorId) ?? null;
  return {
    buildingId:    _buildingId,
    buildingLabel: bldg.label ?? _buildingId,
    floorId:       _floorId,
    floorLabel:    floor?.label        ?? _floorId ?? "",
    plan:          floor?.plan         ?? null,
    deskSelector:  floor?.deskSelector ?? "g[id^='desk']",
    planDarken:    floor?.planDarken   ?? null,
  };
}

export function getBuildings() {
  return _buildings;
}

export function getFloors(buildingId) {
  return _buildings[buildingId]?.floors ?? [];
}

/** True if the given building+floor combination exists in the config */
export function floorExists(buildingId, floorId) {
  const floors = _buildings[buildingId]?.floors ?? [];
  return floors.some(f => f.id === floorId);
}

/**
 * Unique localStorage key for the current floor.
 * V2 uses its own prefix so it never overwrites V1 data — both versions are
 * served from kiwi1066.github.io and share the same browser storage.
 */
export function storageKey() {
  return `deskPlannerV2_${_buildingId}_${_floorId}`;
}

/** V2 / V1 keys for any floor — used to read names saved on other floors */
export function storageKeyFor(buildingId, floorId)   { return `deskPlannerV2_${buildingId}_${floorId}`; }
export function v1StorageKeyFor(buildingId, floorId) { return `deskPlanner_${buildingId}_${floorId}`; }

/** V1's key for the current floor — read once to copy V1 data into V2, never written */
export function v1StorageKey() {
  return `deskPlanner_${_buildingId}_${_floorId}`;
}

/** Human-readable title for the current floor, used in page title and export */
export function floorTitle() {
  const { buildingLabel, floorLabel } = getCurrentFloor();
  return `${buildingLabel} — ${floorLabel}`;
}
