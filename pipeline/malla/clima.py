"""Hargreaves (FAO-56 ec. 21 y 52), aridez P/PET y geometría solar por latitud."""
import numpy as np

OK, NA, SIN_DATO = 0, 1, 2
DIAS_MES = np.array([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31], dtype=float)
DIA_MEDIO_MES = np.array([15, 46, 74, 105, 135, 162, 198, 228, 258, 288, 318, 344], dtype=float)
PET_MIN_MM = 100.0
OBLICUIDAD = 23.44


def ra_mj_m2_dia(lat_deg, dia):
    phi = np.radians(lat_deg)
    dia = np.asarray(dia, dtype=float)
    dr = 1 + 0.033 * np.cos(2 * np.pi * dia / 365)
    dec = 0.409 * np.sin(2 * np.pi * dia / 365 - 1.39)
    ws = np.arccos(np.clip(-np.tan(phi) * np.tan(dec), -1.0, 1.0))
    ra = 24 * 60 / np.pi * 0.0820 * dr * (ws * np.sin(phi) * np.sin(dec) + np.cos(phi) * np.cos(dec) * np.sin(ws))
    return np.maximum(ra, 0.0)


def hargreaves_mm_dia(t_media_c, rango_k, ra_mj):
    et0 = 0.0023 * 0.408 * np.asarray(ra_mj) * (np.asarray(t_media_c) + 17.8) * np.sqrt(np.maximum(rango_k, 0.0))
    # Bajo −17,8 °C la fórmula da negativo: ese mes cuenta 0.
    return np.maximum(et0, 0.0)


def aridez(p_mm_dia, et0_mm_dia):
    """Meses en el eje 0. Devuelve (P/PET, PET anual mm, estado)."""
    d = DIAS_MES.reshape((12,) + (1,) * (np.ndim(p_mm_dia) - 1))
    p = np.sum(np.asarray(p_mm_dia) * d, axis=0)
    pet = np.sum(np.asarray(et0_mm_dia) * d, axis=0)
    estado = np.where(~np.isfinite(p) | ~np.isfinite(pet), SIN_DATO, np.where(pet < PET_MIN_MM, NA, OK))
    with np.errstate(invalid="ignore", divide="ignore"):
        ai = np.where(estado == OK, p / np.where(pet > 0, pet, np.nan), np.nan)
    if np.ndim(ai) == 0:
        return float(ai), float(pet), int(estado)
    return ai, pet, estado.astype(np.int8)


def elev_solar_max_deg(lat):
    return np.minimum(90.0, 90.0 - np.abs(lat) + OBLICUIDAD)


def f_low(lat, umbral_deg=10.0):
    """Fracción de las horas con sol sobre el horizonte en que su elevación es < umbral; año medio, sin atmósfera ni relieve."""
    phi = np.radians(np.asarray(lat, dtype=float))[:, None]
    dias = np.arange(1, 366)
    dec = np.radians(OBLICUIDAD * np.sin(2 * np.pi * (284 + dias) / 365))[None, :]
    num = np.cos(phi) * np.cos(dec)

    def semiarco(e):
        with np.errstate(invalid="ignore", divide="ignore"):
            x = (np.sin(np.radians(e)) - np.sin(phi) * np.sin(dec)) / num
        return np.arccos(np.clip(np.nan_to_num(x, nan=0.0, posinf=1.0, neginf=-1.0), -1.0, 1.0))

    h0, h10 = semiarco(0.0), semiarco(umbral_deg)
    return (h0 - h10).sum(axis=1) / h0.sum(axis=1)
