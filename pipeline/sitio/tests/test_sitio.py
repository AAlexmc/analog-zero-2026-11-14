import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest

from pipeline.sitio import __main__ as si
from pipeline.sitio import luna, marte
from pipeline.terreno import georef

RAIZ = Path(__file__).resolve().parents[3]
SALIDA = RAIZ / "web" / "data" / "sitio"
INDICE = SALIDA / "indice.json"


def test_pendiente_de_un_plano_inclinado_es_su_angulo():
    m = 100.0
    f, c = np.mgrid[0:6, 0:7]
    z = 0.1 * m * c + 0.05 * m * f
    np.testing.assert_allclose(luna.pendiente_grados(z, m), np.degrees(np.arctan(np.hypot(0.1, 0.05))), rtol=1e-12)


def test_pendiente_igual_que_calculo_js_con_nan_y_bordes():
    if not shutil.which("node"):
        pytest.skip("sin node")
    n, m = 9, 146.484375
    z = np.random.default_rng(4).normal(0, 50, (n, n)).astype(np.float32)
    z[0, 3] = z[4, 4] = z[8, 0] = z[5, 7] = np.nan
    z[2, 1:3] = np.nan
    js = (f"import {{ pendientes }} from '{(RAIZ / 'web/terreno/rutas.js').as_uri()}';"
          f"const a = Float32Array.from({json.dumps([None if np.isnan(v) else float(v) for v in z.ravel()])}, v => v ?? NaN);"
          f"console.log(JSON.stringify(Array.from(pendientes(a, {n}, {m}), v => Number.isFinite(v) ? v : null)));")
    r = subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, text=True, check=True)
    ref = np.array([np.nan if v is None else v for v in json.loads(r.stdout)], dtype=float).reshape(n, n)
    py = luna.pendiente_grados(z, m)
    assert (np.isnan(py) == np.isnan(ref)).all()
    np.testing.assert_allclose(py[np.isfinite(py)], ref[np.isfinite(ref)], rtol=1e-6)


def test_distancia_a_sombra_en_metros_del_plano_y_255_no_cuenta():
    s = np.zeros((5, 6), np.uint8)
    s[0, 0] = 1
    s[4, 5] = 255
    d = luna.distancia_sombra_km(s, 1000.0)
    assert d[0, 0] == 0 and d[0, 3] == pytest.approx(3.0) and d[4, 5] == pytest.approx(np.hypot(4, 5))
    assert np.isnan(luna.distancia_sombra_km(np.zeros((3, 3), np.uint8), 1.0)).all()


def test_pendiente_cuadros_de_un_plano_norte_sur_es_constante_y_la_base_ew_se_alarga():
    ppd, r = 4, 3396.0
    dy = r * 1000 * np.radians(1 / ppd)
    filas = np.arange(180 * ppd)[:, None]
    z = (-0.05 * dy * filas + np.zeros((1, 360 * ppd))).astype(np.float64)
    p, base = marte.pendiente_cuadros(z, ppd, r)
    assert base == pytest.approx(dy)
    np.testing.assert_allclose(p[:-1], np.degrees(np.arctan(0.05)), rtol=1e-5)
    assert np.isnan(p[-1]).all()


def test_percentil_por_bloques():
    a = np.arange(16, dtype=np.float32).reshape(4, 4)
    a[0, 0] = np.nan
    r = marte.percentil_bloques(a, 2, 50)
    assert r.shape == (2, 2) and r[0, 0] == pytest.approx(np.nanmedian([np.nan, 1, 4, 5]))


def test_mejor_punto_respeta_limites_y_sentidos():
    capas = {"a": np.array([[1.0, 2.0, 3.0]]), "b": np.array([[5.0, 1.0, 0.0]]), "c": np.array([[0.0, 0.0, 9.0]])}
    crit = [{"id": "a", "tipo": "peso", "sentido": "mas"}, {"id": "b", "tipo": "peso", "sentido": "menos"},
            {"id": "c", "tipo": "limite", "limite": {"op": "<", "valor": 1}}]
    assert si.mejor_punto(capas, crit)[0] == (0, 1)


@pytest.fixture(scope="module")
def indice():
    if not INDICE.exists():
        pytest.skip("sin web/data/sitio/indice.json")
    return json.loads(INDICE.read_text(encoding="utf-8"))


def _capa(ruta, forma):
    return np.fromfile(SALIDA / ruta, dtype="<f4").reshape(forma)


def test_cada_criterio_lleva_cita_verificada_del_catalogo_y_su_numero(indice):
    cat = json.loads((RAIZ / "datos_json/criterios_sitio.json").read_text(encoding="utf-8"))
    for mundo, m in indice["mundos"].items():
        c = {x["id"]: x for x in cat["mundos"][mundo]["criterios"]}
        for x in m["criterios"]:
            assert x["cita"] == {"texto": c[x["id"]]["cita"], "fuente": c[x["id"]]["fuente"]}
            assert c[x["id"]]["verificado"] is True
            assert x["tipo"] in ("limite", "peso", "limite+peso") and x["fuente_dato"]["texto"]
            if x["limite"]:
                assert x["limite"]["origen"] == "cita" and c[x["id"]]["valor"] is not None
                assert x["limite"]["valor_en_cita"].split()[0] == f"{c[x['id']]['valor']:g}"
        nm = {x["cita"]["texto"] for x in m["no_medidos"]}
        assert nm == {x["cita"] for x in cat["mundos"][mundo]["no_medidos"]}
    assert not any(x["id"] == "temp_max_k" for x in indice["mundos"]["moon"]["criterios"])


def test_luna_solo_dentro_de_6_grados_del_polo(indice):
    r = indice["mundos"]["moon"]["rejilla"]
    n = r["n"]
    lat = _capa(r["lat"], (n, n))
    for x in indice["mundos"]["moon"]["criterios"]:
        a = _capa(x["capa"], (n, n))
        assert (np.isfinite(a) == (lat <= -84.0)).all(), x["id"]


def test_luna_la_celda_mas_iluminada_cae_junto_a_un_pico_de_luz(indice):
    r = indice["mundos"]["moon"]["rejilla"]
    n, m, g = r["n"], r["m_por_px"], r["georef"]
    a = _capa("moon/iluminacion.f32", (n, n))
    f, c = np.unravel_index(np.nanargmax(a), a.shape)
    x, y = g["x0_m"] + c * m, g["y0_m"] - f * m
    meta = json.loads((RAIZ / "web/data/terreno/polo_sur/meta.json").read_text(encoding="utf-8"))
    d = [np.hypot(*(np.array(georef.estereo_directa("sur", p["lat"], p["lon"], g["radio_m"])) - [x, y])) / 1000
         for p in meta["picos_luz"]["puntos"]]
    print(f"celda más iluminada a {min(d):.2f} km del pico de luz más cercano")
    assert min(d) < 2.0


def test_marte_fraccion_apta_plausible(indice):
    m = indice["mundos"]["mars"]
    capas = {x["id"]: _capa(x["capa"], (360, 720)) for x in m["criterios"]}
    lat = np.repeat(marte.lat_filas()[:, None], 720, axis=1)
    f = si.fraccion_area(si.aptas(capas, m["criterios"]), lat)
    banda = si.fraccion_area(np.abs(lat) <= 50, lat)
    print(f"fracción de Marte dentro de los límites de NASA: {f:.4f} (banda ±50°: {banda:.4f})")
    assert 0.3 < f < banda


def test_marte_altitud_coincide_con_el_mosaico_mola_463m_del_pipeline(indice):
    rasterio = pytest.importorskip("rasterio")
    from rasterio.windows import Window

    from pipeline.cuerpos.dem import MOLA463
    if not MOLA463.exists():
        pytest.skip("sin el mosaico MOLA 463 m")
    alt = _capa("mars/altitud_m.f32", (360, 720))
    assert -8177 <= np.nanmin(alt) and np.nanmax(alt) <= 21171
    g = np.random.default_rng(0)
    d = []
    with rasterio.open(MOLA463) as r:
        k = round(r.width / 360) // 2
        for f, c in zip(g.integers(20, 340, 25), g.integers(0, 720, 25)):
            z = r.read(1, window=Window(c * k, f * k, k, k)).astype(float)
            z[z == r.nodata] = np.nan
            d.append(np.nanmean(z) - alt[f, c])
    d = np.abs(d)
    assert np.median(d) < 10 and d.max() < 50, d


def test_regenerar_dos_veces_da_los_mismos_bytes_que_lo_publicado(indice, tmp_path):
    if not (marte.MEGDR.exists() and marte.ODYSSEY.exists()):
        pytest.skip("sin datos crudos de Marte")
    a, b = tmp_path / "a", tmp_path / "b"
    si.main([], salida=a)
    si.main([], salida=b)
    ficheros = sorted(p.relative_to(a) for p in a.rglob("*") if p.is_file())
    assert ficheros == sorted(p.relative_to(b) for p in b.rglob("*") if p.is_file())
    assert ficheros == sorted(p.relative_to(SALIDA) for p in SALIDA.rglob("*") if p.is_file())
    for p in ficheros:
        assert (a / p).read_bytes() == (b / p).read_bytes() == (SALIDA / p).read_bytes(), p
