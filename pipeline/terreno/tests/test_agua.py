import hashlib
import json
import subprocess
import sys

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from pipeline.terreno import capas, escritura, fuentes, generar, georef
from pipeline.terreno.__main__ import parser

PX = 1 / 3600
LAT0, LON0 = 10.05, 10.05


def _wbm(carpeta, a, b, clases):
    nom = fuentes.nombre_glo30(a, b)[:-4] + "_WBM"
    h, w = clases.shape
    with rasterio.open(carpeta / f"{nom}.tif", "w", driver="GTiff", width=w, height=h, count=1, dtype="uint8",
                       crs="EPSG:4326", transform=from_origin(b, a + h * PX, PX, PX)) as d:
        d.write(clases, 1)


@pytest.fixture
def datos(tmp_path, monkeypatch):
    carpeta = tmp_path / "raw" / "glo30"
    carpeta.mkdir(parents=True)
    monkeypatch.setattr(fuentes, "DATOS", tmp_path)
    monkeypatch.setattr(fuentes, "bajar", lambda url, destino: destino if destino.exists() else None)
    return carpeta


def _rejilla(n=64, m=39.0625, lat=LAT0, lon=LON0):
    R = round(georef.radio_gauss_wgs84(lat), 1)
    return georef.Rejilla(georef.georef_aeqd(R, n, m), n, m, lat, lon)


def test_mayoria_unica_empate_y_celda_vacia():
    cuenta = np.array([[3, 1, 1, 1, 0],
                       [1, 1, 1, 0, 0],
                       [0, 0, 0, 1, 0],
                       [0, 0, 0, 0, 0]])
    vec = np.array([1, 0, 2, 3, 255], np.uint8)
    # celda 0: gana 0 (3 votos) aunque el vecino sea 1; celda 1: empate 0-1, decide el vecino (0);
    # celda 2: empate 0-1 y el vecino (2) no está empatado → el código más alto (1); celda 3: empate 0-2, vecino 3 → 2;
    # celda 4: sin píxeles → vecino (aquí sin dato)
    assert fuentes.mayoria_clases(cuenta, vec).tolist() == [0, 0, 1, 2, 255]


def test_agua_lago_en_mitad_oeste_y_misma_rejilla_que_altura(datos):
    clases = np.zeros((360, 360), np.uint8)
    clases[:, :180] = 2
    _wbm(datos, 10, 10, clases)
    rej = _rejilla()
    may, vec, usadas, ausentes = fuentes.glo30_agua(rej)
    assert may.dtype == np.uint8 and may.shape == (64, 64)
    assert usadas == ["Copernicus_DSM_COG_10_N10_00_E010_00_WBM"] and ausentes == []
    _, lon = rej.latlon_de_px(*np.mgrid[0:64, 0:64])
    lejos = np.abs(lon - (10 + 180 * PX)) > 2 * PX
    assert np.all(may[lejos & (lon < 10.05)] == 2) and np.all(may[lejos & (lon > 10.05)] == 0)
    assert np.array_equal(may[lejos], vec[lejos])
    assert set(np.unique(may)) == {0, 2}


def test_rio_estrecho_mayoria_lo_adelgaza_respecto_al_vecino(datos):
    clases = np.zeros((360, 360), np.uint8)
    clases[:, 178] = 3
    _wbm(datos, 10, 10, clases)
    may, vec, _, _ = fuentes.glo30_agua(_rejilla())
    assert (may == 3).sum() <= (vec == 3).sum()
    assert (may == 3).sum() > 0


def test_sin_tesela_wbm_es_255_y_codigo_desconocido_no_vale(datos):
    clases = np.zeros((360, 360), np.uint8)
    clases[100:260, :40] = 7
    _wbm(datos, 10, 10, clases)
    may, vec, usadas, ausentes = fuentes.glo30_agua(_rejilla(n=64, lon=10.0))
    assert ausentes == ["Copernicus_DSM_COG_10_N10_00_E009_00_WBM"]
    _, lon = _rejilla(n=64, lon=10.0).latlon_de_px(*np.mgrid[0:64, 0:64])
    assert np.all(may[lon < 10 - 2 * PX] == 255)
    assert 7 not in np.unique(may) and 7 not in np.unique(vec)
    assert set(np.unique(may)) <= {0, 255}


def test_agua_solo_en_rejillas_de_la_tierra():
    rej = georef.Rejilla(georef.georef_estereo("sur", 1737400.0, 0.0, 0.0, 8, 10.0), 8, 10.0, -90.0, 0.0)
    with pytest.raises(ValueError):
        capas.generar_capa("agua", rej)


def _sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def test_anadir_capa_no_toca_altura_ni_el_resto_de_meta(datos, tmp_path):
    clases = np.zeros((360, 360), np.uint8)
    clases[:180] = 1
    _wbm(datos, 10, 10, clases)
    rej = _rejilla(n=32)
    salida = tmp_path / "terreno"
    d = salida / "t"
    escritura.escribir_capa(d / "altura.f32", np.zeros((32, 32), np.float32))
    meta = {"id": "t", "cuerpo": "tierra", "nombre": "t", "centro": {"lat": LAT0, "lon": LON0}, "lado_km": 1.25,
            "n": 32, "m_por_px": 39.0625, "z_min": 0.0, "z_max": 0.0, "georef": rej.g,
            "capas": {"altura": {"fichero": "altura.f32", "tipo": "float32", "unidad": "m", "fuente": "x"}},
            "notas": "n", "generado": "2000-01-01T00:00:00Z", "comando": "c"}
    escritura.escribir_json(d / "meta.json", meta)
    antes = _sha(d / "altura.f32")
    m = generar.anadir_capa("t", "agua", salida=salida, vista=False)
    assert _sha(d / "altura.f32") == antes
    nuevo = json.loads((d / "meta.json").read_text())
    assert {k: v for k, v in nuevo.items() if k != "capas"} == {k: v for k, v in meta.items() if k != "capas"}
    assert nuevo["capas"]["altura"] == meta["capas"]["altura"]
    a = nuevo["capas"]["agua"]
    assert a == m["capas"]["agua"]
    assert a["fichero"] == "agua.u8" and a["tipo"] == "uint8" and a["clases"] == {"0": "no water", "1": "ocean",
                                                                                   "2": "lake", "3": "river"}
    assert a["comando"] == "python -m pipeline.terreno capa --id t --capa agua"
    assert a["teselas"] == [fuentes.url_wbm("Copernicus_DSM_COG_10_N10_00_E010_00_DEM")]
    v = np.fromfile(d / "agua.u8", np.uint8).reshape(32, 32)
    assert (v == 1).any() and (v == 0).any()


def test_anadir_capa_se_niega_en_la_luna(tmp_path):
    d = tmp_path / "l"
    escritura.escribir_json(d / "meta.json", {"id": "l", "cuerpo": "luna", "n": 8, "m_por_px": 10.0,
                                               "centro": {"lat": -90.0, "lon": 0.0}, "capas": {},
                                               "georef": georef.georef_estereo("sur", 1737400.0, 0.0, 0.0, 8, 10.0)})
    with pytest.raises(ValueError):
        generar.anadir_capa("l", "agua", salida=tmp_path, vista=False)
    assert not (d / "agua.u8").exists()


def test_cli_capa():
    a = parser().parse_args(["capa", "--id", "haughton", "--capa", "agua"])
    assert (a.orden, a.id, a.capa) == ("capa", "haughton", "agua")


CHECK = generar.REPO / "scripts" / "check_terrenos.py"


def _terreno_check(raiz, cuerpo, agua, meta_agua=None):
    d = raiz / "t"
    n = 4
    escritura.escribir_capa(d / "altura.f32", np.zeros((n, n), np.float32))
    escritura.escribir_capa(d / "agua.u8", agua)
    c = {"fichero": "agua.u8", "tipo": "uint8", "unidad": "class", "fuente": "x",
         "clases": {"0": "no water", "1": "ocean", "2": "lake", "3": "river"}}
    c.update(meta_agua or {})
    escritura.escribir_json(d / "meta.json", {
        "id": "t", "cuerpo": cuerpo, "nombre": "t", "centro": {"lat": 0, "lon": 0}, "lado_km": 0.16, "n": n,
        "m_por_px": 40.0, "z_min": 0, "z_max": 0, "georef": {}, "capas": {
            "altura": {"fichero": "altura.f32", "tipo": "float32", "fuente": "x"}, "agua": c}})
    r = subprocess.run([sys.executable, str(CHECK), str(raiz)], capture_output=True, text=True)
    return r.returncode, r.stdout


def test_check_terrenos_acepta_agua_valida(tmp_path):
    a = np.array([0, 1, 2, 3, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], np.uint8).reshape(4, 4)
    assert _terreno_check(tmp_path, "tierra", a) == (0, "")


@pytest.mark.parametrize("cuerpo,valor,meta,error", [
    ("tierra", 4, None, "valores fuera de"),
    ("luna", 0, None, "solo en la tierra"),
    ("tierra", 0, {"tipo": "float32"}, "uint8"),
    ("tierra", 0, {"clases": {"0": "no water"}}, "clases"),
])
def test_check_terrenos_rechaza_agua_mala(tmp_path, cuerpo, valor, meta, error):
    a = np.zeros((4, 4), np.uint8)
    a[1, 1] = valor
    if meta and meta.get("tipo") == "float32":
        a = np.zeros((4, 4), np.uint8)
    codigo, salida = _terreno_check(tmp_path, cuerpo, a, meta)
    assert codigo == 1 and error in salida, salida


def _real(id_):
    d = generar.SALIDA / id_
    m = json.loads((d / "meta.json").read_text()) if (d / "meta.json").exists() else {}
    if "agua" not in m.get("capas", {}):
        pytest.skip(f"{id_} sin capa agua")
    n = m["n"]
    z = np.fromfile(d / "altura.f32", "<f4").reshape(n, n)
    return m, z, np.fromfile(d / m["capas"]["agua"]["fichero"], np.uint8).reshape(n, n)


def test_haughton_el_mar_a_0_m_es_agua_del_wbm():
    m, z, a = _real("haughton")
    mar = z == 0.0
    assert np.mean(a[mar] == 1) > 0.95
    assert np.mean(a[~mar] == 1) < 0.01


def test_mistastin_el_lago_a_334_5_m_es_agua_del_wbm():
    m, z, a = _real("mistastin")
    lago = z == np.float32(334.5)
    assert np.mean(a[lago] == 2) > 0.95


def test_terrenos_lunares_sin_capa_agua():
    for d in generar.SALIDA.glob("*/meta.json"):
        m = json.loads(d.read_text())
        if m["cuerpo"] != "tierra":
            assert "agua" not in m["capas"], m["id"]
