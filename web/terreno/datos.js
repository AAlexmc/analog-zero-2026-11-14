// Carga de web/data/terreno según docs/contrato-terreno.md.
export const RAIZ_DATOS = '../data/terreno';

const LE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

async function pedir(url, tipo) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return tipo === 'json' ? r.json() : r.arrayBuffer();
}

function aFloat32(buf, tipo) {
  if (tipo === 'uint8') {
    const u = new Uint8Array(buf), f = new Float32Array(u.length);
    for (let i = 0; i < u.length; i++) f[i] = u[i] === 255 ? NaN : u[i];
    return f;
  }
  if (LE) return new Float32Array(buf);
  const dv = new DataView(buf), f = new Float32Array(buf.byteLength / 4);
  for (let i = 0; i < f.length; i++) f[i] = dv.getFloat32(i * 4, true);
  return f;
}

export async function cargarIndice() {
  try { return await pedir(`${RAIZ_DATOS}/index.json`, 'json'); } catch {
    throw new Error('terrain data not found: index.json');
  }
}

// Catálogos que copia pipeline/exportar a web/data/: null si no está; error si está roto.
export async function cargarCatalogo(nombre) {
  let r;
  try { r = await fetch(`../data/${nombre}`, { cache: 'no-cache' }); } catch { return null; }
  if (!r.ok) return null;
  try { return await r.json(); } catch { throw new Error(`${nombre} is broken (not valid JSON)`); }
}

// Devuelve {meta, altura, bytesAltura, capas: {nombre: Float32Array}, notas: []}
export async function cargarTerreno(id) {
  let meta, buf;
  try {
    meta = await pedir(`${RAIZ_DATOS}/${encodeURIComponent(id)}/meta.json`, 'json');
    buf = await pedir(`${RAIZ_DATOS}/${encodeURIComponent(id)}/${meta.capas.altura.fichero}`, 'bin');
  } catch {
    throw new Error(`terrain data not found: ${id}`);
  }
  const n = meta.n;
  if (buf.byteLength !== n * n * 4) throw new Error(`terrain data broken: ${id} (altura size ${buf.byteLength} ≠ ${n * n * 4})`);
  const notas = [];
  const capas = {};
  for (const [nombre, c] of Object.entries(meta.capas)) {
    if (nombre === 'altura') continue;
    try {
      const b = await pedir(`${RAIZ_DATOS}/${encodeURIComponent(id)}/${c.fichero}`, 'bin');
      const tam = c.tipo === 'uint8' ? 1 : 4;
      if (b.byteLength !== n * n * tam) throw new Error('size');
      capas[nombre] = aFloat32(b, c.tipo);
    } catch {
      notas.push(`layer ${nombre} not available`);
    }
  }
  return { meta, altura: aFloat32(buf, 'float32'), bytesAltura: new Uint8Array(buf), capas, notas };
}
