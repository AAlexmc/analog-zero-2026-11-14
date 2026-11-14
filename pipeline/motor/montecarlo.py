"""Réplicas de Monte Carlo (umbrales.json → monte_carlo): escalas × factor log-uniforme y pesos uniformes en el símplex ordenado."""
import re

import numpy as np

from pipeline.motor import similitud as sim


def _perturbacion(u, que):
    for p in u["monte_carlo"]["perturbaciones"]:
        if p["que"].startswith(que):
            return p
    raise KeyError(que)


def muestrea_pesos(orden, n, rng):
    w = rng.dirichlet(np.ones(len(orden)), size=n)
    return -np.sort(-w, axis=1)


def _aplicable(u, clave):
    d, v = clave.split(".")
    spec = u["dimensiones"][d]["variables"][v]
    return spec["tipo"] == "T" or (spec["tipo"] in ("U", "U_inversa") and spec["a"] == 0)


def muestrea_factores(u, n, rng):
    """Factor por escala marcada; con (a, b) y a ≠ 0 umbrales.json no dice cómo aplicarlo → no se perturba."""
    p = _perturbacion(u, "escalas")
    if not p["distribucion"].startswith("log-uniforme"):
        raise ValueError(p["distribucion"])
    lo, hi = (float(x.replace(",", ".")) for x in re.search(r"\[\s*([\d,]+)\s*,\s+([\d,]+)\s*\]", p["distribucion"]).groups())
    aplicadas = [k for k in p["afecta_a"] if _aplicable(u, k)]
    fuera = [k for k in p["afecta_a"] if not _aplicable(u, k)]
    return {k: np.exp(rng.uniform(np.log(lo), np.log(hi), size=n)) for k in aplicadas}, fuera


def comprueba_config(u):
    dato = _perturbacion(u, "dato")
    if dato.get("aplicar", True):
        raise NotImplementedError("perturbación del dato sin σ escrita")
    if _perturbacion(u, "pesos")["distribucion"] != "uniforme":
        raise ValueError("pesos: distribución no uniforme")


def corre(u, objetivo, mision, datos, rug, central, n, rng):
    comprueba_config(u)
    orden = u["misiones"][mision]["orden"]
    pesos = muestrea_pesos(orden, n, rng)
    factores, _ = muestrea_factores(u, n, rng)
    varian = [d for d in orden if any(k.startswith(f"{d}.") for k in factores)]
    ncel = np.shape(central["S"])[0]
    S = np.empty((n, ncel), dtype=np.float32)
    dims = {d: np.empty((n, ncel), dtype=np.float32) for d in varian}
    fijas = {d: (central["s"][d], central["e"][d]) for d in orden}
    for r in range(n):
        f_r = {k: v[r] for k, v in factores.items()}
        s_dims = dict(fijas)
        for d in varian:
            s_dims[d] = sim.dimension(u, d, objetivo, datos, rug, f_r)
            dims[d][r] = s_dims[d][0]
        S_r, _ = sim.agrega({d: v[0] for d, v in s_dims.items()}, {d: v[1] for d, v in s_dims.items()},
                            dict(zip(orden, pesos[r])), u["agregacion"]["suelo_similitud"])
        S[r] = S_r
    est = central["estado"]
    S = np.where(est == sim.PASA, S, np.where(est == sim.FALLADA, 0.0, np.nan)).astype(np.float32)
    q = u["monte_carlo"]["percentiles"]
    S_p = np.full((2, ncel), np.nan)
    con = np.isfinite(S).all(axis=0)
    if con.any():
        S_p[:, con] = np.percentile(S[:, con], q, axis=0)
    dim_p5, dim_p95 = {}, {}
    for d in orden:
        if d in varian:
            ok = central["e"][d] == sim.OK
            p = np.full((2, ncel), np.nan)
            if ok.any():
                p[:, ok] = np.percentile(dims[d][:, ok], q, axis=0)
            dim_p5[d], dim_p95[d] = p[0], p[1]
        else:
            dim_p5[d] = dim_p95[d] = central["s"][d]
    return {"S": S, "S_p5": S_p[0], "S_p95": S_p[1], "dim_p5": dim_p5, "dim_p95": dim_p95,
            "factores": sorted(factores), "pesos": pesos}


def fraccion_mejor_o_igual(valores, pesos, v):
    """Área (peso) con valor ≥ v sobre el área con valor finito."""
    ok = np.isfinite(valores)
    tot = pesos[ok].sum()
    if not np.isfinite(v) or tot <= 0:
        return np.nan
    return float(pesos[ok & (valores >= v)].sum() / tot)


def _fracciones(fila, pesos):
    ok = np.isfinite(fila)
    out = np.full(fila.shape, np.nan)
    if not ok.any():
        return out
    orden = np.argsort(fila[ok], kind="stable")
    asc, w = fila[ok][orden], pesos[ok][orden]
    acum = np.concatenate([[0.0], np.cumsum(w)])
    idx = np.searchsorted(asc, fila[ok], side="left")
    out[ok] = (acum[-1] - acum[idx]) / acum[-1]
    return out


def estabilidad_top(S, pesos, frac):
    """Fracción de réplicas en que la celda queda en el top `frac` por área (empates: el grupo entero debe caber)."""
    dentro = np.zeros(S.shape[1])
    for fila in S:
        f = _fracciones(np.asarray(fila, dtype=float), pesos)
        dentro += np.nan_to_num(f, nan=np.inf) <= frac + 1e-12
    return dentro / S.shape[0]
