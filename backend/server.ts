import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import * as cheerio from 'cheerio';
import * as path from 'path';
import { exec } from 'child_process';
import * as fs from 'fs';
import {
  getLeaderboard, getAllStudents, addStudent, updateStudent,
  deleteStudent, insertDailyStat
} from './db';

const app = express();
app.use(cors());
app.use(express.json());

// Helper to scrape LeetCode
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

// Helper to scrape CodeChef
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

// Get Leaderboard
app.get('/api/leaderboard', (req, res) => {
  try {
    const leaderboard = getLeaderboard();
    res.json(leaderboard);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// Refresh Leaderboard Stats (On demand)
app.post('/api/leaderboard/refresh', async (req, res) => {
  try {
    const students = getAllStudents();
    console.log(`Refreshing stats for ${students.length} students...`);
    
    // Process in batches of 5 to run in parallel while avoiding rate limits
    const batchSize = 5;
    for (let i = 0; i < students.length; i += batchSize) {
      const batch = students.slice(i, i + batchSize);
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
    
    const leaderboard = getLeaderboard();
    res.json(leaderboard);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to refresh leaderboard stats' });
  }
});

// Add New Student
app.post('/api/students', async (req, res) => {
  const { name, leetcodeLink, codechefLink } = req.body;
  if (!name || !leetcodeLink) return res.status(400).json({ error: 'Name and LeetCode link are required' });

  // Extract handles from links
  const leetcodeHandle = leetcodeLink.split('/').filter(Boolean).pop()?.split('?')[0];
  const codechefHandle = codechefLink ? codechefLink.split('/').filter(Boolean).pop()?.split('?')[0] : null;

  try {
    const student = addStudent(name, leetcodeHandle, codechefHandle);

    // Immediately fetch stats and create daily stat
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
    console.error(error);
    res.status(500).json({ error: 'Failed to add student. Ensure handles are unique.' });
  }
});

// Update Student Details
app.put('/api/students/:id', async (req, res) => {
  const studentId = parseInt(req.params.id);
  const { name, leetcodeLink, codechefLink } = req.body;

  if (!name || !leetcodeLink) {
    return res.status(400).json({ error: 'Name and LeetCode link are required' });
  }

  const leetcodeHandle = leetcodeLink.split('/').filter(Boolean).pop()?.split('?')[0];
  const codechefHandle = codechefLink ? codechefLink.split('/').filter(Boolean).pop()?.split('?')[0] : null;

  let student;
  try {
    student = updateStudent(studentId, name, leetcodeHandle, codechefHandle);
  } catch (error: any) {
    console.error('Student update error:', error);
    res.status(500).json({ error: 'Failed to update student. Ensure handles are unique.' });
    return;
  }

  // Step 2: Re-fetch stats in background (don't block the response)
  res.json(student);

  // Fire-and-forget: update the daily stats after responding
  try {
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
      console.log(`Updated stats for ${student.name}`);
    }
  } catch (statsError) {
    console.error('Stats re-fetch failed (non-critical):', statsError);
  }
});

// Delete Student
app.delete('/api/students/:id', (req, res) => {
  const studentId = parseInt(req.params.id);
  try {
    deleteStudent(studentId);
    res.json({ success: true, message: 'Student removed successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to remove student' });
  }
});

// Serve static frontend files (if frontend is built and copied)
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
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  
  // Only open browser automatically if NOT running inside Electron
  const isElectron = !!process.versions.electron || process.env.IS_ELECTRON === 'true';
  if (!isElectron) {
    const url = `http://localhost:${PORT}`;
    const startCmd = process.platform === 'win32' ? `start ${url}` : process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`;
    exec(startCmd, (err) => {
      if (err) console.error('Could not open browser automatically:', err.message);
    });
  }
});
setInterval(() => {}, 100000);
