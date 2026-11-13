"""
Fit each desk shape to the desk outline drawn in the floor PNG.

For every desk: flood-fill the white area(s) of the PNG that the current SVG
shape covers, then
  - 4-sided desks  -> minimum-area rectangle around that area
  - other shapes   -> traced, simplified outline of that area
Results that drift too far from the current shape are rejected (desk keeps
its current shape) and listed for review.

Usage (from the repo root):
    node tools/fit-shapes/extract.js 275G_L10_deskPlan        # current shapes
    python3 tools/fit-shapes/fit.py 275G_L10_deskPlan          # this script
Reads  tools/work/fit-shapes/<plan>.json and <plan>.png (repo root)
Writes tools/work/fit-shapes/<plan>.fit.json

Line darkness differs between plans, so each floor is tried at several grey
cutoffs; the floor uses the cutoff that fits most desks, and any desk it
misses is retried at the others.
"""
import json, math, sys, os
import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))           # repo root
WORK = os.path.join(ROOT, "tools", "work", "fit-shapes")

WALL_T   = 185    # default grey cutoff: darker than this = line
GROW     = 1      # px added back after fitting (offsets the 1px line thickening; pixel-corner outline adds the rest)
MIN_IOU  = 0.6
CLOSE    = 4      # px; slits narrower than ~2x this are closed on traced outlines


def load_gray(path):
    """Greyscale plan with coloured fills (e.g. yellow desk-number circles)
    pushed to black, so they count as solid like the linework."""
    im = Image.open(path)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
        im = Image.alpha_composite(bg, im)
    rgb = np.asarray(im.convert("RGB"), dtype=np.int16)
    gray = np.asarray(im.convert("L"), dtype=np.uint8).copy()
    sat = rgb.max(axis=2) - rgb.min(axis=2)
    gray[sat > 60] = 0
    return gray


def shift_or(m, r):
    """Binary dilation with a (2r+1) square, via shifted ORs."""
    out = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx == 0 and dy == 0:
                continue
            s = np.zeros_like(m)
            ys = slice(max(dy, 0), m.shape[0] + min(dy, 0))
            yd = slice(max(-dy, 0), m.shape[0] + min(-dy, 0))
            xs = slice(max(dx, 0), m.shape[1] + min(dx, 0))
            xd = slice(max(-dx, 0), m.shape[1] + min(-dx, 0))
            s[ys, xs] = m[yd, xd]
            out |= s
    return out


def poly_mask(shape, pts):
    im = Image.new("L", (shape[1], shape[0]), 0)
    ImageDraw.Draw(im).polygon([tuple(p) for p in pts], fill=1, outline=1)
    return np.asarray(im, dtype=bool)


def components(free, seeds):
    """Label the free-space components that contain any of the seed points."""
    lab = np.zeros(free.shape, dtype=np.int32)
    h, w = free.shape
    n = 0
    for (sx, sy) in seeds:
        if not free[sy, sx] or lab[sy, sx]:
            continue
        n += 1
        stack = [(sx, sy)]
        lab[sy, sx] = n
        while stack:
            x, y = stack.pop()
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < w and 0 <= ny < h and free[ny, nx] and not lab[ny, nx]:
                    lab[ny, nx] = n
                    stack.append((nx, ny))
    return lab, n


def convex_hull(points):
    pts = sorted(set(map(tuple, points)))
    if len(pts) < 3:
        return pts
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def min_area_rect(hull):
    best = None
    H = np.array(hull, dtype=float)
    for i in range(len(H)):
        a, b = H[i], H[(i + 1) % len(H)]
        e = b - a
        L = math.hypot(*e)
        if L < 1e-9:
            continue
        u = e / L
        v = np.array([-u[1], u[0]])
        pu, pv = H @ u, H @ v
        area = (pu.max() - pu.min()) * (pv.max() - pv.min())
        if best is None or area < best[0]:
            best = (area, u, v, pu.min(), pu.max(), pv.min(), pv.max())
    _, u, v, u0, u1, v0, v1 = best
    return [list(u * a + v * b) for a, b in ((u0, v0), (u1, v0), (u1, v1), (u0, v1))]


def trace_outline(mask):
    """Outer boundary of a binary mask as an ordered list of pixel-corner points
    (marching along pixel edges)."""
    h, w = mask.shape
    m = np.zeros((h + 2, w + 2), dtype=bool)
    m[1:-1, 1:-1] = mask
    # directed boundary edges, region kept on the left
    edges = {}
    ys, xs = np.nonzero(m)
    for y, x in zip(ys, xs):
        if not m[y - 1, x]: edges[(x + 1, y)] = (x, y)          # top edge, going left
        if not m[y + 1, x]: edges[(x, y + 1)] = (x + 1, y + 1)  # bottom edge, going right
        if not m[y, x - 1]: edges[(x, y)] = (x, y + 1)          # left edge, going down
        if not m[y, x + 1]: edges[(x + 1, y + 1)] = (x + 1, y)  # right edge, going up
    if not edges:
        return []
    # start from the left-most top-most point to get the outer loop
    start = min(edges, key=lambda p: (p[0], p[1]))
    loop, p = [start], edges[start]
    while p != start and len(loop) < 200000:
        loop.append(p)
        p = edges.get(p)
        if p is None:
            break
    return [(x - 1, y - 1) for x, y in loop]


def simplify(pts, tol):
    """Douglas-Peucker on a closed loop."""
    if len(pts) < 4:
        return pts
    P = np.array(pts, dtype=float)
    # split the loop at the two points furthest apart
    i0 = 0
    d = np.hypot(*(P - P[0]).T)
    i1 = int(d.argmax())
    def dp(seg):
        if len(seg) < 3:
            return list(seg)
        a, b = seg[0], seg[-1]
        ab = b - a
        L = math.hypot(*ab)
        if L < 1e-9:
            dist = np.hypot(*(seg - a).T)
        else:
            dist = np.abs(ab[0] * (seg[:, 1] - a[1]) - ab[1] * (seg[:, 0] - a[0])) / L
        k = int(dist.argmax())
        if dist[k] > tol:
            return dp(seg[:k + 1])[:-1] + dp(seg[k:])
        return [a, b]
    first = dp(P[i0:i1 + 1])
    second = dp(np.vstack([P[i1:], P[:1]]))
    out = first[:-1] + second[:-1]
    return [list(p) for p in out]


def polygon_area(pts):
    a = 0
    for i in range(len(pts)):
        x1, y1 = pts[i - 1]; x2, y2 = pts[i]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2


def dedupe(pts, eps=0.05):
    out = []
    for p in pts:
        if not out or math.hypot(p[0] - out[-1][0], p[1] - out[-1][1]) > eps:
            out.append(p)
    if len(out) > 3 and math.hypot(out[0][0] - out[-1][0], out[0][1] - out[-1][1]) <= eps:
        out.pop()
    return out


def straighten_sides(loop, ref, k):
    """Pull inward detours (e.g. around a label drawn over the desk edge) back
    onto each straight side. Sides come from the current shape `ref`; each
    side's line is re-fitted to the traced points, ignoring outliers."""
    L = np.array(loop, dtype=float)
    R = np.array(simplify([list(p) for p in ref], 1.5), dtype=float)
    if len(R) < 3 or len(L) < 10:
        return loop
    sgn = 1 if polygon_area_signed(R) > 0 else -1
    for i in range(len(R)):
        a, b = R[i], R[(i + 1) % len(R)]
        e = b - a; ln = math.hypot(*e)
        if ln < 6 * k:                      # only sides longer than ~6 units
            continue
        u = e / ln
        n = np.array([u[1], -u[0]]) * sgn   # outward normal
        rel = L - a
        t, d = rel @ u, rel @ n
        band = (t > 0.08 * ln) & (t < 0.92 * ln) & (np.abs(d) < 4 * k)
        if band.sum() < 8:
            continue
        med = np.median(d[band])
        core = band & (np.abs(d - med) < 2.0)
        if core.sum() < 6:
            continue
        P = L[core]; c = P.mean(0)
        _, _, vt = np.linalg.svd(P - c)
        u2 = vt[0] if vt[0] @ u > 0 else -vt[0]
        n2 = np.array([u2[1], -u2[0]]) * sgn
        d2 = (L - c) @ n2
        fix = band & (d2 < -1.5)            # inward of the fitted side
        L[fix] = L[fix] - np.outer(d2[fix], n2)
    return [list(p) for p in L]


def polygon_area_signed(P):
    x, y = P[:, 0], P[:, 1]
    return 0.5 * (np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def is_quad(pts):
    """True if the outline is (close to) a 4-sided shape."""
    p = dedupe(pts)
    if len(p) == 4:
        return True
    s = simplify(p, 0.15) if len(p) > 4 else p
    return len(s) == 4


def fit_desk(gray, k, desk, wall_t=None):
    wall_t = wall_t or WALL_T
    src = [[x * k, y * k] for x, y in desk["pts"]]
    quad = is_quad(desk["pts"])
    xs = [p[0] for p in src]; ys = [p[1] for p in src]
    bw, bh = max(xs) - min(xs), max(ys) - min(ys)
    pad = int(max(25, 0.6 * max(bw, bh)))
    x0 = max(0, int(min(xs)) - pad); y0 = max(0, int(min(ys)) - pad)
    x1 = min(gray.shape[1], int(max(xs)) + pad); y1 = min(gray.shape[0], int(max(ys)) + pad)
    win = gray[y0:y1, x0:x1]
    loc = [[x - x0, y - y0] for x, y in src]

    wall = shift_or(win < wall_t, 1)
    free = ~wall
    orig = poly_mask(win.shape, loc)
    orig_area = orig.sum()
    if orig_area < 20:
        return None, "tiny"

    # seeds: grid points inside the current shape
    step = max(2, int(min(bw, bh) / 8))
    seeds = [(x, y) for y in range(0, win.shape[0], step) for x in range(0, win.shape[1], step)
             if orig[y, x] and free[y, x]]
    lab, n = components(free, seeds)
    if n == 0:
        return None, "no free space"

    region = np.zeros_like(free)
    for c in range(1, n + 1):
        comp = lab == c
        size = comp.sum()
        inside = (comp & orig).sum()
        if size >= 0.02 * orig_area and inside >= 0.6 * size:
            region |= comp
    if not region.any():
        return None, "no component mostly inside"
    if region[0, :].any() or region[-1, :].any() or region[:, 0].any() or region[:, -1].any():
        return None, "leak to window edge"

    region = shift_or(region, GROW)

    if quad:
        ys_, xs_ = np.nonzero(region)
        pts = np.stack([xs_, ys_], 1)
        # pixel corners so the rect covers whole pixels
        corners = np.vstack([pts, pts + [1, 0], pts + [0, 1], pts + [1, 1]])
        hull = convex_hull(corners.tolist())
        new = min_area_rect(hull)
    else:
        # fill holes (labels, symbols inside the desk)
        inv = ~region
        lab2, _ = components(inv, [(0, 0)])
        outside = lab2 == 1
        solid = ~outside
        # Labels (hexagons with text) drawn over the desk edge hide the edge.
        # Inside each label's footprint, fall back to the current shape.
        near = shift_or(orig, int(2 * k))
        lseeds = [(x, y) for y in range(0, win.shape[0], 2) for x in range(0, win.shape[1], 2)
                  if near[y, x] and free[y, x] and not region[y, x]]
        llab, ln_ = components(free & ~region, lseeds)
        for c in range(1, ln_ + 1):
            comp = llab == c
            if comp.sum() < 0.2 * orig_area and not (comp[0, :].any() or comp[-1, :].any()
                                                      or comp[:, 0].any() or comp[:, -1].any()):
                solid |= shift_or(comp, 3) & orig
        # Close thin slits left by lines that touch the edge from inside
        # (e.g. a label hexagon drawn against the desk edge): dilate, then erode
        solid = ~shift_or(~shift_or(solid, CLOSE), CLOSE)
        loop = trace_outline(solid)
        loop = straighten_sides(loop, loc, k)
        new = simplify(loop, 1.0)

    new_mask = poly_mask(win.shape, new)
    inter = (new_mask & orig).sum(); union = (new_mask | orig).sum()
    iou = inter / union if union else 0
    ratio = new_mask.sum() / orig_area
    if iou < MIN_IOU or not (0.6 < ratio < 1.6):
        return None, f"rejected iou={iou:.2f} ratio={ratio:.2f}"

    new_svg = [[(x + x0) / k, (y + y0) / k] for x, y in new]
    return {"pts": new_svg, "quad": quad, "iou": round(float(iou), 3), "ratio": round(float(ratio), 3)}, "ok"


THRESHOLDS = [185, 205, 215, 235]


def main():
    for plan in sys.argv[1:]:
        data = json.load(open(os.path.join(WORK, plan + ".json")))
        gray = load_gray(os.path.join(ROOT, plan + ".png"))
        k = gray.shape[1] / data["vb"][0]
        desks = [d for d in data["desks"] if d.get("pts")]
        runs = {}
        for t in THRESHOLDS:
            runs[t] = {d["id"]: fit_desk(gray, k, d, t) for d in desks}
        # Floor-wide cutoff = the one that fits most desks; others fill gaps
        best_t = max(THRESHOLDS, key=lambda t: sum(1 for r, _ in runs[t].values() if r))
        order = [best_t] + [t for t in THRESHOLDS if t != best_t]
        out, notes, used = {}, {}, {}
        for d in desks:
            for t in order:
                r, why = runs[t][d["id"]]
                if r:
                    out[d["id"]] = r; used[d["id"]] = t
                    break
            else:
                notes[d["id"]] = runs[best_t][d["id"]][1]
        json.dump({"k": k, "cutoff": best_t, "fits": out, "rejected": notes, "used": used},
                  open(os.path.join(WORK, plan + ".fit.json"), "w"))
        ious = sorted(v["iou"] for v in out.values())
        other = sum(1 for t in used.values() if t != best_t)
        print(f"{plan}: cutoff {best_t}, fitted {len(out)}/{len(desks)} ({other} via other cutoffs), "
              f"kept {len(notes)}; IoU vs current min {ious[0] if ious else '-'} median {ious[len(ious)//2] if ious else '-'}")
        for i, w in notes.items():
            print("   kept", i, "-", w)


if __name__ == "__main__":
    main()
