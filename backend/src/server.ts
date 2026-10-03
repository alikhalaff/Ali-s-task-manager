import { app } from './app.js';
import { db } from './db.js';
import { config } from './config.js';
import { seedDemo } from './seed.js';

await db.$connect();
await seedDemo();
const server = app.listen(
  config.PORT,
  config.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1',
  () => console.log(`API listening on port ${config.PORT}`),
);
const cleanup = setInterval(
  () => {
    db.session
      .deleteMany({ where: { expiresAt: { lt: new Date() } } })
      .catch(() => console.error('Session cleanup failed'));
  },
  60 * 60 * 1000,
);
cleanup.unref();
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(cleanup);
  server.close(() => {
    db.$disconnect().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
