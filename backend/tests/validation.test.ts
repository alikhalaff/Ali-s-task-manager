import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listSchema, registerSchema, taskSchema, updateTaskSchema } from '../src/validation.js';

test('calendar dates accept leap days and reject normalized or out-of-range dates', () => {
  for (const date of ['2024-02-29', '1000-01-01', '9999-12-31']) {
    assert.equal(taskSchema.parse({ title: 'Calendar', dueDate: date }).dueDate, date);
  }
  for (const date of ['2026-02-29', '2026-04-31', '0999-12-31', '2026-13-01', '2026-1-1']) {
    assert.equal(taskSchema.safeParse({ title: 'Calendar', dueDate: date }).success, false);
  }
});
test('create defaults cannot silently reset fields during a partial edit', () => {
  assert.deepEqual(updateTaskSchema.parse({ status: 'DONE' }), { status: 'DONE' });
  assert.deepEqual(updateTaskSchema.parse({ dueDate: null }), { dueDate: null });
  assert.equal(updateTaskSchema.safeParse({}).success, false);
  const created = taskSchema.parse({ title: 'Create' });
  assert.equal(created.priority, 'MEDIUM');
  assert.equal(created.status, 'TODO');
});
test('maximum task text lengths are enforced at the boundary', () => {
  assert.equal(
    taskSchema.safeParse({ title: 'a'.repeat(200), description: 'b'.repeat(5000) }).success,
    true,
  );
  assert.equal(taskSchema.safeParse({ title: 'a'.repeat(201) }).success, false);
  assert.equal(
    taskSchema.safeParse({ title: 'Valid', description: 'b'.repeat(5001) }).success,
    false,
  );
});
test('pagination rejects negatives, fractions, arrays, oversized pages and untrusted sorting', () => {
  for (const query of [
    { page: '-1' },
    { page: '1.5' },
    { page: ['1', '2'] },
    { pageSize: '101' },
    { sortBy: 'userId' },
    { order: 'desc;DROP TABLE Task' },
  ]) {
    assert.equal(listSchema.safeParse(query).success, false);
  }
  assert.equal(listSchema.parse({ page: '2', pageSize: '20' }).page, 2);
});
test('registration normalizes identity fields while preserving password characters', () => {
  const user = registerSchema.parse({
    name: '  Example User  ',
    email: ' USER@EXAMPLE.COM ',
    password: '  LongPassword!123  ',
  });
  assert.equal(user.name, 'Example User');
  assert.equal(user.email, 'user@example.com');
  assert.equal(user.password, '  LongPassword!123  ');
  assert.equal(registerSchema.safeParse({ ...user, role: 'admin' }).success, false);
});

test('new accounts require 15 to 128 password characters without truncation', () => {
  const user = { name: 'Password Tester', email: 'password@example.com' };
  assert.equal(registerSchema.safeParse({ ...user, password: 'a'.repeat(14) }).success, false);
  assert.equal(registerSchema.safeParse({ ...user, password: 'a'.repeat(15) }).success, true);
  assert.equal(registerSchema.safeParse({ ...user, password: 'a'.repeat(128) }).success, true);
  assert.equal(registerSchema.safeParse({ ...user, password: 'a'.repeat(129) }).success, false);
});
