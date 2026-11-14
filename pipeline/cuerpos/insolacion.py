"""Insolación media anual en lo alto de la atmósfera (o en el suelo sin atmósfera) por latitud, sin relieve."""
import numpy as np


def media_anual_w_m2(lat_deg, S_w_m2, oblicuidad_deg, excentricidad, n=7200):
    """S = irradiancia a la distancia del semieje mayor.

    Media diaria en superficie horizontal (S/π)(h0 sinφ sinδ + cosφ cosδ sin h0) con δ = asin(sin ε sin λ),
    promediada en el tiempo sobre la órbita: dt ∝ r² dλ y la irradiancia ∝ 1/r² ⇒ media uniforme en λ × 1/√(1 − e²).
    """
    lam = (np.arange(n) + 0.5) * 2 * np.pi / n
    dec = np.arcsin(np.sin(np.radians(oblicuidad_deg)) * np.sin(lam))[None, :]
    phi = np.radians(np.atleast_1d(np.asarray(lat_deg, dtype=float)))[:, None]
    h0 = np.arccos(np.clip(-np.tan(phi) * np.tan(dec), -1.0, 1.0))
    q = S_w_m2 / np.pi * (h0 * np.sin(phi) * np.sin(dec) + np.cos(phi) * np.cos(dec) * np.sin(h0))
    return q.mean(axis=1) / np.sqrt(1.0 - excentricidad**2)


def kwh_m2_dia(w_m2):
    return np.asarray(w_m2) * 24.0 / 1000.0
