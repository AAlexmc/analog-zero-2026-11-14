"""Previsualizaciones para revisar a mano: build/global/<par>_S.png y top20_<par>.txt."""
import io
from pathlib import Path

import numpy as np

from pipeline.exportar.copiar import _atomico
from pipeline.malla import rejilla
from pipeline.motor import similitud as sim


def mapa_S(ds, pid, tierra, sitios, ruta):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    S = ds["S"].values
    fondo = np.where(tierra, 0.8, 1.0)
    fig, ax = plt.subplots(figsize=(14, 7.2))
    ax.imshow(fondo, origin="lower", extent=(-180, 180, -90, 90), cmap="gray", vmin=0, vmax=1, interpolation="nearest")
    im = ax.imshow(np.ma.masked_invalid(S), origin="lower", extent=(-180, 180, -90, 90), cmap="viridis", vmin=0, vmax=1,
                   interpolation="nearest")
    fig.colorbar(im, ax=ax, shrink=0.75, label="S (gate failed = 0; grey = not evaluable)")
    for s in sitios:
        ax.plot(s["lon"], s["lat"], marker=s.get("marca", "x"), color="red", ms=6, mew=1.5)
        ax.annotate(s["id"], (s["lon"], s["lat"]), fontsize=6, color="red", xytext=(3, 3), textcoords="offset points")
    ax.set_title(f"{pid} · {ds.attrs.get('malla', '')} · umbrales {ds.attrs.get('umbrales_sha256', '')[:12]}", fontsize=9)
    ax.set_xlabel("lon")
    ax.set_ylabel("lat")
    buf = io.BytesIO()
    fig.savefig(buf, dpi=100, bbox_inches="tight", format="png")
    plt.close(fig)
    _atomico(Path(ruta), buf.getvalue())


def top20(ds, pid, orden, ruta, n=20):
    S = ds["S"].values
    ok = (ds["estado"].values == sim.PASA) & np.isfinite(S)
    idx = np.flatnonzero(ok.ravel())
    sel = idx[np.argsort(-S.ravel()[idx], kind="stable")][:n]
    lat, lon = rejilla.lat_centros(), rejilla.lon_centros()
    lineas = [f"# {pid} · {ds.attrs.get('malla', '')} · top {n} evaluables por S (celdas que pasan puertas, C ≥ mínima)",
              "puesto\tlat\tlon\tS\tS_p5\tS_p95\tC\t" + "\t".join(orden)]
    for k, f in enumerate(sel, 1):
        i, j = divmod(int(f), rejilla.N_LON)
        v = lambda c: ds[c].values[i, j]  # noqa: E731
        dims = "\t".join("nan" if not np.isfinite(v(f"s_{d}")) else f"{v(f's_{d}'):.3f}" for d in orden)
        lineas.append(f"{k}\t{lat[i]:.2f}\t{lon[j]:.2f}\t{v('S'):.4f}\t{v('S_p5'):.4f}\t{v('S_p95'):.4f}\t{v('C'):.3f}\t{dims}")
    _atomico(Path(ruta), ("\n".join(lineas) + "\n").encode("utf-8"))
    return lineas
