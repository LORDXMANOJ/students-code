import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

const connectionString = process.env.DATABASE_URL;

const isLocalhost = connectionString
  ? connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
  : false;

export const pool = new Pool({
  connectionString,
  ssl: isLocalhost || !connectionString ? false : { rejectUnauthorized: false }
});

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

// ─── Database Initialization & Migrations ─────────────────
export async function initDb(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "Department" (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS "User" (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        department_id INTEGER REFERENCES "Department"(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS "Student" (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        "leetcodeHandle" TEXT UNIQUE,
        "codechefHandle" TEXT UNIQUE,
        year INTEGER NOT NULL DEFAULT 2,
        section TEXT NOT NULL DEFAULT 'A',
        department_id INTEGER REFERENCES "Department"(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS "DailyStat" (
        id SERIAL PRIMARY KEY,
        "studentId" INTEGER NOT NULL REFERENCES "Student"(id) ON DELETE CASCADE,
        date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        streak INTEGER NOT NULL DEFAULT 0,
        "totalSolved" INTEGER NOT NULL DEFAULT 0,
        easy INTEGER NOT NULL DEFAULT 0,
        medium INTEGER NOT NULL DEFAULT 0,
        hard INTEGER NOT NULL DEFAULT 0,
        "solvedToday" INTEGER NOT NULL DEFAULT 0,
        "codechefSolved" INTEGER NOT NULL DEFAULT 0
      );
    `);

    // Ensure default CSE department exists if any students have null department_id
    const unassignedRes = await client.query('SELECT COUNT(*) as count FROM "Student" WHERE department_id IS NULL');
    const unassignedCount = parseInt(unassignedRes.rows[0]?.count || '0', 10);
    if (unassignedCount > 0) {
      let deptRes = await client.query('SELECT id FROM "Department" LIMIT 1');
      let defaultDeptId = deptRes.rows[0]?.id;
      if (!defaultDeptId) {
        const insertDeptRes = await client.query('INSERT INTO "Department" (name) VALUES (\'CSE\') RETURNING id');
        defaultDeptId = insertDeptRes.rows[0].id;
      }
      await client.query('UPDATE "Student" SET department_id = $1 WHERE department_id IS NULL', [defaultDeptId]);
    }

    // Seed Super Admin if not present
    const superAdminRes = await client.query('SELECT * FROM "User" WHERE role = \'SUPER_ADMIN\' LIMIT 1');
    if (superAdminRes.rows.length === 0) {
      const hash = bcrypt.hashSync('ChangeMe123!', 10);
      await client.query(`
        INSERT INTO "User" (email, password_hash, role, department_id)
        VALUES ($1, $2, 'SUPER_ADMIN', NULL)
      `, ['admin@codetracker.local', hash]);
      console.log('Super Admin account created: admin@codetracker.local / ChangeMe123!');
    }
  } finally {
    client.release();
  }
}

// ─── Department Helpers ───────────────────────────────────
export async function getDepartmentsWithStats(): Promise<DepartmentRow[]> {
  const query = `
    SELECT 
      d.id, d.name, d.created_at, d.updated_at,
      COUNT(DISTINCT s.id)::int as "studentCount",
      COUNT(DISTINCT (s.year || '-' || s.section))::int as "sectionCount",
      MAX(ds.date) as "lastUpdated"
    FROM "Department" d
    LEFT JOIN "Student" s ON s.department_id = d.id
    LEFT JOIN "DailyStat" ds ON ds."studentId" = s.id
    GROUP BY d.id, d.name, d.created_at, d.updated_at
    ORDER BY d.name ASC
  `;
  const res = await pool.query(query);
  return res.rows.map(r => ({
    id: r.id,
    name: r.name,
    created_at: r.created_at ? new Date(r.created_at).toISOString() : '',
    updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : '',
    studentCount: Number(r.studentCount) || 0,
    sectionCount: Number(r.sectionCount) || 0,
    lastUpdated: r.lastUpdated ? new Date(r.lastUpdated).toISOString() : null
  }));
}

export async function getAllDepartments(): Promise<DepartmentRow[]> {
  const res = await pool.query('SELECT * FROM "Department" ORDER BY name ASC');
  return res.rows;
}

export async function getDepartmentById(id: number): Promise<DepartmentRow | undefined> {
  const res = await pool.query('SELECT * FROM "Department" WHERE id = $1', [id]);
  return res.rows[0];
}

export async function addDepartment(name: string): Promise<DepartmentRow> {
  const res = await pool.query(
    'INSERT INTO "Department" (name) VALUES ($1) RETURNING *',
    [name.trim()]
  );
  return res.rows[0];
}

export async function renameDepartment(id: number, name: string): Promise<DepartmentRow | null> {
  const res = await pool.query(
    'UPDATE "Department" SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
    [name.trim(), id]
  );
  return res.rows[0] || null;
}

// ─── User Helpers ─────────────────────────────────────────
export async function getUsers(): Promise<Omit<UserRow, 'password_hash'>[]> {
  const res = await pool.query(`
    SELECT u.id, u.email, u.role, u.department_id, u.created_at, u.updated_at, d.name as "departmentName"
    FROM "User" u
    LEFT JOIN "Department" d ON d.id = u.department_id
    ORDER BY u.created_at DESC
  `);
  return res.rows;
}

export async function getUserByEmail(email: string): Promise<UserRow | undefined> {
  const res = await pool.query(`
    SELECT u.*, d.name as "departmentName"
    FROM "User" u
    LEFT JOIN "Department" d ON d.id = u.department_id
    WHERE LOWER(u.email) = LOWER($1)
  `, [email.trim()]);
  return res.rows[0];
}

export async function getUserById(id: number): Promise<UserRow | undefined> {
  const res = await pool.query(`
    SELECT u.*, d.name as "departmentName"
    FROM "User" u
    LEFT JOIN "Department" d ON d.id = u.department_id
    WHERE u.id = $1
  `, [id]);
  return res.rows[0];
}

export async function addUser(
  email: string,
  passwordHash: string,
  role: 'SUPER_ADMIN' | 'DEPARTMENT_USER',
  departmentId: number | null
): Promise<Omit<UserRow, 'password_hash'>> {
  const res = await pool.query(`
    INSERT INTO "User" (email, password_hash, role, department_id)
    VALUES ($1, $2, $3, $4)
    RETURNING id
  `, [email.trim().toLowerCase(), passwordHash, role, departmentId]);
  
  const user = await getUserById(res.rows[0].id);
  return user!;
}

export async function updateUserPassword(id: number, passwordHash: string): Promise<void> {
  await pool.query('UPDATE "User" SET password_hash = $1, updated_at = NOW() WHERE id = $2', [passwordHash, id]);
}

export async function deleteUser(id: number): Promise<void> {
  await pool.query('DELETE FROM "User" WHERE id = $1', [id]);
}

// ─── Student & Leaderboard Helpers ────────────────────────
export async function getLeaderboard(departmentId?: number | null): Promise<LeaderboardEntry[]> {
  let query = `
    SELECT
      s.id, s.name, s."leetcodeHandle", s."codechefHandle", s.year, s.section, s.department_id,
      COALESCE(d.streak, 0)::int as streak,
      COALESCE(d.easy, 0)::int as easy,
      COALESCE(d.medium, 0)::int as medium,
      COALESCE(d.hard, 0)::int as hard,
      COALESCE(d."totalSolved", 0)::int as "totalSolved",
      COALESCE(d."codechefSolved", 0)::int as "codechefSolved",
      COALESCE(d."solvedToday", 0)::int as "solvedToday"
    FROM "Student" s
    LEFT JOIN "DailyStat" d ON d.id = (
      SELECT id FROM "DailyStat" WHERE "studentId" = s.id ORDER BY date DESC LIMIT 1
    )
  `;
  const params: any[] = [];
  if (departmentId) {
    query += ' WHERE s.department_id = $1';
    params.push(departmentId);
  }

  const res = await pool.query(query, params);

  return res.rows.map(r => ({
    id: r.id,
    name: r.name,
    leetcodeHandle: r.leetcodeHandle,
    codechefHandle: r.codechefHandle,
    year: r.year,
    section: r.section,
    department_id: r.department_id,
    leetcodeStreak: Number(r.streak) || 0,
    leetcodeEasy: Number(r.easy) || 0,
    leetcodeMedium: Number(r.medium) || 0,
    leetcodeHard: Number(r.hard) || 0,
    codechefSolved: Number(r.codechefSolved) || 0,
    totalSolved: (Number(r.totalSolved) || 0) + (Number(r.codechefSolved) || 0),
    solvedToday: Number(r.solvedToday) || 0
  }));
}

export async function getAllStudents(departmentId?: number | null): Promise<StudentRow[]> {
  if (departmentId) {
    const res = await pool.query('SELECT * FROM "Student" WHERE department_id = $1', [departmentId]);
    return res.rows;
  }
  const res = await pool.query('SELECT * FROM "Student"');
  return res.rows;
}

export async function getStudentsBySection(departmentId: number, year: number, section: string): Promise<StudentRow[]> {
  const res = await pool.query(
    'SELECT * FROM "Student" WHERE department_id = $1 AND year = $2 AND section = $3',
    [departmentId, year, section]
  );
  return res.rows;
}

export async function isHandleGloballyTaken(handle: string, platform: 'leetcode' | 'codechef', excludeStudentId?: number): Promise<boolean> {
  if (!handle) return false;
  const col = platform === 'leetcode' ? '"leetcodeHandle"' : '"codechefHandle"';
  let query = `SELECT id FROM "Student" WHERE LOWER(${col}) = LOWER($1)`;
  const params: any[] = [handle];
  if (excludeStudentId) {
    query += ' AND id != $2';
    params.push(excludeStudentId);
  }
  const res = await pool.query(query, params);
  return res.rows.length > 0;
}

export async function addStudent(
  name: string,
  leetcodeHandle: string | undefined,
  codechefHandle: string | null,
  year: number,
  section: string,
  departmentId: number
): Promise<StudentRow> {
  const res = await pool.query(
    'INSERT INTO "Student" (name, "leetcodeHandle", "codechefHandle", year, section, department_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [name, leetcodeHandle || null, codechefHandle || null, year, section, departmentId]
  );
  return res.rows[0];
}

export async function updateStudent(
  id: number,
  name: string,
  leetcodeHandle: string | undefined,
  codechefHandle: string | null,
  year: number,
  section: string,
  departmentId: number
): Promise<StudentRow> {
  const res = await pool.query(
    'UPDATE "Student" SET name = $1, "leetcodeHandle" = $2, "codechefHandle" = $3, year = $4, section = $5, department_id = $6 WHERE id = $7 RETURNING *',
    [name, leetcodeHandle || null, codechefHandle || null, year, section, departmentId, id]
  );
  return res.rows[0];
}

export async function deleteStudent(id: number): Promise<void> {
  await pool.query('DELETE FROM "DailyStat" WHERE "studentId" = $1', [id]);
  await pool.query('DELETE FROM "Student" WHERE id = $1', [id]);
}

export async function insertDailyStat(
  studentId: number,
  stats: { streak: number; totalSolved: number; easy: number; medium: number; hard: number; solvedToday: number; codechefSolved: number }
): Promise<void> {
  await pool.query(`
    INSERT INTO "DailyStat" ("studentId", streak, "totalSolved", easy, medium, hard, "solvedToday", "codechefSolved")
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [studentId, stats.streak, stats.totalSolved, stats.easy, stats.medium, stats.hard, stats.solvedToday, stats.codechefSolved]);
}

export async function upsertStudent(name: string, leetcode: string, codechef: string | null): Promise<StudentRow> {
  let deptRes = await pool.query('SELECT id FROM "Department" LIMIT 1');
  let deptId = deptRes.rows[0]?.id;
  if (!deptId) {
    const insertDeptRes = await pool.query('INSERT INTO "Department" (name) VALUES (\'CSE\') RETURNING id');
    deptId = insertDeptRes.rows[0].id;
  }

  const res = await pool.query(
    `INSERT INTO "Student" (name, "leetcodeHandle", "codechefHandle", year, section, department_id)
     VALUES ($1, $2, $3, 2, 'A', $4)
     ON CONFLICT ("leetcodeHandle") DO UPDATE 
     SET name = EXCLUDED.name, "codechefHandle" = EXCLUDED."codechefHandle"
     RETURNING *`,
    [name, leetcode, codechef, deptId]
  );
  return res.rows[0];
}

export default pool;
