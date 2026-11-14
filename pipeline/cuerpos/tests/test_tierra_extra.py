import json
from pathlib import Path

import numpy as np
import pytest

from pipeline.cuerpos import __main__ as cu
from pipeline.cuerpos import tierra_extra as te

RAIZ = Path(__file__).resolve().parents[3]
SALIDA = RAIZ / "web" / "data" / "cuerpos"
INDICE = SALIDA / "indice.json"
IDS = ["aridez_ai", "viento_medio_m_s", "viento_p95_m_s", "amplitud_diurna_k", "permafrost_frac", "elev_m",
       "tiempo_ciudad_h", "litologia_glim"]


def _malla_sintetica():
    tierra = np.zeros((360, 720), np.float32)
    tierra[100:200] = 1.0
    t = {v["id"]: np.where(tierra > 0, 2.0, np.nan).astype(np.float32) for v in te.VARIABLES}
    t["tierra_frac"] = tierra
    t["aridez_ai_estado"] = np.where(tierra > 0, 0.0, np.nan).astype(np.float32)
    t["litologia_glim"] = np.where(tierra > 0, 8.0, np.nan).astype(np.float32)
    return t


def test_las_variables_exportadas_son_las_pedidas_y_cada_una_tiene_url():
    assert [v["id"] for v in te.VARIABLES] == IDS
    for v in te.VARIABLES:
        assert v["fuente"]["url"].startswith("https://"), v["id"]
        assert v["transformacion"] in ("lineal", "log10", "log1p", "categoria")


def test_aridez_sin_dato_donde_el_estado_no_es_ok():
    t = _malla_sintetica()
    t["aridez_ai_estado"][150, 10] = 1.0
    t["aridez_ai"][150, 10] = 0.5
    a = te.capa(t, "aridez_ai")
    assert np.isnan(a[150, 10]) and a[150, 11] == 2.0
    assert t["aridez_ai"][150, 10] == 0.5


def test_rango_ref_es_p1_p99_de_la_tierra_firme_por_area_solo_tierra():
    tierra = np.zeros((360, 720), np.float32)
    tierra[100:200] = 1.0
    tierra[200:210] = 0.3
    a = np.full((360, 720), 5.0, np.float32)
    a[200:210] = 1000.0
    a[:100] = -7.0
    r = te.rango(a, tierra)
    assert (r["min"], r["max"]) == (5.0, 5.0)
    assert r["origen"] == "mío" and r["regla"] and r["por_cuerpo"] == {"earth": [5.0, 5.0]}


def test_fichas_con_los_campos_de_parametros_y_litologia_categorica(tmp_path):
    t = _malla_sintetica()
    fs = te.fichas(t, tmp_path)
    assert [f["id"] for f in fs] == IDS
    for f in fs:
        assert f["solo_tierra"] is True
        assert f["capas"] == {"earth": f"earth/{f['id']}.f32"}
        assert set(f["fuentes"]) == {"earth"} and f["fuentes"]["earth"]["url"].startswith("https://")
        for k in ("nombre", "grupo", "unidad", "definicion", "transformacion", "aviso"):
            assert k in f, (f["id"], k)
        b = np.fromfile(tmp_path / f["capas"]["earth"], dtype="<f4").reshape(360, 720)
        np.testing.assert_array_equal(b, te.capa(t, f["id"]))
    lito = fs[-1]
    assert lito["transformacion"] == "categoria" and lito["rango_ref"] is None
    assert lito["clases"]["8"] == "metamorphic" and "15" not in lito["clases"]
    for f in fs[:-1]:
        assert f["rango_ref"]["min"] <= f["rango_ref"]["max"]


def test_log10_exige_minimo_positivo():
    t = _malla_sintetica()
    t["tiempo_ciudad_h"][100:200] = 0.0
    with pytest.raises(AssertionError):
        te.fichas(t, None, escribir=False)


@pytest.fixture(scope="module")
def indice():
    if not INDICE.exists():
        pytest.skip("sin web/data/cuerpos/indice.json")
    return json.loads(INDICE.read_text(encoding="utf-8"))


def test_indice_lleva_parametros_tierra_aparte_y_sus_capas(indice):
    ids = [p["id"] for p in indice["parametros_tierra"]]
    assert ids == IDS
    assert not set(ids) & {p["id"] for p in indice["parametros"]}
    for p in indice["parametros_tierra"]:
        assert (SALIDA / p["capas"]["earth"]).stat().st_size == 720 * 360 * 4


@pytest.mark.skipif(not (cu.BUILD / "malla_actual.txt").exists(), reason="sin malla")
def test_misma_orientacion_que_las_capas_existentes_y_capas_al_dia(tmp_path):
    t = cu.malla_tierra()
    for vid in ("precip_mm_ano", "rugosidad_tan"):
        a = te.capa(t, vid)
        cu.escribe_f32(tmp_path / f"{vid}.f32", a)
        assert (tmp_path / f"{vid}.f32").read_bytes() == (SALIDA / f"earth/{vid}.f32").read_bytes()
    if INDICE.exists():
        for v in te.VARIABLES:
            b = np.fromfile(SALIDA / f"earth/{v['id']}.f32", dtype="<f4").reshape(360, 720)
            np.testing.assert_array_equal(b, te.capa(t, v["id"]))
