import numpy as np

from pipeline.cuerpos import dem
from pipeline.malla import rejilla, relieve
from pipeline.malla.construir import L_RELIEVE_M, L_RUGOSIDAD_M


def _dem(filas, cols, seed=3):
    g = np.random.default_rng(seed)
    z = np.cumsum(g.normal(0, 5, (filas, cols)), axis=0).astype(np.float32)
    z[7, 3] = np.nan
    return z


def test_por_bandas_da_lo_mismo_que_el_raster_entero():
    dy, k = 473.8, 8
    z = _dem(64, 32)
    h = dem.halo_px(dy)
    rug, rel = dem.por_bandas(lambda f0, f1: z[f0:f1], z.shape[0], k, dy)
    rug_ref = rejilla.agrega_bloques(relieve.pendiente_diferencial_ns(z, dy, L_RUGOSIDAD_M), k, "mediana")[0]
    rel_ref = rejilla.agrega_bloques(relieve.relieve_ns(z, dy, L_RELIEVE_M), k, "mediana")[0]
    assert h * dy >= L_RUGOSIDAD_M + dy
    np.testing.assert_allclose(rug, rug_ref, rtol=1e-6)
    np.testing.assert_allclose(rel, rel_ref, rtol=1e-6)


def test_por_bandas_con_halo_corto_cambia_el_resultado():
    dy, k = 231.7, 8
    z = _dem(64, 16, seed=5)
    bien, _ = dem.por_bandas(lambda f0, f1: z[f0:f1], 64, k, dy)
    corto, _ = dem.por_bandas(lambda f0, f1: z[f0:f1], 64, k, dy, h=1)
    assert not np.allclose(bien, corto, equal_nan=True)


def test_rugosidad_de_un_plano_es_cero_en_todas_las_bandas():
    dy, k = 463.1, 4
    z = (np.arange(40)[:, None] * 0.05 * dy + np.zeros((1, 12))).astype(np.float32)
    rug, rel = dem.por_bandas(lambda f0, f1: z[f0:f1], 40, k, dy)
    assert np.nanmax(np.abs(rug)) < 1e-6
    np.testing.assert_allclose(rel[1:-1], 0.05 * L_RELIEVE_M, rtol=1e-4)
