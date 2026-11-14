# Submission texts (draft for the Space Apps form)

Every figure below is copied from a file in this repository, named next to it, or computed with the code in this repository with the command given. Anything not found in the repository is in the list at the end, «To confirm with Ale».

## High-level summary (≤ 150 words)

Analog Zero finds the places on Earth that are most like a chosen spot on the Moon or Mars, and says how alike they are, parameter by parameter. Pick a world, place a point (NASA's south-pole region on the Moon; any site on Mars), and the tool searches all of Earth's land on a 0.5° grid. It reports what matches, by how much, what does not, and what Earth cannot reproduce at all, such as gravity and air pressure. The search can follow a NASA mission objective: pick a kind of test NASA runs at Earth analog sites, and the tool uses the environment traits that NASA's own sources name for it. A portfolio shows the smallest set of places that together cover every parameter. A terrain viewer puts Moon and Earth ground side by side at the same scale: plant equipment and see which published limit breaks.

## Project description

What it does:
- **Search the whole planet.** Every land cell of Earth is compared, not only the famous sites. The grid is 720 × 360 cells of 0.5° (`web/data/cuerpos/indice.json`, `rejilla`).
- **Several dimensions, each one shown.** Eight parameters are compared with the target on the Moon or Mars: terrain roughness, local relief, daily maximum, minimum and mean surface temperature, sunlight on a flat surface, vegetation (NDVI), rain and snowfall. Two more are shown but cannot be reproduced on Earth: gravity and air pressure (`web/data/cuerpos/indice.json`, `parametros`, `reproducible_en_tierra`).
- **Search by mission objective.** The user picks a kind of test that NASA runs at analog sites, or writes a «New mission» with a title and a list of parameters.
  - Each objective lists the NASA campaigns behind it, with a literal quote from the source.
  - It also lists the environment traits the source names as the reason for the site.
  - Which of our layers stands for each trait is our own criterion, labelled «own mapping».
  - Traits we have no layer for are shown as «NOT MEASURED».
  - The published catalogue has 12 objectives (`web/data/misiones.json`); format in `docs/contrato-misiones.md`.
- **Earth-only parameters.** Dryness, wind, day-night swing, permafrost, elevation, travel time to a city and rock type. These are compared with the Earth site where NASA runs that test (the mission's reference site), not with the Moon or Mars (`indice.json`, `parametros_tierra`; `docs/metrica-analogos.md`).
- **Similarity, in plain numbers.** Each parameter gets a deviation in percent over a reference range; similarity is 100 minus the deviation, averaged over the parameters used (`docs/metrica-analogos.md`). No data on either side gives «no data», never 0.
- **Portfolio.** The smallest set of Earth places that together cover each parameter (deviation under 15 %). Whatever no place covers is what has to be tested in a lab (`docs/metrica-analogos.md`, «Cartera de análogos»).
- **Base site.**
  - Moon: NASA looks within 6° of the south pole, and the tool searches that area on real terrain.
  - Mars: there is no chosen site yet, so the tool uses NASA's published limits for a human landing zone.
  - Each criterion carries its NASA quote (`web/data/sitio/indice.json`).
- **Terrain viewer and equipment.**
  - Real terrain of Shackleton and the south-pole region next to Earth analog sites, at the same scale.
  - A catalogue of 13 lunar south-pole systems with their published limits (`web/data/equipo.json`). Planting one says OK, BREAKS or NOT MEASURED, with the quotation (`README.md`).

## How we answer each consideration of the challenge

Wording of the considerations as summarised in `CLAUDE.md` (see «To confirm with Ale»).

| Consideration | What we do | What we do NOT do |
|---|---|---|
| Go beyond visual likeness | We compare measured layers (terrain, temperature, sunlight, vegetation, rain, plus Earth-only layers), not pictures. | No image or texture comparison. |
| Several dimensions: geology, terrain, temperature and light, water and ice, dust and wind, biology, subsurface, operations | Terrain, temperature, sunlight, vegetation and rain are compared with the Moon or Mars. Rock type, permafrost, wind, dryness and travel time are compared between Earth places. | No global layer for dust, subsurface, mineralogy, perchlorates or lava tubes. When a mission source names one of them, it is shown as NOT MEASURED. |
| An analog does not have to match everything: say what matches, how much and what not | Every place shows each parameter's deviation in %, grouped as close, medium or far. The portfolio covers parameters with different places. | We do not merge the result into a single «best analog» verdict without showing the parts. |
| Look at the whole Earth, not only famous sites | All land cells of the 0.5° grid are searched. A place with none of our catalogue sites within 300 km is labelled «unlisted». | «Unlisted» only means outside our own catalogue, not «never studied». |
| Connect with exploration | Mission objectives come from NASA field campaigns, quoted. Base-site criteria come from NASA documents. Equipment limits come from published sources. | We do not plan missions or rank NASA's candidate regions. |
| Recognise the limits of Earth as an analog | Gravity and air pressure are shown for every place as «cannot reproduce». The environment-type check says when a target falls outside every type found on Earth. | We do not claim any Earth place reproduces the Moon or Mars. |

## What the reviewer asked, and what is really there

**Compare across the whole planet.** Yes: every land cell of a 720 × 360 grid at 0.5°. A cell is ranked only if it has data for every parameter used; cells with data for at least half of them are listed apart as partly compared (`docs/metrica-analogos.md`). Islands and coasts where less than half the cell is land are left out. Earth has no roughness or relief south of 56° S, so Antarctica is only partly compared.

**A machine-learning approach.** Unsupervised only, and weak:
- **Grouping.** We group Earth's land into environment types by its own numbers: principal components, then k-means. There is no labelled data and no trained model (`web/data/cuerpos/clases.json`, `metodo`).
  - 58,833 land cells, 97.66 % of the land area.
  - 3 components kept, 95.5 % of the variance.
  - k = 6, chosen before looking at any map, by the highest mean silhouette (0.32).
  - The silhouette is about 0.3 for every k from 6 to 14 (`criterio_k`): land is a continuum and the borders between types are conventional (`docs/metrica-analogos.md`).
- **Ordering.** An optional ordering ranks places by distance in the whitened component space, so that three correlated temperatures do not count three times.
- **Check.** The tool says which Earth type a Moon or Mars point is closest to, and whether it falls inside that type at all.

**Data from Earthdata, Worldview, PDS and LRO.** What the indexes use (`web/data/cuerpos/indice.json`, `web/data/sitio/indice.json`):
- **NASA Earthdata / Worldview–GIBS:** MODIS Terra NDVI 16-day, through the Worldview Snapshots service.
- **PDS:**
  - LRO LOLA elevation models (PDS Geosciences Node);
  - LRO Diviner Global Cumulative Products (surface temperature of the Moon);
  - MGS MOLA MEGDR (Mars elevation);
  - Mars Odyssey Neutron Spectrometer (hydrogen near the surface).
- **LRO:** LOLA elevation, LOLA average illumination and permanently shadowed regions (NASA GSFC PGDA), and Diviner.
- **Other NASA:** NASA POWER (MERRA-2 and SYN1deg climatology for Earth) and NSSDC fact sheets (constants).
- The new page `web/datos/` (pending review, PR #8) lists each source by archive and by parameter.

**An unexpected place.** With the engine's default parameters, for Jezero crater on Mars (18.38° N, 77.58° E):
- The best Earth cell is at 80.75° N, 73.25° W, in Canada, with 81.7 % similarity. None of our catalogue sites is within 300 km.
- The second, 81.1 %, is at 38.25° N, 90.25° E, in China, 124 km from Dalangtan Playa in the Qaidam Basin, a known Mars analog site in our catalogue.
- The fifth, 80.8 %, is at 42.75° N, 101.75° E, in Mongolia, also unlisted.

For the Shackleton rim on the Moon, the best cell is at 82.25° N, 76.75° W, in Canada, with 70.1 %. Computed with `web/buscar/motor.js` on the data in `web/data/`; the same numbers appear in the capture scripts `scripts/captura_analogos.mjs` and `scripts/captura_cartera.mjs`.

**A new way to compare.** Two ideas:
1. **A portfolio instead of a single winner.** For Jezero, 2 places cover every parameter that can be covered. The daily minimum temperature is covered by no place: the best on Earth is 16.9 % off, in Antarctica at 79.75° S, 153.25° E. So that one goes to a lab.
2. **Search by mission objective.** The question changes from «what looks like Jezero» to «where do I test this NASA objective». The traits behind it come from NASA's own campaign sources.

**What is weak, said plainly:**
- **The validation failed.** The global similarity ranking had a pre-registered validation with thresholds frozen by hash. Known analog sites in the best 5 % of land for their key dimension: 1 of 11, where at least 8 were needed. Mission-profile predictions: 1 of 9, where at least 8 were needed (`docs/validacion-global.md`). The ranking is kept as exploratory.
- **The environment types are weak and unsupervised** (silhouette about 0.3).
- **Mars surface temperature is a reanalysis**, not a measurement: OpenMARS, Mars year 30, on a 5° grid copied to 0.5° (`indice.json`, `fuentes.mars` of the temperatures).
- **The Moon and Mars are far from all of Earth.** NDVI and rain on the Moon and Mars are 0 by definition, which alone separates them from all of Earth. With the component ordering, a Moon or Mars point is usually farther from all of Earth than the reference distance, so its % shows 0 even if the order is still useful.

## Use of AI

From `README.md`, adapted for the whole team:
- **The idea is ours:** placing the equipment on the analog site and computing what breaks.
- **What the models did:** large language models (Anthropic Claude, through Claude Code) were used to search and read sources, to write most of the code, tests and catalogues under the team's direction and review, and to run adversarial reviews of that code.
- **Commits** carry a `Co-Authored-By: Claude` trailer.
- **No generated media:** no AI-generated images, video or audio are used. The pictures are captures of the running app on real data.

## Data and resources

Read from `web/data/cuerpos/indice.json` and `web/data/sitio/indice.json`:
- USGS GMTED2010 7.5″ (Earth roughness and relief): https://edcintl.cr.usgs.gov/downloads/sciweb1/shared/topo/downloads/GMTED/Grid_ZipFiles/mn75_grd.zip
- USGS GMTED2010 30″ (Earth elevation, land mask): https://edcintl.cr.usgs.gov/downloads/sciweb1/shared/topo/downloads/GMTED/Grid_ZipFiles/mn30_grd.zip
- LRO LOLA LDEM_64 (Moon roughness and relief): https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_64.img
- LRO LOLA LDEM_85S_20M (Moon south pole slope): https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ldem_85s_20m.img
- LRO LOLA average illumination: https://pgda.gsfc.nasa.gov/data/MoonIllumination/AVGVISIB_85S_060M_201608.TIF
- LRO LOLA permanently shadowed regions: https://pgda.gsfc.nasa.gov/data/MoonIllumination/LPSR_85S_060M_201608.TIF
- LRO Diviner Global Cumulative Products (Moon temperature): https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_gcp/global_cumul_avg_cyl_00n10n_002.lbl
- MOLA MGS global mosaic 463 m (Mars roughness and relief): https://planetarymaps.usgs.gov/mosaic/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif
- MGS MOLA MEGDR (Mars elevation and slope): https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megt90n000eb.img
- Mars Odyssey Neutron Spectrometer: https://pds-geosciences.wustl.edu/ody/urn-nasa-pds-odyssey_grs_special/data/ns_epithermal_020917.tab
- OpenMARS reanalysis (Mars temperature and pressure, CC BY 4.0): https://doi.org/10.21954/ou.rd.24573205.v3
- NASA POWER MERRA-2 climatology (Earth temperature): https://nasa-power.s3.us-west-2.amazonaws.com/merra2/spatial/power_merra2_climatology_spatial_utc.zarr
- NASA POWER (Earth sunlight, rain, pressure, dryness, wind): https://power.larc.nasa.gov
- MODIS Terra NDVI 16-day via NASA Worldview Snapshots: https://wvs.earthdata.nasa.gov/api/v1/snapshot?REQUEST=GetSnapshot&LAYERS=MODIS_Terra_L3_NDVI_16Day&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH=3600&HEIGHT=1800&FORMAT=image/png
- NSSDC fact sheets (radius, gravity, orbit constants): https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html, https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html, https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html
- ESA CCI Permafrost extent v5.0: https://dap.ceda.ac.uk/neodc/esacci/permafrost/data/permafrost_extent/L4/area4/pp/v05.0/northern_hemisphere/2022/ESACCI-PERMAFROST-L4-PFR-MODISLST_CRYOGRID-AREA4_PP-2022-fv05.0.nc
- GLiM global lithological map (Hartmann and Moosdorf): https://epic.awi.de/id/eprint/31092/1/hartmann-moosdorf_2012.zip
- Travel time to cities (Weiss et al., Nature): https://doi.org/10.1038/nature25181

Also used, listed in `README.md` with their sources inside each generated file (`web/data/terreno/*/meta.json`, `web/data/global/capas.json`, `web/data/global/condiciones.json`, `web/data/equipo.json`):
- Copernicus DEM GLO-30, ISRIC SoilGrids 2.0, LRO Diviner Polar Resource Product;
- NASA Technical Reports Server documents quoted in the equipment catalogue;
- the mission catalogue sources in `datos_json/misiones.json`;
- three.js (MIT), Playwright and scikit-image.

## To confirm with Ale

- The exact wording of the challenge considerations: the table above follows the summary in `CLAUDE.md`, not the challenge page.
- Whether the form wants the reviewer's questions answered in a separate field, and the exact questions.
- The team's names and location for the form. `README.md` says «Barcelona»; the AI paragraph says «the team member's own» and I adapted it to «ours».
- The number of mission objectives to quote. 12 are published; 9 more (groups 5 to 7) are in PR #5. If PR #5 is merged before submission, the count becomes 21.
- The «unexpected place» numbers come from running the engine with its default parameters, not from a document. If the data are rebuilt, they must be recomputed. The command used is in the PR.
- Whether the data page (`web/datos/`, PR #8) is merged before we mention it.
