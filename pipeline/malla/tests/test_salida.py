import json

import numpy as np
import pytest
import xarray as xr

from pipeline.malla import rejilla, salida


def _vars():
    tierra = np.zeros((360, 720), dtype=np.float32)
    tierra[100:110, 200:220] = 1.0
    t = np.full((360, 720), np.nan, dtype=np.float32)
    t[100:110, 200:210] = 5.0
    return {
        "tierra_frac": (tierra, {"units": "1", "fuente": "https://ejemplo.org/a"}),
        "t_media_c": (t, {"units": "degC", "fuente": "https://ejemplo.org/b"}),
    }


def test_escribe_version_que_abre_con_xarray_y_meta(tmp_path):
    salida.escribe_malla(_vars(), 1, tmp_path)
    assert (tmp_path / "malla_actual.txt").read_text().strip() == "malla_v1.nc"
    with xr.open_dataset(tmp_path / "malla_v1.nc") as ds:
        assert ds.lat.values[0] == -89.75 and ds.lat.values[-1] == 89.75
        assert ds.lon.values[0] == -179.75 and ds.lon.values[-1] == 179.75
        assert ds["t_media_c"].dims == ("lat", "lon")
        assert ds["t_media_c"].attrs["units"] == "degC"
        assert ds["t_media_c"].attrs["fuente"].startswith("https://")
        assert int(ds.attrs["version"]) == 1
    meta = json.loads((tmp_path / "malla_meta.json").read_text())
    assert meta["version"] == 1 and meta["fichero"] == "malla_v1.nc"
    v = meta["variables"]["t_media_c"]
    assert v["min"] == 5.0 and v["max"] == 5.0 and v["media"] == 5.0
    assert v["pct_nan_tierra"] == pytest.approx(50.0)
    assert not list(tmp_path.glob("*.tmp"))


def test_sin_units_o_fuente_no_escribe(tmp_path):
    v = _vars()
    v["t_media_c"] = (v["t_media_c"][0], {"units": "degC"})
    with pytest.raises(ValueError):
        salida.escribe_malla(v, 1, tmp_path)
    assert not (tmp_path / "malla_v1.nc").exists()


def test_criterio_propio_sin_url_pero_con_origen_mio(tmp_path):
    v = _vars()
    v["elev_solar_max_deg"] = (np.zeros((360, 720), np.float32), {"units": "deg", "fuente": "mío", "origen": "mío", "formula": "x"})
    salida.escribe_malla(v, 2, tmp_path)
    meta = json.loads((tmp_path / "malla_meta.json").read_text())
    assert meta["variables"]["elev_solar_max_deg"]["origen"] == "mío"


def test_lee_actual(tmp_path):
    assert salida.lee_actual(tmp_path) == ({}, 0)
    salida.escribe_malla(_vars(), 3, tmp_path)
    vars_, n = salida.lee_actual(tmp_path)
    assert n == 3 and set(vars_) == {"tierra_frac", "t_media_c"}
    assert np.array_equal(vars_["t_media_c"][0], _vars()["t_media_c"][0], equal_nan=True)


def test_previsualizacion_png(tmp_path):
    salida.escribe_malla(_vars(), 1, tmp_path)
    p = salida.previsualiza(tmp_path / "malla_v1.nc", "t_media_c", tmp_path / "png")
    assert p.exists() and p.stat().st_size > 1000
