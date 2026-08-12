import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';

const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
const rawDbPath = dbUrl.startsWith('file:') ? dbUrl.substring(5) : dbUrl;
const adapter = new PrismaBetterSqlite3({ url: rawDbPath });
const prisma = new PrismaClient({ adapter });

// Load students list from external JSON file
const studentsListPath = process.env.STUDENTS_JSON_PATH || path.join(__dirname, 'students.json');
const studentsList: { name: string; leetcode: string; codechef: string | null }[] = JSON.parse(
  fs.readFileSync(studentsListPath, 'utf8')
);

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

async function main() {
  console.log(`Seeding database with ${studentsList.length} students from students.json...`);
  let count = 0;
  for (const s of studentsList) {
    count++;
    console.log(`[${count}/${studentsList.length}] Upserting & fetching stats for ${s.name}...`);
    
    const student = await prisma.student.upsert({
      where: { leetcodeHandle: s.leetcode },
      update: {
        codechefHandle: s.codechef
      },
      create: {
        name: s.name,
        leetcodeHandle: s.leetcode,
        codechefHandle: s.codechef
      }
    });

    // Fetch LeetCode and CodeChef stats
    const lcStats = await fetchLeetCodeStats(s.leetcode);
    const ccSolved = await fetchCodeChefStats(s.codechef);

    if (lcStats) {
      await prisma.dailyStat.create({
        data: {
          studentId: student.id,
          streak: lcStats.streak,
          totalSolved: lcStats.totalSolved,
          easy: lcStats.easy,
          medium: lcStats.medium,
          hard: lcStats.hard,
          solvedToday: lcStats.solvedToday,
          codechefSolved: ccSolved
        }
      });
      console.log(`  -> LeetCode: ${lcStats.totalSolved} (Streak: ${lcStats.streak}), CodeChef: ${ccSolved}`);
    } else {
      // Create empty stats or only CodeChef stats if LeetCode fails
      await prisma.dailyStat.create({
        data: {
          studentId: student.id,
          streak: 0,
          totalSolved: 0,
          easy: 0,
          medium: 0,
          hard: 0,
          solvedToday: 0,
          codechefSolved: ccSolved
        }
      });
      console.log(`  -> LeetCode failed, CodeChef: ${ccSolved}`);
    }

    // Sleep briefly to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  console.log('Database seeded successfully.');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
