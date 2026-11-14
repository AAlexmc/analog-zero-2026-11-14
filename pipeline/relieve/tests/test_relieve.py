import json
from pathlib import Path

import numpy as np
import pytest

from pipeline.relieve import __main__ as rl

RAIZ = Path(__file__).resolve().parents[3]
SALIDA = RAIZ / "web" / "data" / "relieve"

LBL_LOLA = """PDS_VERSION_ID            = "PDS3"
    LINES                 = 180
    LINE_SAMPLES          = 360
    SAMPLE_TYPE           = LSB_INTEGER
    SAMPLE_BITS           = 16
    UNIT                  = METER
    SCALING_FACTOR        = 0.5
    OFFSET                = 1737400.
 MAP_RESOLUTION               = 1 <pix/deg>
 A_AXIS_RADIUS                = 1737.4 <km>
 MAP_SCALE                    = 30323.4 <m/pix>
 MAXIMUM_LATITUDE             = 90 <deg>
 WESTERNMOST_LONGITUDE        = 0 <deg>
 LINE_PROJECTION_OFFSET       = 89.5 <pix>
 SAMPLE_PROJECTION_OFFSET     = 179.5 <pix>
END
"""

LBL_MOLA = """PDS_VERSION_ID                = PDS3
 LINES                        = 180
 LINE_SAMPLES                 = 360
 SAMPLE_TYPE                  = MSB_INTEGER
 SAMPLE_BITS                  = 16
 UNIT                         = METER
 A_AXIS_RADIUS                = 3396.0 <KM>
 MAP_RESOLUTION               = 1.0 <PIXEL/DEGREE>
 MAP_SCALE                    = 59.27 <KM/PIXEL>
 MAXIMUM_LATITUDE             = 90.0 <DEGREE>
 WESTERNMOST_LONGITUDE        = 0.0 <DEGREE>
 LINE_PROJECTION_OFFSET       = 90.5
 SAMPLE_PROJECTION_OFFSET     = 180.5
END
"""


def _crudo(tmp_path, nombre, lbl, dtype):
    z = (np.arange(180)[:, None] * 1000 + np.arange(360)[None, :]).astype(np.int32) % 30000 - 15000
    (tmp_path / f"{nombre}.lbl").write_text(lbl)
    z.astype(dtype).tofile(tmp_path / f"{nombre}.img")
    return z.astype(np.int16)


def test_etiqueta_lola_lleva_factor_y_radio_de_referencia():
    e = rl.etiqueta(LBL_LOLA)
    assert (e["filas"], e["columnas"], e["ppd"]) == (180, 360, 1.0)
    assert e["orden"] == "<" and e["factor_m"] == 0.5 and e["radio_m"] == 1737400.0
    assert e["m_por_px"] == 30323.4


def test_etiqueta_mola_sin_factor_es_un_metro_y_big_endian():
    e = rl.etiqueta(LBL_MOLA)
    assert e["orden"] == ">" and e["factor_m"] == 1.0 and e["radio_m"] == 3396000.0
    assert e["m_por_px"] == 59270.0


def test_etiqueta_rechaza_lo_que_no_es_global_desde_0_este():
    with pytest.raises(AssertionError):
        rl.etiqueta(LBL_MOLA.replace("WESTERNMOST_LONGITUDE        = 0.0", "WESTERNMOST_LONGITUDE        = 180.0"))


def test_a_web_pasa_a_little_endian_y_empieza_en_menos_180(tmp_path):
    z = _crudo(tmp_path, "m", LBL_MOLA, ">i2")
    e = rl.etiqueta(LBL_MOLA)
    w = rl.a_web(tmp_path / "m.img", e)
    assert w.dtype == np.dtype("<i2") and w.shape == (180, 360)
    # columna 0 del crudo = centro 0,5° E → en la web, columna 180 (centro −180 + 180,5 = 0,5° E)
    np.testing.assert_array_equal(w[:, 180], z[:, 0])
    np.testing.assert_array_equal(w[:, 0], z[:, 180])
    np.testing.assert_array_equal(w[7], np.roll(z[7], 180))


def test_escribir_es_determinista_y_el_indice_dice_la_escala(tmp_path):
    _crudo(tmp_path, "l", LBL_LOLA, "<i2")
    _crudo(tmp_path, "m", LBL_MOLA, ">i2")
    tex = tmp_path / "t.png"
    from PIL import Image
    Image.new("RGB", (8, 4), (120, 110, 100)).save(tex)
    fuentes = {
        "moon": {"img": tmp_path / "l.img", "lbl": tmp_path / "l.lbl", "url": "u1", "url_etiqueta": "u1l", "fuente": "f1", "textura": tex, "textura_credito": "c"},
        "mars": {"img": tmp_path / "m.img", "lbl": tmp_path / "m.lbl", "url": "u2", "url_etiqueta": "u2l", "fuente": "f2", "textura": tex, "textura_credito": "c"},
    }
    a, b = tmp_path / "a", tmp_path / "b"
    rl.escribir(a, fuentes)
    rl.escribir(b, fuentes)
    for f in ("moon_1ppd.i16", "mars_1ppd.i16", "indice.json"):
        assert (a / f).read_bytes() == (b / f).read_bytes(), f
    idx = json.loads((a / "indice.json").read_text())
    assert idx["mundos"]["moon"]["factor_m"] == 0.5 and idx["mundos"]["mars"]["factor_m"] == 1.0
    assert idx["mundos"]["moon"]["fichero"] == "moon_1ppd.i16"
    assert idx["mundos"]["mars"]["radio_m"] == 3396000.0
    assert idx["mundos"]["moon"]["tono_medio_rgb"] == [120, 110, 100]
    assert "url" in idx["mundos"]["mars"]["fuente"]
    assert (a / "moon_1ppd.i16").stat().st_size == 180 * 360 * 2


def test_tono_medio_pesa_por_area():
    from PIL import Image
    im = Image.new("RGB", (4, 2), (0, 0, 0))
    # fila de arriba (cerca del polo en un mapa de 2 filas) y de abajo pesan igual por simetría
    for x in range(4):
        im.putpixel((x, 0), (200, 200, 200))
    assert rl.tono_medio(im) == [100, 100, 100]
    im = Image.new("RGB", (4, 4), (0, 0, 0))
    for x in range(4):
        im.putpixel((x, 0), (255, 255, 255))
    # la fila polar pesa menos que 1/4
    assert rl.tono_medio(im)[0] < 255 / 4


@pytest.mark.skipif(not (SALIDA / "indice.json").exists(), reason="sin web/data/relieve generado")
def test_salida_real_coincide_con_el_crudo():
    idx = json.loads((SALIDA / "indice.json").read_text())
    for mundo, f in rl.FUENTES.items():
        m = idx["mundos"][mundo]
        assert (m["ancho"], m["alto"], m["ppd"]) == (5760, 2880, 16)
        w = np.memmap(SALIDA / m["fichero"], dtype="<i2", mode="r", shape=(2880, 5760))
        if not f["img"].exists():
            continue
        e = rl.etiqueta(f["lbl"].read_text())
        crudo = np.memmap(f["img"], dtype=f"{e['orden']}i2", mode="r", shape=(2880, 5760))
        for fila, col in ((0, 0), (1440, 17), (2879, 5759), (2000, 3000)):
            assert w[fila, (col + 2880) % 5760] == crudo[fila, col]
