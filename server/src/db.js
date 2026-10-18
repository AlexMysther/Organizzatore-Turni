import mysql from 'mysql2/promise';
import { parseDbConfig } from './dbconfig.js';

export const pool = mysql.createPool({
  ...parseDbConfig(),
  waitForConnections: true,
  connectionLimit: 8,
  dateStrings: true,
  timezone: 'Z',
  charset: 'utf8mb4',
});

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS venues (
    id INT AUTO_INCREMENT PRIMARY KEY,
    city VARCHAR(60) NOT NULL DEFAULT 'Milano',
    name VARCHAR(80) NOT NULL,
    UNIQUE KEY uq_venue (city, name)
  )`,
  `CREATE TABLE IF NOT EXISTS departments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(60) NOT NULL UNIQUE,
    sort_order INT NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS employees (
    id INT AUTO_INCREMENT PRIMARY KEY,
    venue_id INT NOT NULL,
    department_id INT NOT NULL,
    full_name VARCHAR(120) NOT NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    FOREIGN KEY (venue_id) REFERENCES venues(id),
    FOREIGN KEY (department_id) REFERENCES departments(id),
    KEY ix_emp_venue (venue_id, active)
  )`,
  // kind: work = turno nel proprio locale, rest = riposo, loan = prestito in un altro locale
  `CREATE TABLE IF NOT EXISTS shifts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    employee_id INT NOT NULL,
    work_date DATE NOT NULL,
    position TINYINT NOT NULL DEFAULT 0,
    kind ENUM('work','rest','loan') NOT NULL,
    start_time CHAR(5) NULL,
    end_time CHAR(5) NULL,
    location_venue_id INT NULL,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    FOREIGN KEY (location_venue_id) REFERENCES venues(id),
    KEY ix_shift_day (employee_id, work_date)
  )`,
  `CREATE TABLE IF NOT EXISTS legend (
    id INT AUTO_INCREMENT PRIMARY KEY,
    venue_id INT NOT NULL,
    short_desc VARCHAR(40) NOT NULL,
    description VARCHAR(160) NOT NULL DEFAULT '',
    hours VARCHAR(60) NOT NULL DEFAULT '',
    FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(60) NOT NULL UNIQUE,
    password_hash VARCHAR(100) NOT NULL,
    is_admin TINYINT(1) NOT NULL DEFAULT 0
  )`,
  // per l'espansione futura: un manager non-admin vede solo i locali assegnati
  `CREATE TABLE IF NOT EXISTS user_venues (
    user_id INT NOT NULL,
    venue_id INT NOT NULL,
    PRIMARY KEY (user_id, venue_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE
  )`,
];

export async function initSchema() {
  for (const sql of SCHEMA) await pool.query(sql);
  const [[{ n }]] = await pool.query('SELECT COUNT(*) n FROM departments');
  if (n === 0) {
    const names = ['Garzone', 'Pizzaiolo', 'Sala', 'Store Manager'];
    for (let i = 0; i < names.length; i++) {
      await pool.query('INSERT INTO departments (name, sort_order) VALUES (?, ?)', [names[i], i]);
    }
  }
}
