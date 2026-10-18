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

function chips(entries) {
  if (!entries.length) return h('div', { class: 'chips' }, h('span', { class: 'chip empty' }, '—'));
  return h('div', { class: 'chips' }, entries.map((e) => {
    if (e.kind === 'rest') return h('span', { class: 'chip rest' }, 'R');
    if (e.kind === 'work') return h('span', { class: 'chip' }, `${e.start} – ${e.end}`);
    return h('span', { class: 'chip loan' }, `→ ${venueName(e.venue_id)}${e.start ? ` ${e.start}–${e.end}` : ''}`);
  }));
}

/* ---------- schermata principale ---------- */

function render() {
  const wk = state.weekStart;
  const topbar = h('div', { class: 'topbar' },
    h('select', { 'aria-label': 'Locale', onchange: (e) => {
      state.venueId = Number(e.target.value);
      try { localStorage.setItem('turni.venue', state.venueId); } catch { /* storage non disponibile */ }
      reloadWeek();
    } }, state.venues.map((v) => h('option', { value: v.id, selected: v.id === state.venueId }, venueLabel(v)))),
    h('div', { class: 'weeknav' },
      h('button', { 'aria-label': 'Settimana precedente', onclick: () => shiftWeek(-7) }, '‹'),
      h('div', { class: 'label' }, `Settimana ${D.isoWeek(wk)}`, h('small', {}, D.weekLabel(wk))),
      h('button', { 'aria-label': 'Settimana successiva', onclick: () => shiftWeek(7) }, '›')));

  const body = state.tab === 'turni' ? viewTurni() : state.tab === 'team' ? viewTeam() : viewAltro();
  const tab = (id, icon, label) => h('button', { 'aria-current': state.tab === id ? 'page' : null, onclick: () => { state.tab = id; render(); } }, h('span', {}, icon), label);
  const nodes = [topbar, body];
  if (state.tab === 'turni') nodes.push(statsPanel(), h('button', { class: 'fab', onclick: makePdf }, '📄 PDF'));
  nodes.push(h('nav', { class: 'tabbar' }, tab('turni', '🗓', 'Turni'), tab('team', '👥', 'Team'), tab('altro', '⚙️', 'Altro')));
  const scroll = window.scrollY;
  root.replaceChildren(h('div', { class: 'app' }, nodes));
  const bar = root.querySelector('.tabbar');
  if (bar) document.documentElement.style.setProperty('--tabbar-h', `${bar.offsetHeight}px`);
  window.scrollTo(0, scroll);
}

function shiftWeek(n) {
  state.weekStart = D.addDays(state.weekStart, n);
  reloadWeek();
}

function deptSections(renderEmployee) {
  const secs = state.deps.map((dep) => {
    const emps = state.week.employees.filter((e) => e.department_id === dep.id);
    if (!emps.length) return null;
    return h('section', { class: 'section' }, h('h2', {}, dep.name), emps.map(renderEmployee));
  }).filter(Boolean);
  return secs.length ? secs : [h('div', { class: 'empty-state' }, 'Nessun dipendente in questo locale.', h('br'), 'Aggiungili dalla scheda ', h('b', {}, 'Team'), '.')];
}

function viewTurni() {
  const ds = dates();
  const seg = h('div', { class: 'seg' },
    h('button', { 'aria-pressed': state.mode === 'day', onclick: () => { state.mode = 'day'; render(); } }, 'Giorno'),
    h('button', { 'aria-pressed': state.mode === 'week', onclick: () => { state.mode = 'week'; render(); } }, 'Settimana'));
  if (state.mode === 'week') {
    return h('div', {}, seg, deptSections((emp) => h('div', { class: 'card' },
      h('div', { class: 'name' }, emp.full_name),
      h('div', { class: 'daytable' }, ds.map((d, i) => h('button', { class: 'row' + (i === 6 ? ' sunday' : ''), onclick: () => editDay(emp, d) },
        h('span', { class: 'dl' }, `${D.DAYS[i]} ${D.dayOfMonth(d)}`), h('span', { style: 'flex:1' }), chips(entriesOf(emp.id, d))))))));
  }
  const headcount = (d) => state.week.employees.filter((e) => entriesOf(e.id, d).some((s) => s.kind === 'work')).length;
  const strip = h('div', { class: 'days' }, ds.map((d, i) => h('button', {
    class: i === 6 ? 'sun' : '', 'aria-pressed': state.day === i, onclick: () => { state.day = i; render(); },
  }, h('small', {}, D.DAYS[i]), h('b', {}, D.dayOfMonth(d)), h('span', { class: 'count', title: 'Persone in turno' }, headcount(d)))));
  const date = ds[state.day];
  return h('div', {}, seg, strip, deptSections((emp) => h('div', { class: 'card' },
    h('button', { class: 'row', onclick: () => editDay(emp, date) }, h('span', { class: 'who' }, emp.full_name), chips(entriesOf(emp.id, date))))));
}

/* ---------- editor turni di un giorno ---------- */

// Orari abituali: la fine dipende dal giorno (indice 0 = lunedì … 6 = domenica).
const SLOTS = {
  pranzo: { label: 'Pranzo', starts: ['11:00', '11:30', '12:00'], end: (i) => (i < 4 ? '14:30' : '15:00') },
  cena: { label: 'Cena', starts: ['18:00', '18:30', '19:00', '19:30', '20:00'], end: (i) => (i < 4 ? '23:30' : '00:00') },
};
const slotOf = (e) => e.slot || (e.start ? (e.start < '16:00' ? 'pranzo' : 'cena') : null);
const isPreset = (e, i) => { const sl = SLOTS[slotOf(e)]; return !e.start || Boolean(sl && sl.starts.includes(e.start) && e.end === sl.end(i)); };

function slotPicker(e, i, draw) {
  const sl = slotOf(e);
  const chip = (text, on, fn) => h('button', { class: 'pick', 'aria-pressed': on, onclick: fn }, text);
  const out = [h('div', { class: 'picks' }, Object.entries(SLOTS).map(([k, v]) => chip(v.label, sl === k, () => {
    e.slot = k; e.end = v.end(i); if (!v.starts.includes(e.start)) e.start = ''; e.custom = false; draw();
  })))];
  if (sl && !e.custom) {
    out.push(h('div', { class: 'picks' }, SLOTS[sl].starts.map((t) => chip(t, e.start === t, () => { e.start = t; e.end = SLOTS[sl].end(i); draw(); }))),
      h('div', { class: 'sub', style: 'font-size:13px;margin:6px 0 0' }, e.start ? `${e.start} – ${e.end}` : `Scegli l'inizio · fine ${SLOTS[sl].end(i)}`));
  }
  out.push(h('button', { class: 'linkbtn', onclick: () => { e.custom = !e.custom; draw(); } }, e.custom ? 'Usa orari abituali' : 'Altro orario…'));
  if (e.custom) out.push(h('div', { class: 'times' },
    h('input', { type: 'time', value: e.start, 'aria-label': 'Inizio', oninput: (ev) => { e.start = ev.target.value; } }),
    h('span', {}, '–'),
    h('input', { type: 'time', value: e.end, 'aria-label': 'Fine', oninput: (ev) => { e.end = ev.target.value; } })));
  return out;
}

function overlay(content) {
  const close = () => ov.remove();
  const ov = h('div', { class: 'overlay', onclick: (e) => { if (e.target === ov) close(); } }, h('div', { class: 'sheet', role: 'dialog' }, content(close)));
  document.body.append(ov);
  return close;
}

function editDay(emp, date) {
  const i = dates().indexOf(date);
  const entries = entriesOf(emp.id, date).map((e) => ({ kind: e.kind, start: e.start || '', end: e.end || '', venue_id: e.venue_id }));
  entries.forEach((e) => { if (e.kind === 'work') e.custom = !isPreset(e, i); });
  const others = state.week.venues.filter((v) => v.id !== state.venueId);

  overlay((close) => {
    const box = h('div');
    const draw = () => {
      const isRest = entries.length === 1 && entries[0].kind === 'rest';
      const list = isRest
        ? [h('div', { class: 'entry' }, h('div', { class: 'top' }, h('b', { style: 'flex:1;align-self:center;color:var(--rest)' }, 'Riposo (R)'), h('button', { class: 'x', 'aria-label': 'Rimuovi', onclick: () => { entries.length = 0; draw(); } }, '✕')))]
        : entries.map((e, n) => h('div', { class: 'entry' },
          h('div', { class: 'top' },
            h('select', { 'aria-label': 'Tipo', onchange: (ev) => { e.kind = ev.target.value; if (e.kind === 'loan' && !e.venue_id) e.venue_id = others[0]?.id; draw(); } },
              h('option', { value: 'work', selected: e.kind === 'work' }, 'Turno'),
              others.length ? h('option', { value: 'loan', selected: e.kind === 'loan' }, 'Prestito ad altro locale') : null),
            h('button', { class: 'x', 'aria-label': 'Rimuovi', onclick: () => { entries.splice(n, 1); draw(); } }, '✕')),
          e.kind === 'loan' ? h('select', { style: 'width:100%;margin-top:8px', 'aria-label': 'Locale', onchange: (ev) => { e.venue_id = Number(ev.target.value); } },
            others.map((v) => h('option', { value: v.id, selected: v.id === e.venue_id }, venueLabel(v)))) : null,
          e.kind === 'work' ? slotPicker(e, i, draw) : h('div', { class: 'times' },
            h('input', { type: 'time', value: e.start, 'aria-label': 'Inizio', oninput: (ev) => { e.start = ev.target.value; } }),
            h('span', {}, '–'),
            h('input', { type: 'time', value: e.end, 'aria-label': 'Fine', oninput: (ev) => { e.end = ev.target.value; } })),
          e.kind === 'loan' ? h('div', { class: 'sub', style: 'font-size:12px;margin:6px 0 0' }, 'Orari facoltativi per i prestiti') : null));
      box.replaceChildren(...list,
        h('div', { class: 'actions' },
          entries.length < 3 ? h('button', { class: 'btn', onclick: () => { if (isRest) entries.length = 0; const slot = entries.some((x) => slotOf(x) === 'pranzo') ? 'cena' : 'pranzo'; entries.push({ kind: 'work', slot, start: '', end: SLOTS[slot].end(i) }); draw(); } }, '+ Fascia') : null,
          h('button', { class: 'btn', style: 'color:var(--rest)', onclick: () => { entries.length = 0; entries.push({ kind: 'rest', start: '', end: '' }); draw(); } }, 'Riposo (R)')),
        h('button', { class: 'btn primary block', onclick: async () => {
          const payload = entries.map((e) => ({ kind: e.kind, start: e.start || null, end: e.end || null, venue_id: e.kind === 'loan' ? e.venue_id : undefined }));
          if (payload.some((e) => e.kind === 'work' && (!e.start || !e.end))) return toast('Inserisci inizio e fine del turno', true);
          if (payload.some((e) => e.kind === 'loan' && Boolean(e.start) !== Boolean(e.end))) return toast('Prestito: inserisci entrambi gli orari o nessuno', true);
          if (await act(() => api.saveDay(emp.id, date, payload))) { close(); reloadWeek(); }
        } }, 'Salva'));
    };
    draw();
    return [h('h3', {}, emp.full_name), h('div', { class: 'sub' }, `${D.DAYS[i]} ${D.dayOfMonth(date)}/${date.slice(5, 7)}`), box];
  });
}

/* ---------- statistiche ore ---------- */

const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const shiftHours = (e) => { let d = toMin(e.end) - toMin(e.start); if (d <= 0) d += 1440; return d / 60; };
const weekHours = (empId) => dates().reduce((tot, d) => tot + entriesOf(empId, d).filter((e) => e.kind === 'work' && e.start && e.end).reduce((a, e) => a + shiftHours(e), 0), 0);
const fmtH = (n) => `${Number.isInteger(n) ? n : n.toFixed(1).replace('.', ',')}h`;

function statsContent() {
  let tot = 0;
  const secs = state.deps.map((dep) => {
    const emps = state.week.employees.filter((e) => e.department_id === dep.id);
    if (!emps.length) return null;
    return h('section', { class: 'section', style: 'padding:10px 0 0' }, h('h2', {}, dep.name), h('div', { class: 'card' }, emps.map((emp) => {
      const w = weekHours(emp.id), c = Number(emp.weekly_hours) || 0, diff = w - c;
      tot += w;
      const note = !c ? h('span', { class: 'delta' }, 'ore contratto non impostate')
        : diff > 0 ? h('span', { class: 'delta over' }, `+${fmtH(diff)} oltre`)
        : diff < 0 ? h('span', { class: 'delta under' }, `mancano ${fmtH(-diff)}`) : h('span', { class: 'delta ok' }, 'completo ✓');
      return h('div', { class: 'row stat' }, h('span', { class: 'who' }, emp.full_name),
        h('span', { class: 'hrs' }, h('b', {}, fmtH(w)), c ? ` / ${fmtH(c)}` : '', h('br'), note));
    })));
  }).filter(Boolean);
  return [h('h3', { style: 'margin:0' }, 'Ore della settimana'), h('div', { class: 'sub' }, `${D.weekLabel(state.weekStart)} · totale ${fmtH(tot)}`), ...secs,
    h('div', { class: 'sub', style: 'font-size:13px;margin-top:10px' }, 'Imposta le ore di contratto da Team › dipendente.')];
}

// Pannello che si trascina verso l'alto dalla maniglia sopra la barra delle schede.
function statsPanel() {
  const grab = h('div', { class: 'grabzone', 'aria-label': 'Statistiche ore: trascina verso l\'alto' }, h('div', { class: 'grab' }), h('span', {}, 'Ore'));
  const panel = h('div', { class: 'statpanel' + (state.statsOpen ? ' open' : '') }, grab, h('div', { class: 'statbody' }, statsContent()));
  let y0 = null, moved = false, closedY = 0;
  const offset = () => panel.offsetHeight - 30;
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
    panel.style.transform = `translateY(${Math.min(closedY, Math.max(0, base + dy))}px)`;
  });
  const end = (e) => {
    if (y0 == null) return;
    const dy = e.clientY - y0;
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
    h('button', { class: 'row', onclick: () => editEmployee(emp) }, h('span', { class: 'who' }, emp.full_name), h('span', { style: 'color:var(--muted)' }, '✎')))),
    h('div', { class: 'section' }, h('button', { class: 'btn primary block', onclick: () => editEmployee(null) }, '+ Aggiungi dipendente')));
}

function editEmployee(emp) {
  overlay((close) => {
    const name = h('input', { value: emp?.full_name || '', placeholder: 'Cognome Nome', autocapitalize: 'words' });
    const dep = h('select', {}, state.deps.map((d) => h('option', { value: d.id, selected: d.id === (emp?.department_id ?? state.deps[0]?.id) }, d.name)));
    const hours = h('input', { type: 'number', inputMode: 'decimal', min: 0, max: 80, step: 0.5, value: emp?.weekly_hours > 0 ? emp.weekly_hours : '', placeholder: 'es. 40' });
    return [
      h('h3', {}, emp ? 'Modifica dipendente' : 'Nuovo dipendente'),
      h('label', { class: 'field' }, 'Nome', name),
      h('label', { class: 'field' }, 'Reparto', dep),
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
        h('button', { class: 'x', style: 'width:40px;min-height:44px', 'aria-label': 'Rimuovi', onclick: () => { rows.splice(n, 1); draw(); } }, '✕'))),
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
    const name = h('input', { placeholder: 'es. Pola' });
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
