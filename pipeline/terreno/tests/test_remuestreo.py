import numpy as np

from pipeline.terreno import fuentes, georef
from pipeline.terreno.remuestreo import bilineal


def test_bilineal_exacto_en_plano():
    f, c = np.mgrid[0:50, 0:60]
    a = (3.0 * f - 2.0 * c + 7.0).astype(np.float32)
    rng = np.random.default_rng(0)
    rf = rng.uniform(0, 49, 1000)
    rc = rng.uniform(0, 59, 1000)
    assert np.allclose(bilineal(a, rf, rc), 3 * rf - 2 * rc + 7, atol=1e-4)
    # bordes exactos
    assert bilineal(a, np.array([49.0]), np.array([59.0]))[0] == a[49, 59]


def test_bilineal_fuera_y_nan_dan_nan():
    a = np.ones((10, 10), np.float32)
    a[5, 5] = np.nan
    v = bilineal(a, np.array([-0.01, 9.01, 2.0, 5.5, 2.5]), np.array([3.0, 3.0, 10.0, 5.5, 2.5]))
    assert np.all(np.isnan(v[:4])) and v[4] == 1.0


def _lbl_sintetico(carpeta, n, escala):
    o = (n - 1) / 2
    (carpeta / "ldem_x.lbl").write_text(f"""PDS_VERSION_ID = "PDS3"
^IMAGE                    = "LDEM_X.IMG"
  OBJECT                  = IMAGE
    LINES                 = {n}
    LINE_SAMPLES          = {n}
    SAMPLE_TYPE           = LSB_INTEGER
    SAMPLE_BITS           = 16
    UNIT                  = METER
    SCALING_FACTOR        = 0.5
    OFFSET                = 1737400.
  END_OBJECT              = IMAGE
OBJECT                    = IMAGE_MAP_PROJECTION
 MAP_PROJECTION_TYPE          = "POLAR STEREOGRAPHIC"
 A_AXIS_RADIUS                = 1737.4 <km>
 CENTER_LATITUDE              = -90 <deg>
 CENTER_LONGITUDE             = 0 <deg>
 MAP_SCALE                    = {escala} <m/pix>
 LINE_PROJECTION_OFFSET       = {o} <pix>
 SAMPLE_PROJECTION_OFFSET     = {o} <pix>
END_OBJECT                    = IMAGE_MAP_PROJECTION
END
""")
    # altura = 0.02·x + 0.05·y con x, y del contrato (fila 0 = y máxima)
    f, c = np.mgrid[0:n, 0:n]
    x = (c - o) * escala
    y = (o - f) * escala
    dn = np.rint((0.02 * x + 0.05 * y) / 0.5).astype("<i2")
    dn.tofile(carpeta / "ldem_x.img")
    return carpeta / "ldem_x.lbl"


def test_lola_lee_etiqueta_y_orientacion(tmp_path):
    dem = fuentes.DemLolaPolar(_lbl_sintetico(tmp_path, 201, 100.0))
    assert dem.polo == "sur" and dem.radio_m == 1737400.0 and dem.m_por_px == 100.0
    x = np.array([0.0, 1234.5, -5000.0, 3000.0])
    y = np.array([0.0, -777.0, 2500.0, 9000.0])
    z = dem.altura_xy(x, y)
    assert np.allclose(z, 0.02 * x + 0.05 * y, atol=0.5)
    assert np.isnan(dem.altura_xy(np.array([20000.0]), np.array([0.0])))[0]


def test_recorte_lunar_escribe_y_maxima_en_fila_0(tmp_path):
    dem = fuentes.DemLolaPolar(_lbl_sintetico(tmp_path, 201, 100.0))
    n, m = 64, 50.0
    g = georef.georef_estereo("sur", dem.radio_m, 1000.0, -2000.0, n, m)
    lat0, lon0 = georef.estereo_inversa("sur", np.array([1000.0]), np.array([-2000.0]), dem.radio_m)
    rej = georef.Rejilla(g, n, m, lat0[0], lon0[0])
    z = dem.recorte(rej)
    assert z.shape == (n, n) and z.dtype == np.float32
    f, c = np.mgrid[0:n, 0:n]
    x, y = rej.xy_de_px(f, c)
    assert np.allclose(z, 0.02 * x + 0.05 * y, atol=0.5)
    assert z[0].mean() > z[-1].mean() and z[:, -1].mean() > z[:, 0].mean()
