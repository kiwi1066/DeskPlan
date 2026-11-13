/**
 * Step 1 of fit-shapes: dump each desk shape's outline from a floor SVG.
 *
 * Usage (from the repo root):  node tools/fit-shapes/extract.js 275G_L10_deskPlan [more plans...]
 * Writes tools/work/fit-shapes/<plan>.json  { vb:[w,h], desks:[{id, tag, pts:[[x,y]...]}] }
 * Points are in the SVG's own units with transforms applied; paths are sampled.
 */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const WORK = path.join(ROOT, 'tools', 'work', 'fit-shapes');
fs.mkdirSync(WORK, { recursive: true });

(async () => {
  const plans = process.argv.slice(2);
  if (!plans.length) { console.error('usage: node extract.js <plan> [...]'); process.exit(1); }
  const b = await chromium.launch(); const p = await b.newPage();
  for (const plan of plans) {
    const svg = fs.readFileSync(path.join(ROOT, plan + '.svg'), 'utf8').replace(/<\?xml[^>]*>/, '');
    await p.setContent(`<div style="width:1000px">${svg}</div>`);
    const data = await p.evaluate(() => {
      const root = document.querySelector('svg'); const r = root.getScreenCTM().inverse();
      return {
        vb: [root.viewBox.baseVal.width, root.viewBox.baseVal.height],
        desks: [...root.querySelectorAll('g[id^=desk]')].map(g => {
          const shapes = g.querySelectorAll('rect,polygon,path,polyline,circle,ellipse,line');
          const s = shapes[0]; if (!s) return { id: g.id, n: 0 };
          const m = r.multiply(s.getScreenCTM()); let pts = [];
          if (s.tagName === 'polygon' || s.tagName === 'polyline') {
            for (let i = 0; i < s.points.numberOfItems; i++) { const q = s.points.getItem(i); pts.push([q.x, q.y]); }
          } else if (s.tagName === 'path') {
            const L = s.getTotalLength(); for (let i = 0; i < 96; i++) { const q = s.getPointAtLength(L * i / 96); pts.push([q.x, q.y]); }
          } else {
            const bb = s.getBBox(); pts = [[bb.x, bb.y], [bb.x + bb.width, bb.y], [bb.x + bb.width, bb.y + bb.height], [bb.x, bb.y + bb.height]];
          }
          pts = pts.map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
          return { id: g.id, n: shapes.length, tag: s.tagName, pts };
        }),
      };
    });
    fs.writeFileSync(path.join(WORK, plan + '.json'), JSON.stringify(data));
    const multi = data.desks.filter(d => d.n !== 1).map(d => `${d.id}:${d.n}`);
    console.log(`${plan}: ${data.desks.length} desks` + (multi.length ? `  WARNING desks without exactly one shape: ${multi.join(' ')}` : ''));
  }
  await b.close();
})();
