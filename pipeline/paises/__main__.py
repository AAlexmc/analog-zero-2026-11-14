"""Límites de países de Natural Earth 1:110m (dominio público) reducidos a nombre + polígonos → web/data/paises_110m.json.

Entrada: <AZ_DATOS>/raw/natural_earth/ne_110m_admin_0_countries.geojson (bajado de URL). Uso: python -m pipeline.paises
"""
import hashlib
import json
import sys
from pathlib import Path

from pipeline.malla.construir import DATOS
from pipeline.malla.salida import _atomico

RAIZ = Path(__file__).resolve().parents[2]
ENTRADA = DATOS / "natural_earth" / "ne_110m_admin_0_countries.geojson"
SALIDA = RAIZ / "web" / "data" / "paises_110m.json"
URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson"
TERMINOS = "https://www.naturalearthdata.com/about/terms-of-use/"
CITA = "All versions of Natural Earth raster + vector map data found on this website are in the public domain."
CAMPO = "ADMIN"
DECIMALES = 2


def anillo(coords, d=DECIMALES):
    out = []
    for lon, lat, *_ in coords:
        p = [round(lon, d), round(lat, d)]
        if not out or p != out[-1]:
            out.append(p)
    if out[0] != out[-1]:
        out.append(out[0])
    return out if len(out) >= 4 else None


def reducir(geojson, d=DECIMALES):
    paises = []
    for f in geojson["features"]:
        g = f["geometry"]
        assert g["type"] in ("Polygon", "MultiPolygon"), g["type"]
        polis = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        poligonos = []
        for poli in polis:
            anillos = [anillo(r, d) for r in poli]
            if anillos[0] is None:
                continue
            poligonos.append([a for a in anillos if a is not None])
        if not poligonos:
            continue
        lons = [p[0] for poli in poligonos for p in poli[0]]
        lats = [p[1] for poli in poligonos for p in poli[0]]
        paises.append({"nombre": f["properties"][CAMPO], "caja": [min(lons), min(lats), max(lons), max(lats)], "poligonos": poligonos})
    return sorted(paises, key=lambda p: p["nombre"])


def documento(entrada=ENTRADA):
    datos = Path(entrada).read_bytes()
    paises = reducir(json.loads(datos))
    meta = {
        "fuente": "Natural Earth, Admin 0 – Countries, 1:110m (ne_110m_admin_0_countries)",
        "url": URL,
        "licencia": "public domain",
        "terminos_url": TERMINOS,
        "cita": CITA,
        "campo_nombre": CAMPO,
        "decimales": DECIMALES,
        "regla": "One entry per feature: English name from the ADMIN field; every ring rounded to 2 decimals, repeated points dropped; caja = [west, south, east, north] of the outer rings. Rings: first outer, the rest holes.",
        "entrada_sha256": hashlib.sha256(datos).hexdigest(),
    }
    return {"meta": meta, "paises": paises}


def main(argv):
    doc = documento(Path(argv[0]) if argv else ENTRADA)
    texto = json.dumps(doc, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n"
    _atomico(SALIDA, lambda t: t.write_text(texto, encoding="utf-8"))
    n = sum(len(r) for p in doc["paises"] for poli in p["poligonos"] for r in poli)
    print(f"{len(doc['paises'])} countries, {n} points, {len(texto.encode())} bytes → {SALIDA}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
