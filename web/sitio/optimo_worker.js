// Cálculo del mejor sitio fuera del hilo de la página (la rejilla lunar tiene 1 048 576 celdas).
import { cargarMundo, mejorSitio, valoresEn } from './optimo.js';

let M = null;
self.onmessage = async ({ data: d }) => {
  try {
    if (d.tipo === 'cargar') {
      M = await cargarMundo(d.indice, d.id, d.base, { radio_km: d.radio_km });
      self.postMessage({ n: d.n, ok: !!M });
    } else if (d.tipo === 'calcular') {
      const t0 = performance.now();
      const r = mejorSitio(M, d.ajustes);
      self.postMessage({ n: d.n, r, ms: performance.now() - t0 });
    } else if (d.tipo === 'valores') {
      self.postMessage({ n: d.n, v: valoresEn(M, d.lat, d.lon, d.ajustes) });
    }
  } catch (e) {
    self.postMessage({ n: d.n, error: String(e?.message ?? e) });
  }
};
