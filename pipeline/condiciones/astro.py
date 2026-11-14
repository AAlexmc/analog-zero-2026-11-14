"""Sol sobre el horizonte terrestre por latitud: oscuridad continua y horas de sol rasante.

Centro del disco solar, sin refracción ni relieve, hora solar verdadera (sin ecuación del tiempo).
Órbita kepleriana con excentricidad y perihelio de la ficha de la NASA; t = 0 en el perihelio.
"""
import math

import numpy as np

FICHA_TIERRA = "https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html"
FICHA_LUNA = "https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html"
OBLICUIDAD_DEG = 23.44
EXCENTRICIDAD = 0.01671022
LONG_PERIHELIO_DEG = 102.94719
ANO_TROPICO_D = 365.242
# Leyes de Cassini: oblicuidad lunar respecto a su órbita − inclinación de la órbita a la eclíptica.
ELEV_SOL_POLO_LUNA_DEG = 6.68 - 5.145

CONSTANTES = {
    "oblicuidad_tierra_deg": {"valor": OBLICUIDAD_DEG, "fuente": FICHA_TIERRA, "cita": "Obliquity to orbit (deg) 23.44"},
    "excentricidad_tierra": {"valor": EXCENTRICIDAD, "fuente": FICHA_TIERRA, "cita": "Orbital eccentricity 0.01671022"},
    "longitud_perihelio_deg": {"valor": LONG_PERIHELIO_DEG, "fuente": FICHA_TIERRA, "cita": "Longitude of perihelion (deg) 102.94719"},
    "ano_tropico_d": {"valor": ANO_TROPICO_D, "fuente": FICHA_TIERRA, "cita": "Tropical orbit period (days) 365.242"},
    "elev_sol_max_polo_sur_luna_deg": {
        "valor": round(ELEV_SOL_POLO_LUNA_DEG, 3), "fuente": FICHA_LUNA,
        "cita": "Obliquity to orbit (deg) 6.68 · Inclination to ecliptic (deg) 5.145",
        "formula": "6.68 − 5.145 = 1.535° (Cassini laws; same source and value as pipeline/validacion_sombras/PROTOCOLO.md)"},
}


def declinacion(t_d, ecc=EXCENTRICIDAD, eps_deg=OBLICUIDAD_DEG):
    """Declinación del Sol (rad) a t días del perihelio."""
    M = 2 * np.pi * np.asarray(t_d, dtype=float) / ANO_TROPICO_D
    E = M.copy()
    for _ in range(8):
        E = E - (E - ecc * np.sin(E) - M) / (1 - ecc * np.cos(E))
    nu = 2 * np.arctan2(math.sqrt(1 + ecc) * np.sin(E / 2), math.sqrt(1 - ecc) * np.cos(E / 2))
    # Longitud eclíptica geocéntrica del Sol = heliocéntrica de la Tierra + 180°.
    lam = nu + math.radians(LONG_PERIHELIO_DEG + 180.0)
    return np.arcsin(math.sin(math.radians(eps_deg)) * np.sin(lam))


def _malla_t(anos, paso_min):
    t = np.arange(0.0, anos * ANO_TROPICO_D, paso_min / 1440.0)
    return t, np.cos(2 * np.pi * t)


def _racha_max(b):
    if not b.any():
        return 0
    d = np.diff(np.concatenate([[0], b.astype(np.int8), [0]]))
    return int((np.flatnonzero(d == -1) - np.flatnonzero(d == 1)).max())


def oscuridad_max_h(lats, paso_min=1.0, ecc=EXCENTRICIDAD):
    """Horas seguidas más largas con el centro del Sol bajo el horizonte. Dos años seguidos: la racha más larga cabe entera."""
    t, cosH = _malla_t(2, paso_min)
    dec = declinacion(t, ecc)
    sd, cd = np.sin(dec), np.cos(dec) * cosH
    out = []
    for lat in np.atleast_1d(np.asarray(lats, dtype=float)):
        p = math.radians(lat)
        out.append(_racha_max(math.sin(p) * sd + math.cos(p) * cd < 0) * paso_min / 60)
    return np.array(out)


def sol_rasante_h(lats, umbral_deg=ELEV_SOL_POLO_LUNA_DEG, paso_d=0.01, ecc=EXCENTRICIDAD):
    """Horas al año con el centro del Sol entre 0° (excluido) y umbral_deg sobre el horizonte.

    sin e = a + b·cos H (a = sin φ sin δ, b = cos φ cos δ): con δ fija en cada paso, la parte del giro diario
    con 0 < sin e ≤ sin θ es 2·(acos(−a/b) − acos((sin θ − a)/b)) / 2π; se integra sobre el año con δ(t).
    """
    dec = declinacion(np.arange(0.0, ANO_TROPICO_D, paso_d) + paso_d / 2, ecc)
    s_umbral = math.sin(math.radians(umbral_deg))
    out = []
    for lat in np.atleast_1d(np.asarray(lats, dtype=float)):
        p = math.radians(lat)
        a, b = math.sin(p) * np.sin(dec), math.cos(p) * np.cos(dec)
        with np.errstate(divide="ignore", invalid="ignore"):
            frac = (np.arccos(np.clip(-a / b, -1, 1)) - np.arccos(np.clip((s_umbral - a) / b, -1, 1))) / np.pi
        frac = np.where(b > 1e-12, frac, ((a > 0) & (a <= s_umbral)).astype(float))
        out.append(float(frac.sum() * paso_d * 24))
    return np.array(out)


def lat_umbral(f, valor, hemisferio, tol=0.005):
    """Menor |latitud| del hemisferio (+1 norte, −1 sur) desde la que f(lat) ≥ valor; f creciente con |lat|. None si no llega."""
    lo, hi = 0.0, 89.999
    if f([hemisferio * hi])[0] < valor:
        return None
    if f([0.0])[0] >= valor:
        return 0.0
    while hi - lo > tol:
        m = (lo + hi) / 2
        if f([hemisferio * m])[0] >= valor:
            hi = m
        else:
            lo = m
    return hemisferio * round(hi, 2)
