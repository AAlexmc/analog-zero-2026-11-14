// PNG de 8 bits RGB o RGBA sin entrelazar, decodificado a mano: bytes tal cual, sin gestión de color ni alfa premultiplicado.
const FIRMA = [137, 80, 78, 71, 13, 10, 26, 10];

async function inflar(bytes) {
  const flujo = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(flujo).arrayBuffer());
}

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// Devuelve {ancho, alto, canales, datos: Uint8Array fila a fila}.
export async function decodificarPNG(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (b.length < 8 || FIRMA.some((v, i) => b[i] !== v)) throw new Error('not a PNG file');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let pos = 8, cab = null, fin = false;
  const trozos = [];
  while (pos + 8 <= b.length) {
    const len = dv.getUint32(pos);
    const tipo = String.fromCharCode(b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7]);
    const ini = pos + 8;
    if (ini + len + 4 > b.length) throw new Error(`PNG truncated in chunk ${tipo}`);
    if (tipo === 'IHDR') {
      cab = { ancho: dv.getUint32(ini), alto: dv.getUint32(ini + 4), bits: b[ini + 8], color: b[ini + 9], entrelazado: b[ini + 12] };
    } else if (tipo === 'IDAT') trozos.push(b.subarray(ini, ini + len));
    else if (tipo === 'IEND') { fin = true; break; }
    pos = ini + len + 4;
  }
  if (!cab) throw new Error('PNG without IHDR');
  if (!fin) throw new Error('PNG without IEND');
  if (cab.bits !== 8 || (cab.color !== 2 && cab.color !== 6) || cab.entrelazado !== 0) {
    throw new Error(`unsupported PNG (bit depth ${cab.bits}, colour type ${cab.color}, interlace ${cab.entrelazado})`);
  }
  const total = trozos.reduce((s, t) => s + t.length, 0), comp = new Uint8Array(total);
  let o = 0;
  for (const t of trozos) { comp.set(t, o); o += t.length; }
  const crudo = await inflar(comp);
  const bpp = cab.color === 6 ? 4 : 3, paso = cab.ancho * bpp;
  if (crudo.length !== cab.alto * (paso + 1)) throw new Error('PNG image data has the wrong length');
  const out = new Uint8Array(cab.alto * paso);
  for (let f = 0; f < cab.alto; f++) {
    const filtro = crudo[f * (paso + 1)], src = f * (paso + 1) + 1, dst = f * paso;
    for (let i = 0; i < paso; i++) {
      const x = crudo[src + i];
      const a = i >= bpp ? out[dst + i - bpp] : 0;
      const up = f > 0 ? out[dst - paso + i] : 0;
      const c = f > 0 && i >= bpp ? out[dst - paso + i - bpp] : 0;
      let v;
      switch (filtro) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + up; break;
        case 3: v = x + ((a + up) >> 1); break;
        case 4: v = x + paeth(a, up, c); break;
        default: throw new Error(`PNG row ${f} has unknown filter ${filtro}`);
      }
      out[dst + i] = v & 255;
    }
  }
  return { ancho: cab.ancho, alto: cab.alto, canales: bpp, datos: out };
}

export function byteDe(img, fila, col, k) {
  return img.datos[(fila * img.ancho + col) * img.canales + k];
}
