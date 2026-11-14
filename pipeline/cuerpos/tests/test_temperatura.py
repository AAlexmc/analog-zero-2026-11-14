import numpy as np

from pipeline.cuerpos import temperatura as tp


def test_hueco_max_es_circular():
    f = np.zeros(10, bool)
    f[[0, 1, 8, 9]] = True
    assert tp.hueco_max(f) == 4
    assert tp.hueco_max(np.ones(10, bool)) == 10
    assert tp.hueco_max(np.zeros(10, bool)) == 0


def test_resumen_ciclo_exige_horas_validas_y_huecos_cortos():
    k = np.arange(96)
    ciclo = 250 + 100 * np.cos(2 * np.pi * (k - 48) / 96)
    pocos = ciclo.copy()
    pocos[::2] = np.nan
    hueco = ciclo.copy()
    hueco[40:56] = np.nan
    t = np.stack([ciclo, pocos, hueco])
    mx, mn, me, n = tp.resumen_ciclo(t, 48, 8)
    assert mx[0] == np.float32(350.0) and mn[0] == np.float32(150.0) and abs(me[0] - 250) < 1e-3
    # Uno de cada dos: 48 válidos y huecos de 1 → entra.
    assert np.isfinite(mx[1])
    # Hueco de 16 bins justo en el máximo → no se da el máximo (sería falso).
    assert np.isnan(mx[2]) and np.isnan(mn[2]) and np.isnan(me[2])
    assert list(n) == [96, 48, 80]


def test_vecino_a_rejilla_de_5_grados():
    lat = 87.5 - 5 * np.arange(36)
    lon = -180.0 + 5 * np.arange(72)
    a = lat[:, None] * 1000 + lon[None, :]
    r = tp.vecino_a_rejilla(a, lat, lon)
    assert r.shape == (360, 720)
    # Celda (89,75 N, −179,75) → nodo (87,5, −180); (0,25, 2,25) → (2,5, 0); (−0,25, 179,75) → (−2,5, −180) por el cambio de fecha.
    assert r[0, 0] == 87.5 * 1000 - 180
    assert r[179, 364] == 2.5 * 1000 + 0
    assert r[180, 719] == -2.5 * 1000 - 180
