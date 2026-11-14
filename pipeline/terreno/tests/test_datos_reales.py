"""Comprobaciones contra los datos reales; se saltan si no están bajados/generados."""
import json

import numpy as np
import pytest

from pipeline.terreno import fuentes, generar, georef

LBL = fuentes.DATOS / "raw" / "lola_polar" / "ldem_85s_20m.lbl"
IMG = LBL.with_suffix(".img")

# IAU (planetarynames.wr.usgs.gov): lat, lon E, diámetro km
CRATERES = {"Shackleton": (-89.67, 129.78, 20.92), "Shoemaker": (-88.137, 45.911, 51.82),
            "Faustini": (-87.1832, 84.3099, 42.48), "Haworth": (-87.45, -5.17, 51.42),
            "de Gerlache": (-88.4849, -88.3447, 32.71), "Sverdrup": (-88.3209, -153.3875, 32.83)}


def _profundidad(dem, x, y, d_km):
    th = np.linspace(0, 2 * np.pi, 72, endpoint=False)
    r = d_km * 500
    borde = np.nanmean(dem.altura_xy(x + r * np.cos(th), y + r * np.sin(th)))
    fondo = np.nanmean(dem.altura_xy(x + 0.15 * r * np.cos(th), y + 0.15 * r * np.sin(th)))
    return borde - fondo


@pytest.mark.skipif(not IMG.exists(), reason="sin LDEM_85S_20M")
def test_lola_orientacion_craters_iau_son_hoyos_y_el_espejo_no():
    dem = fuentes.DemLolaPolar(LBL)
    for nombre, (lat, lon, d) in CRATERES.items():
        x, y = georef.estereo_directa("sur", lat, lon, dem.radio_m)
        assert _profundidad(dem, x, y, d) > 1500, nombre
    # con x en espejo, al menos 4 de 6 dejan de ser hoyos (> 1500 m)
    malos = sum(_profundidad(dem, -georef.estereo_directa("sur", la, lo, dem.radio_m)[0],
                             georef.estereo_directa("sur", la, lo, dem.radio_m)[1], d) < 1500
                for la, lo, d in CRATERES.values())
    assert malos >= 4


def _terreno(id_):
    d = generar.SALIDA / id_
    if not (d / "meta.json").exists():
        pytest.skip(f"{id_} sin generar")
    m = json.loads((d / "meta.json").read_text())
    z = np.fromfile(d / "altura.f32", dtype="<f4").reshape(m["n"], m["n"])
    return m, z


def test_shackleton_hoyo_centrado():
    m, z = _terreno("shackleton")
    n = m["n"]
    f, c = np.mgrid[0:n, 0:n]
    r_km = np.hypot(f - (n - 1) / 2, c - (n - 1) / 2) * m["m_por_px"] / 1000
    fondo = np.nanmean(z[r_km < 2])
    borde = np.nanmean(z[(r_km > 9.5) & (r_km < 11)])
    assert borde - fondo > 3000
    assert np.nanargmin(z) in np.flatnonzero(r_km.ravel() < 4)


def _capa(m, nombre):
    if nombre not in m["capas"]:
        pytest.skip(f"sin capa {nombre}")
    c = m["capas"][nombre]
    dt = "<f4" if c["tipo"] == "float32" else "u1"
    return np.fromfile(generar.SALIDA / m["id"] / c["fichero"], dtype=dt).reshape(m["n"], m["n"])


def _radios_km(m):
    n = m["n"]
    f, c = np.mgrid[0:n, 0:n]
    return np.hypot(f - (n - 1) / 2, c - (n - 1) / 2) * m["m_por_px"] / 1000


def test_shackleton_capas_frente_al_relieve():
    m, z = _terreno("shackleton")
    r = _radios_km(m)
    fondo, borde = r < 3, (r > 9.5) & (r < 11.5)
    il = _capa(m, "iluminacion")
    assert np.nanmax(il[fondo]) == 0.0 and np.nanpercentile(il[borde], 95) > 0.4
    s = _capa(m, "sombra_permanente")
    assert np.all(s[fondo] == 1) and np.mean(s[borde] == 1) < 0.1
    if "temp_max" in m["capas"]:
        t = _capa(m, "temp_max")
        assert np.nanmean(t[fondo]) < 100 < np.nanmean(t[borde])


def test_haughton_sin_nan_y_mar_a_cero():
    m, z = _terreno("haughton")
    assert not np.isnan(z).any()
    assert (z == 0).any() and "0 m" in m["notas"]
    assert m["z_min"] > -50 and m["z_max"] < 1000


def _sitio(id_):
    return next(s for s in generar.cargar_sitios()["sitios"] if s["id"] == id_)


@pytest.mark.skipif(not (fuentes.DATOS / "raw" / "iau" / "MOON_nomenclature_center_pts.zip").exists(), reason="sin IAU")
def test_centros_de_los_sitios_nuevos_salen_del_iau():
    s = _sitio("cresta_shackleton_gerlache")
    assert generar.punto_medio_bordes("Shackleton", "de Gerlache") == (s["lat"], s["lon"])
    sh = next(d for d in generar.registros_iau() if d["clean_name"] == "Shoemaker")
    assert (_sitio("shoemaker")["lat"], _sitio("shoemaker")["lon"]) == (sh["center_lat"], sh["center_lon"])


def test_shoemaker_hoyo_centrado_y_entero():
    m, z = _terreno("shoemaker")
    r = _radios_km(m)
    d = CRATERES["Shoemaker"][2]
    assert not np.isnan(z).any()
    assert np.nanmean(z[(r > 0.45 * d) & (r < 0.55 * d)]) - np.nanmean(z[r < 0.15 * d]) > 1500
    assert m["lado_km"] / 2 - d / 2 > 5


def test_cresta_contiene_los_dos_bordes_iau_y_sus_paredes():
    # sobre la recta entre centros: el borde IAU de cada cráter queda dentro y más alto que la pared 18 km más allá
    m, z = _terreno("cresta_shackleton_gerlache")
    assert not np.isnan(z).any()
    rej = georef.Rejilla(m["georef"], m["n"], m["m_por_px"], m["centro"]["lat"], m["centro"]["lon"])
    xm, ym = rej.xy_de_px((m["n"] - 1) / 2, (m["n"] - 1) / 2)
    for nombre in ("Shackleton", "de Gerlache"):
        lat, lon, d = CRATERES[nombre]
        x, y = rej.xy_de_latlon(np.array([lat]), np.array([lon]))
        dist = np.hypot(x[0] - xm, y[0] - ym)
        u = np.array([x[0] - xm, y[0] - ym]) / dist

        def cota(k_m):
            f, c = rej.px_de_xy(xm + k_m * u[0], ym + k_m * u[1])
            return z[int(round(float(f))), int(round(float(c)))]

        borde = dist - d * 500
        assert borde < m["lado_km"] * 500 - 3000, nombre
        assert cota(borde) - cota(18000) > 500, nombre
