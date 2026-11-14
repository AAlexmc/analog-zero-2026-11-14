import argparse
import json

from . import generar as g


def parser():
    p = argparse.ArgumentParser(prog="python -m pipeline.terreno")
    sub = p.add_subparsers(dest="orden", required=True)
    a = sub.add_parser("generar", help="un terreno cualquiera")
    a.add_argument("--id", required=True)
    a.add_argument("--cuerpo", required=True, choices=["luna", "tierra"])
    a.add_argument("--lat", type=float, required=True)
    a.add_argument("--lon", type=float, required=True)
    a.add_argument("--lado-km", type=float, required=True)
    a.add_argument("--n", type=int, required=True)
    a.add_argument("--escala", required=True, choices=["sitio", "regional"])
    a.add_argument("--nombre")
    a.add_argument("--centro-fuente")
    a.add_argument("--capas", help="lista separada por comas: iluminacion,sombra_permanente,temp_max (Luna), agua (Tierra)")
    a.add_argument("--dem", help="LDEM polar de LOLA para la Luna (por defecto ldem_85s_20m)")
    a.add_argument("--notas")
    c = sub.add_parser("capa", help="añade o rehace una capa de un terreno ya generado sin tocar su altura")
    c.add_argument("--id", required=True)
    c.add_argument("--capa", required=True, help="p. ej. agua (solo terrenos de la Tierra)")
    sub.add_parser("borde", help="punto del borde de Shackleton con mayor iluminación media")
    pl = sub.add_parser("picos", help="añade picos_luz al meta.json de terrenos lunares ya generados")
    pl.add_argument("--id", help="sin --id: todos los terrenos lunares de index.json")
    sub.add_parser("todos", help="todos los sitios de sitios.json")
    return p


def sitio_de_args(args):
    s = {"id": args.id, "cuerpo": args.cuerpo, "nombre": args.nombre or args.id, "lat": args.lat, "lon": args.lon,
         "lado_km": args.lado_km, "n": args.n, "escala": args.escala}
    for k in ("centro_fuente", "dem", "notas"):
        if getattr(args, k):
            s[k] = getattr(args, k)
    if args.capas:
        s["capas"] = args.capas.split(",")
    return s


def main():
    args = parser().parse_args()
    if args.orden == "borde":
        print(g.borde_mas_iluminado())
        return
    if args.orden == "picos":
        ids = [args.id] if args.id else [t["id"] for t in json.loads((g.SALIDA / "index.json").read_text())["terrenos"]
                                          if t["cuerpo"] == "luna"]
        for i in ids:
            m = g.anadir_picos(i)
            print(i + ": " + "; ".join(f"({p['fila']},{p['col']}) {p['lat']},{p['lon']} {p['valor']}"
                                        for p in m["picos_luz"]["puntos"]))
        return
    if args.orden == "capa":
        m = g.anadir_capa(args.id, args.capa)
        c = m["capas"][args.capa]
        print(f"{m['id']}: {c['fichero']} teselas={len(c.get('teselas', []))}")
        return
    if args.orden == "todos":
        sitios = g.cargar_sitios()["sitios"]
    else:
        sitios = [sitio_de_args(args)]
    for s in sitios:
        m = g.generar(s)
        print(f"{m['id']}: n={m['n']} m/px={m['m_por_px']:.4f} z=[{m['z_min']:.1f}, {m['z_max']:.1f}] "
              f"rasgos={len(m.get('rasgos', []))} capas={','.join(m['capas'])}")


if __name__ == "__main__":
    main()
