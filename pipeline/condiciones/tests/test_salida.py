import json
from pathlib import Path

import numpy as np
import pytest

from pipeline.condiciones import __main__ as cond
from pipeline.condiciones import veredicto as vd
from pipeline.exportar import capas
from pipeline.malla import rejilla

DATOS = Path(__file__).resolve().parents[3] / "datos_json"
LAT = rejilla.lat_centros()[:, None] * np.ones((1, rejilla.N_LON))


def campos_sinteticos():
    # Oscuridad de juguete: 12 h hasta el círculo polar, 3000 h más allá; frío 190 K en todas partes.
    osc = np.where(np.abs(LAT) > 66.56, 3000.0, 12.0)
    tiempo = np.full(LAT.shape, 5.0)
    tiempo[0, 0] = 400.0
    tiempo[1, 0] = np.nan
    return {"oscuridad_max_h": osc, "sol_rasante_h_ano": np.full(LAT.shape, 200.0),
            "t_min_alcanzable_k": np.full(LAT.shape, 190.0), "tiempo_ciudad_h": tiempo}


@pytest.fixture(scope="module")
def catalogo():
    eq = json.loads((DATOS / "equipo.json").read_text(encoding="utf-8"))["equipos"]
    si = json.loads((DATOS / "sitios_ensayo.json").read_text(encoding="utf-8"))["sitios"]
    return eq, si


def test_png_de_condiciones_sigue_el_contrato(tmp_path):
    campos = campos_sinteticos()
    tierra = np.ones(LAT.shape, bool)
    tierra[180, 360] = False
    canales = cond.escribe_capas(campos, tierra, tmp_path)
    a, b = capas.lee_png(tmp_path / "cond_a.png"), capas.lee_png(tmp_path / "cond_b.png")
    assert a.shape == (360, 720, 4) and (a[..., 3] == 255).all() and (b[..., 3] == 255).all()
    assert (a[359 - 180, 360, :3] == 255).all()
    c = canales["cond_a.png"][0]
    # fila 0 del PNG = norte: 3000 h; centro: 12 h
    assert c["offset"] + a[0, 0, 0] * c["scale"] == pytest.approx(3000, abs=c["scale"] / 2)
    assert c["offset"] + a[180, 0, 0] * c["scale"] == pytest.approx(12, abs=c["scale"] / 2)
    t = canales["cond_a.png"][2]
    assert t["offset"] + a[100, 5, 2] * t["scale"] == pytest.approx(190, abs=t["scale"] / 2)
    acc = canales["cond_b.png"][0]
    assert acc.get("recortado") is True and b[359, 0, 0] == 250 and b[358, 0, 0] == 255
    assert (b[..., 1:3] == 255).all() and canales["cond_b.png"][1]["vacio"]
    assert not list(tmp_path.glob("*.tmp"))


def test_evalua_el_catalogo_real(catalogo):
    eq, si = catalogo
    campos = campos_sinteticos()
    tierra = np.ones(LAT.shape, bool)
    celdas = vd.sitios_en(si, campos, tierra)
    out = {e["id"]: e for e in cond.evalua(eq, si, campos, tierra, np.cos(np.radians(LAT)), celdas)}
    ltv = {r["variable"]: r for r in out["ltv"]["requisitos"]}
    s = ltv["horas_en_sombra"]
    assert s["veredicto_global"] == "reaches" and s["fuente"] == "https://www.nasa.gov/moonbase-systems/"
    assert s["cita"].startswith("these early LTV concepts") and s["prueba"] == "Continuous darkness ≥ 150 h"
    assert s["lat_umbral"]["norte"] == pytest.approx(66.6, abs=0.1) and s["lat_umbral"]["sur"] == pytest.approx(-66.6, abs=0.1)
    hau = next(x for x in s["sitios"] if x["id"] == "haughton")
    sp = next(x for x in s["sitios"] if x["id"] == "sp_crater")
    assert hau["veredicto"] == "reaches" and sp["veredicto"] == "partial" and sp["fraccion"] == pytest.approx(12 / 150)
    assert ltv["pendiente_deg"]["tratamiento"] == "terreno" and "veredicto_global" not in ltv["pendiente_deg"]
    viper = out["viper"]["requisitos"]
    frio = next(r for r in viper if r["variable"] == "temp_k" and r["op"] == ">=")
    assert frio["veredicto_global"] == "not_reachable" and frio["lat_umbral"] is None
    assert [x["id"] for x in frio["laboratorios"]] == ["glenn_camara_polar"] and "chamber only" in frio["camara"]
    assert all(x["veredicto"] == "not_reachable" for x in frio["sitios"] if x.get("valor") is not None)
    assert next(r for r in viper if r["variable"] == "temp_k" and r["op"] == "<=")["tratamiento"] == "no_evaluado"
    pista = {r["variable"]: r for r in out["pista_aterrizaje"]["requisitos"]}
    assert pista["separacion_m"]["tratamiento"] == "terreno" and pista["separacion_m"]["valor"] is None
    assert out["flip"]["requisitos"] == []
