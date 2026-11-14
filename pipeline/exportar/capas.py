"""Capas globales de docs/contrato-capas.md → web/data/global/ (PNG, capas.json, candidatos, objetivos.json)."""
import csv
import io
import json
import re
from pathlib import Path

import numpy as np
from PIL import Image

from pipeline.exportar.copiar import _atomico
from pipeline.malla import rejilla
from pipeline.motor import similitud as sim

ESCALA_S = 0.004
N_CANDIDATOS = 200
DIMS_PNG = {"a": ["D1", "D2", "D3"], "b": ["D4", "D5", "D6"], "c": ["D8", "D9", None]}
DIMENSIONES = {"D1": "Geology and materials", "D2": "Terrain", "D3": "Temperature and light",
               "D4": "Water, ice, permafrost", "D5": "Dust and wind", "D6": "Biology and habitability",
               "D8": "Operations (feasibility)", "D9": "Operational cold"}
OBJETIVOS = {"jezero": "Jezero crater", "arcadia": "Arcadia Planitia", "shackleton": "Shackleton rim",
             "tranquillitatis": "Mare Tranquillitatis pit", "meridiani": "Meridiani"}
MISIONES = {"P1": "Ice drilling", "P2": "Growing in local soil", "P3": "Polar base", "P4": "Mobility and landing",
            "P5": "Cold and grazing sun"}
LITOLOGIA = {1: "unconsolidated sediments", 2: "basic volcanic", 3: "siliciclastic sedimentary", 4: "basic plutonic",
             5: "mixed sedimentary", 6: "carbonate sedimentary", 7: "acid volcanic", 8: "metamorphic",
             9: "acid plutonic", 10: "intermediate volcanic", 11: "water bodies", 12: "pyroclastics",
             13: "intermediate plutonic", 14: "evaporites", 16: "ice and glaciers"}
PUERTA_VAR = {"casquete_frac": ("ice cap fraction", ""), "relieve_m": ("relief over 1 km", " m"),
              "permafrost_frac": ("permafrost fraction", ""), "aridez_ai": ("aridity index", ""),
              "ndvi_max": ("max NDVI", "")}
# (id, nombre, unidad, scale, offset): codificación de la web, no de la métrica
VARS = {
    "var_a.png": [("radiacion_kwh_m2_dia", "solar radiation", "kWh/m²/day", 0.04, 0.0),
                  ("t_media_c", "mean temperature", "°C", 0.4, -60.0),
                  ("aridez_ai", "aridity index (P/PET)", "1", 0.01, 0.0)],
    "var_b.png": [("ndvi_max", "max NDVI", "1", 0.004, 0.0), ("soc_g_kg", "soil organic carbon 0-5 cm", "g/kg", 1.6, 0.0),
                  ("ph_h2o", "soil pH 0-5 cm", "pH", 0.03, 3.0)],
    "var_c.png": [("rugosidad_tan", "roughness (median differential slope, 0.6 km)", "tan", 0.0008, 0.0),
                  ("relieve_m", "relief over 1 km", "m", 1.6, 0.0), ("tiempo_ciudad_h", "travel time to city", "h", 0.4, 0.0)],
    "var_d.png": [("nv_dias_m23c", "days with max temperature <= -23 °C", "days/year", 1.5, 0.0),
                  ("nv_dias_0c", "days with max temperature <= 0 °C", "days/year", 1.5, 0.0),
                  ("amplitud_diurna_k", "diurnal temperature range", "K", 0.08, 0.0)],
    "var_e.png": [("permafrost_frac", "permafrost fraction", "1", 0.004, 0.0), ("viento_p95_m_s", "wind P95", "m/s", 0.1, 0.0),
                  ("litologia_glim", "lithology (GLiM class code)", "class", 1, 0)],
    "var_f.png": [("f_low", "fraction of sunlit hours with sun below 10°", "1", 0.004, 0.0),
                  ("elev_solar_max_deg", "max solar elevation", "°", 0.4, 0.0), ("elev_m", "elevation", "m", 28.0, -500.0)],
}


def a_byte(v, scale, offset, estado=None):
    v = np.asarray(v, dtype=float)
    b = np.clip(np.round((v - offset) / scale), 0, 250)
    b = np.where(np.isfinite(v), b, 255)
    if estado is not None:
        e = np.asarray(estado)
        b = np.where(e == sim.NA, 254, np.where(e == sim.SD, 255, b))
    return b.astype(np.uint8)


def escribe_png(ruta, r, g, b):
    """Canales en orden de la malla (fila 0 = sur) → PNG con fila 0 = norte, alfa 255."""
    rgba = np.stack([r, g, b, np.full_like(r, 255)], axis=-1)[::-1]
    buf = io.BytesIO()
    Image.fromarray(np.ascontiguousarray(rgba, dtype=np.uint8), "RGBA").save(buf, format="PNG", optimize=True)
    _atomico(Path(ruta), buf.getvalue())


def lee_png(ruta):
    with Image.open(ruta) as im:
        return np.asarray(im.convert("RGBA"))


def _json(ruta, d):
    _atomico(Path(ruta), (json.dumps(d, ensure_ascii=False, indent=1, allow_nan=False) + "\n").encode("utf-8"))


def _f(x, nd=4):
    return None if x is None or not np.isfinite(x) else round(float(x), nd)


def texto_puerta(p):
    nombre, unidad = PUERTA_VAR[p["variable"]]
    t = f"{nombre} {p['condicion']} {p['umbral']:g}{unidad}"
    if p.get("si_na_por_frio") == "pasa":
        t += " or not applicable (cold)"
    return t


def _canal_s(i, nombre):
    return {"id": i, "nombre": nombre, "unidad": "0-1", "scale": ESCALA_S, "offset": 0.0}


def capas_par(u, par, ds, tierra, base, destino):
    o, m = par["objetivo"], par["mision"]
    pid = f"{o}_{m}"
    mis = u["misiones"][m]
    oce = ~tierra
    pinta = lambda b: np.where(oce, 255, b).astype(np.uint8)  # noqa: E731
    canales = {}
    f_s = f"s_{pid}.png"
    escribe_png(destino / f_s, *(pinta(a_byte(ds[k].values, ESCALA_S, 0.0)) for k in ("S", "S_p5", "S_p95")))
    canales[f_s] = [_canal_s("S", "similarity score"), _canal_s("S_p5", "similarity score, 5th percentile (Monte Carlo)"),
                    _canal_s("S_p95", "similarity score, 95th percentile (Monte Carlo)")]
    f_c = f"c_{pid}.png"
    bits = ds["puertas_falladas"].values | (ds["puertas_sin_dato"].values << 4)
    f_val = ds["s_D8"].values if "s_D8" in ds else np.full(tierra.shape, np.nan)
    f_est = ds["estado_D8"].values if "estado_D8" in ds else None
    escribe_png(destino / f_c, pinta(a_byte(ds["C"].values, ESCALA_S, 0.0)), pinta(bits), pinta(a_byte(f_val, ESCALA_S, 0.0, f_est)))
    ids = [p["id"] for p in mis["puertas"]]
    canales[f_c] = [{"id": "C", "nombre": "coverage (sum of weights with data)", "unidad": "0-1", "scale": ESCALA_S, "offset": 0.0},
                    {"id": "puertas", "nombre": "gates: bits 0-3 failed, bits 4-7 no data", "unidad": "bits", "bits": True,
                     "orden": ids, "scale": 1, "offset": 0},
                    {"id": "F", "nombre": "feasibility (D8)", "unidad": "0-1", "scale": ESCALA_S, "offset": 0.0,
                     **({} if "s_D8" in ds else {"vacio": True})}]
    f_dims = []
    for letra, dims in DIMS_PNG.items():
        f = f"dim_{pid}_{letra}.png"
        chans, meta = [], []
        for d in dims:
            if d is None or d not in mis["pesos"]:
                chans.append(np.full(tierra.shape, 255, np.uint8))
                meta.append({"id": d or "libre", "vacio": True, "unidad": "0-1", "scale": ESCALA_S, "offset": 0.0})
            else:
                chans.append(pinta(a_byte(ds[f"s_{d}"].values, ESCALA_S, 0.0, ds[f"estado_{d}"].values)))
                meta.append({"id": d, "nombre": DIMENSIONES[d], "unidad": "0-1", "scale": ESCALA_S, "offset": 0.0})
        escribe_png(destino / f, *chans)
        canales[f] = meta
        f_dims.append(f)
    est = np.where(base, ds["estado"].values, 255)
    n_base = int(base.sum())
    entrada = {
        "id": pid, "objetivo": o, "mision": m, "prerregistrado": par.get("prerregistrado", True),
        "nombre_objetivo": OBJETIVOS[o], "nombre_mision": MISIONES[m], "pesos": mis["pesos"],
        "puertas": [{"id": p["id"], "texto": texto_puerta(p)} for p in mis["puertas"]],
        "n_tierra": n_base, "n_no_evaluables": int(((est == sim.NO_EVAL_PUERTA) | (est == sim.NO_EVAL_C)).sum()),
        "n_fallan_puerta": int((est == sim.FALLADA).sum()),
        "fraccion_tierra_pasa_puertas": round(int((est == sim.PASA).sum()) / n_base, 4) if n_base else None,
        "ficheros": {"s": f_s, "c": f_c, "dim": f_dims},
        "candidatos": {"csv": f"candidatos_{pid}.csv", "geojson": f"candidatos_{pid}.geojson"},
    }
    return entrada, canales


def capas_var(datos, meta, tierra, destino):
    canales = {}
    oce = ~tierra
    for f, lista in VARS.items():
        chans, info = [], []
        for vid, nombre, unidad, scale, offset in lista:
            v = np.asarray(datos[vid], dtype=float) if vid in datos else np.full(tierra.shape, np.nan)
            est = None
            if vid == "aridez_ai" and "aridez_ai_estado" in datos:
                e = np.asarray(datos["aridez_ai_estado"], dtype=float)
                est = np.where(e == 1, sim.NA, np.where(e == 0, sim.OK, sim.SD))
            if vid == "litologia_glim":
                b = np.where(np.isfinite(v), np.clip(v, 0, 250), 255).astype(np.uint8)
            else:
                b = a_byte(v, scale, offset, est)
            chans.append(np.where(oce, 255, b).astype(np.uint8))
            mv = meta.get(vid, {})
            ent = {"id": vid, "nombre": nombre, "unidad": unidad, "scale": scale, "offset": offset,
                   "fuente": mv.get("fuente"), "rango": [offset, round(offset + 250 * scale, 6)]}
            if mv.get("origen"):
                ent["origen"] = mv["origen"]
            if vid not in datos:
                ent["vacio"] = True
            elif vid != "litologia_glim" and np.isfinite(v[tierra]).any() and (
                    np.nanmax(v[tierra]) > offset + 250 * scale or np.nanmin(v[tierra]) < offset):
                ent["recortado"] = True
            info.append(ent)
        escribe_png(destino / f, *chans)
        canales[f] = info
    return canales


def _sitio_cercano(i, j, sitios_celdas):
    mejor = None
    for sid, (si, sj) in sitios_celdas:
        dj = min(abs(sj - j), rejilla.N_LON - abs(sj - j))
        d = max(abs(si - i), dj)
        if d <= 1 and (mejor is None or d < mejor[0]):
            mejor = (d, sid)
    return mejor[1] if mejor else ""


def candidatos(u, par, ds, destino, sitios_celdas):
    pid = f"{par['objetivo']}_{par['mision']}"
    dims = u["misiones"][par["mision"]]["orden"]
    S = ds["S"].values
    ok = (ds["estado"].values == sim.PASA) & np.isfinite(S)
    idx = np.flatnonzero(ok.ravel())
    orden = idx[np.argsort(-S.ravel()[idx], kind="stable")][:N_CANDIDATOS]
    lat, lon = rejilla.lat_centros(), rejilla.lon_centros()
    filas = []
    for k, flat in enumerate(orden, 1):
        i, j = divmod(int(flat), rejilla.N_LON)
        fila = {"puesto": k, "lat": f"{lat[i]:.2f}", "lon": f"{lon[j]:.2f}",
                **{c: _f(ds[c].values[i, j]) for c in ("S", "S_p5", "S_p95", "C")},
                **{d: _f(ds[f"s_{d}"].values[i, j]) for d in dims},
                "sitio_cercano": _sitio_cercano(i, j, sitios_celdas)}
        filas.append(fila)
    cols = ["puesto", "lat", "lon", "S", "S_p5", "S_p95", "C", *dims, "sitio_cercano"]
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=cols, lineterminator="\n")
    w.writeheader()
    for f in filas:
        w.writerow({k: ("" if v is None else v) for k, v in f.items()})
    _atomico(destino / f"candidatos_{pid}.csv", buf.getvalue().encode("utf-8"))
    geo = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [float(f["lon"]), float(f["lat"])]},
         "properties": {**f, "lat": float(f["lat"]), "lon": float(f["lon"])}} for f in filas]}
    _json(destino / f"candidatos_{pid}.geojson", geo)
    return filas


def _urls(x):
    return sorted({m.rstrip(").,;»") for m in re.findall(r"https?://[^\s\]]+", json.dumps(x, ensure_ascii=False))})


def objetivos_json(u):
    salida = []
    for oid, o in u["objetivos"].items():
        e = {"id": oid, "nombre": OBJETIVOS[oid], "cuerpo": o["cuerpo"], "lat": o.get("lat"), "lon": o.get("lon"),
             "coordenadas_fuente": o.get("coordenadas_fuente") or o.get("nota_coordenadas"),
             "clase_litologia": o["clase_litologia"], "misiones": o["misiones"], "no_comparable": o.get("no_comparable", [])}
        if "radiacion_kwh_m2_dia" in o:
            r = o["radiacion_kwh_m2_dia"]
            e["radiacion_kwh_m2_dia"] = {"min": r["min"], "max": r["max"], "nota": "other latitude; order of magnitude",
                                         "fuente": r["fuente"]}
        if "energia" in o:
            e["energia"] = "No panel area is computed: vertical panels on masts, 10 kW per mast in NASA's programme."
        e["fuentes"] = _urls(o)
        salida.append(e)
    return {"objetivos": salida}


def exporta(u, sha, malla, datos, meta, tierra, base, ds, destino, sitios=()):
    destino = Path(destino)
    destino.mkdir(parents=True, exist_ok=True)
    celdas = [(s["id"], rejilla.celda_de(s["lat"], s["lon"])) for s in [*u["validacion"]["sitios"], *sitios]
              if s.get("lat") is not None]
    pares, canales = [], {}
    for p in u["pares"]:
        pid = f"{p['objetivo']}_{p['mision']}"
        entrada, ch = capas_par(u, p, ds[pid], tierra, base, destino)
        candidatos(u, p, ds[pid], destino, celdas)
        pares.append(entrada)
        canales.update(ch)
    canales.update(capas_var(datos, meta, tierra, destino))
    _json(destino / "objetivos.json", objetivos_json(u))
    manifiesto = {
        "malla": malla, "umbrales_sha256": sha,
        "ejemplo": False,
        "rejilla": {"ancho": rejilla.N_LON, "alto": rejilla.N_LAT, "fila0": "norte", "lon0": -179.75, "lat0": 89.75,
                    "paso": rejilla.PASO},
        "par_inicial": f"{u['par_inicial']['objetivo']}_{u['par_inicial']['mision']}",
        "n_tierra_base": "tierra firme del denominador: tierra_frac > 0 y celdas de validación, sin el sur de −60° salvo McMurdo",
        "pares": pares, "canales": canales, "dimensiones": DIMENSIONES,
        "litologia_clases": {str(k): v for k, v in LITOLOGIA.items()},
    }
    _json(destino / "capas.json", manifiesto)
    return manifiesto


def main(build=None, destino=None, vistas=None):
    import xarray as xr

    from pipeline.exportar import vista
    from pipeline.malla import salida
    from pipeline.motor import puntos
    from pipeline.motor import umbrales as um
    from pipeline.validacion.informe import sitios_ensayo

    build = Path(build or um.RAIZ / "build")
    destino = Path(destino or um.RAIZ / "web" / "data" / "global")
    vistas = Path(vistas or build / "global")
    if not (build / "puntos_indice.json").exists():
        print(f"sin {build / 'puntos_indice.json'}: no se exporta lo global (correr python -m pipeline.motor)")
        return None
    u, sha = um.carga()
    indice = json.loads((build / "puntos_indice.json").read_text(encoding="utf-8"))
    malla = (build / "malla_actual.txt").read_text().strip()
    if indice["umbrales_sha256"] != sha or indice["malla"] != malla:
        raise RuntimeError("puntos de otra malla u otros umbrales: correr antes python -m pipeline.motor")
    vars_, _ = salida.lee_actual(build)
    datos = {k: v[0].astype(float) for k, v in vars_.items()}
    meta = json.loads((build / "malla_meta.json").read_text(encoding="utf-8"))["variables"]
    puntos.aplica_valores_a_mano(u, datos)
    tierra, base = puntos.mascaras(u, datos)
    ds = {}
    for p in indice["pares"]:
        if p["exportar"]:
            with xr.open_dataset(build / p["fichero"]) as d:
                ds[p["id"]] = d.load()
    ensayo = [s for s in sitios_ensayo() if s.get("lat") is not None]
    m = exporta(u, sha, malla, datos, meta, tierra, base, ds, destino, sitios=ensayo)
    inf = build / "informe_validacion.json"
    if inf.exists():
        d = json.loads(inf.read_text(encoding="utf-8"))
        if d.get("umbrales_sha256") == sha and d.get("malla") == malla:
            _atomico(destino / "informe_validacion.json", inf.read_bytes())
        else:
            print(f"{inf}: de otra malla u otros umbrales; no se copia")
    marcas = ([{**s, "marca": "x"} for s in u["validacion"]["sitios"]] + [{**s, "marca": "^"} for s in ensayo])
    vistas.mkdir(parents=True, exist_ok=True)
    for p in u["pares"]:
        pid = f"{p['objetivo']}_{p['mision']}"
        vista.mapa_S(ds[pid], pid, tierra, marcas, vistas / f"{pid}_S.png")
        vista.top20(ds[pid], pid, u["misiones"][p["mision"]]["orden"], vistas / f"top20_{pid}.txt")
    print(f"{destino}: {len(m['pares'])} pares, {len(m['canales'])} PNG")
    return m
