import argon2 from 'argon2';
import { db } from './db.js';
import { config } from './config.js';

export async function seedDemo() {
  if (!config.SEED_DEMO) return;
  const email = 'demo@taskflow.local';
  if (await db.user.findUnique({ where: { email } })) return;
  const passwordHash = await argon2.hash('TaskflowDemo!2026', {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  await db.user.create({
    data: {
      name: 'Alex Morgan',
      email,
      passwordHash,
      tasks: {
        create: [
          {
            title: 'Outline the next sprint',
            description:
              'Bring together the priorities for the team and agree on the next milestones.',
            status: 'IN_PROGRESS',
            priority: 'HIGH',
          },
          {
            title: 'Review the dashboard designs',
            description: 'Check the mobile layout and share feedback on the empty states.',
            status: 'TODO',
            priority: 'MEDIUM',
          },
          {
            title: 'Write the API documentation',
            description: 'Document authentication, validation, and task ownership.',
            status: 'TODO',
            priority: 'HIGH',
          },
          {
            title: 'Ship the first working prototype',
            description: 'A small milestone worth celebrating.',
            status: 'DONE',
            priority: 'MEDIUM',
          },
          {
            title: 'Schedule a team check-in',
            description: 'Make space to discuss blockers and progress.',
            status: 'TODO',
            priority: 'LOW',
          },
        ],
      },
    },
  });
}
if (process.argv[1]?.endsWith('seed.ts')) {
  seedDemo()
    .finally(() => db.$disconnect())
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
