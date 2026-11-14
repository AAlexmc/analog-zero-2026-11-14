import math

import numpy as np
import pytest

from pipeline.malla import rejilla
from pipeline.motor import puntos
from pipeline.motor import umbrales as um
from pipeline.motor.tests.test_puntos import BUENA, malla_sintetica
from pipeline.motor.tests.test_similitud import RUG
from pipeline.validacion import informe as inf


@pytest.fixture(scope="module")
def u():
    return um.carga()[0]


def sitio(u, i):
    return next(s for s in u["validacion"]["sitios"] if s["id"] == i)


def test_top_por_area_con_empates():
    v = np.array([1.0, 1.0, 0.5, 0.2, np.nan])
    w = np.array([1.0, 1.0, 1.0, 1.0, 5.0])
    assert inf.en_top(v, w, 1.0, 0.5) == (True, 0.5)
    assert inf.en_top(v, w, 1.0, 0.25) == (False, 0.5)
    assert inf.en_top(v, w, 0.5, 0.75) == (True, 0.75)
    assert inf.en_top(v, w, np.nan, 0.5) == (None, None)
    assert inf.percentil_area(v, w, 0.5) == pytest.approx(50.0)


def _relleno(n, lat=0.25, **vals):
    return {(lat, -179.75 + 0.5 * k): {**BUENA, **vals} for k in range(n)}


def test_h1_yungay_dentro_y_fuera_por_empate(u):
    y = sitio(u, "yungay")
    celdas = _relleno(400, aridez_ai=1.0)
    celdas[(y["lat"], y["lon"])] = {**BUENA, "aridez_ai": 0.01}
    d = malla_sintetica(celdas)
    tierra, base = puntos.mascaras(u, d)
    r = inf.h1(u, d, base, RUG)
    fila = next(f for f in r["sitios"] if f["id"] == "yungay")
    peso = math.cos(math.radians(rejilla.lat_centros()[rejilla.celda_de(y["lat"], y["lon"])[0]]))
    assert fila["s"] == 1.0 and fila["dentro"] is True
    assert fila["fraccion_area_igual_o_mejor"] == pytest.approx(peso / (400 * math.cos(math.radians(0.25)) + peso))
    assert r["k0_sitios"]["yungay"]["dentro"] is True
    celdas.update(_relleno(30, lat=0.75, aridez_ai=0.01))
    d = malla_sintetica(celdas)
    tierra, base = puntos.mascaras(u, d)
    r = inf.h1(u, d, base, RUG)
    fila = next(f for f in r["sitios"] if f["id"] == "yungay")
    assert fila["s"] == 1.0 and fila["dentro"] is False
    assert r["k0_sitios"]["yungay"]["dentro"] is False


def test_h1_meridiani_no_evaluable_y_veredicto(u):
    d = malla_sintetica(_relleno(50))
    tierra, base = puntos.mascaras(u, d)
    r = inf.h1(u, d, base, RUG)
    dv = next(f for f in r["sitios"] if f["id"] == "death_valley_badwater")
    assert dv["dentro"] is None and "meridiani" in dv["motivo"] and dv["cuenta"] is False
    assert r["n_sitios"] == 11
    assert inf.veredicto_h1(u, 8, 6) == "exito"
    assert inf.veredicto_h1(u, 8, 7) == "senal_debil"
    assert inf.veredicto_h1(u, 6, 0) == "senal_debil"
    assert inf.veredicto_h1(u, 5, 0) == "fallo"


def _pares(u, d, n_mc=5):
    tierra, base = puntos.mascaras(u, d)
    pares, fuera = puntos.pares_a_calcular(u)
    ds = {f"{p['objetivo']}_{p['mision']}": puntos.calcula_par(u, "x", p["objetivo"], p["mision"], d, tierra, base, RUG, n_mc, 1)
          for p in pares}
    return ds, fuera, base


def test_h1_s_cuenta_fallada_con_s_cero_y_saca_sin_dato(u):
    y = sitio(u, "yungay")
    celdas = _relleno(100, ndvi_max=0.9)
    celdas[(y["lat"], y["lon"])] = dict(BUENA)
    d = malla_sintetica(celdas)
    ds, fuera, base = _pares(u, d)
    r = inf.h1_s(u, ds, fuera, base)
    fila = next(f for f in r["sitios"] if f["id"] == "yungay")
    assert fila["dentro"] is True and fila["estado"] == "pasa"
    assert fila["fraccion_area_igual_o_mejor"] < 0.05
    dv = next(f for f in r["sitios"] if f["id"] == "death_valley_badwater")
    assert dv["dentro"] is None and dv["motivo"].startswith("par meridiani_P2")
    fr = r["fraccion_pasa_puertas"]["jezero_P2"]
    assert fr["n_base"] == base.sum() and fr["n_fallan"] >= 100
    assert fr["fraccion_celdas"] == pytest.approx(fr["n_pasan"] / fr["n_base"])


def test_h3_signo_y_jaccard(u):
    h = sitio(u, "haughton")
    celdas = _relleno(60, nv_dias_0c=10)
    celdas[(h["lat"], h["lon"])] = {**BUENA, "nv_dias_0c": 200, "ndvi_max": 0.8}
    d = malla_sintetica(celdas)
    ds, _, base = _pares(u, d)
    r = inf.h3(u, ds, base)
    assert len(r["predicciones"]) == 9
    p3 = next(p for p in r["predicciones"] if p["n"] == 3)
    assert p3["acierto"] is True
    assert set(r["jaccard"]) == {"P1_P2", "P1_P4"}
    assert 0.0 <= r["jaccard"]["P1_P2"]["J"] <= 1.0


def test_jaccard_a_mano():
    a = np.array([0.9, 0.8, 0.7, 0.1, np.nan])
    b = np.array([0.1, 0.8, 0.7, 0.9, 0.5])
    j, na, nb = inf.jaccard_top(a, b, 2)
    assert (na, nb) == (2, 2) and j == pytest.approx(1 / 3)


def test_descriptivo_polar_y_controles(u):
    sitios = inf.sitios_ensayo()
    hg = next(s for s in sitios if s["id"] == "haughton")
    celdas = _relleno(40)
    celdas[(hg["lat"], hg["lon"])] = {**BUENA, "f_low": 0.36, "nv_dias_m23c": 117}
    for c in u["validacion"]["controles"]["sitios"]:
        celdas[(c["lat"], c["lon"])] = {**BUENA, "ndvi_max": 0.9, "casquete_frac": 0}
    d = malla_sintetica(celdas)
    ds, _, base = _pares(u, d)
    pol = inf.descriptivo_polar(u, ds, base, sitios)
    assert {f["sitio"] for f in pol["filas"]} == {"haughton", "sp_crater", "mistastin"}
    f = next(f for f in pol["filas"] if f["sitio"] == "haughton" and f["par"] == "shackleton_P3")
    assert f["S"] is not None and 0 <= f["percentil_area"] <= 100
    con = inf.controles(u, ds, base)
    assert con["rotulo"] == u["validacion"]["controles"]["rotulo"]
    assert con["en_top"]["jezero_P2"] == 0


def test_main_sobre_malla_sintetica_apunta_corridas_y_escribe_json_sin_nan(u, tmp_path):
    import json

    from pipeline.malla import salida
    from pipeline.motor.__main__ import corre as corre_motor
    from pipeline.validacion.__main__ import corre

    y = sitio(u, "yungay")
    celdas = _relleno(80, ndvi_max=0.5)
    celdas[(y["lat"], y["lon"])] = dict(BUENA)
    d = malla_sintetica(celdas)
    salida.escribe_malla({k: (v, {"units": "1", "fuente": "mío", "origen": "mío"}) for k, v in d.items()}, 1, tmp_path)
    rug = tmp_path / "rug.json"
    rug.write_text(json.dumps({"objetivos": {k: {"rugosidad_tan": v, "estado": "ok" if v else "sin_dato"} for k, v in RUG.items()}}))
    corre_motor(tmp_path, n_mc=5, rug_ruta=rug)
    r = corre(tmp_path, "prueba 1", "", rug_ruta=rug)
    corre(tmp_path, "prueba 2", "nada", rug_ruta=rug)
    back = json.loads((tmp_path / "informe_validacion.json").read_text())
    assert [c["motivo"] for c in back["corridas"]] == ["prueba 1", "prueba 2"]
    assert back["h1"]["n_sitios"] == 11 and back["h3"]["de"] == 9
    assert r["h1_s"]["sitios"][0]["id"] == "yungay" and r["h1_s"]["sitios"][0]["dentro"] is True
    assert back["umbrales_sha256"] == um.carga()[1]
