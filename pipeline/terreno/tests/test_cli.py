import shlex

import pytest

from pipeline.terreno import generar
from pipeline.terreno.__main__ import parser, sitio_de_args


@pytest.mark.parametrize("s", generar.cargar_sitios()["sitios"], ids=lambda s: s["id"])
def test_comando_de_meta_reproduce_el_sitio(s):
    a = shlex.split(generar.comando(s))
    assert a[:3] == ["python", "-m", "pipeline.terreno"]
    assert sitio_de_args(parser().parse_args(a[3:])) == s
