import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import argon2 from 'argon2';
import { app } from '../src/app.js';
import { db } from '../src/db.js';
import { config } from '../src/config.js';

// Refuse destructive fixture cleanup against a developer or production database.
const database = new URL(config.DATABASE_URL).pathname.slice(1);
if (config.NODE_ENV !== 'test' || !database.endsWith('_test'))
  throw new Error('Tests require NODE_ENV=test and a database ending in _test');

const alice = request.agent(app);
const bob = request.agent(app);
let aliceCsrf = '';
let bobCsrf = '';
let taskId = '';
before(async () => {
  await db.session.deleteMany();
  await db.task.deleteMany();
  await db.user.deleteMany();
});
after(async () => {
  await db.session.deleteMany();
  await db.user.deleteMany();
  await db.$disconnect();
});

test('health endpoint verifies a real database connection', async () => {
  const response = await request(app).get('/api/health').expect(200);
  assert.equal(response.body.status, 'ok');
});
test('anonymous users cannot read tasks', async () => {
  await request(app).get('/api/tasks').expect(401);
  await request(app).post('/api/tasks').send({ title: 'Anonymous' }).expect(401);
});
test('CSRF protection rejects missing tokens and foreign origins', async () => {
  const response = await alice.get('/api/auth/session').expect(200);
  aliceCsrf = response.body.csrfToken;
  await alice.post('/api/auth/register').send({}).expect(403);
  await alice
    .post('/api/auth/register')
    .set('x-csrf-token', aliceCsrf)
    .set('Origin', 'https://foreign.example')
    .send({})
    .expect(403);
});
test('registration validates input and stores an Argon2id hash', async () => {
  await alice
    .post('/api/auth/register')
    .set('x-csrf-token', aliceCsrf)
    .send({ name: 'A', email: 'invalid', password: 'short' })
    .expect(422);
  const response = await alice
    .post('/api/auth/register')
    .set('x-csrf-token', aliceCsrf)
    .send({ name: 'Alice', email: 'ALICE@example.com', password: 'StrongPassword!123' })
    .expect(201);
  assert.equal(response.body.user.email, 'alice@example.com');
  assert.equal(response.body.user.passwordHash, undefined);
  assert.notEqual(response.body.csrfToken, aliceCsrf);
  aliceCsrf = response.body.csrfToken;
  const user = await db.user.findUniqueOrThrow({ where: { email: 'alice@example.com' } });
  assert.match(user.passwordHash, /^\$argon2id\$/);
  const cookies: string[] = response.headers['set-cookie'] as unknown as string[];
  assert.ok(
    cookies.some((cookie) => cookie.includes('HttpOnly') && cookie.includes('SameSite=Lax')),
  );
});
test('session restoration returns the authenticated user', async () => {
  const response = await alice.get('/api/auth/session').expect(200);
  assert.equal(response.body.user.name, 'Alice');
});
test('duplicate normalized email returns a helpful conflict', async () => {
  const session = await bob.get('/api/auth/session').expect(200);
  bobCsrf = session.body.csrfToken;
  await bob
    .post('/api/auth/register')
    .set('x-csrf-token', bobCsrf)
    .send({ name: 'Another Alice', email: 'alice@example.com', password: 'StrongPassword!123' })
    .expect(409);
  const registered = await bob
    .post('/api/auth/register')
    .set('x-csrf-token', bobCsrf)
    .send({ name: 'Bob', email: 'bob@example.com', password: 'StrongPassword!123' })
    .expect(201);
  bobCsrf = registered.body.csrfToken;
});
test('invalid tasks and owner injection are rejected without creating records', async () => {
  for (const body of [
    { title: '   ' },
    { title: 'Date', dueDate: '2026-02-30' },
    { title: 'Owner', userId: 'someone-else' },
    { title: 'Status', status: 'unknown' },
  ]) {
    await alice.post('/api/tasks').set('x-csrf-token', aliceCsrf).send(body).expect(422);
  }
  assert.equal(await db.task.count(), 0);
});
test('create and edit persist all task fields and calendar dates', async () => {
  const created = await alice
    .post('/api/tasks')
    .set('x-csrf-token', aliceCsrf)
    .send({
      title: '  Ship API  ',
      description: 'Write docs',
      priority: 'HIGH',
      dueDate: '2026-01-15',
    })
    .expect(201);
  taskId = created.body.id;
  assert.equal(created.body.title, 'Ship API');
  assert.equal(created.body.dueDate, '2026-01-15');
  const updated = await alice
    .patch(`/api/tasks/${taskId}`)
    .set('x-csrf-token', aliceCsrf)
    .send({ status: 'IN_PROGRESS', description: 'Ready for review' })
    .expect(200);
  assert.equal(updated.body.status, 'IN_PROGRESS');
  assert.equal(updated.body.title, 'Ship API');
  assert.equal(updated.body.priority, 'HIGH');
  assert.equal(updated.body.dueDate, '2026-01-15');
  await alice.patch(`/api/tasks/${taskId}`).set('x-csrf-token', aliceCsrf).send({}).expect(422);
  await alice.patch(`/api/tasks/${taskId}`).send({ title: 'Missing CSRF' }).expect(403);
  const persisted = await alice.get(`/api/tasks/${taskId}`).expect(200);
  assert.equal(persisted.body.description, 'Ready for review');
});
test('a second user cannot list, read, update, delete or count another user tasks', async () => {
  const list = await bob.get('/api/tasks').expect(200);
  assert.equal(list.body.total, 0);
  const summary = await bob.get('/api/tasks/summary').expect(200);
  assert.equal(summary.body.total, 0);
  await bob.get(`/api/tasks/${taskId}`).expect(404);
  await bob
    .patch(`/api/tasks/${taskId}`)
    .set('x-csrf-token', bobCsrf)
    .send({ title: 'Stolen' })
    .expect(404);
  await bob.delete(`/api/tasks/${taskId}`).set('x-csrf-token', bobCsrf).expect(404);
  assert.equal((await db.task.findUniqueOrThrow({ where: { id: taskId } })).title, 'Ship API');
});
test('filtering, pagination and summary use actual database results', async () => {
  await alice
    .post('/api/tasks')
    .set('x-csrf-token', aliceCsrf)
    .send({ title: 'Design home', status: 'DONE', priority: 'LOW' })
    .expect(201);
  const filtered = await alice
    .get('/api/tasks?search=ship&status=IN_PROGRESS&priority=HIGH')
    .expect(200);
  assert.equal(filtered.body.total, 1);
  assert.equal(filtered.body.items[0].id, taskId);
  const page = await alice.get('/api/tasks?page=2&pageSize=1&sortBy=title&order=asc').expect(200);
  assert.equal(page.body.total, 2);
  assert.equal(page.body.items.length, 1);
  assert.equal(page.body.items[0].title, 'Ship API');
  await alice.get('/api/tasks?pageSize=101').expect(422);
  await alice.get('/api/tasks?sortBy=passwordHash').expect(422);
  const summary = await alice.get('/api/tasks/summary').expect(200);
  assert.equal(summary.body.total, 2);
  assert.equal(summary.body.done, 1);
  assert.equal(summary.body.inProgress, 1);
  assert.equal(summary.body.overdue, 1);
});
test('delete removes the owned task and repeat deletion returns 404', async () => {
  await alice.delete(`/api/tasks/${taskId}`).set('x-csrf-token', aliceCsrf).expect(204);
  await alice.get(`/api/tasks/${taskId}`).expect(404);
  await alice.delete(`/api/tasks/${taskId}`).set('x-csrf-token', aliceCsrf).expect(404);
});
test('logout invalidates the old session and login rejects incorrect credentials', async () => {
  const session = await alice.get('/api/auth/session').expect(200);
  const cookies: string[] = session.headers['set-cookie'] as unknown as string[];
  const oldCookie = cookies[0].split(';')[0];
  await alice.post('/api/auth/logout').set('x-csrf-token', aliceCsrf).expect(204);
  await request(app).get('/api/tasks').set('Cookie', oldCookie).expect(401);
  await request(app)
    .post('/api/tasks')
    .set('Cookie', oldCookie)
    .set('x-csrf-token', aliceCsrf)
    .send({ title: 'Revoked session' })
    .expect(401);
  const anonymous = await alice.get('/api/auth/session').expect(200);
  assert.equal(anonymous.body.user, null);
  aliceCsrf = anonymous.body.csrfToken;
  await alice
    .post('/api/auth/login')
    .set('x-csrf-token', aliceCsrf)
    .send({ email: 'alice@example.com', password: 'WrongPassword!123' })
    .expect(401);
  await alice
    .post('/api/auth/login')
    .set('x-csrf-token', aliceCsrf)
    .send({ email: 'alice@example.com', password: 'StrongPassword!123' })
    .expect(200);
});

test('expired persisted sessions lose access and are removed', async () => {
  const user = await db.user.findUniqueOrThrow({ where: { email: 'bob@example.com' } });
  const sessions = await db.session.findMany();
  const owned = sessions.filter((record) => JSON.parse(record.data).userId === user.id);
  assert.equal(owned.length, 1);
  await db.session.update({ where: { id: owned[0].id }, data: { expiresAt: new Date(0) } });
  await bob.get('/api/tasks').expect(401);
  assert.equal(await db.session.count({ where: { id: owned[0].id } }), 0);
  const restored = await bob.get('/api/auth/session').expect(200);
  assert.equal(restored.body.user, null);
});

test('malformed JSON and excessive payloads return controlled client errors', async () => {
  await request(app)
    .post('/api/tasks')
    .set('Content-Type', 'application/json')
    .send('{broken')
    .expect(400);
  await request(app)
    .post('/api/tasks')
    .send({ title: 'x'.repeat(200000) })
    .expect(413);
});

test('concurrent task creation has unique IDs and persists each owned record', async () => {
  const session = await alice.get('/api/auth/session').expect(200);
  const csrf = session.body.csrfToken;
  const responses = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      alice
        .post('/api/tasks')
        .set('x-csrf-token', csrf)
        .send({ title: `Concurrent ${index}` })
        .expect(201),
    ),
  );
  const ids = responses.map((response) => response.body.id);
  assert.equal(new Set(ids).size, 8);
  const user = await db.user.findUniqueOrThrow({ where: { email: 'alice@example.com' } });
  assert.equal(await db.task.count({ where: { id: { in: ids }, userId: user.id } }), 8);
  const other = await bob.get('/api/tasks').expect(401);
  assert.equal(other.body.code, 'UNAUTHENTICATED');
});

test('unknown and known failed logins both perform Argon2 verification and return identical errors', async (context) => {
  const agent = request.agent(app);
  const session = await agent.get('/api/auth/session').expect(200);
  const verifier = context.mock.method(argon2, 'verify');
  const responses = [];
  for (const email of ['alice@example.com', 'missing@example.com']) {
    responses.push(
      await agent
        .post('/api/auth/login')
        .set('x-csrf-token', session.body.csrfToken)
        .send({ email, password: 'WrongPassword!123' })
        .expect(401),
    );
  }
  assert.equal(verifier.mock.callCount(), 2);
  for (const call of verifier.mock.calls)
    assert.match(call.arguments[0] as string, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  assert.deepEqual(responses[0].body, responses[1].body);
});

test('login rotates both session ID and CSRF token, revoking the pre-login cookie', async () => {
  const agent = request.agent(app);
  const beforeLogin = await agent.get('/api/auth/session').expect(200);
  const oldCookie = (beforeLogin.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
  const loggedIn = await agent
    .post('/api/auth/login')
    .set('x-csrf-token', beforeLogin.body.csrfToken)
    .send({ email: 'alice@example.com', password: 'StrongPassword!123' })
    .expect(200);
  const newCookie = (loggedIn.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
  assert.notEqual(newCookie, oldCookie);
  assert.notEqual(loggedIn.body.csrfToken, beforeLogin.body.csrfToken);
  await request(app).get('/api/tasks').set('Cookie', oldCookie).expect(401);
  await agent
    .post('/api/tasks')
    .set('x-csrf-token', beforeLogin.body.csrfToken)
    .send({ title: 'Stale token' })
    .expect(403);
  await agent.post('/api/auth/logout').set('x-csrf-token', loggedIn.body.csrfToken).expect(204);
});

test('SQL-looking text remains data, with owner scoping intact', async () => {
  const current = await alice.get('/api/auth/session').expect(200);
  const title = "' OR 1=1; DROP TABLE Task; --";
  const created = await alice
    .post('/api/tasks')
    .set('x-csrf-token', current.body.csrfToken)
    .send({ title })
    .expect(201);
  const found = await alice.get('/api/tasks').query({ search: title }).expect(200);
  assert.equal(found.body.total, 1);
  assert.equal(found.body.items[0].id, created.body.id);
  assert.equal((await alice.get(`/api/tasks/${created.body.id}`).expect(200)).body.title, title);
  await alice
    .delete(`/api/tasks/${created.body.id}`)
    .set('x-csrf-token', current.body.csrfToken)
    .expect(204);
});
