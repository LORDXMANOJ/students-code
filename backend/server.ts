import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import * as cheerio from 'cheerio';
import * as path from 'path';
import { exec } from 'child_process';
import * as fs from 'fs';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import {
  getLeaderboard, getAllStudents, getStudentsBySection, addStudent,
  updateStudent, deleteStudent, insertDailyStat, isHandleGloballyTaken,
  getDepartmentsWithStats, getAllDepartments, addDepartment, renameDepartment,
  getUsers, getUserByEmail, getUserById, addUser, updateUserPassword, deleteUser,
  getDepartmentById
} from './db';

const JWT_SECRET = process.env.JWT_SECRET || 'codetracker_secret_jwt_key_2026_super_admin';

const app = express();

const clientOrigins = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(',').map(s => s.trim())
  : '*';

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (!process.env.CLIENT_URL || process.env.CLIENT_URL === '*') return callback(null, true);
    const allowed = process.env.CLIENT_URL.split(',').map(s => s.trim().replace(/\/$/, ''));
    if (allowed.includes(origin.replace(/\/$/, '')) || allowed.includes('*')) {
      return callback(null, true);
    }
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// ─── Health Check Endpoint (Deployment testing) ───────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    time: new Date().toISOString()
  });
});

// ─── Custom Request Interface for Auth ────────────────────
export interface AuthUser {
  id: number;
  email: string;
  role: 'SUPER_ADMIN' | 'DEPARTMENT_USER';
  department_id: number | null;
  departmentName?: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

// ─── Authentication Middleware ────────────────────────────
function authenticateToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired session. Please log in again.' });
    }
    req.user = user as AuthUser;
    next();
  });
}

function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Access denied. Super Admin privileges required.' });
  }
  next();
}

// ─── Helper to Scrape LeetCode ────────────────────────────
async function fetchLeetCodeStats(username: string) {
  const query = `
    query getUserProfile($username: String!) {
      matchedUser(username: $username) {
        submitStats { acSubmissionNum { difficulty, count } }
        submissionCalendar
      }
    }
  `;
  try {
    const res = await fetch('https://leetcode.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { username } })
    });
    const json = await res.json() as any;
    if (!json?.data?.matchedUser) return null;
    
    const stats = json.data.matchedUser.submitStats.acSubmissionNum;
    const totalSolved = stats.find((x: any) => x.difficulty === 'All')?.count || 0;
    const easy = stats.find((x: any) => x.difficulty === 'Easy')?.count || 0;
    const medium = stats.find((x: any) => x.difficulty === 'Medium')?.count || 0;
    const hard = stats.find((x: any) => x.difficulty === 'Hard')?.count || 0;
    
    let streak = 0;
    let solvedToday = 0;
    const calendarStr = json.data.matchedUser.submissionCalendar;
    
    if (calendarStr) {
      const timestamps = Object.keys(JSON.parse(calendarStr)).map(Number).sort((a, b) => b - a);
      const oneDay = 86400;
      const currentTime = Math.floor(Date.now() / 1000);
      
      const now = new Date();
      const startOfDay = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000);
      for (const ts of timestamps) {
        if (ts >= startOfDay) solvedToday += JSON.parse(calendarStr)[ts.toString()];
      }
      
      if (timestamps.length > 0 && currentTime - timestamps[0] < oneDay * 2) {
        streak = 1;
        for (let i = 1; i < timestamps.length; i++) {
           if (timestamps[i-1] - timestamps[i] <= oneDay + 3600) streak++;
           else break;
        }
      }
    }
    return { totalSolved, easy, medium, hard, streak, solvedToday };
  } catch (e) {
    return null;
  }
}

// ─── Helper to Scrape CodeChef ────────────────────────────
async function fetchCodeChefStats(username: string | null): Promise<number> {
  if (!username) return 0;
  try {
    const res = await fetch(`https://www.codechef.com/users/${username}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    const html = await res.text();
    const $ = cheerio.load(html);
    const solvedText = $('.rating-data-section.problems-solved h3').filter((i, el) => $(el).text().includes('Total Problems Solved')).text();
    const match = solvedText.match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
  } catch (e) {
    return 0;
  }
}

// ─── Authentication Routes ────────────────────────────────

// Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const user = getUserByEmail(email);
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const isPasswordValid = bcrypt.compareSync(password, user.password_hash);
  if (!isPasswordValid) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const tokenPayload: AuthUser = {
    id: user.id,
    email: user.email,
    role: user.role,
    department_id: user.department_id,
    departmentName: user.departmentName
  };

  const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '7d' });

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      departmentId: user.department_id,
      departmentName: user.departmentName
    }
  });
});

// Current Authenticated User Info
app.get('/api/auth/me', authenticateToken, (req, res) => {
  const user = getUserById(req.user!.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }
  res.json({
    id: user.id,
    email: user.email,
    role: user.role,
    departmentId: user.department_id,
    departmentName: user.departmentName
  });
});

// Change Password
app.post('/api/auth/change-password', authenticateToken, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current password and new password are required.' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
  }

  const user = getUserById(req.user!.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const isCurrentValid = bcrypt.compareSync(currentPassword, user.password_hash);
  if (!isCurrentValid) {
    return res.status(400).json({ error: 'Incorrect current password.' });
  }

  const newHash = bcrypt.hashSync(newPassword, 10);
  updateUserPassword(user.id, newHash);

  res.json({ success: true, message: 'Password updated successfully.' });
});

// ─── Department Management Routes ─────────────────────────

// Get all departments with stats
app.get('/api/departments', authenticateToken, (req, res) => {
  try {
    const departments = getDepartmentsWithStats();
    res.json(departments);
  } catch (error) {
    console.error('Error fetching departments:', error);
    res.status(500).json({ error: 'Failed to fetch departments.' });
  }
});

// Create Department (Super Admin only)
app.post('/api/departments', authenticateToken, requireSuperAdmin, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Department name is required.' });
  }
  try {
    const dept = addDepartment(name);
    res.json(dept);
  } catch (error: any) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(400).json({ error: 'A department with this name already exists.' });
    }
    console.error('Error creating department:', error);
    res.status(500).json({ error: 'Failed to create department.' });
  }
});

// Rename Department (Super Admin only)
app.put('/api/departments/:id', authenticateToken, requireSuperAdmin, (req, res) => {
  const deptId = parseInt(req.params.id);
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Department name is required.' });
  }
  try {
    const dept = renameDepartment(deptId, name);
    if (!dept) {
      return res.status(404).json({ error: 'Department not found.' });
    }
    res.json(dept);
  } catch (error: any) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(400).json({ error: 'A department with this name already exists.' });
    }
    console.error('Error renaming department:', error);
    res.status(500).json({ error: 'Failed to rename department.' });
  }
});

// ─── User Management Routes (Super Admin only) ────────────

// List all users
app.get('/api/users', authenticateToken, requireSuperAdmin, (req, res) => {
  try {
    const users = getUsers();
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users.' });
  }
});

// Create Department User
app.post('/api/users', authenticateToken, requireSuperAdmin, (req, res) => {
  const { email, password, departmentId } = req.body;
  if (!email || !password || !departmentId) {
    return res.status(400).json({ error: 'Email, password, and department are required.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }

  const dept = getDepartmentById(parseInt(departmentId));
  if (!dept) {
    return res.status(400).json({ error: 'Selected department does not exist.' });
  }

  const existing = getUserByEmail(email);
  if (existing) {
    return res.status(400).json({ error: 'A user with this email address already exists.' });
  }

  try {
    const passwordHash = bcrypt.hashSync(password, 10);
    const newUser = addUser(email, passwordHash, 'DEPARTMENT_USER', dept.id);
    res.json(newUser);
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Failed to create user.' });
  }
});

// Reset User Password (Admin only)
app.put('/api/users/:id/reset-password', authenticateToken, requireSuperAdmin, (req, res) => {
  const userId = parseInt(req.params.id);
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters long.' });
  }

  const user = getUserById(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  try {
    const newHash = bcrypt.hashSync(newPassword, 10);
    updateUserPassword(userId, newHash);
    res.json({ success: true, message: `Password reset successfully for ${user.email}.` });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ error: 'Failed to reset user password.' });
  }
});

// Delete User Account
app.delete('/api/users/:id', authenticateToken, requireSuperAdmin, (req, res) => {
  const userId = parseInt(req.params.id);
  const user = getUserById(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  if (user.role === 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Cannot delete the Super Admin account.' });
  }

  if (user.id === req.user!.id) {
    return res.status(403).json({ error: 'Cannot delete your own active account.' });
  }

  try {
    deleteUser(userId);
    res.json({ success: true, message: 'User deleted successfully.' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user.' });
  }
});

// ─── Student & Leaderboard Routes ─────────────────────────

// Get Leaderboard (Scoped to department)
app.get('/api/leaderboard', authenticateToken, (req, res) => {
  try {
    let departmentId: number | null = null;

    if (req.user!.role === 'DEPARTMENT_USER') {
      departmentId = req.user!.department_id;
    } else if (req.user!.role === 'SUPER_ADMIN' && req.query.departmentId) {
      departmentId = parseInt(req.query.departmentId as string);
    }

    const leaderboard = getLeaderboard(departmentId);
    res.json(leaderboard);
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard.' });
  }
});

// Section-Scoped Refresh Stats (Only refreshes students in the current Year & Section)
app.post('/api/leaderboard/refresh', authenticateToken, async (req, res) => {
  try {
    let departmentId = req.user!.role === 'DEPARTMENT_USER'
      ? req.user!.department_id
      : parseInt(req.body.departmentId);

    const year = parseInt(req.body.year);
    const section = req.body.section ? req.body.section.toString().trim().toUpperCase() : null;

    if (!departmentId) {
      return res.status(400).json({ error: 'Department is required for refreshing stats.' });
    }

    let studentsToRefresh;
    if (year && section) {
      studentsToRefresh = getStudentsBySection(departmentId, year, section);
      console.log(`Refreshing section stats: Dept ${departmentId}, Year ${year}, Section ${section} (${studentsToRefresh.length} students)...`);
    } else {
      studentsToRefresh = getAllStudents(departmentId);
      console.log(`Refreshing department stats: Dept ${departmentId} (${studentsToRefresh.length} students)...`);
    }

    // Process in batches of 5
    const batchSize = 5;
    for (let i = 0; i < studentsToRefresh.length; i += batchSize) {
      const batch = studentsToRefresh.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (student) => {
          if (student.leetcodeHandle) {
            const lcStats = await fetchLeetCodeStats(student.leetcodeHandle);
            const ccSolved = await fetchCodeChefStats(student.codechefHandle);

            insertDailyStat(student.id, {
              streak: lcStats?.streak || 0,
              totalSolved: lcStats?.totalSolved || 0,
              easy: lcStats?.easy || 0,
              medium: lcStats?.medium || 0,
              hard: lcStats?.hard || 0,
              solvedToday: lcStats?.solvedToday || 0,
              codechefSolved: ccSolved
            });
          }
        })
      );
    }

    const leaderboard = getLeaderboard(departmentId);
    res.json(leaderboard);
  } catch (error) {
    console.error('Error refreshing stats:', error);
    res.status(500).json({ error: 'Failed to refresh leaderboard stats.' });
  }
});

// Add New Student
app.post('/api/students', authenticateToken, async (req, res) => {
  const { name, leetcodeLink, codechefLink, year, section } = req.body;
  if (!name || !leetcodeLink) {
    return res.status(400).json({ error: 'Name and LeetCode link are required.' });
  }

  // Determine Department
  let departmentId: number;
  if (req.user!.role === 'DEPARTMENT_USER') {
    departmentId = req.user!.department_id!;
  } else {
    departmentId = parseInt(req.body.departmentId);
    if (!departmentId) {
      return res.status(400).json({ error: 'Department is required.' });
    }
  }

  // Validate Year
  const studentYear = parseInt(year);
  if (isNaN(studentYear) || studentYear < 1 || studentYear > 4) {
    return res.status(400).json({ error: 'Year must be a number between 1 and 4.' });
  }

  // Validate Section
  const studentSection = section ? section.toString().trim().toUpperCase() : 'A';
  if (!['A', 'B', 'C', 'D'].includes(studentSection)) {
    return res.status(400).json({ error: 'Section must be A, B, C, or D.' });
  }

  // Extract handles
  const leetcodeHandle = leetcodeLink.split('/').filter(Boolean).pop()?.split('?')[0];
  const codechefHandle = codechefLink ? codechefLink.split('/').filter(Boolean).pop()?.split('?')[0] : null;

  // Global handle uniqueness check
  if (leetcodeHandle && isHandleGloballyTaken(leetcodeHandle, 'leetcode')) {
    return res.status(400).json({ error: `LeetCode handle '${leetcodeHandle}' is already assigned to a student in the college.` });
  }
  if (codechefHandle && isHandleGloballyTaken(codechefHandle, 'codechef')) {
    return res.status(400).json({ error: `CodeChef handle '${codechefHandle}' is already assigned to a student in the college.` });
  }

  try {
    const student = addStudent(name, leetcodeHandle, codechefHandle, studentYear, studentSection, departmentId);

    // Fetch initial stats
    if (leetcodeHandle) {
      const lcStats = await fetchLeetCodeStats(leetcodeHandle);
      const ccSolved = await fetchCodeChefStats(codechefHandle);

      insertDailyStat(student.id, {
        streak: lcStats?.streak || 0,
        totalSolved: lcStats?.totalSolved || 0,
        easy: lcStats?.easy || 0,
        medium: lcStats?.medium || 0,
        hard: lcStats?.hard || 0,
        solvedToday: lcStats?.solvedToday || 0,
        codechefSolved: ccSolved
      });
    }
    res.json(student);
  } catch (error) {
    console.error('Error adding student:', error);
    res.status(500).json({ error: 'Failed to add student. Ensure handles are unique.' });
  }
});

// Update Student
app.put('/api/students/:id', authenticateToken, async (req, res) => {
  const studentId = parseInt(req.params.id);
  const { name, leetcodeLink, codechefLink, year, section } = req.body;

  if (!name || !leetcodeLink) {
    return res.status(400).json({ error: 'Name and LeetCode link are required.' });
  }

  const existingStudent = getAllStudents().find(s => s.id === studentId);
  if (!existingStudent) {
    return res.status(404).json({ error: 'Student not found.' });
  }

  // Security check: Department User can only update students within their department
  if (req.user!.role === 'DEPARTMENT_USER' && existingStudent.department_id !== req.user!.department_id) {
    return res.status(403).json({ error: 'Permission denied: Cannot edit students from another department.' });
  }

  const studentYear = parseInt(year);
  if (isNaN(studentYear) || studentYear < 1 || studentYear > 4) {
    return res.status(400).json({ error: 'Year must be a number between 1 and 4.' });
  }

  const studentSection = section ? section.toString().trim().toUpperCase() : 'A';
  if (!['A', 'B', 'C', 'D'].includes(studentSection)) {
    return res.status(400).json({ error: 'Section must be A, B, C, or D.' });
  }

  const leetcodeHandle = leetcodeLink.split('/').filter(Boolean).pop()?.split('?')[0];
  const codechefHandle = codechefLink ? codechefLink.split('/').filter(Boolean).pop()?.split('?')[0] : null;

  // Global handle uniqueness check
  if (leetcodeHandle && isHandleGloballyTaken(leetcodeHandle, 'leetcode', studentId)) {
    return res.status(400).json({ error: `LeetCode handle '${leetcodeHandle}' is already assigned to another student.` });
  }
  if (codechefHandle && isHandleGloballyTaken(codechefHandle, 'codechef', studentId)) {
    return res.status(400).json({ error: `CodeChef handle '${codechefHandle}' is already assigned to another student.` });
  }

  try {
    const updated = updateStudent(studentId, name, leetcodeHandle, codechefHandle, studentYear, studentSection, existingStudent.department_id);

    // Fire and forget stats refresh
    if (leetcodeHandle) {
      fetchLeetCodeStats(leetcodeHandle).then(async (lcStats) => {
        const ccSolved = await fetchCodeChefStats(codechefHandle);
        insertDailyStat(studentId, {
          streak: lcStats?.streak || 0,
          totalSolved: lcStats?.totalSolved || 0,
          easy: lcStats?.easy || 0,
          medium: lcStats?.medium || 0,
          hard: lcStats?.hard || 0,
          solvedToday: lcStats?.solvedToday || 0,
          codechefSolved: ccSolved
        });
      });
    }

    res.json(updated);
  } catch (error: any) {
    console.error('Student update error:', error);
    res.status(500).json({ error: 'Failed to update student.' });
  }
});

// Delete Student
app.delete('/api/students/:id', authenticateToken, (req, res) => {
  const studentId = parseInt(req.params.id);
  const existingStudent = getAllStudents().find(s => s.id === studentId);
  if (!existingStudent) {
    return res.status(404).json({ error: 'Student not found.' });
  }

  if (req.user!.role === 'DEPARTMENT_USER' && existingStudent.department_id !== req.user!.department_id) {
    return res.status(403).json({ error: 'Permission denied: Cannot delete students from another department.' });
  }

  try {
    deleteStudent(studentId);
    res.json({ success: true, message: 'Student removed successfully.' });
  } catch (error) {
    console.error('Error removing student:', error);
    res.status(500).json({ error: 'Failed to remove student.' });
  }
});

// Validate URL (Public/Authenticated)
app.post('/api/validate-url', async (req, res) => {
  const { url, platform } = req.body;
  try {
    const handle = url.split('/').filter(Boolean).pop()?.split('?')[0];
    if (!handle) return res.json({ valid: false });
    
    if (platform === 'leetcode') {
      const lres = await fetch(`https://leetcode.com/${handle}`, { method: 'HEAD' });
      if (lres.status === 404) return res.json({ valid: false });
      return res.json({ valid: true });
    } else if (platform === 'codechef') {
      const cres = await fetch(`https://www.codechef.com/users/${handle}`, { method: 'HEAD' });
      if (cres.status === 404) return res.json({ valid: false });
      return res.json({ valid: true });
    }
    return res.json({ valid: false });
  } catch(e) {
    return res.json({ valid: false });
  }
});

// Bulk Upload
let isBulkProcessing = false;
let bulkProgress = { total: 0, completed: 0 };

app.post('/api/students/bulk', authenticateToken, async (req, res) => {
  if (isBulkProcessing) {
    return res.status(429).json({ error: 'A bulk import is already in progress. Please wait.' });
  }
  const students = req.body.students;
  if (!Array.isArray(students) || students.length === 0) {
    return res.status(400).json({ error: 'No students provided for import.' });
  }

  // Determine Department
  let departmentId: number;
  if (req.user!.role === 'DEPARTMENT_USER') {
    departmentId = req.user!.department_id!;
  } else {
    departmentId = parseInt(req.body.departmentId);
    if (!departmentId) {
      return res.status(400).json({ error: 'Department is required for bulk import.' });
    }
  }

  isBulkProcessing = true;
  bulkProgress = { total: students.length, completed: 0 };
  
  res.json({ success: true, message: 'Bulk import started.' });
  
  // Background processing
  setTimeout(async () => {
    try {
      for (const s of students) {
        const leetcodeHandle = s.leetcodeLink.split('/').filter(Boolean).pop()?.split('?')[0];
        const codechefHandle = s.codechefLink ? s.codechefLink.split('/').filter(Boolean).pop()?.split('?')[0] : null;
        
        const studentYear = parseInt(s.year);
        if (isNaN(studentYear) || studentYear < 1 || studentYear > 4) continue;
        const studentSection = s.section ? s.section.toString().trim().toUpperCase() : 'A';
        if (!['A', 'B', 'C', 'D'].includes(studentSection)) continue;

        // Skip if globally duplicated
        if (leetcodeHandle && isHandleGloballyTaken(leetcodeHandle, 'leetcode')) continue;
        if (codechefHandle && isHandleGloballyTaken(codechefHandle, 'codechef')) continue;
        
        const student = addStudent(s.name, leetcodeHandle, codechefHandle, studentYear, studentSection, departmentId);
        
        if (leetcodeHandle) {
          const lcStats = await fetchLeetCodeStats(leetcodeHandle);
          const ccSolved = await fetchCodeChefStats(codechefHandle);
          
          insertDailyStat(student.id, {
            streak: lcStats?.streak || 0,
            totalSolved: lcStats?.totalSolved || 0,
            easy: lcStats?.easy || 0,
            medium: lcStats?.medium || 0,
            hard: lcStats?.hard || 0,
            solvedToday: lcStats?.solvedToday || 0,
            codechefSolved: ccSolved
          });
        }
        bulkProgress.completed++;
      }
    } catch (err) {
      console.error('Bulk import error', err);
    } finally {
      isBulkProcessing = false;
    }
  }, 0);
});

app.get('/api/stats/progress', authenticateToken, (req, res) => {
  res.json({
    isProcessing: isBulkProcessing,
    completed: bulkProgress.completed,
    total: bulkProgress.total
  });
});

// Serve static frontend files (if built)
const publicPath = fs.existsSync(path.join(__dirname, 'public'))
  ? path.join(__dirname, 'public')
  : path.join(__dirname, '..', 'public');

if (fs.existsSync(path.join(publicPath, 'index.html'))) {
  app.use(express.static(publicPath));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(publicPath, 'index.html'));
  });
}

const PORT = process.env.PORT || 3000;
try {
  app.listen(PORT, () => {
    console.log('✓ Database initialized successfully');
    console.log('✓ CodeTracker Server started');
    console.log(`✓ Listening on port ${PORT}`);
    
    // Only open browser automatically in development when not on server or Electron
    if (process.env.NODE_ENV !== 'production' && !process.env.PORT) {
      const isElectron = !!process.versions.electron || process.env.IS_ELECTRON === 'true';
      if (!isElectron) {
        const url = `http://localhost:${PORT}`;
        const startCmd = process.platform === 'win32' ? `start ${url}` : process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`;
        exec(startCmd, (err) => {
          if (err) console.error('Could not open browser automatically:', err.message);
        });
      }
    }
  });
} catch (startupError) {
  console.error('Fatal error during server startup:', startupError);
  process.exit(1);
}

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

