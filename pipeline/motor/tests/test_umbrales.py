import hashlib
import json

import pytest

from pipeline.motor import umbrales as um


def test_carga_el_congelado_y_devuelve_su_hash():
    u, h = um.carga()
    assert h == um.RUTA_HASH.read_text().split()[0]
    assert u["agregacion"]["suelo_similitud"] == 0.05


def test_se_niega_si_el_hash_no_coincide(tmp_path):
    texto = um.RUTA.read_bytes()
    (tmp_path / "umbrales.json").write_bytes(texto.replace(b'"suelo_similitud": 0.05', b'"suelo_similitud": 0.06'))
    (tmp_path / "umbrales.sha256").write_text(hashlib.sha256(texto).hexdigest() + "  umbrales.json\n")
    with pytest.raises(um.HashNoCoincide):
        um.carga(tmp_path / "umbrales.json", tmp_path / "umbrales.sha256")


def test_rugosidad_de_objetivos_con_sin_dato(tmp_path):
    p = tmp_path / "r.json"
    p.write_text(json.dumps({"objetivos": {"jezero": {"rugosidad_tan": 0.0012, "estado": "ok"},
                                           "meridiani": {"estado": "sin_dato"}}}))
    assert um.rugosidad_objetivos(p) == {"jezero": 0.0012, "meridiani": None}
