import json

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from pipeline.terreno import capas, escritura, generar, georef

CRS_SUR = "+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +x_0=0 +y_0=0 +R=1737400 +units=m +no_defs"


def test_mas_iluminados_separa_ordena_y_salta_nan():
    x = np.array([0.0, 500.0, 1000.0, 3000.0, 3400.0, 9000.0])
    y = np.zeros(6)
    v = np.array([0.9, 0.95, 0.5, 0.7, np.nan, 0.6])
    assert generar.mas_iluminados(x, y, v, 3, 1000.0) == [1, 3, 5]


def test_mas_iluminados_empate_por_orden_de_lectura_y_distancia_justa():
    x = np.array([0.0, 1000.0, 2000.0])
    y = np.zeros(3)
    v = np.full(3, 0.8)
    assert generar.mas_iluminados(x, y, v, 5, 1000.0) == [0, 1, 2]
    assert generar.mas_iluminados(x, y, v, 5, 1000.1) == [0, 2]


def test_mas_iluminados_sin_validos_da_lista_vacia():
    assert generar.mas_iluminados(np.zeros(2), np.zeros(2), np.full(2, np.nan), 5, 1000.0) == []


def _avgvisib(p, dn, m):
    n = dn.shape[0]
    h = n / 2 * m
    with rasterio.open(p, "w", driver="GTiff", width=n, height=n, count=1, dtype="int16", crs=CRS_SUR,
                       transform=from_origin(-h, h, m, m), nodata=-32768) as d:
        d.write(dn, 1)
        d.scales = (4e-05,)
        d.offsets = (0.0,)
    return capas.RasterPolar(p)


def test_picos_luz_solo_dentro_de_la_rejilla_y_celda_que_contiene_el_pixel(tmp_path):
    m = 60.0
    dn = np.full((201, 201), 1000, np.int16)
    dn[100, 100] = 20000                      # (0, 0): dentro, máximo
    dn[100, 110] = 19000                      # 600 m: demasiado cerca del primero
    dn[100, 120] = 18000                      # 1200 m al este
    dn[60, 100] = 25000                       # 2400 m al norte: fuera de la rejilla
    dn[100, 90] = -32768
    r = _avgvisib(tmp_path / "a.tif", dn, m)
    n, mr = 64, 50.0                          # rejilla de 3,2 km centrada en (0, 0)
    rej = georef.Rejilla(georef.georef_estereo("sur", 1737400.0, 0.0, 0.0, n, mr), n, mr, -90.0, 0.0)
    p = generar.picos_luz(rej, r=r, n=2, sep_km=1.0)
    assert [(q["valor"]) for q in p] == [0.8, 0.72]
    f, c = rej.px_de_xy(np.array([0.0, 1200.0]), np.array([0.0, 0.0]))
    assert [(q["fila"], q["col"]) for q in p] == list(zip(np.floor(f + 0.5).astype(int).tolist(),
                                                           np.floor(c + 0.5).astype(int).tolist()))
    lat, lon = georef.estereo_inversa("sur", 1200.0, 0.0, 1737400.0)
    assert p[1]["lat"] == round(float(lat), 5) and p[1]["lon"] == round(float(lon), 4)


def test_anadir_picos_solo_toca_meta(tmp_path, monkeypatch):
    n, mr = 8, 100.0
    g = georef.georef_estereo("sur", 1737400.0, 0.0, 0.0, n, mr)
    d = tmp_path / "t"
    escritura.escribir_capa(d / "altura.f32", np.zeros((n, n), np.float32))
    meta = {"id": "t", "cuerpo": "luna", "centro": {"lat": -90.0, "lon": 0.0}, "n": n, "m_por_px": mr, "georef": g,
            "capas": {"altura": {"fichero": "altura.f32"}}, "generado": "x"}
    escritura.escribir_json(d / "meta.json", meta)
    antes = (d / "altura.f32").read_bytes()
    falso = [{"fila": 1, "col": 2, "lat": -89.9, "lon": 3.0, "valor": 0.5}]
    monkeypatch.setattr(generar, "picos_luz", lambda rej, **k: falso)
    generar.anadir_picos("t", salida=tmp_path)
    nuevo = json.loads((d / "meta.json").read_text())
    assert (d / "altura.f32").read_bytes() == antes
    assert nuevo["picos_luz"]["puntos"] == falso and nuevo["picos_luz"]["origen"] == "mío"
    assert nuevo["picos_luz"]["comando"] == "python -m pipeline.terreno picos --id t"
    assert {k: v for k, v in nuevo.items() if k != "picos_luz"} == meta


def test_cli_picos_admite_id_opcional():
    from pipeline.terreno.__main__ import parser

    assert parser().parse_args(["picos"]).id is None
    assert parser().parse_args(["picos", "--id", "shoemaker"]).id == "shoemaker"


@pytest.mark.skipif(not (generar.fuentes.DATOS / "raw" / "pgda" / "AVGVISIB_85S_060M_201608.TIF").exists(),
                    reason="sin AVGVISIB")
def test_borde_sigue_dando_el_punto_de_shackleton_borde():
    b = generar.borde_mas_iluminado()
    s = next(t for t in generar.cargar_sitios()["sitios"] if t["id"] == "shackleton_borde")
    assert (b["lat"], b["lon"], b["iluminacion"]) == (s["lat"], s["lon"], 0.8706)


LUNARES = [s["id"] for s in generar.cargar_sitios()["sitios"] if s["cuerpo"] == "luna"]


@pytest.mark.parametrize("id_", LUNARES)
def test_picos_luz_de_los_terrenos_lunares(id_):
    d = generar.SALIDA / id_
    if not (d / "meta.json").exists():
        pytest.skip(f"{id_} sin generar")
    m = json.loads((d / "meta.json").read_text())
    pl = m["picos_luz"]
    p = pl["puntos"]
    assert len(p) == 5 and pl["n"] == 5 and pl["separacion_min_km"] == 1.0
    v = [q["valor"] for q in p]
    assert v == sorted(v, reverse=True) and 0 < v[-1] <= v[0] <= 1
    rej = georef.Rejilla(m["georef"], m["n"], m["m_por_px"], m["centro"]["lat"], m["centro"]["lon"])
    x, y = rej.xy_de_latlon(np.array([q["lat"] for q in p]), np.array([q["lon"] for q in p]))
    dist = np.hypot(x[:, None] - x[None], y[:, None] - y[None]) + np.eye(5) * 1e9
    assert dist.min() >= 999.0
    f, c = rej.px_de_xy(x, y)
    assert np.all(np.abs(f - [q["fila"] for q in p]) <= 0.51) and np.all(np.abs(c - [q["col"] for q in p]) <= 0.51)
    il = np.fromfile(d / "iluminacion.f32", "<f4").reshape(m["n"], m["n"])
    en_rejilla = il[[q["fila"] for q in p], [q["col"] for q in p]]
    # bilineal de píxeles de la misma fuente: no supera al mayor; la distancia al valor depende de m_por_px
    assert np.all(en_rejilla <= v[0] + 1e-4)
