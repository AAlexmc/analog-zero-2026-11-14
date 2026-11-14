import numpy as np
import pytest

from pipeline.malla import rejilla


def test_latitudes_de_sur_a_norte_y_longitudes_de_menos180_a_180():
    lat = rejilla.lat_centros()
    lon = rejilla.lon_centros()
    assert lat.shape == (360,) and lon.shape == (720,)
    assert lat[0] == -89.75 and lat[-1] == 89.75
    assert np.all(np.diff(lat) == 0.5)
    assert lon[0] == -179.75 and lon[-1] == 179.75
    assert np.all(np.diff(lon) == 0.5)


def test_celda_de_un_punto():
    i, j = rejilla.celda_de(-24.1, -70.01)
    assert rejilla.lat_centros()[i] == -24.25
    assert rejilla.lon_centros()[j] == -70.25
    assert rejilla.lon_centros()[rejilla.celda_de(0.0, -70.0)[1]] == -69.75
    i, j = rejilla.celda_de(75.4, -89.7)
    assert rejilla.lat_centros()[i] == 75.25 and rejilla.lon_centros()[j] == -89.75
    assert rejilla.celda_de(90.0, 180.0) == (359, 719)


def test_area_total_es_la_de_la_esfera():
    a = rejilla.area_celda_km2()
    assert a.shape == (360, 720)
    R = rejilla.R_TIERRA_KM
    assert a.sum() == pytest.approx(4 * np.pi * R**2, rel=1e-9)
    assert a[180, 0] > a[300, 0] > a[359, 0]


def test_agrega_bloques_media_ignorando_nan():
    k = 4
    a = np.zeros((2 * k, 3 * k), dtype=np.float32)
    a[:k, :k] = 1.0
    a[:k, k:2 * k] = np.nan
    a[k:, :k] = 2.0
    a[k:, :k][0, 0] = np.nan
    a[:k, 2 * k:] = np.arange(k * k).reshape(k, k)
    media, n = rejilla.agrega_bloques(a, k)
    assert media.shape == (2, 3)
    assert media[0, 0] == 1.0
    assert np.isnan(media[0, 1]) and n[0, 1] == 0
    assert media[1, 0] == 2.0 and n[1, 0] == k * k - 1
    assert media[0, 2] == pytest.approx((k * k - 1) / 2)


def test_agrega_bloques_mediana():
    a = np.array([[1, 2, 100, 0], [3, np.nan, 0, 0]], dtype=np.float32)
    med, _ = rejilla.agrega_bloques(a, 2, "mediana")
    assert med[0, 0] == 2.0 and med[0, 1] == 0.0


def test_coloca_bloque_norte_arriba_en_malla_sur_a_norte():
    # Ráster sintético norte-arriba que empieza en 84 N, -180: dos filas de celdas (84-83.5, 83.5-83).
    bloque = np.array([[1.0, 2.0], [3.0, 4.0]])
    m = rejilla.coloca_en_malla(bloque, lat_norte=84.0, lon_oeste=-180.0)
    i_alta, _ = rejilla.celda_de(83.75, -179.75)
    i_baja, _ = rejilla.celda_de(83.25, -179.75)
    assert m[i_alta, 0] == 1.0 and m[i_alta, 1] == 2.0
    assert m[i_baja, 0] == 3.0 and m[i_baja, 1] == 4.0
    assert np.isnan(m).sum() == 360 * 720 - 4


def test_raster_sintetico_de_punta_a_punta():
    # 0,5° a 30″: 60 px por celda. Valor del píxel = latitud del centro de la celda que lo contiene.
    k = 60
    media, _ = rejilla.agrega_bloques(_malla_fina(k), k)
    m = rejilla.coloca_en_malla(media, 84.0, -180.0)
    lat = rejilla.lat_centros()
    sur = lat < 84.0
    assert np.allclose(m[sur, 5], lat[sur])
    assert np.all(np.isnan(m[~sur, 5]))


def _malla_fina(k):
    lat_px = 84.0 - (np.arange(174 * 2 * k) + 0.5) / (2 * k)
    celda_lat = np.floor(lat_px * 2) / 2 + 0.25
    return np.repeat(celda_lat[:, None], 10 * k, axis=1).astype(np.float32)


def test_media_por_celda_de_puntos_sueltos():
    lat = np.array([-24.1, -24.2, -24.4, 10.0, 89.9])
    lon = np.array([-70.01, -70.4, -70.3, 0.1, 179.9])
    v = np.array([1.0, 3.0, np.nan, 7.0, 2.0])
    m = rejilla.media_por_celda(lat, lon, v)
    assert m[rejilla.celda_de(-24.1, -70.01)] == 2.0
    assert m[rejilla.celda_de(10.0, 0.1)] == 7.0
    assert m[359, 719] == 2.0
    assert np.isfinite(m).sum() == 3


def test_interpola_desde_rejilla_power_con_vuelta_en_longitud():
    lat_s = np.arange(-90, 90.01, 0.5)
    lon_s = np.arange(-180, 180, 0.625)
    campo = (2.0 * lat_s[:, None] + 0.0 * lon_s[None, :]) + np.cos(np.radians(lon_s))[None, :]
    m = rejilla.interp_a_malla(campo, lat_s, lon_s)
    lat = rejilla.lat_centros()
    lon = rejilla.lon_centros()
    esperado = 2.0 * lat[:, None] + np.cos(np.radians(lon))[None, :]
    assert m.shape == (360, 720)
    assert np.allclose(m, esperado, atol=2e-4)
    assert m[100, -1] == pytest.approx(2.0 * lat[100] + np.cos(np.radians(179.75)), abs=2e-4)
