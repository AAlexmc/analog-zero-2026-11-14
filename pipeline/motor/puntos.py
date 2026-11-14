"""Malla + umbrales → build/puntos_<obj>_<mis>.nc (S, p5, p95, C, puertas y dimensiones por celda)."""
import json
import os
import zlib
from pathlib import Path

import numpy as np
import xarray as xr

from pipeline.malla import rejilla
from pipeline.motor import montecarlo as mc
from pipeline.motor import similitud as sim

OCEANO = 255


def falta_al_objetivo(u, objetivo, mision):
    o = u["objetivos"][objetivo]
    motivos = []
    if o.get("lat") is None or o.get("lon") is None:
        motivos.append(f"{objetivo}: sin coordenadas en umbrales.json")
    for d in u["misiones"][mision]["pesos"]:
        por = u["dimensiones"][d].get("por_objetivo")
        if por is not None and (por.get(objetivo) is None or por[objetivo].get("variables") is None):
            motivos.append(f"{objetivo}: {d} sin variables (null en umbrales.json)")
    return motivos


def pares_a_calcular(u):
    pares = [{"objetivo": p["objetivo"], "mision": p["mision"], "exportar": True,
              "prerregistrado": p.get("prerregistrado", True)} for p in u["pares"]]
    vistos = {(p["objetivo"], p["mision"]) for p in pares}
    fuera = []
    for s in u["validacion"]["sitios"]:
        clave = (s["objetivo"], s["mision"])
        if clave in vistos:
            continue
        vistos.add(clave)
        motivos = falta_al_objetivo(u, *clave)
        if motivos:
            fuera.append({"par": f"{clave[0]}_{clave[1]}", "motivos": motivos})
        else:
            pares.append({"objetivo": clave[0], "mision": clave[1], "exportar": False, "prerregistrado": True})
    return pares, fuera


def aplica_valores_a_mano(u, datos):
    sitios = {s["id"]: s for s in u["validacion"]["sitios"]}
    registro = []
    for v in u["validacion"]["valores_a_mano"]:
        if v["valor"] is None:
            continue
        s = sitios[v["sitio"]]
        i, j = rejilla.celda_de(s["lat"], s["lon"])
        antes = float(datos[v["variable"]][i, j])
        datos[v["variable"]][i, j] = v["valor"]
        registro.append({"sitio": v["sitio"], "variable": v["variable"], "celda": [i, j],
                         "antes": antes if np.isfinite(antes) else None, "valor": v["valor"]})
    return registro


def mascaras(u, datos):
    """tierra = tierra_frac > 0 o celda de un sitio de validación (forzada); base = tierra sin el sur de −60° salvo McMurdo."""
    tierra = np.asarray(datos["tierra_frac"]) > 0
    for s in u["validacion"]["sitios"]:
        tierra[rejilla.celda_de(s["lat"], s["lon"])] = True
    lat = rejilla.lat_centros()[:, None] * np.ones((1, rejilla.N_LON))
    base = tierra & (lat >= -60.0)
    mc_ = next(s for s in u["validacion"]["sitios"] if s["id"] == "mcmurdo_dry_valleys")
    base[rejilla.celda_de(mc_["lat"], mc_["lon"])] = tierra[rejilla.celda_de(mc_["lat"], mc_["lon"])]
    return tierra, base


def pesos_area():
    return np.cos(np.radians(rejilla.lat_centros()))[:, None] * np.ones((1, rejilla.N_LON))


def semilla_de(sha, objetivo, mision):
    return zlib.crc32(f"{sha}:{objetivo}_{mision}".encode())


def calcula_par(u, sha, objetivo, mision, datos, tierra, base, rug, n_mc, semilla, malla=""):
    idx = np.flatnonzero(tierra)
    flat = {k: np.asarray(v, dtype=float).ravel()[idx] for k, v in datos.items()}
    central = sim.evalua_par(u, objetivo, mision, flat, rug)
    r = mc.corre(u, objetivo, mision, flat, rug, central, n_mc, np.random.default_rng(semilla))
    w = pesos_area().ravel()[idx]
    en_base = base.ravel()[idx]
    S_rep = np.where(en_base[None, :], r["S"], np.nan)
    estab = np.where(np.isfinite(central["S"]) & en_base,
                     mc.estabilidad_top(S_rep, w, u["validacion"]["h1"]["percentil_mejor"]), np.nan)

    def rejilla_de(v, relleno=np.nan, dtype=np.float32):
        a = np.full(rejilla.N_LAT * rejilla.N_LON, relleno, dtype=dtype)
        a[idx] = v
        return a.reshape(rejilla.N_LAT, rejilla.N_LON)

    variables = {
        "S": rejilla_de(central["S"]), "S_p5": rejilla_de(r["S_p5"]), "S_p95": rejilla_de(r["S_p95"]),
        "S_libre": rejilla_de(central["S_libre"]), "C": rejilla_de(central["C"]),
        "estado": rejilla_de(central["estado"], OCEANO, np.uint8),
        "puertas_falladas": rejilla_de(central["fall"], 0, np.uint8),
        "puertas_sin_dato": rejilla_de(central["sd"], 0, np.uint8),
        "estab_top5": rejilla_de(estab), "tierra": tierra.astype(np.uint8), "base": base.astype(np.uint8),
    }
    for d in u["misiones"][mision]["orden"]:
        variables[f"s_{d}"] = rejilla_de(central["s"][d])
        variables[f"estado_{d}"] = rejilla_de(central["e"][d], OCEANO, np.uint8)
        variables[f"p5_{d}"] = rejilla_de(r["dim_p5"][d])
        variables[f"p95_{d}"] = rejilla_de(r["dim_p95"][d])
    m = u["misiones"][mision]
    attrs = {
        "objetivo": objetivo, "mision": mision, "umbrales_sha256": sha, "malla": malla,
        "mc_n": int(n_mc), "mc_semilla": int(semilla), "mc_factores_aplicados": json.dumps(r["factores"]),
        "pesos": json.dumps(m["pesos"]), "orden": json.dumps(m["orden"]),
        "puertas": json.dumps([p["id"] for p in m["puertas"]]),
        "estado_codigos": "0 pasa, 1 puerta fallada (S = 0), 2 puerta sin dato (no evaluable), 3 C < mínima (no evaluable), 255 océano",
        "estado_dim_codigos": "0 ok, 1 na, 2 sin_dato, 255 océano",
        "S_libre": "S sin aplicar puertas (H3); NaN si C < mínima",
        "estab_top5": "fracción de réplicas en el 5 % mejor por área (cos lat) de la base del denominador",
    }
    return xr.Dataset({k: (("lat", "lon"), v) for k, v in variables.items()},
                      coords={"lat": rejilla.lat_centros(), "lon": rejilla.lon_centros()}, attrs=attrs)


def escribe(ds, ruta):
    ruta = Path(ruta)
    ruta.parent.mkdir(parents=True, exist_ok=True)
    tmp = ruta.with_name(f".{ruta.name}.tmp")
    try:
        enc = {n: {"zlib": True, "complevel": 4} for n in ds.data_vars}
        ds.to_netcdf(tmp, encoding=enc, format="NETCDF4")
        os.replace(tmp, ruta)
    finally:
        if tmp.exists():
            tmp.unlink()
    return ruta
