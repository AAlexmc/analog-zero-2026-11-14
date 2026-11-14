import numpy as np

from pipeline.terreno import capas, georef

CAB = ("      tri1_x,       tri1_y,       tri1_z,       tri2_x,       tri2_y,       tri2_z,       tri3_x,       tri3_y,"
       "       tri3_z,        tri_clon,        tri_clat,        tri_calt, temp_avg, temp_max,   ice_depth")


def _fila(lon, lat, tmax, tavg=100.0):
    v = ["   299.52036"] * 9
    return ",  ".join(v) + f",  {lon:14.9f},  {lat:14.9f},     0.579086423, {tavg:8.3f}, {tmax:8.3f},  -999.00000"


def test_lee_tabla_prp(tmp_path):
    p = tmp_path / "prp.tab"
    filas = [CAB.ljust(208), _fila(-45.015949249, -75.905227661, 272.164), _fila(129.5, -89.7, 41.5)]
    p.write_bytes(("\r\n".join(f.ljust(208) for f in filas) + "\r\n").encode())
    lon, lat, tmax = capas.leer_prp(p)
    assert np.allclose(lon, [-45.015949249, 129.5]) and np.allclose(lat, [-75.905227661, -89.7])
    assert np.allclose(tmax, [272.164, 41.5])


def test_interpolacion_dispersa_lineal_exacta_y_nan_fuera():
    rng = np.random.default_rng(0)
    R = 1737400.0
    x = rng.uniform(-30000, 30000, 4000)
    y = rng.uniform(-30000, 30000, 4000)
    lat, lon = georef.estereo_inversa("sur", x, y, R)
    val = 50 + 0.001 * x - 0.002 * y
    n, m = 64, 500.0
    g = georef.georef_estereo("sur", R, 0.0, 0.0, n, m)
    rej = georef.Rejilla(g, n, m, -90.0, 0.0)
    out = capas.disperso_a_rejilla(lon, lat, val, rej)
    gx, gy = rej.xy_todos()
    dentro = (np.abs(gx) < 28000) & (np.abs(gy) < 28000)
    assert np.allclose(out[dentro], (50 + 0.001 * gx - 0.002 * gy)[dentro], atol=1e-3)
    # rejilla mayor que la nube: los bordes quedan sin dato
    g2 = georef.georef_estereo("sur", R, 0.0, 0.0, n, 1500.0)
    out2 = capas.disperso_a_rejilla(lon, lat, val, georef.Rejilla(g2, n, 1500.0, -90.0, 0.0))
    assert np.isnan(out2[0, 0]) and np.isfinite(out2[32, 32])
