// Pila de deshacer/rehacer de retoques. Cada paso guarda delta antes/después de las celdas tocadas.
export class Historial {
  constructor(limite = 200) {
    this.limite = limite;
    this.pasos = [];
    this.rehechos = [];
    this.trazo = new Map();
  }

  comenzar() { this.trazo = new Map(); }

  terminar(delta) {
    const t = this.trazo;
    this.trazo = new Map();
    const indices = Int32Array.from(t.keys()).sort();
    const antes = new Float32Array(indices.length), despues = new Float32Array(indices.length);
    let cambia = false;
    indices.forEach((i, k) => { antes[k] = t.get(i); despues[k] = delta[i]; if (antes[k] !== despues[k]) cambia = true; });
    if (!cambia) return null;
    return this.#apilar({ indices, antes, despues });
  }

  reemplazar(delta, nuevo) {
    const idx = [];
    for (let i = 0; i < delta.length; i++) if (delta[i] !== nuevo[i]) idx.push(i);
    if (!idx.length) return null;
    const indices = Int32Array.from(idx);
    const paso = { indices, antes: new Float32Array(idx.length), despues: new Float32Array(idx.length) };
    indices.forEach((i, k) => { paso.antes[k] = delta[i]; paso.despues[k] = nuevo[i]; delta[i] = nuevo[i]; });
    return this.#apilar(paso);
  }

  #apilar(paso) {
    this.pasos.push(paso);
    if (this.pasos.length > this.limite) this.pasos.shift();
    this.rehechos = [];
    return paso;
  }

  puedeDeshacer() { return this.pasos.length > 0; }
  puedeRehacer() { return this.rehechos.length > 0; }

  deshacer(delta) {
    const p = this.pasos.pop();
    if (!p) return null;
    p.indices.forEach((i, k) => { delta[i] = p.antes[k]; });
    this.rehechos.push(p);
    return p;
  }

  rehacer(delta) {
    const p = this.rehechos.pop();
    if (!p) return null;
    p.indices.forEach((i, k) => { delta[i] = p.despues[k]; });
    this.pasos.push(p);
    return p;
  }
}
