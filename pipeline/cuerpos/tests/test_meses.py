import json
from pathlib import Path

import numpy as np
import pytest

from pipeline.cuerpos import __main__ as cu
from pipeline.cuerpos import meses as me

RAIZ = Path(__file__).resolve().parents[3]
SALIDA = RAIZ / "web" / "data" / "cuerpos"
INDICE = SALIDA / "indice.json"
IDS = ["t_max_k", "t_min_k", "t_media_k", "insolacion_kwh_m2_dia", "precip_mm_ano",
       "viento_medio_m_s", "amplitud_diurna_k"]


def test_los_parametros_con_mes_son_los_pedidos():
    assert me.IDS == IDS


def test_cuantizar_y_volver_cabe_en_int16_con_error_de_media_escala_y_sin_dato_reservado():
    rng = np.random.default_rng(0)
    a = rng.uniform(-40.0, 3000.0, (12, 360, 720)).astype(np.float32)
    a[3, 10, 10] = np.nan
    a[0, 0, 0], a[0, 0, 1] = -40.0, 3000.0
    q, escala, desp = me.cuantiza(a)
    assert q.dtype == np.int16 and q.shape == (12, 360, 720)
    assert q[3, 10, 10] == me.SIN_DATO and (q[np.isfinite(a)] > me.SIN_DATO).all()
    v = me.decodifica(q, escala, desp)
    assert np.isnan(v[3, 10, 10])
    ok = np.isfinite(a)
    assert np.max(np.abs(v[ok] - a[ok])) <= escala / 2 + 1e-9
    assert escala <= 3040.0 / 65534 * 1.01


def test_el_cero_vuelve_exacto_cuando_es_el_minimo():
    a = np.zeros((12, 360, 720), np.float32)
    a[5, 1, 1] = 17000.0
    q, escala, desp = me.cuantiza(a)
    v = me.decodifica(q, escala, desp)
    assert v[0, 0, 0] == 0.0 and v.min() == 0.0


def test_ficha_meses_apunta_al_fichero_con_escala_fuente_y_aviso():
    f = me.ficha("precip_mm_ano", 0.27, 8847.0)
    assert f["earth"] == "earth/mes/precip_mm_ano.i16"
    assert (f["escala"], f["desplazamiento"], f["sin_dato"]) == (0.27, 8847.0, -32768)
    assert f["fuente"]["url"].startswith("https://") and f["fuente"]["texto"]
    assert "365" in f["fuente"]["texto"] and "mm/year" in f["aviso"]
    for pid in IDS:
        g = me.ficha(pid, 1.0, 0.0)
        assert g["fuente"]["url"].startswith("https://") and g["aviso"], pid


def test_anade_escribe_12_meses_y_solo_pone_meses_en_las_fichas(tmp_path):
    rng = np.random.default_rng(1)
    capas = {pid: rng.uniform(1, 5, (13, 360, 720)).astype(np.float32) for pid in IDS}
    idx = {"parametros": [{"id": "t_max_k", "x": 1}, {"id": "gravedad_m_s2"}],
           "parametros_tierra": [{"id": "viento_medio_m_s"}, {"id": "elev_m"}]}
    me.anade(idx, capas, tmp_path)
    assert list(idx["parametros"][0]) == ["id", "x", "meses"] and "meses" not in idx["parametros"][1]
    assert "meses" in idx["parametros_tierra"][0] and "meses" not in idx["parametros_tierra"][1]
    m = idx["parametros"][0]["meses"]
    q = np.fromfile(tmp_path / m["earth"], dtype="<i2")
    assert q.size == 12 * 360 * 720
    v = me.decodifica(q.reshape(12, 360, 720), m["escala"], m["desplazamiento"])
    assert np.max(np.abs(v - capas["t_max_k"][:12])) <= m["escala"] / 2 + 1e-9
    assert sorted(p.name for p in (tmp_path / "earth/mes").iterdir()) == ["t_max_k.i16", "viento_medio_m_s.i16"]


@pytest.fixture(scope="module")
def indice():
    if not INDICE.exists():
        pytest.skip("sin web/data/cuerpos/indice.json")
    return json.loads(INDICE.read_text(encoding="utf-8"))


def test_indice_lleva_meses_en_los_ocho_y_solo_en_ellos(indice):
    con = [p["id"] for p in indice["parametros"] + indice["parametros_tierra"] if "meses" in p]
    if not con:
        pytest.skip("índice sin capas mensuales")
    assert sorted(con) == sorted(IDS)
    for p in indice["parametros"] + indice["parametros_tierra"]:
        if "meses" in p:
            assert (SALIDA / p["meses"]["earth"]).stat().st_size == 12 * 360 * 720 * 2


@pytest.fixture(scope="module")
def reales():
    if not (cu.BUILD / "malla_actual.txt").exists() or not me.fuentes_completas():
        pytest.skip("sin malla o sin fuentes mensuales")
    t = cu.malla_tierra()
    return t, me.capas(t)


def _anual(pid):
    return np.fromfile(SALIDA / f"earth/{pid}.f32", dtype="<f4").reshape(360, 720)


def test_el_mes_13_reproduce_la_capa_anual_publicada(reales):
    _, c = reales
    for pid in IDS:
        a, b = c[pid][12], _anual(pid)
        assert np.array_equal(np.isnan(a), np.isnan(b)), pid
        ok = np.isfinite(b)
        if pid == "precip_mm_ano":
            # La anual publicada es Σ meses × días; el «mes 13» es la media anual de POWER × 365. POWER redondea a 0,01 mm/día
            # y su media anual cuenta el 29 de febrero: en los nodos de la fuente difieren hasta 5,45 mm/año.
            assert np.max(np.abs(a[ok] - b[ok])) < 6.0
        else:
            np.testing.assert_array_equal(a, b, err_msg=pid)


def test_la_lluvia_anual_es_la_media_de_los_12_meses_pesada_por_dias(reales):
    _, c = reales
    from pipeline.malla import clima
    p = np.tensordot(clima.DIAS_MES / 365.0, c["precip_mm_ano"][:12].astype(np.float64), axes=1)
    b = _anual("precip_mm_ano")
    ok = np.isfinite(b)
    assert np.max(np.abs(p[ok] - b[ok]) / np.maximum(b[ok], 1.0)) < 1e-5


def test_los_ficheros_publicados_decodifican_a_las_capas_calculadas(reales, indice):
    _, c = reales
    fichas = {p["id"]: p for p in indice["parametros"] + indice["parametros_tierra"] if "meses" in p}
    if not fichas:
        pytest.skip("índice sin capas mensuales")
    for pid in IDS:
        m = fichas[pid]["meses"]
        v = me.decodifica(np.fromfile(SALIDA / m["earth"], dtype="<i2").reshape(12, 360, 720), m["escala"], m["desplazamiento"])
        a = c[pid][:12]
        assert np.array_equal(np.isnan(v), np.isnan(a)), pid
        ok = np.isfinite(a)
        assert np.max(np.abs(v[ok] - a[ok])) <= m["escala"] / 2 * 1.0001, pid
