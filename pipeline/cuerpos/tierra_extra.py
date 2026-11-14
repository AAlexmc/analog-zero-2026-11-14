"""Capas de la Tierra sin equivalente en la Luna ni en Marte → web/data/cuerpos/earth/<id>.f32 + indice.json["parametros_tierra"].
Uso: python -m pipeline.cuerpos.tierra_extra (solo añade la clave al índice; python -m pipeline.cuerpos la escribe también)."""
import json
import sys

import numpy as np

from pipeline.cuerpos import __main__ as cu
from pipeline.malla.construir import URL_CCI, URL_GLIM, URL_GMTED30, URL_POWER, URL_WEISS

CAPAS_GLOBAL = cu.RAIZ / "web" / "data" / "global" / "capas.json"
REGLA = "p1–p99 of Earth land (cells with land share ≥ 0.5, weighted by area); Earth only"

VARIABLES = [
    {"id": "aridez_ai", "nombre": "Dryness (rain ÷ evaporation demand)", "grupo": "water", "unidad": "1",
     "definicion": "Annual precipitation divided by annual potential evapotranspiration (Hargreaves, FAO-56 eq. 52) at the 0.5° cell",
     "transformacion": "log10",
     "aviso": "No value where the yearly evaporation demand is under 100 mm (cold places: the index does not apply). Compared on a log scale.",
     "fuente": {"texto": "own computation on NASA POWER MERRA-2 climatology (PRECTOTCORR, T2M, T2M_RANGE): P / PET, PET by Hargreaves, bilinear to 0.5°",
                "url": URL_POWER, "origen": "mío"}},
    {"id": "viento_medio_m_s", "nombre": "Mean wind at 2 m", "grupo": "wind", "unidad": "m/s",
     "definicion": "Annual mean wind speed 2 m above the ground at the 0.5° cell",
     "transformacion": "lineal", "aviso": None,
     "fuente": {"texto": "NASA POWER MERRA-2 climatology, WS2M, annual mean, bilinear to 0.5°", "url": URL_POWER}},
    {"id": "viento_p95_m_s", "nombre": "Strong wind at 2 m", "grupo": "wind", "unidad": "m/s",
     "definicion": "95th percentile over ten years of the daily maximum wind speed 2 m above the ground at the 0.5° cell",
     "transformacion": "lineal", "aviso": None,
     "fuente": {"texto": "NASA POWER MERRA-2 daily WS2M_MAX, ten years, 95th percentile over the days, bilinear to 0.5°", "url": URL_POWER}},
    {"id": "amplitud_diurna_k", "nombre": "Day-night air temperature swing", "grupo": "temperature", "unidad": "K",
     "definicion": "Annual mean of the daily range (maximum − minimum) of air temperature 2 m above the ground at the 0.5° cell",
     "transformacion": "lineal",
     "aviso": "Air at 2 m, not the ground surface: not the same quantity as the surface temperatures compared with the Moon and Mars.",
     "fuente": {"texto": "NASA POWER MERRA-2 20-year climatology, T2M_RANGE, annual mean, bilinear to 0.5°", "url": URL_POWER}},
    {"id": "permafrost_frac", "nombre": "Permafrost share", "grupo": "water", "unidad": "1",
     "definicion": "Share of the 0.5° cell with permafrost: mean of the valid 0.01° pixels, percent ÷ 100",
     "transformacion": "lineal",
     "aviso": "Only 25° N to 85° N. No data in the whole southern hemisphere and over much of the temperate northern land: "
              "the product's fill value there is kept as no data, not read as 0 % (docs/validacion-global.md).",
     "fuente": {"texto": "ESA CCI Permafrost extent v5.0 (PFR, MODIS LST and CryoGrid), 0.01°, mean of the cell", "url": URL_CCI}},
    {"id": "elev_m", "nombre": "Elevation", "grupo": "terrain", "unidad": "m",
     "definicion": "Mean elevation of the land part of the 0.5° cell (GMTED2010 30″ pixels with elevation ≠ 0)",
     "transformacion": "lineal", "aviso": None,
     "fuente": {"texto": "USGS GMTED2010 30″, mean of the land pixels of the cell", "url": URL_GMTED30}},
    {"id": "tiempo_ciudad_h", "nombre": "Travel time to a city", "grupo": "operations", "unidad": "h",
     "definicion": "Mean travel time to the nearest city over the pixels of the 0.5° cell, minutes ÷ 60",
     "transformacion": "log10",
     "aviso": "No data south of 60° S (Antarctica) or north of 85° N. Compared on a log scale.",
     "fuente": {"texto": "Weiss et al. (Nature), global map of travel time to cities, 1/30° version, mean of the cell", "url": URL_WEISS}},
    {"id": "litologia_glim", "nombre": "Rock type", "grupo": "geology", "unidad": "class",
     "definicion": "Lithology class of the 0.5° cell in the GLiM 0.5° grid (Hartmann and Moosdorf)",
     "transformacion": "categoria",
     "aviso": "A class, not a number: same class = 0 % deviation, different class = 100 % (own criterion). Class 15 (no data) is left as no data.",
     "fuente": {"texto": "GLiM global lithological map (Hartmann and Moosdorf), 0.5° grid as is", "url": URL_GLIM}},
]


def capa(t, vid):
    a = np.asarray(t[vid], dtype=np.float32).copy()
    if vid == "aridez_ai":
        a[t["aridez_ai_estado"] != 0] = np.nan
    return a


def rango(a, tierra):
    mn, mx = (cu._r(x) for x in cu._percentiles_area(a, tierra >= 0.5))
    return {"min": mn, "max": mx, "origen": "mío", "regla": REGLA, "por_cuerpo": {"earth": [mn, mx]}}


def litologia_clases():
    return json.loads(CAPAS_GLOBAL.read_text(encoding="utf-8"))["litologia_clases"]


def fichas(t, salida, escribir=True):
    """Escribe earth/<id>.f32 en salida y devuelve las entradas de parametros_tierra."""
    out = []
    for v in VARIABLES:
        a = capa(t, v["id"])
        ruta = f"earth/{v['id']}.f32"
        if escribir:
            cu.escribe_f32(salida / ruta, a)
        f = {"id": v["id"], "nombre": v["nombre"], "grupo": v["grupo"], "unidad": v["unidad"], "capas": {"earth": ruta},
             "fuentes": {"earth": v["fuente"]}, "definicion": v["definicion"], "transformacion": v["transformacion"],
             "aviso": v["aviso"], "solo_tierra": True}
        if v["transformacion"] == "categoria":
            f["rango_ref"] = None
            f["clases"] = litologia_clases()
        else:
            f["rango_ref"] = rango(a, t["tierra_frac"])
            if v["transformacion"] == "log10":
                assert f["rango_ref"]["min"] > 0, (v["id"], f["rango_ref"])
        out.append(f)
    return out


def main(argv):
    t = cu.malla_tierra()
    idx = json.loads((cu.SALIDA / "indice.json").read_text(encoding="utf-8"))
    idx["parametros_tierra"] = fichas(t, cu.SALIDA)
    cu.escribe_indice(idx)
    for p in idx["parametros_tierra"]:
        print(p["id"], p["rango_ref"] and [p["rango_ref"]["min"], p["rango_ref"]["max"]], flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
