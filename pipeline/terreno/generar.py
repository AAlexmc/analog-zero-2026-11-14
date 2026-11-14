import io
import json
import shlex
import zipfile
from pathlib import Path

import numpy as np

from . import capas, escritura, fuentes, georef

REPO = Path(__file__).resolve().parents[2]
SALIDA = REPO / "web" / "data" / "terreno"
BUILD = REPO / "build" / "terreno"
SITIOS = Path(__file__).with_name("sitios.json")
IAU_ZIP = "https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MOON_nomenclature_center_pts.zip"


def cargar_sitios():
    return json.loads(SITIOS.read_text())


def comando(s):
    a = ["python", "-m", "pipeline.terreno", "generar", "--id", s["id"], "--cuerpo", s["cuerpo"],
         "--lat", repr(s["lat"]), "--lon", repr(s["lon"]), "--lado-km", repr(s["lado_km"]),
         "--n", str(s["n"]), "--escala", s["escala"], "--nombre", s["nombre"]]
    if s.get("centro_fuente"):
        a += ["--centro-fuente", s["centro_fuente"]]
    if s.get("capas"):
        a += ["--capas", ",".join(s["capas"])]
    if s.get("dem"):
        a += ["--dem", s["dem"]]
    if s.get("notas"):
        a += ["--notas", s["notas"]]
    return shlex.join(a)


def registros_iau():
    import shapefile

    p = fuentes.bajar(IAU_ZIP, fuentes.DATOS / "raw" / "iau" / "MOON_nomenclature_center_pts.zip")
    z = zipfile.ZipFile(p)
    base = "MOON_nomenclature_center_pts"
    r = shapefile.Reader(dbf=io.BytesIO(z.read(base + ".dbf")))
    campos = [f[0] for f in r.fields[1:]]
    for rec in r.iterRecords():
        yield dict(zip(campos, rec))


def rasgos_iau_luna(rej):
    """Nombres IAU (adoptados) cuyo centro cae dentro de la rejilla."""
    out = []
    for d in registros_iau():
        if d["approval"] != "Adopted by IAU":
            continue
        lat, lon = float(d["center_lat"]), float(georef.normaliza_lon(d["center_lon"]))
        f, c = rej.px_de_latlon(np.array([lat]), np.array([lon]))
        if not (-0.5 <= f[0] <= rej.n - 0.5 and -0.5 <= c[0] <= rej.n - 0.5):
            continue
        out.append({"nombre": d["clean_name"], "tipo": d["type"].split(",")[0].lower(),
                    "lat": round(lat, 4), "lon": round(lon, 4), "diametro_km": round(float(d["diameter"]), 3),
                    "fuente": d["link"].replace("http://", "https://", 1)})
    return sorted(out, key=lambda t: -t["diametro_km"])


def punto_medio_bordes(a, b, R=1737400.0):
    """Punto medio entre los bordes IAU (círculo de diámetro IAU) de dos cráteres, sobre la recta que une sus centros
    en el plano estereográfico polar sur."""
    cr = {d["clean_name"]: d for d in registros_iau() if d["clean_name"] in (a, b) and d["approval"] == "Adopted by IAU"}
    (xa, ya, ra), (xb, yb, rb) = [
        (*georef.estereo_directa("sur", float(cr[k]["center_lat"]), float(georef.normaliza_lon(cr[k]["center_lon"])), R),
         float(cr[k]["diameter"]) * 500.0) for k in (a, b)]
    L = np.hypot(xb - xa, yb - ya)
    ux, uy = (xb - xa) / L, (yb - ya) / L
    xm, ym = (xa + ra * ux + xb - rb * ux) / 2, (ya + ra * uy + yb - rb * uy) / 2
    lat, lon = georef.estereo_inversa("sur", xm, ym, R)
    return round(float(lat), 5), round(float(lon), 4)


AVGVISIB = "AVGVISIB_85S_060M_201608.TIF"


def _avgvisib():
    return capas.RasterPolar(fuentes.bajar(capas.PGDA_DATOS + AVGVISIB, fuentes.DATOS / "raw" / "pgda" / AVGVISIB))


def _xy_valores(r):
    f, c = np.ogrid[0:r.dn.shape[0], 0:r.dn.shape[1]]
    x, y = np.broadcast_arrays(r.x00 + c * r.m, r.y00 - f * r.m)
    return x, y, np.where(r.dn != r.nodata, r.dn * r.escala + r.offset, np.nan)


def borde_mas_iluminado(r_min_km=9.0, r_max_km=12.0):
    """Píxel de AVGVISIB_85S_060M con mayor iluminación media en el anillo del borde de Shackleton (centro IAU)."""
    s = next(t for t in cargar_sitios()["sitios"] if t["id"] == "shackleton")
    x, y, v = _xy_valores(_avgvisib())
    xc, yc = georef.estereo_directa("sur", s["lat"], s["lon"], 1737400.0)
    d = np.hypot(x - xc, y - yc) / 1000
    v = np.where((d >= r_min_km) & (d <= r_max_km) & np.isfinite(v), v, -1.0)
    i = np.unravel_index(np.argmax(v), v.shape)
    lat, lon = georef.estereo_inversa("sur", x[i], y[i], 1737400.0)
    return {"lat": round(float(lat), 5), "lon": round(float(lon), 4), "iluminacion": round(float(v[i]), 4),
            "r_km": round(float(d[i]), 3), "fuente": capas.PGDA_DATOS + AVGVISIB}


def mas_iluminados(x, y, v, n, sep_m):
    """Índices de los n mayores valores de `v` (sin NaN) a ≥ sep_m entre sí; codicioso, empate → orden de lectura."""
    elegidos = []
    for i in np.argsort(-np.where(np.isfinite(v), v, -np.inf), kind="stable"):
        if len(elegidos) == n or not np.isfinite(v[i]):
            break
        if all(np.hypot(x[i] - x[j], y[i] - y[j]) >= sep_m for j in elegidos):
            elegidos.append(int(i))
    return elegidos


def picos_luz(rej, r=None, n=5, sep_km=1.0):
    """Los n píxeles de AVGVISIB_85S_060M con mayor iluminación media cuyo centro cae en la rejilla, a ≥ sep_km
    entre sí (distancia en el plano estereográfico); fila/col = celda que contiene el centro del píxel."""
    capas._comprobar_rejilla(rej)
    x, y, v = _xy_valores(r or _avgvisib())
    f, c = rej.px_de_xy(x, y)
    dentro = (f >= -0.5) & (f < rej.n - 0.5) & (c >= -0.5) & (c < rej.n - 0.5) & np.isfinite(v)
    x, y, v, f, c = x[dentro], y[dentro], v[dentro], f[dentro], c[dentro]
    out = []
    for i in mas_iluminados(x, y, v, n, sep_km * 1000.0):
        lat, lon = georef.estereo_inversa("sur", x[i], y[i], 1737400.0)
        out.append({"fila": int(np.floor(f[i] + 0.5)), "col": int(np.floor(c[i] + 0.5)),
                    "lat": round(float(lat), 5), "lon": round(float(lon), 4), "valor": round(float(v[i]), 4)})
    return out


def _meta_picos(puntos, n=5, sep_km=1.0):
    return {"n": n, "separacion_min_km": sep_km, "origen": "mío",
            "criterio": f"{n} pixels of {AVGVISIB[:-4]} (60 m) with the highest mean solar illumination whose centre "
                        f"falls in the grid, greedy, each at least {sep_km:g} km from the previous ones (polar "
                        "stereographic plane); fila/col = grid cell containing the pixel centre; valor = pixel value",
            "fuente": capas.CAPAS["iluminacion"]["meta"]["fuente"], "url": capas.PGDA_DATOS + AVGVISIB,
            "puntos": puntos}


def anadir_picos(id_, salida=SALIDA):
    """Añade `picos_luz` al meta.json de un terreno lunar ya generado sin tocar nada más."""
    d = salida / id_
    meta = json.loads((d / "meta.json").read_text())
    rej = georef.Rejilla(meta["georef"], meta["n"], meta["m_por_px"], meta["centro"]["lat"], meta["centro"]["lon"])
    pl = _meta_picos(picos_luz(rej))
    pl["comando"] = shlex.join(["python", "-m", "pipeline.terreno", "picos", "--id", id_])
    meta["picos_luz"] = pl
    escritura.escribir_json(d / "meta.json", meta)
    return meta


def generar(s, salida=SALIDA, build=BUILD, vista=True):
    n = int(s["n"])
    m = s["lado_km"] * 1000.0 / n
    meta = {"id": s["id"], "cuerpo": s["cuerpo"], "nombre": s["nombre"],
            "centro": {"lat": s["lat"], "lon": s["lon"]}, "lado_km": s["lado_km"], "n": n, "m_por_px": m}
    if s.get("centro_fuente"):
        meta["centro_fuente"] = s["centro_fuente"]
    notas = [s["notas"]] if s.get("notas") else []
    if s["cuerpo"] == "luna":
        dem, url = fuentes.lola(s.get("dem", "ldem_85s_20m"))
        xc, yc = georef.estereo_directa(dem.polo, s["lat"], s["lon"], dem.radio_m)
        g = georef.georef_estereo(dem.polo, dem.radio_m, float(xc), float(yc), n, m)
        rej = georef.Rejilla(g, n, m, s["lat"], s["lon"])
        z = dem.recorte(rej)
        capa = {"fichero": "altura.f32", "tipo": "float32", "unidad": "m",
                "fuente": f"LRO LOLA {dem.img.stem.upper()} (PDS Geosciences Node)", "url": url,
                "resolucion_origen_m": dem.m_por_px}
        z_ref = f"sphere {dem.offset_m:.0f} m"
        notas.append("Plane = LOLA south polar stereographic: up = longitude 0°, right = 90° E.")
    elif s["cuerpo"] == "tierra":
        R = round(georef.radio_gauss_wgs84(s["lat"]), 1)
        g = georef.georef_aeqd(R, n, m)
        rej = georef.Rejilla(g, n, m, s["lat"], s["lon"])
        f, c = np.mgrid[0:n, 0:n]
        lat, lon = rej.latlon_de_px(f, c)
        z, usadas, ausentes = fuentes.glo30_altura(lat, lon)
        capa = {"fichero": "altura.f32", "tipo": "float32", "unidad": "m", "fuente": fuentes.GLO30_ATRIBUCION,
                "url": "https://copernicus-dem-30m.s3.amazonaws.com/readme.html", "licencia": fuentes.GLO30_LICENCIA,
                "teselas": [f"{fuentes.GLO30_BASE}{t}/{t}.tif" for t in usadas], "resolucion_origen_m": 30}
        z_ref = "EGM2008 geoid (Copernicus DEM)"
        notas.append(f"radio_m = WGS84 Gaussian mean radius at {s['lat']}° (sphere within ~6 m of the ellipsoid over 20 km).")
        notas.append("GLO-30 is a surface model (DSM).")
        cero = float(np.mean(z == 0.0))
        if cero > 0:
            notas.append(f"{cero:.1%} of cells are exactly 0 m: sea surface in GLO-30, kept as 0 (not NaN).")
        if ausentes:
            notas.append(f"Missing tiles set to 0 m (open sea per Copernicus bucket readme): {', '.join(ausentes)}.")
    else:
        raise NotImplementedError(s["cuerpo"])
    if np.isnan(z).any():
        notas.append(f"{np.isnan(z).mean():.2%} cells without data (NaN).")
    d = salida / s["id"]
    escritura.escribir_capa(d / "altura.f32", z)
    z_min, z_max = escritura.rango(z)
    meta.update({"z_min": z_min, "z_max": z_max, "z_referencia": z_ref, "georef": g, "capas": {"altura": capa}})
    previo = d / "meta.json"
    if previo.exists():
        # conserva capas extra ya escritas sobre la misma rejilla
        viejo = json.loads(previo.read_text())
        if viejo.get("georef") == g and viejo.get("n") == n:
            for k, v in viejo.get("capas", {}).items():
                if k != "altura" and (d / v["fichero"]).exists():
                    meta["capas"][k] = v
    extra = {}
    for nombre in s.get("capas", []):
        valores, cm = capas.generar_capa(nombre, rej)
        escritura.escribir_capa(d / cm["fichero"], valores)
        meta["capas"][nombre] = cm
        extra[nombre] = valores
    if s["cuerpo"] == "luna":
        meta["rasgos"] = rasgos_iau_luna(rej)
        meta["picos_luz"] = _meta_picos(picos_luz(rej))
    meta["notas"] = " ".join(notas)
    meta["comando"] = comando(s)
    escritura.escribir_json(d / "meta.json", meta)
    entrada = {"id": s["id"], "cuerpo": s["cuerpo"], "nombre": s["nombre"], "lado_km": s["lado_km"], "escala": s["escala"]}
    escritura.actualizar_index(salida, entrada, cargar_sitios()["pareja_inicial"])
    if vista:
        from . import vista as v
        v.png_altura(z, meta, build / f"{s['id']}_altura.png")
        for nombre, valores in extra.items():
            _png_capa(v, z, nombre, valores, meta, build)
    return meta


def _png_capa(v, z, nombre, valores, meta, build):
    vis = np.where(valores == 255, np.nan, valores).astype(float) if valores.dtype == np.uint8 else valores
    v.png_capa(z, nombre, vis, meta, build / f"{meta['id']}_{nombre}.png", unidad=meta["capas"][nombre]["unidad"])


def anadir_capa(id_, nombre, salida=SALIDA, build=BUILD, vista=True):
    """Añade o rehace una capa sobre un terreno ya generado sin tocar altura.f32 ni el resto de meta.json."""
    d = salida / id_
    meta = json.loads((d / "meta.json").read_text())
    rej = georef.Rejilla(meta["georef"], meta["n"], meta["m_por_px"], meta["centro"]["lat"], meta["centro"]["lon"])
    valores, cm = capas.generar_capa(nombre, rej)
    cm["comando"] = shlex.join(["python", "-m", "pipeline.terreno", "capa", "--id", id_, "--capa", nombre])
    escritura.escribir_capa(d / cm["fichero"], valores)
    meta["capas"][nombre] = cm
    escritura.escribir_json(d / "meta.json", meta)
    if vista:
        from . import vista as v
        z = np.fromfile(d / meta["capas"]["altura"]["fichero"], "<f4").reshape(meta["n"], meta["n"])
        _png_capa(v, z, nombre, valores, meta, build)
    return meta
