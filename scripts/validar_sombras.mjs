// V1: mapa de fracción iluminada con el código de sombras del visor, luego métricas y figuras en Python.
// Uso: node scripts/validar_sombras.mjs [id…]   (por defecto polo_sur shackleton; protocolo en pipeline/validacion_sombras/PROTOCOLO.md)
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sobrePlanoTangente } from '../web/terreno/calculo.js';
import { muestrasSol, solLocal, centroRecorte, acumular, fraccion } from '../pipeline/validacion_sombras/agregar.mjs';

const PARAMS = { pasoAz: 5, fases: 36, oblicuidad: 1.54, radioSol: 1919 / 2 / 3600 };

if (!isMainThread) {
  const { h, n, m, soles } = workerData;
  const cuenta = acumular(new Float32Array(h), n, m, soles, new Uint16Array(n * n));
  parentPort.postMessage(cuenta, [cuenta.buffer]);
} else {
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['polo_sur', 'shackleton'];
  const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
  const atomico = (p, datos) => { writeFileSync(p + '.tmp', datos); renameSync(p + '.tmp', p); };

  for (const id of ids) {
    const dir = path.join(raiz, 'web/data/terreno', id);
    const meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    const { n, m_por_px: m, georef } = meta;
    const buf = readFileSync(path.join(dir, 'altura.f32'));
    const alt = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const h = sobrePlanoTangente(alt, n, m, georef.radio_m);
    const centro = centroRecorte(georef, n, m);
    const soles = muestrasSol(PARAMS).map((s) => {
      const l = solLocal(centro.lat, centro.lon, s.lon, s.lat);
      return { az: l.az, el: l.el + PARAMS.radioSol };
    });
    const compartido = new Float32Array(new SharedArrayBuffer(h.byteLength));
    compartido.set(h);
    const W = Math.min(availableParallelism(), 16), t0 = Date.now();
    const partes = await Promise.all(Array.from({ length: W }, (_, w) => new Promise((ok, mal) => {
      const wk = new Worker(fileURLToPath(import.meta.url), {
        workerData: { h: compartido.buffer, n, m, soles: soles.filter((_, i) => i % W === w) },
      });
      wk.once('message', ok); wk.once('error', mal);
    })));
    const cuenta = new Uint16Array(n * n);
    for (const p of partes) for (let i = 0; i < cuenta.length; i++) cuenta[i] += p[i];
    const fr = fraccion(cuenta, soles.length, alt);
    const out = path.join(raiz, 'build/validacion_sombras', id);
    mkdirSync(out, { recursive: true });
    atomico(path.join(out, 'modelo.f32'), Buffer.from(fr.buffer));
    const els = soles.map((s) => s.el);
    atomico(path.join(out, 'modelo.json'), JSON.stringify({
      id, n, m_por_px: m, centro_rejilla: centro, parametros: { ...PARAMS, muestras: soles.length },
      elevacion_pasada_deg: { min: Math.min(...els), max: Math.max(...els) },
      sha256: {
        altura: sha(path.join(dir, 'altura.f32')),
        iluminacion: sha(path.join(dir, 'iluminacion.f32')),
        sombra_permanente: sha(path.join(dir, 'sombra_permanente.u8')),
        calculo_js: sha(path.join(raiz, 'web/terreno/calculo.js')),
      },
      segundos: (Date.now() - t0) / 1000, hilos: W,
    }, null, 1) + '\n');
    console.log(`${id}: ${soles.length} soles, ${W} hilos, ${(Date.now() - t0) / 1000} s`);
  }
  const py = process.env.AZ_PY || '/home/ale/nasa-space-apps-2026/.venv/bin/python';
  const r = spawnSync(py, ['-m', 'pipeline.validacion_sombras', ...ids], { cwd: raiz, stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
