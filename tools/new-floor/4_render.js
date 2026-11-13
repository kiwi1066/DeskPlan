/**
 * Step 4: render the floor plan PNG for the app.
 *
 * Usage (from the repo root):  node tools/new-floor/4_render.js 5BS_L2
 * Reads  tools/work/<floor>/clean.svg, shapes.json
 * Writes <BUILDING>_<FLOOR>_deskPlan.png in the repo root: the cleaned plan,
 *        plus the number of every added desk (config.addedDesks) drawn in the
 *        same blue as the printed numbers, centred and running along the desk.
 */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const { ROOT, loadFloor, renderSize, svgBody } = require('./common');

(async () => {
  const { cfg, work, plan } = loadFloor(process.argv[2]);
  const S = JSON.parse(fs.readFileSync(path.join(work, 'shapes.json'), 'utf8'));
  const A = cfg.addedDesks || {};
  const { W, H } = renderSize(cfg);
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: W, height: H } });
  await p.setContent(`<body style="margin:0;background:#fff">${svgBody(path.join(work, 'clean.svg'))}</body>`);
  const placed = await p.evaluate(([added, crop, W, H, fill, size]) => {
    const s = document.querySelector('svg'); s.setAttribute('width', W); s.setAttribute('height', H);
    const NS = 'http://www.w3.org/2000/svg';
    const g = document.createElementNS(NS, 'g'); g.setAttribute('id', 'added-desk-numbers'); s.appendChild(g);
    return Object.values(added).map(d => {
      const xs = d.pts.map(q => q[0]), ys = d.pts.map(q => q[1]);
      const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2 + crop[0], cy = (Math.min(...ys) + Math.max(...ys)) / 2 + crop[1];
      const t = document.createElementNS(NS, 'text'); t.textContent = d.label;
      t.setAttribute('x', 0); t.setAttribute('y', 0);
      t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'central');
      t.setAttribute('font-family', 'Liberation Sans, Arial, Helvetica, sans-serif');
      t.setAttribute('font-size', size); t.setAttribute('fill', fill);
      // Tall desks: text reads bottom-to-top like the printed numbers
      t.setAttribute('transform', `translate(${cx} ${cy})` + (h > w ? ' rotate(-90)' : ''));
      g.appendChild(t);
      const len = t.getComputedTextLength();
      return len > Math.max(w, h) ? `${d.label} text ${len.toFixed(1)} longer than desk ${Math.max(w, h).toFixed(1)}` : null;
    }).filter(Boolean);
  }, [S.added || {}, cfg.crop, W, H, A.textFill || '#1373e8', A.fontSize || 3.85]);
  const out = path.join(ROOT, plan + '.png');
  await p.screenshot({ path: out });
  console.log(`wrote ${path.basename(out)} (${W} x ${H}px)` + (placed.length ? '\n  note: ' + placed.join('\n  note: ') : ''));
  await b.close();
})();
