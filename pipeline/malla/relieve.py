"""Pendiente y relieve solo norte-sur (eje 0 = filas de un ráster equirrectangular)."""
import numpy as np


def _desplaza(z, s):
    out = np.full(z.shape, np.nan, dtype=np.float32 if z.dtype == np.float32 else float)
    n = z.shape[0]
    if s >= 0:
        if s < n:
            out[: n - s] = z[s:]
    elif -s < n:
        out[-s:] = z[: n + s]
    return out


def muestra_ns(z, off_px):
    i0 = int(np.floor(off_px))
    fr = off_px - i0
    if fr < 1e-9:
        return _desplaza(z, i0)
    return (1 - fr) * _desplaza(z, i0) + fr * _desplaza(z, i0 + 1)


def _sin_centro(r, z):
    r[~np.isfinite(z)] = np.nan
    return r


def pendiente_ns(z, dy_m, L_m):
    h = L_m / 2 / dy_m
    return _sin_centro((muestra_ns(z, h) - muestra_ns(z, -h)) / L_m, z)


def pendiente_diferencial_ns(z, dy_m, L_m):
    """|s(L) − s(2L)|, ambas centradas en el píxel (Kreslavsky y Head 2000)."""
    s2 = (muestra_ns(z, L_m / dy_m) - muestra_ns(z, -L_m / dy_m)) / (2 * L_m)
    return np.abs(pendiente_ns(z, dy_m, L_m) - s2)


def relieve_ns(z, dy_m, L_m):
    h = L_m / 2 / dy_m
    return _sin_centro(np.abs(muestra_ns(z, h) - muestra_ns(z, -h)), z)


def mediana_ponderada(v, w):
    v = np.asarray(v, dtype=float).ravel()
    w = np.asarray(w, dtype=float).ravel()
    ok = np.isfinite(v) & np.isfinite(w) & (w > 0)
    if not ok.any():
        return np.nan
    v, w = v[ok], w[ok]
    o = np.argsort(v, kind="stable")
    c = np.cumsum(w[o])
    return float(v[o][np.searchsorted(c, c[-1] / 2)])


def rugosidad_en_radio(z, lat_filas, lon_cols, lat0, lon0, R_km, dy_m, L_m, radio_km, L_relieve_m=1000.0):
    """Píxeles a < radio_km del punto: mediana con peso cos(lat) de la pendiente diferencial y del relieve N-S."""
    d = distancia_km(np.asarray(lat_filas)[:, None], np.asarray(lon_cols)[None, :], lat0, lon0, R_km)
    dentro = d < radio_km
    w = np.repeat(np.cos(np.radians(lat_filas))[:, None], len(lon_cols), axis=1)
    pd = pendiente_diferencial_ns(z, dy_m, L_m)
    rl = relieve_ns(z, dy_m, L_relieve_m)
    return {"rugosidad_tan": mediana_ponderada(pd[dentro], w[dentro]),
            "relieve_m": mediana_ponderada(rl[dentro], w[dentro]),
            "n_pixeles": int(dentro.sum()),
            "n_validos": int(np.isfinite(pd[dentro]).sum())}


def distancia_km(lat1, lon1, lat2, lon2, R_km):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dl = np.radians(np.asarray(lon2) - np.asarray(lon1))
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * R_km * np.arcsin(np.sqrt(np.clip(a, 0.0, 1.0)))
