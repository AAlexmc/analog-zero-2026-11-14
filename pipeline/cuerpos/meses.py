"""Capas mensuales de la Tierra (climatología por mes del calendario) → web/data/cuerpos/earth/mes/<id>.i16 + indice[...]["meses"].
Mismas fuentes, remuestreo, máscara y reglas de «sin dato» que la capa anual; el índice 12 de cada capa es la anual con el mismo código."""
import json

import numpy as np
import xarray as xr

from pipeline.cuerpos import __main__ as cu
from pipeline.cuerpos import temperatura as tp
from pipeline.malla import rejilla
from pipeline.malla.construir import CLIMA_ZARR, SYN_ZARR, URL_POWER
from pipeline.malla.salida import _atomico

IDS = ["t_max_k", "t_min_k", "t_media_k", "insolacion_kwh_m2_dia", "precip_mm_ano",
       "viento_medio_m_s", "amplitud_diurna_k"]
SIN_DATO = -32768
CODIGOS = 32767
DIAS_ANO = 365.0

CLIMA = "Climatology: the mean of this calendar month over many years, not one particular year."
FICHAS = {
    "t_max_k": ("NASA POWER MERRA-2 20-year climatology, Earth skin temperature at each UTC hour (TS_00…TS_23) of this calendar month, "
                "bilinear to 0.5°, + 273.15; hottest hour of the month's mean daily cycle", cu.URL_TS_HORAS, CLIMA),
    "t_min_k": ("NASA POWER MERRA-2 20-year climatology, Earth skin temperature at each UTC hour (TS_00…TS_23) of this calendar month, "
                "bilinear to 0.5°, + 273.15; coldest hour of the month's mean daily cycle", cu.URL_TS_HORAS, CLIMA),
    "t_media_k": ("NASA POWER MERRA-2 20-year climatology, Earth skin temperature at each UTC hour (TS_00…TS_23) of this calendar month, "
                  "bilinear to 0.5°, + 273.15; mean of the month's mean daily cycle", cu.URL_TS_HORAS, CLIMA),
    "insolacion_kwh_m2_dia": ("NASA POWER SYN1deg climatology, ALLSKY_SFC_SW_DWN (surface, all sky), mean of this calendar month × 24/1000",
                              URL_POWER, CLIMA),
    "precip_mm_ano": ("NASA POWER MERRA-2 climatology, PRECTOTCORR, mean of this calendar month (mm/day) × 365", URL_POWER,
                      CLIMA + " The month's rate is written as mm/year (mm/day × 365) so that the unit and the comparison range are "
                              "those of the yearly value: it is not the month's total."),
    "viento_medio_m_s": ("NASA POWER MERRA-2 climatology, WS2M, mean of this calendar month, bilinear to 0.5°", URL_POWER, CLIMA),
    "amplitud_diurna_k": ("NASA POWER MERRA-2 20-year climatology, T2M_RANGE, mean of this calendar month, bilinear to 0.5°", URL_POWER,
                          CLIMA + " Air at 2 m, not the ground surface."),
}


def _escala(x):
    """Menor número de 3 cifras significativas ≥ x."""
    m = 10.0 ** (np.floor(np.log10(x)) - 2)
    return float(f"{np.ceil(x / m - 1e-9) * m:.3g}")


def cuantiza(a):
    """(12, alto, ancho) float → (int16, escala, desplazamiento): valor = entero × escala + desplazamiento; NaN → SIN_DATO."""
    a = np.asarray(a, dtype=np.float64)
    ok = np.isfinite(a)
    lo, hi = float(a[ok].min()), float(a[ok].max())
    escala = _escala(max(hi - lo, 1e-12) / (2 * CODIGOS))
    desp = lo + CODIGOS * escala
    k = np.rint((np.where(ok, a, desp) - desp) / escala)
    assert k.min() >= -CODIGOS and k.max() <= CODIGOS, (k.min(), k.max())
    return np.where(ok, k, SIN_DATO).astype(np.int16), escala, desp


def decodifica(q, escala, desplazamiento):
    q = np.asarray(q)
    return np.where(q == SIN_DATO, np.nan, q.astype(np.float64) * escala + desplazamiento)


def _ts_mensuales():
    return [cu.TS_HORAS / f"TS_{h:02d}" / f"{m}.0.0" for h in range(24) for m in range(12)]


def fuentes_completas():
    return all(p.exists() for p in _ts_mensuales())


def _huella():
    rutas = _ts_mensuales()
    for z, vs in ((CLIMA_ZARR, ("PRECTOTCORR", "WS2M", "T2M_RANGE")), (SYN_ZARR, ("ALLSKY_SFC_SW_DWN",))):
        rutas += [z / v / f"{t}.0.0" for v in vs for t in range(13)]
    return json.dumps(sorted((f"{p.parent.name}/{p.name}", p.stat().st_size) for p in rutas))


def capas(t):
    """{id: float32 (13, 360, 720) fila 0 = norte}: 0-11 = enero…diciembre, 12 = la anual con el mismo código."""
    fuera = ~(t["tierra_frac"] > 0)

    def power(zarr, nombre, unidad, factor=1.0):
        ds = xr.open_zarr(zarr, decode_times=False)
        assert ds[nombre].attrs["units"] == unidad and list(ds.time.values) == list(range(1, 14)), nombre
        c = ds[nombre].values
        a = np.stack([rejilla.interp_a_malla(c[i], ds.lat.values, ds.lon.values)[::-1] for i in range(13)]) * np.float32(factor)
        a = a.astype(np.float32)
        a[:, fuera] = np.nan
        return a

    out = {}
    ciclos = [tp.power_ts(cu.TS_HORAS, i) for i in range(13)]
    for pid, f in (("t_max_k", np.max), ("t_min_k", np.min), ("t_media_k", np.mean)):
        a = np.stack([f(c, axis=-1).astype(np.float32) for c in ciclos])
        a[:, fuera] = np.nan
        out[pid] = a
    del ciclos
    out["insolacion_kwh_m2_dia"] = power(SYN_ZARR, "ALLSKY_SFC_SW_DWN", "W m-2")
    # Como la anual (construir.paso1): (W/m² en float32) × 24 / 1000.
    out["insolacion_kwh_m2_dia"] = (out["insolacion_kwh_m2_dia"] * 24 / 1000).astype(np.float32)
    out["precip_mm_ano"] = power(CLIMA_ZARR, "PRECTOTCORR", "mm/day", DIAS_ANO)
    out["viento_medio_m_s"] = power(CLIMA_ZARR, "WS2M", "m/s")
    out["amplitud_diurna_k"] = power(CLIMA_ZARR, "T2M_RANGE", "C")
    return {pid: out[pid] for pid in IDS}


def capas_cache(t, sin_cache=False):
    ruta = cu.CACHE / "meses.npz"
    huella = _huella()
    if not sin_cache and ruta.exists():
        with np.load(ruta) as z:
            if str(z["huella"]) == huella:
                return {pid: z[pid] for pid in IDS}
    c = capas(t)
    cu.CACHE.mkdir(parents=True, exist_ok=True)

    def guarda(p):
        with open(p, "wb") as fh:
            np.savez(fh, huella=huella, **c)
    _atomico(ruta, guarda)
    return c


def ficha(pid, escala, desplazamiento):
    texto, url, aviso = FICHAS[pid]
    return {"earth": f"earth/mes/{pid}.i16", "escala": escala, "desplazamiento": desplazamiento, "sin_dato": SIN_DATO,
            "fuente": {"texto": texto, "url": url}, "aviso": aviso}


def anade(idx, capas_mes, salida, escribir=True):
    """Escribe earth/mes/<id>.i16 (12 meses seguidos, int16 little-endian) y añade `meses` a las fichas de esos ids."""
    for p in idx["parametros"] + idx.get("parametros_tierra", []):
        if p["id"] not in capas_mes:
            continue
        q, escala, desp = cuantiza(capas_mes[p["id"]][:12])
        p["meses"] = ficha(p["id"], escala, desp)
        if escribir:
            ruta = salida / p["meses"]["earth"]
            ruta.parent.mkdir(parents=True, exist_ok=True)
            _atomico(ruta, lambda f: f.write_bytes(q.astype("<i2").tobytes()))
