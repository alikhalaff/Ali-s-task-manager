import { test } from 'node:test';
import assert from 'node:assert/strict';
import { environmentSchema } from '../src/environment.js';

const publicConfig = {
  NODE_ENV: 'production',
  DATABASE_URL: 'mysql://app:A-random-example-password-123@db:3306/tasks',
  SESSION_SECRET: 'example-test-fixture-secret-at-least-48-characters',
  PUBLIC_ORIGIN: 'https://tasks.example.com',
  COOKIE_SECURE: 'true',
  SEED_DEMO: 'false',
};
test('public production configuration rejects each unsafe deployment setting', () => {
  assert.equal(environmentSchema.safeParse(publicConfig).success, true);
  for (const unsafe of [
    { PUBLIC_ORIGIN: 'http://tasks.example.com' },
    { COOKIE_SECURE: 'false' },
    { SEED_DEMO: 'true' },
    { SESSION_SECRET: 'local-development-secret-change-me-at-least-32-characters' },
    { DATABASE_URL: 'mysql://app:change_me_user@db:3306/tasks' },
    { DATABASE_URL: 'mysql://app:isolated-stress-password@db:3306/tasks' },
  ])
    assert.equal(environmentSchema.safeParse({ ...publicConfig, ...unsafe }).success, false);
});
test('loopback demos work, while lookalike domains cannot bypass production guards', () => {
  const demo = {
    ...publicConfig,
    PUBLIC_ORIGIN: 'http://localhost:8080',
    COOKIE_SECURE: 'false',
    SEED_DEMO: 'true',
  };
  assert.equal(environmentSchema.safeParse(demo).success, true);
  for (const origin of [
    'http://localhost.attacker.example',
    'http://127.0.0.1.attacker.example',
    'http://192.0.2.10',
  ]) {
    assert.equal(environmentSchema.safeParse({ ...demo, PUBLIC_ORIGIN: origin }).success, false);
  }
});
test('public origin rejects credentials, non-web schemes, paths, queries and fragments', () => {
  for (const origin of [
    'ftp://tasks.example.com',
    'https://user:pass@tasks.example.com',
    'https://tasks.example.com/login',
    'https://tasks.example.com?x=1',
    'https://tasks.example.com#fragment',
  ]) {
    assert.equal(
      environmentSchema.safeParse({ ...publicConfig, PUBLIC_ORIGIN: origin }).success,
      false,
    );
  }
});
