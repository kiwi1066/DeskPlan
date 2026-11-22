# DeskPlan tools

Scripts for preparing floor plans. Nothing here is loaded by the app; the app only
uses the `<BUILDING>_<FLOOR>_deskPlan.png` / `.svg` files and `buildings.json` in the
repo root.

- `new-floor/` turns a floor plan PDF into the files the app needs (how 5BS Level 2 was made).
- `fit-shapes/` re-fits the desk shapes in an existing floor's SVG to the desk outlines
  in its PNG (how the 1WS, 275G and 400G shapes were corrected).

Run every command from the **repo root**. Working files go in `tools/work/` (not committed).

## Setup

Needs Node.js, Python 3 and poppler.

```bash
cd tools
npm install
npx playwright install chromium
cd ..
```

Python packages and poppler (`pdftocairo`, `pdftotext`) with Miniforge:

```bash
conda install -c conda-forge numpy pillow poppler
```

`3b_reuse_shapes.py` and the `nearestDesk` option also need opencv: `pip install opencv-python-headless`.

## Adding a new floor from a PDF

Works with PDFs that hold real linework and text: exported from CAD, or printed to PDF from
a drawing program. A scanned PDF (just a picture) won't work this way.

### 1. Create a floor config

Copy `new-floor/floors/5BS_L2.json` to `new-floor/floors/<BUILDING>_<FLOOR>.json` and set
`building` (short code + label) and `floor` (id + label). The rest is filled in as you go.

### 2. Prepare

```bash
node tools/new-floor/1_prepare.js <BUILDING>_<FLOOR> "path/to/plan.pdf"
```

Converts the PDF and prints every style it uses (colour, line width), most common first.
Desk numbers must come through as text: check `tools/work/<floor>/words.html`.

### 3. Work out the clean-up rules

Print-to-PDF loses CAD layer names, so things are recognised by style and position.
Use `highlight.js` to see what a style draws: make a JSON file of groups of element
indices from `tools/work/<floor>/inv.json`, then

```bash
node tools/new-floor/highlight.js <BUILDING>_<FLOOR> groups.json
```

draws each group red over a faded plan (`tools/work/<floor>/hl_<group>.png`).

Then fill in the config:

| Setting | What it is |
|---|---|
| `crop` | `[x0, y0, x1, y1]` in PDF points: the building plus a margin. Everything outside (title block, tables, legend) is removed. |
| `renderWidth` | Width of the app PNG in pixels. Pick it so there are about 4.2 px per crop unit (crop width × 4.17), like the other floors. |
| `clean.removeFill` / `removeStroke` | Colour prefixes to remove, e.g. tenancy shading. |
| `clean.removeFilledPaths` | Filled shapes in these colours are removed (text drawn as shapes, e.g. room numbers). |
| `clean.hatchStroke` | Strokes in these colours whose segments are all diagonal are removed (hatching). |
| `clean.recolourStroke` | `[[from, to], ...]`, e.g. red tenancy walls to wall grey. |
| `clean.whiteMasks` | Removes white patches the drafter used to hide text, and the small text under them. |
| `clean.smallStrokeText` | Small strokes in one colour, away from the outer walls (room numbers drawn as outlines). |
| `clean.removeElements` | Specific element indices from `inv.json` that no rule catches. |
| `deskNumbers.pattern` | Regex matching a desk number in `words.html`. Group 1 = work area, group 2 = desk number. |
| `deskNumbers.labelFormat` | How a number is written, e.g. `W2.{area}.{num}`. |
| `deskNumbers.idFormat` | How an ID is built from the number. Default `desk-{area}{num:02d}` (`W2.14.84` → `desk-1484`). 275G uses `desk-{num:03d}` so IDs stay `desk-001` … |
| `deskNumbers.prefixMap` | For a floor shared by agencies whose numbers overlap: a named group `prefix` in the pattern, mapped to an agency code, e.g. `{"Q": "QGIF", "R": "RSHQ"}` with `idFormat` `desk-{prefix}-{num:03d}` → `desk-QGIF-001`. The app treats `desk-<UPPERCASE>-<number>` as a desk. |
| `deskNumbers.nearestDesk` | `{"radius": pt, "size": [short, long] pt, "tolerance": [lo, hi]}` for plans that print each number *beside* its desk (275G L18). Each number is paired with the nearest white, desk-sized enclosed area, closest pairs first, one desk per number. Needs opencv. |
| `clean.fitHideNumberTags` | Padding in PDF points. Hides the small tag drawn round each desk number in `fit.png` only, so the desk outline is found rather than the tag (275G L9/L10). |
| `wallThreshold` | Grey level (0-255) darker than which counts as a line when finding outlines. 200 suits most plans. |

Python-style named groups (`(?P<num>\d+)`) can be used in `deskNumbers.pattern`; groups `area`, `num` and `prefix`
are read by name if present, otherwise group 1 = area and group 2 = number.

The colour values are the exact strings from the style list (`rgb(32.899475%, ...)`); a
prefix such as `rgb(32.89` is enough.

### 4. Clean

```bash
node tools/new-floor/2_clean.js <BUILDING>_<FLOOR>
```

Look at `tools/work/<floor>/clean.png`. Adjust the rules and re-run until only walls,
doors, stairs, lifts, furniture, room names and desk numbers are left.

### 5. Desks without numbers, and rooms

Both are given in **pixels of `clean.png`** (open it in an image viewer that shows the cursor
position, or ask Claude to read them off zoomed crops):

- `addedDesks.seeds`: `[area, number, x, y]` per desk with no printed number, with x, y a
  point on the desk's work surface. Continue the plan's own numbering pattern.
  A seed can also be an explicit rectangle `[area, number, x0, y0, x1, y1]`, for desks the outline search can't
  trace (e.g. desks added as PDF markup, which comes through as an image). Set `addedDesks.drawNumbers` to `false`
  when the plan already prints those numbers.
- `rooms`: `"desk-office-01": [x0, y0, x1, y1]` per bookable room, on the wall centre lines.
  `[cx, cy, r]` gives a round shape (for a round meeting table). On the 275G floors, meeting rooms are the
  table rather than the whole room.
  Use the app's space types: `desk-office-NN`, `desk-quiet-NN`, `desk-meet-NN`,
  `desk-booth-NN`, `desk-mp-NN`, `desk-hot-NN`. Leave out kitchens, utility, stores and so on.

### 6. Shapes, image, files

```bash
python3 tools/new-floor/3_shapes.py <BUILDING>_<FLOOR>
node tools/new-floor/4_render.js <BUILDING>_<FLOOR>
python3 tools/new-floor/5_write.py <BUILDING>_<FLOOR>
```

- `3_shapes.py` finds each numbered desk by flood-filling from its number, plus the added
  desks and rooms. Desk IDs are work area + desk number: `W2.14.84` becomes `desk-1484`.
  It lists anything unusual (odd-sized desks, open outlines, duplicate IDs).
- `4_render.js` writes the app PNG, with blue numbers drawn on the added desks.
- `5_write.py` writes the app SVG, adds the floor to `buildings.json` if it isn't
  there, and makes `tools/work/<floor>/review.png`: every shape outlined and labelled
  (green = printed desks, orange = added desks, purple = rooms).

### Replacing an existing floor

Keep the IDs people's saved assignments use. After `3_shapes.py`:

```bash
python3 tools/new-floor/3b_reuse_shapes.py <BUILDING>_<FLOOR> <current>_deskPlan.svg <current>_deskPlan.png --reuse-unusual
```

It lines the floor's current PNG up with the new `clean.png` (check `tools/work/<floor>/align_check.png`),
writes `old_on_new.json` (where every current shape lands on the new plan, for giving rooms and renamed desks the
right IDs), and with `--reuse-unusual` copies the current outlines of desks the new run found an odd size (bent
Y-pod desks). Needs opencv (`pip install opencv-python-headless`).

PDF markup (comment boxes) isn't converted by poppler: flatten it into the page first, and pre-rotate the page if the
plan is drawn at a different angle to the floor's other levels, e.g. with PyMuPDF
(`doc.bake(); page.set_rotation(270); doc.save(...)`).

### 7. Check, then commit

Check `review.png`, then load the floor in the app (`python -m http.server 8765`) and confirm
the summary counts. Commit the PNG, SVG, `buildings.json` and the floor config.

## Re-fitting the shapes of an existing floor

For an existing floor whose desk shapes don't line up with its PNG.

```bash
node tools/fit-shapes/extract.js 275G_L10_deskPlan
python3 tools/fit-shapes/fit.py 275G_L10_deskPlan
python3 tools/fit-shapes/review.py 275G_L10_deskPlan
python3 tools/fit-shapes/write_svg.py 275G_L10_deskPlan
```

- `extract.js` reads the current shapes from the SVG.
- `fit.py` measures each desk's outline in the PNG, using the current shape as the starting
  point. Straight desks become best-fit rectangles; bent desks get a traced outline. A result
  that differs too much from the current shape is rejected, and that desk keeps its shape.
- `review.py` writes `tools/work/fit-shapes/review_<plan>.png` (the desks that changed most,
  red = current, green = new) and `overlay_<plan>.png` (the whole floor). **Look at these
  before the next step.**
- `write_svg.py` rewrites the SVG. IDs, order and styling stay; only the outlines change.
  `git diff` shows the change, and `git checkout <file>` undoes it.

Several plans can be given at once to each script. Floors with deliberately inset shapes
(57S L4) should be left alone.
