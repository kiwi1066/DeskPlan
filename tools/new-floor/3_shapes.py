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


def desk_id(area, num):
    return f"desk-{area}{num:02d}"


problems = []
fmt = cfg["deskNumbers"].get("labelFormat", "{area}.{num}")

# ── numbered desks ──────────────────────────────────────────────────────────
words = re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>',
                   open(os.path.join(WORK, "words.html")).read())
desks = {}
for x0, y0, x1, y1, t in words:
    m = re.fullmatch(cfg["deskNumbers"]["pattern"], t)
    if not m:
        continue
    area, num = int(m.group(1)), int(m.group(2))
    label = fmt.format(area=area, num=num)
    cx, cy = (float(x0) + float(x1)) / 2, (float(y0) + float(y1)) / 2
    res = region_at(*to_px(cx, cy), limit=int(40 * K))
    if not res:
        problems.append(f"{label}: outline around the number isn't closed")
        continue
    i = desk_id(area, num)
    if i in desks:
        problems.append(f"{label}: printed twice")
    desks[i] = {"label": label, "area": area, "num": num, "pts": rect_from(*res)}

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
for area, num, sx, sy in cfg.get("addedDesks", {}).get("seeds", []):
    label = fmt.format(area=area, num=num)
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
