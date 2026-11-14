import datetime as dt

import numpy as np
import pytest

from pipeline.malla import frio


def test_indice_de_tiempo_power_es_dias_desde_1980_12_31():
    assert frio.fecha_power(0) == dt.date(1980, 12, 31)
    assert frio.fecha_power(10958) == dt.date(2011, 1, 1)
    assert frio.indices_periodo(2011, 2020) == (10958, 14610)


def test_dias_bajo_umbral_por_ano():
    # 2 años de 365 días: 30 días ≤ −23 en el primero, 50 en el segundo → 40 días/año.
    t = np.full((730, 2), 5.0)
    t[:30, 0] = -30.0
    t[365:415, 0] = -23.0
    t[:, 1] = np.nan
    d = frio.dias_por_ano(t, -23.0)
    assert d[0] == pytest.approx(40 * 365.25 / 365)
    assert np.isnan(d[1])


def test_p95():
    v = np.arange(1, 101, dtype=float)[:, None]
    assert frio.p95(v)[0] == pytest.approx(np.percentile(np.arange(1, 101), 95))
