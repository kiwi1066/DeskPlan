/**
 * Step 1: convert the plan PDF to SVG + text positions, and list every drawn
 * element with its style and position so clean-up rules can be written.
 *
 * Usage (from the repo root):
 *   node tools/new-floor/1_prepare.js 5BS_L2 "path/to/plan.pdf"
 * Needs poppler (pdftocairo, pdftotext) on the PATH.
 * Writes to tools/work/<floor>/:
 *   plan.svg     the PDF as SVG
 *   words.html   text with positions (desk numbers come from here)
 *   tagged.svg   plan.svg with a data-i index on every drawn element
 *   inv.json     per element: index, tag, fill, stroke, stroke width, bbox (PDF points)
 * and prints a summary of the styles used, most common first.
 */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { loadFloor, svgBody } = require('./common');

(async () => {
  const { work } = loadFloor(process.argv[2]);
  const pdf = process.argv[3];
  if (!pdf || !fs.existsSync(pdf)) { console.error('PDF not found: ' + pdf); process.exit(1); }

  execFileSync('pdftocairo', ['-svg', pdf, path.join(work, 'plan.svg')]);
  execFileSync('pdftotext', ['-bbox', pdf, path.join(work, 'words.html')]);

  const b = await chromium.launch(); const p = await b.newPage();
  await p.setContent(`<body style="margin:0">${svgBody(path.join(work, 'plan.svg'))}</body>`);
  const inv = await p.evaluate(() => {
    const root = document.querySelector('svg'); const rinv = root.getScreenCTM().inverse(); const out = [];
    const els = [...root.querySelectorAll('path,use')].filter(e => !e.closest('defs'));
    els.forEach((e, i) => {
      e.setAttribute('data-i', i);
      let bb; try { bb = e.getBBox(); } catch { return; }
      const m = rinv.multiply(e.getScreenCTM());
      const pts = [[bb.x, bb.y], [bb.x + bb.width, bb.y], [bb.x, bb.y + bb.height], [bb.x + bb.width, bb.y + bb.height]]
        .map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
      const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
      const attr = n => e.getAttribute(n) ?? e.parentElement.getAttribute(n);
      out.push({ i, tag: e.tagName, x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys),
                 fill: attr('fill'), stroke: attr('stroke'), sw: attr('stroke-width') });
    });
    return out;
  });
  fs.writeFileSync(path.join(work, 'inv.json'), JSON.stringify(inv));
  const tagged = await p.evaluate(() => document.querySelector('svg').outerHTML);
  fs.writeFileSync(path.join(work, 'tagged.svg'), '<?xml version="1.0" encoding="UTF-8"?>\n' + tagged);
  await b.close();

  // Style summary
  const count = {};
  inv.forEach(e => { const k = `${e.tag}  fill=${e.fill}  stroke=${e.stroke}  width=${e.sw}`; count[k] = (count[k] || 0) + 1; });
  console.log(`${inv.length} drawn elements. Styles, most common first:`);
  Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 40).forEach(([k, n]) => console.log(String(n).padStart(6), k));
  const words = (fs.readFileSync(path.join(work, 'words.html'), 'utf8').match(/<word /g) || []).length;
  console.log(`${words} text words with positions in words.html`);
})();
