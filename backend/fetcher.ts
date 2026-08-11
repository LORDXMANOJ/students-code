import * as fs from 'fs';
import * as path from 'path';

// List of all tracked students
const students = [
  { name: 'DHARSHAN .G', leetcode: 'Dharshan_leetcode', codechef: 'dharshan_3code' },
  { name: 'NISHANTH G A', leetcode: 'NISHANTHGA27', codechef: 'nishanthga27' },
  { name: 'Poovaragan S', leetcode: 'poovaragan_12', codechef: 'poovaragan' },
  { name: 'ASHWITHA P', leetcode: '02_Ashwitha_02', codechef: 'ashwi_tha_02' },
  { name: 'SHRI BHARATHI S', leetcode: 'SHRIBHARATHI', codechef: 'shri_bharathi' },
  { name: 'DHARINI D', leetcode: 'Dharini__', codechef: 'dharini_00' },
  { name: 'VISHAL T', leetcode: 'T_vishal2006', codechef: 'vi_sh_al_2006' },
  { name: 'Naveen M', leetcode: 'NAVEEN_45M', codechef: 'naveen_450' },
  { name: 'ANANDA RAMAN G', leetcode: 'ganandaraman', codechef: 'anandazzz_08' },
  { name: 'Vijay. R', leetcode: 'Vijay_72', codechef: 'vijayr_72' },
  { name: 'SUNDRA SEKAR K', leetcode: 'sundrasekar08', codechef: 'sundrasekar08' },
  { name: 'S.DEEPAKUMAR', leetcode: 'deepakumar000', codechef: 'itz_deepak_47' },
  { name: 'S.KALAIVANI', leetcode: 'Kalaivani_Selvaraju', codechef: 'haiku_thegreat' },
  { name: 'Selva Kailash S', leetcode: 'SelvaKailash', codechef: 'selvakailash' },
  { name: 'Hemavathi M', leetcode: 'hemavathi2007', codechef: 'hemavathi2007' },
  { name: 'Prasanth', leetcode: 'FxfmPoyHI2', codechef: 's05_prasanth' },
  { name: 'Shruthi R', leetcode: 'Shruthi_2207', codechef: 'shruthi_r_2207' },
  { name: 'Indhumathi S', leetcode: 'indhu2808', codechef: 'indhu2808' },
  { name: 'Sasinathan.T', leetcode: 'sasinathanT', codechef: 'sasi_75' },
  { name: 'Janardhanan', leetcode: 'janarthanan-l-btcsbs25', codechef: 'jana_0327' },
  { name: 'Mohanavignesh N', leetcode: 'mohanavignesh07', codechef: 'mohan092007' },
  { name: 'Aathif ali', leetcode: 'Aathi_ali', codechef: 'aathif_ali_15' },
  { name: 'Shahin', leetcode: 'IdPdPWlsYJ', codechef: 'mohan092007' }
];

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
