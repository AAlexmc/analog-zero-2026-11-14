import numpy as np
import pytest

from pipeline.malla import clima


def test_radiacion_extraterrestre_ejemplo_8_de_fao56():
    # FAO-56, ejemplo 8: 20° S, 3 de septiembre (día 246) → Ra = 32,2 MJ/m²·día.
    assert clima.ra_mj_m2_dia(-20.0, 246) == pytest.approx(32.2, abs=0.05)


def test_radiacion_extraterrestre_en_noche_polar_es_cero():
    assert clima.ra_mj_m2_dia(85.0, 355) == pytest.approx(0.0, abs=1e-9)
    assert clima.ra_mj_m2_dia(-85.0, 355) > 40


def test_hargreaves_caso_a_mano():
    # 0,0023 · 0,408 · 30 · (20 + 17,8) · √10 = 3,36506 mm/día
    assert clima.hargreaves_mm_dia(20.0, 10.0, 30.0) == pytest.approx(3.36506, abs=1e-4)


def test_hargreaves_bajo_menos_17_8_da_cero_y_no_negativo():
    assert clima.hargreaves_mm_dia(-30.0, 10.0, 30.0) == 0.0
    assert clima.hargreaves_mm_dia(-17.8, 10.0, 30.0) == 0.0


def test_aridez_caso_a_mano():
    p = np.full(12, 1.0)
    et0 = np.full(12, clima.hargreaves_mm_dia(20.0, 10.0, 30.0))
    ai, pet, estado = clima.aridez(p, et0)
    pet_esperada = 3.36506 * 365
    assert pet == pytest.approx(pet_esperada, rel=1e-4)
    assert ai == pytest.approx(365 / pet_esperada, rel=1e-4)
    assert estado == clima.OK


def test_aridez_meses_bajo_cero_cuentan_cero_no_restan():
    t = np.array([-30.0, -30.0] + [20.0] * 10)
    et0 = clima.hargreaves_mm_dia(t, np.full(12, 10.0), np.full(12, 30.0))
    _, pet, _ = clima.aridez(np.full(12, 1.0), et0)
    dias = clima.DIAS_MES
    assert pet == pytest.approx(3.36506 * dias[2:].sum(), rel=1e-4)


def test_aridez_na_por_frio_si_pet_anual_bajo_100_mm():
    et0 = clima.hargreaves_mm_dia(np.full(12, -25.0), np.full(12, 10.0), np.full(12, 30.0))
    ai, pet, estado = clima.aridez(np.full(12, 0.5), et0)
    assert pet == 0.0
    assert np.isnan(ai) and estado == clima.NA


def test_aridez_sin_dato_si_falta_un_mes():
    p = np.full(12, 1.0)
    p[3] = np.nan
    ai, pet, estado = clima.aridez(p, np.full(12, 3.0))
    assert np.isnan(ai) and estado == clima.SIN_DATO


def test_aridez_por_celdas_en_malla():
    p = np.ones((12, 2, 2))
    et0 = np.full((12, 2, 2), 3.0)
    et0[:, 1, 1] = 0.1
    ai, pet, estado = clima.aridez(p, et0)
    assert ai.shape == (2, 2)
    assert estado[1, 1] == clima.NA and np.isnan(ai[1, 1])
    assert ai[0, 0] == pytest.approx(1 / 3)


def test_elevacion_solar_maxima():
    lat = np.array([0.0, 23.44, 75.4, -89.75, -10.0])
    e = clima.elev_solar_max_deg(lat)
    assert e == pytest.approx([90.0, 90.0, 38.04, 23.69, 90.0])


@pytest.mark.parametrize("lat,esperado", [(28.99, 0.13), (79.5, 0.31), (75.38, 0.36), (89.75, 0.28)])
def test_f_low_frente_a_cifras_de_20_metrica(lat, esperado):
    assert clima.f_low(np.array([lat]))[0] == pytest.approx(esperado, abs=0.02)


def test_f_low_en_el_ecuador_a_mano():
    # Equinoccio en el ecuador: el sol sube en vertical, < 10° durante 2·10/180 de las 12 h.
    assert clima.f_low(np.array([0.0]))[0] == pytest.approx(20 / 180, abs=0.01)
