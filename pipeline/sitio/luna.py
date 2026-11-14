"""Capas de criterios de sitio en el polo sur lunar a partir de web/data/terreno/polo_sur (promedio 2 × 2)."""
import json
from pathlib import Path

import numpy as np
from scipy import ndimage

from pipeline.malla import rejilla as malla
from pipeline.terreno import georef

LAT_LIMITE = -84.0
K = 2


def pendiente_grados(z, m):
    """Misma definición que pendienteGrados de web/terreno/calculo.js: diferencia centrada; en borde o junto a NaN,
    diferencia hacia el vecino válido; sin vecino válido o celda NaN → NaN."""
    z = np.asarray(z, dtype=np.float64)

    def derivada(eje):
        a = np.moveaxis(z, eje, -1)
        ant = np.full_like(a, np.nan)
        des = np.full_like(a, np.nan)
        ant[..., 1:] = a[..., :-1]
        des[..., :-1] = a[..., 1:]
        d = np.where(np.isfinite(ant) & np.isfinite(des), (des - ant) / (2 * m),
                     np.where(np.isfinite(des), (des - a) / m, (a - ant) / m))
        return np.moveaxis(d, -1, eje)

    with np.errstate(invalid="ignore"):
        g = np.degrees(np.arctan(np.hypot(derivada(1), derivada(0))))
    g[~np.isfinite(z)] = np.nan
    return g


def distancia_sombra_km(sombra, m):
    """Distancia en el plano a la celda más próxima con sombra permanente (sombra == 1); 255 = sin dato, cuenta como no sombra."""
    psr = sombra == 1
    if not psr.any():
        return np.full(sombra.shape, np.nan)
    return ndimage.distance_transform_edt(~psr) * m / 1000.0


def media_2x2(a):
    return malla.agrega_bloques(a, K, "media")[0]


def leer_terreno(carpeta):
    carpeta = Path(carpeta)
    meta = json.loads((carpeta / "meta.json").read_text(encoding="utf-8"))
    n = meta["n"]
    capas = {}
    for nombre, c in meta["capas"].items():
        a = np.fromfile(carpeta / c["fichero"], dtype="<f4" if c["tipo"] == "float32" else "u1").reshape(n, n)
        capas[nombre] = a
    return meta, capas


def capas(carpeta):
    """→ (rejilla de salida, {nombre: ráster n/2 × n/2}, info). Fuera de 6° del polo (centro de celda) → NaN."""
    meta, c = leer_terreno(carpeta)
    n, m = meta["n"], meta["m_por_px"]
    assert meta["georef"]["tipo"] == "estereo_polar" and meta["georef"]["polo"] == "sur" and n % K == 0
    rej = georef.Rejilla(meta["georef"], n, m, meta["centro"]["lat"], meta["centro"]["lon"])
    f, col = np.mgrid[0:n // K, 0:n // K]
    lat, lon = rej.latlon_de_px(K * f + (K - 1) / 2, K * col + (K - 1) / 2)
    dentro = lat <= LAT_LIMITE
    sombra = c["sombra_permanente"]
    out = {
        "iluminacion": media_2x2(c["iluminacion"]),
        "pendiente_deg": media_2x2(pendiente_grados(c["altura"], m)),
        "dist_sombra_km": media_2x2(distancia_sombra_km(sombra, m)),
        "temp_max_k": media_2x2(c["temp_max"]),
    }
    for a in out.values():
        a[~dentro] = np.nan
    out["lat"] = lat.astype(np.float32)
    out["lon"] = lon.astype(np.float32)
    m2 = m * K
    h = (n // K - 1) / 2 * m2
    rej_out = {"tipo": "polar", "n": n // K, "m_por_px": m2, "lat": "moon/lat.f32", "lon": "moon/lon.f32",
               "georef": {"tipo": "estereo_polar", "polo": "sur", "radio_m": meta["georef"]["radio_m"],
                          "x0_m": -h + 0.0, "y0_m": h}}
    info = {"meta": meta, "celdas_dentro": int(dentro.sum()), "celdas": int(dentro.size),
            "lat_max_recorte": float(lat.max()), "sombra_sin_dato_px": int((sombra == 255).sum()),
            "escala_max_estereo": float(2 / (1 + np.sin(np.radians(-LAT_LIMITE))))}
    return rej_out, out, info
