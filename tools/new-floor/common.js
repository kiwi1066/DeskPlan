// Shared helpers for the new-floor scripts.
const fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');          // repo root

/** Load a floor config (path or bare name like "5BS_L2") and its work folder. */
function loadFloor(arg) {
  if (!arg) { console.error('usage: node <script> <floor config, e.g. 5BS_L2>'); process.exit(1); }
  const file = fs.existsSync(arg) ? arg : path.join(__dirname, 'floors', arg.replace(/\.json$/, '') + '.json');
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const name = `${cfg.building.id}_${cfg.floor.id}`;
  const work = path.join(ROOT, 'tools', 'work', name);
  fs.mkdirSync(work, { recursive: true });
  return { cfg, name, work, plan: `${name}_deskPlan` };
}

/** Render size for the cropped plan at the configured width. */
function renderSize(cfg) {
  const [x0, y0, x1, y1] = cfg.crop;
  const W = cfg.renderWidth;
  return { W, H: Math.round(W * (y1 - y0) / (x1 - x0)) };
}

const svgBody = file => fs.readFileSync(file, 'utf8').replace(/<\?xml[^>]*>/, '');

module.exports = { ROOT, loadFloor, renderSize, svgBody };
