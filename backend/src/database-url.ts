import 'dotenv/config';

// Compose supplies separate credentials so special characters stay intact.
export function databaseURL() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const { MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE, MYSQL_HOST = 'db' } = process.env;
  if (!MYSQL_USER || !MYSQL_PASSWORD || !MYSQL_DATABASE)
    throw new Error('Configure DATABASE_URL or the MySQL environment variables');
  return `mysql://${encodeURIComponent(MYSQL_USER)}:${encodeURIComponent(MYSQL_PASSWORD)}@${MYSQL_HOST}:3306/${encodeURIComponent(MYSQL_DATABASE)}`;
}
