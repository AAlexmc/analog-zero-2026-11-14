import numpy as np
import rasterio
from rasterio.transform import from_origin

from pipeline.terreno import capas, georef
from pipeline.terreno.remuestreo import vecino

CRS_SUR = "+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +x_0=0 +y_0=0 +R=1737400 +units=m +no_defs"


def test_vecino_redondea_y_fuera_es_none():
    a = np.arange(12, dtype=np.int16).reshape(3, 4)
    v, ok = vecino(a, np.array([0.4, 0.6, 2.49, -0.6, 1.0]), np.array([0.0, 2.5, 3.4, 0.0, 3.6]))
    assert list(ok) == [True, True, True, False, False]
    assert list(v[ok]) == [a[0, 0], a[1, 2], a[2, 3]]


def _tif(p, dn, m, escala, offset):
    n = dn.shape[0]
    h = n / 2 * m
    with rasterio.open(p, "w", driver="GTiff", width=n, height=n, count=1, dtype="int16", crs=CRS_SUR,
                       transform=from_origin(-h, h, m, m), nodata=-32768) as d:
        d.write(dn, 1)
        d.scales = (escala,)
        d.offsets = (offset,)


def test_raster_polar_aplica_escala_y_orientacion(tmp_path):
    n, m = 101, 100.0
    f, c = np.mgrid[0:n, 0:n]
    x = (c - (n - 1) / 2) * m
    y = ((n - 1) / 2 - f) * m
    dn = np.rint(10 * x / m + 3 * y / m).astype(np.int16)  # = 10·col_rel + 3·fila_rel
    dn[0, 0] = -32768
    _tif(tmp_path / "a.tif", dn, m, 0.5, 2.0)
    r = capas.RasterPolar(tmp_path / "a.tif")
    xs = np.array([0.0, 250.0, -1230.0])
    ys = np.array([0.0, -470.0, 3333.0])
    assert np.allclose(r.valor_xy(xs, ys), 0.5 * (10 * xs / m + 3 * ys / m) + 2.0, atol=0.5)
    assert np.isnan(r.valor_xy(np.array([-(n - 1) / 2 * m]), np.array([(n - 1) / 2 * m])))[0]


def test_psr_mapea_dn_a_0_1_y_resto_a_255(tmp_path):
    n, m = 41, 60.0
    dn = np.full((n, n), -20000, np.int16)
    dn[:20, :] = 20000
    dn[30, 30] = 0
    _tif(tmp_path / "p.tif", dn, m, 0.000025, 0.5)
    r = capas.RasterPolar(tmp_path / "p.tif")
    g = georef.georef_estereo("sur", 1737400.0, 0.0, 0.0, n, m)
    rej = georef.Rejilla(g, n, m, -90.0, 0.0)
    s = capas.sombra_permanente(r, rej)
    assert s.dtype == np.uint8 and s.shape == (n, n)
    assert set(np.unique(s)) == {0, 1, 255}
    assert np.all(s[:20] == 1) and s[30, 30] == 255 and s[40, 0] == 0
