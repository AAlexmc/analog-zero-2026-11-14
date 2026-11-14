import numpy as np
import pytest

from pipeline.malla import relieve

DY = 231.6


def _plano(pend_ns, pend_eo, filas=40, cols=30, dy=DY, dx=150.0):
    y = np.arange(filas)[:, None] * dy
    x = np.arange(cols)[None, :] * dx
    return (pend_ns * y + pend_eo * x).astype(np.float64)


def test_pendiente_diferencial_de_un_plano_inclinado_es_cero():
    z = _plano(0.12, 0.3)
    d = relieve.pendiente_diferencial_ns(z, DY, 600.0)
    assert np.nanmax(np.abs(d)) < 1e-9
    assert np.isfinite(d[10:30]).all()


def test_pendiente_ns_de_un_plano_inclinado_es_su_pendiente_y_no_ve_la_este_oeste():
    z = _plano(0.12, 0.3)
    s = relieve.pendiente_ns(z, DY, 600.0)
    assert np.nanmax(np.abs(np.abs(s) - 0.12)) < 1e-9


def test_pendiente_diferencial_de_una_onda_norte_sur():
    A, lam = 50.0, 4000.0
    k = 2 * np.pi / lam
    y = np.arange(200) * DY
    z = np.repeat((A * np.sin(k * y))[:, None], 5, axis=1)
    L = 600.0
    d = relieve.pendiente_diferencial_ns(z, DY, L)
    i = 100
    sL = 2 * A * np.cos(k * y[i]) * np.sin(k * L / 2) / L
    s2L = 2 * A * np.cos(k * y[i]) * np.sin(k * L) / (2 * L)
    # Muestras a ±L/2 y ±L por interpolación lineal: tolerancia de esa interpolación.
    assert d[i, 2] == pytest.approx(abs(sL - s2L), rel=0.05)


def test_bordes_y_nan_no_inventan_pendiente():
    z = _plano(0.1, 0.0)
    z[20, 3] = np.nan
    d = relieve.pendiente_diferencial_ns(z, DY, 600.0)
    assert np.isnan(d[0]).all() and np.isnan(d[-1]).all()
    assert np.isnan(d[20, 3]) and np.isnan(d[17, 3]) and np.isfinite(d[20, 2])


def test_relieve_a_1_km_de_un_plano():
    z = _plano(0.05, 0.4)
    r = relieve.relieve_ns(z, DY, 1000.0)
    assert np.nanmax(np.abs(r - 50.0)) < 1e-9


def test_mediana_ponderada():
    v = np.array([1.0, 2.0, 3.0, np.nan])
    assert relieve.mediana_ponderada(v, np.array([1.0, 1.0, 5.0, 9.0])) == 3.0
    assert relieve.mediana_ponderada(v, np.array([5.0, 1.0, 1.0, 1.0])) == 1.0


def test_rugosidad_en_radio_solo_cuenta_pixeles_cercanos():
    # Ventana equirrectangular lunar a 64 px/°: onda norte-sur dentro de 28 km, plano fuera.
    R = 1737.4
    res = 64
    lat = 10.0 - (np.arange(200) + 0.5) / res
    lon = 30.0 + (np.arange(200) + 0.5) / res
    dy = R * 1000 * np.radians(1 / res)
    y = np.arange(200)[:, None] * dy
    z = np.repeat(0.05 * y, 200, axis=1)
    lat0, lon0 = lat[100], lon[100]
    d = relieve.distancia_km(lat[:, None], lon[None, :], lat0, lon0, R)
    onda = 80 * np.sin(2 * np.pi * y / 4000.0)
    z = np.where(d < 28, z + onda, z)
    r = relieve.rugosidad_en_radio(z, lat, lon, lat0, lon0, R, dy, 600.0, 28.0)
    assert r["n_pixeles"] == int((d < 28).sum())
    # |s(L) − s(2L)| = 2A·|sin(kL/2)/L − sin(kL)/(2L)|·|cos ky|; mediana de |cos| = √2/2.
    k, A, L = 2 * np.pi / 4000.0, 80.0, 600.0
    esperado = 2 * A * abs(np.sin(k * L / 2) / L - np.sin(k * L) / (2 * L)) * np.sqrt(2) / 2
    assert r["rugosidad_tan"] == pytest.approx(esperado, rel=0.1)
    plano = relieve.rugosidad_en_radio(np.repeat(0.05 * y, 200, axis=1), lat, lon, lat0, lon0, R, dy, 600.0, 28.0)
    assert plano["rugosidad_tan"] < 1e-9 and plano["relieve_m"] == pytest.approx(50.0, rel=1e-6)


def test_distancia_gran_circulo():
    R = 1737.4
    assert relieve.distancia_km(-90.0, 0.0, -89.0, 123.0, R) == pytest.approx(R * np.radians(1.0))
    assert relieve.distancia_km(0.0, 179.5, 0.0, -179.5, R) == pytest.approx(R * np.radians(1.0))
