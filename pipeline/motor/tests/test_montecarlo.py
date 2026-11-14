import numpy as np
import pytest

from pipeline.motor import montecarlo as mc
from pipeline.motor import similitud as sim
from pipeline.motor import umbrales as um
from pipeline.motor.tests.test_similitud import RUG, _datos


@pytest.fixture(scope="module")
def u():
    return um.carga()[0]


def test_pesos_uniformes_en_el_simplex_ordenado_tienen_centroide_roc(u):
    orden = u["misiones"]["P3"]["orden"]
    w = mc.muestrea_pesos(orden, 40000, np.random.default_rng(1))
    assert w.shape == (40000, 4)
    assert np.allclose(w.sum(axis=1), 1)
    assert (np.diff(w, axis=1) <= 0).all()
    assert w.mean(axis=0) == pytest.approx(u["metodo_pesos"]["tabla"]["4"], abs=0.005)


def test_factores_log_uniformes_solo_donde_la_escala_es_un_numero(u):
    f, fuera = mc.muestrea_factores(u, 20000, np.random.default_rng(2))
    assert set(f) == {"D2.rugosidad_tan", "D3.nv_dias_m23c", "D3.nv_dias_0c", "D5.R"}
    assert set(fuera) == {"D1.soc_g_kg", "D8.tiempo_ciudad_h"}
    for v in f.values():
        assert v.min() >= 0.5 and v.max() <= 2.0
        assert np.median(v) == pytest.approx(1.0, abs=0.03)
        assert np.mean(np.log(v) < 0) == pytest.approx(0.5, abs=0.02)


def _celdas():
    # 0: pasa · 1: falla relieve · 2: casquete sin dato
    return _datos(litologia_glim=[2, 2, 2], soc_g_kg=[1, 1, 1], rugosidad_tan=[0.003, 0.003, 0.003],
                  nv_dias_m23c=[45, 45, 45], f_low=[0.3, 0.3, 0.3], aridez_ai=[0.01] * 3, aridez_ai_estado=[0] * 3,
                  ndvi_max=[0.05] * 3, tiempo_ciudad_h=[5, 5, 5], relieve_m=[50, 200, 50], casquete_frac=[0, 0, np.nan],
                  viento_p95_m_s=[6, 6, 6])


def test_replicas_dan_p5_p95_y_dimensiones_fijas_no_varian(u):
    d = _celdas()
    central = sim.evalua_par(u, "jezero", "P4", d, RUG)
    r = mc.corre(u, "jezero", "P4", d, RUG, central, 200, np.random.default_rng(3))
    assert r["S"].shape == (200, 3)
    assert r["S_p5"][0] < r["S_p95"][0]
    assert r["S_p5"][1] == 0 and r["S_p95"][1] == 0
    assert np.isnan(r["S_p5"][2]) and np.isnan(r["S_p95"][2])
    assert r["dim_p5"]["D8"][0] == r["dim_p95"]["D8"][0] == central["s"]["D8"][0]
    assert r["dim_p5"]["D2"][0] < r["dim_p95"]["D2"][0]
    r2 = mc.corre(u, "jezero", "P4", d, RUG, central, 200, np.random.default_rng(3))
    assert np.array_equal(r["S_p5"], r2["S_p5"], equal_nan=True)


def test_replica_con_factor_uno_y_pesos_roc_reproduce_la_central(u):
    d = _celdas()
    central = sim.evalua_par(u, "jezero", "P2", d, RUG)
    otra = sim.evalua_par(u, "jezero", "P2", d, RUG, factores={k: 1.0 for k in mc.muestrea_factores(u, 1, np.random.default_rng(0))[0]})
    assert np.allclose(central["S"], otra["S"], equal_nan=True)


def test_estabilidad_de_rango_con_pesos_iguales():
    S = np.array([[0.9, 0.1, 0.5, 0.2], [0.1, 0.9, 0.5, 0.2], [0.9, 0.1, 0.5, 0.2]])
    pesos = np.ones(4)
    est = mc.estabilidad_top(S, pesos, 0.25)
    assert est == pytest.approx([2 / 3, 1 / 3, 0, 0])
