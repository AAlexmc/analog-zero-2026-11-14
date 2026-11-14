"""POWER diario: días fríos por año y percentil 95 del viento."""
import datetime as dt

import numpy as np

ORIGEN_POWER = dt.date(1980, 12, 31)


def fecha_power(indice):
    return ORIGEN_POWER + dt.timedelta(days=int(indice))


def indices_periodo(ano0, ano1):
    return (dt.date(ano0, 1, 1) - ORIGEN_POWER).days, (dt.date(ano1, 12, 31) - ORIGEN_POWER).days


def dias_por_ano(tmax, umbral):
    """Días (eje 0) con tmax ≤ umbral, por año medio de 365,25 días."""
    validos = np.isfinite(tmax).sum(axis=0)
    n = (tmax <= umbral).sum(axis=0)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(validos > 0, n * 365.25 / validos, np.nan)


def p95(v):
    return np.nanpercentile(v, 95, axis=0)
