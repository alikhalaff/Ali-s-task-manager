import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { db } from '../src/db.js';
import { config } from '../src/config.js';

const userCount = 200;
const tasksPerUser = 20;
const emailSuffix = '@stress.taskflow.local';
if (new URL(config.DATABASE_URL).pathname !== '/taskmanager_stress') {
  throw new Error('Stress fixtures only run against the isolated taskmanager_stress database');
}

async function seed() {
  // Only reset this suite's fixture accounts; never other users' records.
  await db.user.deleteMany({ where: { email: { endsWith: emailSuffix } } });
  const passwordHash = await argon2.hash('LoadtestOnly!2026', {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  const users = Array.from({ length: userCount }, (_, index) => ({
    id: randomUUID(),
    name: `Load user ${index + 1}`,
    email: `load-${index + 1}${emailSuffix}`,
    passwordHash,
  }));
  await db.user.createMany({ data: users });
  const tasks = users.flatMap((user) =>
    Array.from({ length: tasksPerUser }, (_, index) => ({
      id: randomUUID(),
      userId: user.id,
      title: `Fixture task ${String(index + 1).padStart(2, '0')}`,
      description: 'Baseline record for pagination, filtering, and ownership checks during load.',
      status: (['TODO', 'IN_PROGRESS', 'DONE'] as const)[index % 3],
      priority: (['LOW', 'MEDIUM', 'HIGH'] as const)[index % 3],
      dueDate: index % 2 ? new Date('2026-01-15T00:00:00Z') : null,
    })),
  );
  await db.task.createMany({ data: tasks });
  console.log(JSON.stringify({ users: userCount, baselineTasks: tasks.length }));
}

async function verify() {
  const users = await db.user.findMany({
    where: { email: { endsWith: emailSuffix } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);
  const tasks = await db.task.count({ where: { userId: { in: userIds } } });
  const leftovers = await db.task.count({
    where: { userId: { in: userIds }, title: { startsWith: 'Load journey ' } },
  });
  const sessions = await db.session.findMany({ select: { data: true } });
  const activeLoadSessions = sessions.filter((record) =>
    userIds.includes(JSON.parse(record.data).userId),
  ).length;
  const passed =
    users.length === userCount &&
    tasks === userCount * tasksPerUser &&
    leftovers === 0 &&
    activeLoadSessions === 0;
  console.log(
    JSON.stringify({
      passed,
      users: users.length,
      baselineTasks: tasks,
      leftoverJourneyTasks: leftovers,
      activeLoadSessions,
    }),
  );
  if (!passed) throw new Error('Post-load fixture/session integrity failed');
}

try {
  if (process.argv[2] === 'seed') await seed();
  else if (process.argv[2] === 'verify') await verify();
  else throw new Error('Choose seed or verify');
} finally {
  await db.$disconnect();
}
