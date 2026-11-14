"""Previsualizaciones PNG para revisar a ojo (build/terreno/)."""
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import LightSource, Normalize
from matplotlib.patches import Circle

from . import georef


def _ejes(meta):
    h = meta["lado_km"] / 2
    return [-h, h, -h, h]


def _rasgos(ax, meta, min_km):
    rej = georef.Rejilla(meta["georef"], meta["n"], meta["m_por_px"], meta["centro"]["lat"], meta["centro"]["lon"])
    h = meta["lado_km"] / 2
    for r in meta.get("rasgos", []):
        if r["diametro_km"] < min_km:
            continue
        x, y = rej.xy_de_latlon(np.array([r["lat"]]), np.array([r["lon"]]))
        cx = (x[0] - meta["georef"]["x0_m"]) / 1000 - h + meta["m_por_px"] / 2000
        cy = (y[0] - meta["georef"]["y0_m"]) / 1000 + h - meta["m_por_px"] / 2000
        ax.add_patch(Circle((cx, cy), r["diametro_km"] / 2, fill=False, ec="cyan", lw=0.8, ls="--"))
        ax.text(cx, cy, r["nombre"], color="cyan", fontsize=7, ha="center", va="center")


def png_altura(z, meta, ruta, min_km_rasgo=None):
    ruta = Path(ruta)
    ruta.parent.mkdir(parents=True, exist_ok=True)
    zz = np.where(np.isnan(z), np.nanmin(z), z)
    norma = Normalize(meta["z_min"], meta["z_max"])
    rgb = LightSource(azdeg=315, altdeg=35).shade(zz, cmap=plt.cm.terrain, norm=norma, vert_exag=1,
                                                  dx=meta["m_por_px"], dy=meta["m_por_px"], blend_mode="overlay")
    fig, ax = plt.subplots(figsize=(8, 7.2), dpi=130)
    ax.imshow(rgb, extent=_ejes(meta), origin="upper")
    if min_km_rasgo is None:
        min_km_rasgo = meta["lado_km"] / 15
    _rasgos(ax, meta, min_km_rasgo)
    ax.set_xlim(_ejes(meta)[:2])
    ax.set_ylim(_ejes(meta)[2:])
    sm = plt.cm.ScalarMappable(norm=norma, cmap=plt.cm.terrain)
    fig.colorbar(sm, ax=ax, label=f"altura (m, {meta['z_referencia']})", shrink=0.85)
    ax.set_xlabel("x (km)")
    ax.set_ylabel("y (km)")
    ejes = "arriba = lon 0°, derecha = 90° E" if meta["georef"]["tipo"] == "estereo_polar" else "arriba = norte"
    ax.set_title(f"{meta['id']}: {meta['lado_km']:g} km, {meta['n']} px, {meta['m_por_px']:.2f} m/px ({ejes})\n"
                 f"{meta['capas']['altura']['fuente'][:90]}", fontsize=8)
    fig.tight_layout()
    tmp = ruta.with_name(ruta.name + ".tmp.png")
    fig.savefig(tmp)
    plt.close(fig)
    tmp.replace(ruta)


def png_capa(z, capa, valores, meta, ruta, cmap="inferno", unidad=""):
    ruta = Path(ruta)
    ruta.parent.mkdir(parents=True, exist_ok=True)
    zz = np.where(np.isnan(z), np.nanmin(z), z)
    gris = LightSource(azdeg=315, altdeg=35).hillshade(zz, vert_exag=1, dx=meta["m_por_px"], dy=meta["m_por_px"])
    fig, ax = plt.subplots(figsize=(8, 7.2), dpi=130)
    ax.imshow(gris, cmap="gray", extent=_ejes(meta), origin="upper")
    im = ax.imshow(valores, cmap=cmap, alpha=0.75, extent=_ejes(meta), origin="upper")
    _rasgos(ax, meta, meta["lado_km"] / 15)
    ax.set_xlim(_ejes(meta)[:2])
    ax.set_ylim(_ejes(meta)[2:])
    fig.colorbar(im, ax=ax, label=f"{capa} ({unidad})", shrink=0.85)
    ax.set_xlabel("x (km)")
    ax.set_ylabel("y (km)")
    ax.set_title(f"{meta['id']}: {capa}\n{meta['capas'][capa]['fuente'][:90]}", fontsize=8)
    fig.tight_layout()
    tmp = ruta.with_name(ruta.name + ".tmp.png")
    fig.savefig(tmp)
    plt.close(fig)
    tmp.replace(ruta)
