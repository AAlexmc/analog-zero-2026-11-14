"""Capas polares lunares (LOLA, NASA GSFC PGDA) remuestreadas a la rejilla del terreno."""
from pathlib import Path

import numpy as np

from . import fuentes
from .remuestreo import bilineal, vecino

PGDA_DATOS = "https://pgda.gsfc.nasa.gov/data/MoonIllumination/"
PGDA_PAGINA = "https://pgda.gsfc.nasa.gov/products/69"
CITA = "Mazarico et al. (2011), Icarus 211, 1066-1081, doi:10.1016/j.icarus.2010.10.030"


class RasterPolar:
    """GeoTIFF en estereográfica polar sur esférica (R 1737,4 km, lon 0 arriba). Valores = DN·escala + offset."""

    def __init__(self, p):
        import rasterio

        with rasterio.open(p) as d:
            crs = d.crs.to_dict()
            if crs.get("proj") != "stere" or crs.get("lat_0") != -90 or crs.get("lon_0", 0) != 0 or crs.get("R") != 1737400:
                raise ValueError(f"{p}: proyección no esperada {crs}")
            t = d.transform
            if t.b != 0 or t.d != 0 or t.a != -t.e:
                raise ValueError(f"{p}: rejilla girada o no cuadrada")
            self.dn = d.read(1)
            self.nodata = d.nodata
            self.escala = d.scales[0]
            self.offset = d.offsets[0]
            self.m = t.a
            self.x00 = t.c + t.a / 2
            self.y00 = t.f + t.e / 2
        self.ruta = Path(p)

    def px_de_xy(self, x, y):
        return (self.y00 - np.asarray(y)) / self.m, (np.asarray(x) - self.x00) / self.m

    def valor_xy(self, x, y):
        a = self.dn.astype(np.float64)
        if self.nodata is not None:
            a[self.dn == self.nodata] = np.nan
        return bilineal(a, *self.px_de_xy(x, y)) * self.escala + self.offset


def _comprobar_rejilla(rej):
    if rej.g["tipo"] != "estereo_polar" or rej.g["radio_m"] != 1737400.0:
        raise ValueError("capas polares solo sobre rejillas estereo_polar de radio 1737400 m")


def iluminacion(r, rej):
    _comprobar_rejilla(rej)
    return r.valor_xy(*rej.xy_todos()).astype(np.float32)


def sombra_permanente(r, rej):
    # DN +20000 = sombra permanente (1), −20000 = no (0); cualquier otro DN no está en la etiqueta → sin dato
    _comprobar_rejilla(rej)
    v, dentro = vecino(r.dn, *r.px_de_xy(*rej.xy_todos()))
    out = np.full(v.shape, 255, np.uint8)
    out[dentro & (v == 20000)] = 1
    out[dentro & (v == -20000)] = 0
    return out


PRP_BASE = "https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_prp/"


def leer_prp(p):
    """Tabla DLRE_PRP (Diviner Polar Resource Product): lon, lat del centro de cada triángulo y temp_max (K)."""
    import pandas as pd

    t = pd.read_csv(p, skipinitialspace=True, usecols=["tri_clon", "tri_clat", "temp_max"],
                    dtype="float64", engine="c")
    t = t[t["temp_max"] > 0]
    return t["tri_clon"].to_numpy(), t["tri_clat"].to_numpy(), t["temp_max"].to_numpy()


def disperso_a_rejilla(lon, lat, val, rej, margen_m=3000.0):
    """Interpolación lineal (baricéntrica, Delaunay) de puntos dispersos a la rejilla; fuera de la nube: NaN."""
    from scipy.interpolate import LinearNDInterpolator

    _comprobar_rejilla(rej)
    x, y = rej.xy_de_latlon(lat, lon)
    gx, gy = rej.xy_todos()
    sel = ((x > gx.min() - margen_m) & (x < gx.max() + margen_m) &
           (y > gy.min() - margen_m) & (y < gy.max() + margen_m))
    f = LinearNDInterpolator(np.c_[x[sel], y[sel]], val[sel])
    return f(gx, gy).astype(np.float32)


def _prp_cache():
    nombre = "dlre_prp_south.tab"
    p = fuentes.bajar(PRP_BASE + nombre, fuentes.DATOS / "raw" / "diviner_prp" / nombre)
    cache = Path(__file__).resolve().parents[2] / "build" / "terreno" / "cache" / "dlre_prp_south_tmax.npz"
    if not cache.exists() or cache.stat().st_mtime < p.stat().st_mtime:
        cache.parent.mkdir(parents=True, exist_ok=True)
        lon, lat, t = leer_prp(p)
        tmp = cache.with_name("tmp_" + cache.name)
        np.savez(tmp, lon=lon, lat=lat, t=t)
        tmp.replace(cache)
    d = np.load(cache)
    return d["lon"], d["lat"], d["t"]


def temp_max(rej):
    return disperso_a_rejilla(*_prp_cache(), rej)


def _pgda(fichero, funcion):
    def f(rej):
        p = fuentes.bajar(PGDA_DATOS + fichero, fuentes.DATOS / "raw" / "pgda" / fichero)
        return funcion(RasterPolar(p), rej)
    return f


def agua(rej):
    if rej.g["tipo"] != "local_aeqd":
        raise ValueError("la capa agua solo existe en terrenos de la Tierra (local_aeqd)")
    clases, _, usadas, ausentes = fuentes.glo30_agua(rej)
    extra = {"teselas": [fuentes.url_wbm(w[:-4] + "_DEM") for w in usadas]}
    if ausentes:
        extra["teselas_sin_fichero"] = ausentes
    return clases, extra


CAPAS = {
    "iluminacion": {
        "funcion": _pgda("AVGVISIB_85S_060M_201608.TIF", iluminacion),
        "meta": {"fichero": "iluminacion.f32", "tipo": "float32", "unidad": "fraction 0-1",
                 "fuente": "LRO LOLA average solar illumination 85S-90S 60 m/px, AVGVISIB_85S_060M_201608 "
                           f"(fraction of hourly steps over 18.6 years with any part of the Sun visible); {CITA}",
                 "url": PGDA_DATOS + "AVGVISIB_85S_060M_201608.TIF", "pagina": PGDA_PAGINA,
                 "resolucion_origen_m": 60, "remuestreo": "bilinear"}},
    "sombra_permanente": {
        "funcion": _pgda("LPSR_85S_060M_201608.TIF", sombra_permanente),
        "meta": {"fichero": "sombra_permanente.u8", "tipo": "uint8", "unidad": "0/1",
                 "fuente": f"LRO LOLA permanently shadowed regions 85S-90S 60 m/px, LPSR_85S_060M_201608; {CITA}",
                 "url": PGDA_DATOS + "LPSR_85S_060M_201608.TIF", "pagina": PGDA_PAGINA,
                 "resolucion_origen_m": 60, "remuestreo": "nearest"}},
    "temp_max": {
        "funcion": temp_max,
        "meta": {"fichero": "temp_max.f32", "tipo": "float32", "unidad": "K",
                 "fuente": "LRO Diviner Polar Resource Product DLRE_PRP_SOUTH (annual maximum surface temperature, "
                           "thermal model fit to first mapping year, triangular mesh on Kaguya topography); "
                           "Paige et al., LRO DLRE LEVEL 5 PRP V2.0, NASA Planetary Data System, LRO-L-DLRE-5-PRP-V2.0, 2018",
                 "url": PRP_BASE + "dlre_prp_south.tab", "resolucion_origen_m": 500,
                 "remuestreo": "linear (Delaunay) from triangle centres"}},
    "agua": {
        "funcion": agua,
        "meta": {"fichero": "agua.u8", "tipo": "uint8", "unidad": "class",
                 "clases": {str(k): v for k, v in fuentes.WBM_CLASES.items()},
                 "fuente": "Copernicus DEM GLO-30 Water Body Mask (WBM, auxiliary file of each tile; "
                           "class codes: Copernicus DEM Product Handbook v5.0, 2022, section 1.2.5.4, Table 8); "
                           + fuentes.GLO30_ATRIBUCION,
                 "url": fuentes.GLO30_BASE + "readme.html", "documentacion": fuentes.GLO30_HANDBOOK,
                 "licencia": fuentes.GLO30_LICENCIA, "resolucion_origen_m": 30,
                 "remuestreo": "majority of the WBM pixels whose centre falls in the cell (Copernicus also used "
                               "majority resampling for its 8-bit masks, Handbook section 1.2.5); tie -> class of "
                               "the nearest WBM pixel if tied, else the highest code; cell with no pixel -> nearest; "
                               "pixel centres placed exactly as for altura.f32; missing WBM tile -> 255"}},
}


def generar_capa(nombre, rej):
    c = CAPAS[nombre]
    v = c["funcion"](rej)
    m = dict(c["meta"])
    if isinstance(v, tuple):
        v, extra = v
        m.update(extra)
    return v, m
