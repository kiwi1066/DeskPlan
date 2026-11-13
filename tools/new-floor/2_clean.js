/**
 * Step 2: clean the plan using the rules in the floor config.
 *
 * Usage (from the repo root):  node tools/new-floor/2_clean.js 5BS_L2
 * Reads  tools/work/<floor>/tagged.svg, inv.json
 * Writes tools/work/<floor>/clean.svg   cleaned plan, cropped to config.crop
 *                           clean.png   render at config.renderWidth (pick room/seed pixels from this)
 *                           fit.png     same with all glyph text hidden (used to find outlines)
 *
 * Rules (config.clean), each optional:
 *   removeFill / removeStroke   colour prefixes; matching elements are removed (e.g. tenancy shading)
 *   removeFilledPaths           filled <path>s in these colours are removed (text drawn as shapes)
 *   hatchStroke                 strokes in these colours whose segments are all diagonal (hatching)
 *   recolourStroke              [[from prefix, to colour], ...]
 *   whiteMasks                  remove white patches with nothing drawn on top, plus the small
 *                               text they were hiding (keeps longer lines such as desk edges)
 *   smallStrokeText             small strokes in a colour, away from the outer walls (room numbers)
 *   removeElements              explicit element indices from inv.json
 * Anything outside config.crop is always removed (title block, tables, legend).
 */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const { loadFloor, renderSize, svgBody } = require('./common');

const starts = (v, list) => !!v && (list || []).some(x => v.startsWith(x));

(async () => {
  const { cfg, work } = loadFloor(process.argv[2]);
  const C = cfg.clean || {};
  const inv = JSON.parse(fs.readFileSync(path.join(work, 'inv.json'), 'utf8'));
  const [X0, Y0, X1, Y1] = cfg.crop;
  const inCrop = e => e.x0 > X0 && e.x0 < X1 && e.y0 > Y0 && e.y0 < Y1;

  // Rules that need the whole inventory are worked out here
  const drop = new Set((C.removeElements || []).map(String));
  if (C.whiteMasks) {
    const big = e => Math.max(e.x1 - e.x0, e.y1 - e.y0);
    for (const m of inv.filter(e => starts(e.fill, ['rgb(100%, 100%, 100%)']) && inCrop(e))) {
      const inside = x => x.x0 >= m.x0 - 0.2 && x.x1 <= m.x1 + 0.2 && x.y0 >= m.y0 - 0.2 && x.y1 <= m.y1 + 0.2;
      const after = inv.filter(x => x.i > m.i && inside(x));
      const under = inv.filter(x => x.i < m.i && inside(x));
      if (!after.length && under.length) {
        drop.add(String(m.i));
        under.filter(x => big(x) < 4 && !starts(x.fill, ['rgb(100%, 100%'])).forEach(x => drop.add(String(x.i)));
      }
    }
  }
  if (C.smallStrokeText) {
    const s = C.smallStrokeText, [px0, py0, px1, py1] = s.perimeter;
    inv.filter(e => starts(e.stroke, [s.stroke]) && Math.max(e.x1 - e.x0, e.y1 - e.y0) < s.maxSize)
       .filter(e => Math.min(Math.abs(e.x0 - px0), Math.abs(e.x1 - px1)) > s.margin &&
                    Math.min(Math.abs(e.y0 - py0), Math.abs(e.y1 - py1)) > s.margin)
       .forEach(e => drop.add(String(e.i)));
  }

  const b = await chromium.launch(); const p = await b.newPage();
  await p.setContent(`<body style="margin:0">${svgBody(path.join(work, 'tagged.svg'))}</body>`);
  const report = await p.evaluate(([C, crop, dropList]) => {
    const [X0, Y0, X1, Y1] = crop; const extra = new Set(dropList);
    const starts = (v, list) => !!v && (list || []).some(x => v.startsWith(x));
    const root = document.querySelector('svg'); const rinv = root.getScreenCTM().inverse();
    const st = (e, n) => e.getAttribute(n) ?? e.parentElement?.getAttribute(n) ?? '';
    const rm = { outside: 0, listed: 0, colour: 0, filledText: 0, hatch: 0 }; let recoloured = 0;
    for (const e of [...root.querySelectorAll('path,use')].filter(e => !e.closest('defs'))) {
      let bb; try { bb = e.getBBox(); } catch { continue; }
      const m = rinv.multiply(e.getScreenCTM());
      const P = [[bb.x, bb.y], [bb.x + bb.width, bb.y + bb.height]].map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
      const x0 = Math.min(P[0][0], P[1][0]), x1 = Math.max(P[0][0], P[1][0]), y0 = Math.min(P[0][1], P[1][1]), y1 = Math.max(P[0][1], P[1][1]);
      const fill = st(e, 'fill'), stroke = st(e, 'stroke');
      const out = why => { rm[why]++; e.remove(); };
      if (extra.has(e.getAttribute('data-i'))) { out('listed'); continue; }
      if (x1 < X0 || x0 > X1 || y1 < Y0 || y0 > Y1 - 2) { out('outside'); continue; }
      if (starts(fill, C.removeFill) || starts(stroke, C.removeStroke)) { out('colour'); continue; }
      if (e.tagName === 'path' && starts(fill, C.removeFilledPaths)) { out('filledText'); continue; }
      if (e.tagName === 'path' && starts(stroke, C.hatchStroke)) {
        const d = e.getAttribute('d') || '';
        const pts = (d.match(/[ML]\s*[-\d.]+\s+[-\d.]+/g) || []).map(s => s.slice(1).trim().split(/\s+/).map(Number));
        let diag = pts.length >= 2, segs = 0;
        for (let i = 1; i < pts.length; i++) {
          const dx = Math.abs(pts[i][0] - pts[i - 1][0]), dy = Math.abs(pts[i][1] - pts[i - 1][1]);
          if (dx < 0.05 && dy < 0.05) continue;
          segs++; const r = dx / (dy || 1e-9); if (!(r > 0.4 && r < 2.5)) diag = false;
        }
        if (diag && segs && !/C/.test(d)) { out('hatch'); continue; }
      }
      for (const [from, to] of C.recolourStroke || []) if (starts(stroke, [from])) { e.setAttribute('stroke', to); recoloured++; }
    }
    root.setAttribute('viewBox', `${X0} ${Y0} ${X1 - X0} ${Y1 - Y0}`);
    root.removeAttribute('width'); root.removeAttribute('height');
    return { removed: rm, recoloured };
  }, [C, cfg.crop, [...drop]]);
  console.log(JSON.stringify(report));

  fs.writeFileSync(path.join(work, 'clean.svg'),
    '<?xml version="1.0" encoding="UTF-8"?>\n' + await p.evaluate(() => document.querySelector('svg').outerHTML));
  const { W, H } = renderSize(cfg);
  await p.setViewportSize({ width: W, height: H });
  await p.evaluate(([W, H]) => { const s = document.querySelector('svg'); s.setAttribute('width', W); s.setAttribute('height', H); document.body.style.background = '#fff'; }, [W, H]);
  await p.screenshot({ path: path.join(work, 'clean.png') });
  await p.evaluate(() => document.querySelectorAll('use').forEach(u => { u.style.display = 'none'; }));
  await p.screenshot({ path: path.join(work, 'fit.png') });
  console.log(`clean.png / fit.png: ${W} x ${H}px`);
  await b.close();
})();
