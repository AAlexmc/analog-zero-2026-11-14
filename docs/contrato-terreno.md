# Contrato de terreno

Única fuente del formato de un terreno. El pipeline escribe; la web solo lee. Lo comprueba `scripts/check_terrenos.py`.

## Carpeta
```
web/data/terreno/
  index.json
  <id>/meta.json
  <id>/altura.f32
  <id>/<capa>.f32 | <capa>.u8     (opcionales)
```
Solo `pipeline/terreno/` escribe en `web/data/terreno/`. Escritura con nombre temporal y renombrado.

## Rejilla
- Cuadrada, `n × n`, centros de píxel. Orden por filas; **fila 0 = y máxima (arriba), columna 0 = x mínima (izquierda)**.
- Plano local en metros, misma escala en x e y: `m_por_px`. `lado_km = n · m_por_px / 1000`.
- `n` es 1024 en terrenos de sitio; se admite 2048 en regionales (la web puede diezmar la malla).
- Binarios little-endian sin cabecera. `float32`: sin dato = NaN. `uint8`: sin dato = 255.

## Plano local (`georef`)
| `tipo` | Ejes | Campos |
|---|---|---|
| `estereo_polar` | proyección estereográfica polar del cuerpo; x hacia lon 90° E, y hacia lon 0° | `polo` (`"sur"` o `"norte"`), `radio_m`, `x0_m`, `y0_m` = centro del píxel (fila 0, col 0) |
| `local_aeqd` | azimutal equidistante centrada en `centro`; x = este, y = norte | `radio_m`, `x0_m`, `y0_m` |

Centro del píxel (fila f, col c): `x = x0_m + c · m_por_px`, `y = y0_m − f · m_por_px`.

## `meta.json`
```json
{
  "id": "shackleton",
  "cuerpo": "luna",
  "nombre": "Shackleton crater, lunar south pole",
  "centro": {"lat": -89.67, "lon": 129.8},
  "lado_km": 40.0,
  "n": 1024,
  "m_por_px": 39.0625,
  "z_min": -2900.0,
  "z_max": 1900.0,
  "z_referencia": "sphere 1737400 m",
  "georef": {"tipo": "estereo_polar", "polo": "sur", "radio_m": 1737400, "x0_m": 0, "y0_m": 0},
  "capas": {
    "altura": {"fichero": "altura.f32", "tipo": "float32", "unidad": "m",
               "fuente": "LOLA LDEM_85S_20M", "url": "https://...", "resolucion_origen_m": 20},
    "iluminacion": {"fichero": "iluminacion.f32", "tipo": "float32", "unidad": "fraction 0-1", "fuente": "...", "url": "..."},
    "sombra_permanente": {"fichero": "sombra_permanente.u8", "tipo": "uint8", "unidad": "0/1", "fuente": "...", "url": "..."},
    "temp_max": {"fichero": "temp_max.f32", "tipo": "float32", "unidad": "K", "fuente": "...", "url": "..."}
  },
  "rasgos": [{"nombre": "Shackleton", "tipo": "crater", "lat": -89.67, "lon": 129.8, "diametro_km": 21.0, "fuente": "https://..."}],
  "comando": "python -m pipeline.terreno ..."
}
```
- `z_min`, `z_max`: del array, sin NaN.
- Nombres de capa reservados: `altura` (obligatoria), `iluminacion`, `sombra_permanente`, `temp_max`, `temp_media`, `agua`. Otras capas llevan cualquier nombre y la web las lista tal cual.
- `agua` (solo `cuerpo: "tierra"`): `agua.u8`, clases de la Water Body Mask de Copernicus DEM GLO-30 tal cual: 0 = tierra (`no water`), 1 = `ocean`, 2 = `lake`, 3 = `river`; 255 = sin dato. Agua = valor 1-3. Lleva `clases` (código como texto → nombre), `teselas`, `remuestreo`, `comando`. Códigos: Copernicus DEM Product Handbook v5.0, §1.2.5.4, tabla 8. Se añade a un terreno ya generado sin tocar su `altura.f32` con `python -m pipeline.terreno capa --id <id> --capa agua`.
- Cada capa lleva `fuente` y `url` públicas. Valor propio: `"origen": "mío"` y sin `url`.
- `rasgos` es opcional; cada cifra con su fuente.
- `picos_luz` (opcional, solo Luna): `{"n", "separacion_min_km", "origen": "mío", "criterio", "fuente", "url", "puntos": [{"fila", "col", "lat", "lon", "valor"}]}`. Los `n` píxeles de AVGVISIB_85S_060M (60 m) con mayor iluminación media cuyo centro cae en la rejilla, de mayor a menor, cada uno a ≥ `separacion_min_km` de los anteriores; `fila`/`col` = celda que contiene el centro del píxel, `valor` = el del píxel (no el de `iluminacion.f32`). Lo escribe `generar` y, en un terreno ya generado, `python -m pipeline.terreno picos [--id <id>]`.

## `index.json`
```json
{"terrenos": [{"id": "shackleton", "cuerpo": "luna", "nombre": "...", "lado_km": 40.0, "escala": "sitio"}],
 "pareja_inicial": {"tierra": "haughton", "luna": "shackleton"}}
```
`escala`: `"sitio"` o `"regional"`. Los dos terrenos de `pareja_inicial` tienen el mismo `lado_km`.

## Terreno dinámico (lo hace la web, nunca se escribe a disco)
`web/terreno/index.html?lugar=<lat>,<lon>[&nombre=<texto>][&lado=<km>]` (lado por defecto 10; selector 2 / 10 / 40). `web/terreno/lugar.js` pide las teselas de relieve abiertas con `cargarRelieve` de `web/relieve/` y las convierte con `terrenoDeRelieve` a la misma forma que `cargarTerreno` (`{meta, altura, bytesAltura, capas: {}, notas}`). Vive solo en memoria del navegador; no pasa por `index.json` ni por `web/data/`.
- Rejilla: `n` impar ≤ 1023, `m_por_px = lado / n`, nunca más fino que el píxel de tesela del zoom máximo (15) en la latitud; el zoom es el más grueso cuyo píxel ≤ `m_por_px` (`zoomPara`). Fila 0 = norte, columna 0 = oeste; el píxel central es el lugar.
- `meta` lleva: `id` (`lugar_<lat>_<lon>_<lado>km`), `cuerpo: "tierra"`, `nombre`, `centro`, `lado_km`, `n`, `m_por_px`, `z_min`, `z_max`, `z_referencia: "metres above sea level"`, `georef` `local_aeqd` (`radio_m` 6371008.8, `x0_m = −(n−1)/2·m`, `y0_m = +(n−1)/2·m`), `capas.altura` (`fichero: null`, `fuente` y `url` de la línea «Elevation» de los créditos de `web/relieve/`, `resolucion_origen_m` = metros de la fuente si todas las teselas dicen la misma, si no `null`), `creditos`, `muestreo` (`m`, `zoom`, `pixel_tesela_m`, `teselas`, `descarga_bytes`, `fuentes`) y `"dinamico": true`.
- Fuente real de cada tesela: cabecera `x-amz-meta-x-imagery-sources`. Tabla propia (`FUENTES_TERRARIUM`, `origen: "mío"`, metros citados de https://github.com/tilezen/joerd/blob/master/docs/data-sources.md) solo con prefijos vistos en teselas reales: `pgdc_5m/` ArcticDEM ≈ 5 m, `ned13/` 3DEP 1/3″ ≈ 10 m, `srtm/` SRTM ≈ 30 m. Prefijo desconocido o sin cabecera: «source resolution not stated».
- Imagen: el adaptador conserva la imagen de NASA GIBS (Blue Marble) que trae `cargarRelieve` en los mismos nodos (`imagen`, RGBA `n × n × 4`, fuera de `capas`) y `meta.imagen` (`texto`, `zoom`, `credito`); su crédito va en `creditos`. `web/relieve/` no declara su resolución: la tarjeta dice «low resolution» sin cifra. El visor la usa en el modo de color «Satellite» (imagen × luz del sol), por defecto con `&vista=suelo`.
- No lleva: `iluminacion`, `sombra_permanente`, `temp_max`, `temp_media`, `agua`, `rasgos`, `picos_luz`, `comando`. Lo que dependa de esas capas sale como no medido.
- Sin red o con teselas cortadas: aviso y el terreno de la Tierra del catálogo (`a` o `pareja_inicial.tierra`).

## Terreno del punto en la Luna o Marte (lo hace la web, nunca se escribe a disco)
`…&punto=<lat>,<lon>&mundo=moon|mars` junto a `?lugar=` y sin `&b=`. `lugar.js` (`cargarPunto`, `terrenoDePunto`) pide el relieve a `cargarRelieve` de `web/relieve/` (mapa global LOLA o MOLA de `web/data/relieve/`, sin red) con la ventana del lugar y `n = 257`.
- `meta`: `id` (`punto_<mundo>_<lat>_<lon>_<lado>km`), `cuerpo` `"luna"` o `"marte"`, `georef` `local_aeqd` con el radio del mundo, `capas.altura.resolucion_origen_m` = lado de celda del mapa global (la tarjeta lo dice: lo más pequeño que eso no está en el dato), `z_referencia`, `creditos`, `punto: {mundo, origen_m}` y `imagen: {texto, tinte: true}`.
- `imagen`: un solo color, el tono medio del mapa global de ese mundo (`tono_medio_rgb` de `web/data/relieve/indice.json`); el modo de color se llama «Tinted» y dice que no es una imagen del lugar.
- Sin capas (`iluminacion`, `temp_max`…): lo que dependa de ellas sale como no medido. En Marte no se ofrecen rutas, obra ni base (dan por hecho la Luna).
- Sin relieve para el punto (p. ej. a más de 85° de latitud): aviso llano y el lugar de la Tierra solo.

## Equipo espejo y día (solo en la web)
- Lo plantado lleva `par` (texto) cuando tiene gemelo en el otro panel; `plantado` de un retoque exportado puede traerlo. La celda del gemelo: mismos metros a la derecha y abajo del centro de la ventana (`espejo.js`, `celdaEspejo`), recortada al borde o movida a la celda con dato más cercana.
- Sol del día (`sol.js`): Tierra, fórmulas de NOAA con hora solar local y el día 15 del mes (criterio propio); recorte polar lunar, la longitud subsolar retrocede 360° por día sinódico (29,53 d) y la altura es la del mando; lugar no polar de la Luna o Marte, `posicionSol` con su hora solar local (Marte: día de 24,6597 h y estación elegida, ±25,19°; Luna: sol sobre el ecuador, simplificación propia). Márgenes de «matches» (propios): pendiente ± max(1°, 10 %), altura del sol ± 5°, parte del día con sol ± 10 %.
- Sombra del equipo: cinta del ancho de su caja y largo alto ÷ tan(altura del sol), sobre el relieve; solo a escala real.

## Retoques (los escribe la web, no el pipeline)
Un retoque es un fichero JSON que el usuario exporta desde el visor:
```json
{"terreno": "shackleton", "n": 1024, "base_sha256": "…de altura.f32…",
 "celdas": {"indices": [12345, 12346], "delta_m": [1.5, -0.25]}}
```
`indices` = fila · n + col. `altura retocada = altura + delta`. El original nunca se sobrescribe.
