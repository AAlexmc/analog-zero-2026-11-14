import json

import pytest

from pipeline.exportar import copiar


def test_copia_cada_json_tal_cual(tmp_path):
    origen, destino = tmp_path / "datos_json", tmp_path / "web" / "data"
    origen.mkdir()
    (origen / "equipo.json").write_text('{"equipos": [{"id": "ltv", "nombre": "Ñandú · 20°"}]}\n', encoding="utf-8")
    (origen / "sitios_ensayo.json").write_text('{"sitios": []}', encoding="utf-8")
    (origen / "notas.txt").write_text("no json")
    escritos = copiar.exportar(origen, destino)
    assert sorted(p.name for p in escritos) == ["equipo.json", "sitios_ensayo.json"]
    assert (destino / "equipo.json").read_bytes() == (origen / "equipo.json").read_bytes()
    assert not (destino / "notas.txt").exists()
    assert not list(destino.glob("*.tmp"))


def test_json_roto_no_escribe_nada(tmp_path):
    origen, destino = tmp_path / "o", tmp_path / "d"
    origen.mkdir()
    destino.mkdir()
    (destino / "a.json").write_text('{"viejo": 1}')
    (origen / "a.json").write_text('{"nuevo": 2}')
    (origen / "b.json").write_text('{"roto": ')
    with pytest.raises(ValueError, match="b.json"):
        copiar.exportar(origen, destino)
    assert json.loads((destino / "a.json").read_text()) == {"viejo": 1}
    assert not (destino / "b.json").exists()


def test_no_toca_la_carpeta_de_terreno(tmp_path):
    origen, destino = tmp_path / "o", tmp_path / "d"
    origen.mkdir()
    (destino / "terreno").mkdir(parents=True)
    (destino / "terreno" / "index.json").write_text('{"terrenos": []}')
    (origen / "equipo.json").write_text('{"equipos": []}')
    copiar.exportar(origen, destino)
    assert (destino / "terreno" / "index.json").read_text() == '{"terrenos": []}'


def test_sin_origen_falla_con_mensaje(tmp_path):
    with pytest.raises(FileNotFoundError):
        copiar.exportar(tmp_path / "no_existe", tmp_path / "d")
