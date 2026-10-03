import 'dotenv/config';
import { databaseURL } from './database-url.js';
import { environmentSchema } from './environment.js';

const parsed = environmentSchema.safeParse({ ...process.env, DATABASE_URL: databaseURL() });
if (!parsed.success) {
  // Print field names, never secret values.
  throw new Error(
    `Invalid environment: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
  );
}
export const config = parsed.data;
export const publicOrigin = new URL(config.PUBLIC_ORIGIN).origin;
export const sessionLifetime = 1000 * 60 * 60 * 24;
