import 'dotenv/config';
import { defineConfig } from 'prisma/config';
import { databaseURL } from './src/database-url.js';
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: databaseURL() },
});
