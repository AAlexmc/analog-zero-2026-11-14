import { MUNDOS, SECCIONES, entradas, porGrupo, porParametro } from './fuentes.js';

const el = (tag, props = {}, ...hijos) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const h of hijos.flat()) if (h !== null && h !== undefined) n.append(h);
  return n;
};

const enlace = (url, texto) => (url ? el('a', { href: url, target: '_blank', rel: 'noopener', textContent: texto }) : null);
const sello = (propio) => (propio ? el('span', { className: 'marca-chip propio', textContent: 'own computation' }) : null);

function celda(e) {
  if (!e) return el('td', { className: 'vacia', textContent: '—' });
  return el('td', {}, el('span', { textContent: e.texto ?? 'not public' }), ' ', sello(e.propio),
    e.aviso ? el('span', { className: 'aviso', textContent: e.aviso }) : null, e.url && !e.aviso ? el('br') : null, enlace(e.url, 'Open the source'));
}

function tabla(lista, seccion) {
  const filas = porParametro(lista, seccion);
  if (!filas.length) return null;
  const mundos = Object.keys(MUNDOS).filter((m) => filas.some((f) => f.celdas[m]));
  return el('div', { className: 'tabla-envoltura' },
    el('table', { className: 'tabla-fuentes' },
      el('thead', {}, el('tr', {}, el('th', { scope: 'col', textContent: 'Parameter' }), mundos.map((m) => el('th', { scope: 'col', textContent: MUNDOS[m] })))),
      el('tbody', {}, filas.map((f) => el('tr', {}, el('th', { scope: 'row', textContent: f.nombre }), mundos.map((m) => celda(f.celdas[m])))))));
}

function grupo(g) {
  return el('section', { className: `grupo marca-panel${g.principal ? '' : ' secundario'}`, id: `grupo-${g.id}` },
    el('h3', { className: 'marca-subtitulo', textContent: `${g.titulo} ` }, el('span', { className: 'cuenta marca-num', textContent: `${g.fuentes.length}` })),
    el('p', { className: 'regla', textContent: `Rule: ${g.regla}.` }),
    g.fuentes.length
      ? el('ul', {}, g.fuentes.map((f) => el('li', {},
        el('span', { className: 'texto', textContent: f.texto ?? 'not public' }), ' ', sello(f.propio), ' ', enlace(f.url, 'Open'),
        el('span', { className: 'usos', textContent: `Used for: ${f.usos.join(' · ')}` }))))
      : el('p', { className: 'vacio', textContent: 'No dataset of this tool comes from here.' }));
}

async function iniciar() {
  const raiz = document.getElementById('contenido');
  try {
    const [indice, sitio] = await Promise.all(['data/cuerpos/indice.json', 'data/sitio/indice.json'].map((u) => fetch(u).then((r) => {
      if (!r.ok) throw new Error(`${u}: ${r.status}`);
      return r.json();
    })));
    const lista = entradas(indice, sitio);
    raiz.replaceChildren(
      el('section', { className: 'bloque' },
        el('h2', { className: 'marca-titulo', id: 't-grupos', textContent: 'By data archive' }),
        el('p', { className: 'nota' }, 'Each dataset sorted by where it comes from. ', el('span', { className: 'marca-chip', textContent: 'own grouping' })),
        el('div', { className: 'grupos' }, porGrupo(lista).map(grupo))),
      el('section', { className: 'bloque' },
        el('h2', { className: 'marca-titulo', id: 't-param', textContent: 'By parameter and world' }),
        SECCIONES.map((s) => {
          const t = tabla(lista, s.id);
          return t ? el('div', { className: 'seccion' }, el('h3', { className: 'marca-subtitulo', textContent: s.titulo }), t) : null;
        })));
  } catch (e) {
    raiz.replaceChildren(el('p', { className: 'error', textContent: `The data index could not be read (${e.message}).` }));
    console.error(e);
  }
}

iniciar();
