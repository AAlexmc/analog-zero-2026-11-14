// Modelos 3D de NASA (web/data/modelos.json): carga perezosa con caché, vista de cerca a escala real y capa ampliada sobre el terreno.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { cantidad } from './evaluar.js';
import { cargarFuentes, generadoDe } from './modelos_generados.js';

export const RELACIONES = ['mismo', 'sustituto'];
const ALTO_PERSONA = 1.8;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const URL_LIB = (f) => new URL(`../lib/three/addons/libs/draco/gltf/${f}`, import.meta.url).href;

// ids = ids del catálogo de equipo, o null para no comprobarlos. Un error por entrada rechazada.
function revisar(obj, ids) {
  if (!Array.isArray(obj?.modelos)) return { validos: [], errores: ['modelos.json: "modelos" must be a list'] };
  const validos = [], errores = [], vistos = new Set(), equipos = new Set();
  for (const m of obj.modelos) {
    const mal = [];
    if (typeof m?.id !== 'string' || !m.id) mal.push('no id');
    else if (vistos.has(m.id)) mal.push('duplicate id');
    if (!/^modelos\/[a-z0-9_]+\.glb$/.test(m?.fichero ?? '')) mal.push('fichero must be modelos/<name>.glb');
    if (typeof m?.nombre_real !== 'string' || !m.nombre_real.trim()) mal.push('no nombre_real');
    if (m?.fuente_url !== null && !/^https?:\/\//.test(m?.fuente_url ?? '')) mal.push('fuente_url must be null or http(s)');
    if (m?.a_escala_real !== true) mal.push('not at real scale');
    if (!Array.isArray(m?.medida_m) || m.medida_m.length !== 3 || !m.medida_m.every((v) => Number.isFinite(v) && v > 0)) mal.push('medida_m must be 3 positive numbers');
    const sinEquipo = m?.equipo === null && m?.relacion === null;
    if (!sinEquipo) {
      if (typeof m?.equipo !== 'string' || (ids && !ids.has(m.equipo))) mal.push(`unknown equipo ${m?.equipo}`);
      else if (!RELACIONES.includes(m?.relacion)) mal.push(`relacion must be ${RELACIONES.join(' or ')}`);
      else if (equipos.has(m.equipo)) mal.push(`second model for ${m.equipo}`);
    }
    if (mal.length) { errores.push(`${m?.id ?? '?'}: ${mal.join('; ')}`); continue; }
    vistos.add(m.id);
    if (m.equipo) equipos.add(m.equipo);
    validos.push(m);
  }
  return { validos, errores };
}

export const validarModelos = (obj, ids) => revisar(obj, ids).errores;

export const modeloDe = (lista, equipo) => (Array.isArray(lista) ? lista.find((m) => m.equipo === equipo) ?? null : null);

export const medidaTexto = (v) => (Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) ? `${v.map((x) => x.toFixed(2)).join(' × ')} m` : 'size not available');

export function rotuloModelo(m, eq) {
  const corto = String(eq?.nombre ?? m.equipo ?? '').replace(/\s*\(.*\)\s*$/, '');
  return {
    titulo: `NASA ${m.nombre_real}`,
    medida: medidaTexto(m.medida_m),
    sustituto: m.relacion === 'sustituto' ? `3D model shown: NASA ${m.nombre_real} — stand-in, not ${corto}` : null,
  };
}

// Ampliación sobre el terreno según la distancia de la cámara: 1-2-5, nunca menor que 1.
// Tope: ningún modelo se ve mayor que uno de TOPE_M metros al factor del panel (una torre de 20 m a ×500 mediría 10 km).
export const TOPE_M = 4;
export function factorModelo(factor, tam, tope_m = TOPE_M) {
  const mayor = Math.max(tam?.x ?? 0, tam?.y ?? 0, tam?.z ?? 0);
  if (!(mayor > tope_m) || !(factor > 1)) return factor;
  return Math.max(1, factor * tope_m / mayor);
}

export function factorAmpliacion(distancia_m) {
  const x = distancia_m / 150;
  if (!(x > 1)) return 1;
  const p = 10 ** Math.floor(Math.log10(x));
  return [1, 2, 5, 10].map((k) => k * p).reduce((a, b) => (Math.abs(Math.log(b / x)) < Math.abs(Math.log(a / x)) ? b : a));
}

// ---------- Carga ----------
const cat = { lista: null, errores: [], error: null };
let pedidoCat = null;
export function catalogoModelos() {
  pedidoCat ??= Promise.all([(async () => {
    let r;
    try { r = await fetch(new URL('../data/modelos.json', import.meta.url), { cache: 'no-cache' }); } catch { throw new Error('3D model list not reachable'); }
    if (!r.ok) throw new Error(`3D model list not found (HTTP ${r.status})`);
    let obj;
    try { obj = await r.json(); } catch { throw new Error('modelos.json is broken (not valid JSON)'); }
    return revisar(obj, null);
  })().catch((e) => ({ error: e.message })), cargarFuentes()]).then(([r, f]) => {
    Object.assign(cat, f);
    if (r.error) { cat.error = r.error; cat.lista = []; } else { cat.lista = r.validos; cat.errores = r.errores; }
    return cat;
  });
  return pedidoCat;
}

let cargador = null;
async function crearCargador() {
  const [{ GLTFLoader }, { DRACOLoader }] = await Promise.all([import('three/addons/loaders/GLTFLoader.js'), import('three/addons/loaders/DRACOLoader.js')]);
  const draco = new DRACOLoader().setDecoderPath({ js: URL_LIB('draco_wasm_wrapper.js'), wasm: URL_LIB('draco_decoder.wasm') });
  return new GLTFLoader().setDRACOLoader(draco);
}

// fichero → {estado: 'cargando'|'ok'|'error', datos: {base, tam}, error}; un fallo se queda en caché hasta recargar la página.
export const cargas = new Map();
export function cargarModelo(fichero) {
  if (cargas.has(fichero)) return cargas.get(fichero).promesa;
  const c = { estado: 'cargando', datos: null, error: null };
  c.promesa = (async () => {
    cargador ??= crearCargador();
    const gltf = await (await cargador).loadAsync(new URL(`../data/${fichero}`, import.meta.url).href);
    const raiz = gltf.scene;
    const caja = new THREE.Box3().setFromObject(raiz);
    const centro = caja.getCenter(new THREE.Vector3());
    raiz.position.sub(new THREE.Vector3(centro.x, caja.min.y, centro.z));
    const base = new THREE.Group();
    base.add(raiz);
    return { base, tam: caja.getSize(new THREE.Vector3()) };
  })().then((d) => { c.estado = 'ok'; c.datos = d; return d; }, (e) => { c.estado = 'error'; c.error = String(e?.message ?? e).replace(/^fetch for ".*" responded with (\d+).*$/, 'HTTP $1'); throw e; });
  c.promesa.catch(() => {});
  cargas.set(fichero, c);
  return c.promesa;
}

// ---------- Vista de cerca ----------
export function figuraHumana() {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffb340 });
  const cuerpo = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 1.45, 16), mat);
  cuerpo.position.y = 0.725;
  const cabeza = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), mat);
  cabeza.position.y = ALTO_PERSONA - 0.12;
  const g = new THREE.Group();
  g.add(cuerpo, cabeza);
  return g;
}

function svgHuella(h) {
  const pts = h.esquinas(0, 0, 1).map(([f, c]) => [c, f]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, hh = Math.max(Math.max(...ys) - y0, ALTO_PERSONA);
  const W = 300, H = 150, pad = 18, s = Math.min((W - 2 * pad - 70) / w, (H - 2 * pad) / hh);
  const ox = pad + (W - 2 * pad - 70 - w * s) / 2, oy = pad + (H - 2 * pad - (Math.max(...ys) - y0) * s) / 2;
  const poli = pts.map(([x, y]) => `${(ox + (x - x0) * s).toFixed(1)},${(oy + (y - y0) * s).toFixed(1)}`).join(' ');
  const bx = W - pad - 40, by1 = H - pad, by0 = by1 - ALTO_PERSONA * s;
  return `<svg class="huella-cerca" viewBox="0 0 ${W} ${H}" role="img" aria-label="footprint to scale">
    <polygon points="${poli}"/><line x1="${bx}" y1="${by0.toFixed(1)}" x2="${bx}" y2="${by1}"/>
    <text x="${bx + 6}" y="${((by0 + by1) / 2 + 4).toFixed(1)}">1.8 m</text></svg>`;
}

export function crearCerca() {
  const el = document.createElement('div');
  el.className = 'cerca';
  el.innerHTML = '<div class="et">CLOSE-UP · TRUE SCALE</div><div class="vista"><div class="aviso-cerca" hidden></div></div><div class="pie"></div>';
  const vista = el.querySelector('.vista'), aviso = el.querySelector('.aviso-cerca'), pie = el.querySelector('.pie');
  let gl = null, clave = null, args = null, propios = [], info = { modelo: null, estado: null, inclinacion_deg: null };

  const dibujar = () => { if (gl && vista.clientWidth) gl.renderer.render(gl.escena, gl.camara); };
  function iniciarGL() {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x021226);
    vista.prepend(renderer.domElement);
    const escena = new THREE.Scene();
    const sol = new THREE.DirectionalLight(0xffffff, 2.5);
    sol.position.set(4, 8, 3);
    escena.add(new THREE.HemisphereLight(0xdfe8f0, 0x30363d, 2), sol);
    const camara = new THREE.PerspectiveCamera(35, 1, 0.05, 500);
    const controles = new OrbitControls(camara, renderer.domElement);
    controles.addEventListener('change', dibujar);
    gl = { renderer, escena, camara, controles, grupo: null };
    new ResizeObserver(() => {
      const w = vista.clientWidth, h = vista.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camara.aspect = w / h;
      camara.updateProjectionMatrix();
      dibujar();
    }).observe(vista);
  }

  function construir(datos, pend) {
    if (gl.grupo) gl.escena.remove(gl.grupo);
    propios.forEach((x) => x.dispose());
    const largo = datos ? Math.max(datos.tam.x, datos.tam.z) : 2, ancho = datos ? Math.min(datos.tam.x, datos.tam.z) : 1, alto = datos ? datos.tam.y : 1;
    const lado = Math.max(8, Math.ceil(largo * 3));
    const geo = new THREE.PlaneGeometry(lado, lado).rotateX(-Math.PI / 2), mat = new THREE.MeshStandardMaterial({ color: 0x59636e, roughness: 1 });
    const rejilla = new THREE.GridHelper(lado, lado, 0x8fa9c0, 0x8fa9c0);
    rejilla.material.transparent = true; rejilla.material.opacity = 0.45;
    rejilla.position.y = 0.003;
    const persona = figuraHumana();
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo, mat), rejilla, persona);
    propios = [geo, mat, rejilla.geometry, rejilla.material, ...persona.children.flatMap((m) => [m.geometry, m.material])];
    if (datos) {
      const o = datos.base.clone(true);
      if (datos.tam.z > datos.tam.x) o.rotation.y = Math.PI / 2;
      g.add(o);
    }
    // La pendiente sube a lo largo del modelo; la persona queda vertical.
    const ang = Number.isFinite(pend) ? THREE.MathUtils.degToRad(pend) : 0;
    g.rotation.z = ang;
    persona.position.set(0, 0, ancho / 2 + 0.8);
    persona.rotation.z = -ang;
    gl.escena.add(g);
    gl.grupo = g;
    const r = Math.max(largo, alto, 2);
    gl.controles.target.set(0, Math.max(alto, ALTO_PERSONA) / 2, 0);
    gl.camara.position.set(r * 0.5, r * 0.3 + alto / 2, r * 2.4);
    gl.controles.update();
    info.inclinacion_deg = THREE.MathUtils.radToDeg(ang);
    dibujar();
  }

  function pintar() {
    if (!args || !el.isConnected) return;
    const { eq, pendiente, huella } = args;
    const pend = pendiente?.valor;
    const m = cat.lista ? modeloDe(cat.lista, eq.id) : null;
    const c = m ? cargas.get(m.fichero) : null;
    const gen = cat.lista && !m ? generadoDe(eq, cat.conceptos) : null;
    const k = [eq.id, cat.lista ? 'cat' : 'sin-cat', m?.fichero, c?.estado, gen?.clave, Number.isFinite(pend) ? pend.toFixed(3) : 'nan'].join('|');
    if (k === clave) return;
    clave = k;
    info = { modelo: m?.id ?? null, estado: m ? c?.estado ?? 'cargando' : null, inclinacion_deg: null, generado: gen?.base ? gen.clase : null };
    const txtPend = Number.isFinite(pend) ? `on the ${cantidad(pend, 'deg', 1)} slope measured here` : `slope not measured here (${pendiente?.motivo ?? 'no data'}): shown flat`;
    if (!cat.lista) { aviso.hidden = false; aviso.textContent = 'loading 3D model list…'; pie.innerHTML = ''; return; }
    if (gen?.base) {
      vista.hidden = false;
      if (!gl) iniciarGL();
      aviso.hidden = true;
      pie.innerHTML = `<div><b class="rotulo-generado">${esc(gen.titulo)}</b> · <span class="num">${esc(medidaTexto(gen.medida))}</span> <span class="tenue">(length × width × height)</span></div>
      <div>${esc(gen.linea)}</div>
      <div class="tenue">${esc(txtPend)} · grid 1 m · figure 1.8 m · drag to orbit · not an official NASA model</div>`;
      construir(gen, pend);
      return;
    }
    if (!m) {
      vista.hidden = true;
      pie.innerHTML = `<b>no official 3D model loaded</b>${cat.error ? ` <span class="error-modelo">(${esc(cat.error)})</span>` : ''}
        ${gen ? `<div>${esc(gen.clase === 'esquematico' ? `schematic: ${gen.linea}` : gen.linea)}</div>` : ''}${cat.errorGenerados ? `<div class="error-modelo">${esc(cat.errorGenerados)}</div>` : ''}
        ${huella ? `${svgHuella(huella)}<div class="tenue">footprint to scale from the catalogue · bar = 1.8 m person</div>` : '<div class="tenue">no public dimensions in the catalogue to draw a footprint</div>'}`;
      return;
    }
    vista.hidden = false;
    if (!gl) iniciarGL();
    if (!c || c.estado === 'cargando') cargarModelo(m.fichero).then(pintar, pintar);
    const r = rotuloModelo(m, eq);
    const estado = cargas.get(m.fichero);
    aviso.hidden = estado.estado === 'ok';
    aviso.classList.toggle('error-modelo', estado.estado === 'error');
    aviso.textContent = estado.estado === 'error' ? `3D model failed to load: ${estado.error}` : 'loading 3D model…';
    pie.innerHTML = `<div><b>${esc(r.titulo)}</b> · <span class="num">${esc(r.medida)}</span> <span class="tenue">(length × width × height)</span></div>
      ${r.sustituto ? `<div class="sustituto">${esc(r.sustituto)}</div>` : ''}
      <div class="tenue">${esc(txtPend)} · grid 1 m · figure 1.8 m · drag to orbit · Credit: NASA${m.fuente_url ? ` · <a href="${esc(m.fuente_url)}" target="_blank" rel="noopener">science.nasa.gov</a>` : ''}</div>`;
    construir(estado.estado === 'ok' ? estado.datos : null, pend);
  }

  return {
    el,
    // slot = hueco de la hoja; a = {eq, pendiente: {valor, motivo}, huella}.
    montar(slot, a) {
      slot.replaceWith(el);
      args = a;
      if (!cat.lista) catalogoModelos().then(pintar);
      pintar();
      if (gl) dibujar();
    },
    estado: () => ({ ...info, camara: gl?.camara.position.toArray() ?? null, conectado: el.isConnected, aviso: aviso.hidden ? null : aviso.textContent, pie: pie.textContent.replace(/\s+/g, ' ').trim() }),
    // Para el guion de capturas: dibuja y cuenta colores distintos del lienzo.
    muestra() {
      if (!gl) return null;
      dibujar();
      const ctx = gl.renderer.getContext(), w = ctx.drawingBufferWidth, h = ctx.drawingBufferHeight, px = new Uint8Array(w * h * 4);
      ctx.readPixels(0, 0, w, h, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
      const colores = new Set();
      for (let i = 0; i < px.length; i += 4 * 13) colores.add((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
      return { w, h, colores: colores.size };
    },
    lienzo: () => gl?.renderer.domElement ?? null,
  };
}

// ---------- Capa sobre el terreno ----------
export function capaModelos(escena, lienzo) {
  const grupo = new THREE.Group();
  const sol = new THREE.DirectionalLight(0xffffff, 2.2);
  escena.escena.add(grupo, new THREE.HemisphereLight(0xdfe8f0, 0x30363d, 2), sol, sol.target);
  const nota = document.createElement('div');
  nota.className = 'nota-modelos';
  nota.hidden = true;
  lienzo.appendChild(nota);
  const inst = new Map();
  let factor = 1;

  function sincronizar(lista) {
    if (lista.length && !cat.lista) catalogoModelos().then(() => { escena.sucio = true; });
    const vivos = new Set(lista.map((it) => it.uid));
    for (const [uid, x] of inst) if (!vivos.has(uid)) { if (x.obj) grupo.remove(x.obj); inst.delete(uid); }
    factor = factorAmpliacion(escena.camara.position.distanceTo(escena.controles.target) * 1000);
    sol.position.copy(escena.uniforms.uSol.value).multiplyScalar(100);
    const fallos = new Set(), clases = new Set();
    let hay = 0, cargando = 0, cambio = false, topados = 0;
    for (const it of lista) {
      const m = modeloDe(cat.lista, it.equipo);
      const eq = cat.lista && !m ? cat.equipos?.find((q) => q.id === it.equipo) : null;
      const g = eq ? generadoDe(eq, cat.conceptos) : null;
      if (!m && !g?.base) continue;
      hay++;
      if (g) clases.add(g.clase);
      let x = inst.get(it.uid);
      if (!x) {
        x = { equipo: it.equipo, fichero: m?.fichero ?? null, generado: g?.clase ?? null, tam: g?.tam ?? null, obj: null, pos: '' };
        inst.set(it.uid, x);
        if (g) { x.obj = g.base.clone(true); x.obj.userData.uid = it.uid; grupo.add(x.obj); }
        else cargarModelo(m.fichero).then((d) => {
          if (inst.get(it.uid) !== x) return;
          x.obj = d.base.clone(true);
          x.obj.userData.uid = it.uid;
          grupo.add(x.obj);
          escena.sucio = true;
        }, () => { escena.sucio = true; });
      }
      const c = x.fichero ? cargas.get(x.fichero) : { estado: 'ok', datos: { tam: x.tam } };
      if (c.estado === 'error') fallos.add(`${x.fichero.replace(/^modelos\//, '')}: ${c.error}`);
      if (c.estado === 'cargando') cargando++;
      if (!x.obj) continue;
      const tam = c.datos.tam;
      // Apoyado: la base a la cota más alta entre el centro y las esquinas de su caja ampliada.
      const fx = factorModelo(factor, tam);
      if (fx < factor) topados++;
      const df = (tam.z / 2) * fx / escena.m, dc = (tam.x / 2) * fx / escena.m;
      const centro = escena.mundoDePixel(it.fila, it.col);
      const y = Math.max(centro.y, ...[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([a, b]) => escena.mundoDePixel(it.fila + a * df, it.col + b * dc).y));
      const pos = `${centro.x},${y},${centro.z},${fx}`;
      if (pos === x.pos) continue;
      x.pos = pos;
      x.obj.position.set(centro.x, y, centro.z);
      x.obj.scale.setScalar(fx / 1000);
      cambio = true;
    }
    const partes = [];
    if (hay) partes.push(factor === 1 ? '3D models ×1, true scale' : `3D models ×${factor}${topados ? ' (items over 4 m enlarged less)' : ''}, not to scale · outlines are true size`);
    if (clases.has('esquematico')) partes.push('schematics: built from published dimensions');
    if (clases.has('concepto')) partes.push('concepts: own design');
    if (cargando) partes.push('loading 3D model…');
    for (const f of fallos) partes.push(`3D model failed to load: ${f}`);
    if (lista.length && cat.error) partes.push(cat.error);
    const txt = partes.join(' · ');
    if (nota.textContent !== txt) { nota.textContent = txt; nota.hidden = !txt; nota.classList.toggle('con-error', fallos.size > 0 || !!(lista.length && cat.error)); }
    if (cambio) escena.sucio = true;
  }

  return {
    sincronizar,
    grupo,
    instancias: () => [...inst].map(([uid, x]) => ({
      uid, equipo: x.equipo, fichero: x.fichero, generado: x.generado, enEscena: x.obj?.parent === grupo, factor, estado: x.fichero ? cargas.get(x.fichero)?.estado : 'ok',
      mallas: x.obj ? (() => { let k = 0; x.obj.traverse((o) => { if (o.isMesh) k++; }); return k; })() : 0,
      pos: x.obj ? x.obj.position.toArray() : null, tam: (x.fichero ? cargas.get(x.fichero)?.datos?.tam : x.tam)?.toArray() ?? null,
    })),
    nota: () => (nota.hidden ? null : nota.textContent),
  };
}
