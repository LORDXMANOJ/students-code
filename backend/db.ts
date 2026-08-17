import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import bcrypt from 'bcryptjs';

// Resolve database path: use DATABASE_URL env var, or default to ./dev.db
function getDbPath(): string {
  const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
  const rawPath = dbUrl.startsWith('file:') ? dbUrl.substring(5) : dbUrl;
  const dir = path.dirname(rawPath);
  if (dir && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return rawPath;
}

const db = new Database(getDbPath());

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Auto-create Tables ──────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS Department (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS User (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    department_id INTEGER REFERENCES Department(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS Student (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    leetcodeHandle TEXT UNIQUE,
    codechefHandle TEXT UNIQUE,
    year INTEGER NOT NULL DEFAULT 2,
    section TEXT NOT NULL DEFAULT 'A',
    department_id INTEGER REFERENCES Department(id)
  );

  CREATE TABLE IF NOT EXISTS DailyStat (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    studentId INTEGER NOT NULL,
    date TEXT NOT NULL DEFAULT (datetime('now')),
    streak INTEGER NOT NULL DEFAULT 0,
    totalSolved INTEGER NOT NULL DEFAULT 0,
    easy INTEGER NOT NULL DEFAULT 0,
    medium INTEGER NOT NULL DEFAULT 0,
    hard INTEGER NOT NULL DEFAULT 0,
    solvedToday INTEGER NOT NULL DEFAULT 0,
    codechefSolved INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (studentId) REFERENCES Student(id) ON DELETE CASCADE
  );
`);

// ─── Migrations ───────────────────────────────────────────
const studentTableInfo = db.prepare("PRAGMA table_info(Student)").all() as any[];
const hasYear = studentTableInfo.some(col => col.name === 'year');
if (!hasYear) {
  db.exec('ALTER TABLE Student ADD COLUMN year INTEGER NOT NULL DEFAULT 2');
  db.exec("ALTER TABLE Student ADD COLUMN section TEXT NOT NULL DEFAULT 'A'");
}

const hasDeptId = studentTableInfo.some(col => col.name === 'department_id');
if (!hasDeptId) {
  db.exec('ALTER TABLE Student ADD COLUMN department_id INTEGER REFERENCES Department(id)');
}

// If there are students with null department_id, create a default "CSE" department if none exists and link them
const unassignedCount = (db.prepare('SELECT COUNT(*) as count FROM Student WHERE department_id IS NULL').get() as any)?.count || 0;
if (unassignedCount > 0) {
  let defaultDept = db.prepare('SELECT id FROM Department LIMIT 1').get() as any;
  if (!defaultDept) {
    const res = db.prepare("INSERT INTO Department (name) VALUES ('CSE')").run();
    defaultDept = { id: Number(res.lastInsertRowid) };
  }
  db.prepare('UPDATE Student SET department_id = ? WHERE department_id IS NULL').run(defaultDept.id);
}

// Seed Super Admin if not present
const superAdmin = db.prepare("SELECT * FROM User WHERE role = 'SUPER_ADMIN'").get();
if (!superAdmin) {
  const hash = bcrypt.hashSync('ChangeMe123!', 10);
  db.prepare(`
    INSERT INTO User (email, password_hash, role, department_id)
    VALUES (?, ?, 'SUPER_ADMIN', NULL)
  `).run('admin@codetracker.local', hash);
  console.log('Super Admin account created: admin@codetracker.local / ChangeMe123!');
}

// ─── Interfaces ───────────────────────────────────────────
export interface DepartmentRow {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
  studentCount?: number;
  sectionCount?: number;
  lastUpdated?: string | null;
}

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  role: 'SUPER_ADMIN' | 'DEPARTMENT_USER';
  department_id: number | null;
  departmentName?: string | null;
  created_at: string;
  updated_at: string;
}

export interface StudentRow {
  id: number;
  name: string;
  leetcodeHandle: string | null;
  codechefHandle: string | null;
  year: number;
  section: string;
  department_id: number;
}

export interface LeaderboardEntry {
  id: number;
  name: string;
  leetcodeHandle: string | null;
  codechefHandle: string | null;
  year: number;
  section: string;
  department_id: number;
  leetcodeStreak: number;
  leetcodeEasy: number;
  leetcodeMedium: number;
  leetcodeHard: number;
  codechefSolved: number;
  totalSolved: number;
  solvedToday: number;
}

// ─── Department Helpers ───────────────────────────────────
export function getDepartmentsWithStats(): DepartmentRow[] {
  const rows = db.prepare(`
    SELECT 
      d.id, d.name, d.created_at, d.updated_at,
      COUNT(DISTINCT s.id) as studentCount,
      COUNT(DISTINCT (s.year || '-' || s.section)) as sectionCount,
      MAX(ds.date) as lastUpdated
    FROM Department d
    LEFT JOIN Student s ON s.department_id = d.id
    LEFT JOIN DailyStat ds ON ds.studentId = s.id
    GROUP BY d.id
    ORDER BY d.name ASC
  `).all() as any[];

  return rows.map(r => ({
    id: r.id,
    name: r.name,
    created_at: r.created_at,
    updated_at: r.updated_at,
    studentCount: r.studentCount || 0,
    sectionCount: r.sectionCount || 0,
    lastUpdated: r.lastUpdated || null
  }));
}

export function getAllDepartments(): DepartmentRow[] {
  return db.prepare('SELECT * FROM Department ORDER BY name ASC').all() as DepartmentRow[];
}

export function getDepartmentById(id: number): DepartmentRow | undefined {
  return db.prepare('SELECT * FROM Department WHERE id = ?').get(id) as DepartmentRow | undefined;
}

export function addDepartment(name: string): DepartmentRow {
  const res = db.prepare('INSERT INTO Department (name) VALUES (?)').run(name.trim());
  return { id: Number(res.lastInsertRowid), name: name.trim(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
}

export function renameDepartment(id: number, name: string): DepartmentRow | null {
  db.prepare("UPDATE Department SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name.trim(), id);
  return getDepartmentById(id) || null;
}

// ─── User Helpers ─────────────────────────────────────────
export function getUsers(): Omit<UserRow, 'password_hash'>[] {
  return db.prepare(`
    SELECT u.id, u.email, u.role, u.department_id, u.created_at, u.updated_at, d.name as departmentName
    FROM User u
    LEFT JOIN Department d ON d.id = u.department_id
    ORDER BY u.created_at DESC
  `).all() as Omit<UserRow, 'password_hash'>[];
}

export function getUserByEmail(email: string): UserRow | undefined {
  return db.prepare(`
    SELECT u.*, d.name as departmentName
    FROM User u
    LEFT JOIN Department d ON d.id = u.department_id
    WHERE u.email = ?
  `).get(email.trim().toLowerCase()) as UserRow | undefined;
}

export function getUserById(id: number): UserRow | undefined {
  return db.prepare(`
    SELECT u.*, d.name as departmentName
    FROM User u
    LEFT JOIN Department d ON d.id = u.department_id
    WHERE u.id = ?
  `).get(id) as UserRow | undefined;
}

export function addUser(email: string, passwordHash: string, role: 'SUPER_ADMIN' | 'DEPARTMENT_USER', departmentId: number | null): Omit<UserRow, 'password_hash'> {
  const res = db.prepare(`
    INSERT INTO User (email, password_hash, role, department_id)
    VALUES (?, ?, ?, ?)
  `).run(email.trim().toLowerCase(), passwordHash, role, departmentId);
  
  const user = getUserById(Number(res.lastInsertRowid));
  return user!;
}

export function updateUserPassword(id: number, passwordHash: string): void {
  db.prepare("UPDATE User SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(passwordHash, id);
}

export function deleteUser(id: number): void {
  db.prepare('DELETE FROM User WHERE id = ?').run(id);
}

// ─── Student & Leaderboard Helpers ────────────────────────
export function getLeaderboard(departmentId?: number | null): LeaderboardEntry[] {
  let query = `
    SELECT
      s.id, s.name, s.leetcodeHandle, s.codechefHandle, s.year, s.section, s.department_id,
      COALESCE(d.streak, 0) as streak,
      COALESCE(d.easy, 0) as easy,
      COALESCE(d.medium, 0) as medium,
      COALESCE(d.hard, 0) as hard,
      COALESCE(d.totalSolved, 0) as totalSolved,
      COALESCE(d.codechefSolved, 0) as codechefSolved,
      COALESCE(d.solvedToday, 0) as solvedToday
    FROM Student s
    LEFT JOIN DailyStat d ON d.id = (
      SELECT id FROM DailyStat WHERE studentId = s.id ORDER BY date DESC LIMIT 1
    )
  `;
  const params: any[] = [];
  if (departmentId) {
    query += ' WHERE s.department_id = ?';
    params.push(departmentId);
  }

  const rows = db.prepare(query).all(...params) as any[];

  return rows.map(r => ({
    id: r.id,
    name: r.name,
    leetcodeHandle: r.leetcodeHandle,
    codechefHandle: r.codechefHandle,
    year: r.year,
    section: r.section,
    department_id: r.department_id,
    leetcodeStreak: r.streak,
    leetcodeEasy: r.easy,
    leetcodeMedium: r.medium,
    leetcodeHard: r.hard,
    codechefSolved: r.codechefSolved,
    totalSolved: r.totalSolved + r.codechefSolved,
    solvedToday: r.solvedToday
  }));
}

export function getAllStudents(departmentId?: number | null): StudentRow[] {
  if (departmentId) {
    return db.prepare('SELECT * FROM Student WHERE department_id = ?').all(departmentId) as StudentRow[];
  }
  return db.prepare('SELECT * FROM Student').all() as StudentRow[];
}

export function getStudentsBySection(departmentId: number, year: number, section: string): StudentRow[] {
  return db.prepare('SELECT * FROM Student WHERE department_id = ? AND year = ? AND section = ?').all(departmentId, year, section) as StudentRow[];
}

export function isHandleGloballyTaken(handle: string, platform: 'leetcode' | 'codechef', excludeStudentId?: number): boolean {
  if (!handle) return false;
  const col = platform === 'leetcode' ? 'leetcodeHandle' : 'codechefHandle';
  let query = `SELECT id FROM Student WHERE LOWER(${col}) = LOWER(?)`;
  const params: any[] = [handle];
  if (excludeStudentId) {
    query += ' AND id != ?';
    params.push(excludeStudentId);
  }
  const match = db.prepare(query).get(...params);
  return !!match;
}

export function addStudent(name: string, leetcodeHandle: string | undefined, codechefHandle: string | null, year: number, section: string, departmentId: number): StudentRow {
  const result = db.prepare(
    'INSERT INTO Student (name, leetcodeHandle, codechefHandle, year, section, department_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(name, leetcodeHandle || null, codechefHandle || null, year, section, departmentId);
  return { id: Number(result.lastInsertRowid), name, leetcodeHandle: leetcodeHandle || null, codechefHandle, year, section, department_id: departmentId };
}

export function updateStudent(id: number, name: string, leetcodeHandle: string | undefined, codechefHandle: string | null, year: number, section: string, departmentId: number): StudentRow {
  db.prepare(
    'UPDATE Student SET name = ?, leetcodeHandle = ?, codechefHandle = ?, year = ?, section = ?, department_id = ? WHERE id = ?'
  ).run(name, leetcodeHandle || null, codechefHandle || null, year, section, departmentId, id);
  return { id, name, leetcodeHandle: leetcodeHandle || null, codechefHandle, year, section, department_id: departmentId };
}

export function deleteStudent(id: number): void {
  db.prepare('DELETE FROM DailyStat WHERE studentId = ?').run(id);
  db.prepare('DELETE FROM Student WHERE id = ?').run(id);
}

export function insertDailyStat(
  studentId: number,
  stats: { streak: number; totalSolved: number; easy: number; medium: number; hard: number; solvedToday: number; codechefSolved: number }
): void {
  db.prepare(`
    INSERT INTO DailyStat (studentId, streak, totalSolved, easy, medium, hard, solvedToday, codechefSolved)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(studentId, stats.streak, stats.totalSolved, stats.easy, stats.medium, stats.hard, stats.solvedToday, stats.codechefSolved);
}

export default db;
