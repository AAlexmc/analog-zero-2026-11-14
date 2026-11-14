import json
from pathlib import Path

import pytest

from pipeline.paises import __main__ as pa

RAIZ = Path(__file__).resolve().parents[3]


def _f(nombre, tipo, coords):
    return {"type": "Feature", "properties": {"ADMIN": nombre, "NAME": "x"}, "geometry": {"type": tipo, "coordinates": coords}}


def test_reducir_redondea_quita_repetidos_y_conserva_huecos():
    exterior = [[0.001, 0.0], [10.004, 0.0], [10.0, 10.0], [10.001, 10.002], [0.0, 10.0], [0.001, 0.0]]
    hueco = [[4.0, 4.0], [6.0, 4.0], [6.0, 6.0], [4.0, 4.0]]
    gj = {"features": [_f("B", "Polygon", [exterior, hueco]), _f("A", "MultiPolygon", [[[[20, 0], [21, 0], [21, 1], [20, 0]]], [[[30, 5], [31, 5], [31, 6], [30, 5]]]])]}
    out = pa.reducir(gj)
    assert [p["nombre"] for p in out] == ["A", "B"]
    b = out[1]
    assert b["poligonos"][0][0] == [[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0], [0.0, 0.0]]
    assert len(b["poligonos"][0]) == 2
    assert b["caja"] == [0.0, 0.0, 10.0, 10.0]
    assert out[0]["caja"] == [20, 0, 31, 6] and len(out[0]["poligonos"]) == 2


def test_anillo_degenerado_se_descarta():
    assert pa.anillo([[0.001, 0.001], [0.002, 0.002], [0.003, 0.001], [0.001, 0.001]]) is None


@pytest.mark.skipif(not pa.ENTRADA.exists(), reason="sin el geojson de Natural Earth en raw/")
def test_regenerar_da_el_fichero_de_la_web():
    doc = pa.documento()
    web = json.loads((RAIZ / "web" / "data" / "paises_110m.json").read_text(encoding="utf-8"))
    assert doc == web
