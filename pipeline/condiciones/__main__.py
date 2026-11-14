"""Condiciones de ensayo por requisito → web/data/global/cond_*.png, condiciones.json y build/condiciones/*.png.

No prerregistrado: no usa pesos ni el ranking de parecido. Uso: python -m pipeline.condiciones
"""
import hashlib
import io
import json
from pathlib import Path

import numpy as np

from pipeline.condiciones import astro
from pipeline.condiciones import veredicto as vd
from pipeline.exportar.capas import _json, a_byte, escribe_png
from pipeline.exportar.copiar import _atomico
from pipeline.malla import rejilla

RAIZ = Path(__file__).resolve().parents[2]
ROTULO = "Not part of the pre-registered validation — physical conditions computed from latitude and NASA POWER climate"
URL_POWER = "https://power.larc.nasa.gov"
CANALES = {
    "cond_a.png": [
        {"id": "oscuridad_max_h", "nombre": "continuous darkness (longest run per year)", "unidad": "h", "scale": 18.0, "offset": 0.0,
         "metodo": "Longest continuous run with the Sun's centre below the horizon, from latitude only: Keplerian orbit "
                   "(obliquity 23.44°, eccentricity 0.01671022, longitude of perihelion 102.94719°, tropical year 365.242 d), "
                   "sampled every minute over two years; no refraction, no relief, true solar time.",
         "fuente": astro.FICHA_TIERRA, "origen": "mío", "por_latitud": True},
        {"id": "sol_rasante_h_ano", "nombre": "grazing sun (0°–1.535° elevation)", "unidad": "h/year", "scale": 2.0, "offset": 0.0,
         "metodo": "Hours per year with the Sun's centre between 0° (exclusive) and 1.535°, the highest the Sun gets at the lunar "
                   "south pole (6.68° − 5.145°); daily fraction in closed form integrated over the year every 0.01 d, same orbit, "
                   "no refraction, no relief.",
         "fuente": astro.FICHA_LUNA, "origen": "mío", "por_latitud": True},
        {"id": "t_min_alcanzable_k", "nombre": "coldest air temperature 2001-2020", "unidad": "K", "scale": 0.6, "offset": 150.0,
         "metodo": "Coldest hourly 2 m air temperature 2001-2020 (NASA POWER MERRA-2 climatology, annual T2M_MIN), bilinear from "
                   "0.5° × 0.625° to the 0.5° grid, + 273.15. Air at 2 m, not the ground surface the lunar figures describe.",
         "fuente": URL_POWER},
    ],
    "cond_b.png": [
        {"id": "tiempo_ciudad_h", "nombre": "travel time to the nearest city", "unidad": "h", "scale": 0.4, "offset": 0.0,
         "metodo": "Weiss et al. 2018 travel time, mean of the cell, minutes ÷ 60; no data outside 60° S – 85° N. "
                   "Logistic filter only, with the user's own threshold.",
         "fuente": "https://doi.org/10.1038/nature25181"},
        {"id": "libre", "vacio": True, "unidad": "", "scale": 1, "offset": 0},
        {"id": "libre", "vacio": True, "unidad": "", "scale": 1, "offset": 0},
    ],
}


def _sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def _r(x, nd=2):
    return None if x is None or not np.isfinite(x) else round(float(x), nd)


def t_min_power(zarr):
    import xarray as xr

    ds = xr.open_zarr(zarr, decode_times=False)
    da = ds["T2M_MIN"]
    assert da.attrs["units"] == "C" and ds.sizes["time"] == 13
    periodo = f"{ds.attrs['time_coverage_start'][:4]}-{ds.attrs['time_coverage_end'][:4]}"
    return rejilla.interp_a_malla(da.values[12], ds.lat.values, ds.lon.values).astype(float) + 273.15, periodo


def campos_condicion(datos, t_min_k):
    """Campos en orden de la malla (fila 0 = sur), definidos en toda la rejilla."""
    lat = rejilla.lat_centros()
    fila = lambda v: np.repeat(np.asarray(v, dtype=float)[:, None], rejilla.N_LON, axis=1)  # noqa: E731
    osc = astro.oscuridad_max_h(lat)
    ras = astro.sol_rasante_h(lat)
    return {"oscuridad_max_h": fila(osc), "sol_rasante_h_ano": fila(ras), "t_min_alcanzable_k": t_min_k,
            "tiempo_ciudad_h": np.asarray(datos["tiempo_ciudad_h"], dtype=float)}, {"oscuridad_max_h": osc, "sol_rasante_h_ano": ras}


def escribe_capas(campos, tierra, destino):
    canales = json.loads(json.dumps(CANALES))
    for f, lista in canales.items():
        chans = []
        for c in lista:
            if c.get("vacio"):
                chans.append(np.full(tierra.shape, 255, np.uint8))
                continue
            v = campos[c["id"]]
            chans.append(np.where(tierra, a_byte(v, c["scale"], c["offset"]), 255).astype(np.uint8))
            tope = c["offset"] + 250 * c["scale"]
            c["rango"] = [c["offset"], round(tope, 6)]
            vt = v[tierra & np.isfinite(v)]
            if vt.size and (vt.max() > tope or vt.min() < c["offset"]):
                c["recortado"] = True
        escribe_png(destino / f, *chans)
    return canales


def evalua(equipos, sitios, campos, tierra, peso, sitios_celdas):
    alcanzable = {}
    salida = []
    for e in equipos:
        filas = []
        for k, r in enumerate(e["requisitos"]):
            t = vd.tratamiento(r)
            ent = {"indice": k, **{c: r.get(c) for c in ("variable", "op", "valor", "unidad", "texto", "fuente", "cita", "verificado")},
                   **t}
            if r.get("respecto_a"):
                ent["respecto_a"] = r["respecto_a"]
            if t["tratamiento"] == "condicion" and r.get("valor") is None:
                ent.update(tratamiento="no_evaluado", condicion=None, motivo="limit not public in the catalog")
            if ent["tratamiento"] == "condicion":
                cond, lim = ent["condicion"], float(r["valor"])
                ent["prueba"] = vd.CONDICIONES[cond]["prueba"].format(v=lim)
                ent["sentido"] = vd.CONDICIONES[cond]["sentido"]
                ent.update(vd.resumen(cond, lim, campos[cond], tierra, peso))
                if cond == "oscuridad_max_h" and ent["veredicto_global"] == "reaches":
                    ent["lat_umbral"] = {"norte": astro.lat_umbral(astro.oscuridad_max_h, lim, +1),
                                         "sur": astro.lat_umbral(astro.oscuridad_max_h, lim, -1),
                                         "metodo": "bisection on the latitude function (0.005°); cells whose centre is poleward reach"}
                else:
                    ent["lat_umbral"] = None
                ok = ent["veredicto_global"] == "reaches"
                alcanzable[(e["id"], k)] = ok
                ent["sitios"] = [{"id": s["id"], "nombre": s["nombre"],
                                  **({"valor": None, "motivo": s["motivo"]} if s["valores"] is None else
                                     {"valor": _r(s["valores"].get(cond)), "tierra": s["tierra"],
                                      **vd.veredicto_valor(cond, lim, s["valores"].get(cond), ok)})}
                                 for s in sitios_celdas]
                if ent["veredicto_global"] == "not_reachable":
                    ent["laboratorios"] = vd.laboratorios(sitios, cond)
                    ent["camara"] = "not reachable in the field — chamber only"
            filas.append(ent)
        salida.append({"id": e["id"], "nombre": e["nombre"], "origen": e.get("origen"), "requisitos": filas})
    return salida


def vista(campo, tierra, canal, sitios_celdas, ruta, limites=()):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import LogNorm

    v = np.where(tierra, campo, np.nan)
    fig, ax = plt.subplots(figsize=(14, 7.2))
    ax.imshow(np.where(tierra, 0.8, 1.0), origin="lower", extent=(-180, 180, -90, 90), cmap="gray", vmin=0, vmax=1, interpolation="nearest")
    norma = LogNorm(vmin=10, vmax=np.nanmax(v)) if canal["id"] == "oscuridad_max_h" else None
    im = ax.imshow(np.ma.masked_invalid(v), origin="lower", extent=(-180, 180, -90, 90), cmap="viridis", norm=norma, interpolation="nearest")
    fig.colorbar(im, ax=ax, shrink=0.75, label=f"{canal['nombre']} ({canal['unidad']}){' · log scale' if norma else ''}")
    lat, lon = rejilla.lat_centros(), rejilla.lon_centros()
    for lim in limites:
        cs = ax.contour(lon, lat, np.nan_to_num(campo, nan=-1), levels=[lim], colors="red", linewidths=0.8)
        ax.clabel(cs, fmt=f"{lim:g} {canal['unidad']}", fontsize=7)
    for s in sitios_celdas:
        if s.get("lat") is None:
            continue
        val = s["valores"].get(canal["id"])
        ax.plot(s["lon"], s["lat"], marker="^", color="red", ms=6, mew=1.5)
        ax.annotate(f"{s['id']} {'—' if val is None else f'{val:.1f}'}", (s["lon"], s["lat"]), fontsize=7, color="red",
                    xytext=(4, 3), textcoords="offset points")
    ax.set_title(f"{canal['id']} · {ROTULO}", fontsize=8)
    buf = io.BytesIO()
    fig.savefig(buf, dpi=100, bbox_inches="tight", format="png")
    plt.close(fig)
    _atomico(Path(ruta), buf.getvalue())


def main(build=None, destino=None, vistas=None):
    from pipeline.malla import salida
    from pipeline.malla.construir import CLIMA_ZARR
    from pipeline.motor import puntos
    from pipeline.motor import umbrales as um

    build = Path(build or RAIZ / "build")
    destino = Path(destino or RAIZ / "web" / "data" / "global")
    vistas = Path(vistas or build / "condiciones")
    f_eq, f_si = RAIZ / "datos_json" / "equipo.json", RAIZ / "datos_json" / "sitios_ensayo.json"
    equipos = json.loads(f_eq.read_text(encoding="utf-8"))["equipos"]
    sitios = json.loads(f_si.read_text(encoding="utf-8"))["sitios"]
    malla = (build / "malla_actual.txt").read_text().strip()
    vars_, _ = salida.lee_actual(build)
    datos = {k: v[0].astype(float) for k, v in vars_.items()}
    u, _ = um.carga()
    tierra, _ = puntos.mascaras(u, datos)
    peso = np.where(tierra, datos["area_km2"] * datos["tierra_frac"], 0.0)

    t_min, periodo = t_min_power(CLIMA_ZARR)
    campos, por_lat = campos_condicion(datos, t_min)
    destino.mkdir(parents=True, exist_ok=True)
    canales = escribe_capas(campos, tierra, destino)
    celdas = vd.sitios_en(sitios, {k: campos[k] for k in ("oscuridad_max_h", "sol_rasante_h_ano", "t_min_alcanzable_k", "tiempo_ciudad_h")}, tierra)
    eq = evalua(equipos, sitios, campos, tierra, peso, celdas)

    ras = campos["sol_rasante_h_ano"][tierra]
    manifiesto = {
        "malla": malla, "prerregistrado": False,
        "rotulo": ROTULO, "equipo_sha256": _sha(f_eq), "sitios_sha256": _sha(f_si),
        "rejilla": {"ancho": rejilla.N_LON, "alto": rejilla.N_LAT, "fila0": "norte", "lon0": -179.75, "lat0": 89.75, "paso": rejilla.PASO},
        "tierra": "tierra_frac > 0 (GMTED2010) plus validation-site cells, same mask as capas.json",
        "pct_tierra_metodo": "area-weighted: cell area × land fraction (GMTED2010), over land cells with data",
        "constantes": astro.CONSTANTES,
        "periodo_power": periodo,
        "canales": canales,
        "por_latitud": {"fila0": "norte", **{k: [_r(x) for x in v[::-1]] for k, v in por_lat.items()},
                        "nota": "exact value per grid row; the PNG holds the same value rounded to its scale"},
        "condiciones": {k: {"nombre": c["nombre"], "unidad": c["unidad"], "sentido": c["sentido"]} for k, c in vd.CONDICIONES.items()},
        "veredictos": {"reaches": "the Earth cell reaches or goes beyond the design limit",
                       "partial": "the cell reaches part of it (fraction for durations; kelvins short for temperature)",
                       "not_reachable": "no land cell on Earth reaches it: not reachable in the field — chamber only",
                       "terreno": "measured on the 3D terrain", "no_evaluado": "not evaluated"},
        "criterio_laboratorios": {"origen": "mío", "patrones": vd.CRITERIO_LAB,
                                  "texto": "a laboratory campaign counts when its 'sistema' or 'que_se_probo' matches the pattern"},
        "entorno": [{"condicion": "sol_rasante_h_ano", "origen": "mío",
                     "texto": "At the lunar south pole the Sun's centre never rises more than 1.535° above the horizon. "
                              "No catalogued equipment states a grazing-sun limit: shown as a lunar environment condition, not a requirement.",
                     "umbral_deg": astro.CONSTANTES["elev_sol_max_polo_sur_luna_deg"],
                     "min_tierra_h": _r(np.nanmin(ras)), "max_tierra_h": _r(np.nanmax(ras)),
                     "sitios": [{"id": s["id"], "nombre": s["nombre"], "valor": None if s["valores"] is None else _r(s["valores"]["sol_rasante_h_ano"])}
                                for s in celdas]}],
        "acceso": {"canal": "tiempo_ciudad_h", "rotulo": "own threshold", "texto": "logistic filter, not a physical condition"},
        "sitios": celdas,
        "equipos": eq,
    }
    for s in manifiesto["sitios"]:
        if s["valores"]:
            s["valores"] = {k: _r(v) for k, v in s["valores"].items()}
    _json(destino / "condiciones.json", manifiesto)

    vistas.mkdir(parents=True, exist_ok=True)
    limites = {}
    for e in eq:
        for r in e["requisitos"]:
            if r.get("veredicto_global") == "reaches":
                limites.setdefault(r["condicion"], set()).add(float(r["valor"]))
    for f, lista in CANALES.items():
        for c in lista:
            if not c.get("vacio"):
                vista(campos[c["id"]], tierra, c, celdas, vistas / f"{c['id']}.png", sorted(limites.get(c["id"], ())))
    print(f"{destino / 'condiciones.json'}: {sum(len(e['requisitos']) for e in eq)} requisitos; vistas en {vistas}")
    return manifiesto


if __name__ == "__main__":
    main()
