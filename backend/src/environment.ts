import { z } from 'zod';

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    DATABASE_URL: z
      .string()
      .url()
      .refine((value) => value.startsWith('mysql://'), 'Use a mysql:// connection URL'),
    SESSION_SECRET: z.string().min(32),
    PUBLIC_ORIGIN: z.string().url().default('http://localhost:8080'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    API_RATE_LIMIT: z.coerce.number().int().min(1).max(1000000).default(300),
    AUTH_RATE_LIMIT: z.coerce.number().int().min(1).max(1000000).default(20),
    COOKIE_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    SEED_DEMO: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  })
  .superRefine((value, context) => {
    let origin: URL;
    let database: URL;
    try {
      origin = new URL(value.PUBLIC_ORIGIN);
      database = new URL(value.DATABASE_URL);
    } catch {
      return;
    } // The field validators report invalid URLs.
    const issue = (path: string, message: string) =>
      context.addIssue({ code: 'custom', path: [path], message });
    if (
      !['http:', 'https:'].includes(origin.protocol) ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash
    ) {
      issue(
        'PUBLIC_ORIGIN',
        'Use an exact HTTP(S) origin without credentials, path, query or fragment',
      );
    }
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
    if (value.NODE_ENV !== 'production' || loopback) return;
    if (origin.protocol !== 'https:')
      issue('PUBLIC_ORIGIN', 'Public production deployments require HTTPS');
    if (!value.COOKIE_SECURE)
      issue('COOKIE_SECURE', 'Public production deployments require secure cookies');
    if (value.SEED_DEMO)
      issue('SEED_DEMO', 'Public production deployments must disable demo seeding');
    if (
      /^(local-development-secret|isolated-(test|stress)-session-secret)/.test(value.SESSION_SECRET)
    ) {
      issue('SESSION_SECRET', 'Replace the known demo/test session secret');
    }
    let password = '';
    try {
      password = decodeURIComponent(database.password);
    } catch {
      /* Invalid credential encoding. */
    }
    if (
      password.length < 16 ||
      ['isolated-stress-password', 'change_me_user', 'testpassword'].includes(password)
    ) {
      issue(
        'DATABASE_URL',
        'Public production deployments require a non-demo database password of at least 16 characters',
      );
    }
  });
