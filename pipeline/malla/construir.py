"""Construye build/malla_vN.nc por pasos. Uso: python -m pipeline.malla.construir 1 [2 ...]"""
import os
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import xarray as xr

from pipeline.malla import clima, frio, rejilla, salida

RAIZ = Path(__file__).resolve().parents[2]
BUILD = RAIZ / "build"
CACHE = BUILD / "malla" / "cache"
DATOS = Path(os.environ.get("AZ_DATOS", "/home/ale/nasa-space-apps-2026/datos")) / "raw"

URL_POWER = "https://power.larc.nasa.gov"
URL_GMTED30 = "https://edcintl.cr.usgs.gov/downloads/sciweb1/shared/topo/downloads/GMTED/Grid_ZipFiles/mn30_grd.zip"
CLIMA_ZARR = DATOS / "power/merra2/spatial/power_merra2_climatology_spatial_utc.zarr"
SYN_ZARR = DATOS / "power/syn1deg/spatial/power_syn1deg_climatology_spatial_utc.zarr"
DIARIO_ZARR = DATOS / "power/merra2/spatial/power_merra2_daily_spatial_utc.zarr"


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def _extrae(zip_, nombre):
    destino = CACHE / nombre
    if not (destino / ".ok").exists():
        destino.mkdir(parents=True, exist_ok=True)
        subprocess.run(["unzip", "-q", "-o", str(zip_), "-d", str(destino)], check=True)
        (destino / ".ok").touch()
    return destino


def _solo_tierra(a, tierra):
    a = np.asarray(a, dtype=np.float32).copy()
    a[~(tierra > 0)] = np.nan
    return a


def mascara_y_elevacion():
    """GMTED 30″ (océano = 0): fracción de píxeles ≠ 0 y elevación media de esos píxeles."""
    import rasterio
    from rasterio.windows import Window

    ruta = _extrae(DATOS / "gmted/mn30_grd.zip", "gmted30") / "mn30_grd"
    k = 60
    with rasterio.open(ruta) as r:
        assert abs(r.res[0] - 1 / 120) < 1e-6 and r.width == 360 * 120
        lat_norte = round(r.bounds.top * 2) / 2
        filas_f, filas_m = [], []
        for f0 in range(0, r.height, k):
            z = r.read(1, window=Window(0, f0, r.width, k)).astype(np.float32)
            z[z == r.nodata] = np.nan
            tierra = np.where(np.isfinite(z), (z != 0).astype(np.float32), np.nan)
            z[z == 0] = np.nan
            filas_f.append(rejilla.agrega_bloques(tierra, k)[0])
            filas_m.append(rejilla.agrega_bloques(z, k)[0])
    frac = rejilla.coloca_en_malla(np.vstack(filas_f), lat_norte, -180.0)
    elev = rejilla.coloca_en_malla(np.vstack(filas_m), lat_norte, -180.0)
    frac[np.isnan(frac)] = 0.0  # al norte de 84° GMTED no tiene datos: solo océano
    return frac, elev


def _power(zarr, nombres):
    ds = xr.open_zarr(zarr, decode_times=False)
    return {n: ds[n].values for n in nombres}, ds.lat.values, ds.lon.values, {n: dict(ds[n].attrs) for n in nombres}


def paso1(vars_):
    log("paso 1: máscara GMTED 30″")
    tierra, elev = mascara_y_elevacion()
    vars_["tierra_frac"] = (tierra, {"units": "1", "fuente": URL_GMTED30, "long_name": "fracción de tierra de la celda",
                                     "metodo": "píxeles GMTED2010 30″ con elevación ≠ 0 (océano = 0 en GMTED) / total; al norte de 84° = 0 (GMTED no cubre)"})
    vars_["area_km2"] = (rejilla.area_celda_km2().astype(np.float32),
                         {"units": "km2", "fuente": "mío", "origen": "mío", "long_name": "área de la celda entera (no solo la tierra)",
                          "formula": f"R² · Δλ · (sin φ2 − sin φ1), R = {rejilla.R_TIERRA_KM} km"})
    vars_["elev_m"] = (_solo_tierra(elev, tierra), {"units": "m", "fuente": URL_GMTED30, "long_name": "elevación media de la parte de tierra",
                                                    "metodo": "media de píxeles GMTED2010 30″ con elevación ≠ 0"})

    log("paso 1: POWER climatología")
    c, lat_s, lon_s, at = _power(CLIMA_ZARR, ["T2M", "T2M_RANGE", "PRECTOTCORR", "WS2M"])
    for n, u in [("T2M", "C"), ("T2M_RANGE", "C"), ("PRECTOTCORR", "mm/day"), ("WS2M", "m/s")]:
        assert at[n]["units"] == u, (n, at[n]["units"])
    m = {n: np.stack([rejilla.interp_a_malla(c[n][t], lat_s, lon_s) for t in range(13)]) for n in c}
    s, lat1, lon1, ats = _power(SYN_ZARR, ["ALLSKY_SFC_SW_DWN"])
    assert ats["ALLSKY_SFC_SW_DWN"]["units"] == "W m-2"
    sw = rejilla.interp_a_malla(s["ALLSKY_SFC_SW_DWN"][12], lat1, lon1)

    lat = rejilla.lat_centros()
    ra = np.stack([np.repeat(clima.ra_mj_m2_dia(lat, d)[:, None], rejilla.N_LON, axis=1) for d in clima.DIA_MEDIO_MES])
    et0 = clima.hargreaves_mm_dia(m["T2M"][:12], m["T2M_RANGE"][:12], ra)
    ai, pet, estado = clima.aridez(m["PRECTOTCORR"][:12], et0)
    p_anual = np.sum(m["PRECTOTCORR"][:12] * clima.DIAS_MES[:, None, None], axis=0)

    fp = URL_POWER
    vars_["t_media_c"] = (_solo_tierra(m["T2M"][12], tierra), {"units": "degC", "fuente": fp, "long_name": "temperatura media anual a 2 m",
                                                               "metodo": "POWER MERRA-2 climatología 2001-2020, T2M anual, bilineal a 0,5°"})
    vars_["radiacion_kwh_m2_dia"] = (_solo_tierra(sw * 24 / 1000, tierra), {
        "units": "kWh m-2 day-1", "fuente": fp, "long_name": "radiación solar en superficie horizontal, media anual",
        "metodo": "POWER SYN1deg climatología ALLSKY_SFC_SW_DWN anual (W/m²) × 24/1000, bilineal desde 1°"})
    vars_["precip_mm_ano"] = (_solo_tierra(p_anual, tierra), {"units": "mm year-1", "fuente": fp, "long_name": "precipitación anual",
                                                              "metodo": "Σ PRECTOTCORR mensual (mm/día) × días del mes"})
    vars_["viento_medio_m_s"] = (_solo_tierra(m["WS2M"][12], tierra), {"units": "m s-1", "fuente": fp, "long_name": "viento medio anual a 2 m",
                                                                       "metodo": "POWER WS2M anual"})
    vars_["pet_mm_ano"] = (_solo_tierra(pet, tierra), {
        "units": "mm year-1", "fuente": fp, "long_name": "evapotranspiración potencial anual, Hargreaves",
        "metodo": "FAO-56 ec. 52 por mes: 0,0023·0,408·Ra·(T2M+17,8)·√T2M_RANGE, mínimo 0 cada mes; Ra FAO-56 ec. 21 a mitad de mes; Σ × días"})
    vars_["aridez_ai"] = (_solo_tierra(ai, tierra), {
        "units": "1", "fuente": fp, "long_name": "índice de aridez P/PET (Hargreaves)",
        "metodo": "precip_mm_ano / pet_mm_ano; NaN con estado na si PET anual < 100 mm (frío: la aridez no aplica)"})
    est = np.where(tierra > 0, estado, np.nan).astype(np.float32)
    vars_["aridez_ai_estado"] = (est, {"units": "1", "fuente": fp, "flag_values": "0 1 2", "flag_meanings": "ok na sin_dato",
                                       "long_name": "estado de aridez_ai: 0 ok, 1 na (frío, PET < 100 mm), 2 sin_dato; NaN = océano"})

    lat2d = np.repeat(lat[:, None], rejilla.N_LON, axis=1)
    vars_["elev_solar_max_deg"] = (_solo_tierra(clima.elev_solar_max_deg(lat2d), tierra), {
        "units": "degree", "fuente": "mío", "origen": "mío", "long_name": "elevación máxima anual del Sol a mediodía",
        "formula": "min(90, 90 − |lat| + 23,44); solo latitud"})
    vars_["f_low"] = (_solo_tierra(np.repeat(clima.f_low(lat)[:, None], rejilla.N_LON, axis=1), tierra), {
        "units": "1", "fuente": "mío", "origen": "mío", "long_name": "fracción de horas de sol con elevación < 10°",
        "formula": "año medio, sin atmósfera ni relieve: Σ(h0 − h10)/Σh0, h_e = semiarco diurno con elevación > e; solo latitud (20-metrica §1.2 D3)"})
    return vars_


def _diario(nombre, unidad):
    ds = xr.open_zarr(DIARIO_ZARR, decode_times=False)
    assert ds.time.attrs["units"] == "days since 1980-12-31 00:00:00"
    assert ds[nombre].attrs["units"] == unidad
    i0, i1 = frio.indices_periodo(2011, 2020)
    t = ds.time.values
    assert t[i0] == i0 and t[i1] == i1 and frio.fecha_power(t[i0]).isoformat() == "2011-01-01"
    log(f"leyendo {nombre} diario {frio.fecha_power(t[i0])} … {frio.fecha_power(t[i1])}")
    return ds[nombre].isel(time=slice(i0, i1 + 1)).values, ds.lat.values, ds.lon.values


def paso2(vars_):
    tierra = vars_["tierra_frac"][0]
    tmax, lat_s, lon_s = _diario("T2M_MAX", "C")
    fp = URL_POWER
    for umbral, nombre in [(-23.0, "nv_dias_m23c"), (0.0, "nv_dias_0c")]:
        d = rejilla.interp_a_malla(frio.dias_por_ano(tmax, umbral), lat_s, lon_s)
        vars_[nombre] = (_solo_tierra(d, tierra), {
            "units": "day year-1", "fuente": fp, "long_name": f"días al año con T2M_MAX ≤ {umbral:g} °C",
            "metodo": "POWER MERRA-2 diario T2M_MAX 2011-01-01…2020-12-31 (índice = días desde 1980-12-31), cuenta × 365,25 / días válidos; bilineal a 0,5°"})
    del tmax
    ws, lat_s, lon_s = _diario("WS2M_MAX", "m/s")
    p = frio.p95(ws) if np.isnan(ws).any() else np.percentile(ws, 95, axis=0)
    del ws
    vars_["viento_p95_m_s"] = (_solo_tierra(rejilla.interp_a_malla(p, lat_s, lon_s), tierra), {
        "units": "m s-1", "fuente": fp, "long_name": "percentil 95 del viento máximo diario a 2 m",
        "metodo": "POWER MERRA-2 diario WS2M_MAX 2011-2020, P95 sobre los días; bilineal a 0,5°"})
    c, lat_s, lon_s, at = _power(CLIMA_ZARR, ["T2M_RANGE"])
    assert at["T2M_RANGE"]["cell_methods"] == "time: mean"
    vars_["amplitud_diurna_k"] = (_solo_tierra(rejilla.interp_a_malla(c["T2M_RANGE"][12], lat_s, lon_s), tierra), {
        "units": "K", "fuente": fp, "long_name": "amplitud térmica diaria media (máx − mín horaria)",
        "metodo": "POWER MERRA-2 climatología 2001-2020, T2M_RANGE anual (media de los rangos diarios)"})
    return vars_


L_RUGOSIDAD_M = 600.0
L_RELIEVE_M = 1000.0
RADIO_OBJETIVO_KM = 28.0
URL_GMTED75 = "https://edcintl.cr.usgs.gov/downloads/sciweb1/shared/topo/downloads/GMTED/Grid_ZipFiles/mn75_grd.zip"
URL_LOLA64 = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_64.img"
URL_MOLA463 = "https://planetarymaps.usgs.gov/mosaic/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif"
# Coordenadas: 20-metrica §1.2 (Jezero, Arcadia, Shackleton) y §5.2 (pozo de Tranquillitatis).
OBJETIVOS = {
    "shackleton": ("luna", -89.67, 129.78),
    "tranquillitatis": ("luna", 8.3355, 33.222),
    "jezero": ("marte", 18.38, 77.58),
    "arcadia": ("marte", 47.2, 184.3),
    "meridiani": ("marte", None, None),
}


def rugosidad_tierra():
    import rasterio
    from rasterio.windows import Window

    from pipeline.malla import relieve

    ruta = _extrae(DATOS / "gmted/mn75_grd.zip", "gmted75") / "mn75_grd"
    k, h = 240, 4
    dy = rejilla.R_TIERRA_KM * 1000 * np.radians(7.5 / 3600)
    rug, rel = [], []
    with rasterio.open(ruta) as r:
        assert abs(r.res[0] - 7.5 / 3600) < 1e-9 and r.width == 720 * k and r.height % k == 0
        lat_norte = round(r.bounds.top * 2) / 2
        for b in range(r.height // k):
            f0 = b * k - h
            arriba = max(f0, 0)
            z = r.read(1, window=Window(0, arriba, r.width, min(f0 + k + 2 * h, r.height) - arriba)).astype(np.float32)
            z[(z == r.nodata) | (z == 0)] = np.nan
            if f0 < 0:
                z = np.vstack([np.full((-f0, z.shape[1]), np.nan, np.float32), z])
            if z.shape[0] < k + 2 * h:
                z = np.vstack([z, np.full((k + 2 * h - z.shape[0], z.shape[1]), np.nan, np.float32)])
            rug.append(rejilla.agrega_bloques(relieve.pendiente_diferencial_ns(z, dy, L_RUGOSIDAD_M)[h:-h], k, "mediana")[0])
            rel.append(rejilla.agrega_bloques(relieve.relieve_ns(z, dy, L_RELIEVE_M)[h:-h], k, "mediana")[0])
            if b % 20 == 0:
                log(f"GMTED 7,5″ banda {b}/{r.height // k}")
    return (rejilla.coloca_en_malla(np.vstack(rug), lat_norte, -180.0),
            rejilla.coloca_en_malla(np.vstack(rel), lat_norte, -180.0), dy)


def _ventana_equirect(lat0, lon0, R_km, ppd, lat_arriba, lon_izq, alto, ancho, margen_px):
    """Filas y columnas de un ráster equirrectangular (fila 0 = lat_arriba) que cubren radio + margen."""
    dlat = RADIO_OBJETIVO_KM / (R_km * np.radians(1.0))
    f0 = max(int(np.floor((lat_arriba - (lat0 + dlat)) * ppd)) - margen_px, 0)
    f1 = min(int(np.ceil((lat_arriba - (lat0 - dlat)) * ppd)) + margen_px, alto)
    if abs(lat0) + dlat >= 89.0:
        c0, c1 = 0, ancho
    else:
        dlon = dlat / np.cos(np.radians(abs(lat0) + dlat))
        c0 = int(np.floor((lon0 - dlon - lon_izq) * ppd)) - 1
        c1 = int(np.ceil((lon0 + dlon - lon_izq) * ppd)) + 1
        assert 0 <= c0 and c1 <= ancho, "ventana cruza el borde de longitudes"
    lat = lat_arriba - (np.arange(f0, f1) + 0.5) / ppd
    lon = lon_izq + (np.arange(c0, c1) + 0.5) / ppd
    return slice(f0, f1), slice(c0, c1), lat, lon


def rugosidad_objetivos():
    import rasterio
    from rasterio.windows import Window

    from pipeline.malla import relieve

    R = {"luna": 1737.4, "marte": 3396.19}
    lola = np.memmap(DATOS / "lola/ldem_64.img", dtype="<i2", mode="r", shape=(11520, 23040))
    out = {}
    for oid, (cuerpo, lat0, lon0) in OBJETIVOS.items():
        if lat0 is None:
            out[oid] = {"cuerpo": cuerpo, "estado": "sin_dato",
                        "motivo": "sin coordenada en 20-metrica ni en 27-cierres; no se inventa"}
            continue
        if cuerpo == "luna":
            ppd, dy = 64, R["luna"] * 1000 * np.radians(1 / 64)
            margen = int(np.ceil(max(L_RUGOSIDAD_M, L_RELIEVE_M) / dy)) + 2
            fs, cs, lat, lon = _ventana_equirect(lat0, lon0 % 360, R["luna"], ppd, 90.0, 0.0, 11520, 23040, margen)
            z = lola[fs, cs].astype(np.float32) * 0.5
            dem, url, lon_q = "LOLA LDEM_64 (64 px/°, 473,8 m/px)", URL_LOLA64, lon0 % 360
        else:
            with rasterio.open(DATOS / "mola/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif") as r:
                ppd = round(r.width / 360)
                dy = abs(r.transform.e)
                assert abs(dy - R["marte"] * 1000 * np.radians(1 / ppd)) < 0.01
                margen = int(np.ceil(max(L_RUGOSIDAD_M, L_RELIEVE_M) / dy)) + 2
                lon_q = ((lon0 + 180) % 360) - 180
                fs, cs, lat, lon = _ventana_equirect(lat0, lon_q, R["marte"], ppd, 90.0, -180.0, r.height, r.width, margen)
                z = r.read(1, window=Window(cs.start, fs.start, cs.stop - cs.start, fs.stop - fs.start)).astype(np.float32)
                z[z == r.nodata] = np.nan
            dem, url = "MOLA MGS mosaico global 463 m (128 px/°)", URL_MOLA463
        res = relieve.rugosidad_en_radio(z, lat, lon, lat0, lon_q, R[cuerpo], dy, L_RUGOSIDAD_M, RADIO_OBJETIVO_KM, L_RELIEVE_M)
        out[oid] = {"cuerpo": cuerpo, "lat": lat0, "lon": lon0, "dem": dem, "fuente": url, "m_por_px_ns": round(float(dy), 3),
                    **res, "estado": "ok" if np.isfinite(res["rugosidad_tan"]) else "sin_dato"}
        log(f"objetivo {oid}: rugosidad {res['rugosidad_tan']:.4g}, relieve {res['relieve_m']:.4g} m, {res['n_validos']}/{res['n_pixeles']} px")
    return out


def paso3(vars_):
    import json

    tierra = vars_["tierra_frac"][0]
    log("paso 3: rugosidad de los objetivos (LOLA, MOLA)")
    obj = rugosidad_objetivos()
    log("paso 3: rugosidad y relieve GMTED 7,5″")
    rug, rel, dy = rugosidad_tierra()
    metodo = {"pendiente": f"pendiente diferencial solo norte-sur |s(L) − s(2L)|, L = {L_RUGOSIDAD_M:g} m, muestras a ±L/2 y ±L por interpolación lineal sobre el meridiano",
              "relieve": f"|z(+L/2) − z(−L/2)| norte-sur con L = {L_RELIEVE_M:g} m",
              "tierra": f"mediana por celda de 0,5° sobre GMTED2010 7,5″ ({dy:.1f} m/px N-S); océano (0) y bordes fuera",
              "objetivos": f"píxeles a < {RADIO_OBJETIVO_KM:g} km del punto, mediana con peso cos(lat)"}
    doc = {"version_malla": None, "origen": "mío", "metodo": metodo, "objetivos": obj}
    vars_["rugosidad_tan"] = (_solo_tierra(rug, tierra), {
        "units": "1", "fuente": URL_GMTED75, "long_name": "mediana de la pendiente diferencial norte-sur (tangente)",
        "metodo": metodo["pendiente"] + "; " + metodo["tierra"] + "; GMTED 7,5″ cubre −56° a 84°: fuera, NaN"})
    vars_["relieve_m"] = (_solo_tierra(rel, tierra), {
        "units": "m", "fuente": URL_GMTED75, "origen": "mío", "long_name": "relieve norte-sur a 1 km, mediana de la celda",
        "metodo": metodo["relieve"] + "; " + metodo["tierra"] + "; definición de relieve propia (20-metrica D8 no da fórmula)"})
    return vars_, doc


def _escribe_json(ruta, obj):
    import json
    salida._atomico(ruta, lambda p: p.write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8"))


URL_GLIM = "https://epic.awi.de/id/eprint/31092/1/hartmann-moosdorf_2012.zip"
URL_SOILGRIDS = "https://files.isric.org/soilgrids/latest/data_aggregated/5000m/"
URL_WEISS = "https://doi.org/10.1038/nature25181"
URL_GIBS = "https://wvs.earthdata.nasa.gov/api/v1/snapshot?REQUEST=GetSnapshot&LAYERS=MODIS_Terra_L3_NDVI_16Day&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH=3600&HEIGHT=1800&FORMAT=image/png"
URL_CCI = "https://dap.ceda.ac.uk/neodc/esacci/permafrost/data/permafrost_extent/L4/area4/pp/v05.0/northern_hemisphere/2022/ESACCI-PERMAFROST-L4-PFR-MODISLST_CRYOGRID-AREA4_PP-2022-fv05.0.nc"
GLIM_CLASES = ["su", "vb", "ss", "pb", "sm", "sc", "va", "mt", "pa", "vi", "wb", "py", "pi", "ev", "nd", "ig"]


def _glim():
    import zipfile
    with zipfile.ZipFile(DATOS / "glim/hartmann-moosdorf_2012.zip") as z:
        nombres = [l.split(";")[-1].strip().strip('"') for l in z.read("Classnames.txt").decode().splitlines()[1:] if l.strip()]
        assert nombres == GLIM_CLASES, nombres
        txt = z.read("glim_wgs84_0point5deg.txt.asc").decode().splitlines()
    cab = {l.split()[0].lower(): float(l.split()[1]) for l in txt[:6]}
    assert (cab["ncols"], cab["nrows"], cab["xllcorner"], cab["yllcorner"], cab["cellsize"]) == (720, 360, -180, -90, 0.5)
    a = np.array([l.split() for l in txt[6:] if l.strip()], dtype=np.float32)
    a[a == cab["nodata_value"]] = np.nan
    a[a == GLIM_CLASES.index("nd") + 1] = np.nan
    return a[::-1].copy()


def _soilgrids(nombre):
    # GDAL average sobre la Homolosine interrumpida mete valores en celdas sin dato (Groenlandia): se proyecta cada píxel.
    import pyproj
    import rasterio

    with rasterio.open(DATOS / f"soilgrids/{nombre}_0-5cm_mean_5000.tif") as r:
        a = r.read(1)
        f, c = np.nonzero(a != r.nodata)
        x, y = rasterio.transform.xy(r.transform, f, c)
        lon, lat = pyproj.Transformer.from_crs(r.crs, "EPSG:4326", always_xy=True).transform(np.asarray(x), np.asarray(y))
    return rejilla.media_por_celda(lat, lon, a[f, c].astype(float) / 10.0)


def paso4(vars_):
    tierra = vars_["tierra_frac"][0]
    g = _glim()
    sig = "1 su sedimentos no consolidados; 2 vb volcánica básica; 3 ss sedimentaria siliciclástica; 4 pb plutónica básica; 5 sm sedimentaria mixta; 6 sc carbonatos; 7 va volcánica ácida; 8 mt metamórfica; 9 pa plutónica ácida; 10 vi volcánica intermedia; 11 wb masas de agua; 12 py piroclásticas; 13 pi plutónica intermedia; 14 ev evaporitas; 16 ig hielo y glaciares"
    vars_["litologia_glim"] = (_solo_tierra(g, tierra), {
        "units": "1", "fuente": URL_GLIM, "long_name": "clase de litología GLiM (código, sin escalar)",
        "flag_values": "1 2 3 4 5 6 7 8 9 10 11 12 13 14 16", "flag_meanings": sig,
        "metodo": "GLiM 0,5° tal cual (Hartmann y Moosdorf 2012); 15 nd y −9999 → NaN"})
    vars_["casquete_frac"] = (_solo_tierra(np.where(np.isfinite(g), (g == 16).astype(np.float32), np.nan), tierra), {
        "units": "1", "fuente": URL_GLIM, "long_name": "casquete de hielo (GLiM clase 16 ig)",
        "metodo": "binaria 0/1: GLiM a 0,5° da una clase por celda, no una fracción"})
    vars_["soc_g_kg"] = (_solo_tierra(_soilgrids("soc"), tierra), {
        "units": "g kg-1", "fuente": URL_SOILGRIDS + "soc/soc_0-5cm_mean_5000.tif", "long_name": "carbono orgánico del suelo 0-5 cm",
        "metodo": "SoilGrids 2.0 a 5 km, Homolosine: cada píxel con dato se proyecta a lat/lon y se promedia en su celda de 0,5°; dg/kg ÷ 10"})
    vars_["ph_h2o"] = (_solo_tierra(_soilgrids("phh2o"), tierra), {
        "units": "pH", "fuente": URL_SOILGRIDS + "phh2o/phh2o_0-5cm_mean_5000.tif", "long_name": "pH del suelo en agua 0-5 cm",
        "metodo": "SoilGrids 2.0 a 5 km, Homolosine: cada píxel con dato se proyecta a lat/lon y se promedia en su celda de 0,5°; pH×10 ÷ 10"})
    return vars_


def paso5(vars_):
    import rasterio

    tierra = vars_["tierra_frac"][0]
    with rasterio.open(DATOS / "weiss2018/travel_time_cities_2015_scale025.tif") as r:
        k = round(0.5 / r.res[0])
        assert abs(r.res[0] * k - 0.5) < 1e-9 and r.bounds.left == -180.0
        a = r.read(1).astype(np.float32)
        a[a == r.nodata] = np.nan
        a[a < 0] = np.nan
        lat_norte = r.bounds.top
        px = round(1 / r.res[0])
    m = rejilla.coloca_en_malla(rejilla.agrega_bloques(a, k)[0], lat_norte, -180.0) / 60.0
    vars_["tiempo_ciudad_h"] = (_solo_tierra(m, tierra), {
        "units": "h", "fuente": URL_WEISS, "long_name": "tiempo de viaje a la ciudad más cercana (Weiss 2018), media de la celda",
        "metodo": f"Weiss et al. 2018, versión a 1/{px}° de -60° a 85°; media de los píxeles de la celda; minutos ÷ 60. Fuera de -60…85: NaN"})
    return vars_


def _colormap_ndvi():
    import xml.etree.ElementTree as ET
    raiz = ET.parse(DATOS / "ndvi_gibs/MODIS_NDVI_colormap.xml").getroot()
    rgb, val = [], []
    for e in raiz.iter("ColorMapEntry"):
        if e.get("transparent") == "true" or e.get("nodata") == "true":
            continue
        a, b = (float(x) for x in e.get("value").strip("[)]").split(","))
        rgb.append([int(x) for x in e.get("rgb").split(",")])
        val.append((a + b) / 2)
    return np.array(rgb, dtype=np.float32), np.array(val, dtype=np.float32)


def ndvi_de_png(a, rgb_ref, val_ref):
    """RGBA → NDVI por el color más cercano del colormap; alfa 0 (sin dato o NDVI ≤ 0) → NaN."""
    from scipy.spatial import cKDTree
    out = np.full(a.shape[:2], np.nan, dtype=np.float32)
    opaco = a[..., 3] > 0
    _, idx = cKDTree(rgb_ref).query(a[opaco][:, :3].astype(np.float32))
    out[opaco] = val_ref[idx]
    return out


def paso6(vars_):
    from PIL import Image

    tierra = vars_["tierra_frac"][0]
    rgb, val = _colormap_ndvi()
    pngs = sorted((DATOS / "ndvi_gibs").glob("MODIS_Terra_L3_NDVI_16Day_2023-*.png"))
    assert len(pngs) == 23, len(pngs)
    maximo = None
    for p in pngs:
        v = ndvi_de_png(np.array(Image.open(p).convert("RGBA")), rgb, val)
        maximo = v if maximo is None else np.fmax(maximo, v)
    k = round(maximo.shape[1] / 720)
    assert maximo.shape == (180 * 2 * k, 720 * k)
    m = rejilla.coloca_en_malla(rejilla.agrega_bloques(maximo, k)[0], 90.0, -180.0)
    vars_["ndvi_max"] = (_solo_tierra(m, tierra), {
        "units": "1", "fuente": URL_GIBS, "long_name": "NDVI máximo de 2023 (MODIS Terra 16 días)",
        "metodo": "23 PNG GIBS 0,1° de 2023; color → NDVI por el color más cercano del colormap (centro del intervalo); máximo por píxel; media de los 5 × 5 píxeles de la celda. Transparente (sin dato o NDVI ≤ 0: el PNG no los distingue) → NaN"})
    return vars_


def paso7(vars_):
    tierra = vars_["tierra_frac"][0]
    with xr.open_dataset(DATOS / "cci_permafrost/ESACCI-PERMAFROST-PFR-2022-fv05.0.nc") as ds:
        assert ds.PFR.attrs["units"] == "percent"
        lat = ds.lat.values
        assert lat[0] < lat[-1] and abs(lat[0] - 25.005) < 1e-3 and abs(float(ds.lon.values[0]) + 179.995) < 1e-3
        a = ds.PFR.isel(time=0).values[::-1].astype(np.float32) / 100.0
    k = 50
    m = rejilla.coloca_en_malla(rejilla.agrega_bloques(a, k)[0], 85.0, -180.0)
    vars_["permafrost_frac"] = (_solo_tierra(m, tierra), {
        "units": "1", "fuente": URL_CCI, "long_name": "fracción de permafrost (ESA CCI Permafrost 2022)",
        "metodo": "ESA CCI PFR v5.0 2022, 0,01°, solo 25° N a 85° N; media de los píxeles válidos de la celda; % ÷ 100. Fuera del área cubierta (todo el hemisferio sur incluido): NaN = sin_dato, no 0"})
    return vars_


PASOS = {1: paso1, 2: paso2, 3: paso3, 4: paso4, 5: paso5, 6: paso6, 7: paso7}

CONOCIDAS = {"Yungay": (-24.10, -70.01), "Haughton": (75.38, -89.67), "Lanzarote (Timanfaya)": (28.99, -13.79)}


def filas_conocidas(nc):
    with xr.open_dataset(nc) as ds:
        nombres = [n for n in ds.data_vars if n not in ("area_km2",)]
        lineas = ["| celda | " + " | ".join(nombres) + " |", "|---" * (len(nombres) + 1) + "|"]
        for sitio, (la, lo) in CONOCIDAS.items():
            i, j = rejilla.celda_de(la, lo)
            c = ds.isel(lat=i, lon=j)
            vals = [f"{float(c[n]):.4g}" if np.isfinite(c[n]) else "NaN" for n in nombres]
            lineas.append(f"| {sitio} ({float(c.lat)}, {float(c.lon)}) | " + " | ".join(vals) + " |")
    return "\n".join(lineas)


def main(pasos):
    vars_, version = salida.lee_actual(BUILD)
    for p in pasos:
        t0 = time.time()
        antes = set(vars_)
        r = PASOS[p](dict(vars_))
        vars_, extra = r if isinstance(r, tuple) else (r, None)
        version += 1
        nc = salida.escribe_malla(vars_, version, BUILD)
        if extra is not None:
            extra["version_malla"] = version
            _escribe_json(BUILD / "rugosidad_objetivos.json", extra)
        log(f"paso {p} → {nc.name} ({time.time() - t0:.0f} s)")
        for n in vars_:
            if n not in antes:
                salida.previsualiza(nc, n, BUILD / "malla")


if __name__ == "__main__":
    if sys.argv[1:] == ["celdas"]:
        print(filas_conocidas(BUILD / (BUILD / "malla_actual.txt").read_text().strip()))
    else:
        main([int(a) for a in sys.argv[1:]])
