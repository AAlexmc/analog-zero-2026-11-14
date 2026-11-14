import json
from pathlib import Path

import numpy as np
import pytest

from pipeline.condiciones import veredicto as vd

DATOS = Path(__file__).resolve().parents[3] / "datos_json"


@pytest.fixture(scope="module")
def equipos():
    return {e["id"]: e for e in json.loads((DATOS / "equipo.json").read_text(encoding="utf-8"))["equipos"]}


@pytest.fixture(scope="module")
def sitios():
    return json.loads((DATOS / "sitios_ensayo.json").read_text(encoding="utf-8"))["sitios"]


def req(equipos, eq, variable, op=None):
    return next(r for r in equipos[eq]["requisitos"] if r["variable"] == variable and (op is None or r["op"] == op))


def test_cada_variable_del_catalogo_va_a_su_sitio(equipos):
    assert vd.tratamiento(req(equipos, "ltv", "horas_en_sombra")) == {"tratamiento": "condicion", "condicion": "oscuridad_max_h", "motivo": None}
    assert vd.tratamiento(req(equipos, "viper", "horas_en_sombra"))["condicion"] == "oscuridad_max_h"
    assert vd.tratamiento(req(equipos, "viper", "temp_k", ">="))["condicion"] == "t_min_alcanzable_k"
    assert vd.tratamiento(req(equipos, "torre_solar", "temp_k", ">="))["condicion"] == "t_min_alcanzable_k"
    hot = vd.tratamiento(req(equipos, "viper", "temp_k", "<="))
    assert hot["tratamiento"] == "no_evaluado" and hot["motivo"]
    for eq, var in [("ltv", "pendiente_deg"), ("ltv", "distancia_recorrido_km"), ("reactor_fision", "separacion_m"),
                    ("pista_aterrizaje", "separacion_m")]:
        assert vd.tratamiento(req(equipos, eq, var))["tratamiento"] == "terreno"
    assert vd.tratamiento({"variable": "radiacion_gy", "op": "<=", "valor": 1})["tratamiento"] == "no_evaluado"


def test_ningun_requisito_del_catalogo_queda_sin_tratamiento(equipos):
    for e in equipos.values():
        for r in e["requisitos"]:
            t = vd.tratamiento(r)
            assert t["tratamiento"] in {"condicion", "terreno", "no_evaluado"}
            assert (t["condicion"] is None) == (t["tratamiento"] != "condicion")


def test_oscuridad_parcial_da_la_fraccion():
    assert vd.veredicto_valor("oscuridad_max_h", 150, 62.0) == {"veredicto": "partial", "fraccion": pytest.approx(62 / 150), "falta": pytest.approx(88.0)}
    assert vd.veredicto_valor("oscuridad_max_h", 150, 150.0)["veredicto"] == "reaches"
    assert vd.veredicto_valor("oscuridad_max_h", 150, float("nan"))["veredicto"] == "no_data"


def test_frio_parcial_da_los_kelvin_que_faltan_y_no_una_fraccion():
    v = vd.veredicto_valor("t_min_alcanzable_k", 40, 186.2)
    assert v["veredicto"] == "partial" and v["fraccion"] is None and v["falta"] == pytest.approx(146.2)
    assert vd.veredicto_valor("t_min_alcanzable_k", 200, 186.2)["veredicto"] == "reaches"


def test_si_ninguna_celda_llega_todas_son_not_reachable():
    v = vd.veredicto_valor("t_min_alcanzable_k", 40, 186.2, alcanzable_en_tierra=False)
    assert v["veredicto"] == "not_reachable"


def test_resumen_pondera_por_area_de_tierra_y_marca_lo_inalcanzable():
    campo = np.array([[10.0, 200.0, 300.0], [np.nan, 160.0, 5.0]])
    tierra = np.array([[True, True, True], [False, True, False]])
    peso = np.array([[1.0, 1.0, 2.0], [1.0, 1.0, 1.0]])
    r = vd.resumen("oscuridad_max_h", 150, campo, tierra, peso)
    assert r["veredicto_global"] == "reaches"
    assert r["n_celdas_alcanza"] == 3 and r["n_celdas_tierra"] == 4
    assert r["pct_tierra"] == pytest.approx(100 * 4 / 5)
    r2 = vd.resumen("t_min_alcanzable_k", 40, campo + 100, tierra, peso)
    assert r2["veredicto_global"] == "not_reachable" and r2["pct_tierra"] == 0.0 and r2["n_celdas_alcanza"] == 0
    assert r["extremo_tierra"] == 300.0 and r2["extremo_tierra"] == 110.0


def test_sin_tierra_con_dato_no_hay_veredicto_global():
    r = vd.resumen("oscuridad_max_h", 150, np.full((1, 2), np.nan), np.ones((1, 2), bool), np.ones((1, 2)))
    assert r["veredicto_global"] == "no_data" and r["pct_tierra"] is None


def test_laboratorios_de_frio_salen_del_catalogo_con_su_cita(sitios):
    labs = vd.laboratorios(sitios, "t_min_alcanzable_k")
    assert [x["id"] for x in labs] == ["glenn_camara_polar"]
    assert "140K" in labs[0]["cita"] and labs[0]["fuente"].startswith("https://ntrs.nasa.gov/")
    assert vd.laboratorios(sitios, "oscuridad_max_h") == []
    assert vd.laboratorios([{"id": "x", "tipo": "campo", "campanas": [{"que_se_probo": "cold 100 K"}]}], "t_min_alcanzable_k") == []


def test_sitios_con_coordenadas_dan_su_celda_y_los_demas_lo_dicen(sitios):
    campo = np.zeros((360, 720))
    campo[330, 180] = 7.0
    tierra = np.zeros((360, 720), bool)
    tierra[330, 180] = True
    sin_coord = {"id": "campo_sin_coordenadas", "nombre": "x", "tipo": "campo", "lat": None, "lon": None}
    out = {s["id"]: s for s in vd.sitios_en([*sitios, sin_coord], {"oscuridad_max_h": campo}, tierra)}
    h = out["haughton"]
    assert (h["fila"], h["col"]) == (29, 180) and h["valores"]["oscuridad_max_h"] == 7.0 and h["tierra"]
    assert out["campo_sin_coordenadas"]["valores"] is None and "coordinates" in out["campo_sin_coordenadas"]["motivo"]
    assert "glenn_slope_lab" not in out
    for s in sitios:
        if s["tipo"] == "campo" and s["lat"] is not None:
            assert out[s["id"]]["valores"] is not None and 0 <= out[s["id"]]["fila"] < 360 and 0 <= out[s["id"]]["col"] < 720
