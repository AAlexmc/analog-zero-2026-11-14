"""Clases de entorno de la Tierra (aprendizaje no supervisado) → web/data/cuerpos/clases.json y earth/clase.f32.

Lee las capas de la Tierra que ya escribió `python -m pipeline.cuerpos`. Uso: python -m pipeline.clases
"""
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

from pipeline.clases import calculo as ca
from pipeline.malla.salida import _atomico

RAIZ = Path(__file__).resolve().parents[2]
SALIDA = RAIZ / "web" / "data" / "cuerpos"
ANCHO, ALTO, PASO = 720, 360, 0.5
CAPA = "earth/clase.f32"
FICHERO = "clases.json"

REGLA_CELDAS = ("Earth land cells with land fraction ≥ 0.5, not ice cap (GLiM class 16), with data for every parameter; "
                "values transformed with each parameter's transformacion and standardized with the area-weighted mean and "
                "standard deviation of those cells (weight = cos latitude)")
REGLA_ESPACIO = ("Whitened principal components: score_j = (z · component_j) / √eigenvalue_j, keeping the first components "
                 f"that explain ≥ {ca.VARIANZA_MIN:.0%} of the variance. Each independent direction of variation on Earth "
                 "counts once, so three strongly correlated temperatures do not weigh three times; the dropped components "
                 "(the last few % of variance) are left out so that whitening does not blow up noise.")
REGLA_K = (f"Chosen before looking at any map: for each k in {ca.K_CANDIDATOS[0]}…{ca.K_CANDIDATOS[-1]}, area-weighted "
           f"k-means (k-means++ start, {ca.N_INICIOS} starts with seed {ca.SEMILLA}, lowest inertia kept); k = the one with "
           f"the highest mean silhouette over a fixed sample of {ca.N_MUESTRA} cells drawn with probability ∝ area "
           f"(seed {ca.SEMILLA + 1}); a tie goes to the smaller k.")
REGLA_DREF = (f"99th percentile of the distance between all pairs of the same fixed sample of {ca.N_MUESTRA} cells, "
              "in the whitened component space")
REGLA_RESIDUO = ("Residual = length of the part of the standardized vector z that the kept components do not describe, "
                 "√(|z|² − Σ (z · component_j)²); residuo_z_p99 = its area-weighted 99th percentile over the Earth cells. "
                 "A target with a larger residual differs from Earth in a way the kept components cannot see.")
REGLA_RADIO = "Area-weighted 95th percentile of the distance from the class cells to the class centre"


def _lee(base, ruta):
    a = np.fromfile(base / ruta, dtype="<f4")
    assert a.size == ANCHO * ALTO, ruta
    return a.astype(float)


def _r6(x):
    return float(f"{x:.6g}")


def entradas(base):
    indice = json.loads((base / "indice.json").read_text(encoding="utf-8"))
    params = [p for p in indice["parametros"] if p["reproducible_en_tierra"]]
    assert all((p["capas"] or {}).get("earth") for p in params), "cada parámetro reproducible necesita capa en la Tierra"
    rutas = sorted({indice["mascara_tierra"], indice["mascara_casquete"], *(p["capas"]["earth"] for p in params)})
    h = hashlib.sha256(json.dumps([[p["id"], p["transformacion"], p["rango_ref"]["min"]] for p in params]).encode())
    for r in rutas:
        h.update(r.encode())
        h.update((base / r).read_bytes())
    tierra = _lee(base, indice["mascara_tierra"])
    casquete = _lee(base, indice["mascara_casquete"])
    crudo = np.stack([_lee(base, p["capas"]["earth"]) for p in params], axis=1)
    celdas = (tierra >= 0.5) & ~(casquete == 1) & np.isfinite(crudo).all(1)
    X = np.stack([ca.transforma(crudo[:, j], p["transformacion"], p["rango_ref"]["min"]) for j, p in enumerate(params)], axis=1)
    lat = np.repeat(90.0 - PASO / 2 - PASO * np.arange(ALTO), ANCHO)
    w = np.cos(np.radians(lat))
    tierra_firme = (tierra >= 0.5) & ~(casquete == 1)
    return indice, params, np.flatnonzero(celdas), X[celdas], w[celdas], float(w[celdas].sum() / w[tierra_firme].sum()), h.hexdigest()


def calcula(X, w, ids, grupos, transformaciones, k_candidatos=ca.K_CANDIDATOS, n_muestra=ca.N_MUESTRA):
    """Todo el cálculo sobre la matriz X (celdas × parámetros, ya transformada). Devuelve (resumen, etiquetas, distancias)."""
    media, desv = (ca.redondea(v) for v in ca.estandariza(X, w))
    assert np.all(desv > 0), desv
    Z = (X - media) / desv
    comp_todas, autoval_todos = ca.pca(Z, w)
    explicada = autoval_todos / autoval_todos.sum()
    q = ca.retenidas(autoval_todos)
    comp, autoval = ca.redondea(comp_todas[:q]), ca.redondea(autoval_todos[:q])
    S = ca.puntuaciones(X, media, desv, comp, autoval)
    residuo = np.sqrt(np.maximum((Z ** 2).sum(1) - ((Z @ comp.T) ** 2).sum(1), 0))

    m = ca.muestra(w, n_muestra)
    D = ca.matriz_distancias(S[m])
    d_ref = float(ca.redondea(np.percentile(D[np.triu_indices(len(m), 1)], 99)))

    tabla, ajustes, sil = [], {}, []
    for k in k_candidatos:
        C, e, inercia = ca.kmedias(S, w, k)
        ajustes[k] = C
        sil.append(ca.silueta_media(D, e[m]))
        tabla.append({"k": k, "silueta_media": _r6(sil[-1]), "inercia": _r6(inercia)})
    k = tabla[int(np.argmax(sil))]["k"]

    C = ajustes[k]
    e, _ = ca.asigna(S, C)
    area = np.array([w[e == j].sum() for j in range(k)])
    C = ca.redondea(C[np.argsort(-area, kind="stable")])
    e, d = ca.asigna(S, C)

    zmedias = np.array([(w[e == j] @ Z[e == j]) / w[e == j].sum() for j in range(k)])
    nombres = ca.rotulos(zmedias, ids, grupos)
    clases = []
    for j in range(k):
        s = e == j
        fisico = (w[s] @ X[s]) / w[s].sum()
        clases.append({
            "id": j,
            "rotulo": nombres[j],
            "n_celdas": int(s.sum()),
            "pct_area": _r6(100 * w[s].sum() / w.sum()),
            "radio": float(ca.redondea(ca.percentil_area(d[s], w[s], 0.95))),
            "centroide_componentes": C[j].tolist(),
            "z_medio": {pid: _r6(z) for pid, z in zip(ids, zmedias[j])},
            "centroide_fisico": {pid: _r6(float(ca.destransforma(v, t))) for pid, v, t in zip(ids, fisico, transformaciones)},
        })
    pca = {"parametros": list(ids), "media": media.tolist(), "desviacion": desv.tolist(),
           "componentes": comp.tolist(), "autovalores": autoval.tolist(),
           "varianza_explicada": [_r6(x) for x in explicada], "retenidas": q,
           "varianza_retenida": _r6(explicada[:q].sum()),
           "residuo_z_p99": _r6(ca.percentil_area(residuo, w, 0.99)),
           "residuo_regla": REGLA_RESIDUO}
    resumen = {"pca": pca, "clases": clases, "d_ref": d_ref, "tabla_k": tabla, "k": k}
    return resumen, e, d


def documento(resumen, n, frac_area, huella):
    p = resumen["pca"]
    return {
        "que_es": f"Unsupervised grouping of Earth's land by these {len(p['parametros'])} parameters; not a prediction.",
        "origen": "mío",
        "metodo": "Principal components of the standardized parameters, then k-means on the whitened component scores. "
                  "No labelled data and no trained model: it only groups Earth cells that look alike in these numbers.",
        "doc": "docs/metrica-analogos.md",
        "celdas": {"regla": REGLA_CELDAS, "n": n, "pct_area_tierra_firme": _r6(100 * frac_area)},
        "espacio": REGLA_ESPACIO,
        "pca": p,
        "criterio_k": {"regla": REGLA_K, "tabla": resumen["tabla_k"], "k": resumen["k"]},
        "d_ref": {"valor": resumen["d_ref"], "regla": REGLA_DREF,
                  "uso": "similitud_pct = 100 × (1 − d / d_ref), clipped to [0, 100]"},
        "radio": REGLA_RADIO,
        "rotulo": {"regla": ca.REGLA_ROTULO, "palabras": {k: list(v) for k, v in ca.PALABRAS.items()}},
        "clases": resumen["clases"],
        "capa": CAPA,
        "entrada_sha256": huella,
    }


def main(argv, base=None):
    base = Path(base or SALIDA)
    indice, params, celdas, X, w, frac, huella = entradas(base)
    ids = [p["id"] for p in params]
    resumen, e, _ = calcula(X, w, ids, [p["grupo"] for p in params], [p["transformacion"] for p in params])
    doc = documento(resumen, len(celdas), frac, huella)

    capa = np.full(ANCHO * ALTO, np.nan, dtype="<f4")
    capa[celdas] = e
    _atomico(base / CAPA, lambda t: t.write_bytes(capa.tobytes()))
    texto = json.dumps(doc, ensure_ascii=False, indent=1, allow_nan=False) + "\n"
    _atomico(base / FICHERO, lambda t: t.write_text(texto, encoding="utf-8"))
    if indice.get("clases") != FICHERO:
        indice["clases"] = FICHERO
        t = json.dumps(indice, ensure_ascii=False, indent=1, allow_nan=False) + "\n"
        _atomico(base / "indice.json", lambda r: r.write_text(t, encoding="utf-8"))

    p = resumen["pca"]
    print(f"cells {len(celdas)} ({100 * frac:.2f} % of ice-free land by area); components kept {p['retenidas']} of "
          f"{len(ids)}, variance {p['varianza_retenida']:.4f}; explained {p['varianza_explicada']}", flush=True)
    for t in resumen["tabla_k"]:
        print(f"k={t['k']:2d} silhouette={t['silueta_media']:.4f} inertia={t['inercia']}", flush=True)
    print(f"k chosen {resumen['k']}; d_ref {resumen['d_ref']}", flush=True)
    for c in resumen["clases"]:
        print(f"  {c['id']:2d} {c['pct_area']:6.2f} %  r={c['radio']:.3f}  {c['rotulo']}", flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
