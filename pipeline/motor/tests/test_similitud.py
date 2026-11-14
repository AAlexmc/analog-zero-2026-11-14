import math

import numpy as np
import pytest

from pipeline.motor import similitud as sim
from pipeline.motor import umbrales as um

OK, NA, SD = sim.OK, sim.NA, sim.SD


@pytest.fixture(scope="module")
def u():
    return um.carga()[0]


RUG = {"shackleton": 0.00344, "jezero": 0.00123, "arcadia": 0.000247, "tranquillitatis": 0.000555, "meridiani": None}


def a(*x):
    return np.array(x, dtype=float)


def test_distancia_log10():
    s, e = sim.var_T(a(0.01, 10 ** -2.5, 0.0, np.nan), 0.001, 1.0, "log10")
    assert s[:2] == pytest.approx([0.0, 0.5])
    assert list(e) == [OK, OK, SD, SD]
    s, e = sim.var_T(a(0.01), None, 1.0, "log10")
    assert e[0] == SD and np.isnan(s[0])


def test_saturacion_directa_e_inversa():
    s, e = sim.var_U(a(45, 200, -1, np.nan), 0, 90)
    assert s[:3] == pytest.approx([0.5, 1.0, 0.0]) and e[3] == SD
    s, _ = sim.var_U(a(1, 20, 10.5), 1, 20, inversa=True)
    assert s == pytest.approx([1.0, 0.0, 0.5])


def test_saturacion_en_log_del_tiempo_a_ciudad():
    s, e = sim.var_U_log_inversa(a(2, 48, math.sqrt(96), 0, 100, np.nan), 2, 48)
    assert s[:5] == pytest.approx([1, 0, 0.5, 1, 0])
    assert e[5] == SD


def test_clase_de_litologia_con_na_y_sin_dato(u):
    s, e = sim.var_clase(a(2, 4, 1, 11, 16, 15, np.nan), u["tablas_clase"]["litologia"], "luna_polar")
    assert s[:2] == pytest.approx([0.4, 0.6])
    assert list(e) == [OK, OK, SD, NA, NA, SD, SD]


def _datos(**kw):
    n = len(next(iter(kw.values())))
    base = {k: np.full(n, np.nan) for k in ("litologia_glim", "soc_g_kg", "rugosidad_tan", "nv_dias_m23c", "nv_dias_0c",
                                             "amplitud_diurna_k", "f_low", "aridez_ai", "aridez_ai_estado", "permafrost_frac",
                                             "viento_p95_m_s", "ndvi_max", "tiempo_ciudad_h", "relieve_m", "casquete_frac")}
    base.update({k: np.asarray(v, dtype=float) for k, v in kw.items()})
    return base


def test_d1_media_simple_na_se_quita_y_sin_dato_manda(u):
    d = _datos(litologia_glim=[4, 11, 1], soc_g_kg=[1, 10.5, 1])
    s, e = sim.dimension(u, "D1", "shackleton", d, RUG)
    assert s[:2] == pytest.approx([0.8, 0.5])
    assert list(e) == [OK, OK, SD]


def test_d3_segun_objetivo(u):
    d = _datos(nv_dias_m23c=[45], nv_dias_0c=[90], f_low=[0.36], amplitud_diurna_k=[10])
    assert sim.dimension(u, "D3", "jezero", d, RUG)[0][0] == pytest.approx(0.5)
    assert sim.dimension(u, "D3", "arcadia", d, RUG)[0][0] == pytest.approx(1.0)
    assert sim.dimension(u, "D3", "shackleton", d, RUG)[0][0] == pytest.approx(0.36)
    assert sim.dimension(u, "D3", "meridiani", d, RUG)[1][0] == SD


def test_d4_aridez_y_permafrost(u):
    d = _datos(aridez_ai=[0.125, np.nan, 0.125, 0.01], aridez_ai_estado=[0, 1, 0, 2], permafrost_frac=[0.8, 0.8, np.nan, 1])
    s, e = sim.dimension(u, "D4", "jezero", d, RUG)
    assert s[0] == pytest.approx(0.5) and list(e) == [OK, SD, OK, SD]
    s, e = sim.dimension(u, "D4", "arcadia", d, RUG)
    assert s[:2] == pytest.approx([0.5, 0.8])
    assert list(e) == [OK, OK, SD, SD]


def test_d5_luna_na_y_marte_sin_valor_del_objetivo(u):
    d = _datos(viento_p95_m_s=[5.2])
    assert sim.dimension(u, "D5", "shackleton", d, RUG)[1][0] == NA
    assert sim.dimension(u, "D5", "jezero", d, RUG)[1][0] == SD


def test_d2_rugosidad_y_rugosidad_cero(u):
    d = _datos(rugosidad_tan=[0.00344 * 10 ** 0.3, 0.0, 0.00344])
    s, e = sim.dimension(u, "D2", "shackleton", d, RUG)
    assert s[0] == pytest.approx(0.7) and s[2] == pytest.approx(1.0) and e[1] == SD
    assert sim.dimension(u, "D2", "meridiani", d, RUG)[1][0] == SD


def test_factor_de_escala_solo_en_las_marcadas(u):
    d = _datos(nv_dias_m23c=[45], soc_g_kg=[10.5], litologia_glim=[2], tiempo_ciudad_h=[math.sqrt(96)])
    s = sim.dimension(u, "D3", "jezero", d, RUG, factores={"D3.nv_dias_m23c": 0.5})[0][0]
    assert s == pytest.approx(1.0)
    s1 = sim.dimension(u, "D1", "jezero", d, RUG, factores={"D1.soc_g_kg": 2.0})[0][0]
    assert s1 == pytest.approx((1.0 + 0.5) / 2)
    s8 = sim.dimension(u, "D8", "jezero", d, RUG, factores={"D8.tiempo_ciudad_h": 2.0})[0][0]
    assert s8 == pytest.approx(0.5)
    d2 = _datos(rugosidad_tan=[0.00344 * 10 ** 0.6])
    assert sim.dimension(u, "D2", "shackleton", d2, RUG, factores={"D2.rugosidad_tan": 2.0})[0][0] == pytest.approx(0.7)


def test_puertas_de_p1_con_kleene(u):
    d = _datos(casquete_frac=[0, 0, np.nan, 1, 0, 0],
               permafrost_frac=[0.6, 0.4, 0.6, np.nan, 0.6, 0.6],
               aridez_ai=[np.nan, 0.1, 0.1, 0.1, 0.5, np.nan],
               aridez_ai_estado=[1, 0, 0, 0, 0, 2])
    fall, sd = sim.puertas(u, "P1", d)
    assert list(fall) == [0, 0b010, 0, 0b001, 0b100, 0]
    assert list(sd) == [0, 0, 0b001, 0b010, 0, 0b100]


def test_agregacion_suelo_y_cobertura(u):
    pesos = u["misiones"]["P3"]["pesos"]
    s = {"D3": a(0.36, 0.36, 0.01, 0.36), "D8": a(1.0, np.nan, 1.0, 1.0), "D2": a(0.7, 0.7, 0.7, np.nan), "D1": a(0.8, 0.8, 0.8, 0.8)}
    e = {"D3": a(OK, OK, OK, SD), "D8": a(OK, SD, OK, OK), "D2": a(OK, OK, OK, NA), "D1": a(OK, OK, OK, OK)}
    S, C = sim.agrega(s, e, pesos, 0.05)
    w = pesos
    esperado0 = math.exp((w["D3"] * math.log(0.36) + w["D2"] * math.log(0.7) + w["D1"] * math.log(0.8)) / (w["D3"] + w["D8"] + w["D2"] + w["D1"]))
    esperado1 = math.exp((w["D3"] * math.log(0.36) + w["D2"] * math.log(0.7) + w["D1"] * math.log(0.8)) / (w["D3"] + w["D2"] + w["D1"]))
    esperado2 = math.exp((w["D3"] * math.log(0.05) + w["D2"] * math.log(0.7) + w["D1"] * math.log(0.8)) / 1.001)
    assert S[0] == pytest.approx(esperado0) and C[0] == pytest.approx(1.001)
    assert S[1] == pytest.approx(esperado1) and C[1] == pytest.approx(0.73)
    assert S[2] == pytest.approx(esperado2)
    assert C[3] == pytest.approx(0.271 + 0.063)


def test_par_shackleton_p3_cuatro_celdas_a_mano(u):
    # A: todo ok · B: relieve 200 → falla · C: casquete sin dato → no evaluable · D: tiempo sin dato → C = 0,73
    d = _datos(litologia_glim=[4, 4, 4, 4], soc_g_kg=[1, 1, 1, 1], rugosidad_tan=[0.00344] * 4, f_low=[0.36] * 4,
               tiempo_ciudad_h=[2, 2, 2, np.nan], relieve_m=[50, 200, 50, 50], casquete_frac=[0, 0, np.nan, 0])
    r = sim.evalua_par(u, "shackleton", "P3", d, RUG)
    w = u["misiones"]["P3"]["pesos"]
    sA = math.exp((w["D3"] * math.log(0.36) + w["D8"] * 0 + w["D2"] * 0 + w["D1"] * math.log(0.8)) / 1.001)
    sD = math.exp((w["D3"] * math.log(0.36) + w["D1"] * math.log(0.8)) / (w["D3"] + w["D2"] + w["D1"]))
    assert r["S"][0] == pytest.approx(sA)
    assert r["S"][1] == 0.0 and r["S_libre"][1] == pytest.approx(sA)
    assert np.isnan(r["S"][2]) and r["S_libre"][2] == pytest.approx(sA)
    assert r["S"][3] == pytest.approx(sD) and r["C"][3] == pytest.approx(0.73)
    assert list(r["estado"]) == [sim.PASA, sim.FALLADA, sim.NO_EVAL_PUERTA, sim.PASA]


def test_cobertura_baja_no_evaluable(u):
    d = _datos(litologia_glim=[4], soc_g_kg=[1], rugosidad_tan=[0.00344], f_low=[np.nan], tiempo_ciudad_h=[2],
               relieve_m=[50], casquete_frac=[0])
    r = sim.evalua_par(u, "shackleton", "P3", d, RUG)
    assert r["estado"][0] == sim.NO_EVAL_C and np.isnan(r["S"][0]) and np.isnan(r["S_libre"][0])
