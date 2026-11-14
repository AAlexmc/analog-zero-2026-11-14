// Contraste WCAG 2.x de las parejas texto/fondo que usan la portada y la vista del mundo.
export const PALETA = {
  'blue-yonder': '#2E96F5', 'neon-blue': '#0960E1', 'electric-blue': '#0042A6', 'deep-blue': '#07173F',
  'rocket-red': '#E43700', 'martian-red': '#8E1100', 'neon-yellow': '#EAFE07', white: '#FFFFFF',
};

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// Color con alfa a sobre un fondo opaco (los dos como nombre de la paleta o [r, g, b]).
export function mezclar(color, alfa, fondo) {
  const a = Array.isArray(color) ? color : rgb(PALETA[color]), b = Array.isArray(fondo) ? fondo : rgb(PALETA[fondo]);
  return a.map((v, i) => alfa * v + (1 - alfa) * b[i]);
}

export function luminancia(c) {
  const [r, g, b] = (Array.isArray(c) ? c : rgb(PALETA[c] ?? c)).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contraste(a, b) {
  const la = luminancia(a), lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Panel .marca-panel (deep blue al 86 %) en el peor caso: sobre blanco (textura clara del planeta detrás).
const PANEL_PEOR = mezclar('deep-blue', 0.86, 'white');
const TENUE = (fondo) => mezclar('white', 0.74, fondo);
const BARRA = mezclar('deep-blue', 0.72, 'electric-blue');

export const PAREJAS = [
  { uso: 'body text on the gradient (bottom-right)', texto: 'white', fondo: 'deep-blue' },
  { uso: 'body text on the gradient (top-left)', texto: 'white', fondo: 'electric-blue' },
  { uso: 'muted text on deep blue', texto: TENUE('deep-blue'), fondo: 'deep-blue' },
  { uso: 'muted text on electric blue', texto: TENUE('electric-blue'), fondo: 'electric-blue' },
  { uso: 'accent text on deep blue', texto: 'neon-yellow', fondo: 'deep-blue' },
  { uso: 'accent text on electric blue', texto: 'neon-yellow', fondo: 'electric-blue' },
  { uso: 'primary button', texto: 'deep-blue', fondo: 'white' },
  { uso: 'primary button, hover and focus', texto: 'deep-blue', fondo: 'neon-yellow' },
  { uso: 'panel text, worst case over a bright planet', texto: 'white', fondo: PANEL_PEOR },
  { uso: 'panel muted text, worst case over a bright planet', texto: TENUE(PANEL_PEOR), fondo: PANEL_PEOR },
  { uso: 'panel accent, worst case over a bright planet', texto: 'neon-yellow', fondo: PANEL_PEOR },
  { uso: 'top bar text over the gradient', texto: 'white', fondo: BARRA },
  { uso: 'numbered place marker on the globe', texto: 'deep-blue', fondo: 'white' },
  { uso: 'selected place marker and its card number', texto: 'deep-blue', fondo: 'neon-yellow' },
  { uso: 'similarity legend and partial-place note over a bright globe', texto: 'neon-yellow', fondo: PANEL_PEOR },
  { uso: 'top bar muted links over the gradient', texto: TENUE(BARRA), fondo: BARRA },
  { uso: 'global map zoom buttons over the brightest map colour', texto: 'white', fondo: mezclar('deep-blue', 0.72, 'white') },
  { uso: 'global map canvas labels on their deep blue halo', texto: 'white', fondo: mezclar('deep-blue', 0.9, 'white') },
  { uso: 'synthetic-data banner, lighter stripe', texto: 'deep-blue', fondo: mezclar('white', 0.78, 'deep-blue') },
  { uso: 'global map breaking value in the data flower (red petal beside it)', texto: 'neon-yellow', fondo: PANEL_PEOR },
  { uso: 'base site box: "NASA says" link and met-limit tick over a bright planet', texto: 'neon-yellow', fondo: PANEL_PEOR },
  { uso: 'base site box: NASA quote and limit number field', texto: 'white', fondo: 'deep-blue' },
  { uso: 'base site box: option markers on the globe, normal and hover', texto: 'deep-blue', fondo: 'neon-yellow' },
  { uso: 'portfolio letter markers on the globe and their cards, normal', texto: 'deep-blue', fondo: 'white' },
  { uso: 'portfolio letter markers on the globe and their cards, selected', texto: 'deep-blue', fondo: 'neon-yellow' },
  { uso: 'portfolio "test this in a lab" and Compare best cell over a bright planet', texto: 'neon-yellow', fondo: PANEL_PEOR },
  { uso: 'unlisted chip and environment legend notes over a bright planet', texto: TENUE(PANEL_PEOR), fondo: PANEL_PEOR },
  { uso: 'Compare table first column (opaque deep blue)', texto: 'white', fondo: 'deep-blue' },
  { uso: 'terrain viewer: selected segment and pressed button', texto: 'white', fondo: 'electric-blue' },
  { uso: 'terrain viewer: card, controls and labels over bright terrain', texto: 'white', fondo: PANEL_PEOR },
  { uso: 'terrain viewer: "Plant" and "Drill here" hint label on its white pill', texto: 'electric-blue', fondo: 'white' },
  { uso: 'terrain viewer: side panel text over the brand gradient (lightest corner)', texto: 'white', fondo: mezclar('deep-blue', 0.86, 'electric-blue') },
  { uso: 'terrain viewer: side panel muted text over the brand gradient (lightest corner)', texto: TENUE(mezclar('deep-blue', 0.86, 'electric-blue')), fondo: mezclar('deep-blue', 0.86, 'electric-blue') },
  { uso: 'terrain viewer: ground view note on its white pill', texto: 'deep-blue', fondo: 'white' },
  { uso: 'terrain viewer: "your place could not be built" notice', texto: 'white', fondo: 'deep-blue' },
  { uso: 'terrain viewer: mission equipment label, assumed size and slope over the limit (accent) on the side panel', texto: 'neon-yellow', fondo: mezclar('deep-blue', 0.86, 'electric-blue') },
  { uso: 'terrain viewer: mission equipment text on the equipment list', texto: 'white', fondo: mezclar('deep-blue', 0.95, 'electric-blue') },
  { uso: 'Calendar equipment strip: "works" box (tick on white)', texto: 'deep-blue', fondo: 'white' },
  { uso: 'Calendar equipment strip: "breaks" and "no data" boxes (sign on deep blue, red only as border)', texto: 'white', fondo: 'deep-blue' },
  { uso: 'Calendar equipment: "NASA ran this here" line over a bright planet', texto: 'neon-yellow', fondo: PANEL_PEOR },
];
