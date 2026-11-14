import json
import shutil
from pathlib import Path

import numpy as np
import pytest

from pipeline.clases import __main__ as cl
from pipeline.clases import calculo as ca

RAIZ = Path(__file__).resolve().parents[3]
SALIDA = RAIZ / "web" / "data" / "cuerpos"
HAY_REAL = (SALIDA / cl.FICHERO).exists() and (SALIDA / cl.CAPA).exists()


def _tres_grupos(n=400):
    rng = np.random.default_rng(3)
    centros = np.array([[0, 0, 0, 0], [8, 8, 0, -8], [-8, 8, 8, 0]], float)
    X = np.concatenate([c + rng.normal(size=(n, 4)) for c in centros])
    # Cuarta columna casi copia de la primera: la redundancia no debe crear un grupo nuevo.
    X[:, 3] = X[:, 0] * 2 + rng.normal(scale=0.01, size=len(X))
    return X, np.repeat(np.arange(3), n)


def _calcula_sintetico(X):
    ids, grupos = ["a", "b", "c", "d"], ["g1", "g2", "g3", "g1"]
    return ca, ids, cl.calcula(X, np.ones(len(X)), ids, grupos, ["lineal"] * 4, k_candidatos=(2, 3, 4, 5, 6), n_muestra=900)


def _puntuaciones(pca, X):
    return ca.puntuaciones(X, np.array(pca["media"]), np.array(pca["desviacion"]),
                           np.array(pca["componentes"]), np.array(pca["autovalores"]))


def test_tres_grupos_separados_se_recuperan_con_el_criterio_de_silueta():
    X, verdad = _tres_grupos()
    _, _, (res, e, _) = _calcula_sintetico(X)
    assert res["k"] == 3
    for g in range(3):
        assert len(np.unique(e[verdad == g])) == 1
    assert len({int(e[verdad == g][0]) for g in range(3)}) == 3


def test_cada_celda_sintetica_esta_mas_cerca_de_su_centro_guardado_que_de_cualquier_otro():
    X, _ = _tres_grupos()
    _, _, (res, e, d) = _calcula_sintetico(X)
    S = _puntuaciones(res["pca"], X)
    C = np.array([c["centroide_componentes"] for c in res["clases"]])
    d2 = ((S[:, None, :] - C[None]) ** 2).sum(-1)
    assert np.all(d2[np.arange(len(S)), e] <= d2.min(1))
    np.testing.assert_allclose(d, np.sqrt(d2.min(1)))


def test_calculo_sintetico_repetido_da_lo_mismo():
    X, _ = _tres_grupos()
    a = cl.documento(_calcula_sintetico(X)[2][0], len(X), 1.0, "x")
    b = cl.documento(_calcula_sintetico(X)[2][0], len(X), 1.0, "x")
    assert json.dumps(a) == json.dumps(b)


def test_componentes_retenidas_las_primeras_que_llegan_al_95():
    assert ca.retenidas(np.array([5.0, 3.0, 1.0, 1.0])) == 4
    assert ca.retenidas(np.array([90.0, 5.0, 4.0, 1.0])) == 2
    assert ca.retenidas(np.array([96.0, 3.0, 1.0])) == 1


def test_rotulo_por_regla_un_parametro_por_grupo_muy_y_desempate():
    ids = ["t_max_k", "t_min_k", "precip_mm_ano", "ndvi_max"]
    grupos = ["temperature", "temperature", "water", "biology"]
    z = np.array([
        [-2.0, -1.0, 0.6, 0.1],
        [0.2, 0.1, -0.1, 0.3],    # nada llega a 0,5: un solo rasgo, el mayor
        [-2.0, -1.0, 0.6, -0.4],  # igual que la primera salvo el NDVI (bajo el umbral): se desempata con él
    ])
    assert ca.rotulos(z, ids, grupos) == ["very cool days · wet · green", "green", "very cool days · wet · bare"]


@pytest.mark.skipif(not HAY_REAL, reason="sin clases.json")
def test_salida_real_cubre_todas_las_celdas_completas_y_cada_una_cae_en_su_centro_mas_cercano():
    doc = json.loads((SALIDA / cl.FICHERO).read_text(encoding="utf-8"))
    indice, params, celdas, X, w, frac, huella = cl.entradas(SALIDA)
    assert doc["entrada_sha256"] == huella, "clases.json no corresponde a las capas actuales: python -m pipeline.clases"
    assert indice.get("clases") == cl.FICHERO
    clase = np.fromfile(SALIDA / cl.CAPA, dtype="<f4")
    assert np.array_equal(np.flatnonzero(np.isfinite(clase)), celdas)
    e = clase[celdas].astype(int)
    k = doc["criterio_k"]["k"]
    assert set(np.unique(e)) == set(range(k)) and len(doc["clases"]) == k
    assert sum(c["n_celdas"] for c in doc["clases"]) == len(celdas)
    assert sum(c["pct_area"] for c in doc["clases"]) == pytest.approx(100, abs=1e-3)
    S = _puntuaciones(doc["pca"], X)
    C = np.array([c["centroide_componentes"] for c in doc["clases"]])
    d2 = ((S[:, None, :] - C[None]) ** 2).sum(-1)
    assert np.all(d2[np.arange(len(S)), e] <= d2.min(1))
    assert doc["origen"] == "mío" and "not a prediction" in doc["que_es"]
    assert [t["k"] for t in doc["criterio_k"]["tabla"]] == list(ca.K_CANDIDATOS)
    assert doc["pca"]["varianza_retenida"] >= 0.95


@pytest.mark.skipif(not HAY_REAL, reason="sin clases.json")
def test_regenerar_con_las_mismas_capas_es_determinista_byte_a_byte(tmp_path):
    indice = json.loads((SALIDA / "indice.json").read_text(encoding="utf-8"))
    rutas = {indice["mascara_tierra"], indice["mascara_casquete"],
             *(p["capas"]["earth"] for p in indice["parametros"] if p["reproducible_en_tierra"])}
    for r in ["indice.json", *rutas]:
        (tmp_path / r).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(SALIDA / r, tmp_path / r)
    cl.main([], base=tmp_path)
    for r in ("indice.json", cl.FICHERO, cl.CAPA):
        assert (tmp_path / r).read_bytes() == (SALIDA / r).read_bytes(), r
