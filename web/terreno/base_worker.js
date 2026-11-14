// generarBase fuera del hilo de la página; un Worker por cálculo (cancelar = terminarlo).
import { generarBase } from './base.js';
import { aligerar } from './panel_base.js';

self.onmessage = ({ data: q }) => {
  try {
    const t0 = performance.now();
    const r = generarBase(q.t, q.piezas, q.vehiculo, q.opc);
    self.postMessage({ ok: true, r: aligerar(r), ms: performance.now() - t0 });
  } catch (e) {
    self.postMessage({ ok: false, error: e.message });
  }
};
