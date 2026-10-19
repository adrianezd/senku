'use strict';

/* =========================================================================
   Senku — el solitario de clavijas
   Se salta una bola por encima de otra (en línea recta, a un hueco vacío)
   y la saltada se quita. El objetivo: dejar una sola bola. Tres tableros
   (inglés, europeo y triangular), deshacer, pistas y récords guardados
   en el navegador.
   ========================================================================= */

const STORE = 'senku-v1';

// Cada tablero: sus casillas (en coordenadas propias), las direcciones de salto,
// dónde se dibuja cada casilla y el hueco inicial (null: lo elige el jugador).
function crossCells(extra) {
  const out = [];
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
    const arm = (x >= 2 && x <= 4) || (y >= 2 && y <= 4);
    if (arm || (extra && [1, 5].includes(x) && [1, 5].includes(y))) out.push([x, y]);
  }
  return out;
}
function triCells() {
  const out = [];
  for (let r = 0; r < 5; r++) for (let c = 0; c <= r; c++) out.push([c, r]);
  return out;
}
const SQ = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const TRI = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]];

const BOARDS = {
  ingles: { name: 'Inglés', sub: '33 agujeros · el clásico', cells: crossCells(false), dirs: SQ, start: '3,3', pos: ([x, y]) => [x / 6, y / 6], size: 7, ratio: 1 },
  europeo: { name: 'Europeo', sub: '37 agujeros · tú eliges el hueco', cells: crossCells(true), dirs: SQ, start: null, pos: ([x, y]) => [x / 6, y / 6], size: 7, ratio: 1 },
  triangulo: { name: 'Triángulo', sub: '15 agujeros · rápido', cells: triCells(), dirs: TRI, start: null, pos: ([c, r]) => [(c - r / 2 + 2) / 4, r / 4], size: 5.4, ratio: 0.88 }
};

const RANKS = [
  [1, '🏆', '¡Genio!', 'Solo queda una bola. Eso es dominar el senku.'],
  [2, '🥈', 'Experto', 'A una bola de la perfección.'],
  [3, '🥉', 'Muy bien', 'Tres bolas: nada mal.'],
  [4, '👍', 'Bien', 'Vas por buen camino.'],
  [99, '🙂', 'Sigue practicando', 'El truco está en no dejar bolas aisladas en las esquinas.']
];

/* --------------------------------- Estado --------------------------------- */

let store = load();
let S = null; // { key, pegs: Set, history: [], sel, picking, moves }
const el = {};

function load() {
  try { return Object.assign({ board: 'ingles', best: {}, wins: {}, sound: true }, JSON.parse(localStorage.getItem(STORE) || '{}')); }
  catch (e) { return { board: 'ingles', best: {}, wins: {}, sound: true }; }
}
function save() { try { localStorage.setItem(STORE, JSON.stringify(store)); } catch (e) { /* sin guardar */ } }

const id = (c) => c.join(',');
const B = () => BOARDS[S.key];
const has = (k) => B().cells.some((c) => id(c) === k);

function newGame(key) {
  const b = BOARDS[key];
  const pegs = new Set(b.cells.map(id));
  if (b.start) pegs.delete(b.start);
  S = { key, pegs, history: [], sel: null, picking: !b.start, moves: 0, hint: null };
  store.board = key;
  save();
  render(true);
}

// Saltos posibles desde una bola
function jumpsFrom(k) {
  const [x, y] = k.split(',').map(Number);
  const out = [];
  B().dirs.forEach(([dx, dy]) => {
    const mid = `${x + dx},${y + dy}`;
    const to = `${x + 2 * dx},${y + 2 * dy}`;
    if (has(to) && S.pegs.has(mid) && !S.pegs.has(to)) out.push({ from: k, mid, to });
  });
  return out;
}
const allJumps = () => [...S.pegs].flatMap(jumpsFrom);

function doJump(j) {
  S.history.push({ pegs: new Set(S.pegs), moves: S.moves });
  S.pegs.delete(j.from);
  S.pegs.delete(j.mid);
  S.pegs.add(j.to);
  S.moves += 1;
  S.sel = null;
  S.hint = null;
  sound('jump');
  render(false, j);
}

function undo() {
  const h = S.history.pop();
  if (!h) return;
  S.pegs = h.pegs;
  S.moves = h.moves;
  S.sel = null;
  S.hint = null;
  sound('tap');
  render();
}

/* ---------------------------------- Pista ---------------------------------- */
// Busca un salto que aún permita acabar con pocas bolas (búsqueda limitada en el tiempo)

function hint() {
  if (S.picking) return;
  const jumps = allJumps();
  if (!jumps.length) return;
  const t0 = performance.now();
  const seen = new Set();
  let best = { left: Infinity, first: jumps[0] };
  const key = () => [...S.pegs].sort().join(' ');
  function dfs(first) {
    if (performance.now() - t0 > 700) return true;
    const k = key();
    if (seen.has(k)) return false;
    seen.add(k);
    const js = allJumps();
    if (!js.length) {
      if (S.pegs.size < best.left) best = { left: S.pegs.size, first };
      return S.pegs.size === 1;
    }
    for (const j of js) {
      S.pegs.delete(j.from); S.pegs.delete(j.mid); S.pegs.add(j.to);
      const stop = dfs(first || j);
      S.pegs.add(j.from); S.pegs.add(j.mid); S.pegs.delete(j.to);
      if (stop) return true;
    }
    return false;
  }
  dfs(null);
  S.hint = best.first;
  S.sel = null;
  sound('tap');
  render();
}

/* --------------------------------- Sonido --------------------------------- */

let ctx = null;
function sound(kind) {
  if (!store.sound) return;
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const t = ctx.currentTime;
    const f = { tap: 520, jump: 330, win: 660, lose: 200 }[kind] || 440;
    o.type = kind === 'jump' ? 'triangle' : 'sine';
    o.frequency.setValueAtTime(f, t);
    if (kind === 'jump') o.frequency.exponentialRampToValueAtTime(180, t + 0.12);
    if (kind === 'win') o.frequency.exponentialRampToValueAtTime(1320, t + 0.35);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'win' ? 0.5 : 0.15));
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.6);
  } catch (e) { /* sin sonido */ }
}

/* --------------------------------- Pintar --------------------------------- */

function render(fresh, last) {
  const b = B();
  el.board.style.setProperty('--n', b.size);
  el.board.style.aspectRatio = String(1 / b.ratio);
  el.board.classList.toggle('is-tri', S.key === 'triangulo');
  if (fresh) {
    el.board.innerHTML = b.cells.map((c) => {
      const [px, py] = b.pos(c);
      return `<button type="button" class="hole" data-k="${id(c)}" style="--x:${px};--y:${py}" aria-label="Casilla ${id(c)}"><span class="peg"></span></button>`;
    }).join('');
  }
  const targets = S.sel ? jumpsFrom(S.sel).map((j) => j.to) : [];
  const movable = new Set(S.picking ? [] : allJumps().map((j) => j.from));
  el.board.querySelectorAll('.hole').forEach((h) => {
    const k = h.dataset.k;
    const on = S.pegs.has(k);
    h.classList.toggle('has-peg', on);
    h.classList.toggle('is-sel', S.sel === k);
    h.classList.toggle('is-target', targets.includes(k));
    h.classList.toggle('can-move', movable.has(k) && !S.sel);
    h.classList.toggle('is-hint', Boolean(S.hint && (S.hint.from === k || S.hint.to === k)));
    h.classList.toggle('just-landed', Boolean(last && last.to === k));
    h.classList.toggle('just-gone', Boolean(last && last.mid === k));
    h.setAttribute('aria-pressed', String(S.sel === k));
  });
  el.left.textContent = String(S.pegs.size);
  el.moves.textContent = String(S.moves);
  const best = store.best[S.key];
  el.best.textContent = best ? String(best) : '—';
  el.undo.disabled = !S.history.length;
  el.hint.disabled = S.picking;
  el.msg.textContent = S.picking ? 'Toca la bola que quieres quitar para empezar.' : S.sel ? 'Ahora toca un hueco marcado.' : '';
  document.querySelectorAll('[data-board]').forEach((t) => t.classList.toggle('is-on', t.dataset.board === S.key));
  checkEnd();
}

function checkEnd() {
  if (S.picking || allJumps().length) { el.end.hidden = true; return; }
  const n = S.pegs.size;
  const center = S.key === 'ingles' && n === 1 && S.pegs.has('3,3');
  const [, emoji, title, text] = RANKS.find(([max]) => n <= max);
  const prev = store.best[S.key];
  const record = !prev || n < prev;
  if (!el.end.dataset.shown || el.end.hidden) {
    if (record) store.best[S.key] = n;
    if (n === 1) store.wins[S.key] = (store.wins[S.key] || 0) + 1;
    save();
    sound(n <= 2 ? 'win' : 'lose');
    if (n === 1) confetti();
  }
  el.endEmoji.textContent = center ? '👑' : emoji;
  el.endTitle.textContent = center ? '¡Perfecto!' : title;
  el.endText.textContent = center ? 'Una sola bola y justo en el centro. La jugada maestra.' : `${n === 1 ? 'Una bola' : `${n} bolas`} en ${S.moves} saltos. ${text}${record && prev ? ' ¡Nuevo récord!' : ''}`;
  el.end.hidden = false;
  el.end.dataset.shown = '1';
}

function confetti() {
  const box = document.createElement('div');
  box.className = 'confetti';
  for (let i = 0; i < 40; i++) {
    const s = document.createElement('i');
    s.style.setProperty('--l', `${Math.random() * 100}%`);
    s.style.setProperty('--d', `${0.8 + Math.random() * 1.4}s`);
    s.style.setProperty('--h', `${Math.floor(Math.random() * 360)}`);
    box.appendChild(s);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 2600);
}

/* --------------------------------- Eventos --------------------------------- */

function onHole(k) {
  if (S.picking) {
    if (!S.pegs.has(k)) return;
    S.history.push({ pegs: new Set(S.pegs), moves: S.moves });
    S.pegs.delete(k);
    S.picking = false;
    sound('tap');
    render();
    return;
  }
  if (S.sel && !S.pegs.has(k)) {
    const j = jumpsFrom(S.sel).find((x) => x.to === k);
    if (j) doJump(j);
    return;
  }
  if (S.pegs.has(k)) {
    const js = jumpsFrom(k);
    if (!js.length) { S.sel = null; render(); el.msg.textContent = 'Esa bola no puede saltar ahora.'; return; }
    if (js.length === 1 && S.sel === k) { doJump(js[0]); return; }
    S.sel = S.sel === k ? null : k;
    S.hint = null;
    sound('tap');
    render();
  }
}

function init() {
  ['board', 'left', 'moves', 'best', 'undo', 'hint', 'restart', 'msg', 'end', 'end-emoji', 'end-title', 'end-text', 'again', 'sound'].forEach((k) => {
    el[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = document.getElementById(k);
  });
  document.getElementById('tabs').innerHTML = Object.keys(BOARDS).map((k) =>
    `<button type="button" class="tab" data-board="${k}"><strong>${BOARDS[k].name}</strong><small>${BOARDS[k].sub}</small></button>`).join('');
  document.querySelectorAll('[data-board]').forEach((t) => { t.onclick = () => { el.end.hidden = true; delete el.end.dataset.shown; newGame(t.dataset.board); }; });
  el.board.addEventListener('click', (e) => { const h = e.target.closest('.hole'); if (h) onHole(h.dataset.k); });
  el.undo.onclick = () => { el.end.hidden = true; delete el.end.dataset.shown; undo(); };
  el.hint.onclick = hint;
  el.restart.onclick = () => { el.end.hidden = true; delete el.end.dataset.shown; newGame(S.key); };
  el.again.onclick = () => { el.end.hidden = true; delete el.end.dataset.shown; newGame(S.key); };
  el.sound.checked = store.sound;
  el.sound.onchange = () => { store.sound = el.sound.checked; save(); };
  newGame(BOARDS[store.board] ? store.board : 'ingles');
  if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
}

document.addEventListener('DOMContentLoaded', init);
