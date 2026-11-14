import math

import numpy as np

from pipeline.validacion_sombras import metricas


def test_borde_de_30_km_deja_solo_las_celdas_a_mas_de_3_celdas_del_borde():
    k = metricas.mascara_borde(10, 1000.0, 3000.0)
    assert k.sum() == 16
    assert k[3, 3] and k[6, 6] and not k[2, 5] and not k[5, 7]


def test_borde_mayor_que_medio_lado_no_deja_nada():
    assert metricas.mascara_borde(10, 1000.0, 5000.0).sum() == 0


def test_metricas_continuas_calculadas_a_mano():
    # Pearson 5.5/sqrt(5·8.75), Spearman 1 − 6·2/60, MAE 3/4, sesgo −1/4; NaN y celdas fuera de máscara no cuentan.
    mod = np.array([1, 2, 3, 4, np.nan, 9], dtype=np.float32)
    ofi = np.array([1, 3, 2, 5, 1, 0], dtype=np.float32)
    dentro = np.array([True, True, True, True, True, False])
    r = metricas.continuas(mod, ofi, dentro)
    assert r["celdas"] == 4
    assert math.isclose(r["pearson"], 5.5 / math.sqrt(43.75), rel_tol=1e-6)
    assert math.isclose(r["spearman"], 0.8, rel_tol=1e-6)
    assert math.isclose(r["error_abs_medio"], 0.75, rel_tol=1e-6)
    assert math.isclose(r["sesgo_medio"], -0.25, rel_tol=1e-6)


def test_metricas_continuas_sin_celdas_es_nan():
    r = metricas.continuas(np.array([np.nan]), np.array([1.0]), np.array([True]))
    assert r["celdas"] == 0 and math.isnan(r["pearson"]) and math.isnan(r["error_abs_medio"])


def test_mascaras_binarias_a_mano_y_255_fuera():
    pred = np.array([1, 1, 0, 0, 1, 1], dtype=bool)
    ref = np.array([1, 0, 1, 0, 1, 255], dtype=np.uint8)
    r = metricas.binarias(pred, ref, np.ones(6, bool))
    assert (r["celdas"], r["modelo"], r["oficial"], r["ambas"]) == (5, 3, 3, 2)
    assert math.isclose(r["precision"], 2 / 3)
    assert math.isclose(r["exhaustividad"], 2 / 3)
    assert math.isclose(r["iou"], 0.5)


def test_mascara_binaria_vacia_da_precision_nan():
    r = metricas.binarias(np.zeros(3, bool), np.array([1, 0, 1], np.uint8), np.ones(3, bool))
    assert math.isnan(r["precision"]) and r["exhaustividad"] == 0.0


def test_huella_de_un_recorte_pequeno_dentro_del_grande():
    grande = {"n": 10, "m_por_px": 100.0, "georef": {"x0_m": -450.0, "y0_m": 450.0}}
    pequeno = {"n": 4, "m_por_px": 50.0, "georef": {"x0_m": -75.0, "y0_m": 75.0}}
    k = metricas.huella(grande, pequeno)
    assert k.sum() == 4 and k[4:6, 4:6].all()


def test_nan_a_null_para_json():
    assert metricas.sin_nan({"a": float("nan"), "b": [1.0, np.float32("nan")], "c": np.float64(2)}) == {"a": None, "b": [1.0, None], "c": 2.0}
