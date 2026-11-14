"""Escritura atómica de build/malla_vN.nc, malla_meta.json, malla_actual.txt y previsualizaciones."""
import datetime as dt
import json
import os
from pathlib import Path

import numpy as np
import xarray as xr

from pipeline.malla import rejilla


def _valida(nombre, attrs):
    if not attrs.get("units") or not attrs.get("fuente"):
        raise ValueError(f"{nombre}: falta units o fuente")
    if attrs.get("origen") != "mío" and not str(attrs["fuente"]).startswith("https://"):
        raise ValueError(f"{nombre}: fuente sin URL pública y sin origen mío")


def _atomico(destino, escribe):
    destino = Path(destino)
    tmp = destino.with_name(f".{destino.name}.tmp")
    try:
        escribe(tmp)
        os.replace(tmp, destino)
    finally:
        if tmp.exists():
            tmp.unlink()


def _stats(a, tierra):
    finito = np.isfinite(a)
    en_tierra = tierra > 0
    return {
        "min": float(np.nanmin(a)) if finito.any() else None,
        "max": float(np.nanmax(a)) if finito.any() else None,
        "media": float(np.nanmean(a)) if finito.any() else None,
        "pct_nan_tierra": round(float(100.0 * (~finito & en_tierra).sum() / max(en_tierra.sum(), 1)), 3),
    }


def escribe_malla(variables, version, carpeta):
    carpeta = Path(carpeta)
    carpeta.mkdir(parents=True, exist_ok=True)
    for nombre, (a, attrs) in variables.items():
        _valida(nombre, attrs)
        if np.shape(a) != (rejilla.N_LAT, rejilla.N_LON):
            raise ValueError(f"{nombre}: forma {np.shape(a)}")
    coords = {
        "lat": ("lat", rejilla.lat_centros(), {"units": "degrees_north", "nota": "centro de celda, de sur a norte"}),
        "lon": ("lon", rejilla.lon_centros(), {"units": "degrees_east", "nota": "centro de celda, −180 a 180"}),
    }
    ds = xr.Dataset(
        {n: (("lat", "lon"), np.asarray(a), dict(attrs)) for n, (a, attrs) in variables.items()},
        coords=coords,
        attrs={"version": int(version), "malla": "0,5° × 0,5°, 360 × 720", "sin_dato": "NaN",
               "creado": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")},
    )
    fichero = f"malla_v{version}.nc"
    enc = {n: {"zlib": True, "complevel": 4} for n in variables}
    _atomico(carpeta / fichero, lambda p: ds.to_netcdf(p, encoding=enc, format="NETCDF4"))

    tierra = np.asarray(variables["tierra_frac"][0]) if "tierra_frac" in variables else np.ones((rejilla.N_LAT, rejilla.N_LON))
    meta = {"version": int(version), "fichero": fichero, "creado": ds.attrs["creado"],
            "celdas_con_tierra": int((tierra > 0).sum()), "variables": {}}
    for n, (a, attrs) in variables.items():
        meta["variables"][n] = {**{k: (v.tolist() if isinstance(v, np.ndarray) else v) for k, v in attrs.items()},
                                **_stats(np.asarray(a, dtype=float), tierra)}
    _atomico(carpeta / "malla_meta.json",
             lambda p: p.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8"))
    _atomico(carpeta / "malla_actual.txt", lambda p: p.write_text(fichero + "\n"))
    return carpeta / fichero


def lee_actual(carpeta):
    f = Path(carpeta) / "malla_actual.txt"
    if not f.exists():
        return {}, 0
    nombre = f.read_text().strip()
    with xr.open_dataset(Path(carpeta) / nombre) as ds:
        vars_ = {n: (ds[n].values.astype(ds[n].dtype), dict(ds[n].attrs)) for n in ds.data_vars}
        return vars_, int(ds.attrs["version"])


def previsualiza(nc, variable, carpeta, cmap="viridis"):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    carpeta = Path(carpeta)
    carpeta.mkdir(parents=True, exist_ok=True)
    with xr.open_dataset(nc) as ds:
        da = ds[variable]
        fig, ax = plt.subplots(figsize=(12, 6.4))
        v = da.values.astype(float)
        lims = np.nanpercentile(v, [1, 99]) if np.isfinite(v).any() else (0, 1)
        im = ax.imshow(v, origin="lower", extent=(-180, 180, -90, 90), cmap=cmap, interpolation="nearest",
                       vmin=lims[0], vmax=lims[1])
        cb = fig.colorbar(im, ax=ax, shrink=0.8)
        cb.set_label(f"{da.attrs.get('units', '')} (escala p1-p99)")
        ax.set_title(f"{variable} [{da.attrs.get('units', '')}] · malla v{ds.attrs['version']} · {da.attrs.get('fuente', '')}"[:150], fontsize=9)
        ax.set_xlabel("lon")
        ax.set_ylabel("lat")
        destino = carpeta / f"{variable}.png"
        _atomico(destino, lambda p: fig.savefig(p, dpi=90, bbox_inches="tight", format="png"))
        plt.close(fig)
    return destino
