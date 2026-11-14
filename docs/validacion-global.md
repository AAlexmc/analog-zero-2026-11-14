# Global similarity ranking: the pre-registered validation failed

Question: does the 0.5° global similarity score put the Earth analog sites that missions already use near the top?

Answer: **no.** One official run, thresholds frozen by hash before computing, result published as it came out. The ranking stays in the map as `SIMILARITY RANKING`, labelled exploratory with a failure notice. What the product stands on is the other map mode (`TEST CONDITIONS`), the terrain viewer and the equipment sheets, none of which use this score.

Numbers below are read from `web/data/global/informe_validacion.json` (identical to the build output).

## What was fixed beforehand

- `umbrales.json`. The run used the file with sha256 `0b56320b848e1ebf62ed2771ae1dd32c1e1b485ef5941ef0ff795c2328ebd92f`, the value recorded in `web/data/global/informe_validacion.json`. After the run only text notes of the file were edited (13 strings and one key name); no number, list or rule changed. The hash of the file as it is now is in `umbrales.sha256` (`sha256sum -c umbrales.sha256`), so it differs from the one in the report. Variables, scales, gates, weights, the list of validation sites, the success conditions and the Monte Carlo settings are all inside.
- One official run: grid `malla_v7.nc`, 500 Monte Carlo replicas. No second run to improve the result.

## Result

| Test | Success condition (pre-registered) | Result |
|---|---|---|
| **H1** — known analog sites in the best 5 % of land area for their key dimension | k ≥ 8 of 11 and k ≥ k₀ + 2 (k₀ = same count ranking by aridity alone) | **k = 1 of 11, k₀ = 1 → fail** |
| H1-S — same sites, combined score S with the mission of their row (descriptive, no threshold) | none | 0 of 11 inside the best 5 %; 5 not evaluable |
| **H3** — sign predictions: the site moves up in one mission profile against another | ≥ 8 of 9, and Jaccard of the top 1000 < 0.5 between P1–P2 and P1–P4 | **1 of 9 → fail** (Jaccard 0.0055 and 0.0005) |
| Negative controls (sanity check, not a success condition) | 0 of 7 in the top 20 % | 0 / 2 / 0 / 1 / 1 across the five pairs |

H1 by site:

| Site | Dimension · target | s | Share of area equal or better | Inside the best 5 % |
|---|---|---|---|---|
| Yungay | D4 · Jezero | 1.00 | 0.080 | no |
| Haughton | D4 · Arcadia | 0.00 | 1.000 | no |
| McMurdo Dry Valleys | D3 · Jezero | 1.00 | 0.034 | **yes** |
| Svalbard Bockfjorden | D4 · Arcadia | 0.00 | 1.000 | no |
| MDRS Utah | D2 · Jezero | 0.17 | 0.671 | no |
| Mojave Silver Lake | D2 · Jezero | 0.55 | 0.411 | no |
| Cinder Lake | D2 · Tranquillitatis | 0.18 | 0.436 | no |
| Death Valley, Dalangtan | D1 · Meridiani | — | — | not evaluable: target without coordinates in `umbrales.json` |
| Timanfaya, Mauna Kea | D1 · Jezero | — | — | not evaluable: lithology is no-data in the cell |

What the data show about the misses:
- Yungay scores the maximum (s = 1), but 8.0 % of the land area ties at that maximum, and a tied group only counts if it fits inside the 5 %.
- Haughton and Bockfjorden get s = 0 because the aridity index in their cells is humid (1.99 and 5.67), and that dimension for Arcadia is the minimum of its variables.
- Four sites cannot be evaluated at all.

In H3, seven of the nine predictions are not evaluable in one of the two profiles (coverage below the minimum of 0.7), and a non-evaluable prediction counts as a miss.

## Was it a bug?

An adversarial review recomputed H1, k₀, H1-S, H3, the Jaccard indices and the controls from the raw grid by an independent path. Re-run for this document: H1-S, H3, Jaccard and controls match the published report exactly. No programming error changes k, k₀ or any verdict.

The code departs from the letter of `umbrales.json` in two places. Both are written here instead of fixed, because fixing them would mean a second run. Neither changes a verdict.

**1. Bockfjorden permafrost.** `umbrales.json` lists a hand value for Bockfjorden with `valor: null` and the rule "no source → no-data, and the site comes out *not evaluable* in H1-S". The code skips null hand values and uses the grid value (ESA CCI: 0.990).
- As run: Bockfjorden in H1-S is *gate failed*, S = 0, not inside.
- Literal reading: it would be *not evaluable* (H1-S not-evaluable count 5 → 6; inside count stays 0). Checked by setting that cell to no-data and evaluating the pair again: the aridity gate still fails, coverage drops from 1.00 to 0.54.
- H1 does not change (the rule itself says so).
- H3: the rule does not mention it. If the no-data were also applied there, prediction 2 (the only hit) becomes not evaluable and H3 goes from 1 of 9 to 0 of 9.

**2. A gate that fails together with a gate without data.** `umbrales.json` has both rules ("failed → S = 0, counted" and "no data → not evaluable, out of the denominator") and does not say which wins. The code lets the failure win.
- Cells affected: 37,450 in the Arcadia P1 and Jezero P1 pairs, 5,667 in Jezero P2, 2,262 in each of the others.
- Literal "not evaluable" reading: H1-S inside count stays 0; the shares move by less than 0.01 (MDRS 0.609 → 0.618, Mojave 0.281 → 0.286, Cinder Lake 0.374 → 0.380). One negative control changes side: Paris in Shackleton P5 goes from 0.199 to 0.202, across the 20 % line (count 1 → 0). The seven controls of Arcadia P1 go from *gate failed* to *not evaluable*.

Also checked: two sites sit exactly on a cell edge (Cinder Lake, Dalangtan). The code takes the north-east cell and there is no written rule. Trying the neighbouring cells changes no verdict.

## Open question in the data, not corrected

The permafrost layer (ESA CCI Permafrost extent v5.0, 2022) holds the fill value 255 over temperate land of the northern hemisphere, not 0: the value 0 only appears at the margin of the permafrost zone. The grid keeps fill as no-data, so permafrost is no-data in 20,134 of the 44,627 base cells between 25° N and 85° N. `umbrales.json` only expected no-data in the southern hemisphere. This is why H3 predictions 4, 6, 7 and 8 (Yungay, Death Valley, Cinder Lake, Mojave) are not evaluable in the Arcadia P1 profile.

Whether fill means "0 % permafrost" there is not established. The product documents read (Product User Guide v5.0, Product Specification v5.0, ATBD v5.0) do not define the fill value or the domain mask. The closest statement is the caption of Table 1 of the User Guide: "data values available for maximum permafrost extent in record only" (https://climate.esa.int/documents/3107/CCI_PERMA_PUG_v5.0.pdf). That points to "outside the modelled domain", which is how the grid treats it, but it is a reading, not a definition.

If the fill were read as 0, those four predictions would become evaluable and H3 could reach 5 of 9 at most, still below the 8 required; H1 would not change. Estimate from the review, not recomputed here.

## What this does not cover

- H2 (new candidate sites checked by hand against imagery and literature) was not done.
- The Monte Carlo spread does not include the error of the input data, only weights and scale factors.
- The Shackleton profile P5 and the percentiles of the lunar test sites were added after the NASA briefing and after seeing grid values: they are descriptive, not validation.
- The independent recomputation scripts are not in the repository.
