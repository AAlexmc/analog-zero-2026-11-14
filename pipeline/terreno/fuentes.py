"""DEM de origen: LOLA polar (PDS3) y Copernicus GLO-30 (COG por teselas de 1°)."""
import datetime as dt
import hashlib
import math
import os
import re
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np

from .remuestreo import bilineal

DATOS = Path(os.environ.get("AZ_DATOS", "/home/ale/nasa-space-apps-2026/datos"))
LOG = DATOS / "logs" / "terreno_descargas.tsv"

LOLA_BASE = "https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/"
GLO30_BASE = "https://copernicus-dem-30m.s3.amazonaws.com/"
GLO30_ATRIBUCION = (
    "Copernicus DEM GLO-30, © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 "
    "provided under COPERNICUS by the European Union and ESA; all rights reserved"
)
GLO30_LICENCIA = "https://spacedata.copernicus.eu/en/web/guest/collections/copernicus-digital-elevation-model/#Licencing"


def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def registrar(url, p):
    LOG.parent.mkdir(parents=True, exist_ok=True)
    nuevo = not LOG.exists()
    with open(LOG, "a") as f:
        if nuevo:
            f.write("fecha_utc\turl\tbytes\tsha256\truta\n")
        fecha = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        f.write(f"{fecha}\t{url}\t{p.stat().st_size}\t{sha256(p)}\t{p}\n")


def bajar(url, destino):
    """Descarga a `destino` (.parcial + rename) y la apunta en el TSV. Si ya existe, no baja. 404 → None."""
    destino = Path(destino)
    if destino.exists():
        return destino
    destino.parent.mkdir(parents=True, exist_ok=True)
    parcial = destino.with_name(destino.name + ".parcial")
    try:
        with urllib.request.urlopen(url, timeout=120) as r, open(parcial, "wb") as f:
            for b in iter(lambda: r.read(1 << 20), b""):
                f.write(b)
    except urllib.error.HTTPError as e:
        parcial.unlink(missing_ok=True)
        if e.code in (403, 404):
            return None
        raise
    os.replace(parcial, destino)
    registrar(url, destino)
    return destino


def leer_lbl(p):
    """Pares clave = valor de una etiqueta PDS3 (sin objetos anidados; las claves repetidas se quedan con la primera)."""
    d = {}
    for linea in Path(p).read_text(errors="replace").splitlines():
        m = re.match(r"^\s*(\^?[A-Z_]+)\s*=\s*(.*?)\s*$", linea)
        if m and m.group(1) not in d:
            d[m.group(1)] = m.group(2)
    return d


def _num(v):
    return float(re.sub(r"<.*?>", "", v).strip().strip('"'))


class DemLolaPolar:
    """LDEM polar de LOLA. Ejes según DSMAP_POLAR.CAT (polo sur): lon 0 hacia arriba, 90° E a la derecha."""

    def __init__(self, lbl):
        self.lbl = Path(lbl)
        e = leer_lbl(self.lbl)
        if "STEREOGRAPHIC" not in e["MAP_PROJECTION_TYPE"]:
            raise ValueError("no es estereográfica polar")
        if _num(e["CENTER_LATITUDE"]) != -90 or _num(e["CENTER_LONGITUDE"]) != 0:
            raise NotImplementedError("solo LDEM del polo sur con lon central 0")
        if e["SAMPLE_TYPE"] != "LSB_INTEGER" or _num(e["SAMPLE_BITS"]) != 16:
            raise NotImplementedError("solo enteros de 16 bits little-endian")
        self.polo = "sur"
        self.radio_m = _num(e["A_AXIS_RADIUS"]) * 1000.0
        self.m_por_px = _num(e["MAP_SCALE"])
        self.escala = _num(e["SCALING_FACTOR"])
        self.offset_m = _num(e["OFFSET"])
        self.lpo = _num(e["LINE_PROJECTION_OFFSET"])
        self.spo = _num(e["SAMPLE_PROJECTION_OFFSET"])
        n_l, n_s = int(_num(e["LINES"])), int(_num(e["LINE_SAMPLES"]))
        img = e["^IMAGE"].strip('"')
        cand = [self.lbl.with_name(img), self.lbl.with_name(img.lower())]
        ruta = next((c for c in cand if c.exists()), None)
        if ruta is None:
            raise FileNotFoundError(cand[0])
        self.img = ruta
        self.dn = np.memmap(ruta, dtype="<i2", mode="r", shape=(n_l, n_s))

    def altura_xy(self, x, y):
        # fila/col 0-based: x = (col − SAMPLE_PROJECTION_OFFSET)·escala, y = (LINE_PROJECTION_OFFSET − fila)·escala
        cols = np.asarray(x) / self.m_por_px + self.spo
        filas = self.lpo - np.asarray(y) / self.m_por_px
        return bilineal(self.dn, filas, cols) * self.escala

    def recorte(self, rejilla):
        if rejilla.g["tipo"] != "estereo_polar" or rejilla.g["radio_m"] != self.radio_m:
            raise ValueError("la rejilla debe estar en el plano estereográfico del DEM")
        return self.altura_xy(*rejilla.xy_todos()).astype(np.float32)


def lola(nombre="ldem_85s_20m"):
    d = DATOS / "raw" / "lola_polar"
    lbl = bajar(LOLA_BASE + nombre + ".lbl", d / (nombre + ".lbl"))
    bajar(LOLA_BASE + nombre + ".img", d / (nombre + ".img"))
    return DemLolaPolar(lbl), LOLA_BASE + nombre + ".img"


def nombre_glo30(lat_ent, lon_ent):
    ns = f"{'N' if lat_ent >= 0 else 'S'}{abs(lat_ent):02d}_00"
    ew = f"{'E' if lon_ent >= 0 else 'W'}{abs(lon_ent):03d}_00"
    return f"Copernicus_DSM_COG_10_{ns}_{ew}_DEM"


def _teselas_glo30(lat, lon):
    tl = np.floor(lat).astype(int)
    tn = np.floor(lon).astype(int)
    for a, b in sorted(set(zip(tl.ravel().tolist(), tn.ravel().tolist()))):
        yield nombre_glo30(a, b), (tl == a) & (tn == b)


def _px_glo30(t, lat, lon):
    # GDAL da la esquina del píxel; los centros están a medio píxel
    return (lat - (t.f + t.e / 2)) / t.e, (lon - (t.c + t.a / 2)) / t.a


def _ventana(ds, filas, cols, antes, despues):
    c0, c1 = max(int(math.floor(cols.min())) - antes, 0), min(int(math.ceil(cols.max())) + despues, ds.width)
    f0, f1 = max(int(math.floor(filas.min())) - antes, 0), min(int(math.ceil(filas.max())) + despues, ds.height)
    return f0, f1, c0, c1


def glo30_altura(lat, lon):
    """Altura GLO-30 (m sobre EGM2008) en cada lat/lon. Tesela inexistente (mar abierto según el bucket) → 0.

    Devuelve (altura float32, teselas usadas, teselas sin fichero).
    """
    import rasterio

    lat = np.asarray(lat, dtype=float)
    lon = np.asarray(lon, dtype=float)
    out = np.full(lat.shape, np.nan)
    usadas, ausentes = [], []
    carpeta = DATOS / "raw" / "glo30"
    for nom, sel in _teselas_glo30(lat, lon):
        p = bajar(f"{GLO30_BASE}{nom}/{nom}.tif", carpeta / f"{nom}.tif")
        if p is None:
            ausentes.append(nom)
            out[sel] = 0.0
            continue
        usadas.append(nom)
        with rasterio.open(p) as ds:
            t = ds.transform
            filas, cols = _px_glo30(t, lat[sel], lon[sel])
            f0, f1, c0, c1 = _ventana(ds, filas, cols, 1, 2)
            win = ds.read(1, window=((f0, f1), (c0, c1))).astype(np.float64)
            if ds.nodata is not None:
                win[win == ds.nodata] = np.nan
        v = bilineal(win, filas - f0, cols - c0)
        # entre teselas falta la fila/columna compartida: el último medio-píxel se toma del vecino más cercano
        fuera = np.isnan(v)
        if fuera.any():
            fc = np.clip(np.rint(filas[fuera] - f0), 0, win.shape[0] - 1).astype(int)
            cc = np.clip(np.rint(cols[fuera] - c0), 0, win.shape[1] - 1).astype(int)
            v[fuera] = win[fc, cc]
        out[sel] = v
    return out.astype(np.float32), usadas, ausentes


# Copernicus DEM Product Handbook v5.0 (GEO.2018-1988-2, 29-11-2022), §1.2.5.4, Table 8, p. 21
WBM_CLASES = {0: "no water", 1: "ocean", 2: "lake", 3: "river"}
GLO30_HANDBOOK = ("https://dataspace.copernicus.eu/sites/default/files/media/files/2024-06/"
                  "geo1988-copernicusdem-spe-002_producthandbook_i5.0.pdf")


def url_wbm(nom_dem):
    return f"{GLO30_BASE}{nom_dem}/AUXFILES/{nom_dem[:-4]}_WBM.tif"


def mayoria_clases(cuenta, vec):
    """Clase más votada por celda (`cuenta`: clases × celdas). Empate → la del vecino más próximo si está entre
    las empatadas, si no la de código más alto. Celda sin votos → vecino."""
    k, m = cuenta.shape
    mx = cuenta.max(axis=0)
    empatadas = (cuenta == mx) & (mx > 0)
    alto = np.where(empatadas, np.arange(k)[:, None], -1).max(axis=0)
    vec = np.asarray(vec)
    valido = vec < k
    vec_empatado = valido & empatadas[np.where(valido, vec, 0), np.arange(m)]
    out = np.where(vec_empatado, vec, alto)
    return np.where(mx > 0, out, vec).astype(np.uint8)


def glo30_agua(rej):
    """Water Body Mask de GLO-30 en la rejilla: mayoría de los píxeles de origen cuyo centro cae en cada celda.

    Devuelve (mayoría, vecino más próximo, teselas WBM usadas, teselas WBM sin fichero); uint8, sin dato = 255.
    """
    import rasterio

    n = rej.n
    k = len(WBM_CLASES)
    lat, lon = rej.latlon_de_px(*np.mgrid[0:n, 0:n])
    cuenta = np.zeros((k, n * n), np.int64)
    vec = np.full((n, n), 255, np.uint8)
    usadas, ausentes = [], []
    carpeta = DATOS / "raw" / "glo30"
    for nom, sel in _teselas_glo30(lat, lon):
        w = nom[:-4] + "_WBM"
        p = bajar(url_wbm(nom), carpeta / f"{w}.tif")
        if p is None:
            ausentes.append(w)
            continue
        usadas.append(w)
        with rasterio.open(p) as ds:
            t = ds.transform
            filas, cols = _px_glo30(t, lat[sel], lon[sel])
            f0, f1, c0, c1 = _ventana(ds, filas, cols, 3, 4)
            win = ds.read(1, window=((f0, f1), (c0, c1)))
        v = win[np.clip(np.rint(filas - f0), 0, win.shape[0] - 1).astype(int),
                np.clip(np.rint(cols - c0), 0, win.shape[1] - 1).astype(int)]
        vec[sel] = np.where(v < k, v, 255)
        ff, cc = np.mgrid[f0:f1, c0:c1]
        pf, pc = rej.px_de_latlon(t.f + t.e / 2 + ff * t.e, t.c + t.a / 2 + cc * t.a)
        fi, ci = np.rint(pf).astype(np.int64), np.rint(pc).astype(np.int64)
        ok = (fi >= 0) & (fi < n) & (ci >= 0) & (ci < n) & (win < k)
        idx, clase = fi[ok] * n + ci[ok], win[ok]
        for c in range(k):
            cuenta[c] += np.bincount(idx[clase == c], minlength=n * n)
    return mayoria_clases(cuenta, vec.ravel()).reshape(n, n), vec, usadas, ausentes
