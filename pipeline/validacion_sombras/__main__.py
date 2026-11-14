"""V1: métricas y figuras a partir de build/validacion_sombras/<id>/modelo.f32 (lo escribe scripts/validar_sombras.mjs)."""
import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import LogNorm
from matplotlib.patches import Rectangle

from pipeline.terreno.escritura import escribir_json
from pipeline.validacion_sombras import metricas

RAIZ = Path(__file__).resolve().parents[2]
BUILD = RAIZ / "build" / "validacion_sombras"
MARGEN_M = 30000.0
COMANDO = "node scripts/validar_sombras.mjs"

OFICIAL = {
    "iluminacion": {
        "producto": "AVGVISIB_85S_060M_201608",
        "etiqueta": "http://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/AVGVISIB_85S_060M_201608.LBL",
        "cita_etiqueta": ["indicate the percentage of timesteps where each pixel was sunlit (by any fraction of the solar disc)",
                          "The calculations are based on the LOLA elevation map LDEM_85S_060M and are described in [MAZARICOETAL2011]"],
        "pagina": "https://pgda.gsfc.nasa.gov/products/69",
        "cita_pagina": ["computed the illumination conditions at the lunar poles over an entire lunar nutation cycle (~18.6 years) with a timestep of one hour",
                        "Because our light source is not a point but rather a finite disc"],
    },
    "sombra_permanente": {
        "producto": "LPSR_85S_060M_201608",
        "etiqueta": "http://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/LPSR_85S_060M_201608.LBL",
        "cita_etiqueta": ["The values are binary, indicating whether a pixel is in permanent shadow (1) or not (0)."],
    },
}
SUPUESTOS = [
    {"origen": "mío", "texto": "Subsolar longitude uniform and subsolar latitude arcsine-distributed (δ = ε·sin φ, φ uniform), independent of each other, over the 18.6-year average."},
    {"origen": "mío", "texto": "Earth-Moon parallax of the Sun (~0.15°), librations and Sun-distance changes ignored; apparent solar radius fixed at 1919″/2 (NASA Sun Fact Sheet, 1 AU)."},
    {"origen": "mío", "texto": "Sun below the tangent plane of the crop centre: sombras() clamps elevation to 0, so the terrain is tilted toward the Sun by tan|el| and sombras() is called at elevation 0 (equivalence tested for el > 0)."},
]
FUENTES_PARAMETROS = {
    "oblicuidad": ["https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html (Obliquity to orbit 6.68 − Inclination to ecliptic 5.145 = 1.535°)",
                   "https://en.wikipedia.org/wiki/Moon (\"axial tilt with respect to the ecliptic is 1.5427°\")"],
    "radioSol": ["https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html (Apparent diameter from Earth at 1 A.U. 1919 arcsec)"],
}


def leer(id_):
    d = RAIZ / "web" / "data" / "terreno" / id_
    meta = json.loads((d / "meta.json").read_text())
    n = meta["n"]
    info = json.loads((BUILD / id_ / "modelo.json").read_text())
    mod = np.fromfile(BUILD / id_ / "modelo.f32", "<f4").reshape(n, n)
    ilu = np.fromfile(d / "iluminacion.f32", "<f4").reshape(n, n)
    psr = np.fromfile(d / "sombra_permanente.u8", "u1").reshape(n, n)
    return meta, info, mod, ilu, psr


def evaluar(mod, ilu, psr, dentro):
    return {"iluminacion": metricas.continuas(mod, ilu, dentro),
            "sombra_permanente": metricas.binarias(mod == 0, psr, dentro)}


def figuras(id_, meta, mod, ilu, dentro, margen_m, res):
    out = BUILD / id_
    lado = meta["lado_km"]
    ext = [-lado / 2, lado / 2, -lado / 2, lado / 2]
    rot = f"{id_} ({lado:g} km, {meta['m_por_px']:.0f} m/px)"

    def mapa(a, titulo, fichero, **kw):
        fig, ax = plt.subplots(figsize=(7, 6))
        im = ax.imshow(a, extent=ext, interpolation="nearest", **kw)
        if margen_m > 0:
            s = lado - 2 * margen_m / 1000
            ax.add_patch(Rectangle((-s / 2, -s / 2), s, s, fill=False, ls="--", ec="k", lw=1))
        ax.set_xlabel("km (right = 90° E)"); ax.set_ylabel("km (up = 0° E)")
        ax.set_title(titulo, fontsize=10)
        fig.colorbar(im, ax=ax, shrink=0.85)
        fig.tight_layout(); fig.savefig(out / fichero, dpi=130); plt.close(fig)

    mapa(mod, f"Viewer shadow model, mean illuminated fraction\n{rot}", "modelo.png", cmap="gray", vmin=0, vmax=1)
    mapa(ilu, f"Official LOLA AVGVISIB_85S_060M_201608 (resampled)\n{rot}", "oficial.png", cmap="gray", vmin=0, vmax=1)
    mapa(mod - ilu, f"Model − official\n{rot}" + ("; dashed = 30 km margin excluded" if margen_m else ""),
         "diferencia.png", cmap="RdBu_r", vmin=-0.5, vmax=0.5)
    k = dentro & np.isfinite(mod) & np.isfinite(ilu)
    m = res["iluminacion"]
    fig, ax = plt.subplots(figsize=(6, 6))
    _, _, _, im = ax.hist2d(ilu[k], mod[k], bins=100, range=[[0, 1], [0, 1]], norm=LogNorm(), cmap="viridis")
    ax.plot([0, 1], [0, 1], "r--", lw=1)
    ax.set_xlabel("official mean illumination"); ax.set_ylabel("model mean illuminated fraction")
    ax.set_title(f"{rot}\nPearson {m['pearson']:.3f} · Spearman {m['spearman']:.3f} · MAE {m['error_abs_medio']:.3f} · bias {m['sesgo_medio']:+.3f}", fontsize=9)
    fig.colorbar(im, ax=ax, label="cells")
    fig.tight_layout(); fig.savefig(out / "dispersion.png", dpi=130); plt.close(fig)


def main(ids):
    terrenos, datos = {}, {}
    for id_ in ids:
        meta, info, mod, ilu, psr = leer(id_)
        lado_m = meta["n"] * meta["m_por_px"]
        margen = MARGEN_M if MARGEN_M < lado_m / 2 else 0.0
        dentro = metricas.mascara_borde(meta["n"], meta["m_por_px"], margen)
        res = evaluar(mod, ilu, psr, dentro)
        figuras(id_, meta, mod, ilu, dentro, margen, res)
        terrenos[id_] = {
            "rol": "primary" if id_ == "polo_sur" else "secondary: no relief outside the crop, so no far horizon",
            "lado_km": meta["lado_km"], "m_por_px": meta["m_por_px"], "margen_borde_m": margen,
            "centro_rejilla": info["centro_rejilla"], "sha256": info["sha256"],
            "elevacion_pasada_deg": info["elevacion_pasada_deg"], "segundos_calculo": info["segundos"],
            "metricas": res,
            "figuras": [f"build/validacion_sombras/{id_}/{f}" for f in ("modelo.png", "oficial.png", "diferencia.png", "dispersion.png")],
        }
        datos[id_] = (meta, info, mod, ilu, psr)
    if "polo_sur" in datos and "shackleton" in datos:
        meta, _, mod, ilu, psr = datos["polo_sur"]
        k = metricas.huella(meta, datos["shackleton"][0])
        terrenos["polo_sur_en_huella_shackleton"] = {
            "rol": "secondary: polo_sur model (with far horizon, 146 m/px) restricted to the shackleton footprint",
            "metricas": evaluar(mod, ilu, psr, k)}
    info0 = next(iter(datos.values()))[1]
    r = {
        "pregunta": "Does the viewer's cast-shadow model (web/terreno/calculo.js), averaged over all Sun positions, reproduce the official LOLA mean illumination and permanent-shadow maps?",
        "protocolo": "pipeline/validacion_sombras/PROTOCOLO.md",
        "oficial": OFICIAL,
        "parametros": {**info0["parametros"], "unidades": {"pasoAz": "deg of subsolar longitude", "oblicuidad": "deg", "radioSol": "deg"},
                       "fuentes": FUENTES_PARAMETROS, "margen_borde_m": MARGEN_M,
                       "nunca_iluminada": "model fraction == 0 over all samples", "sesgo": "model − official"},
        "supuestos": SUPUESTOS,
        "terrenos": terrenos,
        "comando": COMANDO,
    }
    r = metricas.sin_nan(r)
    escribir_json(BUILD / "resultado.json", r)
    escribir_json(RAIZ / "web" / "data" / "validacion_sombras.json", r)
    for id_, t in terrenos.items():
        i, s = t["metricas"]["iluminacion"], t["metricas"]["sombra_permanente"]
        print(f"{id_}: pearson {i['pearson']} spearman {i['spearman']} mae {i['error_abs_medio']} sesgo {i['sesgo_medio']} "
              f"| psr precision {s['precision']} exhaustividad {s['exhaustividad']} iou {s['iou']} ({s['modelo']} vs {s['oficial']} celdas)")


if __name__ == "__main__":
    main(sys.argv[1:] or ["polo_sur", "shackleton"])
