import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fetchLeetCodeStats(handle: string) {
  const query = `
    query getUserProfile($username: String!) {
      matchedUser(username: $username) {
        submitStats {
          acSubmissionNum {
            difficulty
            count
          }
        }
      }
    }
  `;
  try {
    const response = await fetch('https://leetcode.com/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { username: handle } }),
    });
    const data = (await response.json()) as any;
    const allStats = data?.data?.matchedUser?.submitStats?.acSubmissionNum?.find((x: any) => x.difficulty === 'All');
    const totalSolved = allStats?.count || 0;
    
    // Note: Leetcode does not provide streak directly via simple GraphQL. 
    // It requires parsing submissionCalendar. Using 0 as a placeholder.
    return { totalSolved, streak: 0 };
  } catch (e) {
    console.error(`Error fetching LeetCode for ${handle}:`, e);
    return { totalSolved: 0, streak: 0 };
  }
}

async function fetchCodeChefStats(handle: string) {
  // CodeChef doesn't have an official API, usually people parse HTML using Cheerio or similar.
  // Using a placeholder here.
  return { totalSolved: 0, streak: 0 };
}

async function main() {
  console.log('Fetching stats for all students...');
  const students = await prisma.student.findMany();

  for (const student of students) {
    let totalSolved = 0;
    let streak = 0;

    if (student.leetcodeHandle) {
      const lcStats = await fetchLeetCodeStats(student.leetcodeHandle);
      totalSolved += lcStats.totalSolved;
      streak = Math.max(streak, lcStats.streak); 
    }

    if (student.codechefHandle) {
      const ccStats = await fetchCodeChefStats(student.codechefHandle);
      totalSolved += ccStats.totalSolved;
      streak = Math.max(streak, ccStats.streak);
    }

    await prisma.dailyStat.create({
      data: {
        studentId: student.id,
        date: new Date(),
        totalSolved,
        streak,
      },
    });
    console.log(`Saved stats for ${student.name}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
