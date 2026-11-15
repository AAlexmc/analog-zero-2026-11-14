import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, crc32 } from 'node:zlib';
import { decodificarPng } from '../relieve/png.js';
import { decodificarTerrarium } from '../relieve/calculo.js';

const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };

// PNG de 8 bits con el filtro pedido en cada fila (filtros[j % filtros.length]); pix = bytes sin filtrar, canales por píxel.
function png(ancho, alto, canales, tipo, pix, filtros, { trozos = 1, paleta = null, entrelazado = 0 } = {}) {
  const linea = ancho * canales, crudo = Buffer.alloc((linea + 1) * alto);
  for (let j = 0; j < alto; j++) {
    const f = filtros[j % filtros.length], o = j * (linea + 1);
    crudo[o] = f;
    for (let i = 0; i < linea; i++) {
      const x = pix[j * linea + i], a = i >= canales ? pix[j * linea + i - canales] : 0, b = j ? pix[(j - 1) * linea + i] : 0, c = j && i >= canales ? pix[(j - 1) * linea + i - canales] : 0;
      crudo[o + 1 + i] = (x - [0, a, b, (a + b) >> 1, paeth(a, b, c)][f]) & 255;
    }
  }
  const trozo = (nombre, datos) => {
    const t = Buffer.from(nombre, 'latin1'), l = Buffer.alloc(4), c = Buffer.alloc(4);
    l.writeUInt32BE(datos.length); c.writeUInt32BE(crc32(Buffer.concat([t, datos])) >>> 0);
    return Buffer.concat([l, t, datos, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0); ihdr.writeUInt32BE(alto, 4); ihdr[8] = 8; ihdr[9] = tipo; ihdr[12] = entrelazado;
  const z = deflateSync(crudo), corte = Math.ceil(z.length / trozos);
  const idat = Array.from({ length: trozos }, (_, k) => trozo('IDAT', z.subarray(k * corte, (k + 1) * corte)));
  const b = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo('IHDR', ihdr), ...(paleta ? [trozo('PLTE', Buffer.from(paleta))] : []), ...idat, trozo('IEND', Buffer.alloc(0))]);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

const ruido = (n, semilla = 7) => { let s = semilla; return Uint8Array.from({ length: n }, () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s >> 16) & 255; }); };

test('RGB with every row filter decodes to the exact bytes, alpha 255', async () => {
  const w = 37, h = 23, pix = ruido(w * h * 3);
  const r = await decodificarPng(png(w, h, 3, 2, pix, [0, 1, 2, 3, 4], { trozos: 3 }));
  assert.equal(r.ancho, w); assert.equal(r.alto, h); assert.equal(r.rgba.length, w * h * 4);
  for (let i = 0; i < w * h; i++) {
    assert.equal(r.rgba[4 * i], pix[3 * i]); assert.equal(r.rgba[4 * i + 1], pix[3 * i + 1]); assert.equal(r.rgba[4 * i + 2], pix[3 * i + 2]); assert.equal(r.rgba[4 * i + 3], 255);
  }
});

test('RGBA, greyscale and palette decode too', async () => {
  const w = 9, h = 7;
  const rgba = ruido(w * h * 4, 3), a = await decodificarPng(png(w, h, 4, 6, rgba, [4, 3, 1]));
  assert.deepEqual([...a.rgba], [...rgba]);
  const gris = ruido(w * h, 5), g = await decodificarPng(png(w, h, 1, 0, gris, [2, 4]));
  for (let i = 0; i < w * h; i++) assert.deepEqual([...g.rgba.subarray(4 * i, 4 * i + 4)], [gris[i], gris[i], gris[i], 255]);
  const idx = Uint8Array.from({ length: w * h }, (_, i) => i % 3), p = await decodificarPng(png(w, h, 1, 3, idx, [0, 1], { paleta: [10, 20, 30, 40, 50, 60, 70, 80, 90] }));
  for (let i = 0; i < w * h; i++) assert.deepEqual([...p.rgba.subarray(4 * i, 4 * i + 3)], [10 + 30 * idx[i], 20 + 30 * idx[i], 30 + 30 * idx[i]]);
  await assert.rejects(decodificarPng(png(2, 2, 1, 3, Uint8Array.from([0, 1, 200, 0]), [0], { paleta: [1, 2, 3, 4, 5, 6] })), /palette index out of range/);
});

test('a Terrarium tile keeps every height exactly: no cell off by 256 m', async () => {
  const n = 64, pix = new Uint8Array(n * n * 3), alturas = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const h = 500 + 300 * Math.sin(i / 97) + (i % 13) / 16 + 32768, r = Math.floor(h / 256), g = Math.floor(h - r * 256), b = Math.floor((h - Math.floor(h)) * 256);
    pix.set([r, g, b], 3 * i);
    alturas[i] = r * 256 + g + b / 256 - 32768;
  }
  const d = decodificarTerrarium((await decodificarPng(png(n, n, 3, 2, pix, [4, 1, 3, 2]))).rgba);
  assert.deepEqual([...d], [...alturas]);
});

test('what it cannot read is an error, never wrong pixels', async () => {
  await assert.rejects(decodificarPng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]).buffer), /not a PNG/);
  await assert.rejects(decodificarPng(png(4, 4, 3, 2, ruido(48), [0], { entrelazado: 1 })), /interlaced/);
  const corto = png(8, 8, 3, 2, ruido(192), [1]);
  await assert.rejects(decodificarPng(corto.slice(0, corto.byteLength - 40)));
});
