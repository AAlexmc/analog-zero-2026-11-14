"""Planos locales de docs/contrato-terreno.md (esféricos)."""
import numpy as np


def normaliza_lon(lon):
    lon = np.mod(np.asarray(lon, dtype=float) + 180.0, 360.0) - 180.0
    return np.where(lon == -180.0, 180.0, lon)


def _solo_sur(polo):
    if polo != "sur":
        # Con los ejes del contrato (y hacia lon 0) el polo norte sale en espejo; sin uso todavía.
        raise NotImplementedError("estereo_polar solo con polo sur")


def estereo_directa(polo, lat, lon, R):
    _solo_sur(polo)
    lat = np.radians(np.asarray(lat, dtype=float))
    lon = np.radians(np.asarray(lon, dtype=float))
    rho = 2.0 * R * np.tan(np.pi / 4 + lat / 2)
    return rho * np.sin(lon), rho * np.cos(lon)


def estereo_inversa(polo, x, y, R):
    _solo_sur(polo)
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    rho = np.hypot(x, y)
    lat = -90.0 + np.degrees(2.0 * np.arctan(rho / (2.0 * R)))
    return lat, normaliza_lon(np.degrees(np.arctan2(x, y)))


def aeqd_directa(lat, lon, lat0, lon0, R):
    p = np.radians(np.asarray(lat, dtype=float))
    dl = np.radians(np.asarray(lon, dtype=float) - lon0)
    p0 = np.radians(lat0)
    cosc = np.clip(np.sin(p0) * np.sin(p) + np.cos(p0) * np.cos(p) * np.cos(dl), -1.0, 1.0)
    c = np.arccos(cosc)
    with np.errstate(invalid="ignore", divide="ignore"):
        k = np.where(c > 1e-12, c / np.sin(c), 1.0)
    x = R * k * np.cos(p) * np.sin(dl)
    y = R * k * (np.cos(p0) * np.sin(p) - np.sin(p0) * np.cos(p) * np.cos(dl))
    return x, y


def aeqd_inversa(x, y, lat0, lon0, R):
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    p0 = np.radians(lat0)
    rho = np.hypot(x, y)
    c = rho / R
    with np.errstate(invalid="ignore", divide="ignore"):
        s = np.where(rho > 0, y * np.sin(c) * np.cos(p0) / rho, 0.0)
    lat = np.degrees(np.arcsin(np.clip(np.cos(c) * np.sin(p0) + s, -1.0, 1.0)))
    lon = lon0 + np.degrees(np.arctan2(x * np.sin(c), rho * np.cos(p0) * np.cos(c) - y * np.sin(p0) * np.sin(c)))
    return lat, normaliza_lon(lon)


def radio_gauss_wgs84(lat):
    """Radio medio de Gauss sqrt(M·N) de WGS84 en `lat`: la esfera que mejor imita al elipsoide allí."""
    a, e2 = 6378137.0, 6.69437999014e-3
    s2 = np.sin(np.radians(lat)) ** 2
    return float(a * np.sqrt(1 - e2) / (1 - e2 * s2))


def _esquina(n, m):
    return (n - 1) / 2 * m


def georef_estereo(polo, R, xc, yc, n, m):
    h = _esquina(n, m)
    return {"tipo": "estereo_polar", "polo": polo, "radio_m": R, "x0_m": float(xc - h), "y0_m": float(yc + h)}


def georef_aeqd(R, n, m):
    h = _esquina(n, m)
    return {"tipo": "local_aeqd", "radio_m": R, "x0_m": -h, "y0_m": h}


class Rejilla:
    def __init__(self, georef, n, m_por_px, lat0, lon0):
        self.g, self.n, self.m, self.lat0, self.lon0 = georef, n, m_por_px, lat0, lon0

    def xy_de_px(self, f, c):
        return self.g["x0_m"] + np.asarray(c) * self.m, self.g["y0_m"] - np.asarray(f) * self.m

    def px_de_xy(self, x, y):
        return (self.g["y0_m"] - np.asarray(y)) / self.m, (np.asarray(x) - self.g["x0_m"]) / self.m

    def latlon_de_xy(self, x, y):
        g = self.g
        if g["tipo"] == "estereo_polar":
            return estereo_inversa(g["polo"], x, y, g["radio_m"])
        return aeqd_inversa(x, y, self.lat0, self.lon0, g["radio_m"])

    def xy_de_latlon(self, lat, lon):
        g = self.g
        if g["tipo"] == "estereo_polar":
            return estereo_directa(g["polo"], lat, lon, g["radio_m"])
        return aeqd_directa(lat, lon, self.lat0, self.lon0, g["radio_m"])

    def latlon_de_px(self, f, c):
        return self.latlon_de_xy(*self.xy_de_px(f, c))

    def px_de_latlon(self, lat, lon):
        return self.px_de_xy(*self.xy_de_latlon(lat, lon))

    def xy_todos(self):
        f, c = np.mgrid[0:self.n, 0:self.n]
        return self.xy_de_px(f, c)
