import json
import math
from pathlib import Path

import numpy as np
import pytest

from pipeline.cuerpos import __main__ as cu

RAIZ = Path(__file__).resolve().parents[3]
SALIDA = RAIZ / "web" / "data" / "cuerpos"
INDICE = SALIDA / "indice.json"


def test_rango_ref_une_percentiles_de_tierra_firme_y_de_cada_cuerpo():
    tierra = np.zeros((360, 720), np.float32)
    tierra[100:200] = 1.0
    t = np.full((360, 720), 5.0, np.float32)
    t[:100] = 1000.0
    luna = np.full((360, 720), 2.0, np.float32)
    r = cu.rango_ref({"earth": t, "moon": luna, "mars": 7.0}, tierra)
    assert (r["min"], r["max"]) == (2.0, 7.0)
    assert r["por_cuerpo"]["earth"] == [5.0, 5.0] and r["por_cuerpo"]["mars"] == [7.0, 7.0]
    assert r["origen"] == "mío"


def test_parametro_con_constante_por_cuerpo_y_sin_dato():
    tierra = np.ones((360, 720), np.float32)
    p = cu.parametro("x", "X", "g", "u", {"earth": np.ones((360, 720)), "moon": 0.0, "mars": None},
                     {c: {"texto": "t", "url": None} for c in cu.CUERPOS}, "d", "lineal", True, None, tierra, escribir=False)
    assert p["capas"] == {"earth": "earth/x.f32", "moon": None, "mars": None}
    assert p["constante"] == {"earth": None, "moon": 0.0, "mars": None}


def test_log10_exige_minimo_positivo():
    tierra = np.ones((360, 720), np.float32)
    with pytest.raises(AssertionError):
        cu.parametro("x", "X", "g", "u", {"earth": np.zeros((360, 720)), "moon": 1.0, "mars": 2.0},
                     {c: {} for c in cu.CUERPOS}, "d", "log10", True, None, tierra, escribir=False)


@pytest.fixture(scope="module")
def indice():
    if not INDICE.exists():
        pytest.skip("sin web/data/cuerpos/indice.json")
    return json.loads(INDICE.read_text(encoding="utf-8"))


def _lee(ruta):
    return np.fromfile(SALIDA / ruta, dtype="<f4").reshape(360, 720)


def test_indice_cada_parametro_tiene_valor_y_fuente_en_los_tres_cuerpos(indice):
    assert indice["rejilla"] == {**indice["rejilla"], "ancho": 720, "alto": 360, "paso_deg": 0.5, "lat0": 89.75, "lon0": -179.75, "fila0": "norte"}
    for p in indice["parametros"]:
        for c in ("earth", "moon", "mars"):
            capa = (p["capas"] or {}).get(c)
            const = (p["constante"] or {}).get(c)
            assert (capa is None) != (const is None), (p["id"], c)
            assert p["fuentes"][c]["texto"], (p["id"], c)
            if capa:
                assert (SALIDA / capa).stat().st_size == 720 * 360 * 4
        r = p["rango_ref"]
        assert r["origen"] == "mío" and r["min"] < r["max"]
        assert p["transformacion"] in ("lineal", "log10", "log1p")
        if p["transformacion"] == "log10":
            assert r["min"] > 0


def test_fila_cero_es_el_norte_en_la_tierra(indice):
    t = _lee(indice["mascara_tierra"])
    # Fila 0 = 89,75° N: océano Ártico; fila 359 = Antártida (GMTED 30″ la cubre).
    assert t[0].max() == 0.0 and t[359].min() == 1.0
    # Celda de Madrid (40,4 N, −3,7): tierra.
    assert t[int((90 - 40.4) / 0.5), int((-3.7 + 180) / 0.5)] == 1.0


def test_insolacion_de_luna_y_marte_solo_depende_de_la_latitud_y_es_simetrica(indice):
    for c in ("moon", "mars"):
        a = _lee(f"{c}/insolacion_kwh_m2_dia.f32")
        assert np.all(a == a[:, :1])
        np.testing.assert_allclose(a[:, 0], a[::-1, 0], rtol=1e-6)
    assert _lee("moon/insolacion_kwh_m2_dia.f32")[180, 0] == pytest.approx(1361.0 / math.pi * 0.024, rel=1e-3)


def test_luna_y_marte_no_tienen_huecos_en_terreno(indice):
    for c in ("moon", "mars"):
        for p in ("rugosidad_tan", "relieve_m"):
            assert np.isfinite(_lee(f"{c}/{p}.f32")).all()


def test_cifras_citadas_coinciden_con_el_catalogo(indice):
    cat = {x["id"]: x for x in json.loads((RAIZ / "datos_json/cuerpos.json").read_text(encoding="utf-8"))["constantes"]}
    p = {x["id"]: x for x in indice["parametros"]}
    assert p["gravedad_m_s2"]["constante"] == {c: cat[f"gravedad_{c}"]["valor"] for c in ("earth", "moon", "mars")}
    assert p["presion_superficie_pa"]["constante"]["moon"] == pytest.approx(3e-10)
    pm = p["presion_superficie_pa"]["capas"]["mars"] if p["presion_superficie_pa"]["capas"] else None
    if pm:
        # Media de OpenMARS frente a la ficha (6,36 mb a radio medio, 4,0-8,7 según estación).
        assert 400 < _media_area(_lee(pm)) < 870
    else:
        assert p["presion_superficie_pa"]["constante"]["mars"] == pytest.approx(636.0)
    for c in ("earth", "moon", "mars"):
        assert p["gravedad_m_s2"]["fuentes"][c]["cita"] in cat[f"gravedad_{c}"]["cita"]


def test_sin_fechas_en_el_indice():
    texto = INDICE.read_text(encoding="utf-8") if INDICE.exists() else ""
    import re
    assert not re.search(r"20[0-9]{2}-[01][0-9]-", texto)


@pytest.mark.skipif(not (cu.BUILD / "malla_actual.txt").exists() or not cu.CACHE.exists(), reason="sin malla ni caché DEM")
def test_regenerar_es_determinista_byte_a_byte(tmp_path, monkeypatch):
    monkeypatch.setattr(cu, "SALIDA", tmp_path / "a")
    cu.main([])
    a = {p.relative_to(tmp_path / "a").as_posix(): p.read_bytes() for p in sorted((tmp_path / "a").rglob("*")) if p.is_file()}
    monkeypatch.setattr(cu, "SALIDA", tmp_path / "b")
    cu.main([])
    b = {p.relative_to(tmp_path / "b").as_posix(): p.read_bytes() for p in sorted((tmp_path / "b").rglob("*")) if p.is_file()}
    assert a == b and len(a) > 10
    if INDICE.exists():
        assert a["indice.json"] == INDICE.read_bytes()


def _media_area(a):
    w = np.repeat(np.cos(np.radians(89.75 - 0.5 * np.arange(360)))[:, None], 720, axis=1)
    ok = np.isfinite(a)
    return float(np.sum(a[ok] * w[ok]) / np.sum(w[ok]))


def test_temperaturas_plausibles_frente_a_las_fichas_de_la_nasa(indice):
    ids = {p["id"] for p in indice["parametros"]}
    if not {"t_max_k", "t_min_k", "t_media_k"} <= ids:
        pytest.skip("temperatura no incluida")
    cat = {x["id"]: x for x in json.loads((RAIZ / "datos_json/cuerpos.json").read_text(encoding="utf-8"))["constantes"]}
    eq = slice(178, 182)
    luna_max, luna_min = _lee("moon/t_max_k.f32")[eq], _lee("moon/t_min_k.f32")[eq]
    assert abs(np.nanmedian(luna_max) - cat["temperatura_ecuador_moon"]["valor"]) < 10
    assert abs(np.nanmedian(luna_min) - cat["temperatura_ecuador_moon"]["valor_min"]) < 10
    assert abs(_media_area(_lee("mars/t_media_k.f32")) - cat["temperatura_media_mars"]["valor"]) < 15
    for c in ("earth", "moon", "mars"):
        mx, mn, me = (_lee(f"{c}/{p}.f32") for p in ("t_max_k", "t_min_k", "t_media_k"))
        ok = np.isfinite(me)
        assert np.all(mn[ok] <= me[ok]) and np.all(me[ok] <= mx[ok])
        assert np.nanmin(mn) > 0 and np.nanmax(mx) < 500
