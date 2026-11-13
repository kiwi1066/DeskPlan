"""
Rewrite desk shapes in an SVG plan from <plan>.fit.json.

Only the geometry of each fitted desk's shape changes. The <g id> wrapper,
the order of desks and every other attribute (fill, opacity, stroke...)
are kept. Axis-aligned rectangles are written as <rect>, everything else
as <polygon>.

Usage (from the repo root): python3 tools/fit-shapes/write_svg.py 275G_L10_deskPlan [...]
Reads tools/work/fit-shapes/<plan>.fit.json and rewrites <plan>.svg in place.
Check the review images first; git diff / git checkout undo it.
"""
import json, math, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
WORK = os.path.join(ROOT, "tools", "work", "fit-shapes")
GEOM = {"x", "y", "width", "height", "transform", "points", "d", "rx", "ry"}
ATTR = re.compile(r'([\w:-]+)\s*=\s*"([^"]*)"')


def fmt(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def axis_rect(pts):
    """(x, y, w, h) if the 4 points form an axis-aligned rectangle."""
    if len(pts) != 4:
        return None
    for i in range(4):
        (x1, y1), (x2, y2) = pts[i], pts[(i + 1) % 4]
        ang = math.degrees(math.atan2(y2 - y1, x2 - x1)) % 90
        if min(ang, 90 - ang) > 0.25:
            return None
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)


def new_element(old, pts):
    tag = re.match(r"<(\w+)", old).group(1)
    attrs = [(k, v) for k, v in ATTR.findall(old) if k not in GEOM]
    r = axis_rect(pts)
    if r:
        x, y, w, h = r
        geom = f'x="{fmt(x)}" y="{fmt(y)}" width="{fmt(w)}" height="{fmt(h)}"'
        tag = "rect"
    else:
        geom = 'points="' + " ".join(f"{fmt(px)} {fmt(py)}" for px, py in pts) + '"'
        tag = "polygon"
    rest = " ".join(f'{k}="{v}"' for k, v in attrs)
    return f"<{tag} {geom}" + (f" {rest}" if rest else "") + "/>"


def main():
    for plan in sys.argv[1:]:
        path = os.path.join(ROOT, plan + ".svg")
        svg = open(path, encoding="utf-8").read()
        fits = json.load(open(os.path.join(WORK, plan + ".fit.json")))["fits"]
        done = 0
        for desk_id, f in fits.items():
            pat = re.compile(r'(<g\s+id="' + re.escape(desk_id) + r'"[^>]*>\s*)(<(?:rect|polygon|path)\b[^>]*?/>)', re.S)
            m = pat.search(svg)
            if not m:
                print("   not found:", desk_id)
                continue
            svg = svg[:m.start(2)] + new_element(m.group(2), f["pts"]) + svg[m.end(2):]
            done += 1
        open(path, "w", encoding="utf-8", newline="").write(svg)
        print(f"{plan}: rewrote {done}/{len(fits)} desk shapes")


if __name__ == "__main__":
    main()
