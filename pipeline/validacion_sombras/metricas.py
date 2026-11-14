"""Métricas de V1 (protocolo en PROTOCOLO.md): continuas para la iluminación media, binarias para la sombra permanente."""
import math

import numpy as np
from scipy import stats


def mascara_borde(n, m, margen_m):
    """True en las celdas cuyo centro está a ≥ margen_m de los cuatro bordes del recorte."""
    i = np.arange(n)
    ok = np.minimum(i + 0.5, n - 0.5 - i) * m >= margen_m
    return ok[:, None] & ok[None, :]


def huella(grande, pequeno):
    """Celdas del recorte grande cuyo centro cae dentro del recorte pequeño (misma proyección)."""
    def ejes(t):
        n, m, g = t["n"], t["m_por_px"], t["georef"]
        x = g["x0_m"] + np.arange(n) * m
        y = g["y0_m"] - np.arange(n) * m
        return x, y, (g["x0_m"] - m / 2, g["x0_m"] + (n - 0.5) * m), (g["y0_m"] - (n - 0.5) * m, g["y0_m"] + m / 2)
    x, y, _, _ = ejes(grande)
    _, _, (xa, xb), (ya, yb) = ejes(pequeno)
    return ((y >= ya) & (y <= yb))[:, None] & ((x >= xa) & (x <= xb))[None, :]


def continuas(modelo, oficial, dentro):
    mo, of = np.asarray(modelo, np.float64).ravel(), np.asarray(oficial, np.float64).ravel()
    k = np.asarray(dentro).ravel() & np.isfinite(mo) & np.isfinite(of)
    mo, of = mo[k], of[k]
    r = {"celdas": int(k.sum()), "pearson": math.nan, "spearman": math.nan,
         "error_abs_medio": math.nan, "sesgo_medio": math.nan}
    if mo.size:
        r["error_abs_medio"] = float(np.mean(np.abs(mo - of)))
        r["sesgo_medio"] = float(np.mean(mo - of))
    if mo.size >= 2 and mo.std() > 0 and of.std() > 0:
        r["pearson"] = float(stats.pearsonr(mo, of)[0])
        r["spearman"] = float(stats.spearmanr(mo, of)[0])
    return r


def binarias(pred, oficial, dentro):
    """pred: bool del modelo; oficial: uint8 0/1 con 255 = sin dato."""
    of = np.asarray(oficial).ravel()
    k = np.asarray(dentro).ravel() & (of != 255)
    p, o = np.asarray(pred).ravel()[k].astype(bool), of[k] == 1
    tp, np_, no = int((p & o).sum()), int(p.sum()), int(o.sum())
    union = int((p | o).sum())
    div = lambda a, b: a / b if b else math.nan
    return {"celdas": int(k.sum()), "modelo": np_, "oficial": no, "ambas": tp,
            "precision": div(tp, np_), "exhaustividad": div(tp, no), "iou": div(tp, union)}


def sin_nan(d):
    """NaN → None para que el JSON lo lea un navegador."""
    if isinstance(d, dict):
        return {k: sin_nan(v) for k, v in d.items()}
    if isinstance(d, (list, tuple)):
        return [sin_nan(v) for v in d]
    if isinstance(d, (float, np.floating)):
        return None if math.isnan(d) else float(d)
    if isinstance(d, np.integer):
        return int(d)
    return d
