# umbrales.json: origen de cada bloque

Documentos en `~/nasa-space-apps-2026/privado/` (fuera del repo). Precedencia: `27` §12-§18 > `27` §1-§11 > `piezas/00-contrato.md` > `20-metrica-v2.md` > `piezas/integracion.md` §3 > `piezas/03-motor.md`, `04-validacion.md`.

| Bloque | Origen |
|---|---|
| `variables` | `integracion.md` §3; `27` §5, §12 |
| `funciones`, `agregacion` | `20` §1.1; `27` §12 (suelo 0,05, C ≥ 0,7); contrato §6 |
| `tablas_clase.litologia` | `20` §1.3 |
| `dimensiones` D1-D6, D8 | `27` §12 (tabla, D1, D3 y D4 por objetivo, rugosidad), §13, §5; `20` §1.2 |
| `dimensiones_fuera` (D7) | `27` §4 |
| `puertas_reglas`, `puerta_comun` | `27` §12; contrato §3; `20` §4.2 |
| `misiones` P1-P4, `metodo_pesos` | `27` §3, §12, §13; `20` §4.1-§4.2 |
| `objetivos` | `27` §1, §12, §15; `20` §1.2, §5.2 |
| `pares`, `selector` | `27` §14 |
| `par_inicial` | decisión previa al hash (shackleton + P3) |
| `validacion` | `27` §2, §12, §13, §17; `20` §2, §6.1-§6.3, §7; `verif/P34` |
| `monte_carlo` | `20` §6.4, §9; `03-motor.md` |
| `comprobaciones` | `27` §6, §7, §8, §15; `verif/P22`; `verif/P23` §1.2 |
| `energia` | `27` §15 |
| `pieza_ensayable_aqui` | `27` §16 |

Rugosidad de los objetivos: no está aquí; se lee de `build/rugosidad_objetivos.json` (`27` §12).

## Valores `null`
| Clave | Qué falta |
|---|---|
| `tablas_clase.litologia.codigos_glim` | qué código GLiM va a cada fila, y valor de las clases GLiM que no salen en la tabla (`20` §9) |
| `dimensiones.D3.por_objetivo.meridiani.variables` | `27` §12 no da D3 para meridiani |
| `dimensiones.D4.na_otros_objetivos` | qué es D4 con aridez `na` en objetivos que no son arcadia |
| `objetivos.jezero.valores_citados.D3.amplitud_diurna_k.valor_usado` | `20` §1.2 da 50-60 K; no qué valor único es ΔT_O |
| `objetivos.arcadia.valores_citados.D3.amplitud_diurna_k.valor_usado` | sin valor citado para Arcadia |
| `objetivos.jezero.valores_citados.D5.R_objetivo` | P95 del viento en Jezero no citado |
| `objetivos.arcadia.valores_citados.D5.R_objetivo` | ídem (P1 no usa D5) |
| `objetivos.meridiani.lat`, `.lon` | ningún documento da coordenadas |
| `objetivos.meridiani.valores_citados.D2.rugosidad`, `.D3.valor` | `27` §5 no calcula su rugosidad; `27` §12 no da su D3 |
| `objetivos.tranquillitatis.valores_citados.D3.f_low` | el ≈ 1 es del polo; la escala 0-1 no lo usa |
| `validacion.sitios_solo_escala_de_sitio[dalinouer]` lat, lon, dim, objetivo | no están en los documentos de la precedencia |
| `validacion.valores_a_mano[svalbard_bockfjorden].valor` | sin fuente |
| `validacion.h1_s.umbral` | descriptiva por diseño (`27` §2) |
| `monte_carlo.perturbaciones[0].distribucion` | σ por variable y distribución no escritas |
| `comprobaciones.cultivo.regla_por_dia` | cómo pasar de biomasa comestible total a g/m²·día |

## Cierres (antes del hash, sin haber calculado ninguna puntuación)
Están dentro del propio JSON, en `cierres`: qué hueco, qué se decidió y qué se había visto de la malla antes. Resumen:
- Los 4 pares y la validación de los documentos (H1, H1-S, H3) no cambian.
- Se añade un perfil **no prerregistrado**, P5 «frío y sol rasante», con la dimensión D9 (días con máxima ≤ −23 °C); no entra en ninguna validación.
- Huecos que quedan `sin_dato` en vez de rellenarse: clases GLiM sin fila en la tabla, amplitud diurna y viento de Marte, error del dato en Monte Carlo.

Hash: `umbrales.sha256` (sha256 de `umbrales.json`). Los umbrales no se editan. La corrida oficial usó el fichero con sha256 `0b56320b848e1ebf62ed2771ae1dd32c1e1b485ef5941ef0ff795c2328ebd92f` (el que figura en el informe de validación); después solo se han editado notas de texto (13 cadenas y el nombre de una clave), sin cambiar ningún número, lista ni regla, y por eso el hash actual es otro.
