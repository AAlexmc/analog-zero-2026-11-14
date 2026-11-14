import json

import numpy as np

from pipeline.terreno import escritura


def test_capa_f32_little_endian_y_orden_de_filas(tmp_path):
    n = 4
    a = np.arange(n * n, dtype=np.float32).reshape(n, n)
    a[1, 2] = np.nan
    escritura.escribir_capa(tmp_path / "altura.f32", a)
    b = np.fromfile(tmp_path / "altura.f32", dtype="<f4")
    assert b.size == n * n and (tmp_path / "altura.f32").stat().st_size == n * n * 4
    assert b[0] == a[0, 0] and b[n - 1] == a[0, n - 1] and b[n] == a[1, 0]
    assert np.isnan(b[1 * n + 2])
    assert not list(tmp_path.glob("*.tmp"))


def test_capa_u8(tmp_path):
    a = np.array([[0, 1], [255, 1]], np.uint8)
    escritura.escribir_capa(tmp_path / "s.u8", a)
    assert (tmp_path / "s.u8").read_bytes() == bytes([0, 1, 255, 1])


def test_meta_calcula_z_sin_nan(tmp_path):
    a = np.array([[np.nan, -3.5], [2.0, 10.25]], np.float32)
    z_min, z_max = escritura.rango(a)
    assert (z_min, z_max) == (-3.5, 10.25)
    escritura.escribir_json(tmp_path / "meta.json", {"z_min": z_min, "z_max": z_max})
    assert json.loads((tmp_path / "meta.json").read_text()) == {"z_min": -3.5, "z_max": 10.25}


def test_index_conserva_otros_y_reemplaza_el_mismo(tmp_path):
    escritura.actualizar_index(tmp_path, {"id": "a", "lado_km": 40.0}, {"tierra": "b", "luna": "a"})
    escritura.actualizar_index(tmp_path, {"id": "b", "lado_km": 40.0}, {"tierra": "b", "luna": "a"})
    escritura.actualizar_index(tmp_path, {"id": "a", "lado_km": 41.0}, {"tierra": "b", "luna": "a"})
    d = json.loads((tmp_path / "index.json").read_text())
    assert [t["id"] for t in d["terrenos"]] == ["a", "b"]
    assert d["terrenos"][0]["lado_km"] == 41.0
    assert d["pareja_inicial"] == {"tierra": "b", "luna": "a"}
