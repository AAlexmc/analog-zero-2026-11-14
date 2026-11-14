import json
from pathlib import Path

import pytest

RUTA = Path(__file__).resolve().parents[3] / "umbrales.json"
PARES = {("jezero", "P2"), ("jezero", "P4"), ("arcadia", "P1"), ("shackleton", "P3")}


@pytest.fixture(scope="module")
def u():
    return json.loads(RUTA.read_text(encoding="utf-8"))


def test_abre_y_tiene_bloques(u):
    for clave in ("version", "fuentes_de_diseno", "variables", "dimensiones",
                  "misiones", "objetivos", "pares", "par_inicial", "validacion",
                  "monte_carlo", "comprobaciones", "energia", "pieza_ensayable_aqui"):
        assert clave in u, clave


def test_pesos_de_cada_mision_suman_uno(u):
    for nombre, m in u["misiones"].items():
        assert abs(sum(m["pesos"].values()) - 1) <= 0.002, nombre


def test_dimensiones_de_los_pesos_existen(u):
    dims = set(u["dimensiones"])
    assert "D7" not in dims
    for nombre, m in u["misiones"].items():
        assert set(m["pesos"]) <= dims, nombre
        assert m["orden"] == list(m["pesos"]), nombre


def test_variables_de_dimensiones_y_puertas_estan_en_el_diccionario(u):
    nombres = set(u["variables"])
    for d, dim in u["dimensiones"].items():
        for v in dim["variables"]:
            assert v in nombres or v == "R", (d, v)
    for nombre, m in u["misiones"].items():
        for p in m["puertas"]:
            assert p["variable"] in nombres, (nombre, p["id"])


def test_sitios_de_validacion_apuntan_a_objetivo_y_mision(u):
    sitios = u["validacion"]["sitios"]
    assert len(sitios) == 11
    assert "dhofar" not in {s["id"] for s in sitios}
    for s in sitios:
        assert s["objetivo"] in u["objetivos"], s["id"]
        assert s["mision"] in u["misiones"], s["id"]
        assert s["dim"] in u["dimensiones"], s["id"]
        assert -90 <= s["lat"] <= 90 and -180 <= s["lon"] <= 180, s["id"]


def test_los_cuatro_pares_prerregistrados_existen_y_los_nuevos_van_marcados(u):
    pares = {(p["objetivo"], p["mision"]) for p in u["pares"]}
    prerregistrados = {(p["objetivo"], p["mision"]) for p in u["pares"] if p.get("prerregistrado", True)}
    assert prerregistrados == PARES
    for o, m in pares - PARES:
        assert u["misiones"][m]["prerregistrada"] is False
    for o, m in pares:
        assert o in u["objetivos"] and m in u["misiones"]
    assert (u["par_inicial"]["objetivo"], u["par_inicial"]["mision"]) == ("shackleton", "P3")


def test_predicciones_h3_apuntan_a_sitios_y_misiones(u):
    ids = {s["id"] for s in u["validacion"]["sitios"]}
    pred = u["validacion"]["h3"]["predicciones"]
    assert len(pred) == 9
    for p in pred:
        assert p["sitio"] in ids
        assert p["sube_en"] in u["misiones"] and p["baja_en"] in u["misiones"]


def test_objetivos_por_defecto_existen(u):
    for nombre, m in u["misiones"].items():
        assert m["objetivo_por_defecto"] in u["objetivos"], nombre
