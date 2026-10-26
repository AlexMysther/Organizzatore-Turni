import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'mysql://t:t@127.0.0.1:3306/turni_test';
process.env.JWT_SECRET = 'test-secret-test-secret';
process.env.ADMIN_PASSWORD = 'password123';

// ricrea il database di test (serve un utente MySQL con permesso CREATE)
const mysql = (await import('mysql2/promise')).default;
const admin = await mysql.createConnection(process.env.DATABASE_URL.replace(/\/[^/]*$/, '/'));
await admin.query('DROP DATABASE IF EXISTS turni_test');
await admin.query('CREATE DATABASE turni_test CHARACTER SET utf8mb4');
await admin.end();

const { pool, initSchema } = await import('../src/db.js');
const { seedAdmin } = await import('../src/auth.js');
const { createApp } = await import('../src/app.js');

let server, base, token, tunisia, pola, emp;

const api = async (method, path, body, auth = true) => {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(auth && token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};

before(async () => {
  await initSchema();
  await seedAdmin();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await pool.end();
});

test('richiede autenticazione e rifiuta password errate', async () => {
  assert.equal((await api('GET', '/api/venues', null, false)).status, 401);
  assert.equal((await api('POST', '/api/login', { username: 'manager', password: 'sbagliata' }, false)).status, 401);
  const r = await api('POST', '/api/login', { username: 'manager', password: 'password123' }, false);
  assert.equal(r.status, 200);
  token = r.body.token;
});

test('locali, reparti e dipendenti', async () => {
  tunisia = (await api('POST', '/api/venues', { name: 'Tunisia' })).body;
  pola = (await api('POST', '/api/venues', { name: 'Pola' })).body;
  assert.equal((await api('POST', '/api/venues', { name: 'Pola' })).status, 409);
  const deps = (await api('GET', '/api/departments')).body;
  assert.deepEqual(deps.map((d) => d.name), ['Garzone', 'Pizzaiolo', 'Sala', 'Store Manager']);
  const sala = deps.find((d) => d.name === 'Sala').id;
  emp = (await api('POST', '/api/employees', { venue_id: tunisia.id, department_id: sala, full_name: 'Hu Jun Jie' })).body;
  assert.ok(emp.id);
});

test('turni: doppia fascia, riposo, prestito, validazioni', async () => {
  const put = (date, entries) => api('PUT', `/api/employees/${emp.id}/day`, { date, entries });
  assert.equal((await put('2026-10-19', [{ kind: 'work', start: '11:00', end: '15:00' }, { kind: 'work', start: '18:30', end: '23:30' }])).status, 200);
  assert.equal((await put('2026-10-20', [{ kind: 'rest' }])).status, 200);
  assert.equal((await put('2026-10-22', [{ kind: 'loan', venue_id: pola.id, start: '11:30', end: '14:30' }])).status, 200);
  assert.equal((await put('2026-10-21', [{ kind: 'rest' }, { kind: 'work', start: '10:00', end: '12:00' }])).status, 400);
  assert.equal((await put('2026-10-21', [{ kind: 'work', start: '25:00', end: '12:00' }])).status, 400);
  assert.equal((await put('2026-10-21', [{ kind: 'loan', venue_id: tunisia.id }])).status, 400);
  assert.equal((await put('2026-02-31', [])).status, 400);

  const w = (await api('GET', `/api/venues/${tunisia.id}/week?start=2026-10-19`)).body;
  assert.equal(w.shifts.length, 4);
  assert.equal(w.shifts[0].date, '2026-10-19');
  assert.equal(w.shifts[1].start, '18:30');
  assert.equal(w.shifts[3].kind, 'loan');
  assert.equal((await api('GET', `/api/venues/${tunisia.id}/week?start=2026-10-20`)).status, 400, 'non lunedì');

  // sostituzione di una giornata
  await put('2026-10-19', [{ kind: 'rest' }]);
  const w2 = (await api('GET', `/api/venues/${tunisia.id}/week?start=2026-10-19`)).body;
  assert.equal(w2.shifts.filter((s) => s.date === '2026-10-19').length, 1);
});

test('prestito: chi arriva compare come ospite nel locale che lo ospita', async () => {
  const put = (date, entries) => api('PUT', `/api/employees/${emp.id}/day`, { date, entries });
  await put('2026-10-19', [{ kind: 'work', start: '11:00', end: '15:00' }]);
  await put('2026-10-22', [{ kind: 'loan', venue_id: pola.id, start: '11:30', end: '14:30' }]);

  const p = (await api('GET', `/api/venues/${pola.id}/week?start=2026-10-19`)).body;
  assert.equal(p.employees.length, 0);
  assert.deepEqual(p.guests.map((g) => [g.id, g.home_venue_id]), [[emp.id, tunisia.id]]);
  assert.equal(p.shifts.length, 3, 'anche i turni di casa (lavoro e riposo), per il totale delle ore');
  assert.equal(p.shifts.filter((s) => s.kind === 'loan' && s.venue_id === pola.id).length, 1);

  const t = (await api('GET', `/api/venues/${tunisia.id}/week?start=2026-10-19`)).body;
  assert.equal(t.guests.length, 0);
  assert.equal((await api('GET', `/api/venues/${pola.id}/week?start=2026-10-26`)).body.guests.length, 0, 'altra settimana');
});

test('salvataggi concorrenti dello stesso dipendente non vanno in deadlock', async () => {
  const dates = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'];
  const rs = await Promise.all(dates.map((date) => api('PUT', `/api/employees/${emp.id}/day`, { date, entries: [{ kind: 'work', start: '19:00', end: '23:30' }] })));
  assert.deepEqual(rs.map((r) => r.status), Array(7).fill(200));
  const w = (await api('GET', `/api/venues/${tunisia.id}/week?start=2026-11-02`)).body;
  assert.equal(w.shifts.length, 7);
});

test('copia settimana e legenda', async () => {
  const c = await api('POST', `/api/venues/${tunisia.id}/copy-week`, { from: '2026-10-19', to: '2026-10-26' });
  assert.equal(c.body.copied, 3);
  const w = (await api('GET', `/api/venues/${tunisia.id}/week?start=2026-10-26`)).body;
  assert.deepEqual(w.shifts.map((s) => s.date), ['2026-10-26', '2026-10-27', '2026-10-29']);
  await api('PUT', `/api/venues/${tunisia.id}/legend`, { items: [{ short_desc: 'R', description: 'Riposo', hours: '' }] });
  const w3 = (await api('GET', `/api/venues/${tunisia.id}/week?start=2026-10-19`)).body;
  assert.equal(w3.legend[0].short_desc, 'R');
});

test('eliminazione dipendente e permessi per locale', async () => {
  assert.equal((await api('DELETE', `/api/employees/${emp.id}`)).status, 204);
  const w = (await api('GET', `/api/venues/${tunisia.id}/week?start=2026-10-19`)).body;
  assert.equal(w.employees.length, 0);
  // manager non-admin assegnato solo a Pola non vede Tunisia
  const bcrypt = (await import('bcryptjs')).default;
  const [r] = await pool.query('INSERT INTO users (username, password_hash) VALUES (?, ?)', ['pola', await bcrypt.hash('password123', 4)]);
  await pool.query('INSERT INTO user_venues VALUES (?, ?)', [r.insertId, pola.id]);
  token = (await api('POST', '/api/login', { username: 'pola', password: 'password123' }, false)).body.token;
  assert.equal((await api('GET', `/api/venues/${tunisia.id}/week?start=2026-10-19`)).status, 403);
  assert.equal((await api('GET', `/api/venues/${pola.id}/week?start=2026-10-19`)).status, 200);
  assert.deepEqual((await api('GET', '/api/venues')).body.map((v) => v.name), ['Pola']);
});
