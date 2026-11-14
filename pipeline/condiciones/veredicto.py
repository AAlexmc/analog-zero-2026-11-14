"""Requisito del catálogo → condición de la Tierra que lo pone a prueba → veredicto por celda y global."""
import re

import numpy as np

from pipeline.malla import rejilla

# sentido: la celda alcanza el límite si valor ≥ límite (">=") o valor ≤ límite ("<=").
CONDICIONES = {
    "oscuridad_max_h": {"nombre": "continuous darkness", "unidad": "h", "sentido": ">=", "fraccion": True,
                        "prueba": "Continuous darkness ≥ {v:g} h"},
    "t_min_alcanzable_k": {"nombre": "coldest air temperature", "unidad": "K", "sentido": "<=", "fraccion": False,
                           "prueba": "Air temperature ≤ {v:g} K"},
    "sol_rasante_h_ano": {"nombre": "grazing sun", "unidad": "h/year", "sentido": None, "fraccion": False, "prueba": None},
}
TERRENO = {"pendiente_deg": "local slope", "distancia_recorrido_km": "traverse distance along a route",
           "separacion_m": "separation from another asset"}
# Criterio propio: qué campañas de laboratorio del catálogo tratan cada condición.
CRITERIO_LAB = {"t_min_alcanzable_k": r"\b\d+\s?K\b|chill|cryo|cold", "oscuridad_max_h": r"\bdark|shadow|night"}


def tratamiento(req):
    v, op = req.get("variable"), req.get("op")
    if v == "horas_en_sombra":
        return {"tratamiento": "condicion", "condicion": "oscuridad_max_h", "motivo": None}
    if v == "temp_k" and op == ">=":
        return {"tratamiento": "condicion", "condicion": "t_min_alcanzable_k", "motivo": None}
    if v == "temp_k":
        return {"tratamiento": "no_evaluado", "condicion": None,
                "motivo": "upper temperature limit: no hot-condition layer is computed here"}
    if v in TERRENO:
        return {"tratamiento": "terreno", "condicion": None, "motivo": f"{TERRENO[v]}: depends on the local terrain, not on the 0.5° cell"}
    return {"tratamiento": "no_evaluado", "condicion": None, "motivo": f"no Earth condition computed for '{v}'"}


def alcanza(cond, limite, x):
    x = np.asarray(x, dtype=float)
    with np.errstate(invalid="ignore"):
        return (x >= limite) if CONDICIONES[cond]["sentido"] == ">=" else (x <= limite)


def veredicto_valor(cond, limite, x, alcanzable_en_tierra=True):
    if x is None or not np.isfinite(x):
        return {"veredicto": "no_data", "fraccion": None, "falta": None}
    if not alcanzable_en_tierra:
        return {"veredicto": "not_reachable", "fraccion": None, "falta": float(abs(x - limite))}
    if alcanza(cond, limite, x):
        return {"veredicto": "reaches", "fraccion": 1.0, "falta": 0.0}
    frac = float(x / limite) if CONDICIONES[cond]["fraccion"] else None
    return {"veredicto": "partial", "fraccion": frac, "falta": float(abs(x - limite))}


def resumen(cond, limite, campo, tierra, peso):
    """% de tierra (ponderado por peso = área de tierra de la celda) que alcanza el límite."""
    campo = np.asarray(campo, dtype=float)
    con_dato = tierra & np.isfinite(campo)
    si = con_dato & alcanza(cond, limite, campo)
    p_tot = float(np.sum(peso[con_dato]))
    if not con_dato.any() or p_tot <= 0:
        return {"veredicto_global": "no_data", "pct_tierra": None, "n_celdas_alcanza": 0, "n_celdas_tierra": int(con_dato.sum())}
    v = campo[con_dato]
    return {"veredicto_global": "reaches" if si.any() else "not_reachable",
            "extremo_tierra": round(float(v.max() if CONDICIONES[cond]["sentido"] == ">=" else v.min()), 2),
            "pct_tierra": round(100 * float(np.sum(peso[si])) / p_tot, 3),
            "n_celdas_alcanza": int(si.sum()), "n_celdas_tierra": int(con_dato.sum())}


def laboratorios(sitios, cond):
    patron = CRITERIO_LAB.get(cond)
    if not patron:
        return []
    out = []
    for s in sitios:
        if s.get("tipo") != "laboratorio":
            continue
        for c in s.get("campanas", []):
            if re.search(patron, f"{c.get('sistema', '')} {c.get('que_se_probo', '')}", re.I):
                out.append({"id": s["id"], "nombre": s["nombre"], "campana": c.get("nombre"), "que_se_probo": c.get("que_se_probo"),
                            "equipo_relacionado": c.get("equipo_relacionado", []), "fuente": c.get("fuente"), "cita": c.get("cita"),
                            "verificado": c.get("verificado")})
    return out


def sitios_en(sitios, campos, tierra):
    """Valor de cada condición en la celda de cada sitio de campo. campos y tierra en orden de la malla (fila 0 = sur)."""
    out = []
    for s in sitios:
        if s.get("tipo") != "campo":
            continue
        e = {"id": s["id"], "nombre": s["nombre"], "lat": s.get("lat"), "lon": s.get("lon")}
        if s.get("lat") is None or s.get("lon") is None:
            out.append({**e, "valores": None, "motivo": "no coordinates in the catalog"})
            continue
        i, j = rejilla.celda_de(s["lat"], s["lon"])
        vals = {k: (float(v[i, j]) if np.isfinite(v[i, j]) else None) for k, v in campos.items()}
        out.append({**e, "fila": rejilla.N_LAT - 1 - i, "col": j, "tierra": bool(tierra[i, j]), "valores": vals})
    return out
