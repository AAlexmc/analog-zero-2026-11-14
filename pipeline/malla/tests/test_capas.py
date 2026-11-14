import numpy as np
import pytest

from pipeline.malla import construir


def test_ndvi_por_color_mas_cercano_y_transparente_es_nan():
    rgb_ref = np.array([[241, 236, 236], [0, 100, 0], [0, 24, 1]], dtype=np.float32)
    val_ref = np.array([0.0026, 0.80, 0.995], dtype=np.float32)
    a = np.zeros((1, 4, 4), dtype=np.uint8)
    a[0, 0] = [241, 236, 236, 255]
    a[0, 1] = [2, 99, 1, 255]  # no casa exacto: el más cercano es (0,100,0)
    a[0, 2] = [0, 0, 0, 0]
    a[0, 3] = [0, 25, 1, 255]
    v = construir.ndvi_de_png(a, rgb_ref, val_ref)
    assert v[0, 0] == pytest.approx(0.0026)
    assert v[0, 1] == pytest.approx(0.80)
    assert np.isnan(v[0, 2])
    assert v[0, 3] == pytest.approx(0.995)


def test_colormap_ndvi_real_sin_entradas_transparentes():
    if not (construir.DATOS / "ndvi_gibs/MODIS_NDVI_colormap.xml").exists():
        pytest.skip("sin datos crudos")
    rgb, val = construir._colormap_ndvi()
    assert len(rgb) == len(val) and len(val) > 100
    assert val.min() > 0 and val.max() <= 1.0
    assert np.all(np.diff(val) > 0)
