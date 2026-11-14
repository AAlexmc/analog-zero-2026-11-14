"""Rugosidad y relieve globales de la Luna (LOLA LDEM_64) y Marte (MOLA 463 m) a 0,5°, con la definición de la Tierra."""
import numpy as np

from pipeline.malla import rejilla, relieve
from pipeline.malla.construir import DATOS, L_RELIEVE_M, L_RUGOSIDAD_M, URL_LOLA64, URL_MOLA463

R_LOLA_KM = 1737.4
LDEM64 = DATOS / "lola/ldem_64.img"
MOLA463 = DATOS / "mola/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif"


def halo_px(dy):
    return int(np.ceil(max(L_RUGOSIDAD_M, L_RELIEVE_M / 2) / dy)) + 2


def por_bandas(leer, alto, k, dy, h=None):
    """leer(f0, f1) → filas [f0, f1) float32 (NaN sin dato) de un ráster norte-arriba.

    Devuelve (rugosidad, relieve): mediana por bloque k × k de relieve.pendiente_diferencial_ns (L_RUGOSIDAD_M)
    y relieve.relieve_ns (L_RELIEVE_M), igual que construir.rugosidad_tierra; fila 0 = norte.
    """
    h = halo_px(dy) if h is None else h
    rug, rel = [], []
    for b in range(alto // k):
        f0, f1 = b * k - h, (b + 1) * k + h
        z = np.asarray(leer(max(f0, 0), min(f1, alto)), dtype=np.float32)
        arriba, abajo = max(0, -f0), max(0, f1 - alto)
        if arriba or abajo:
            z = np.vstack([np.full((arriba, z.shape[1]), np.nan, np.float32), z,
                           np.full((abajo, z.shape[1]), np.nan, np.float32)])
        rug.append(rejilla.agrega_bloques(relieve.pendiente_diferencial_ns(z, dy, L_RUGOSIDAD_M)[h:-h], k, "mediana")[0])
        rel.append(rejilla.agrega_bloques(relieve.relieve_ns(z, dy, L_RELIEVE_M)[h:-h], k, "mediana")[0])
    return np.vstack(rug), np.vstack(rel)


def luna():
    ppd = 64
    a = np.memmap(LDEM64, dtype="<i2", mode="r", shape=(180 * ppd, 360 * ppd))
    dy = R_LOLA_KM * 1000 * np.radians(1 / ppd)
    rug, rel = por_bandas(lambda f0, f1: a[f0:f1].astype(np.float32) * 0.5, a.shape[0], ppd // 2, dy)
    # LDEM: columna 0 = 0° E → la rejilla común empieza en −180°.
    mitad = rug.shape[1] // 2
    return np.roll(rug, mitad, axis=1), np.roll(rel, mitad, axis=1), {
        "dem": "LOLA LDEM_64 (64 px/deg)", "url": URL_LOLA64, "m_por_px_ns": round(float(dy), 1)}


def marte():
    import rasterio
    from rasterio.windows import Window

    with rasterio.open(MOLA463) as r:
        ppd = round(r.width / 360)
        assert r.width == 360 * ppd and r.height == 180 * ppd and abs(r.bounds.left + r.bounds.right) < 1
        dy = abs(r.transform.e)

        def leer(f0, f1):
            z = r.read(1, window=Window(0, f0, r.width, f1 - f0)).astype(np.float32)
            z[z == r.nodata] = np.nan
            return z

        rug, rel = por_bandas(leer, r.height, ppd // 2, dy)
    return rug, rel, {"dem": f"MOLA MGS global mosaic 463 m ({ppd} px/deg)", "url": URL_MOLA463, "m_por_px_ns": round(float(dy), 1)}
