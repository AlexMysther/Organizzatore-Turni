import { api, getToken, setToken, ApiError } from './api.js';
import * as D from './dates.js';
import { buildPdf, sharePdf, downloadPdf, venueLabel } from './pdf.js';

const state = {
  venues: [], deps: [], venueId: null, weekStart: D.defaultWeek(),
  week: null, index: new Map(), tab: 'turni', mode: 'day', day: 0, statsOpen: false,
};
const root = document.getElementById('app');

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k.startsWith('aria-') || k === 'role') el.setAttribute(k, v === true ? 'true' : v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter((c) => c != null && c !== false));
  return el;
}

// Icone a tratto (stile Lucide), colorate con il colore del testo.
const ICONS = {
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  pencil: '<path d="M17 3a2.85 2.85 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};
function icon(name, size = 22) {
  const el = document.createElement('span');
  el.className = 'ic';
  el.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return el;
}

let toastTimer;
function toast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), 3200);
}

// Esegue un'azione dell'API mostrando gli errori; ritorna true se è andata a buon fine.
async function act(fn) {
  try {
    await fn();
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401 && getToken()) logout();
    else toast(e.message || 'Errore', true);
    return false;
  }
}

function logout() {
  setToken(null);
  renderLogin();
}

/* ---------- accesso ---------- */

function renderLogin(error = '') {
  const user = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', value: 'manager' });
  const pass = h('input', { type: 'password', autocomplete: 'current-password' });
  const err = h('div', { class: 'err' }, error);
  const go = async (ev) => {
    ev.preventDefault();
    err.textContent = '';
    try {
      const { token } = await api.login(user.value.trim(), pass.value);
      setToken(token);
      boot();
    } catch (e) {
      err.textContent = e.message;
    }
  };
  root.replaceChildren(h('form', { class: 'login', onsubmit: go },
    h('h1', {}, 'Organizzatore Turni'),
    h('div', { class: 'sub', style: 'color:var(--muted)' }, 'Accedi per gestire i turni'),
    h('label', { class: 'field' }, 'Utente', user),
    h('label', { class: 'field' }, 'Password', pass),
    err,
    h('button', { class: 'btn primary block', type: 'submit' }, 'Entra')));
}

async function boot() {
  if (!getToken()) return renderLogin();
  root.replaceChildren(h('div', { class: 'empty-state' }, 'Caricamento…'));
  const ok = await act(async () => {
    [state.venues, state.deps] = await Promise.all([api.venues(), api.departments()]);
  });
  if (!ok) return getToken() ? root.replaceChildren(h('div', { class: 'empty-state' }, 'Impossibile caricare i dati.', h('button', { class: 'btn block', onclick: boot }, 'Riprova'))) : undefined;
  if (!state.venues.length) return renderFirstVenue();
  const saved = Number(localStorage.getItem('turni.venue'));
  state.venueId = state.venues.some((v) => v.id === saved) ? saved : state.venues[0].id;
  await reloadWeek();
}

function renderFirstVenue() {
  const city = h('input', { value: 'Milano' });
  const name = h('input', { placeholder: 'es. Tunisia' });
  root.replaceChildren(h('div', { class: 'login' },
    h('h1', {}, 'Crea il primo locale'),
    h('label', { class: 'field' }, 'Città', city),
    h('label', { class: 'field' }, 'Nome del locale', name),
    h('button', { class: 'btn primary block', onclick: async () => {
      if (await act(() => api.addVenue(city.value.trim(), name.value.trim()))) boot();
    } }, 'Crea')));
}

/* ---------- dati ---------- */

async function reloadWeek() {
  await act(async () => {
    state.week = await api.week(state.venueId, state.weekStart);
    state.index = new Map();
    for (const s of state.week.shifts) {
      const k = `${s.employee_id}|${s.date}`;
      if (!state.index.has(k)) state.index.set(k, []);
      state.index.get(k).push(s);
    }
  });
  render();
}

const entriesOf = (empId, date) => state.index.get(`${empId}|${date}`) || [];
const venueName = (id) => state.week.venues.find((v) => v.id === id)?.name || '?';
const dates = () => D.weekDates(state.weekStart);

// here: la scheda sta nel locale che ospita, quindi i prestiti mostrano solo l'orario (e il colore pranzo/cena)
function chips(entries, here = false) {
  if (!entries.length) return h('div', { class: 'chips' }, h('span', { class: 'chip empty' }, '—'));
  return h('div', { class: 'chips' }, entries.map((e) => {
    if (e.kind === 'rest') return h('span', { class: 'chip rest' }, 'R');
    if (e.kind === 'work') return h('span', { class: `chip ${slotOf(e) === 'cena' ? 'dinner' : 'lunch'}` }, `${e.start} – ${e.end}`);
    if (here) return h('span', { class: `chip ${slotOf(e) === 'cena' ? 'dinner' : slotOf(e) ? 'lunch' : 'loan'}` }, e.start ? `${e.start} – ${e.end}` : 'Senza orario');
    return h('span', { class: 'chip loan' }, [icon('arrow', 13), ` ${venueName(e.venue_id)}${e.start ? ` ${e.start}–${e.end}` : ''}`]);
  }));
}

// Persone di altri locali che lavorano qui in prestito (si modificano dal loro locale di casa).
const guestsOf = () => state.week.guests || [];
const hereLoans = (g, d) => entriesOf(g.id, d).filter((e) => e.kind === 'loan' && e.venue_id === state.venueId);
const guestName = (g) => [g.full_name, h('small', { class: 'from' }, ` da ${venueName(g.home_venue_id)}`)];


/* ---------- schermata principale ---------- */

// Menu a tendina personalizzato (l'elenco dei <select> nativi non è stilizzabile su desktop).
// options: [{ value, label }]; la variante 'form' si apre dentro la scheda invece di sovrapporsi.
function dropdown({ options, value, label, onchange, variant = '' }) {
  let current = value;
  const text = h('span', {});
  const menu = h('div', { class: 'menu', role: 'listbox', hidden: true });
  const btn = h('button', { class: 'picker-btn', type: 'button', 'aria-haspopup': 'listbox', 'aria-label': label, 'aria-expanded': 'false',
    onclick: (e) => { e.stopPropagation(); const open = menu.hidden; closePicker(); menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); } },
  text, icon('chevron', 18));
  const draw = () => {
    text.textContent = options.find((o) => o.value === current)?.label ?? '';
    menu.replaceChildren(...options.map((o) => h('button', {
      class: 'opt', role: 'option', 'aria-selected': o.value === current, type: 'button',
      onclick: () => {
        menu.hidden = true; btn.setAttribute('aria-expanded', 'false');
        if (o.value === current) return;
        current = o.value; draw(); onchange(o.value);
      },
    }, o.label, o.value === current ? icon('check', 18) : null)));
  };
  draw();
  const wrap = h('div', { class: `picker ${variant}`.trim() }, btn, menu);
  Object.defineProperty(wrap, 'value', { get: () => current });
  return wrap;
}

const venuePicker = () => dropdown({
  label: 'Locale', value: state.venueId, options: state.venues.map((v) => ({ value: v.id, label: venueLabel(v) })),
  onchange: (id) => {
    state.venueId = id;
    try { localStorage.setItem('turni.venue', id); } catch { /* storage non disponibile */ }
    reloadWeek();
  },
});
const closePicker = () => document.querySelectorAll('.picker .menu').forEach((m) => { m.hidden = true; m.previousElementSibling?.setAttribute('aria-expanded', 'false'); });
document.addEventListener('click', closePicker);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePicker(); });

function render() {
  const wk = state.weekStart;
  const topbar = h('div', { class: 'topbar' },
    h('div', { class: 'toprow' }, venuePicker(),
      state.tab === 'turni' ? h('button', { class: 'pdfbtn', 'aria-label': 'Crea PDF della settimana', onclick: makePdf }, icon('file', 22)) : null),
    state.tab === 'turni' ? h('div', { class: 'weeknav' },
      h('button', { 'aria-label': 'Settimana precedente', onclick: () => shiftWeek(-7) }, icon('left')),
      h('div', { class: 'label' }, `Settimana ${D.isoWeek(wk)}`, h('small', {}, D.weekLabel(wk))),
      h('button', { 'aria-label': 'Settimana successiva', onclick: () => shiftWeek(7) }, icon('right'))) : null);

  const slide = pendingSlide;
  pendingSlide = null;
  const body = pager(state.tab === 'turni' ? viewTurni() : state.tab === 'team' ? viewTeam() : viewAltro(), swipeAction());
  if (slide) (body.querySelector('.page') || body).classList.add(`in-${slide}`);
  const goTab = (id) => {
    if (id === state.tab) return;
    pendingSlide = TABS.indexOf(id) > TABS.indexOf(state.tab) ? 'next' : 'prev';
    state.tab = id;
    render();
  };
  const tab = (id, icon_, label) => h('button', { 'aria-current': state.tab === id ? 'page' : null, onclick: () => goTab(id) }, icon(icon_), h('span', { class: 'lbl' }, label));
  const nodes = [topbar, body];
  if (state.tab === 'turni') nodes.push(statsPanel());
  nodes.push(h('nav', { class: 'tabbar' }, tab('turni', 'calendar', 'Turni'), tab('team', 'users', 'Team'), tab('altro', 'settings', 'Altro')));
  const scroll = window.scrollY;
  root.replaceChildren(h('div', { class: 'app' }, nodes));
  const bar = root.querySelector('.tabbar');
  if (bar) document.documentElement.style.setProperty('--tabbar-h', `${bar.offsetHeight}px`);
  window.scrollTo(0, scroll);
}

function shiftWeek(n) {
  pendingSlide = n > 0 ? 'next' : 'prev';
  state.weekStart = D.addDays(state.weekStart, n);
  reloadWeek();
}

/* ---------- gesti: scorrimento tra giorni, settimane e schede ---------- */

const TABS = ['turni', 'team', 'altro'];
let pendingSlide = null; // 'next' | 'prev': direzione dell'animazione di ingresso al prossimo render()

// Cosa fa lo scorrimento orizzontale nella schermata corrente. dir: +1 = verso sinistra (avanti), -1 = indietro.
// Ritorna false se in quella direzione non c'è nulla da mostrare (il contenuto torna al suo posto).
function swipeAction() {
  return (dir) => {
    if (state.tab === 'turni') {
      if (state.mode === 'week') return shiftWeek(dir * 7);
      const day = state.day + dir;
      if (day >= 0 && day <= 6) { pendingSlide = dir > 0 ? 'next' : 'prev'; state.day = day; return render(); }
      state.day = dir > 0 ? 0 : 6;
      return shiftWeek(dir * 7);
    }
    const t = TABS[TABS.indexOf(state.tab) + dir];
    if (!t) return false;
    pendingSlide = dir > 0 ? 'next' : 'prev';
    state.tab = t;
    render();
  };
}

// Contenitore che segue il dito in orizzontale e, a gesto concluso, passa alla pagina successiva o precedente.
function pager(content, onSwipe) {
  const el = h('div', { class: 'pager' }, content);
  // si muove solo la parte con le liste (.page): intestazioni, giorni e riepilogo restano fermi
  const page = () => el.querySelector('.page') || el;
  let x0 = null, y0 = 0, t0 = 0, id = null, dragging = false;
  const reset = () => { x0 = null; dragging = false; el.classList.remove('dragging'); };
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    x0 = e.clientX; y0 = e.clientY; t0 = performance.now(); id = e.pointerId; dragging = false;
  });
  el.addEventListener('pointermove', (e) => {
    if (x0 == null || e.pointerId !== id) return;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    if (!dragging) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) return void (x0 = null); // è uno scorrimento verticale
      if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
      dragging = true;
      el.setPointerCapture(id);
      el.classList.add('dragging');
    }
    page().style.transform = `translate3d(${dx * 0.55}px, 0, 0)`;
    page().style.opacity = String(1 - Math.min(Math.abs(dx) / 500, 0.5));
  });
  const finish = (e) => {
    if (x0 == null || e.pointerId !== id) return;
    const dx = e.clientX - x0, fast = Math.abs(dx) / (performance.now() - t0) > 0.5;
    const was = dragging;
    reset();
    page().style.transition = 'transform .18s cubic-bezier(.2,.8,.2,1), opacity .18s';
    if (was && e.type === 'pointerup' && (Math.abs(dx) > el.offsetWidth * 0.22 || (fast && Math.abs(dx) > 30))) {
      const dir = dx < 0 ? 1 : -1;
      page().style.transform = `translate3d(${-dir * 48}px, 0, 0)`;
      page().style.opacity = '0';
      setTimeout(() => { if (onSwipe(dir) === false) { page().style.transform = ''; page().style.opacity = ''; } }, 110);
    } else {
      page().style.transform = ''; page().style.opacity = '';
    }
  };
  el.addEventListener('pointerup', finish);
  el.addEventListener('pointercancel', finish);
  return el;
}

function deptSections(renderEmployee) {
  const secs = state.deps.map((dep) => {
    const emps = state.week.employees.filter((e) => e.department_id === dep.id);
    if (!emps.length) return null;
    return h('section', { class: 'section' }, h('h2', {}, dep.name), emps.map(renderEmployee));
  }).filter(Boolean);
  return secs.length ? secs : [h('div', { class: 'empty-state' }, 'Nessun dipendente in questo locale.', h('br'), 'Aggiungili dalla scheda ', h('b', {}, 'Team'), '.')];
}

// date: un solo giorno (vista giorno); senza date, tutta la settimana
function guestSection(date) {
  const ds = dates();
  const list = date ? guestsOf().filter((g) => hereLoans(g, date).length) : guestsOf();
  if (!list.length) return null;
  return h('section', { class: 'section' }, h('h2', {}, 'In prestito da altri locali'), list.map((g) => h('div', { class: 'card' }, date
    ? h('div', { class: 'row' }, h('span', { class: 'who' }, guestName(g)), chips(hereLoans(g, date), true))
    : [h('div', { class: 'name' }, guestName(g)), h('div', { class: 'daytable' }, ds.map((d, i) => (hereLoans(g, d).length
      ? h('div', { class: 'row' + (i === 6 ? ' sunday' : '') }, h('span', { class: 'dl' }, `${D.DAYS[i]} ${D.dayOfMonth(d)}`), h('span', { style: 'flex:1' }), chips(hereLoans(g, d), true))
      : null)))])));
}

function viewTurni() {
  const ds = dates();
  const seg = segmented('Vista', [{ value: 'day', label: 'Giorno' }, { value: 'week', label: 'Settimana' }], state.mode,
    (m) => { state.mode = m; render(); }, 'vista', 'seg');
  if (state.mode === 'week') {
    return h('div', {}, seg, h('div', { class: 'page' }, deptSections((emp) => h('div', { class: 'card' },
      h('div', { class: 'name' }, emp.full_name),
      h('div', { class: 'daytable' }, ds.map((d, i) => h('button', { class: 'row' + (i === 6 ? ' sunday' : ''), onclick: () => editDay(emp, d) },
        h('span', { class: 'dl' }, `${D.DAYS[i]} ${D.dayOfMonth(d)}`), h('span', { style: 'flex:1' }), chips(entriesOf(emp.id, d))))))), guestSection()));
  }
  // persone in turno a pranzo e a cena (chi fa il doppio turno conta in entrambi);
  // i prestiti verso altri locali non contano qui, quelli in arrivo da altri locali sì
  const crew = (d) => {
    const n = { pranzo: 0, cena: 0 };
    const count = (entries) => {
      const slots = new Set(entries.map(slotOf));
      for (const k of Object.keys(n)) if (slots.has(k)) n[k]++;
    };
    for (const emp of state.week.employees) count(entriesOf(emp.id, d).filter((x) => x.kind === 'work'));
    for (const g of guestsOf()) count(hereLoans(g, d));
    return n;
  };
  const strip = h('div', { class: 'days' }, ds.map((d, i) => {
    const c = crew(d);
    return h('button', {
      class: i === 6 ? 'sun' : '', 'aria-pressed': state.day === i, 'aria-label': `${D.DAYS[i]} ${D.dayOfMonth(d)}: ${c.pranzo} a pranzo, ${c.cena} a cena`,
      onclick: () => { if (i === state.day) return; pendingSlide = i > state.day ? 'next' : 'prev'; state.day = i; render(); },
    }, h('small', {}, D.DAYS[i]), h('b', {}, D.dayOfMonth(d)),
    h('span', { class: 'count', 'aria-hidden': 'true' }, h('i', { class: 'p' + (c.pranzo ? '' : ' zero') }, c.pranzo), h('i', { class: 'c' + (c.cena ? '' : ' zero') }, c.cena)));
  }));
  const date = ds[state.day];
  const today = crew(date);
  const tally = (key, label) => h('div', { class: `tally ${key}` + (today[key] ? '' : ' zero') },
    h('span', { class: 'tally-n' }, today[key]),
    h('span', { class: 'tally-l' }, h('b', {}, label), today[key] === 1 ? 'persona' : 'persone'));
  const summary = h('div', { class: 'crew', role: 'group', 'aria-label': 'Persone in turno' }, tally('pranzo', 'Pranzo'), tally('cena', 'Cena'));
  return h('div', {}, seg, strip, summary, h('div', { class: 'page' }, deptSections((emp) => h('div', { class: 'card' },
    h('button', { class: 'row', onclick: () => editDay(emp, date) }, h('span', { class: 'who' }, emp.full_name), chips(entriesOf(emp.id, date))))), guestSection(date)));
}

/* ---------- editor turni di un giorno ---------- */

// Orari abituali: la fine dipende dal giorno (indice 0 = lunedì … 6 = domenica).
const SLOTS = {
  pranzo: { label: 'Pranzo', starts: ['11:00', '11:30', '12:00'], end: (i) => (i < 4 ? '14:30' : '15:00') },
  cena: { label: 'Cena', starts: ['18:00', '18:30', '19:00', '19:30', '20:00'], end: (i) => (i < 4 ? '23:30' : '00:00') },
};
const slotOf = (e) => e.slot || (e.start ? (e.start < '16:00' ? 'pranzo' : 'cena') : null);
const isPreset = (e, i) => { const sl = SLOTS[slotOf(e)]; return !e.start || Boolean(sl && sl.starts.includes(e.start) && e.end === sl.end(i)); };

// Controllo a segmenti: una sola scelta tra poche opzioni, sempre tutte visibili.
// L'indicatore scorre dalla posizione precedente (ricordata per chiave) a quella nuova, anche se la schermata viene ridisegnata.
const thumbs = new Map();
let uid = 0;
function segmented(label, options, value, onpick, key = label, cls = '') {
  const idx = options.findIndex((o) => o.value === value);
  const el = h('div', { class: `segmented ${cls}`.trim(), role: 'group', 'aria-label': label }, options.map((o) => h('button', {
    type: 'button', class: o.value === value ? 'on' : '', 'aria-pressed': o.value === value, onclick: () => onpick(o.value),
  }, o.label)));
  const k = `${key}:${options.length}`, prev = thumbs.get(k), at = Math.max(idx, 0);
  el.style.setProperty('--n', options.length);
  el.style.setProperty('--idx', prev ?? at);
  el.classList.toggle('none', idx < 0);
  thumbs.set(k, at);
  if (prev !== undefined && prev !== at) requestAnimationFrame(() => requestAnimationFrame(() => el.style.setProperty('--idx', at)));
  return el;
}
const entryKey = (e) => (e.uid ??= ++uid);
const caption = (text) => h('div', { class: 'cap' }, text);

// optional: per i prestiti gli orari sono facoltativi, quindi c'è anche "Senza orario".
function slotPicker(e, i, draw, optional = false) {
  const sl = slotOf(e);
  const fasce = [...(optional ? [{ value: '', label: 'Senza orario' }] : []), ...Object.entries(SLOTS).map(([k, v]) => ({ value: k, label: v.label }))];
  const out = [
    caption(optional ? 'Fascia (facoltativa)' : 'Fascia'),
    segmented('Fascia', fasce, e.custom ? null : (sl || ''), (k) => {
      e.custom = false;
      if (!k) { e.slot = null; e.start = ''; e.end = ''; return draw(); }
      e.slot = k; e.end = SLOTS[k].end(i); if (!SLOTS[k].starts.includes(e.start)) e.start = '';
      draw();
    }, `fascia${entryKey(e)}`, 'tight'),
  ];
  if (sl && !e.custom) {
    const starts = SLOTS[sl].starts;
    out.push(caption(`Inizio · fine ${SLOTS[sl].end(i)}`),
      h('div', { class: 'times-grid', style: `--n:${starts.length}` }, starts.map((t) => h('button', {
        type: 'button', class: 'time' + (e.start === t ? ' on' : ''), 'aria-pressed': e.start === t,
        onclick: () => { e.start = t; e.end = SLOTS[sl].end(i); draw(); },
      }, t))));
  }
  if (e.custom) out.push(caption('Orario personalizzato'), h('div', { class: 'times' },
    h('input', { type: 'time', value: e.start, 'aria-label': 'Inizio', oninput: (ev) => { e.start = ev.target.value; refreshReadout(); } }),
    h('span', { 'aria-hidden': 'true' }, '–'),
    h('input', { type: 'time', value: e.end, 'aria-label': 'Fine', oninput: (ev) => { e.end = ev.target.value; refreshReadout(); } })));
  out.push(h('button', { type: 'button', class: 'linkbtn', onclick: () => { e.custom = !e.custom; draw(); } }, e.custom ? 'Usa gli orari abituali' : 'Altro orario…'));
  return out;
}
let refreshReadout = () => {};

// cls: classe aggiuntiva per la scheda (es. 'day' = intestazione e pulsante Salva fissi, corpo scorrevole)
// La scheda sale dal basso e si chiude trascinandola in giù dalla maniglia.
function overlay(content, cls = '') {
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    ov.classList.add('leaving');
    setTimeout(() => ov.remove(), 240);
  };
  const handle = h('div', { class: 'handle', 'aria-hidden': 'true' }, h('span'));
  const sheet = h('div', { class: `sheet ${cls}`.trim(), role: 'dialog', 'aria-modal': 'true' }, handle, content(close));
  const ov = h('div', { class: 'overlay', onclick: (e) => { if (e.target === ov) close(); } }, sheet);

  let y0 = null, t0 = 0, dy = 0;
  handle.addEventListener('pointerdown', (e) => {
    y0 = e.clientY; t0 = performance.now(); dy = 0;
    handle.setPointerCapture(e.pointerId);
    ov.classList.add('dragging');
  });
  handle.addEventListener('pointermove', (e) => {
    if (y0 == null) return;
    dy = Math.max(0, e.clientY - y0);
    sheet.style.transform = `translate3d(0, ${dy}px, 0)`;
    ov.style.setProperty('--dim', String(1 - Math.min(dy / sheet.offsetHeight, 1)));
  });
  const release = () => {
    if (y0 == null) return;
    const fast = dy / (performance.now() - t0) > 0.6;
    y0 = null;
    ov.classList.remove('dragging');
    sheet.style.transform = '';
    ov.style.removeProperty('--dim');
    if (dy > sheet.offsetHeight * 0.3 || (fast && dy > 30)) close();
  };
  handle.addEventListener('pointerup', release);
  handle.addEventListener('pointercancel', release);

  document.body.append(ov);
  return close;
}

function editDay(emp, date) {
  const i = dates().indexOf(date);
  const entries = entriesOf(emp.id, date).map((e) => ({ kind: e.kind, start: e.start || '', end: e.end || '', venue_id: e.venue_id }));
  entries.forEach((e) => { if (e.kind !== 'rest') e.custom = !isPreset(e, i); });
  const others = state.week.venues.filter((v) => v.id !== state.venueId);
  // colore e nome del turno: pranzo / cena / prestito / riposo (gli stessi dei riquadri nella vista principale)
  const toneOf = (e) => (e.kind === 'rest' ? 'rest' : e.kind === 'loan' ? 'loan' : slotOf(e) || 'work');
  const nameOf = (e) => ({ rest: 'Riposo', loan: 'Prestito', pranzo: 'Pranzo', cena: 'Cena', work: 'Turno' })[toneOf(e)];
  const timeOf = (e) => (e.start && e.end ? `${e.start} – ${e.end}` : null);

  overlay((close) => {
    const body = h('div', { class: 'day-body' });
    let restFresh = false;
    const draw = () => {
      const isRest = entries.length === 1 && entries[0].kind === 'rest';
      const readouts = [];
      // la card si rimpicciolisce e si richiude su se stessa, poi viene tolta davvero
      const remove = (n) => h('button', { type: 'button', class: 'x', 'aria-label': `Rimuovi turno ${n + 1}`, onclick: (ev) => {
        const el = ev.currentTarget.closest('.turn');
        if (!el || el.classList.contains('leaving')) return;
        el.style.maxHeight = `${el.offsetHeight}px`;
        void el.offsetHeight;
        el.classList.add('leaving');
        setTimeout(() => { entries.splice(n, 1); draw(); }, 280);
      } }, icon('x', 18));

      const card = (e, n) => {
        const readout = h('output', { class: 'readout' });
        const paint = () => {
          const t = timeOf(e);
          readout.textContent = t || (e.kind === 'loan' ? 'Senza orario' : 'Scegli l\'inizio');
          readout.classList.toggle('empty', !t);
          if (!e.custom) return;
          // anche l'etichetta e il colore seguono l'orario scritto a mano
          card_.className = `turn tone-${toneOf(e)}${e.open ? '' : ' collapsed'}`;
          badge.textContent = nameOf(e);
        };
        readouts.push(paint);
        const badge = h('span', { class: 'badge' }, nameOf(e));
        // con più turni le card si chiudono toccando l'intestazione; di default resta aperto solo quello ancora da compilare
        if (e.open === undefined) e.open = entries.length === 1 || !e.start;
        const isOpen = () => e.open;
        const toggle = () => { e.open = !isOpen(); card_.classList.toggle('collapsed', !isOpen()); head.setAttribute('aria-expanded', String(isOpen())); };
        const head = h('div', { class: 'turn-head', role: 'button', tabindex: '0', 'aria-expanded': String(isOpen()), onclick: (ev) => { if (!ev.target.closest('.x')) toggle(); },
          onkeydown: (ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === head) { ev.preventDefault(); toggle(); } } },
          h('div', { class: 'turn-id' }, badge, entries.length > 1 ? h('span', { class: 'turn-n' }, `Turno ${n + 1}`) : null),
          readout, remove(n));
        const card_ = h('section', { class: `turn tone-${toneOf(e)}${isOpen() ? '' : ' collapsed'}${e.fresh ? ' entering' : ''}`, 'aria-label': `Turno ${n + 1}` },
          head,
          h('div', { class: 'turn-fold' }, h('div', { class: 'turn-clip' }, h('div', { class: 'turn-body' },
            others.length ? [caption('Tipo'), segmented('Tipo', [{ value: 'work', label: 'Turno' }, { value: 'loan', label: 'Prestito' }], e.kind, (k) => {
              if (k === e.kind) return;
              e.kind = k; e.slot = null; e.start = ''; e.end = ''; e.custom = false;
              if (k === 'loan' && !e.venue_id) e.venue_id = others[0]?.id;
              draw();
            }, `tipo${entryKey(e)}`)] : null,
            e.kind === 'loan' ? [caption('Locale che ospita'), dropdown({ variant: 'form', label: 'Locale', value: e.venue_id,
              options: others.map((v) => ({ value: v.id, label: venueLabel(v) })), onchange: (id) => { e.venue_id = id; } })] : null,
            slotPicker(e, i, draw, e.kind === 'loan')))));
        paint();
        delete e.fresh;
        return card_;
      };

      const restCard = h('section', { class: `turn tone-rest${restFresh ? ' entering' : ''}`, 'aria-label': 'Riposo' },
        h('div', { class: 'turn-head' }, h('div', { class: 'turn-id' }, h('span', { class: 'badge' }, 'R'), h('span', { class: 'turn-n' }, 'Giorno di riposo')), h('span', { class: 'readout' }), remove(0)));

      const addTurn = () => {
        if (isRest) entries.length = 0;
        const slot = entries.some((x) => slotOf(x) === 'pranzo') ? 'cena' : 'pranzo';
        entries.forEach((x) => { if (x.start) x.open = false; });
        entries.push({ kind: 'work', slot, start: '', end: SLOTS[slot].end(i), open: true, fresh: true });
        draw();
        body.lastElementChild?.previousElementSibling?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      };
      const tile = (ic, text, fn, cls = '') => h('button', { type: 'button', class: `tile ${cls}`.trim(), onclick: fn }, icon(ic, 20), text);

      restFresh = false;
      body.replaceChildren(
        ...(isRest ? [restCard] : entries.map(card)),
        ...(entries.length ? [] : [h('p', { class: 'day-empty' }, 'Nessun turno: aggiungine uno oppure segna il riposo.')]),
        h('div', { class: 'tiles' },
          entries.length < 3 ? tile('plus', entries.length === 1 && !isRest ? 'Doppio turno' : 'Aggiungi turno', addTurn) : null,
          isRest ? null : tile('moon', 'Riposo', () => { entries.length = 0; entries.push({ kind: 'rest', start: '', end: '' }); restFresh = true; draw(); }, 'rest')));
      refreshReadout = () => readouts.forEach((p) => p());
    };
    draw();

    const save = async () => {
      const payload = [...entries].sort((a, b) => (a.start || '99').localeCompare(b.start || '99')).map((e) => ({ kind: e.kind, start: e.start || null, end: e.end || null, venue_id: e.kind === 'loan' ? e.venue_id : undefined }));
      if (payload.some((e) => e.kind === 'work' && (!e.start || !e.end))) return toast('Scegli l\'inizio di ogni turno', true);
      if (payload.some((e) => e.kind === 'loan' && Boolean(e.start) !== Boolean(e.end))) return toast('Prestito: scegli l\'inizio oppure "Senza orario"', true);
      if (await act(() => api.saveDay(emp.id, date, payload))) { close(); reloadWeek(); }
    };
    return [
      h('header', { class: 'day-head' },
        h('div', {}, h('h3', {}, emp.full_name), h('div', { class: 'sub' }, `${D.DAYS[i]} ${D.dayOfMonth(date)}/${date.slice(5, 7)}`)),
        h('button', { type: 'button', class: 'x ghost', 'aria-label': 'Chiudi', onclick: close }, icon('x', 20))),
      body,
      h('footer', { class: 'day-foot' }, h('button', { type: 'button', class: 'btn primary save', onclick: save }, 'Salva giornata')),
    ];
  }, 'day');
}

/* ---------- statistiche ore ---------- */

const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const shiftHours = (e) => { let d = toMin(e.end) - toMin(e.start); if (d <= 0) d += 1440; return d / 60; };
// turni nel proprio locale + prestiti con orario (in qualunque locale); riposi e prestiti senza orario non contano
const weekHours = (empId) => dates().reduce((tot, d) => tot + entriesOf(empId, d).filter((e) => e.kind !== 'rest' && e.start && e.end).reduce((a, e) => a + shiftHours(e), 0), 0);
const fmtH = (n) => `${Number.isInteger(n) ? n : n.toFixed(1).replace('.', ',')}h`;

function statRow(emp, name) {
  const w = weekHours(emp.id), c = Number(emp.weekly_hours) || 0, diff = w - c;
  const note = !c ? h('span', { class: 'delta' }, 'ore contratto non impostate')
    : diff > 0 ? h('span', { class: 'delta over' }, `+${fmtH(diff)} oltre`)
    : diff < 0 ? h('span', { class: 'delta under' }, `mancano ${fmtH(-diff)}`) : h('span', { class: 'delta ok' }, [icon('check', 14), ' completo']);
  return h('div', { class: 'row stat' }, h('span', { class: 'who' }, name),
    h('span', { class: 'hrs' }, h('b', {}, fmtH(w)), c ? ` / ${fmtH(c)}` : '', h('br'), note));
}

function statsContent() {
  const secs = state.deps.map((dep) => {
    const emps = state.week.employees.filter((e) => e.department_id === dep.id);
    if (!emps.length) return null;
    return h('section', { class: 'section', style: 'padding:10px 0 0' }, h('h2', {}, dep.name), h('div', { class: 'card' }, emps.map((emp) => statRow(emp, emp.full_name))));
  }).filter(Boolean);
  if (guestsOf().length) secs.push(h('section', { class: 'section', style: 'padding:10px 0 0' }, h('h2', {}, 'In prestito da altri locali'),
    h('div', { class: 'card' }, guestsOf().map((g) => statRow(g, guestName(g))))));
  return [h('h3', { style: 'margin:0' }, 'Ore della settimana'), ...secs,
    h('div', { class: 'sub', style: 'font-size:13px;margin-top:10px' }, 'Imposta le ore di contratto da Team, aprendo il dipendente.')];
}

// Pannello che si trascina verso l'alto dalla maniglia sopra la barra delle schede.
function statsPanel() {
  const grab = h('div', { class: 'grabzone', 'aria-label': 'Statistiche ore: trascina verso l\'alto' }, h('div', { class: 'grab' }), h('span', {}, 'Ore'));
  const panel = h('div', { class: 'statpanel' + (state.statsOpen ? ' open' : '') }, grab, h('div', { class: 'statbody' }, statsContent()));
  let y0 = null, moved = false, closedY = 0, raf = 0;
  const offset = () => panel.offsetHeight - grab.offsetHeight;
  grab.addEventListener('pointerdown', (e) => {
    y0 = e.clientY; moved = false; closedY = offset();
    grab.setPointerCapture(e.pointerId);
    panel.classList.add('dragging');
  });
  grab.addEventListener('pointermove', (e) => {
    if (y0 == null) return;
    const dy = e.clientY - y0;
    if (Math.abs(dy) > 4) moved = true;
    const base = state.statsOpen ? 0 : closedY;
    const y = Math.min(closedY, Math.max(0, base + dy));
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; panel.style.transform = `translate3d(0, ${y}px, 0)`; });
  });
  const end = (e) => {
    if (y0 == null) return;
    const dy = e.clientY - y0;
    cancelAnimationFrame(raf); raf = 0;
    panel.classList.remove('dragging');
    panel.style.transform = '';
    if (!moved) state.statsOpen = !state.statsOpen;
    else if (dy < -40) state.statsOpen = true;
    else if (dy > 40) state.statsOpen = false;
    panel.classList.toggle('open', state.statsOpen);
    y0 = null;
  };
  grab.addEventListener('pointerup', end);
  grab.addEventListener('pointercancel', end);

  // Il pannello aperto si chiude trascinando verso il basso da qualsiasi punto del contenuto.
  // Con i tocchi (non passivi) si blocca lo scorrimento nativo, così il browser non ricarica la pagina.
  const bodyEl = panel.querySelector('.statbody');
  let ty0 = null, tdrag = false;
  bodyEl.addEventListener('touchstart', (e) => { ty0 = e.touches[0].clientY; tdrag = false; }, { passive: true });
  bodyEl.addEventListener('touchmove', (e) => {
    if (ty0 == null || !state.statsOpen) return;
    const dy = e.touches[0].clientY - ty0;
    if (!tdrag) {
      // si decide al primo movimento: se lo scorrimento nativo è già partito non si può più annullare
      if (dy > 0 && bodyEl.scrollTop <= 0 && e.cancelable) { tdrag = true; panel.classList.add('dragging'); } else return;
    }
    e.preventDefault();
    const y = Math.min(offset(), Math.max(0, dy));
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; panel.style.transform = `translate3d(0, ${y}px, 0)`; });
  }, { passive: false });
  const tend = (e) => {
    if (!tdrag) { ty0 = null; return; }
    const dy = (e.changedTouches[0]?.clientY ?? ty0) - ty0;
    cancelAnimationFrame(raf); raf = 0;
    panel.classList.remove('dragging');
    panel.style.transform = '';
    if (dy > 60) { state.statsOpen = false; panel.classList.remove('open'); }
    ty0 = null; tdrag = false;
  };
  bodyEl.addEventListener('touchend', tend);
  bodyEl.addEventListener('touchcancel', tend);
  return panel;
}

/* ---------- PDF ---------- */

function makePdf() {
  if (!state.week.employees.length) return toast('Aggiungi prima i dipendenti', true);
  let pdf;
  try {
    pdf = buildPdf({
      venue: state.week.venue, venues: state.week.venues, departments: state.deps, employees: state.week.employees,
      shifts: state.week.shifts, legend: state.week.legend, weekStart: state.weekStart,
    });
  } catch (e) {
    console.error(e);
    return toast('Errore nella creazione del PDF', true);
  }
  overlay((close) => [
    h('h3', {}, 'PDF pronto'),
    h('div', { class: 'sub' }, pdf.filename),
    h('button', { class: 'btn primary block', onclick: async () => { const r = await sharePdf(pdf); if (r !== 'cancelled') close(); } }, 'Condividi'),
    h('button', { class: 'btn block', onclick: () => { downloadPdf(pdf); close(); } }, 'Scarica'),
    h('button', { class: 'btn block', onclick: close }, 'Chiudi'),
  ]);
}

/* ---------- team ---------- */

function viewTeam() {
  return h('div', {}, deptSections((emp) => h('div', { class: 'card' },
    h('button', { class: 'row', onclick: () => editEmployee(emp) }, h('span', { class: 'who' }, emp.full_name), h('span', { style: 'color:var(--muted)' }, icon('pencil', 18))))),
    h('div', { class: 'section' }, h('button', { class: 'btn primary block', onclick: () => editEmployee(null) }, '+ Aggiungi dipendente')));
}

function editEmployee(emp) {
  overlay((close) => {
    const name = h('input', { value: emp?.full_name || '', placeholder: 'Cognome Nome', autocapitalize: 'words' });
    const dep = dropdown({ variant: 'form', label: 'Reparto', value: emp?.department_id ?? state.deps[0]?.id, options: state.deps.map((d) => ({ value: d.id, label: d.name })), onchange() {} });
    const hours = h('input', { type: 'number', inputMode: 'decimal', min: 0, max: 666, step: 0.5, value: emp?.weekly_hours > 0 ? emp.weekly_hours : ''});
    return [
      h('h3', {}, emp ? 'Modifica dipendente' : 'Nuovo dipendente'),
      h('label', { class: 'field' }, 'Nome', name),
      h('div', { class: 'field' }, 'Reparto', dep),
      h('label', { class: 'field' }, 'Ore settimanali da contratto', hours),
      h('button', { class: 'btn primary block', onclick: async () => {
        const n = name.value.trim();
        if (!n) return toast('Inserisci il nome', true);
        const d = Number(dep.value);
        const ok = await act(() => (emp ? api.updateEmployee(emp.id, n, d, hours.value) : api.addEmployee(state.venueId, d, n, hours.value)));
        if (ok) { close(); reloadWeek(); }
      } }, 'Salva'),
      emp ? h('button', { class: 'btn danger block', onclick: async () => {
        if (!confirm(`Eliminare ${emp.full_name}?`)) return;
        if (await act(() => api.deleteEmployee(emp.id))) { close(); reloadWeek(); }
      } }, 'Elimina') : null,
    ];
  });
}

/* ---------- altro ---------- */

function viewAltro() {
  const prev = D.addDays(state.weekStart, -7);
  return h('div', { class: 'section' },
    h('button', { class: 'btn block', onclick: async () => {
      if (!confirm(`Copiare i turni della settimana ${D.isoWeek(prev)} (${D.weekLabel(prev)}) in questa? I turni attuali verranno sostituiti.`)) return;
      if (await act(() => api.copyWeek(state.venueId, prev, state.weekStart))) { toast('Settimana copiata'); reloadWeek(); }
    } }, 'Copia dalla settimana precedente'),
    h('button', { class: 'btn block', onclick: editLegend }, 'Legenda del PDF'),
    h('button', { class: 'btn block', onclick: newVenue }, '+ Nuovo locale'),
    h('button', { class: 'btn danger block', style: 'margin-top:24px', onclick: logout }, 'Esci'));
}

function editLegend() {
  const rows = state.week.legend.map((l) => ({ ...l }));
  overlay((close) => {
    const box = h('div');
    const draw = () => box.replaceChildren(
      ...rows.map((r, n) => h('div', { class: 'legend-row' },
        h('input', { value: r.short_desc, placeholder: 'Breve', maxLength: 40, oninput: (e) => { r.short_desc = e.target.value; } }),
        h('input', { value: r.description, placeholder: 'Descrizione', maxLength: 160, oninput: (e) => { r.description = e.target.value; } }),
        h('input', { value: r.hours, placeholder: 'Orario', maxLength: 60, oninput: (e) => { r.hours = e.target.value; } }),
        h('button', { class: 'x', 'aria-label': 'Rimuovi', onclick: () => { rows.splice(n, 1); draw(); } }, icon('x', 18)))),
      h('button', { class: 'btn block', onclick: () => { rows.push({ short_desc: '', description: '', hours: '' }); draw(); } }, '+ Riga'),
      h('button', { class: 'btn primary block', onclick: async () => {
        if (await act(() => api.saveLegend(state.venueId, rows))) { close(); reloadWeek(); }
      } }, 'Salva'));
    draw();
    return [h('h3', {}, 'Legenda'), h('div', { class: 'sub' }, 'Descrizione breve · Descrizione · Orario'), box];
  });
}

function newVenue() {
  overlay((close) => {
    const city = h('input', { value: 'Milano' });
    const name = h('input', { });
    return [
      h('h3', {}, 'Nuovo locale'),
      h('label', { class: 'field' }, 'Città', city),
      h('label', { class: 'field' }, 'Nome del locale', name),
      h('button', { class: 'btn primary block', onclick: async () => {
        let created;
        if (await act(async () => { created = await api.addVenue(city.value.trim(), name.value.trim()); })) {
          close();
          state.venues = await api.venues();
          state.venueId = created.id;
          reloadWeek();
        }
      } }, 'Crea'),
    ];
  });
}

boot();
