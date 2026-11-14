import os
from pathlib import Path

import numpy as np
import pytest

from pipeline.cuerpos import insolacion

S = 1361.0


def test_sin_oblicuidad_ni_excentricidad_el_ecuador_recibe_s_entre_pi():
    assert insolacion.media_anual_w_m2([0.0], S, 0.0, 0.0)[0] == pytest.approx(S / np.pi, rel=1e-9)


def test_media_sobre_la_esfera_es_s_cuartos_por_la_excentricidad():
    lat = -90 + 0.25 + 0.5 * np.arange(360)
    q = insolacion.media_anual_w_m2(lat, S, 25.19, 0.0935)
    w = np.cos(np.radians(lat))
    assert np.sum(q * w) / np.sum(w) == pytest.approx(S / 4 / np.sqrt(1 - 0.0935**2), rel=2e-4)


def test_polo_con_oblicuidad_pequena_es_s_sin_eps_entre_pi():
    q = insolacion.media_anual_w_m2([90.0], S, 1.535, 0.0)[0]
    assert q == pytest.approx(S * np.sin(np.radians(1.535)) / np.pi, rel=1e-4)


def test_simetria_norte_sur():
    q = insolacion.media_anual_w_m2([-60.25, 60.25], S, 23.44, 0.0167)
    assert q[0] == pytest.approx(q[1], rel=1e-12)


SYN = Path(os.environ.get("AZ_DATOS", "/home/ale/nasa-space-apps-2026/datos")) / "raw/power/syn1deg/spatial/power_syn1deg_climatology_spatial_utc.zarr"


@pytest.mark.skipif(not SYN.exists(), reason="sin POWER SYN1deg en disco")
def test_con_datos_de_la_tierra_coincide_con_el_toa_de_power():
    import xarray as xr

    ds = xr.open_zarr(SYN, decode_times=False)
    assert ds["TOA_SW_DWN"].attrs["units"] == "W m-2"
    power = ds["TOA_SW_DWN"].isel(time=12).mean("lon").values
    mio = insolacion.media_anual_w_m2(ds.lat.values, S, 23.44, 0.0167)
    assert np.max(np.abs(mio / power - 1)) < 0.01
