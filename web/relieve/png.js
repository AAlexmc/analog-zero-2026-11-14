// PNG de 8 bits sin entrelazar → RGBA, sin pasar por canvas: hay navegadores que alteran la lectura del canvas
// (protección contra la huella digital) y en una tesela de altura un bit del canal rojo son 256 m.
const FIRMA = [137, 80, 78, 71, 13, 10, 26, 10];
const CANALES = { 0: 1, 2: 3, 3: 1, 6: 4 };

async function inflar(trozos) {
  const flujo = new Blob(trozos).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}

export async function decodificarPng(buffer) {
  const b = new Uint8Array(buffer), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 33 || FIRMA.some((v, i) => b[i] !== v)) throw new Error('not a PNG');
  let ancho = 0, alto = 0, tipo = -1, paleta = null;
  const idat = [];
  for (let i = 8; i + 8 <= b.length;) {
    const largo = dv.getUint32(i), nombre = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]), d = b.subarray(i + 8, i + 8 + largo);
    if (nombre === 'IHDR') {
      ancho = dv.getUint32(i + 8); alto = dv.getUint32(i + 12); tipo = b[i + 17];
      if (b[i + 16] !== 8 || !(tipo in CANALES)) throw new Error(`PNG format not supported (bit depth ${b[i + 16]}, colour type ${tipo})`);
      if (b[i + 20] !== 0) throw new Error('interlaced PNG not supported');
    } else if (nombre === 'PLTE') paleta = d;
    else if (nombre === 'IDAT') idat.push(d);
    else if (nombre === 'IEND') break;
    i += 12 + largo;
  }
  if (!ancho || !alto || !idat.length) throw new Error('PNG without image data');
  if (tipo === 3 && !paleta) throw new Error('PNG palette missing');
  const c = CANALES[tipo], linea = ancho * c, crudo = await inflar(idat);
  if (crudo.length !== (linea + 1) * alto) throw new Error('PNG image data has the wrong length');
  const pix = new Uint8Array(linea * alto);
  for (let j = 0; j < alto; j++) {
    const f = crudo[j * (linea + 1)], o = j * (linea + 1) + 1, p = j * linea, q = p - linea;
    for (let i = 0; i < linea; i++) {
      const izq = i >= c ? pix[p + i - c] : 0, arr = j ? pix[q + i] : 0, diag = j && i >= c ? pix[q + i - c] : 0;
      let pred = 0;
      if (f === 1) pred = izq;
      else if (f === 2) pred = arr;
      else if (f === 3) pred = (izq + arr) >> 1;
      else if (f === 4) { const e = izq + arr - diag, pa = Math.abs(e - izq), pb = Math.abs(e - arr), pc = Math.abs(e - diag); pred = pa <= pb && pa <= pc ? izq : pb <= pc ? arr : diag; }
      else if (f !== 0) throw new Error(`PNG row filter ${f} unknown`);
      pix[p + i] = (crudo[o + i] + pred) & 255;
    }
  }
  const rgba = new Uint8ClampedArray(ancho * alto * 4);
  for (let i = 0; i < ancho * alto; i++) {
    if (tipo === 2 || tipo === 6) { rgba[4 * i] = pix[c * i]; rgba[4 * i + 1] = pix[c * i + 1]; rgba[4 * i + 2] = pix[c * i + 2]; rgba[4 * i + 3] = tipo === 6 ? pix[c * i + 3] : 255; }
    else if (tipo === 0) { rgba[4 * i] = rgba[4 * i + 1] = rgba[4 * i + 2] = pix[i]; rgba[4 * i + 3] = 255; }
    else { const k = 3 * pix[i]; if (k + 2 >= paleta.length) throw new Error('PNG palette index out of range'); rgba[4 * i] = paleta[k]; rgba[4 * i + 1] = paleta[k + 1]; rgba[4 * i + 2] = paleta[k + 2]; rgba[4 * i + 3] = 255; }
  }
  return { ancho, alto, rgba };
}
