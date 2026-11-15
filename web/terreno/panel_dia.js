// Recorrido del día: una hora común mueve el sol de los dos paneles (cada uno con el suyo), con las sombras del relieve
// y del equipo, y la lectura de cada lugar lado a lado. Cálculo en sol.js y calculo.js; aquí solo la pantalla.
import { solTierra, solPolar, solMundo, largoSombra, horaTexto, rumboTexto, MESES, DIA_LUNAR_H, DIA_MARTE_H, OBLICUIDAD_MARTE, FUENTES_SOL } from './sol.js';
import { sombras, sobrePlanoTangente } from './calculo.js';

const PASOS = 24;
const DURACION_MS = 24000;
const bits = (v) => { let k = 0; for (let x = v >>> 0; x; x &= x - 1) k++; return k; };

// ctx: { paneles, esc, nombreCorto, CUERPO, mes (1-12 o null), alCambiar() }.
export function crearDia(caja, ctx) {
  const { paneles, esc, nombreCorto, CUERPO } = ctx;
  const S = { activo: false, hora: 12, mes: ctx.mes ?? new Date().getMonth() + 1, modo: 'propio', decl: 0, anim: null, pendiente: false };
  const DIA_H = { luna: DIA_LUNAR_H, marte: DIA_MARTE_H };
  const vivos = () => paneles.filter((p) => p.escena);
  const esPolar = (p) => p.escena.meta.georef.tipo === 'estereo_polar';
  // tierra = lugar de la Tierra; polar = recorte polar de la Luna; mundo = lugar no polar de la Luna o Marte.
  const tipo = (p) => {
    const c = p.escena.meta.cuerpo;
    if (c === 'tierra') return esPolar(p) ? null : 'tierra';
    return esPolar(p) ? 'polar' : DIA_H[c] ? 'mundo' : null;
  };
  const declDe = (p) => (p.escena.meta.cuerpo === 'marte' ? S.decl : 0);
  const fuente = (f, t) => `<a href="${esc(f.url)}" target="_blank" rel="noopener" title="${esc(`${f.texto} — “${f.cita}”`)}">${esc(t)}</a>`;

  caja.innerHTML = `
    <div class="dia-mandos">
      <h2 class="marca-subtitulo">Day</h2>
      <button type="button" class="marca-boton" data-a="play" aria-pressed="false">▶ Play the day</button>
      <label class="grupo"><span class="et">Hour</span><input type="range" data-a="hora" min="0" max="24" step="0.25" value="12" aria-label="Hour of the day"><span class="num" data-v="hora">12:00</span></label>
      <label class="grupo" data-g="mes"><span class="et">Earth month</span><select data-a="mes" aria-label="Month on Earth">${MESES.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('')}</select></label>
      <span class="grupo" role="group" aria-label="Time scale" data-g="modo">
        <button type="button" data-modo="propio" aria-pressed="true" title="Each world goes through one full day of its own: 24 hours on Earth, 29.53 Earth days on the Moon">One day of each world</button>
        <button type="button" data-modo="mismo" aria-pressed="false" title="The same 24 hours pass in both places: on the Moon the Sun barely moves">Same 24 hours</button>
      </span>
      <label class="grupo" data-g="decl"><span class="et">Mars season</span><select data-a="decl" aria-label="Season on Mars">
        <option value="0">Equinox: Sun over the equator</option><option value="${OBLICUIDAD_MARTE}">Northern summer: Sun ${OBLICUIDAD_MARTE}° N</option><option value="${-OBLICUIDAD_MARTE}">Southern summer: Sun ${OBLICUIDAD_MARTE}° S</option></select></label>
      <span class="dia-fuentes tenue">Sun computed here (own calculation) from ${fuente(FUENTES_SOL.tierra, 'NOAA solar position formulas')} and the ${fuente(FUENTES_SOL.luna, '29.53-day lunar day')}<span data-g="fuente-marte"> and the ${fuente(FUENTES_SOL.marte, '24.66-hour Mars day')}, ${fuente({ ...FUENTES_SOL.marte, cita: FUENTES_SOL.marte.cita_oblicuidad }, '25.19° tilt')}</span> · shadows from the elevation data</span>
    </div>
    <div class="dia-lecturas">${['a', 'b'].map((l) => `<div class="dia-lectura" data-lado="${l}"><div class="dia-texto"></div><div class="dia-tira" hidden></div></div>`).join('')}</div>`;
  const $ = (s) => caja.querySelector(s);
  const selMes = $('[data-a=mes]');
  selMes.value = String(S.mes);

  // Sol de un panel a la hora t del recorrido (0-24): acimut de rejilla y altura, o null si este panel no se sabe mover.
  function solDe(p, t) {
    const k = tipo(p);
    if (k === 'tierra') return { ...solTierra({ lat: p.escena.meta.centro.lat, mes: S.mes, hora: t }), tipo: k };
    if (k === 'polar') {
      const horas = S.modo === 'mismo' ? t : (t / 24) * DIA_LUNAR_H;
      return { ...solPolar({ az0: p.diaBase.az, el: p.diaBase.el(), horas }), tipo: k, horas };
    }
    if (k === 'mundo') {
      // Mismo reloj: las 24 h pasan alrededor de su mediodía local; día propio: su día entero.
      const dia = DIA_H[p.escena.meta.cuerpo], hora = S.modo === 'mismo' ? 12 + ((t - 12) * 24) / dia : t;
      return { ...solMundo({ lat: p.escena.meta.centro.lat, decl: declDe(p), hora }), tipo: k, hora, dia };
    }
    return null;
  }

  function seguido(p) {
    const it = p.plantados?.buscar(p.sel) ?? p.plantados?.lista.at(-1) ?? null;
    if (!it) return null;
    const tam = p.modelos?.instancias().find((x) => x.uid === it.uid)?.tam ?? null;
    return { it, alto_m: tam ? tam[1] : null };
  }

  function mandosPanel(p, s) {
    const m = p.el.querySelector('.mandos');
    const az = m.querySelector('[data-sol=az]'), el = m.querySelector('[data-sol=el]');
    az.value = Math.round(s.az) % 360;
    if (s.tipo !== 'polar') el.value = Math.max(0, s.el);
    m.querySelector('[data-v=az]').textContent = s.tipo === 'polar' ? `${Math.round(Math.abs(s.az > 180 ? s.az - 360 : s.az))}° ${s.az > 180 ? 'W' : 'E'}` : `${Math.round(s.az)}°`;
    m.querySelector('[data-v=el]').textContent = `${s.el.toFixed(1)}°`;
  }

  function textoPanel(p, s) {
    const e = p.escena, cuerpo = CUERPO[e.meta.cuerpo] ?? e.meta.cuerpo, L = [];
    if (!s) return `<b>${esc(cuerpo)}</b> · the Day control does not move the Sun on this terrain (set it by hand in Display)`;
    if (s.tipo === 'tierra') L.push(`<b>${esc(cuerpo)}</b> · <span class="num">${horaTexto(S.hora)}</span> local solar time · ${MESES[S.mes - 1]}`);
    else if (s.tipo === 'mundo') {
      const largo = e.meta.cuerpo === 'marte' ? `<span class="num">${DIA_MARTE_H.toFixed(2)} h</span>` : '<span class="num">29.53</span> Earth days';
      L.push(`<b>${esc(cuerpo)}</b> · <span class="num">${horaTexto(s.hora)}</span> local solar time of its own day, which lasts ${largo}${e.meta.cuerpo === 'luna' ? ' · Sun taken over the equator (own simplification)' : ''}`);
    }
    else if (S.modo === 'mismo') L.push(`<b>${esc(cuerpo)}</b> · <span class="num">${S.hora.toFixed(1)} h</span> later: the Sun has gone <span class="num">${((360 * S.hora) / DIA_LUNAR_H).toFixed(1)}°</span> round the horizon`);
    else L.push(`<b>${esc(cuerpo)}</b> · Earth day <span class="num">${(s.horas / 24).toFixed(1)}</span> of <span class="num">29.53</span> of its own day`);
    const arriba = s.el > 0;
    L.push(arriba ? `Sun <span class="num">${s.el.toFixed(1)}°</span> above the horizon${s.tipo !== 'polar' ? `, to the ${rumboTexto(s.az)} (<span class="num">${Math.round(s.az)}°</span>)` : ' (height set in Display: it changes with the season, not the hour)'}`
      : `<span class="dia-noche">Sun <span class="num">${Math.abs(s.el).toFixed(1)}°</span> below the horizon: night</span>`);
    const f = e.fraccionConSol();
    L.push(`<span class="num">${Number.isFinite(f) ? Math.round(100 * f) : '—'} %</span> of this window in direct sunlight`);
    const g = seguido(p);
    if (g) {
      const con = e.conSol(g.it.fila, g.it.col), largo = con ? largoSombra(g.alto_m, s.el) : null;
      L.push(`${esc(nombreCorto(g.it.equipo))}: ${con ? `<b>sunlit</b>${largo ? ` · on flat ground its shadow is <span class="num">${largo >= 1000 ? `${(largo / 1000).toFixed(1)} km` : `${largo.toFixed(largo < 10 ? 1 : 0)} m`}</span> long (it is <span class="num">${g.alto_m.toFixed(1)} m</span> tall)` : ''}` : `<b>${arriba ? 'in the shadow of the terrain' : 'in the dark'}</b>`}`);
    }
    return L.map((t) => `<div>${t}</div>`).join('');
  }

  function pintarLecturas() {
    for (const p of paneles) {
      const d = caja.querySelector(`.dia-lectura[data-lado=${p.lado}]`);
      d.hidden = !p.escena;
      if (!p.escena) continue;
      d.querySelector('.dia-texto').innerHTML = S.activo ? textoPanel(p, p.diaSol) : `<b>${esc(CUERPO[p.escena.meta.cuerpo] ?? '')}</b> · Sun set by hand in Display (${p.escena.sol.el.toFixed(1)}° high). Press Play or move the hour to follow the real Sun.`;
      pintarTira(p, d.querySelector('.dia-tira'));
    }
  }

  // ---------- Tira del día: en cada paso, ¿le da el sol al equipo seguido? ----------
  const claveMapa = (p) => [S.modo, tipo(p) === 'tierra' ? S.mes : tipo(p) === 'mundo' ? declDe(p) : `${p.diaBase?.az}|${p.diaBase?.el()}`, p.escena.versionAlturas, p.escena.verOriginal].join('|');
  // Lo que dura cada uno de los 24 pasos de la tira en este panel.
  const pasoDe = (p) => {
    if (tipo(p) === 'tierra' || S.modo === 'mismo') return 'hours';
    const h = (tipo(p) === 'polar' ? DIA_LUNAR_H : DIA_H[p.escena.meta.cuerpo]) / PASOS;
    return `steps of ${h.toFixed(h < 10 ? 2 : 1)} h`;
  };
  function calcularMapa(p) {
    const e = p.escena, clave = claveMapa(p);
    if (p.diaMapa?.clave === clave) return;
    const trabajo = { clave, bits: new Uint32Array(e.n * e.n), soles: [], hecho: 0 };
    p.diaMapa = trabajo;
    const h = sobrePlanoTangente(e.mostradas, e.n, e.m, e.meta.georef.radio_m);
    const paso = () => {
      if (p.diaMapa !== trabajo) return;
      const k = trabajo.hecho, s = solDe(p, k + 0.5);
      trabajo.soles.push(s);
      if (s && s.el > 0) {
        const m = sombras(h, e.n, e.m, s.az, s.el), b = trabajo.bits, bit = 1 << k;
        for (let i = 0; i < m.length; i++) if (m[i] === 255) b[i] |= bit;
      }
      trabajo.hecho++;
      if (trabajo.hecho < PASOS) setTimeout(paso, 0);
      else { pintarLecturas(); ctx.alCambiar?.(); }
    };
    setTimeout(paso, 0);
  }

  function pintarTira(p, tira) {
    const g = S.activo && tipo(p) ? seguido(p) : null;
    tira.hidden = !g;
    if (!g) return;
    const m = p.diaMapa;
    if (!m || m.hecho < PASOS || m.clave !== claveMapa(p)) { tira.innerHTML = '<span class="tenue">working out the light through the day…</span>'; return; }
    const v = m.bits[g.it.fila * p.escena.n + g.it.col], ahora = Math.min(PASOS - 1, Math.floor(S.hora));
    const paso = pasoDe(p);
    tira.innerHTML = `<span class="et">Light on ${esc(nombreCorto(g.it.equipo))} through the day</span>
      <span class="celdas" role="img" aria-label="Sunlit in ${bits(v)} of ${PASOS} ${paso}">${Array.from({ length: PASOS }, (_, k) => {
        const s = m.soles[k], c = (v >>> k) & 1 ? 'sol' : s.el > 0 ? 'sombra' : 'noche';
        return `<i class="${c}${k === ahora ? ' ahora' : ''}" title="${tipo(p) === 'tierra' ? `${horaTexto(k)}–${horaTexto(k + 1)}` : `step ${k + 1}`}: ${c === 'sol' ? 'sunlit' : c === 'sombra' ? 'in the shadow of the terrain' : 'night'}"></i>`;
      }).join('')}</span>
      <span class="num">${bits(v)} of ${PASOS}</span> <span class="tenue">${paso} sunlit</span>`;
  }

  // ---------- Aplicar la hora ----------
  function aplicar() {
    if (!S.activo) { pintarLecturas(); return; }
    for (const p of vivos()) {
      p.diaBase ??= { az: p.escena.sol.az, el: () => +p.el.querySelector('.mandos [data-sol=el]').value };
      const s = solDe(p, S.hora);
      p.diaSol = s;
      if (!s) continue;
      mandosPanel(p, s);
      p.escena.setSol(s.az, s.el);
      calcularMapa(p);
    }
    $('[data-a=hora]').value = S.hora;
    $('[data-v=hora]').textContent = horaTexto(S.hora);
    pintarLecturas();
  }
  function pedir(refrescar = true) {
    if (S.pendiente) return;
    S.pendiente = true;
    requestAnimationFrame(() => { S.pendiente = false; aplicar(); if (refrescar && !S.anim) ctx.alCambiar?.(); });
  }
  const activar = () => { if (!S.activo) { S.activo = true; caja.dataset.activo = '1'; } };

  function parar() {
    if (!S.anim) return;
    cancelAnimationFrame(S.anim);
    S.anim = null;
    const b = $('[data-a=play]');
    b.textContent = '▶ Play the day'; b.setAttribute('aria-pressed', 'false');
    ctx.alCambiar?.();
  }
  function reproducir() {
    activar();
    const h0 = S.hora >= 24 ? 0 : S.hora, t0 = performance.now();
    const b = $('[data-a=play]');
    b.textContent = '❚❚ Pause'; b.setAttribute('aria-pressed', 'true');
    const paso = (t) => {
      const h = h0 + ((t - t0) / DURACION_MS) * 24;
      S.hora = Math.min(24, Math.round(h * 10) / 10);
      aplicar();
      if (h < 24) S.anim = requestAnimationFrame(paso); else parar();
    };
    S.anim = requestAnimationFrame(paso);
  }

  $('[data-a=play]').addEventListener('click', () => (S.anim ? parar() : reproducir()));
  $('[data-a=hora]').addEventListener('input', (ev) => { parar(); activar(); S.hora = +ev.target.value; pedir(); });
  selMes.addEventListener('change', () => { S.mes = +selMes.value; activar(); pedir(); });
  $('[data-a=decl]').addEventListener('change', (ev) => { S.decl = +ev.target.value; activar(); pedir(); });
  caja.querySelectorAll('[data-modo]').forEach((b) => b.addEventListener('click', () => {
    S.modo = b.dataset.modo;
    caja.querySelectorAll('[data-modo]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    activar(); pedir();
  }));

  const hay = (k) => vivos().some((p) => tipo(p) === k);
  caja.hidden = !vivos().some((p) => tipo(p));
  $('[data-g=mes]').hidden = !hay('tierra');
  $('[data-g=modo]').hidden = !hay('polar') && !hay('mundo');
  $('[data-g=fuente-marte]').hidden = !vivos().some((p) => p.escena.meta.cuerpo === 'marte');
  $('[data-g=decl]').hidden = !vivos().some((p) => tipo(p) === 'mundo' && p.escena.meta.cuerpo === 'marte');
  pintarLecturas();

  return {
    estado: S,
    // Sol movido a mano en Display: la altura lunar se respeta; lo demás suelta el recorrido.
    manual(p, cual) {
      if (!S.activo) { pintarLecturas(); return; }
      if (tipo(p) === 'polar' && cual === 'el') { pedir(); return; }
      if (tipo(p) === 'polar' && cual === 'az') { const horas = S.modo === 'mismo' ? S.hora : (S.hora / 24) * DIA_LUNAR_H; p.diaBase.az = p.escena.sol.az + (360 * horas) / DIA_LUNAR_H; pedir(); return; }
      parar(); S.activo = false; delete caja.dataset.activo; pintarLecturas(); ctx.alCambiar?.();
    },
    refrescar: pintarLecturas,
    // Para la ficha del equipo espejo: pasos con sol de su día.
    de(p, it) {
      const m = p.diaMapa;
      if (!S.activo || !m || m.hecho < PASOS || m.clave !== claveMapa(p)) return null;
      return { luz: bits(m.bits[it.fila * p.escena.n + it.col]), total: PASOS, unidad: pasoDe(p) };
    },
    ir(hora) { parar(); activar(); S.hora = hora; aplicar(); ctx.alCambiar?.(); },
    listo: () => !S.activo || vivos().every((p) => !tipo(p) || (p.diaMapa?.hecho === PASOS && p.diaMapa.clave === claveMapa(p))),
  };
}
