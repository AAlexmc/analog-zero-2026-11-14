"""Malla global 0,5°: 360 × 720 centros, latitud de sur a norte, longitud −180…180."""
import numpy as np
from scipy.interpolate import RegularGridInterpolator

PASO = 0.5
N_LAT = 360
N_LON = 720
R_TIERRA_KM = 6371.0088


def lat_centros():
    return -90.0 + PASO / 2 + PASO * np.arange(N_LAT)


def lon_centros():
    return -180.0 + PASO / 2 + PASO * np.arange(N_LON)


def celda_de(lat, lon):
    i = int(np.clip(np.floor((lat + 90.0) / PASO), 0, N_LAT - 1))
    j = int(np.clip(np.floor((lon + 180.0) / PASO), 0, N_LON - 1))
    return i, j


def area_celda_km2():
    bordes = np.radians(-90.0 + PASO * np.arange(N_LAT + 1))
    fila = R_TIERRA_KM**2 * np.radians(PASO) * np.diff(np.sin(bordes))
    return np.repeat(fila[:, None], N_LON, axis=1)


def agrega_bloques(a, k, estadistico="media"):
    """Bloques k × k de un ráster → (media o mediana sin NaN, n.º de píxeles válidos)."""
    f, c = a.shape[0] // k, a.shape[1] // k
    b = np.asarray(a[: f * k, : c * k], dtype=np.float32).reshape(f, k, c, k).transpose(0, 2, 1, 3).reshape(f, c, k * k)
    n = np.isfinite(b).sum(axis=2)
    with np.errstate(invalid="ignore", divide="ignore"):
        if estadistico == "media":
            s = np.nansum(b, axis=2, dtype=np.float64)
            r = np.where(n > 0, s / np.maximum(n, 1), np.nan)
        elif estadistico == "mediana":
            r = np.full((f, c), np.nan)
            ok = n > 0
            if ok.any():
                r[ok] = np.nanmedian(b[ok], axis=1)
        else:
            raise ValueError(estadistico)
    return r.astype(np.float32), n


def coloca_en_malla(bloque, lat_norte, lon_oeste):
    """Celdas de un ráster norte-arriba (esquina NO en lat_norte, lon_oeste) → malla sur-a-norte llena de NaN."""
    m = np.full((N_LAT, N_LON), np.nan, dtype=np.float32)
    f, c = bloque.shape
    i_arriba = int(round((lat_norte + 90.0) / PASO)) - 1
    j0 = int(round((lon_oeste + 180.0) / PASO))
    filas = i_arriba - np.arange(f)
    m[filas[:, None], (j0 + np.arange(c))[None, :] % N_LON] = bloque
    return m


def media_por_celda(lat, lon, valores):
    """Media de los valores cuyos puntos (lat, lon) caen en cada celda; NaN fuera."""
    lat, lon, valores = (np.asarray(x, dtype=float).ravel() for x in (lat, lon, valores))
    ok = np.isfinite(lat) & np.isfinite(lon) & np.isfinite(valores)
    i = np.clip(np.floor((lat[ok] + 90.0) / PASO).astype(int), 0, N_LAT - 1)
    j = np.clip(np.floor((lon[ok] + 180.0) / PASO).astype(int), 0, N_LON - 1)
    k = i * N_LON + j
    s = np.bincount(k, weights=valores[ok], minlength=N_LAT * N_LON)
    n = np.bincount(k, minlength=N_LAT * N_LON)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(n > 0, s / n, np.nan).reshape(N_LAT, N_LON).astype(np.float32)


def interp_a_malla(campo, lat_src, lon_src):
    """Bilineal desde una rejilla de nodos (lat creciente, lon creciente) a los centros de la malla."""
    lat_src = np.asarray(lat_src, dtype=float)
    lon_src = np.asarray(lon_src, dtype=float)
    campo = np.asarray(campo, dtype=float)
    lon_ext = np.concatenate([lon_src[-1:] - 360.0, lon_src, lon_src[:1] + 360.0])
    campo_ext = np.concatenate([campo[:, -1:], campo, campo[:, :1]], axis=1)
    f = RegularGridInterpolator((lat_src, lon_ext), campo_ext, method="linear", bounds_error=False, fill_value=None)
    lat = np.clip(lat_centros(), lat_src[0], lat_src[-1])
    la, lo = np.meshgrid(lat, lon_centros(), indexing="ij")
    return f(np.stack([la.ravel(), lo.ravel()], axis=1)).reshape(N_LAT, N_LON).astype(np.float32)
