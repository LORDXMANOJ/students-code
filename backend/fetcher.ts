import * as fs from 'fs';
import * as path from 'path';

// Load tracked students list from external JSON file
const studentsListPath = path.join(__dirname, 'students.json');
const students: { name: string; leetcode: string; codechef: string | null }[] = JSON.parse(
  fs.readFileSync(studentsListPath, 'utf8')
);

async function fetchLeetCodeStats(username: string) {
  const query = `
    query getUserProfile($username: String!) {
      matchedUser(username: $username) {
        submitStats {
          acSubmissionNum { difficulty, count }
        }
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
    
    if (!json?.data?.matchedUser) return { totalSolved: 0, streak: 0 };
    
    const stats = json.data.matchedUser.submitStats.acSubmissionNum.find((x: any) => x.difficulty === 'All');
    const totalSolved = stats ? stats.count : 0;
    
    // Parse calendar to find streak
    let streak = 0;
    const calendarStr = json.data.matchedUser.submissionCalendar;
    
    if (calendarStr) {
      const timestamps = Object.keys(JSON.parse(calendarStr)).map(Number).sort((a, b) => b - a);
      const oneDay = 86400;
      const currentTime = Math.floor(Date.now() / 1000);
      
      if (timestamps.length > 0 && currentTime - timestamps[0] < oneDay * 2) {
        streak = 1;
        for (let i = 1; i < timestamps.length; i++) {
           if (timestamps[i-1] - timestamps[i] <= oneDay + 3600) streak++;
           else break;
        }
      }
    }
    return { totalSolved, streak };
  } catch (e) {
    return { totalSolved: 0, streak: 0 };
  }
}

async function runFetcher() {
  console.log('Fetching live data for', students.length, 'students...');
  const results = [];
  let id = 1;

  for (const s of students) {
    console.log(`[${id}/${students.length}] Fetching ${s.name}...`);
    const lcStats = await fetchLeetCodeStats(s.leetcode);
    
    results.push({
      id: id++,
      name: s.name,
      leetcodeStreak: lcStats.streak,
      totalSolved: lcStats.totalSolved,
      codechefRating: 0 // Mocked for now to keep code light
    });
    
    await new Promise(r => setTimeout(r, 200)); // Sleep to prevent rate limit
  }
  
  // Directly update the frontend static data file for immediate UI rendering
  const content = `export const liveStudentsData = ${JSON.stringify(results, null, 2)};\n`;
  const destPath = path.join(__dirname, '..', 'frontend', 'src', 'app', 'dashboard', 'students.data.ts');
  fs.writeFileSync(destPath, content);
  
  console.log(`Done! Synced data to frontend.`);
}

runFetcher().catch(console.error);
