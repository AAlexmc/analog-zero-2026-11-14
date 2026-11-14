// Formato de retoque de docs/contrato-terreno.md y sus cifras.
export function estadisticas(delta, m_por_px) {
  let celdas = 0, exc = 0, rel = 0;
  for (let i = 0; i < delta.length; i++) {
    const d = delta[i];
    if (d === 0 || !Number.isFinite(d)) continue;
    celdas++;
    if (d > 0) rel += d; else exc -= d;
  }
  const a = m_por_px * m_por_px;
  return { celdas, excavado_m3: exc * a, rellenado_m3: rel * a };
}

export function exportarRetoque(id, n, sha, delta) {
  const indices = [], delta_m = [];
  for (let i = 0; i < delta.length; i++) {
    if (delta[i] !== 0 && Number.isFinite(delta[i])) { indices.push(i); delta_m.push(+delta[i].toPrecision(9)); }
  }
  return { terreno: id, n, base_sha256: sha, celdas: { indices, delta_m } };
}

export function importarRetoque(obj, { id, n, sha }) {
  if (!obj || typeof obj !== 'object') throw new Error('not a retouch file');
  if (obj.terreno !== id) throw new Error(`retouch is for terrain "${obj.terreno}", not "${id}"`);
  if (obj.n !== n) throw new Error(`grid size n=${obj.n} does not match n=${n}`);
  if (obj.base_sha256 !== sha) throw new Error('base data differs from the one retouched (sha256 mismatch)');
  const c = obj.celdas;
  if (!c || !Array.isArray(c.indices) || !Array.isArray(c.delta_m)) throw new Error('missing celdas.indices / celdas.delta_m');
  if (c.indices.length !== c.delta_m.length) throw new Error('indices and delta_m length differ');
  const delta = new Float32Array(n * n);
  for (let k = 0; k < c.indices.length; k++) {
    const i = c.indices[k], d = c.delta_m[k];
    if (!Number.isInteger(i) || i < 0 || i >= n * n) throw new Error(`cell index out of range: ${i}`);
    if (typeof d !== 'number' || !Number.isFinite(d)) throw new Error(`invalid delta at cell ${i}`);
    delta[i] = d;
  }
  return delta;
}
