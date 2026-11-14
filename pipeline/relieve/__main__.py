"""Relieve global de la Luna (LOLA LDEM_16) y Marte (MOLA MEGDR 16 ppd) para la vista de terreno local → web/data/relieve/.

Salida: {mundo}_16ppd.i16, int16 little-endian, fila 0 = norte, columna 0 = −180° (este positivo), centros de píxel en
lat = 90 − (f + 0,5)/ppd y lon = −180 + (c + 0,5)/ppd; metros = valor × factor_m (de la etiqueta). Uso: python -m pipeline.relieve
"""
import json
import re
import sys
from pathlib import Path

import numpy as np

from pipeline.malla.construir import DATOS
from pipeline.malla.salida import _atomico

RAIZ = Path(__file__).resolve().parents[2]
SALIDA = RAIZ / "web" / "data" / "relieve"
TEXTURAS = RAIZ / "web" / "data" / "cuerpos" / "texturas"
URL_LOLA16 = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_16.img"
URL_MEGDR16 = "https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megt90n000eb.img"
FUENTES = {
    "moon": {"img": DATOS / "lola/ldem_16.img", "lbl": DATOS / "lola/ldem_16.lbl", "url": URL_LOLA16,
             "url_etiqueta": URL_LOLA16.replace(".img", ".lbl"), "fuente": "LRO LOLA LDEM_16 (NASA PDS Geosciences Node)",
             "referencia": "height above a sphere of radius 1737.4 km (label OFFSET)",
             "textura": TEXTURAS / "moon_4k.jpg", "textura_credito": "NASA SVS CGI Moon Kit (LRO camera colour mosaic, Arizona State University), https://svs.gsfc.nasa.gov/4720"},
    "mars": {"img": DATOS / "mola/megt90n000eb.img", "lbl": DATOS / "mola/megt90n000eb.lbl", "url": URL_MEGDR16,
             "url_etiqueta": URL_MEGDR16.replace(".img", ".lbl"), "fuente": "MGS MOLA MEGDR 16 px/deg, MEGT90N000EB (NASA PDS Geosciences Node)",
             "referencia": "planetary radius minus the areoid radius (label: GMM3 areoid)",
             "textura": TEXTURAS / "mars_4k.jpg", "textura_credito": "NASA/JPL/USGS Viking colour mosaic (USGS Astrogeology, Mars_Viking_ClrMosaic_global_925m)"},
}


def etiqueta(texto):
    def v(clave, defecto=None):
        m = re.search(rf"^\s*{clave}\s*=\s*\"?([^\"\n<]+)(<[^>]*>)?", texto, re.M)
        if m is None:
            assert defecto is not None, clave
            return defecto, ""
        return m.group(1).strip(), (m.group(2) or "").strip("<> ").lower()

    tipo = v("SAMPLE_TYPE")[0]
    assert tipo in ("LSB_INTEGER", "MSB_INTEGER") and int(v("SAMPLE_BITS")[0]) == 16, tipo
    assert v("UNIT")[0].upper() == "METER"
    radio, u_radio = v("A_AXIS_RADIUS")
    escala, u_escala = v("MAP_SCALE")
    e = {"filas": int(v("LINES")[0]), "columnas": int(v("LINE_SAMPLES")[0]), "ppd": float(v("MAP_RESOLUTION")[0]),
         "orden": "<" if tipo == "LSB_INTEGER" else ">", "factor_m": float(v("SCALING_FACTOR", "1")[0]),
         "radio_m": float(radio) * 1000 if u_radio.startswith("km") else float(radio),
         "m_por_px": round(float(escala) * (1000 if u_escala.startswith("km") else 1), 3)}
    assert float(v("WESTERNMOST_LONGITUDE")[0]) == 0.0 and float(v("MAXIMUM_LATITUDE")[0]) == 90.0
    assert e["columnas"] == 360 * e["ppd"] and e["filas"] == 180 * e["ppd"], e
    # Centros de píxel: el desfase de proyección es la mitad de la rejilla ±0,5 (0 o 1 de base).
    assert abs(float(v("LINE_PROJECTION_OFFSET")[0]) - e["filas"] / 2) == 0.5
    assert abs(float(v("SAMPLE_PROJECTION_OFFSET")[0]) - e["columnas"] / 2) == 0.5
    return e


def a_web(ruta_img, e):
    z = np.fromfile(ruta_img, dtype=f"{e['orden']}i2")
    assert z.size == e["filas"] * e["columnas"], (z.size, e)
    z = z.reshape(e["filas"], e["columnas"])
    return np.roll(z, e["columnas"] // 2, axis=1).astype("<i2")


def tono_medio(im):
    """Color medio (RGB 0-255) de una textura equirrectangular, pesado por el área de cada fila (cos lat)."""
    a = np.asarray(im.convert("RGB"), dtype=np.float64)
    filas = a.shape[0]
    w = np.cos(np.radians(90 - (np.arange(filas) + 0.5) * 180 / filas))
    m = (a.mean(axis=1) * w[:, None]).sum(axis=0) / w.sum()
    return [int(round(x)) for x in m]


def escribir(destino, fuentes=FUENTES):
    from PIL import Image

    destino = Path(destino)
    destino.mkdir(parents=True, exist_ok=True)
    mundos = {}
    for mundo, f in fuentes.items():
        e = etiqueta(Path(f["lbl"]).read_text(encoding="latin-1"))
        w = a_web(f["img"], e)
        nombre = f"{mundo}_{e['ppd']:g}ppd.i16"
        _atomico(destino / nombre, lambda p: w.tofile(p))
        with Image.open(f["textura"]) as im:
            tono = tono_medio(im)
        mundos[mundo] = {
            "fichero": nombre, "tipo": "int16 little-endian", "ancho": e["columnas"], "alto": e["filas"], "ppd": int(e["ppd"]),
            "factor_m": e["factor_m"], "unidad": "m", "referencia": f.get("referencia", ""), "radio_m": e["radio_m"],
            "m_por_px": e["m_por_px"], "min_m": float(w.min()) * e["factor_m"], "max_m": float(w.max()) * e["factor_m"],
            "fuente": {"texto": f["fuente"], "url": f["url"], "etiqueta": f["url_etiqueta"]},
            "tono_medio_rgb": tono, "tono_fuente": f"{Path(f['textura']).name}: {f['textura_credito']}",
        }
    indice = {
        "rejilla": "row 0 = north; column 0 = −180° (east positive); pixel centres at lat = 90 − (row + 0.5)/ppd, lon = −180 + (col + 0.5)/ppd; metres = value × factor_m",
        "mundos": mundos,
    }
    _atomico(destino / "indice.json", lambda p: Path(p).write_text(json.dumps(indice, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"))
    return indice


def main(argv):
    idx = escribir(SALIDA)
    for mundo, m in idx["mundos"].items():
        print(f"{mundo}: {m['fichero']} {m['ancho']}x{m['alto']} factor {m['factor_m']} m, {m['min_m']:.0f}…{m['max_m']:.0f} m, tono {m['tono_medio_rgb']}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
