# Pitch: 7 slides

Each slide has a title, three lines and one capture. `capturas/` is not in the repository, so each capture is named with the script that makes it. Figures are copied from the files named after them.

## 1. Where and when on Earth do you test for the Moon and Mars?
- Hardware for the Moon's south pole or Mars has to be tested on Earth first.
- Famous analog sites exist, but the whole planet is rarely searched.
- Analog Zero searches all of Earth's land, month by month, and says how alike each place is.

Capture: `scripts/captura_portada.mjs` → `capturas/portada/01-portada-luna.png`

## 2. Pick a world, a mission, a month
- The Moon and Mars open in 3D on real elevation data.
- Step 1: a NASA mission objective, and «When»: a month or the whole year.
- Step 2: a point. On the Moon, NASA looks within 6° of the south pole (`web/data/sitio/indice.json`); Mars has no chosen site yet.

Capture: `scripts/captura_meses.mjs` → `capturas/meses/07-mundo-julio.png`

## 3. The best base site, by NASA's own criteria
- Sunlight, slope and distance to permanent shadow on the Moon; elevation, slope and hydrogen on Mars.
- Each criterion carries its NASA quotation.
- What NASA names and we cannot measure is listed as such.

Capture: `scripts/captura_sitio.mjs` → `capturas/sitio/07-luna-auto.png`

## 4. Every place on Earth, parameter by parameter
- 720 × 360 cells of 0.5°; eight parameters are compared with the target.
- Each place shows what matches and how much; a portfolio covers every parameter with the fewest places, and the rest goes to a lab.
- Gravity and air pressure are always shown as «cannot reproduce».

Capture: `scripts/captura_analogos.mjs` → `capturas/analogos/04-jezero-metrics.png`

## 5. Search by NASA mission objective
- Pick a kind of test NASA runs at analog sites, or write a new mission.
- The traits behind it come from NASA campaign sources, quoted; which layer stands for each is our own mapping.
- 21 objectives are published (`web/data/misiones.json`); what has no layer is shown as NOT MEASURED.

Capture: `scripts/captura_misiones.mjs` → `capturas/misiones/02-biomarcadores-ficha-abierta.png`

## 6. The same test, two dates, two sites
- Jezero on Mars: the best place on Earth is in Canada over the year (81.7 %), in Mongolia in January (85.8 %), in Namibia in July (83.3 %). None has a site from our catalogue within 300 km.
- Calendar: that place in Namibia gives 68.8 % in January and 83.3 % in July. In January, the test belongs in Mongolia.
- NASA's campaign month is the site's best month in 0 of 11 cases; polar sites rank 10th to 12th of 12. Access, daylight and safety are not measured here (`docs/meses-campanas.md`).

Capture: `scripts/captura_meses.mjs` → `capturas/meses/03-calendar-plan.png`

## 7. Plant it, see what breaks, and what failed
- Real Moon terrain next to Earth analogs at the same scale; 13 systems with published limits (`web/data/equipo.json`).
- Our global ranking had a pre-registered validation, and it failed: 1 of 11 known sites in the top 5 %, 8 were needed (`docs/validacion-global.md`).
- It stays as exploratory. The environment types are unsupervised and weak; Mars temperature is a reanalysis.

Capture: `scripts/captura_base.mjs` → `capturas/base/01-base-generada.png`

## To confirm with Ale
- Slide 6 replaces «A portfolio, not a single winner»: the portfolio is now a line on slide 4, and «unlisted» a phrase on slide 6. If the portfolio should keep its own slide, the month could take slide 3 instead.
- The Jezero figures on slide 6 come from running the engine and the app (commands in the PR), not from a document: if the data are rebuilt, they must be recomputed.
- Whether slide 7 should carry the failed validation, or whether it should go on a slide of its own.
- I ran `captura_portada.mjs`, `captura_meses.mjs` and `captura_equipo_mes.mjs` and looked at the captures of slides 2 and 6. The others I have not opened: run each script and look at the images before making the slides.
