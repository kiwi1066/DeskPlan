"""
Step 5: write the app files and a review image.

Usage (from the repo root):  python3 tools/new-floor/5_write.py 5BS_L2
Reads  tools/work/<floor>/shapes.json and the floor config
Writes <BUILDING>_<FLOOR>_deskPlan.svg in the repo root (one <g id="desk-...">
       per desk/room, sorted by area and desk number, rooms last),
       adds the building/floor to buildings.json if it isn't there yet,
       and tools/work/<floor>/review.png: the plan with every shape outlined
       and labelled (green = printed desks, orange = added desks, purple = rooms).
Run 4_render.js first (the review image is drawn on the PNG it makes).
"""
import json, math, os, re, sys
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))

arg = sys.argv[1] if len(sys.argv) > 1 else ""
cfg = json.load(open(arg if os.path.exists(arg) else os.path.join(HERE, "floors", arg.replace(".json", "") + ".json")))
name = f"{cfg['building']['id']}_{cfg['floor']['id']}"
WORK = os.path.join(ROOT, "tools", "work", name)
PLAN = f"{name}_deskPlan"
S = json.load(open(os.path.join(WORK, "shapes.json")))
x0, y0, x1, y1 = S["crop"]


def fmt(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def element(pts):
    def axis(i):
        (ax, ay), (bx, by) = pts[i], pts[(i + 1) % 4]
        a = math.degrees(math.atan2(by - ay, bx - ax)) % 90
        return min(a, 90 - a) < 0.5
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    if len(pts) == 4 and all(axis(i) for i in range(4)):
        return (f'<rect x="{fmt(min(xs))}" y="{fmt(min(ys))}" width="{fmt(max(xs) - min(xs))}" '
                f'height="{fmt(max(ys) - min(ys))}" fill="#a7a9ac" opacity=".3"/>')
    return '<polygon points="' + " ".join(f"{fmt(x)} {fmt(y)}" for x, y in pts) + '" fill="#a7a9ac" opacity=".3"/>'


# ── SVG ─────────────────────────────────────────────────────────────────────
items = {**S["desks"], **S["added"], **S["rooms"]}
order = sorted(items, key=lambda i: (0, items[i]["area"], items[i]["num"]) if "area" in items[i] else (1, i, 0))
lines = ['<?xml version="1.0" encoding="UTF-8"?>',
         f'<svg id="Desks" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {fmt(x1 - x0)} {fmt(y1 - y0)}">']
for i in order:
    lines += [f'  <g id="{i}">', f'    {element(items[i]["pts"])}', '  </g>']
lines.append("</svg>")
open(os.path.join(ROOT, PLAN + ".svg"), "w", newline="\n").write("\n".join(lines) + "\n")
print(f"wrote {PLAN}.svg: {len(items)} shapes, viewBox 0 0 {fmt(x1 - x0)} {fmt(y1 - y0)}")

# ── buildings.json (text insert, so the file's layout is kept) ──────────────
bpath = os.path.join(ROOT, "buildings.json")
btxt = open(bpath).read()
data = json.loads(btxt)
bid, fid = cfg["building"]["id"], cfg["floor"]["id"]
floor_entry = (f'      {{\n        "id":    "{fid}",\n        "label": "{cfg["floor"]["label"]}",\n'
               f'        "plan":  "{PLAN}.svg"\n      }}')
if bid in data and any(f["id"] == fid for f in data[bid]["floors"]):
    print("buildings.json already lists this floor - left unchanged")
elif bid in data:
    # add the floor at the end of this building's "floors": [ ... ] list
    start = re.search(r'"' + re.escape(bid) + r'"\s*:\s*\{', btxt).end()
    open_br = btxt.index("[", btxt.index('"floors"', start))
    depth, close_br = 0, None
    for pos in range(open_br, len(btxt)):
        depth += {"[": 1, "]": -1}.get(btxt[pos], 0)
        if depth == 0:
            close_br = pos
            break
    inner = btxt[open_br + 1:close_br].rstrip()
    new_inner = (inner + ",\n" if inner.strip() else "\n") + floor_entry + "\n    "
    btxt = btxt[:open_br + 1] + new_inner + btxt[close_br:]
    json.loads(btxt); open(bpath, "w").write(btxt)
    print(f"buildings.json: added {fid} to {bid}")
else:
    entry = (f'  "{bid}": {{\n    "label": "{cfg["building"]["label"]}",\n    "floors": [\n{floor_entry}\n    ]\n  }}')
    end = btxt.rstrip().rfind("}")
    head = btxt[:end].rstrip()
    btxt = head + ",\n" + entry + "\n}\n"
    json.loads(btxt); open(bpath, "w").write(btxt)
    print(f"buildings.json: added building {bid}")

# ── review image ────────────────────────────────────────────────────────────
K = S["k"]
im = Image.open(os.path.join(ROOT, PLAN + ".png")).convert("RGB")
d = ImageDraw.Draw(im, "RGBA")
try:
    fb = ImageFont.truetype("DejaVuSans-Bold.ttf", 15); fs = ImageFont.truetype("DejaVuSans-Bold.ttf", 11)
except OSError:
    fb = fs = ImageFont.load_default()


def outline(pts, col, fill):
    P = [(x * K, y * K) for x, y in pts]
    d.polygon(P, outline=col, fill=fill); d.line(P + P[:1], fill=col, width=2)
    return P


for group, col, fill in (("desks", (0, 140, 0, 255), (0, 200, 0, 45)), ("added", (220, 110, 0, 255), (255, 150, 0, 70))):
    for i, v in S[group].items():
        P = outline(v["pts"], col, fill)
        cx = sum(p[0] for p in P) / 4; yb = max(p[1] for p in P)
        t = i.replace("desk-", ""); w = d.textlength(t, font=fs)
        d.rectangle([cx - w / 2 - 2, yb + 1, cx + w / 2 + 2, yb + 14], fill=(255, 255, 255, 230))
        d.text((cx - w / 2, yb + 1), t, fill=(0, 0, 0), font=fs)
for i, v in S["rooms"].items():
    P = outline(v["pts"], (130, 0, 190, 255), (150, 0, 200, 40))
    cx = sum(p[0] for p in P) / 4; cy = sum(p[1] for p in P) / 4
    t = i.replace("desk-", ""); w = d.textlength(t, font=fb)
    d.rectangle([cx - w / 2 - 3, cy - 10, cx + w / 2 + 3, cy + 9], fill=(255, 255, 255, 235))
    d.text((cx - w / 2, cy - 9), t, fill=(110, 0, 160), font=fb)
im.save(os.path.join(WORK, "review.png"))
print(f"review image: tools/work/{name}/review.png")
