"""
Step 3 of fit-shapes: review images. Current shapes are drawn red, fitted
shapes green, on the floor PNG.

Usage (from the repo root):
    python3 tools/fit-shapes/review.py 275G_L10_deskPlan          # sheet of the riskiest desks
    python3 tools/fit-shapes/review.py 275G_L10_deskPlan 9        # ...showing 9 of them
Writes tools/work/fit-shapes/review_<plan>.png (the desks whose new shape
differs most from the current one, plus any that were kept unchanged) and
tools/work/fit-shapes/overlay_<plan>.png (whole floor).
"""
import json, os, sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
WORK = os.path.join(ROOT, "tools", "work", "fit-shapes")

plan = sys.argv[1]
N = int(sys.argv[2]) if len(sys.argv) > 2 else 6
data = json.load(open(os.path.join(WORK, plan + ".json")))
fit = json.load(open(os.path.join(WORK, plan + ".fit.json")))
k = fit["k"]

im = Image.open(os.path.join(ROOT, plan + ".png")).convert("RGB")
d = ImageDraw.Draw(im)
by = {x["id"]: x for x in data["desks"]}
for desk in data["desks"]:
    if not desk.get("pts"):
        continue
    d.line([(x * k, y * k) for x, y in desk["pts"] + desk["pts"][:1]], fill=(255, 0, 0), width=1)
    f = fit["fits"].get(desk["id"])
    if f:
        d.line([(x * k, y * k) for x, y in f["pts"] + f["pts"][:1]], fill=(0, 170, 0), width=1)
im.save(os.path.join(WORK, f"overlay_{plan}.png"))

worst = sorted(fit["fits"].items(), key=lambda kv: kv[1]["iou"])[:N] + [(i, None) for i in fit["rejected"]]
tiles = []
for i, f in worst:
    xs = [p[0] * k for p in by[i]["pts"]]; ys = [p[1] * k for p in by[i]["pts"]]
    w = max(xs) - min(xs); h = max(ys) - min(ys); pad = max(w, h) * 0.35 + 10
    c = im.crop((int(min(xs) - pad), int(min(ys) - pad), int(max(xs) + pad), int(max(ys) + pad)))
    s = 260 / max(c.size); c = c.resize((max(1, int(c.width * s)), max(1, int(c.height * s))))
    t = Image.new("RGB", (270, 290), "white"); t.paste(c, (5, 25))
    ImageDraw.Draw(t).text((5, 5), f"{i} " + (f"match {f['iou']}" if f else "KEPT (not fitted)"), fill=(0, 0, 0))
    tiles.append(t)
cols = 3; rows = max(1, (len(tiles) + cols - 1) // cols)
sheet = Image.new("RGB", (cols * 270, rows * 290), "white")
for n, t in enumerate(tiles):
    sheet.paste(t, ((n % cols) * 270, (n // cols) * 290))
sheet.save(os.path.join(WORK, f"review_{plan}.png"))
print(f"wrote review_{plan}.png and overlay_{plan}.png in tools/work/fit-shapes/")
