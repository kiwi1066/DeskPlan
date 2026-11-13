/**
 * Helper: see what a group of elements is. Each group is drawn red over a
 * faded copy of the plan.
 *
 * Usage (from the repo root):
 *   node tools/new-floor/highlight.js 5BS_L2 groups.json [x y w h]
 * groups.json: { "name": [element indices from inv.json], ... }
 * Optional x y w h = area to show, in PDF points (default: the config crop).
 * Writes tools/work/<floor>/hl_<name>.png per group.
 */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const { loadFloor, svgBody } = require('./common');

(async () => {
  const { cfg, work } = loadFloor(process.argv[2]);
  const groups = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const [x, y, w, h] = process.argv.length >= 8 ? process.argv.slice(4, 8).map(Number)
    : [cfg.crop[0], cfg.crop[1], cfg.crop[2] - cfg.crop[0], cfg.crop[3] - cfg.crop[1]];
  const W = 1700, H = Math.round(W * h / w);
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: W, height: H } });
  await p.setContent(`<body style="margin:0;background:#fff">${svgBody(path.join(work, 'tagged.svg'))}</body>`);
  await p.evaluate(([x, y, w, h, W, H]) => {
    const s = document.querySelector('svg'); s.setAttribute('viewBox', `${x} ${y} ${w} ${h}`); s.setAttribute('width', W); s.setAttribute('height', H);
  }, [x, y, w, h, W, H]);
  for (const [name, ids] of Object.entries(groups)) {
    await p.evaluate(ids => {
      const on = new Set(ids.map(String));
      document.querySelectorAll('[data-i]').forEach(e => {
        const hit = on.has(e.getAttribute('data-i'));
        e.style.opacity = hit ? '1' : '0.15';
        const fill = e.getAttribute('fill') || e.parentElement.getAttribute('fill') || 'none';
        e.style.stroke = hit ? '#e00' : ''; e.style.fill = hit && fill !== 'none' ? '#e00' : '';
      });
    }, ids);
    await p.screenshot({ path: path.join(work, `hl_${name}.png`) });
    console.log(`hl_${name}.png  (${ids.length} elements)`);
  }
  await b.close();
})();
