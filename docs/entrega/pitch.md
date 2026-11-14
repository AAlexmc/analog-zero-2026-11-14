# Pitch: 7 slides

Each slide has a title, three lines and one capture. `capturas/` is not in the repository, so each capture is named with the script that makes it. Figures are copied from the files named after them.

## 1. Where on Earth do you test for the Moon and Mars?
- Hardware for the Moon's south pole or Mars has to be tested on Earth first.
- Famous analog sites exist, but the whole planet is rarely searched.
- Analog Zero searches all of Earth's land and says how alike each place is.

Capture: `scripts/captura_portada.mjs` → `capturas/portada/01-portada-luna.png`

## 2. Pick a world, place a point
- The Moon and Mars open in 3D on real elevation data.
- On the Moon, NASA looks within 6° of the south pole (`web/data/sitio/indice.json`).
- Mars has no chosen site yet, so any point can be placed.

Capture: `scripts/captura_portada.mjs` → `capturas/portada/06-luna-polo-sur.png`

## 3. The best base site, by NASA's own criteria
- Sunlight, slope and distance to permanent shadow on the Moon; elevation, slope and hydrogen on Mars.
- Each criterion carries its NASA quotation.
- What NASA names and we cannot measure is listed as such.

Capture: `scripts/captura_sitio.mjs` → `capturas/sitio/07-luna-auto.png`

## 4. Every place on Earth, parameter by parameter
- 720 × 360 cells of 0.5°; eight parameters are compared with the target.
- Each place shows what matches, how much, and what is far.
- Gravity and air pressure are always shown as «cannot reproduce».

Capture: `scripts/captura_analogos.mjs` → `capturas/analogos/04-jezero-metrics.png`

## 5. Search by NASA mission objective
- Pick a kind of test NASA runs at analog sites, or write a new mission.
- The traits behind it come from NASA campaign sources, quoted; which layer stands for each is our own mapping.
- 12 objectives are published (`web/data/misiones.json`); what has no layer is shown as NOT MEASURED.

Capture: `scripts/captura_misiones.mjs` → `capturas/misiones/02-biomarcadores-ficha-abierta.png`

## 6. A portfolio, not a single winner
- The smallest set of Earth places that together cover every parameter.
- What no place covers is what has to go to a lab.
- Each place says whether a known analog site is within 300 km, or it is unlisted.

Capture: `scripts/captura_cartera.mjs` → `capturas/cartera/jezero-2-portfolio.png`

## 7. Plant it, see what breaks, and what failed
- Real Moon terrain next to Earth analogs at the same scale; 13 systems with published limits (`web/data/equipo.json`).
- Our global ranking had a pre-registered validation, and it failed: 1 of 11 known sites in the top 5 %, 8 were needed (`docs/validacion-global.md`).
- It stays as exploratory. The environment types are unsupervised and weak; Mars temperature is a reanalysis.

Capture: `scripts/captura_base.mjs` → `capturas/base/01-base-generada.png`

## To confirm with Ale
- Slide 5 says 12 objectives. If PR #5 is merged, it becomes 21.
- Whether slide 7 should carry the failed validation, or whether it should go on a slide of its own.
- I have not opened these captures myself: they come from the names in each script. Run each script and look at the images before making the slides.
