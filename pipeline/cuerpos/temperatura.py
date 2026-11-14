"""Temperatura de superficie por celda: máximo, mínimo y media del ciclo diario medio (Tierra POWER TS, Luna Diviner GCP, Marte OpenMARS)."""
import warnings
from pathlib import Path

import numpy as np

from pipeline.malla import rejilla

ALTO, ANCHO = 360, 720
BINS_DIVINER = 96
MIN_BINS_DIVINER = 48
HUECO_MAX_BINS_DIVINER = 8
FILAS_DIVINER = 1382400
PASOS_SOL_OPENMARS = 12


def hueco_max(falta):
    """Racha más larga de True en el último eje, circular (el ciclo diario se cierra)."""
    n = falta.shape[-1]
    racha = np.zeros(falta.shape[:-1], np.int32)
    mejor = np.zeros_like(racha)
    for k in range(2 * n):
        racha = np.where(falta[..., k % n], racha + 1, 0)
        np.maximum(mejor, racha, out=mejor)
    return np.minimum(mejor, n)


def resumen_ciclo(t, min_validos, hueco_max_permitido):
    """t[..., k] = temperatura media en el momento k del día (NaN sin dato) → (máx, mín, media, n válidos)."""
    ok = np.isfinite(t)
    n = ok.sum(-1)
    vale = (n >= min_validos) & (hueco_max(~ok) <= hueco_max_permitido)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        mx, mn, me = np.nanmax(t, -1), np.nanmin(t, -1), np.nanmean(t, -1)
    return tuple(np.where(vale, a, np.nan).astype(np.float32) for a in (mx, mn, me)) + (n,)


def lee_diviner(ruta):
    import pandas as pd

    d = pd.read_csv(ruta, usecols=lambda c: c.strip() in ("clon", "clat", "ltim", "tbol"), skipinitialspace=True)
    d.columns = [c.strip() for c in d.columns]
    assert len(d) == FILAS_DIVINER, (ruta, len(d))
    return d["clon"].to_numpy(), d["clat"].to_numpy(), d["ltim"].to_numpy(), d["tbol"].to_numpy()


def diviner_gcp(carpeta):
    """18 bandas de 10° → ciclo de 96 horas locales por celda de 0,5° (fila 0 = norte); −9999 → NaN."""
    ficheros = sorted(Path(carpeta).glob("global_cumul_avg_cyl_*_002.tab"))
    assert len(ficheros) == 18, len(ficheros)
    t = np.full((ALTO, ANCHO, BINS_DIVINER), np.nan, np.float32)
    lleno = np.zeros((ALTO, ANCHO, BINS_DIVINER), bool)
    for f in ficheros:
        clon, clat, ltim, tbol = lee_diviner(f)
        fila = np.rint((89.75 - clat) / 0.5).astype(int)
        col = np.rint((clon + 179.75) / 0.5).astype(int)
        k = np.floor(ltim / 24 * BINS_DIVINER).astype(int)
        assert fila.min() >= 0 and fila.max() < ALTO and col.min() >= 0 and col.max() < ANCHO and k.min() >= 0 and k.max() < BINS_DIVINER
        assert not lleno[fila, col, k].any(), f"celda repetida en {f.name}"
        lleno[fila, col, k] = True
        t[fila, col, k] = np.where(tbol == -9999, np.nan, tbol)
    assert lleno.all()
    return t


def power_ts(zarr, indice_tiempo=12):
    """Ciclo de 24 horas UTC de la temperatura de la piel (TS_00…TS_23; indice_tiempo 0-11 = mes, 12 = anual), K, en la malla 0,5° fila 0 = norte."""
    import xarray as xr

    ds = xr.open_zarr(zarr, decode_times=False)
    horas = []
    for h in range(24):
        v = ds[f"TS_{h:02d}"]
        assert v.attrs["units"] == "C" and v.attrs["cell_methods"] == "time: mean"
        # Un chunk ausente en el Zarr se lee como NaN sin error.
        a = v.isel(time=indice_tiempo).values
        assert np.isfinite(a).all(), f"TS_{h:02d}: faltan datos"
        horas.append(rejilla.interp_a_malla(a, ds.lat.values, ds.lon.values)[::-1] + 273.15)
    return np.stack(horas, axis=-1).astype(np.float32)


def openmars(carpeta, lista, ano=30, variable="tsurf", unidad="K"):
    """`variable` del año marciano `ano` → ciclo medio de 12 pasos por sol en la rejilla de 5° (fila 0 = norte), con su lat y lon."""
    import netCDF4

    esperados = {}
    for linea in Path(lista).read_text().splitlines():
        if linea.strip():
            nombre, _, tam, _ = linea.split("\t")
            esperados[nombre] = int(tam)
    suma = cuenta = None
    vistos, ls = set(), []
    for nombre, tam in sorted(esperados.items()):
        ruta = Path(carpeta) / nombre
        assert ruta.stat().st_size == tam, (nombre, ruta.stat().st_size, tam)
        with netCDF4.Dataset(ruta) as d:
            # Unidades: manual OpenMARS, tabla 3; el atributo UNITS no está en todos los ficheros.
            assert getattr(d[variable], "UNITS", unidad) == unidad and d[variable].dimensions == ("time", "lat", "lon")
            lat, lon = d["lat"][:].data, d["lon"][:].data
            tiempo, my, l_s = d["time"][:].data.astype(float), d["MY"][:].data, d["Ls"][:].data
            sel = np.flatnonzero(my == ano)
            if not len(sel):
                continue
            ts = d[variable][sel, :, :].filled(np.nan).astype(np.float64)
        paso = np.rint(tiempo[sel] * PASOS_SOL_OPENMARS).astype(np.int64)
        assert np.allclose(tiempo[sel] * PASOS_SOL_OPENMARS, paso, atol=0.01)
        nuevos = np.array([p not in vistos for p in paso])
        vistos.update(paso.tolist())
        ls.append(l_s[sel][nuevos])
        ranura = paso[nuevos] % PASOS_SOL_OPENMARS
        if suma is None:
            suma = np.zeros((PASOS_SOL_OPENMARS,) + ts.shape[1:])
            cuenta = np.zeros((PASOS_SOL_OPENMARS,) + ts.shape[1:])
        for r in range(PASOS_SOL_OPENMARS):
            x = ts[nuevos][ranura == r]
            suma[r] += np.nansum(x, axis=0)
            cuenta[r] += np.isfinite(x).sum(axis=0)
    pasos = np.array(sorted(vistos))
    l_s = np.concatenate(ls)
    info = {"pasos": int(len(pasos)), "soles": float(len(pasos) / PASOS_SOL_OPENMARS),
            "pasos_contiguos": bool(np.all(np.diff(pasos) == 1)), "ls_min": float(l_s.min()), "ls_max": float(l_s.max())}
    with np.errstate(invalid="ignore"):
        ciclo = np.moveaxis(suma / cuenta, 0, -1)
    assert lat[0] > lat[-1] and lon[0] < lon[-1]
    return ciclo, lat, lon, info


def vecino_a_rejilla(a, lat_src, lon_src):
    """Rejilla gruesa (lat decreciente, lon creciente, nodos) → 360 × 720 fila 0 = norte por el nodo más próximo."""
    lat = 89.75 - 0.5 * np.arange(ALTO)
    lon = -179.75 + 0.5 * np.arange(ANCHO)
    i = np.abs(lat[:, None] - np.asarray(lat_src)[None, :]).argmin(axis=1)
    dlon = np.abs(((lon[:, None] - np.asarray(lon_src)[None, :]) + 180) % 360 - 180)
    j = dlon.argmin(axis=1)
    return np.asarray(a)[i][:, j]
