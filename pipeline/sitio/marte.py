"""Capas de criterios de sitio en Marte sobre la rejilla global de 0,5° (fila 0 = norte, lon −180…180)."""
import re
import warnings

import numpy as np

from pipeline.cuerpos.__main__ import ALTO, ANCHO, PASO, lat_filas
from pipeline.malla import rejilla as malla
from pipeline.malla.construir import DATOS

MEGDR = DATOS / "mola" / "megt90n000eb.img"
MEGDR_LBL = DATOS / "mola" / "megt90n000eb.lbl"
ODYSSEY = DATOS / "odyssey_grs" / "ns_epithermal_020917.tab"
URL_MEGDR = "https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megt90n000eb.img"
URL_ODYSSEY = "https://pds-geosciences.wustl.edu/ody/urn-nasa-pds-odyssey_grs_special/data/ns_epithermal_020917.tab"
PERCENTIL = 95


def etiqueta_megdr(texto):
    def v(clave):
        return re.search(rf"^\s*{clave}\s*=\s*\"?([^\"\n<]+)", texto, re.M).group(1).strip()
    e = {"filas": int(v("LINES")), "columnas": int(v("LINE_SAMPLES")), "ppd": float(v("MAP_RESOLUTION")),
         "radio_km": float(v("A_AXIS_RADIUS")), "tipo": v("SAMPLE_TYPE"), "bits": int(v("SAMPLE_BITS")),
         "lon_oeste": float(v("WESTERNMOST_LONGITUDE")), "lat_max": float(v("MAXIMUM_LATITUDE"))}
    assert e["tipo"] == "MSB_INTEGER" and e["bits"] == 16 and e["lon_oeste"] == 0.0 and e["lat_max"] == 90.0, e
    assert e["columnas"] == 360 * e["ppd"] and e["filas"] == 180 * e["ppd"], e
    return e


def leer_megdr(ruta=MEGDR, ruta_lbl=MEGDR_LBL):
    """MEGDR en metros, fila 0 = norte, columna 0 = −180° (la original empieza en 0° E)."""
    e = etiqueta_megdr(ruta_lbl.read_text())
    z = np.fromfile(ruta, dtype=">i2").reshape(e["filas"], e["columnas"]).astype(np.float32)
    return np.roll(z, e["columnas"] // 2, axis=1), e


def pendiente_cuadros(z, ppd, radio_km):
    """Pendiente (°) de cada cuadro de píxeles vecinos: N-S entre filas contiguas; E-W con un salto de
    round(1/cos(lat)) columnas para que la base E-W sea ≈ la N-S. Cuadro (f, c) = píxeles f, f+1 y c, c+salto."""
    filas, cols = z.shape
    dy = radio_km * 1000 * np.radians(1 / ppd)
    out = np.full(z.shape, np.nan, np.float32)
    for f in range(filas - 1):
        lat = 90.0 - (f + 1) / ppd
        salto = max(1, int(round(1 / max(np.cos(np.radians(lat)), 1 / cols))))
        salto = min(salto, cols // 2)
        dx = salto * dy * np.cos(np.radians(lat))
        a, b = z[f].astype(np.float64), z[f + 1].astype(np.float64)
        gx = ((np.roll(a, -salto) - a) + (np.roll(b, -salto) - b)) / (2 * dx)
        gy = ((b - a) + (np.roll(b, -salto) - np.roll(a, -salto))) / (2 * dy)
        out[f] = np.degrees(np.arctan(np.hypot(gx, gy)))
    return out, dy


def percentil_bloques(a, k, q):
    f, c = a.shape[0] // k, a.shape[1] // k
    b = a[: f * k, : c * k].reshape(f, k, c, k).transpose(0, 2, 1, 3).reshape(f, c, k * k)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return np.nanpercentile(b, q, axis=2).astype(np.float32)


def leer_odyssey(ruta=ODYSSEY):
    """Flujo epitérmico (cuentas/s) en la rejilla común; 0,000 = celda sin dato (filas de ±89,25° y ±89,75°)."""
    t = np.loadtxt(ruta, delimiter=",", dtype=np.float64)
    assert t.shape == (ALTO * ANCHO, 3), t.shape
    lon = np.where(t[:, 0] > 180, t[:, 0] - 360, t[:, 0])
    f = np.rint((90 - PASO / 2 - t[:, 1]) / PASO).astype(int)
    c = np.rint((lon + 180 - PASO / 2) / PASO).astype(int)
    out = np.full((ALTO, ANCHO), np.nan, np.float32)
    out[f, c] = np.where(t[:, 2] > 0, t[:, 2], np.nan)
    assert np.unique(f * ANCHO + c).size == ALTO * ANCHO
    return out


def capas(ruta_megdr=MEGDR, ruta_lbl=MEGDR_LBL, ruta_odyssey=ODYSSEY):
    z, e = leer_megdr(ruta_megdr, ruta_lbl)
    k = int(e["ppd"] * PASO)
    pend, dy = pendiente_cuadros(z, e["ppd"], e["radio_km"])
    lat = np.repeat(lat_filas()[:, None], ANCHO, axis=1).astype(np.float32)
    out = {"lat_abs_deg": np.abs(lat),
           "altitud_m": malla.agrega_bloques(z, k, "media")[0],
           "pendiente_5km_deg": percentil_bloques(pend, k, PERCENTIL),
           "hidrogeno_neutrones": leer_odyssey(ruta_odyssey)}
    info = {"etiqueta": e, "px_por_celda": k, "base_ns_km": dy / 1000, "z_min": float(z.min()), "z_max": float(z.max())}
    return out, info
