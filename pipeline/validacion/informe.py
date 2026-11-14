"""H1 (k y k₀), H1-S, H3, controles, descriptivo polar y denominadores según umbrales.json → validacion."""
import json
import re
from pathlib import Path

import numpy as np

from pipeline.malla import rejilla
from pipeline.motor import montecarlo as mc
from pipeline.motor import puntos
from pipeline.motor import similitud as sim

RAIZ = Path(__file__).resolve().parents[2]
ESTADOS = {sim.PASA: "pasa", sim.FALLADA: "puerta_fallada", sim.NO_EVAL_PUERTA: "puerta_sin_dato",
           sim.NO_EVAL_C: "cobertura_baja", puntos.OCEANO: "oceano"}
ESTADOS_DIM = {sim.OK: "ok", sim.NA: "na", sim.SD: "sin_dato"}


def _f(x):
    return None if x is None or not np.isfinite(x) else float(x)


def en_top(valores, pesos, v, frac):
    if v is None or not np.isfinite(v):
        return None, None
    fr = mc.fraccion_mejor_o_igual(valores, pesos, v)
    return bool(fr <= frac + 1e-12), fr


def percentil_area(valores, pesos, v):
    ok = np.isfinite(valores)
    return float(100.0 * pesos[ok & (valores <= v)].sum() / pesos[ok].sum())


def sitios_ensayo(ruta=RAIZ / "datos_json" / "sitios_ensayo.json"):
    return json.loads(Path(ruta).read_text(encoding="utf-8"))["sitios"]


def _celda(s):
    return rejilla.celda_de(s["lat"], s["lon"])


def veredicto_h1(u, k, k0):
    h = u["validacion"]["h1"]
    if k >= h["exito"]["k_min"] and k >= k0 + h["exito"]["k_sobre_k0_min"]:
        return "exito"
    if k <= int(re.search(r"k ≤ (\d+)", h["fallo"]).group(1)):
        return "fallo"
    return "senal_debil"


def h1(u, datos, base, rug):
    W = puntos.pesos_area()
    frac = u["validacion"]["h1"]["percentil_mejor"]
    cache = {}
    filas = []
    for s in u["validacion"]["sitios"]:
        clave = (s["dim"], s["objetivo"])
        if clave not in cache:
            sd, ed = sim.dimension(u, s["dim"], s["objetivo"], datos, rug)
            cache[clave] = (np.where(base & (ed == sim.OK), sd, np.nan), ed)
        grid, ed = cache[clave]
        i, j = _celda(s)
        v = grid[i, j]
        dentro, fr = en_top(grid, W, v, frac)
        fila = {"n": s["n"], "id": s["id"], "dim": s["dim"], "objetivo": s["objetivo"], "celda": [int(i), int(j)],
                "s": _f(v), "estado_dim": ESTADOS_DIM[int(ed[i, j])], "dentro": dentro,
                "fraccion_area_igual_o_mejor": _f(fr), "cuenta": True, "motivo": None}
        motivos = puntos.falta_al_objetivo(u, s["objetivo"], s["mision"])
        if motivos:
            fila.update(cuenta=False, dentro=None, motivo="no evaluable (cierres.sin_resolver): " + "; ".join(motivos),
                        informativo_no_cuenta={"s": _f(v), "dentro": dentro, "fraccion_area_igual_o_mejor": _f(fr)})
            fila["s"] = fila["fraccion_area_igual_o_mejor"] = None
        elif dentro is None:
            fila.update(cuenta=False, motivo=f"no evaluable: {s['dim']} {fila['estado_dim']} en la celda")
        filas.append(fila)
    k = sum(1 for f in filas if f["dentro"] is True)

    ai = np.where(base & (np.asarray(datos["aridez_ai_estado"]) == 0) & np.isfinite(datos["aridez_ai"]),
                  np.asarray(datos["aridez_ai"], dtype=float), np.nan)
    k0_sitios = {}
    for s in u["validacion"]["sitios"]:
        i, j = _celda(s)
        dentro, fr = en_top(-ai, W, -ai[i, j], frac)
        est = datos["aridez_ai_estado"][i, j]
        k0_sitios[s["id"]] = {"aridez_ai": _f(ai[i, j]), "dentro": dentro, "fraccion_area_igual_o_mejor": _f(fr),
                              "motivo": None if dentro is not None else
                              f"no evaluable: aridez {'na por frío' if est == 1 else 'sin_dato'} en la celda"}
    k0 = sum(1 for v in k0_sitios.values() if v["dentro"] is True)
    return {"medida": u["validacion"]["h1"]["medida"], "linea_base": u["validacion"]["h1"]["linea_base"],
            "n_sitios": len(filas), "n": len(filas), "percentil_mejor": frac, "k": k, "k0": k0,
            "veredicto": veredicto_h1(u, k, k0),
            "exito": u["validacion"]["h1"]["exito"]["texto"], "sitios": filas, "k0_sitios": k0_sitios,
            "denominador_k0_celdas": int(np.isfinite(ai).sum()),
            "denominador_celdas": {f"{d}_{o}": int(np.isfinite(g).sum()) for (d, o), (g, _) in cache.items()}}


def _bits(m, ids):
    return [ids[b] for b in range(len(ids)) if m >> b & 1]


def h1_s(u, ds, fuera, base):
    W = puntos.pesos_area()
    frac = u["validacion"]["h1"]["percentil_mejor"]
    fuera = {f["par"]: f["motivos"] for f in fuera}
    filas = []
    for s in u["validacion"]["sitios"]:
        par = f"{s['objetivo']}_{s['mision']}"
        fila = {"n": s["n"], "id": s["id"], "par": par, "dentro": None, "motivo": None}
        if par in fuera:
            fila["motivo"] = f"par {par} no calculado: " + "; ".join(fuera[par])
            filas.append(fila)
            continue
        d = ds[par]
        S = np.where(base, d["S"].values, np.nan)
        i, j = _celda(s)
        est = int(d["estado"].values[i, j])
        dentro, fr = en_top(S, W, S[i, j], frac)
        ids = json.loads(d.attrs["puertas"])
        fila.update(estado=ESTADOS[est], S=_f(S[i, j]), S_p5=_f(d["S_p5"].values[i, j]), S_p95=_f(d["S_p95"].values[i, j]),
                    C=_f(d["C"].values[i, j]), dentro=dentro, fraccion_area_igual_o_mejor=_f(fr),
                    estab_top5=_f(d["estab_top5"].values[i, j]),
                    puertas_falladas=_bits(int(d["puertas_falladas"].values[i, j]), ids),
                    puertas_sin_dato=_bits(int(d["puertas_sin_dato"].values[i, j]), ids))
        if est == sim.NO_EVAL_PUERTA:
            fila["motivo"] = "no evaluable: puerta sin dato (" + ", ".join(fila["puertas_sin_dato"]) + ")"
        elif est == sim.NO_EVAL_C:
            fila["motivo"] = f"no evaluable: C = {fila['C']:.3f} < {u['agregacion']['cobertura_minima']}"
        filas.append(fila)
    fracciones = {}
    for par, d in ds.items():
        est = np.where(base, d["estado"].values, 255)
        ids = json.loads(d.attrs["puertas"])
        n_base = int(base.sum())
        pasan = est == sim.PASA
        fracciones[par] = {
            "n_base": n_base, "n_pasan": int(pasan.sum()), "n_fallan": int((est == sim.FALLADA).sum()),
            "n_puerta_sin_dato": int((est == sim.NO_EVAL_PUERTA).sum()), "n_cobertura_baja": int((est == sim.NO_EVAL_C).sum()),
            "fraccion_celdas": int(pasan.sum()) / n_base if n_base else None,
            "fraccion_area": float(W[pasan].sum() / W[base].sum()) if n_base else None,
            "por_puerta": {p: {"fallan": int((base & ((d["puertas_falladas"].values >> b) & 1).astype(bool)).sum()),
                               "sin_dato": int((base & ((d["puertas_sin_dato"].values >> b) & 1).astype(bool)).sum())}
                           for b, p in enumerate(ids)},
        }
    n_dentro = sum(1 for f in filas if f["dentro"] is True)
    return {"medida": u["validacion"]["h1_s"]["medida"], "tipo": u["validacion"]["h1_s"]["tipo"],
            "n_sitios": len(filas), "n": len(filas), "n_dentro": n_dentro, "k": n_dentro,
            "n_no_evaluables": sum(1 for f in filas if f["dentro"] is None), "sitios": filas,
            "fraccion_pasa_puertas": fracciones}


def jaccard_top(a, b, n):
    def top(x):
        ok = np.isfinite(x)
        if ok.sum() <= n:
            return ok
        thr = np.sort(x[ok])[::-1][n - 1]
        return ok & (x >= thr)
    A, B = top(a), top(b)
    union = (A | B).sum()
    return (float((A & B).sum() / union) if union else None), int(A.sum()), int(B.sum())


def h3(u, ds, base):
    W = puntos.pesos_area()
    h = u["validacion"]["h3"]
    defecto = {m: f"{v['objetivo_por_defecto']}_{m}" for m, v in u["misiones"].items()}
    sitios = {s["id"]: s for s in u["validacion"]["sitios"]}

    def libre(m):
        return np.where(base, ds[defecto[m]]["S_libre"].values, np.nan) if defecto[m] in ds else None

    filas = []
    for p in h["predicciones"]:
        i, j = _celda(sitios[p["sitio"]])
        fila = {**p, "par_sube": defecto[p["sube_en"]], "par_baja": defecto[p["baja_en"]], "acierto": False, "motivo": None}
        fr = {}
        for lado in ("sube_en", "baja_en"):
            g = libre(p[lado])
            v = g[i, j] if g is not None else np.nan
            fr[lado] = mc.fraccion_mejor_o_igual(g, W, v) if g is not None and np.isfinite(v) else np.nan
            fila[f"S_{lado}"] = _f(v)
            fila[f"fraccion_area_igual_o_mejor_{lado}"] = _f(fr[lado])
        if np.isfinite(fr["sube_en"]) and np.isfinite(fr["baja_en"]):
            fila["acierto"] = bool(fr["sube_en"] < fr["baja_en"])
        else:
            fila["motivo"] = "no evaluable en algún perfil (C < mínima o sin par): cuenta como no acierto"
        filas.append(fila)
    jac = {}
    for m1, m2 in h["exito"]["jaccard_pares"]:
        a, b = libre(m1), libre(m2)
        J, na, nb = jaccard_top(a.ravel(), b.ravel(), h["exito"]["jaccard_top"])
        jac[f"{m1}_{m2}"] = {"J": J, "n_top_a": na, "n_top_b": nb, "pares": [defecto[m1], defecto[m2]]}
    aciertos = sum(1 for f in filas if f["acierto"])
    exito = aciertos >= h["exito"]["aciertos_min"] and all(v["J"] is not None and v["J"] < h["exito"]["jaccard_max"]
                                                           for v in jac.values())
    return {"definicion": h["definicion"], "aciertos": aciertos, "de": len(filas), "exito_texto": h["exito"]["texto"],
            "exito": bool(exito), "predicciones": filas, "jaccard": jac,
            "rango": "puesto = fracción del área (cos lat) de la base con S sin puertas ≥ la del sitio; sube = fracción menor"}


def controles(u, ds, base):
    W = puntos.pesos_area()
    c = u["validacion"]["controles"]
    frac = int(re.search(r"top (\d+) %", c["regla"]).group(1)) / 100
    exportados = [f"{p['objetivo']}_{p['mision']}" for p in u["pares"]]
    filas, cuenta = [], {}
    for par in exportados:
        S = np.where(base, ds[par]["S"].values, np.nan)
        cuenta[par] = 0
        for s in c["sitios"]:
            i, j = _celda(s)
            dentro, fr = en_top(S, W, S[i, j], frac)
            cuenta[par] += dentro is True
            filas.append({"par": par, "sitio": s["id"], "S": _f(S[i, j]), "estado": ESTADOS[int(ds[par]["estado"].values[i, j])],
                          "en_top": dentro, "fraccion_area_igual_o_mejor": _f(fr)})
    return {"rotulo": c["rotulo"], "regla": c["regla"], "nota": c["nota"], "en_top": cuenta, "filas": filas}


def descriptivo_polar(u, ds, base, sitios):
    W = puntos.pesos_area()
    dp = u["validacion"]["descriptivo_polar"]
    obj = u["par_inicial"]["objetivo"]
    pares = [f"{p['objetivo']}_{p['mision']}" for p in u["pares"] if p["objetivo"] == obj]
    por_id = {s["id"]: s for s in sitios}
    filas = []
    for sid in dp["sitios"]:
        s = por_id.get(sid)
        for par in pares:
            fila = {"sitio": sid, "par": par, "S": None, "percentil_area": None, "motivo": None}
            if s is None or s.get("lat") is None:
                fila["motivo"] = "sin coordenadas en datos_json/sitios_ensayo.json"
                filas.append(fila)
                continue
            d = ds[par]
            S = np.where(base, d["S"].values, np.nan)
            i, j = _celda(s)
            v = S[i, j]
            fila.update(lat=s["lat"], lon=s["lon"], celda=[int(i), int(j)], estado=ESTADOS[int(d["estado"].values[i, j])],
                        S=_f(v), S_p5=_f(d["S_p5"].values[i, j]), S_p95=_f(d["S_p95"].values[i, j]))
            if np.isfinite(v):
                fila["percentil_area"] = percentil_area(S, W, v)
                fila["fraccion_area_igual_o_mejor"] = mc.fraccion_mejor_o_igual(S, W, v)
            else:
                fila["motivo"] = f"no evaluable ({fila['estado']})"
            filas.append(fila)
    return {"tipo": dp["tipo"], "medida": dp["medida"], "aviso": dp["aviso"],
            "percentil_area": "100 × área (cos lat) de la base con S ≤ la del sitio / área evaluable", "filas": filas}


def denominadores(u, datos, tierra, base):
    lat = rejilla.lat_centros()[:, None] * np.ones((1, rejilla.N_LON))
    d = u["validacion"]["denominador"]
    return {"base": d["base"], "regla": d["antartida"], "celda_con_tierra": d["celda_con_tierra"],
            "n_celdas_tierra_frac_mayor_0": int((np.asarray(datos["tierra_frac"]) > 0).sum()),
            "n_celdas_tierra_con_forzadas": int(tierra.sum()),
            "n_celdas_base": int(base.sum()), "referencia_celdas": d["referencia_celdas"],
            "n_celdas_tierra_sur_de_menos_60_fuera": int((tierra & (lat < -60.0) & ~base).sum()),
            "peso": d["peso_area"]}
