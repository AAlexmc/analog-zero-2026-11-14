# Contrato de capas globales

Única fuente del formato de lo que el motor exporta y el mapa lee. Solo `pipeline/exportar/` escribe en `web/data/global/`.

## Rejilla
- 0,5° × 0,5°, 720 × 360, centros de celda. Longitud −180…180.
- **En los PNG la fila 0 es el norte** (lat 89,75) y la columna 0 es lon −179,75. En la malla (`build/malla_vN.nc`) la latitud va de sur a norte: exportar invierte y lo comprueba con un test de ida y vuelta.
- Mapa de la web: equirrectangular, un píxel = una celda, leído sin suavizado ni gestión de color.

## PNG
720 × 360, RGB de 8 bits + **alfa siempre 255**. Por canal: 0-250 = dato escalado; 254 = `na`; 255 = `sin_dato`, océano o celda no evaluable.
`valor = offset + byte · scale` (los dos números, por canal, en el manifiesto).

Por cada par `<obj>_<mis>` de `umbrales.json` → `pares` (p. ej. `shackleton_P3`):
| Fichero | R | G | B |
|---|---|---|---|
| `s_<par>.png` | S | S p5 | S p95 |
| `c_<par>.png` | cobertura C | puertas: bits 0-3 = fallada, bits 4-7 = sin dato (orden en el manifiesto) | F (D8) |
| `dim_<par>_a.png` | D1 | D2 | D3 |
| `dim_<par>_b.png` | D4 | D5 | D6 |
| `dim_<par>_c.png` | D8 | D9 | libre (255) |

Comunes: `var_a.png` (radiación, temperatura media, aridez), `var_b.png` (NDVI máx., carbono orgánico, pH), `var_c.png` (rugosidad, relieve a 1 km, tiempo a ciudad), `var_d.png` (días ≤ −23 °C, días ≤ 0 °C, amplitud diurna), `var_e.png` (permafrost, viento P95, litología **como código de clase sin escalar**), `var_f.png` (f_low, elevación solar máxima, elevación).

Reglas: puerta **fallada** → S = 0 en los tres canales de `s_*` y su bit de fallada. Puerta **sin dato** o C < cobertura mínima → no evaluable: 255 en `s_*` (y su bit de sin dato). Océano: 255 en todo. El canal G de `c_*` no se escala (son bits): en una celda de tierra nunca vale 254 ni 255 porque una puerta no puede estar a la vez fallada y sin dato.

## `capas.json` (manifiesto)
```json
{
  "malla": "malla_v7.nc",
  "umbrales_sha256": "0b56…",
  "ejemplo": false,
  "rejilla": {"ancho": 720, "alto": 360, "fila0": "norte", "lon0": -179.75, "lat0": 89.75, "paso": 0.5},
  "pares": [{
    "id": "shackleton_P3", "objetivo": "shackleton", "mision": "P3", "prerregistrado": true,
    "nombre_objetivo": "Shackleton rim", "nombre_mision": "Polar base",
    "pesos": {"D3": 0.521, "D8": 0.271, "D2": 0.146, "D1": 0.063},
    "puertas": [{"id": "casquete", "texto": "ice cap fraction <= 0.5"}, {"id": "relieve", "texto": "relief over 1 km <= 130 m"}],
    "n_tierra": 0, "n_no_evaluables": 0, "n_fallan_puerta": 0, "fraccion_tierra_pasa_puertas": 0.0,
    "ficheros": {"s": "s_shackleton_P3.png", "c": "c_shackleton_P3.png",
                 "dim": ["dim_shackleton_P3_a.png", "dim_shackleton_P3_b.png", "dim_shackleton_P3_c.png"]},
    "candidatos": {"csv": "candidatos_shackleton_P3.csv", "geojson": "candidatos_shackleton_P3.geojson"}
  }],
  "canales": {
    "s_shackleton_P3.png": [
      {"id": "S", "nombre": "similarity score", "unidad": "0-1", "scale": 0.004, "offset": 0.0},
      {"id": "S_p5", "unidad": "0-1", "scale": 0.004, "offset": 0.0},
      {"id": "S_p95", "unidad": "0-1", "scale": 0.004, "offset": 0.0}],
    "var_a.png": [
      {"id": "radiacion_kwh_m2_dia", "nombre": "solar radiation", "unidad": "kWh/m²/day", "scale": 0.04, "offset": 0.0, "fuente": "https://power.larc.nasa.gov"}]
  },
  "dimensiones": {"D1": "Geology and materials", "D2": "Terrain", "D3": "Temperature and light"},
  "litologia_clases": {"2": "basic volcanic"}
}
```
Un canal que no existe para un par (dimensión sin peso en esa misión) va entero a 255 y su entrada del manifiesto lleva `"vacio": true`.

## Candidatos
`candidatos_<par>.csv` y `.geojson`: las 200 mejores celdas evaluables por S, con `puesto, lat, lon, S, S_p5, S_p95, C`, una columna por dimensión con peso, y `sitio_cercano` (id de `sitios_ensayo.json` o de la lista de validación si hay uno a ≤ 1 celda; si no, vacío).

## Otros ficheros de `web/data/global/`
- `informe_validacion.json`: H1, k₀, H1-S, H3, el descriptivo polar, denominadores, sitios no evaluables, fecha de la corrida y `umbrales_sha256`.
- `objetivos.json`: de `umbrales.json` → `objetivos`, solo nombre, cuerpo, coordenadas, textos y fuentes.
