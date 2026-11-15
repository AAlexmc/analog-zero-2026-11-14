// Equipo plantado en un terreno: lista por panel, (de)serialización y huella a escala desde el catálogo. Sin DOM.
let siguiente = 1;

const celda = (v, n) => Math.min(n - 1, Math.max(0, Math.round(v)));

export class Plantados {
  constructor(n) { this.n = n; this.lista = []; }

  // par: clave que comparte con su gemelo del otro panel (equipo espejo); null si no tiene.
  plantar(equipo, fila, col, par = null) {
    const p = { uid: siguiente++, equipo, fila: celda(fila, this.n), col: celda(col, this.n), par };
    this.lista.push(p);
    return p;
  }

  buscar(uid) { return this.lista.find((p) => p.uid === uid) ?? null; }

  mover(uid, fila, col) {
    const p = this.buscar(uid);
    if (p) { p.fila = celda(fila, this.n); p.col = celda(col, this.n); }
    return p;
  }

  quitar(uid) {
    const i = this.lista.findIndex((p) => p.uid === uid);
    if (i < 0) return false;
    this.lista.splice(i, 1);
    return true;
  }

  aJSON() { return this.lista.map(({ equipo, fila, col, par }) => (par ? { equipo, fila, col, par } : { equipo, fila, col })); }
}

// Disposición de lo plantado (tipo y celda de cada uno, sin orden): de ella dependen la zona apta y las sugerencias.
export const firmaDisposicion = (lista) => lista.map((it) => `${it.equipo}@${it.fila},${it.col}`).sort().join('|');

export function deJSON(arr, { n, ids }) {
  if (!Array.isArray(arr)) throw new Error('planted equipment must be a list');
  const p = new Plantados(n);
  let ignorados = 0;
  for (const x of arr) {
    const ok = x && ids.has(x.equipo) && [x.fila, x.col].every((v) => Number.isInteger(v) && v >= 0 && v < n);
    if (ok) p.plantar(x.equipo, x.fila, x.col, typeof x.par === 'string' && x.par ? x.par : null); else ignorados++;
  }
  return { lista: p.lista, ignorados };
}

// Esquinas en coordenadas de rejilla [fila, col]; rectángulo con el largo sobre las columnas.
export function huella(equipo) {
  for (const c of equipo.cifras ?? []) {
    const v = c.valor;
    if (/dimensiones/.test(c.nombre) && c.unidad === 'm' && Array.isArray(v) && v.length >= 2 && v.every(Number.isFinite)) {
      const [largo, ancho] = v;
      return {
        forma: 'rect', largo_m: largo, ancho_m: ancho, cifra: c,
        esquinas: (f, col, m) => [[-1, -1], [-1, 1], [1, 1], [1, -1]].map(([a, b]) => [f + (a * ancho) / 2 / m, col + (b * largo) / 2 / m]),
      };
    }
    if (c.nombre === 'ancho_entre_caras_m' && Number.isFinite(v) && v > 0) {
      const R = v / Math.sqrt(3);
      return {
        forma: 'hex', entre_caras_m: v, cifra: c,
        esquinas: (f, col, m) => Array.from({ length: 6 }, (_, k) => {
          const t = ((30 + 60 * k) * Math.PI) / 180;
          return [f + (R * Math.sin(t)) / m, col + (R * Math.cos(t)) / m];
        }),
      };
    }
  }
  return null;
}
