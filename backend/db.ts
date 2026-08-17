import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

// Resolve database path: use DATABASE_URL env var, or default to ./dev.db
function getDbPath(): string {
  const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
  const rawPath = dbUrl.startsWith('file:') ? dbUrl.substring(5) : dbUrl;
  // Ensure the directory exists
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

// Auto-create tables if they don't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS Student (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    leetcodeHandle TEXT UNIQUE,
    codechefHandle TEXT UNIQUE
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
    FOREIGN KEY (studentId) REFERENCES Student(id)
  );
`);

// ─── Helpers ──────────────────────────────────────────────

export interface StudentRow {
  id: number;
  name: string;
  leetcodeHandle: string | null;
  codechefHandle: string | null;
}

export interface LeaderboardEntry {
  id: number;
  name: string;
  leetcodeHandle: string | null;
  codechefHandle: string | null;
  leetcodeStreak: number;
  leetcodeEasy: number;
  leetcodeMedium: number;
  leetcodeHard: number;
  codechefSolved: number;
  totalSolved: number;
  solvedToday: number;
}

export function getLeaderboard(): LeaderboardEntry[] {
  const rows = db.prepare(`
    SELECT
      s.id, s.name, s.leetcodeHandle, s.codechefHandle,
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
  `).all() as any[];

  return rows.map(r => ({
    id: r.id,
    name: r.name,
    leetcodeHandle: r.leetcodeHandle,
    codechefHandle: r.codechefHandle,
    leetcodeStreak: r.streak,
    leetcodeEasy: r.easy,
    leetcodeMedium: r.medium,
    leetcodeHard: r.hard,
    codechefSolved: r.codechefSolved,
    totalSolved: r.totalSolved + r.codechefSolved,
    solvedToday: r.solvedToday
  }));
}

export function getAllStudents(): StudentRow[] {
  return db.prepare('SELECT * FROM Student').all() as StudentRow[];
}

export function addStudent(name: string, leetcodeHandle: string | undefined, codechefHandle: string | null): StudentRow {
  const result = db.prepare(
    'INSERT INTO Student (name, leetcodeHandle, codechefHandle) VALUES (?, ?, ?)'
  ).run(name, leetcodeHandle || null, codechefHandle || null);
  return { id: Number(result.lastInsertRowid), name, leetcodeHandle: leetcodeHandle || null, codechefHandle };
}

export function upsertStudent(name: string, leetcodeHandle: string, codechefHandle: string | null): StudentRow {
  // Try to find existing student by leetcodeHandle
  const existing = db.prepare('SELECT * FROM Student WHERE leetcodeHandle = ?').get(leetcodeHandle) as StudentRow | undefined;
  if (existing) {
    db.prepare('UPDATE Student SET codechefHandle = ? WHERE id = ?').run(codechefHandle, existing.id);
    return { ...existing, codechefHandle };
  }
  return addStudent(name, leetcodeHandle, codechefHandle);
}

export function updateStudent(id: number, name: string, leetcodeHandle: string | undefined, codechefHandle: string | null): StudentRow {
  db.prepare(
    'UPDATE Student SET name = ?, leetcodeHandle = ?, codechefHandle = ? WHERE id = ?'
  ).run(name, leetcodeHandle || null, codechefHandle || null, id);
  return { id, name, leetcodeHandle: leetcodeHandle || null, codechefHandle };
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
