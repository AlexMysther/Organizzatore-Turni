import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDbConfig } from '../src/dbconfig.js';

test('URL senza TLS (locale)', () => {
  const c = parseDbConfig({ DATABASE_URL: 'mysql://u:p@localhost:3306/turni' });
  assert.deepEqual(c, { host: 'localhost', port: 3306, user: 'u', password: 'p', database: 'turni' });
});

test('URL Aiven: caratteri speciali, porta e CA verificata', () => {
  const c = parseDbConfig({
    DATABASE_URL: 'mysql://avnadmin:p%40ss%3Aw%2Ford@mysql-x.aivencloud.com:12345/defaultdb?ssl-mode=REQUIRED',
    DB_CA: '-----BEGIN CERTIFICATE-----\\nABC\\n-----END CERTIFICATE-----',
  });
  assert.equal(c.password, 'p@ss:w/ord');
  assert.equal(c.port, 12345);
  assert.equal(c.database, 'defaultdb');
  assert.equal(c.ssl.rejectUnauthorized, true);
  assert.match(c.ssl.ca, /BEGIN CERTIFICATE-----\nABC\n-----END/);
});

test('ssl-mode senza CA e URL mancante danno errore chiaro', () => {
  assert.throws(() => parseDbConfig({ DATABASE_URL: 'mysql://u:p@h:1/d?ssl-mode=REQUIRED' }), /DB_CA/);
  assert.throws(() => parseDbConfig({}), /DATABASE_URL/);
});
