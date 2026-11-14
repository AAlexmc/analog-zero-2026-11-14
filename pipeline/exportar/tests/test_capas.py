import csv
import json

import numpy as np
import pytest

from pipeline.exportar import capas
from pipeline.malla import rejilla
from pipeline.motor import puntos
from pipeline.motor import umbrales as um
from pipeline.motor.tests.test_puntos import BUENA, malla_sintetica
from pipeline.motor.tests.test_similitud import RUG


@pytest.fixture(scope="module")
def u():
    return um.carga()[0]


def pix(img, lat, lon):
    i, j = rejilla.celda_de(lat, lon)
    return img[rejilla.N_LAT - 1 - i, j]


def test_png_ida_y_vuelta_fila0_norte(tmp_path):
    r = np.full((360, 720), 255, np.uint8)
    r[359, 0] = 7
    r[0, 719] = 9
    capas.escribe_png(tmp_path / "x.png", r, r, r)
    img = capas.lee_png(tmp_path / "x.png")
    assert img.shape == (360, 720, 4) and (img[..., 3] == 255).all()
    assert img[0, 0, 0] == 7 and img[359, 719, 0] == 9
    assert not list(tmp_path.glob("*.tmp"))


def test_codifica_con_na_sin_dato_y_recorte():
    v = np.array([0.0, 0.5, 1.0, np.nan, 0.3, 9.0])
    e = np.array([0, 0, 0, 2, 1, 0])
    b = capas.a_byte(v, 0.004, 0.0, e)
    assert list(b) == [0, 125, 250, 255, 254, 250]


CELDAS = {(60.25, 10.25): dict(BUENA), (-30.25, 20.25): {**BUENA, "ndvi_max": 0.9},
          (10.25, 30.25): {**BUENA, "casquete_frac": np.nan}, (89.75, -179.75): {**BUENA, "nv_dias_m23c": 10},
          (-24.1, -70.01): {**BUENA, "aridez_ai": 0.01}, (-3.12, -60.02): {**BUENA, "aridez_ai": 2.0}}


@pytest.fixture(scope="module")
def exportado(u, tmp_path_factory):
    d = malla_sintetica(CELDAS)
    tierra, base = puntos.mascaras(u, d)
    pares, _ = puntos.pares_a_calcular(u)
    ds = {f"{p['objetivo']}_{p['mision']}": puntos.calcula_par(u, "sha", p["objetivo"], p["mision"], d, tierra, base, RUG, 20, 3)
          for p in pares if p["exportar"]}
    meta = {k: {"units": "1", "fuente": "https://ejemplo.org"} for k in d}
    destino = tmp_path_factory.mktemp("global")
    capas.exporta(u, "sha", "malla_v9.nc", d, meta, tierra, base, ds, destino, sitios=[{"id": "x", "lat": 60.3, "lon": 10.3}])
    return destino, ds, d


def test_s_png_igual_a_puntos_y_puertas(exportado):
    destino, ds, _ = exportado
    img = capas.lee_png(destino / "s_jezero_P2.png")
    S = ds["jezero_P2"]["S"].values
    i, j = rejilla.celda_de(60.25, 10.25)
    assert pix(img, 60.25, 10.25)[0] == int(np.round(S[i, j] / 0.004))
    assert list(pix(img, -30.25, 20.25)[:3]) == [0, 0, 0]
    assert list(pix(img, 10.25, 30.25)[:3]) == [255, 255, 255]
    assert list(pix(img, 0.25, 0.25)) == [255, 255, 255, 255]
    assert pix(img, 89.75, -179.75)[0] != 255 and img[0, 0, 0] == pix(img, 89.75, -179.75)[0]
    c = capas.lee_png(destino / "c_jezero_P2.png")
    assert pix(c, -30.25, 20.25)[1] == 0b10
    assert pix(c, 10.25, 30.25)[1] == 0b1 << 4
    assert pix(c, 60.25, 10.25)[1] == 0


def test_dim_vacios_y_d5_sin_dato(exportado):
    destino, ds, _ = exportado
    b = capas.lee_png(destino / "dim_jezero_P4_b.png")
    assert pix(b, 60.25, 10.25)[1] == 255
    assert (b[..., 0] == 255).all() and (b[..., 2] == 255).all()
    m = json.loads((destino / "capas.json").read_text())
    canales = m["canales"]["dim_jezero_P4_b.png"]
    assert [c.get("vacio", False) for c in canales] == [True, False, True]


def test_manifiesto_segun_contrato(exportado, u):
    destino, _, _ = exportado
    m = json.loads((destino / "capas.json").read_text())
    assert m["umbrales_sha256"] == "sha" and m["malla"] == "malla_v9.nc" and m["ejemplo"] is False
    assert m["rejilla"] == {"ancho": 720, "alto": 360, "fila0": "norte", "lon0": -179.75, "lat0": 89.75, "paso": 0.5}
    assert [p["id"] for p in m["pares"]] == ["jezero_P2", "jezero_P4", "arcadia_P1", "shackleton_P3", "shackleton_P5"]
    p3 = next(p for p in m["pares"] if p["id"] == "shackleton_P3")
    assert p3["prerregistrado"] is True and p3["pesos"] == u["misiones"]["P3"]["pesos"]
    assert [g["id"] for g in p3["puertas"]] == ["casquete", "relieve"]
    assert next(p for p in m["pares"] if p["id"] == "shackleton_P5")["prerregistrado"] is False
    for p in m["pares"]:
        for f in [p["ficheros"]["s"], p["ficheros"]["c"], *p["ficheros"]["dim"]]:
            assert (destino / f).exists() and len(m["canales"][f]) == 3
        assert (destino / p["candidatos"]["csv"]).exists() and (destino / p["candidatos"]["geojson"]).exists()
        assert p["n_tierra"] >= p["n_no_evaluables"] + p["n_fallan_puerta"]
    for f in ("var_a.png", "var_b.png", "var_c.png", "var_d.png", "var_e.png", "var_f.png"):
        assert (destino / f).exists() and len(m["canales"][f]) == 3
    lito = m["canales"]["var_e.png"][2]
    assert lito["scale"] == 1 and lito["offset"] == 0
    assert m["litologia_clases"]["2"] and set(m["dimensiones"]) >= {"D1", "D8", "D9"}
    assert (destino / "objetivos.json").exists()


def test_orientacion_aridez_yungay_y_manaos(exportado):
    destino, _, _ = exportado
    m = json.loads((destino / "capas.json").read_text())
    ch = m["canales"]["var_a.png"][2]
    assert ch["id"] == "aridez_ai"
    img = capas.lee_png(destino / "var_a.png")
    val = lambda lat, lon: ch["offset"] + pix(img, lat, lon)[2] * ch["scale"]  # noqa: E731
    assert val(-24.1, -70.01) < 0.05 and not val(-3.12, -60.02) < 0.05


def test_candidatos_ordenados_y_sitio_cercano(exportado):
    destino, ds, _ = exportado
    filas = list(csv.DictReader(open(destino / "candidatos_jezero_P2.csv")))
    S = [float(f["S"]) for f in filas]
    assert S == sorted(S, reverse=True) and len(filas) <= 200
    assert all(float(f["S"]) > 0 for f in filas)
    assert list(filas[0])[:7] == ["puesto", "lat", "lon", "S", "S_p5", "S_p95", "C"]
    assert set(u_ for u_ in ("D1", "D6", "D4", "D3", "D8")) <= set(filas[0])
    cerca = {(f["lat"], f["lon"]): f["sitio_cercano"] for f in filas}
    assert cerca[("60.25", "10.25")] == "x"
    g = json.loads((destino / "candidatos_jezero_P2.geojson").read_text())
    assert g["type"] == "FeatureCollection" and len(g["features"]) == len(filas)
    assert g["features"][0]["geometry"]["coordinates"] == [float(filas[0]["lon"]), float(filas[0]["lat"])]


def test_main_global_con_build_sintetico(u, tmp_path):
    from pipeline.malla import salida
    from pipeline.motor.__main__ import corre as corre_motor
    from pipeline.validacion.__main__ import corre as corre_val

    build, destino = tmp_path / "build", tmp_path / "global"
    build.mkdir()
    assert capas.main(build, destino) is None
    d = malla_sintetica(CELDAS)
    salida.escribe_malla({k: (v, {"units": "1", "fuente": "mío", "origen": "mío"}) for k, v in d.items()}, 2, build)
    rug = build / "rug.json"
    rug.write_text(json.dumps({"objetivos": {k: {"rugosidad_tan": v, "estado": "ok" if v else "sin_dato"} for k, v in RUG.items()}}))
    corre_motor(build, n_mc=5, rug_ruta=rug)
    corre_val(build, "prueba", "", rug_ruta=rug)
    m = capas.main(build, destino)
    assert m["malla"] == "malla_v2.nc"
    assert json.loads((destino / "informe_validacion.json").read_text())["malla"] == "malla_v2.nc"
    for p in m["pares"]:
        assert (build / "global" / f"{p['id']}_S.png").exists()
        lineas = (build / "global" / f"top20_{p['id']}.txt").read_text().splitlines()
        assert lineas[1].startswith("puesto\tlat\tlon\tS")
    assert not list(destino.glob("*.tmp"))


def test_orientacion_de_la_capa_publicada_yungay_y_manaos():
    ruta = um.RAIZ / "web" / "data" / "global"
    if not (ruta / "capas.json").exists():
        pytest.skip("sin capas publicadas")
    m = json.loads((ruta / "capas.json").read_text())
    ch = m["canales"]["var_a.png"][2]
    img = capas.lee_png(ruta / "var_a.png")
    val = lambda lat, lon: ch["offset"] + pix(img, lat, lon)[2] * ch["scale"]  # noqa: E731
    assert pix(img, -24.1, -70.0)[2] < 250 and val(-24.1, -70.0) < 0.05
    assert pix(img, -3.1, -60.0)[2] < 254 and not val(-3.1, -60.0) < 0.05
