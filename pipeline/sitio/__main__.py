"""Capas por criterio de sitio de base (Luna polo sur, Marte) → web/data/sitio/. Uso: python -m pipeline.sitio"""
import json
import sys
from pathlib import Path

import numpy as np

from pipeline.sitio import luna, marte
from pipeline.terreno.escritura import _atomico

RAIZ = Path(__file__).resolve().parents[2]
SALIDA = RAIZ / "web" / "data" / "sitio"
CATALOGO = RAIZ / "datos_json" / "criterios_sitio.json"
TERRENO = RAIZ / "web" / "data" / "terreno" / "polo_sur"
OPS = {"<": np.less, "<=": np.less_equal, ">": np.greater, ">=": np.greater_equal}


def catalogo():
    d = json.loads(CATALOGO.read_text(encoding="utf-8"))
    for mundo in d["mundos"].values():
        for x in mundo["criterios"] + mundo["no_medidos"]:
            assert x["verificado"] is True, x["id"]
    return d


def _cita(x):
    return {"texto": x["cita"], "fuente": x["fuente"]}


def _criterio(cat, cid, tipo, sentido, unidad, capa, definicion, fuente_dato, aviso=None, limite=None):
    x = cat[cid]
    assert x["uso"] == "capa" and tipo in ("limite", "peso", "limite+peso")
    assert ("peso" in tipo) == (sentido in ("mas", "menos")) and ("limite" in tipo) == (limite is not None)
    return {"id": cid, "nombre": x["nombre"], "tipo": tipo, "sentido": sentido, "unidad": unidad, "capa": capa,
            "limite": limite, "cita": _cita(x), "definicion": definicion, "aviso": aviso, "fuente_dato": fuente_dato}


def _no_medidos(lista):
    return [{"nombre": x["nombre"], "cita": _cita(x), "motivo": x["motivo"]} for x in lista]


def _limite_cita(x, op, factor=1):
    """Límite con el número de la cita (en su unidad) convertido a la unidad de la capa."""
    return {"op": op, "valor": x["valor"] * factor, "origen": "cita", "valor_en_cita": f"{x['valor']:g} {x['unidad']}"}


def mundo_luna(cat_mundo, terreno=TERRENO):
    rej, capas, info = luna.capas(terreno)
    cat = {x["id"]: x for x in cat_mundo["criterios"]}
    meta = info["meta"]
    fd = lambda nombre: {"texto": meta["capas"][nombre]["fuente"], "url": meta["capas"][nombre]["url"]}
    m, m2 = meta["m_por_px"], rej["m_por_px"]
    amb = cat["polo_6deg"]
    criterios = [
        _criterio(cat, "iluminacion", "peso", "mas", "fraction of time", "moon/iluminacion.f32",
                  f"Share of time with any part of the Sun visible, mean over the {m2:.0f} m cell "
                  f"(LOLA average illumination, 60 m, resampled to {m:.0f} m)", fd("iluminacion"),
                  "NASA gives no minimum share of sunlight. Averaging over the cell lowers narrow sunlit ridges: "
                  "the best 60 m pixels of the source reach higher values than any cell here."),
        _criterio(cat, "pendiente_deg", "peso", "menos", "deg", "moon/pendiente_deg.f32",
                  f"Slope of each {m:.0f} m pixel of the LOLA height map (central differences, same formula as "
                  f"the terrain viewer), mean over the {m2:.0f} m cell", fd("altura"),
                  f"NASA gives no maximum slope. A mean over {m2:.0f} m hides steeper patches and boulders."),
        _criterio(cat, "dist_sombra_km", "peso", "menos", "km", "moon/dist_sombra_km.f32",
                  f"Straight-line distance from each {m:.0f} m pixel to the nearest permanently shadowed pixel, "
                  f"mean over the {m2:.0f} m cell; measured on the polar stereographic plane "
                  f"(scale error under {100 * (info['escala_max_estereo'] - 1):.1f} % within 6°)", fd("sombra_permanente"),
                  "Shadow outside the 300 km square is not counted, so near its edges the distance can be too long. "
                  "Permanent shadow is where water ice can last, not proof that there is ice. NASA gives no distance."),
    ]
    informativos = [{"id": "temp_max_k", "nombre": "Highest surface temperature of the year", "unidad": "K",
                     "capa": "moon/temp_max_k.f32", "definicion": f"Mean over the {m2:.0f} m cell",
                     "fuente_dato": fd("temp_max"), "aviso": "Shown for information: not a NASA site criterion."}]
    ambito = f"NASA looks within {amb['valor']:g}° of the south pole. We search that area on real terrain."
    out = {"ambito": ambito, "ambito_cita": _cita(amb), "rejilla": rej, "criterios": criterios,
           "informativos": informativos, "no_medidos": _no_medidos(cat_mundo["no_medidos"])}
    return out, capas, info


def mundo_marte(cat_mundo, fuentes):
    capas, info = marte.capas()
    cat = {x["id"]: x for x in cat_mundo["criterios"]}
    e = info["etiqueta"]
    cita_f = lambda i: fuentes[i]["cita"]
    f_megdr = {"texto": f"MGS MOLA MEGDR, {e['ppd']:g} pixels/degree, height above the areoid. “{cita_f('megdr_mediana')}” "
                        f"“{cita_f('megdr_areoide')}”", "url": marte.URL_MEGDR}
    base = info["base_ns_km"]
    criterios = [
        _criterio(cat, "lat_abs_deg", "limite", None, "deg", "mars/lat_abs_deg.f32",
                  "Absolute latitude of the cell centre", {"texto": "Position of the 0.5° grid cell", "url": None},
                  "NASA calls this latitude boundary preliminary.", _limite_cita(cat["lat_abs_deg"], "<=")),
        _criterio(cat, "altitud_m", "limite", None, "m", "mars/altitud_m.f32",
                  f"Mean of the {info['px_por_celda'] ** 2} MOLA MEGDR pixels in the 0.5° cell, height above the areoid "
                  "(MOLA reference)", f_megdr,
                  "Where the MOLA laser has no shot the MEGDR value is interpolated, as its label says.",
                  _limite_cita(cat["altitud_m"], "<", 1000)),
        _criterio(cat, "pendiente_5km_deg", "limite", None, "deg", "mars/pendiente_5km_deg.f32",
                  f"{marte.PERCENTIL}th percentile over the 0.5° cell of the slope between neighbouring MEGDR pixels "
                  f"(north-south step {base:.2f} km; east-west step of round(1/cos latitude) pixels, about the same length)",
                  f_megdr,
                  f"Measured over steps of about {base:.1f} km, not over NASA's 25 km² landing area itself; slopes at the "
                  "scale of a lander are not seen, and interpolated pixels look smoother than the real ground.",
                  _limite_cita(cat["pendiente_5km_deg"], "<")),
        _criterio(cat, "hidrogeno_neutrones", "peso", "menos", "counts/s", "mars/hidrogeno_neutrones.f32",
                  "Epithermal neutron count rate of the 0.5° cell measured by Mars Odyssey; fewer neutrons means more "
                  "hydrogen in the top of the soil",
                  {"texto": f"Mars Odyssey Neutron Spectrometer, epithermal neutron flux, 0.5° cells (Feldman et al. 2002, "
                            f"Science 297, 75-78). “{cita_f('odyssey_ns_etiqueta')}” “{cita_f('odyssey_hidrogeno_bajo')}”",
                   "url": marte.URL_ODYSSEY,
                   "citas": [_cita(fuentes[i]) for i in ("odyssey_ns_etiqueta", "odyssey_ns_columna",
                                                         "odyssey_hidrogeno_bajo", "odyssey_escarcha_norte")]},
                  "An indicator of hydrogen, not an amount of water: it does not tell ice from hydrated minerals, nor "
                  "give tonnes or depth. Only the first 25.7 days of mapping; in the far north seasonal CO₂ frost hid the "
                  "hydrogen at that time. No data at 89.25° and 89.75° north and south."),
    ]
    ambito = "Mars has no chosen site yet. These are NASA's published limits for a human landing zone."
    rej = {"tipo": "equirrectangular", "ancho": marte.ANCHO, "alto": marte.ALTO, "paso_deg": marte.PASO,
           "lat0": 89.75, "lon0": -179.75}
    return {"ambito": ambito, "rejilla": rej, "criterios": criterios,
            "no_medidos": _no_medidos(cat_mundo["no_medidos"])}, capas, info


def aptas(capas, criterios):
    ok = None
    for c in criterios:
        if "limite" in c["tipo"]:
            a = capas[c["id"]]
            with np.errstate(invalid="ignore"):
                r = OPS[c["limite"]["op"]](a, c["limite"]["valor"]) & np.isfinite(a)
            ok = r if ok is None else ok & r
    return ok


def mejor_punto(capas, criterios):
    """Celda de mayor puntuación con pesos iguales: cada capa de peso escalada 0-1 (mín-máx sobre las celdas aptas con
    todas las capas), invertida si «menos», y media. Criterio propio, solo para comparar con la pantalla."""
    pesos = [c for c in criterios if "peso" in c["tipo"]]
    ok = aptas(capas, criterios)
    for c in pesos:
        v = np.isfinite(capas[c["id"]])
        ok = v if ok is None else ok & v
    s = np.zeros(ok.shape)
    for c in pesos:
        a = capas[c["id"]].astype(np.float64)
        lo, hi = a[ok].min(), a[ok].max()
        x = (a - lo) / (hi - lo) if hi > lo else np.zeros_like(a)
        s += (1 - x) if c["sentido"] == "menos" else x
    s = np.where(ok, s / len(pesos), -np.inf)
    i = np.unravel_index(int(np.argmax(s)), s.shape)
    return i, float(s[i])


def fraccion_area(mascara, lat):
    w = np.cos(np.radians(lat))
    return float((w * mascara).sum() / w.sum())


def escribe(salida, ruta, a):
    a = np.ascontiguousarray(a, dtype="<f4")
    _atomico(salida / ruta, a.tobytes())


def main(argv=None, salida=SALIDA):
    d = catalogo()
    fuentes = {x["id"]: x for x in d["fuentes_dato"]}
    assert all(x["verificado"] is True for x in fuentes.values())
    m_luna, c_luna, i_luna = mundo_luna(d["mundos"]["moon"])
    m_marte, c_marte, i_marte = mundo_marte(d["mundos"]["mars"], fuentes)
    for c in m_luna["criterios"] + m_luna["informativos"]:
        escribe(salida, c["capa"], c_luna[c["id"]])
    escribe(salida, "moon/lat.f32", c_luna["lat"])
    escribe(salida, "moon/lon.f32", c_luna["lon"])
    for c in m_marte["criterios"]:
        escribe(salida, c["capa"], c_marte[c["id"]])
    idx = {"formato": "float32 little-endian, row 0 at the top, NaN = no data, longitude east positive",
           "mundos": {"moon": m_luna, "mars": m_marte}}
    texto = json.dumps(idx, ensure_ascii=False, indent=1, allow_nan=False) + "\n"
    _atomico(salida / "indice.json", texto.encode("utf-8"))

    lat_m = np.repeat(marte.lat_filas()[:, None], marte.ANCHO, axis=1)
    ok = aptas(c_marte, m_marte["criterios"])
    print(f"mars: fraction of the surface inside NASA limits {fraccion_area(ok, lat_m):.4f}")
    for c in m_marte["criterios"]:
        if c["limite"]:
            print(f"  {c['id']} {c['limite']['op']} {c['limite']['valor']:g}: "
                  f"{fraccion_area(aptas(c_marte, [c]), lat_m):.4f}")
    (f, k), s = mejor_punto(c_marte, m_marte["criterios"])
    print(f"mars best (equal weights): lat {marte.lat_filas()[f]:.2f} lon {-179.75 + 0.5 * k:.2f} score {s:.3f} "
          + " ".join(f"{c['id']}={c_marte[c['id']][f, k]:.4g}" for c in m_marte["criterios"]))
    (f, k), s = mejor_punto(c_luna, m_luna["criterios"])
    print(f"moon best (equal weights): row {f} col {k} lat {c_luna['lat'][f, k]:.4f} lon {c_luna['lon'][f, k]:.4f} "
          f"score {s:.3f} " + " ".join(f"{c['id']}={c_luna[c['id']][f, k]:.4g}" for c in m_luna["criterios"]))
    print(f"moon cells within 6°: {i_luna['celdas_dentro']}/{i_luna['celdas']}")


if __name__ == "__main__":
    main(sys.argv[1:])
