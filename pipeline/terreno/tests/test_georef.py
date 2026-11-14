import numpy as np
import pyproj
import pytest

from pipeline.terreno import georef

R_LUNA = 1737400.0


def test_estereo_sur_coincide_con_pyproj():
    rng = np.random.default_rng(0)
    lat = rng.uniform(-90, -80, 500)
    lon = rng.uniform(-180, 180, 500)
    x, y = georef.estereo_directa("sur", lat, lon, R_LUNA)
    p = pyproj.Proj(f"+proj=stere +lat_0=-90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +R={R_LUNA}")
    xp, yp = p(lon, lat)
    assert np.allclose(x, xp, atol=1e-3) and np.allclose(y, yp, atol=1e-3)


def test_estereo_sur_ejes_del_contrato():
    # x hacia lon 90° E, y hacia lon 0°
    x, y = georef.estereo_directa("sur", np.array([-89.0, -89.0]), np.array([90.0, 0.0]), R_LUNA)
    assert x[0] > 1000 and abs(y[0]) < 1e-6
    assert y[1] > 1000 and abs(x[1]) < 1e-6


def test_estereo_ida_y_vuelta():
    rng = np.random.default_rng(1)
    lat = rng.uniform(-89.99, -84, 500)
    lon = rng.uniform(-179.9, 179.9, 500)
    x, y = georef.estereo_directa("sur", lat, lon, R_LUNA)
    lat2, lon2 = georef.estereo_inversa("sur", x, y, R_LUNA)
    assert np.allclose(lat, lat2, atol=1e-9) and np.allclose(lon, lon2, atol=1e-7)


def test_estereo_norte_no_soportado():
    with pytest.raises(NotImplementedError):
        georef.estereo_directa("norte", np.array([89.0]), np.array([0.0]), R_LUNA)


def test_aeqd_coincide_con_pyproj():
    lat0, lon0, R = 75.3833, -89.6667, 6396000.0
    rng = np.random.default_rng(2)
    lat = lat0 + rng.uniform(-0.3, 0.3, 500)
    lon = lon0 + rng.uniform(-1.0, 1.0, 500)
    x, y = georef.aeqd_directa(lat, lon, lat0, lon0, R)
    p = pyproj.Proj(f"+proj=aeqd +lat_0={lat0} +lon_0={lon0} +x_0=0 +y_0=0 +R={R}")
    xp, yp = p(lon, lat)
    assert np.allclose(x, xp, atol=1e-3) and np.allclose(y, yp, atol=1e-3)


def test_aeqd_ida_y_vuelta_y_centro():
    lat0, lon0, R = -33.0, 170.0, 6371000.0
    x, y = georef.aeqd_directa(np.array([lat0]), np.array([lon0]), lat0, lon0, R)
    assert abs(x[0]) < 1e-9 and abs(y[0]) < 1e-9
    rng = np.random.default_rng(3)
    lat = lat0 + rng.uniform(-0.5, 0.5, 500)
    lon = lon0 + rng.uniform(-0.5, 12, 500)  # cruza el antimeridiano
    x, y = georef.aeqd_directa(lat, lon, lat0, lon0, R)
    lat2, lon2 = georef.aeqd_inversa(x, y, lat0, lon0, R)
    assert np.allclose(lat, lat2, atol=1e-9)
    assert np.allclose(georef.normaliza_lon(lon), lon2, atol=1e-9)
    assert np.all(lon2 <= 180) and np.all(lon2 > -180)


def test_aeqd_esfera_gauss_cerca_de_wgs84_a_20_km():
    # Con el radio de Gauss del centro, el plano esférico se separa < 1/4 de píxel (39 m) del elipsoidal.
    lat0, lon0 = 75.3833, -89.6667
    R = georef.radio_gauss_wgs84(lat0)
    rej = georef.Rejilla(georef.georef_aeqd(R, 1024, 39.0625), 1024, 39.0625, lat0, lon0)
    f, c = np.meshgrid([0, 511, 1023], [0, 511, 1023], indexing="ij")
    lat, lon = rej.latlon_de_px(f.ravel(), c.ravel())
    p = pyproj.Proj(f"+proj=aeqd +lat_0={lat0} +lon_0={lon0} +x_0=0 +y_0=0 +ellps=WGS84")
    xe, ye = p(lon, lat)
    x, y = rej.xy_de_px(f.ravel(), c.ravel())
    assert np.max(np.hypot(xe - x, ye - y)) < 39.0625 / 4


@pytest.mark.parametrize("tipo", ["estereo_polar", "local_aeqd"])
def test_pixel_latlon_ida_y_vuelta(tipo):
    n, m = 1024, 39.0625
    if tipo == "estereo_polar":
        lat0, lon0 = -89.67, 129.78
        xc, yc = georef.estereo_directa("sur", np.array([lat0]), np.array([lon0]), R_LUNA)
        g = georef.georef_estereo("sur", R_LUNA, xc[0], yc[0], n, m)
    else:
        lat0, lon0 = 75.3833, -89.6667
        g = georef.georef_aeqd(6396000.0, n, m)
    rej = georef.Rejilla(g, n, m, lat0, lon0)
    rng = np.random.default_rng(4)
    f = rng.integers(0, n, 300)
    c = rng.integers(0, n, 300)
    lat, lon = rej.latlon_de_px(f, c)
    f2, c2 = rej.px_de_latlon(lat, lon)
    assert np.allclose(f, f2, atol=1e-6) and np.allclose(c, c2, atol=1e-6)
    # el centro del sitio cae en el centro de la rejilla
    fc, cc = rej.px_de_latlon(np.array([lat0]), np.array([lon0]))
    assert np.allclose([fc[0], cc[0]], [(n - 1) / 2, (n - 1) / 2], atol=1e-6)


def test_fila_0_es_y_maxima_columna_0_x_minima():
    g = georef.georef_aeqd(6371000.0, 8, 10.0)
    rej = georef.Rejilla(g, 8, 10.0, 0.0, 0.0)
    x, y = rej.xy_de_px(np.array([0, 7, 0]), np.array([0, 0, 7]))
    assert y[0] > y[1] and x[2] > x[0]
    assert (x[0], y[0]) == (g["x0_m"], g["y0_m"]) == (-35.0, 35.0)
    lat, lon = rej.latlon_de_px(np.array([0, 7]), np.array([7, 0]))
    assert lat[0] > lat[1] and lon[0] > lon[1]  # arriba-derecha = norte-este
