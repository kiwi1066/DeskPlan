"""
Step 3: find the clickable shapes.

Usage (from the repo root):  python3 tools/new-floor/3_shapes.py 5BS_L2
Reads  tools/work/<floor>/fit.png, words.html and the floor config
Writes tools/work/<floor>/shapes.json  (coordinates in the final SVG's units:
       PDF points with the origin at the crop's top-left corner)

  Numbered desks : each desk number in words.html (config.deskNumbers.pattern,
                   groups = area, desk number) -> flood fill from the number's
                   position -> smallest rectangle around the enclosed area.
                   ID = desk-<area><desk number, 2+ digits>, e.g. W2.14.84 -> desk-1484
  Added desks    : config.addedDesks.seeds  [area, number, x, y]  (clean.png pixels)
                   for desks with no printed number; same flood fill from the seed.
  Rooms          : config.rooms  id -> [x0, y0, x1, y1] (clean.png pixels).

Prints anything unusual (desk much smaller/larger than the typical desk, a
number whose outline isn't closed, duplicate IDs).
"""
import json, math, re, sys, os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "fit-shapes"))
from fit import shift_or, components, convex_hull, min_area_rect   # shared geometry helpers

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))


def load_floor(arg):
    path = arg if os.path.exists(arg) else os.path.join(HERE, "floors", arg.replace(".json", "") + ".json")
    cfg = json.load(open(path))
    work = os.path.join(ROOT, "tools", "work", f"{cfg['building']['id']}_{cfg['floor']['id']}")
    return cfg, work


cfg, WORK = load_floor(sys.argv[1] if len(sys.argv) > 1 else "")
CROP = cfg["crop"]
img = np.asarray(Image.open(os.path.join(WORK, "fit.png")).convert("L"))
K = img.shape[1] / (CROP[2] - CROP[0])            # px per point
FREE = ~shift_or(img < cfg.get("wallThreshold", 200), 1)


def to_px(x, y):  return (int(round((x - CROP[0]) * K)), int(round((y - CROP[1]) * K)))
def to_pt(px, py): return (px / K, py / K)


def region_at(px, py, limit):
    """Enclosed free area containing (px, py) (searching a few px around it
    for a free start point). None if it isn't enclosed within `limit` px."""
    h, w = FREE.shape
    for r in range(0, 8):
        for dx in range(-r, r + 1):
            for dy in (-r, r) if abs(dx) != r else range(-r, r + 1):
                x, y = px + dx, py + dy
                if 0 <= x < w and 0 <= y < h and FREE[y, x]:
                    x0, y0 = max(0, x - limit), max(0, y - limit)
                    win = FREE[y0:y + limit, x0:x + limit]
                    lab, _ = components(win, [(x - x0, y - y0)])
                    m = lab == 1
                    if m[0, :].any() or m[-1, :].any() or m[:, 0].any() or m[:, -1].any():
                        return None
                    return m, x0, y0
    return None


def rect_from(mask, x0, y0, grow=1):
    m = shift_or(mask, grow)
    ys, xs = np.nonzero(m)
    pts = np.stack([xs, ys], 1)
    corners = np.vstack([pts, pts + [1, 0], pts + [0, 1], pts + [1, 1]])
    return [list(to_pt(x + x0, y + y0)) for x, y in min_area_rect(convex_hull(corners.tolist()))]


def rect_dims(r):
    a = math.dist(r[0], r[1]); b = math.dist(r[1], r[2])
    return min(a, b), max(a, b)


ID_FMT = cfg["deskNumbers"].get("idFormat", "desk-{area}{num:02d}")
PREFIXES = cfg["deskNumbers"].get("prefixMap", {})


def desk_id(area, num, prefix=""):
    """ID from config.deskNumbers.idFormat (default desk-<area><num>, e.g. desk-1484).
    275G floors keep their existing desk-NNN IDs with "desk-{num:03d}".
    A shared floor maps a printed prefix to an agency code with prefixMap,
    e.g. {"Q": "QGIF"} + "desk-{prefix}-{num:03d}" gives desk-QGIF-001."""
    return ID_FMT.format(area=area, num=num, prefix=PREFIXES.get(prefix, prefix))


problems = []
fmt = cfg["deskNumbers"].get("labelFormat", "{area}.{num}")

# ── numbered desks ──────────────────────────────────────────────────────────
words = re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>',
                   open(os.path.join(WORK, "words.html")).read())
desks = {}
NEAR = cfg["deskNumbers"].get("nearestDesk")   # {"radius": pt, "size": [short, long] pt, "tolerance": [lo, hi]}: numbers printed beside the desk
pending = []                                    # (id, label, area, num, prefix, cx, cy) resolved after the loop
for x0, y0, x1, y1, t in words:
    m = re.fullmatch(cfg["deskNumbers"]["pattern"], t)
    if not m:
        continue
    gd = m.groupdict()
    if "num" in gd:            # named groups: area, num and optionally prefix
        area, num, prefix = int(gd.get("area") or 0), int(gd["num"]), gd.get("prefix") or ""
    else:                      # positional: group 1 = area, group 2 = number
        area, num, prefix = int(m.group(1)), int(m.group(2)), ""
    label = fmt.format(area=area, num=num, prefix=prefix)
    cx, cy = (float(x0) + float(x1)) / 2, (float(y0) + float(y1)) / 2
    if NEAR:
        pending.append((desk_id(area, num, prefix), label, area, num, prefix, cx, cy))
        continue
    res = region_at(*to_px(cx, cy), limit=int(40 * K))
    if not res:
        problems.append(f"{label}: outline around the number isn't closed")
        continue
    i = desk_id(area, num, prefix)
    if i in desks:
        problems.append(f"{label}: printed twice")
    desks[i] = {"label": label, "area": area, "num": num, "prefix": prefix, "pts": rect_from(*res)}

if NEAR and pending:
    # Label every enclosed free area once (needs opencv), keep the desk-sized ones,
    # then pair numbers with areas closest-first so each desk gets one number.
    import cv2
    rad, (dshort, dlong) = NEAR["radius"], NEAR["size"]
    n_lab, lab, stats, _ = cv2.connectedComponentsWithStats(FREE.astype(np.uint8), connectivity=4)
    shade = np.asarray(Image.open(os.path.join(WORK, "clean.png")).convert("L"))   # desks are white inside
    cand = {}
    for k in range(1, n_lab):
        x, y, w, h, area_px = stats[k]
        if max(w, h) > 1.6 * dlong * K or min(w, h) < 0.5 * dshort * K:
            continue
        m = lab[y:y + h, x:x + w] == k
        if shade[y:y + h, x:x + w][m].mean() < 215:      # filled shapes (planters, shaded rooms)
            continue
        pts = rect_from(m, x, y)
        a_, b_ = rect_dims(pts)
        lo, hi = NEAR.get("tolerance", [0.6, 1.5])
        if lo * dshort < a_ < hi * dshort and lo * dlong < b_ < hi * dlong:
            cand[k] = ((x, y, x + w, y + h), pts)
    pairs = []
    for n, (i, label, area, num, prefix, cx, cy) in enumerate(pending):
        lx, ly = to_px(cx, cy)
        for k, (bb, pts) in cand.items():
            d = math.hypot(max(bb[0] - lx, 0, lx - bb[2]), max(bb[1] - ly, 0, ly - bb[3])) / K
            if d <= rad:
                pairs.append((d, n, k))
    used_n, used_k = set(), set()
    for d, n, k in sorted(pairs):
        if n in used_n or k in used_k:
            continue
        used_n.add(n); used_k.add(k)
        i, label, area, num, prefix, cx, cy = pending[n]
        if i in desks:
            problems.append(f"{label}: printed twice")
        desks[i] = {"label": label, "area": area, "num": num, "prefix": prefix, "pts": cand[k][1], "dist": round(d, 1)}
    for n, p in enumerate(pending):
        if n not in used_n:
            problems.append(f"{p[1]}: no desk-sized area within {rad} pt of the number")

if not desks:
    sys.exit("No desk numbers matched config.deskNumbers.pattern - check words.html")
med = np.median(np.array([rect_dims(d["pts"]) for d in desks.values()]), 0)
nums = sorted(d["num"] for d in desks.values())
missing = sorted(set(range(nums[0], nums[-1] + 1)) - set(nums))
print(f"{len(desks)} numbered desks (numbers {nums[0]}-{nums[-1]}"
      + (f", missing {missing}" if missing else "") + f"); typical desk {med[0]:.1f} x {med[1]:.1f}")
for i, d in desks.items():
    s, l = rect_dims(d["pts"])
    if not (0.7 * med[0] < s < 1.4 * med[0] and 0.7 * med[1] < l < 1.4 * med[1]):
        problems.append(f"{d['label']} ({i}): unusual size {s:.1f} x {l:.1f}")

# ── added desks (no printed number) ─────────────────────────────────────────
added = {}
for seed in cfg.get("addedDesks", {}).get("seeds", []):
    area, num = seed[0], seed[1]
    label = fmt.format(area=area, num=num, prefix="")
    if len(seed) == 6:     # [area, num, x0, y0, x1, y1]: explicit rectangle in clean.png pixels
        x0, y0, x1, y1 = seed[2:]  # (for desks drawn as images, which flood-fill can't trace)
        added[desk_id(area, num)] = {"label": label, "area": area, "num": num, "added": True,
                                     "pts": [list(to_pt(x0, y0)), list(to_pt(x1, y0)), list(to_pt(x1, y1)), list(to_pt(x0, y1))]}
        continue
    sx, sy = seed[2], seed[3]
    res = region_at(int(sx), int(sy), limit=int(40 * K))
    if not res:
        problems.append(f"{label}: no enclosed area at seed ({sx}, {sy})")
        continue
    r = rect_from(*res)
    s, l = rect_dims(r)
    if not (0.5 * med[0] < s < 1.6 * med[0] and 0.5 * med[1] < l < 1.6 * med[1]):
        problems.append(f"{label}: unusual size {s:.1f} x {l:.1f}")
    added[desk_id(area, num)] = {"label": label, "area": area, "num": num, "pts": r, "added": True}

# ── rooms ───────────────────────────────────────────────────────────────────
rooms = {}
for rid, box in cfg.get("rooms", {}).items():
    if rid.startswith("_"):
        continue
    if len(box) == 3:      # [cx, cy, r]: round table, as a 24-sided polygon
        cx, cy, r = box
        rooms[rid] = {"pts": [list(to_pt(cx + r * math.cos(a * math.pi / 12), cy + r * math.sin(a * math.pi / 12))) for a in range(24)]}
        continue
    x0, y0, x1, y1 = box
    rooms[rid] = {"pts": [list(to_pt(x0, y0)), list(to_pt(x1, y0)), list(to_pt(x1, y1)), list(to_pt(x0, y1))]}

ids = list(desks) + list(added) + list(rooms)
dupes = sorted({i for i in ids if ids.count(i) > 1})
if dupes:
    problems.append("duplicate IDs: " + ", ".join(dupes))

json.dump({"k": K, "crop": CROP, "desks": desks, "added": added, "rooms": rooms, "problems": problems},
          open(os.path.join(WORK, "shapes.json"), "w"))
print(f"{len(added)} added desks, {len(rooms)} rooms, {len(set(ids))} shapes in total")
print("check:" if problems else "nothing unusual", *problems, sep="\n  ")
