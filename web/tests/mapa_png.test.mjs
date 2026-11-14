import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { decodificarPNG, byteDe } from '../mapa/png.js';

const TABLA = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = TABLA[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function trozo(tipo, datos) {
  const t = Buffer.from(tipo, 'ascii'), l = Buffer.alloc(4), c = Buffer.alloc(4);
  l.writeUInt32BE(datos.length);
  c.writeUInt32BE(crc(Buffer.concat([t, datos])));
  return Buffer.concat([l, t, datos, c]);
}
function paeth(a, b, c) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
// Codifica con el filtro de cada fila elegido por `filtros(f)`, para ejercitar los cinco.
function png(ancho, alto, bpp, px, filtros = () => 0, partir = 1) {
  const paso = ancho * bpp, crudo = Buffer.alloc(alto * (paso + 1));
  for (let f = 0; f < alto; f++) {
    const ft = filtros(f);
    crudo[f * (paso + 1)] = ft;
    for (let i = 0; i < paso; i++) {
      const x = px[f * paso + i], a = i >= bpp ? px[f * paso + i - bpp] : 0, up = f ? px[(f - 1) * paso + i] : 0, c = f && i >= bpp ? px[(f - 1) * paso + i - bpp] : 0;
      const pred = [0, a, up, (a + up) >> 1, paeth(a, up, c)][ft];
      crudo[f * (paso + 1) + 1 + i] = (x - pred) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0); ihdr.writeUInt32BE(alto, 4); ihdr[8] = 8; ihdr[9] = bpp === 4 ? 6 : 2;
  const z = deflateSync(crudo), idats = [];
  const t = Math.ceil(z.length / partir);
  for (let i = 0; i < z.length; i += t) idats.push(trozo('IDAT', z.subarray(i, i + t)));
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo('IHDR', ihdr), ...idats, trozo('IEND', Buffer.alloc(0))]));
}
function aleatorio(n, semilla) { const o = new Uint8Array(n); let s = semilla; for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) >>> 0; o[i] = s >>> 24; } return o; }

test('decodes RGBA bytes exactly through all five row filters', async () => {
  const px = aleatorio(9 * 7 * 4, 7);
  for (let i = 3; i < px.length; i += 4) px[i] = 255;
  const img = await decodificarPNG(png(9, 7, 4, px, (f) => f % 5, 3));
  assert.equal(img.ancho, 9); assert.equal(img.alto, 7); assert.equal(img.canales, 4);
  assert.deepEqual([...img.datos], [...px]);
});

test('decodes RGB and the reserved bytes 0, 250, 254 and 255 stay as they are', async () => {
  const px = new Uint8Array([0, 250, 254, 255, 1, 128, 127, 254, 255, 0, 0, 0]);
  const img = await decodificarPNG(png(2, 2, 3, px, (f) => (f ? 4 : 1)));
  assert.equal(img.canales, 3);
  assert.equal(byteDe(img, 0, 0, 1), 250);
  assert.equal(byteDe(img, 0, 1, 2), 128);
  assert.equal(byteDe(img, 1, 0, 2), 255);
  assert.deepEqual([...img.datos], [...px]);
});

test('rejects bytes that are not a PNG', async () => {
  await assert.rejects(decodificarPNG(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])), /not a PNG/);
});

test('rejects a truncated PNG', async () => {
  const b = png(4, 4, 4, new Uint8Array(64).fill(255));
  await assert.rejects(decodificarPNG(b.subarray(0, b.length - 20)), /truncated|IEND/);
});

test('rejects 16-bit or palette PNGs instead of misreading them', async () => {
  const b = png(2, 2, 3, new Uint8Array(12));
  const m = b.slice();
  m[8 + 8 + 9] = 3; // tipo de color paleta
  await assert.rejects(decodificarPNG(m), /unsupported PNG/);
});
