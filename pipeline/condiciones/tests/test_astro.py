import math

import numpy as np
import pytest

from pipeline.condiciones import astro

Y_H = astro.ANO_TROPICO_D * 24
EPS = math.radians(astro.OBLICUIDAD_DEG)
TOL_H = 3 / 60


def test_ecuador_noche_de_12_h():
    assert astro.oscuridad_max_h([0.0])[0] == pytest.approx(12.0, abs=TOL_H)


def test_45n_noche_mas_larga_es_la_del_solsticio():
    # Noche = 24 − 2·acos(−tan φ · tan δ)/15°, con δ = −ε el día del solsticio de diciembre.
    phi = math.radians(45.0)
    dia_h = 2 * math.degrees(math.acos(-math.tan(phi) * math.tan(-EPS))) / 15
    assert astro.oscuridad_max_h([45.0])[0] == pytest.approx(24 - dia_h, abs=TOL_H)


def test_polo_sin_excentricidad_es_medio_ano():
    h = astro.oscuridad_max_h([89.999, -89.999], ecc=0.0)
    assert h == pytest.approx([Y_H / 2, Y_H / 2], abs=0.2)


def test_polos_reales_suman_un_ano_y_el_sur_es_mas_largo():
    n, s = astro.oscuridad_max_h([89.999, -89.999])
    assert n + s == pytest.approx(Y_H, abs=0.2)
    # El invierno austral cae cerca del afelio: la Tierra va más despacio.
    assert 170 * 24 < n < 182 * 24 < s < 190 * 24


def test_circulo_polar_separa_menos_de_24_h_de_24_h_o_mas():
    a, b, c, d = astro.oscuridad_max_h([66.25, 66.75, -66.25, -66.75])
    assert a < 24 <= b and c < 24 <= d
    assert astro.lat_umbral(astro.oscuridad_max_h, 24.0, +1) == pytest.approx(90 - astro.OBLICUIDAD_DEG, abs=0.05)


def test_oscuridad_crece_con_la_latitud():
    lat = np.arange(0, 90, 2.5)
    h = astro.oscuridad_max_h(lat)
    assert (np.diff(h) >= -TOL_H).all()


def test_latitud_umbral_cumple_la_condicion_a_cada_lado():
    for hem in (+1, -1):
        x = astro.lat_umbral(astro.oscuridad_max_h, 150.0, hem)
        dentro, fuera = astro.oscuridad_max_h([hem * (abs(x) + 0.02), hem * (abs(x) - 0.02)])
        assert dentro >= 150 > fuera


def test_sol_rasante_en_el_polo_a_mano():
    # Polo, órbita circular: elevación = δ, sin δ = sin ε · sin λ con λ uniforme.
    # 0 < δ ≤ θ  ⇔  0 < sin λ ≤ sin θ / sin ε  →  fracción del año = asin(sin θ / sin ε) / π.
    th = math.radians(astro.ELEV_SOL_POLO_LUNA_DEG)
    esperado = Y_H * math.asin(math.sin(th) / math.sin(EPS)) / math.pi
    assert astro.sol_rasante_h([89.999], ecc=0.0)[0] == pytest.approx(esperado, rel=0.01)


def test_sol_rasante_en_el_ecuador_a_mano():
    # Ecuador: sin e = cos δ · cos H → cada día 2·asin(sin θ / cos δ) rad de ángulo horario con 0 < e ≤ θ.
    th = math.radians(astro.ELEV_SOL_POLO_LUNA_DEG)
    dias = np.arange(0, astro.ANO_TROPICO_D, 0.01)
    dec = np.arcsin(math.sin(EPS) * np.sin(2 * np.pi * dias / astro.ANO_TROPICO_D))
    por_dia_h = 2 * np.arcsin(math.sin(th) / np.cos(dec)) * 12 / np.pi
    esperado = por_dia_h.mean() * astro.ANO_TROPICO_D
    assert astro.sol_rasante_h([0.0], ecc=0.0)[0] == pytest.approx(esperado, rel=0.01)


def test_sol_rasante_coincide_con_contar_muestras_de_10_s():
    # Método independiente: elevación muestreada cada 10 s durante un año, a 60° N.
    paso = 10 / 86400
    t = np.arange(0, astro.ANO_TROPICO_D, paso) + paso / 3
    dec = astro.declinacion(t)
    p = math.radians(60.0)
    s = math.sin(p) * np.sin(dec) + math.cos(p) * np.cos(dec) * np.cos(2 * np.pi * t)
    contado = np.count_nonzero((s > 0) & (s <= math.sin(math.radians(astro.ELEV_SOL_POLO_LUNA_DEG)))) * paso * 24
    assert astro.sol_rasante_h([60.0])[0] == pytest.approx(contado, rel=0.005)


def test_umbral_lunar_sale_de_la_ficha_de_la_nasa():
    assert astro.ELEV_SOL_POLO_LUNA_DEG == pytest.approx(6.68 - 5.145)
