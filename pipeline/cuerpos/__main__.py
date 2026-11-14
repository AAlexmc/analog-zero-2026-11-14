"""Capas globales de la Tierra, la Luna y Marte para buscar análogos → web/data/cuerpos/. Uso: python -m pipeline.cuerpos [--sin-cache]"""
import json
import sys
from pathlib import Path

import numpy as np
import xarray as xr

from pipeline.cuerpos import dem, insolacion
from pipeline.cuerpos import temperatura as tp
from pipeline.malla.construir import DATOS, L_RELIEVE_M, L_RUGOSIDAD_M, URL_GMTED75, URL_GIBS, URL_POWER
from pipeline.malla.salida import _atomico

RAIZ = Path(__file__).resolve().parents[2]
BUILD = RAIZ / "build"
CACHE = BUILD / "cuerpos" / "cache"
SALIDA = RAIZ / "web" / "data" / "cuerpos"
CATALOGO = RAIZ / "datos_json" / "cuerpos.json"
URL_GMTED30 = "https://edcintl.cr.usgs.gov/downloads/sciweb1/shared/topo/downloads/GMTED/Grid_ZipFiles/mn30_grd.zip"
URL_GLIM = "https://epic.awi.de/id/eprint/31092/1/hartmann-moosdorf_2012.zip"
ANCHO, ALTO, PASO = 720, 360, 0.5
CUERPOS = ("earth", "moon", "mars")
NOMBRES = {"earth": "Earth", "moon": "Moon", "mars": "Mars"}
REGLA_RANGO = "p1–p99 of Earth land ∪ p1–p99 of each target body (cells weighted by area; a constant body counts as its value)"


def lat_filas():
    return 90.0 - PASO / 2 - PASO * np.arange(ALTO)


def catalogo():
    c = {x["id"]: x for x in json.loads(CATALOGO.read_text(encoding="utf-8"))["constantes"]}
    assert all(x.get("verificado") is True for x in c.values())
    return c


def fuente_cita(x, texto=None):
    return {"texto": texto or f"{x['texto']}: {x['valor']:g} {x['unidad']}", "url": x["fuente"], "cita": x["cita"]}


def malla_tierra():
    nombre = (BUILD / "malla_actual.txt").read_text().strip()
    with xr.open_dataset(BUILD / nombre) as ds:
        assert ds.lat.values[0] < ds.lat.values[-1] and ds.sizes["lat"] == ALTO and ds.sizes["lon"] == ANCHO
        assert abs(float(ds.lon.values[0]) + 179.75) < 1e-9
        return {n: ds[n].values[::-1].astype(np.float32) for n in ds.data_vars}


def capas_dem(sin_cache=False):
    """{cuerpo: (rugosidad, relieve, meta)}; la caché depende de L y del DEM."""
    CACHE.mkdir(parents=True, exist_ok=True)
    out = {}
    for cuerpo, f in (("moon", dem.luna), ("mars", dem.marte)):
        ruta = CACHE / f"dem_{cuerpo}_L{L_RUGOSIDAD_M:g}_{L_RELIEVE_M:g}.npz"
        if sin_cache or not ruta.exists():
            rug, rel, meta = f()
            def guarda(p):
                with open(p, "wb") as fh:
                    np.savez(fh, rugosidad_tan=rug, relieve_m=rel, meta=json.dumps(meta))
            _atomico(ruta, guarda)
        with np.load(ruta) as z:
            out[cuerpo] = (z["rugosidad_tan"], z["relieve_m"], json.loads(str(z["meta"])))
    return out


def _percentiles_area(a, mascara=None):
    w = np.repeat(np.cos(np.radians(lat_filas()))[:, None], ANCHO, axis=1)
    ok = np.isfinite(a) & (mascara if mascara is not None else True)
    v, w = a[ok].astype(float), w[ok]
    o = np.argsort(v, kind="stable")
    c = np.cumsum(w[o]) / w.sum()
    return [float(v[o][np.searchsorted(c, q)]) for q in (0.01, 0.99)]


def _r(x):
    return float(f"{x:.6g}")


def rango_ref(valores, tierra):
    por = {}
    for c, v in valores.items():
        if v is None:
            continue
        if np.ndim(v) == 0:
            por[c] = [_r(v), _r(v)]
        else:
            por[c] = [_r(x) for x in _percentiles_area(v, tierra >= 0.5 if c == "earth" else None)]
    return {"min": min(p[0] for p in por.values()), "max": max(p[1] for p in por.values()),
            "origen": "mío", "regla": REGLA_RANGO, "por_cuerpo": por}


def escribe_f32(ruta, a):
    a = np.asarray(a, dtype="<f4")
    assert a.shape == (ALTO, ANCHO), a.shape
    ruta.parent.mkdir(parents=True, exist_ok=True)
    _atomico(ruta, lambda p: p.write_bytes(a.tobytes()))


def parametro(pid, nombre, grupo, unidad, valores, fuentes, definicion, transformacion, reproducible, aviso, tierra,
              rango=None, escribir=True):
    """valores = {cuerpo: ráster 360×720 (fila 0 = norte) | número | None}. Escribe los rásteres y devuelve la ficha."""
    assert transformacion in ("lineal", "log10", "log1p") and set(valores) == set(CUERPOS) == set(fuentes)
    capas, const = {}, {}
    for c in CUERPOS:
        v = valores[c]
        if v is None or np.ndim(v) == 0:
            capas[c], const[c] = None, (None if v is None else float(v))
        else:
            capas[c], const[c] = f"{c}/{pid}.f32", None
            if escribir:
                escribe_f32(SALIDA / capas[c], v)
    rango = rango or rango_ref(valores, tierra)
    if transformacion == "log10":
        assert rango["min"] > 0, (pid, rango)
    if transformacion == "log1p":
        assert rango["min"] >= 0, (pid, rango)
    return {"id": pid, "nombre": nombre, "grupo": grupo, "unidad": unidad,
            "capas": None if all(x is None for x in capas.values()) else capas,
            "constante": None if all(x is None for x in const.values()) else const,
            "fuentes": fuentes, "definicion": definicion, "rango_ref": rango, "transformacion": transformacion,
            "reproducible_en_tierra": reproducible, "aviso": aviso}


def parametros_base(t, d, k):
    tierra = t["tierra_frac"]
    lat = lat_filas()
    banda = lambda q: np.repeat(np.asarray(q, dtype=np.float32)[:, None], ANCHO, axis=1)
    out = []

    dem_txt = {c: f"own computation on {d[c][2]['dem']}, {d[c][2]['m_por_px_ns']} m/px N-S" for c in ("moon", "mars")}
    f_terreno = {"earth": {"texto": "own computation on GMTED2010 7.5″ (231.7 m/px N-S)", "url": URL_GMTED75, "origen": "mío"},
                 "moon": {"texto": dem_txt["moon"], "url": d["moon"][2]["url"], "origen": "mío"},
                 "mars": {"texto": dem_txt["mars"], "url": d["mars"][2]["url"], "origen": "mío"}}
    aviso_dem = ("Same formula, baseline and N-S sampling on the three bodies, but the DEMs have different pixels "
                 "(Earth 231.7 m, Moon 473.8 m, Mars 463.1 m): on the Moon and Mars the samples are interpolated "
                 "between pixels, which can smooth the value. Earth: no data south of 56° S (GMTED 7.5″ coverage).")
    out.append(parametro(
        "rugosidad_tan", "Terrain roughness", "terrain", "1 (tangent)",
        {"earth": t["rugosidad_tan"], "moon": d["moon"][0], "mars": d["mars"][0]}, f_terreno,
        f"Median over the 0.5° cell of the N-S differential slope |s(L) − s(2L)|, L = {L_RUGOSIDAD_M:g} m (Kreslavsky and Head 2000)",
        "log10", True, aviso_dem, tierra))
    out.append(parametro(
        "relieve_m", "Local relief", "terrain", "m",
        {"earth": t["relieve_m"], "moon": d["moon"][1], "mars": d["mars"][1]}, f_terreno,
        f"Median over the 0.5° cell of the N-S height difference |z(+L/2) − z(−L/2)|, L = {L_RELIEVE_M:g} m",
        "log10", True, aviso_dem, tierra))

    s_luna, s_marte = k["irradiancia_moon"]["valor"], k["irradiancia_mars"]["valor"]
    eps_luna = k["oblicuidad_orbita_moon"]["valor"] - k["inclinacion_ecliptica_moon"]["valor"]
    e_t, e_m, eps_m = k["excentricidad_earth"]["valor"], k["excentricidad_mars"]["valor"], k["oblicuidad_mars"]["valor"]
    ins = {"earth": t["radiacion_kwh_m2_dia"],
           "moon": banda(insolacion.kwh_m2_dia(insolacion.media_anual_w_m2(lat, s_luna, eps_luna, e_t))),
           "mars": banda(insolacion.kwh_m2_dia(insolacion.media_anual_w_m2(lat, s_marte, eps_m, e_m)))}
    formula = "own computation from latitude: daily mean on a horizontal plane, averaged over the orbit (uniform in true longitude) × 1/√(1 − e²); × 24 h / 1000"
    out.append(parametro(
        "insolacion_kwh_m2_dia", "Sunlight on a flat surface", "light", "kWh m-2 per 24 h",
        ins,
        {"earth": {"texto": "NASA POWER SYN1deg climatology, ALLSKY_SFC_SW_DWN (surface, all sky), annual mean × 24/1000", "url": URL_POWER},
         "moon": {"texto": f"{formula}; S = {s_luna:g} W/m², obliquity to the ecliptic {eps_luna:.3f}° (6.68 − 5.145), e = {e_t:g} (Earth's orbit)",
                  "url": k["irradiancia_moon"]["fuente"], "origen": "mío",
                  "citas": [k[i]["cita"] for i in ("irradiancia_moon", "oblicuidad_orbita_moon", "inclinacion_ecliptica_moon")] + [k["excentricidad_earth"]["cita"]]},
         "mars": {"texto": f"{formula}; S = {s_marte:g} W/m² (at the semimajor axis), obliquity {eps_m:g}°, e = {e_m:g}",
                  "url": k["irradiancia_mars"]["fuente"], "origen": "mío",
                  "citas": [k[i]["cita"] for i in ("irradiancia_mars", "oblicuidad_mars", "excentricidad_mars", "semieje_mars")]}},
        "Annual mean solar energy reaching a horizontal surface, per 24 hours, at the 0.5° cell",
        "lineal", True,
        "Not the same quantity on the three bodies: Earth is measured at the surface, under clouds and air; the Moon "
        "has no atmosphere, so its value is the surface value but without shadows from relief (polar craters get less); "
        "Mars is computed at the top of the atmosphere, without dust or air. Moon and Mars depend only on latitude.",
        tierra))

    out.append(parametro(
        "ndvi_max", "Vegetation (NDVI)", "biology", "1",
        {"earth": t["ndvi_max"], "moon": 0.0, "mars": 0.0},
        {"earth": {"texto": "NASA GIBS MODIS Terra NDVI 16-day, maximum of 23 images of one year, mean of the cell", "url": URL_GIBS},
         "moon": {"texto": "0 by definition: no vegetation (not a measurement)", "url": None, "origen": "mío"},
         "mars": {"texto": "0 by definition: no vegetation (not a measurement)", "url": None, "origen": "mío"}},
        "Highest vegetation index of the year at the 0.5° cell", "lineal", True,
        "Moon and Mars are set to 0 by definition, not measured. Earth: no data where NDVI ≤ 0 or missing (ice, water): the source image does not tell them apart.",
        tierra))

    out.append(parametro(
        "precip_mm_ano", "Rain and snowfall", "water", "mm/year",
        {"earth": t["precip_mm_ano"], "moon": 0.0, "mars": 0.0},
        {"earth": {"texto": "NASA POWER MERRA-2 climatology, PRECTOTCORR, sum of the monthly means", "url": URL_POWER},
         "moon": {"texto": "0 by definition: no atmosphere, no precipitation (not a measurement)", "url": None, "origen": "mío"},
         "mars": {"texto": "0 by definition: no liquid precipitation counted (not a measurement)", "url": None, "origen": "mío"}},
        "Total precipitation per year at the 0.5° cell", "log1p", True,
        "Moon and Mars are set to 0 by definition. Frost, snowfall of CO₂ or water ice on Mars and ice in polar craters are not counted here. Compared on a log scale, log10(1 + mm/year), so that dryness counts by orders of magnitude (own criterion).",
        tierra))

    g = {c: k[f"gravedad_{c}"] for c in CUERPOS}
    out.append(parametro(
        "gravedad_m_s2", "Gravity", "physics", "m/s2", {c: g[c]["valor"] for c in CUERPOS},
        {c: fuente_cita(g[c]) for c in CUERPOS}, "Mean surface gravity of the whole body", "lineal", False,
        "Cannot be reproduced at a fixed place on Earth.", tierra))
    a_pa = {"mbar": 100.0, "bar": 1e5}
    p = {c: k[f"presion_{c}"] for c in CUERPOS}
    out.append(parametro(
        "presion_superficie_pa", "Air pressure", "physics", "Pa", {c: p[c]["valor"] * a_pa[p[c]["unidad"]] for c in CUERPOS},
        {c: fuente_cita(p[c]) for c in CUERPOS}, "Mean surface pressure of the whole body", "lineal", False,
        "Cannot be reproduced outdoors on Earth (vacuum chambers only). Moon value is the night-time value given by the source.",
        tierra))
    return out


DIVINER = DATOS / "diviner_gcp"
OPENMARS = DATOS / "openmars"
# TS_00…TS_23 (chunk anual 12) del mismo Zarr público de POWER, bajados aparte: el espejo de raw/power no los tiene.
TS_HORAS = DATOS / "power_ts_horas/power_merra2_climatology_spatial_utc.zarr"
URL_TS_HORAS = "https://nasa-power.s3.us-west-2.amazonaws.com/merra2/spatial/power_merra2_climatology_spatial_utc.zarr"
URL_OPENMARS = "https://doi.org/10.21954/ou.rd.24573205.v3"
CITA_OPENMARS = ("Holmes, James; Streeter, Paul; Lewis, Stephen; Patel, Manish; Rajendran, Kylash (2023). "
                 "OpenMARS continuous MY28-35 standard database. The Open University. Dataset.")
ANO_MARTE = 30


def _huella(rutas):
    return json.dumps(sorted((f"{p.parent.name}/{p.name}", p.stat().st_size) for p in rutas))


def _cache_temperatura(nombre, huella, calcula, sin_cache):
    """(máx, mín, media, extra) desde la caché si la huella de los ficheros de entrada coincide."""
    ruta = CACHE / f"temp_{nombre}.npz"
    if not sin_cache and ruta.exists():
        with np.load(ruta) as z:
            if str(z["huella"]) == huella:
                return z["t_max_k"], z["t_min_k"], z["t_media_k"], json.loads(str(z["extra"]))
    mx, mn, me, extra = calcula()
    CACHE.mkdir(parents=True, exist_ok=True)

    def guarda(p):
        with open(p, "wb") as fh:
            np.savez(fh, t_max_k=mx, t_min_k=mn, t_media_k=me, extra=json.dumps(extra), huella=huella)
    _atomico(ruta, guarda)
    return mx, mn, me, extra


def temperaturas(t, sin_cache=False):
    """{cuerpo: (máx, mín, media, extra)} o None con el motivo si falta alguna fuente."""
    tab = sorted(DIVINER.glob("global_cumul_avg_cyl_*_002.tab"))
    lista = OPENMARS / "lista_my30.tsv"
    if len(tab) != 18 or not lista.exists():
        return None, f"Diviner GCP: {len(tab)}/18 bands; OpenMARS list: {lista.exists()}"
    nc = [OPENMARS / l.split("\t")[0] for l in lista.read_text().splitlines() if l.strip()]
    tam = {l.split("\t")[0]: int(l.split("\t")[2]) for l in lista.read_text().splitlines() if l.strip()}
    if any(not p.exists() or p.stat().st_size != tam[p.name] for p in nc) or any(p.stat().st_size != 156211313 for p in tab):
        return None, "source files missing or incomplete"

    def luna():
        mx, mn, me, n = tp.resumen_ciclo(tp.diviner_gcp(DIVINER), tp.MIN_BINS_DIVINER, tp.HUECO_MAX_BINS_DIVINER)
        return mx, mn, me, {"celdas_sin_dato": int(np.isnan(me).sum())}

    def marte():
        ciclo, lat, lon, info = tp.openmars(OPENMARS, lista, ANO_MARTE)
        assert info["pasos_contiguos"] and np.isfinite(ciclo).all(), info
        r = [tp.vecino_a_rejilla(f(ciclo, axis=-1), lat, lon).astype(np.float32) for f in (np.max, np.min, np.mean)]
        return r[0], r[1], r[2], info

    def tierra():
        ciclo = tp.power_ts(TS_HORAS)
        r = [f(ciclo, axis=-1).astype(np.float32) for f in (np.max, np.min, np.mean)]
        fuera = ~(t["tierra_frac"] > 0)
        for a in r:
            a[fuera] = np.nan
        return r[0], r[1], r[2], {}

    return {"earth": _cache_temperatura("earth", _huella(sorted(TS_HORAS.glob("TS_*/12.0.0"))), tierra, sin_cache),
            "moon": _cache_temperatura("moon", _huella(tab) + f"{tp.MIN_BINS_DIVINER},{tp.HUECO_MAX_BINS_DIVINER}", luna, sin_cache),
            "mars": _cache_temperatura("mars", _huella(nc) + str(ANO_MARTE), marte, sin_cache)}, None


def parametros_temperatura(t, temps, k):
    tierra = t["tierra_frac"]
    mars_info = temps["mars"][3]
    fuentes = {
        "earth": {"texto": "NASA POWER MERRA-2 20-year climatology, Earth skin temperature at each UTC hour (TS_00…TS_23, annual), bilinear to 0.5°, + 273.15",
                  "url": URL_TS_HORAS},
        "moon": {"texto": "LRO Diviner Global Cumulative Products (Williams et al. 2017, Icarus 283, 300-325): bolometric brightness "
                          f"temperature tbol in 96 bins of 0.25 h of local time per 0.5° cell; a cell gets a value only with ≥ {tp.MIN_BINS_DIVINER} "
                          f"valid bins and no gap longer than {tp.HUECO_MAX_BINS_DIVINER * 0.25:g} h of local time",
                 "url": k["diviner_gcp"]["fuente"], "citas": [k["diviner_gcp"]["cita"], k["diviner_gcp_sin_dato"]["cita"]]},
        "mars": {"texto": f"OpenMARS reanalysis, surface temperature tsurf, Mars year {ANO_MARTE} ({mars_info['soles']:g} sols, "
                          f"12 steps per sol), 5° grid copied to 0.5° by the nearest node (real resolution 5°). {CITA_OPENMARS} CC BY 4.0",
                 "url": URL_OPENMARS, "citas": [k["openmars_rejilla"]["cita"], k["openmars_tsurf_reanalisis"]["cita"]]},
    }
    aviso = ("Not the same kind of number on the three bodies: Earth is a reanalysis skin temperature (MERRA-2), the Moon is a "
             "measured brightness temperature (Diviner), Mars is a reanalysis model value (OpenMARS, 5° cells, not a direct "
             "measurement). The day is sampled every 1 h (Earth), every 0.25 lunar hour (Moon) and every 2 Martian hours (Mars): "
             "the coarser sampling can miss the peak.")
    defs = {"t_max_k": ("Surface temperature, daily maximum", "Hottest value of the mean daily cycle at the 0.5° cell (each time of day averaged over the whole record)", 0),
            "t_min_k": ("Surface temperature, daily minimum", "Coldest value of the mean daily cycle at the 0.5° cell (each time of day averaged over the whole record)", 1),
            "t_media_k": ("Surface temperature, mean", "Mean of the mean daily cycle at the 0.5° cell", 2)}
    return [parametro(pid, nombre, "temperature", "K", {c: temps[c][i] for c in CUERPOS}, fuentes, definicion, "lineal", True, aviso, tierra)
            for pid, (nombre, definicion, i) in defs.items()]


def parametro_presion(t, k):
    """Presión media anual en superficie: Tierra POWER PS y Marte OpenMARS ps (año 30) por celda; Luna constante de la ficha."""
    from pipeline.malla import rejilla
    from pipeline.malla.construir import CLIMA_ZARR

    lista = OPENMARS / "lista_my30.tsv"
    ds = xr.open_zarr(CLIMA_ZARR, decode_times=False)
    assert ds["PS"].attrs["units"] == "hPa" and ds["PS"].attrs["cell_methods"] == "time: mean"
    ps_t = rejilla.interp_a_malla(ds["PS"].isel(time=12).values * 100.0, ds.lat.values, ds.lon.values)[::-1].copy()
    ps_t[~(t["tierra_frac"] > 0)] = np.nan
    ciclo, lat, lon, info = tp.openmars(OPENMARS, lista, ANO_MARTE, "ps", "Pa")
    assert info["pasos_contiguos"] and np.isfinite(ciclo).all(), info
    ps_m = tp.vecino_a_rejilla(ciclo.mean(axis=-1), lat, lon).astype(np.float32)
    luna = k["presion_moon"]
    return parametro(
        "presion_superficie_pa", "Air pressure", "physics", "Pa",
        {"earth": ps_t, "moon": luna["valor"] * 1e5, "mars": ps_m},
        {"earth": {"texto": "NASA POWER MERRA-2 climatology, surface pressure PS, annual mean, bilinear to 0.5°, hPa × 100", "url": URL_POWER},
         "moon": fuente_cita(luna),
         "mars": {"texto": f"OpenMARS reanalysis, surface pressure ps, Mars year {ANO_MARTE} mean, 5° grid copied to 0.5° by the nearest node. {CITA_OPENMARS} CC BY 4.0",
                  "url": URL_OPENMARS, "citas": [k["openmars_rejilla"]["cita"], k["openmars_tsurf_reanalisis"]["cita"]]}},
        "Annual mean atmospheric pressure at the surface of the 0.5° cell", "lineal", False,
        "Cannot be reproduced outdoors on Earth (vacuum chambers only). Earth and Mars are reanalysis values per cell (Mars at 5°); "
        "the Moon is the single night-time value given by NASA.",
        t["tierra_frac"])


def indice(params, k):
    cuerpos = {c: {"nombre": NOMBRES[c], "radio_km": k[f"radio_medio_{c}"]["valor"], "fuente": fuente_cita(k[f"radio_medio_{c}"])}
               for c in CUERPOS}
    return {
        "rejilla": {"ancho": ANCHO, "alto": ALTO, "paso_deg": PASO, "lat0": 89.75, "lon0": -179.75, "fila0": "norte",
                    "formato": "float32 little-endian, NaN = no data, longitude east positive"},
        "cuerpos": cuerpos,
        "metrica": {"origen": "mío", "doc": "docs/metrica-analogos.md",
                    "desviacion_pct": "min(100, |f(v_Earth) − f(v_target)| / (f(max) − f(min)) × 100), f = transformacion (lineal: v; log10: log10(max(v, min)); log1p: log10(1 + max(v, 0))), [min, max] = rango_ref",
                    "similitud_pct": "100 − desviacion_pct; cell similarity = weighted mean over the used parameters with data; a cell is ranked only if it has data for every used parameter, cells with at least half of them are listed apart as partly compared"},
        "parametros": params,
        "mascara_tierra": "earth/tierra_frac.f32",
        "mascara_casquete": "earth/casquete_frac.f32",
        "mascaras_fuente": {"tierra_frac": {"texto": "GMTED2010 30″: share of pixels with elevation ≠ 0", "url": URL_GMTED30},
                            "casquete_frac": {"texto": "GLiM class 16 (ice and glaciers), 1 = ice cap", "url": URL_GLIM}},
        # Lo escribe `python -m pipeline.clases` a partir de estas capas.
        "clases": "clases.json",
    }


def escribe_indice(idx):
    texto = json.dumps(idx, ensure_ascii=False, indent=1, allow_nan=False) + "\n"
    SALIDA.mkdir(parents=True, exist_ok=True)
    _atomico(SALIDA / "indice.json", lambda p: p.write_text(texto, encoding="utf-8"))


def main(argv):
    k = catalogo()
    t = malla_tierra()
    escribe_f32(SALIDA / "earth/tierra_frac.f32", t["tierra_frac"])
    escribe_f32(SALIDA / "earth/casquete_frac.f32", t["casquete_frac"])
    params = parametros_base(t, capas_dem("--sin-cache" in argv), k)
    temps, motivo = temperaturas(t, "--sin-cache" in argv)
    if temps is None:
        print("temperature not included:", motivo, flush=True)
    else:
        params[2:2] = parametros_temperatura(t, temps, k)
        i = next(j for j, p in enumerate(params) if p["id"] == "presion_superficie_pa")
        params[i] = parametro_presion(t, k)
    from pipeline.cuerpos import tierra_extra
    idx = indice(params, k)
    idx["parametros_tierra"] = tierra_extra.fichas(t, SALIDA)
    escribe_indice(idx)
    for p in params:
        print(p["id"], p["rango_ref"]["min"], p["rango_ref"]["max"], p["rango_ref"]["por_cuerpo"], flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
