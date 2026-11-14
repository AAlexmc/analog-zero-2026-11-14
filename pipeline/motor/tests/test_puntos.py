import numpy as np
import pytest
import xarray as xr

from pipeline.malla import rejilla
from pipeline.motor import puntos
from pipeline.motor import similitud as sim
from pipeline.motor import umbrales as um
from pipeline.motor.tests.test_similitud import RUG

VARS = ("litologia_glim", "soc_g_kg", "rugosidad_tan", "nv_dias_m23c", "nv_dias_0c", "amplitud_diurna_k", "f_low",
        "aridez_ai", "aridez_ai_estado", "permafrost_frac", "viento_p95_m_s", "ndvi_max", "tiempo_ciudad_h",
        "relieve_m", "casquete_frac")


@pytest.fixture(scope="module")
def u():
    return um.carga()[0]


def malla_sintetica(celdas):
    """celdas: {(lat, lon): {variable: valor}} → dict de rejillas 360 × 720 con tierra solo ahí."""
    d = {v: np.full((rejilla.N_LAT, rejilla.N_LON), np.nan, dtype=np.float32) for v in VARS}
    d["tierra_frac"] = np.zeros((rejilla.N_LAT, rejilla.N_LON), dtype=np.float32)
    for (lat, lon), vals in celdas.items():
        i, j = rejilla.celda_de(lat, lon)
        d["tierra_frac"][i, j] = vals.get("tierra_frac", 1.0)
        for k, v in vals.items():
            d[k][i, j] = v
    return d


BUENA = dict(litologia_glim=2, soc_g_kg=1, rugosidad_tan=0.003, nv_dias_m23c=60, nv_dias_0c=100, f_low=0.3,
             aridez_ai=0.01, aridez_ai_estado=0, permafrost_frac=0.9, viento_p95_m_s=6, ndvi_max=0.05,
             tiempo_ciudad_h=5, relieve_m=40, casquete_frac=0, amplitud_diurna_k=10)


def test_pares_a_calcular(u):
    pares, fuera = puntos.pares_a_calcular(u)
    ids = [(p["objetivo"], p["mision"], p["exportar"]) for p in pares]
    assert ids[:5] == [("jezero", "P2", True), ("jezero", "P4", True), ("arcadia", "P1", True),
                       ("shackleton", "P3", True), ("shackleton", "P5", True)]
    assert set(ids[5:]) == {("jezero", "P1", False), ("tranquillitatis", "P4", False)}
    assert [f["par"] for f in fuera] == ["meridiani_P2"]
    assert "coordenadas" in " ".join(fuera[0]["motivos"])


def test_valor_a_mano_de_mcmurdo_y_mascaras(u):
    mc = next(s for s in u["validacion"]["sitios"] if s["id"] == "mcmurdo_dry_valleys")
    tf = next(s for s in u["validacion"]["sitios"] if s["id"] == "timanfaya")
    d = malla_sintetica({(mc["lat"], mc["lon"]): {**BUENA, "permafrost_frac": np.nan},
                         (-75.0, 0.0): dict(BUENA),
                         (tf["lat"], tf["lon"]): {**BUENA, "tierra_frac": 0.0},
                         (40.0, 0.0): dict(BUENA)})
    registro = puntos.aplica_valores_a_mano(u, d)
    i, j = rejilla.celda_de(mc["lat"], mc["lon"])
    assert d["permafrost_frac"][i, j] == 1.0
    assert registro == [{"sitio": "mcmurdo_dry_valleys", "variable": "permafrost_frac", "celda": [i, j],
                         "antes": None, "valor": 1.0}]
    tierra, base = puntos.mascaras(u, d)
    assert tierra.sum() == 2 + len(u["validacion"]["sitios"])
    assert base[i, j] and not base[rejilla.celda_de(-75.0, 0.0)]
    assert tierra[rejilla.celda_de(tf["lat"], tf["lon"])] and base[rejilla.celda_de(40.0, 0.0)]


def test_calcula_par_coincide_con_similitud_y_escribe_nc(u, tmp_path):
    celdas = {(10.25, 20.25): dict(BUENA), (10.25, 30.25): {**BUENA, "relieve_m": 300},
              (-30.25, 20.25): {**BUENA, "casquete_frac": np.nan}}
    d = malla_sintetica(celdas)
    tierra, base = puntos.mascaras(u, d)
    ds = puntos.calcula_par(u, "abc", "jezero", "P4", d, tierra, base, RUG, n_mc=50, semilla=7)
    flat = {k: np.array([v[rejilla.celda_de(*c)] for c in celdas], dtype=float) for k, v in d.items()}
    ref = sim.evalua_par(u, "jezero", "P4", flat, RUG)
    lat = ds.lat.values
    assert lat[0] == -89.75
    S = ds["S"].values
    got = np.array([S[rejilla.celda_de(*c)] for c in celdas])
    assert got[0] == pytest.approx(ref["S"][0]) and got[1] == 0 and np.isnan(got[2])
    assert np.isnan(S[0, 0])
    assert ds["estado"].values[0, 0] == puntos.OCEANO
    assert ds["puertas_falladas"].values[rejilla.celda_de(10.25, 30.25)] == 0b10
    assert ds["puertas_sin_dato"].values[rejilla.celda_de(-30.25, 20.25)] == 0b01
    assert ds["estado_D5"].values[rejilla.celda_de(10.25, 20.25)] == sim.SD
    assert ds.attrs["umbrales_sha256"] == "abc" and ds.attrs["mc_n"] == 50
    p = puntos.escribe(ds, tmp_path / "puntos_jezero_P4.nc")
    with xr.open_dataset(p) as back:
        assert np.array_equal(back["S"].values, S, equal_nan=True)
    assert not list(tmp_path.glob("*.tmp"))


def test_main_con_malla_sintetica_escribe_todos_los_pares(u, tmp_path):
    import json

    from pipeline.malla import salida
    from pipeline.motor.__main__ import corre

    d = malla_sintetica({(10.25, 20.25): dict(BUENA), (60.25, 100.25): {**BUENA, "nv_dias_m23c": 120}})
    salida.escribe_malla({k: (v, {"units": "1", "fuente": "mío", "origen": "mío"}) for k, v in d.items()}, 1, tmp_path)
    rug = tmp_path / "rug.json"
    rug.write_text(json.dumps({"objetivos": {k: {"rugosidad_tan": v, "estado": "ok" if v else "sin_dato"} for k, v in RUG.items()}}))
    indice = corre(tmp_path, n_mc=10, rug_ruta=rug)
    assert [p["id"] for p in indice["pares"]][:5] == ["jezero_P2", "jezero_P4", "arcadia_P1", "shackleton_P3", "shackleton_P5"]
    assert indice["malla"] == "malla_v1.nc" and indice["mc_n"] == 10
    for p in indice["pares"]:
        assert (tmp_path / p["fichero"]).exists()
    assert json.loads((tmp_path / "puntos_indice.json").read_text())["pares_fuera"][0]["par"] == "meridiani_P2"
