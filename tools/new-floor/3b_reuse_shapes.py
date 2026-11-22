"""
Step 3b (only when replacing an existing floor): line the floor's current PNG up
with the new clean.png, then

  - report where each current shape lands on the new plan (so rooms and lettered
    desks can be given the right IDs), and
  - optionally copy current outlines into shapes.json for desks whose layout
    hasn't changed but which 3_shapes.py can't trace well (bent Y-pod desks).

Usage (from the repo root, after 3_shapes.py, before 4_render.js):
  python3 tools/new-floor/3b_reuse_shapes.py 275G_L10 path/to/old_deskPlan.svg path/to/old_deskPlan.png [--reuse id,id,... | --reuse-unusual]

Needs opencv-python (pip install opencv-python-headless).
Writes tools/work/<floor>/old_on_new.json (old id -> centre and box in clean.png
pixels) and tools/work/<floor>/align_check.png (new plan in blue, old in green:
everything should look dark where they agree).
"""
import json, math, os, re, sys
import numpy as np, cv2

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
arg, old_svg, old_png = sys.argv[1:4]
opts = sys.argv[4:]
cfg = json.load(open(arg if os.path.exists(arg) else os.path.join(HERE, "floors", arg.replace(".json", "") + ".json")))
WORK = os.path.join(ROOT, "tools", "work", f"{cfg['building']['id']}_{cfg['floor']['id']}")
S = json.load(open(os.path.join(WORK, "shapes.json")))
new_png = os.path.join(WORK, "clean.png")

# ── align old PNG -> new clean.png (scale search + phase correlation, then ECC affine) ──
A = cv2.imread(old_png, 0); B = cv2.imread(new_png, 0)
f = 0.25
a = cv2.resize(A, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
b = cv2.resize(B, None, fx=f, fy=f, interpolation=cv2.INTER_AREA)
bf = cv2.GaussianBlur(255 - b, (0, 0), 2).astype(np.float32)
best = None
for s in np.arange(0.5, 2.0, 0.01):
    aa = cv2.resize(a, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    H, W = max(aa.shape[0], b.shape[0]), max(aa.shape[1], b.shape[1])
    pa = np.zeros((H, W), np.float32); pa[:aa.shape[0], :aa.shape[1]] = cv2.GaussianBlur(255 - aa, (0, 0), 2)
    pb = np.zeros((H, W), np.float32); pb[:bf.shape[0], :bf.shape[1]] = bf
    (dx, dy), r = cv2.phaseCorrelate(pa, pb)
    if best is None or r > best[0]:
        best = (r, s, dx, dy)
r, s, dx, dy = best
g = 0.5
W0 = np.array([[s, 0, dx / f * g], [0, s, dy / f * g]], np.float32)
a2 = cv2.GaussianBlur(255 - cv2.resize(A, None, fx=g, fy=g, interpolation=cv2.INTER_AREA), (0, 0), 2).astype(np.float32)
b2 = cv2.GaussianBlur(255 - cv2.resize(B, None, fx=g, fy=g, interpolation=cv2.INTER_AREA), (0, 0), 2).astype(np.float32)
inv = cv2.invertAffineTransform(W0).astype(np.float32)
cc, inv = cv2.findTransformECC(b2, a2, inv, cv2.MOTION_AFFINE,
                               (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 300, 1e-6), None, 5)
W0 = cv2.invertAffineTransform(inv); W0[:, 2] /= g          # old px -> new px
print(f"aligned: scale {s:.3f}, match {cc:.3f} (above about 0.8 is a good fit)")
ov = cv2.warpAffine(A, W0, (B.shape[1], B.shape[0]), borderValue=255)
cv2.imwrite(os.path.join(WORK, "align_check.png"), cv2.resize(np.dstack([B, ov, np.minimum(B, ov)]), None, fx=0.35, fy=0.35))

# old viewBox units -> new clean.png px -> new SVG units (points from crop origin)
svg = open(old_svg).read()
vb = [float(v) for v in re.search(r'viewBox="([^"]+)"', svg).group(1).split()]
k = A.shape[1] / vb[2]
M = W0 @ np.array([[k, 0, -vb[0] * k], [0, k, -vb[1] * k], [0, 0, 1]])
K = B.shape[1] / (cfg["crop"][2] - cfg["crop"][0])           # new px per point


def shape_pts(body):
    m = re.search(r'points="([^"]+)"', body)
    if m:
        v = [float(x) for x in re.split(r"[ ,]+", m.group(1).strip())]
        return list(zip(v[0::2], v[1::2]))
    m = re.search(r"<rect([^>]*)/?>", body)
    if m:
        at = dict(re.findall(r'([\w-]+)="([^"]+)"', m.group(1)))
        x, y, w, h = (float(at.get(n, 0)) for n in ("x", "y", "width", "height"))
        pts = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
        t = re.search(r"rotate\(([-\d.]+)(?:[ ,]+([-\d.]+)[ ,]+([-\d.]+))?\)", at.get("transform", ""))
        tr = re.search(r"translate\(([-\d.]+)[ ,]+([-\d.]+)\)", at.get("transform", ""))
        if t:
            ang = math.radians(float(t.group(1))); cx = float(t.group(2) or 0); cy = float(t.group(3) or 0)
            pts = [(cx + (px - cx) * math.cos(ang) - (py - cy) * math.sin(ang),
                    cy + (px - cx) * math.sin(ang) + (py - cy) * math.cos(ang)) for px, py in pts]
        if tr:
            pts = [(px + float(tr.group(1)), py + float(tr.group(2))) for px, py in pts]
        return pts
    m = re.search(r'<path[^>]*\sd="([^"]+)"', body)
    if m and re.fullmatch(r"[MLHVZmlhvz\d\s.,-]+", m.group(1)) and not re.search(r"[a-z]", m.group(1)):
        v = [float(x) for x in re.findall(r"-?\d*\.?\d+", m.group(1))]
        return list(zip(v[0::2], v[1::2]))
    return None


old = {}
for gid, body in re.findall(r'<g id="([^"]+)"[^>]*>(.*?)</g>', svg, re.S):
    pts = shape_pts(body)
    if pts:
        P = np.array([M @ [x, y, 1] for x, y in pts])
        old[gid] = P
report = {g: {"centre": [round(float(P[:, 0].mean())), round(float(P[:, 1].mean()))],
              "box": [round(float(v)) for v in (P[:, 0].min(), P[:, 1].min(), P[:, 0].max(), P[:, 1].max())]}
          for g, P in old.items()}
json.dump(report, open(os.path.join(WORK, "old_on_new.json"), "w"), indent=1)
print(f"{len(report)} current shapes placed on the new plan: old_on_new.json")

# ── reuse outlines ──
ids = []
if "--reuse-unusual" in opts:
    med = np.median(np.array([sorted((math.dist(d["pts"][0], d["pts"][1]), math.dist(d["pts"][1], d["pts"][2])))
                              for d in S["desks"].values()]), 0)
    for i, d in S["desks"].items():
        a_, b_ = sorted((math.dist(d["pts"][0], d["pts"][1]), math.dist(d["pts"][1], d["pts"][2])))
        if not (0.7 * med[0] < a_ < 1.4 * med[0] and 0.7 * med[1] < b_ < 1.4 * med[1]):
            ids.append(i)
if "--reuse" in opts:
    ids += opts[opts.index("--reuse") + 1].split(",")
done, missing = [], []
for i in ids:
    if i in old and i in S["desks"]:
        S["desks"][i]["pts"] = [[round(float(x) / K, 3), round(float(y) / K, 3)] for x, y in old[i]]
        S["desks"][i]["reused"] = True
        done.append(i)
    else:
        missing.append(i)
json.dump(S, open(os.path.join(WORK, "shapes.json"), "w"))
if ids:
    print(f"reused {len(done)} current outlines" + (f"; not found in both: {missing}" if missing else ""))
