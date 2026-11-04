const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { openDatabase } = require('../src/db/database');
const { parseAmount } = require('../src/validation');

let app;
let db;
beforeEach(() => {
  db = openDatabase(':memory:');
  app = createApp({ db, jwtSecret: 'test' });
});

async function signup(email = 'a@x.com') {
  const res = await request(app).post('/auth/register').send({ name: 'User', email, password: 'password123' });
  assert.equal(res.status, 201);
  return { Authorization: `Bearer ${res.body.token}` };
}
const balanceOf = async (auth) => (await request(app).get('/wallet').set(auth)).body.balance;

test('register, login and a protected route', async () => {
  await signup('ali@x.com');
  const dup = await request(app).post('/auth/register').send({ name: 'Ali', email: 'ALI@x.com', password: 'password123' });
  assert.equal(dup.status, 409);

  const wrong = await request(app).post('/auth/login').send({ email: 'ali@x.com', password: 'nope-nope' });
  assert.equal(wrong.status, 401);

  const ok = await request(app).post('/auth/login').send({ email: 'ali@x.com', password: 'password123' });
  assert.equal(ok.status, 200);
  const me = await request(app).get('/auth/me').set({ Authorization: `Bearer ${ok.body.token}` });
  assert.equal(me.body.user.email, 'ali@x.com');
  assert.equal(me.body.user.password_hash, undefined);

  assert.equal((await request(app).get('/wallet')).status, 401);
});

test('register reports every invalid field at once', async () => {
  const res = await request(app).post('/auth/register').send({ name: '', email: 'bad', password: 'short' });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body.error.details.errors.map((e) => e.field), ['name', 'email', 'password']);
});

test('invalid JSON and unknown routes return the JSON error shape', async () => {
  const bad = await request(app).post('/auth/login').set('Content-Type', 'application/json').send('{bad');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'INVALID_JSON');
  const missing = await request(app).get('/nope');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'NOT_FOUND');
});

test('parseAmount uses exact minor units and rejects bad input', () => {
  assert.equal(parseAmount('19.99'), 1999);
  assert.equal(parseAmount(0.1), 10);
  for (const bad of ['-1', '1.234', 'abc', '0', true, null, undefined, {}, '100000.01']) {
    assert.throws(() => parseAmount(bad), { status: 400 });
  }
});

test('decimal math: 0.1 + 0.2 gives "0.30"', async () => {
  const auth = await signup();
  await request(app).post('/wallet/deposit').set(auth).send({ amount: 0.1 });
  await request(app).post('/wallet/deposit').set(auth).send({ amount: '0.2' });
  assert.equal(await balanceOf(auth), '0.30');
});

test('overdraw gives 422 and keeps the balance', async () => {
  const auth = await signup();
  await request(app).post('/wallet/deposit').set(auth).send({ amount: 50 });
  const res = await request(app).post('/wallet/withdraw').set(auth).send({ amount: 60 });
  assert.equal(res.status, 422);
  assert.equal(res.body.error.code, 'INSUFFICIENT_FUNDS');
  assert.equal(await balanceOf(auth), '50.00');
});

test('transfer moves money between two users and records both sides', async () => {
  const alice = await signup('alice@x.com');
  const bob = await signup('bob@x.com');
  await request(app).post('/wallet/deposit').set(alice).send({ amount: 100 });

  const res = await request(app).post('/wallet/transfer').set(alice).send({ toEmail: 'BOB@x.com', amount: '40.50' });
  assert.equal(res.status, 201);
  assert.equal(res.body.balance, '59.50');
  assert.equal(await balanceOf(bob), '40.50');

  const bobHistory = (await request(app).get('/wallet/transactions').set(bob)).body;
  assert.equal(bobHistory.data[0].type, 'TRANSFER_IN');
  assert.equal(bobHistory.data[0].counterparty, 'alice@x.com');
  const aliceHistory = (await request(app).get('/wallet/transactions').set(alice)).body;
  assert.deepEqual(aliceHistory.data.map((t) => t.type), ['TRANSFER_OUT', 'DEPOSIT']);
});

test('failed transfers change nothing', async () => {
  const alice = await signup('alice@x.com');
  await signup('bob@x.com');
  await request(app).post('/wallet/deposit').set(alice).send({ amount: 10 });

  const cases = [
    [{ toEmail: 'alice@x.com', amount: 1 }, 400],
    [{ toEmail: 'ghost@x.com', amount: 1 }, 404],
    [{ toEmail: 123, amount: 1 }, 400],
    [{ toEmail: 'bob@x.com', amount: 11 }, 422],
  ];
  for (const [body, status] of cases) {
    assert.equal((await request(app).post('/wallet/transfer').set(alice).send(body)).status, status);
  }
  assert.equal(await balanceOf(alice), '10.00');
  assert.equal((await request(app).get('/wallet/transactions').set(alice)).body.pagination.total, 1);
});

test('the same idempotency key does not move money twice', async () => {
  const alice = await signup('alice@x.com');
  const bob = await signup('bob@x.com');
  await request(app).post('/wallet/deposit').set(alice).send({ amount: 100 });

  const send = () => request(app).post('/wallet/transfer').set(alice)
    .set('Idempotency-Key', 'key-1').send({ toEmail: 'bob@x.com', amount: 25 });
  const first = await send();
  const second = await send();
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.deepEqual(second.body, first.body);
  assert.equal(await balanceOf(alice), '75.00');
  assert.equal(await balanceOf(bob), '25.00');
});

test('history paginates newest first', async () => {
  const auth = await signup();
  for (const amount of [1, 2, 3]) await request(app).post('/wallet/deposit').set(auth).send({ amount });

  const page2 = (await request(app).get('/wallet/transactions?page=2&limit=2').set(auth)).body;
  assert.deepEqual(page2.pagination, { page: 2, limit: 2, total: 3, totalPages: 2 });
  assert.deepEqual(page2.data.map((t) => t.amount), ['1.00']);

  const fallback = (await request(app).get('/wallet/transactions?page=-3&limit=abc').set(auth)).body;
  assert.deepEqual([fallback.pagination.page, fallback.pagination.limit], [1, 10]);
});

test('login is rate limited after 10 attempts a minute', async () => {
  for (let i = 0; i < 10; i++) {
    assert.equal((await request(app).post('/auth/login').send({ email: 'x@x.com', password: 'whatever' })).status, 401);
  }
  const blocked = await request(app).post('/auth/login').send({ email: 'x@x.com', password: 'whatever' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, 'TOO_MANY_REQUESTS');
});

test('the database refuses a negative balance even if code is wrong', async () => {
  await signup();
  assert.throws(() => db.prepare('UPDATE wallets SET balance = -1').run(), { code: 'SQLITE_CONSTRAINT_CHECK' });
});
