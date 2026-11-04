const express = require('express');
const { openDatabase } = require('./db/database');
const { createRepository } = require('./db/repository');
const { createAuthService } = require('./services/auth.service');
const { createWalletService } = require('./services/wallet.service');
const { requireAuth, rateLimit, notFoundHandler, errorHandler } = require('./middleware');
const { registerSchema, loginSchema, paginationSchema, parse, parseAmount } = require('./validation');

function createApp({
  db = openDatabase(),
  jwtSecret = process.env.JWT_SECRET || 'dev-secret',
  loginRateLimit = { windowMs: 60_000, max: 10 },
} = {}) {
  const repo = createRepository(db);
  const auth = createAuthService(repo, { jwtSecret });
  const wallet = createWalletService(repo);

  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.post('/auth/register', async (req, res) => {
    res.status(201).json(await auth.register(parse(registerSchema, req.body)));
  });
  app.post('/auth/login', rateLimit(loginRateLimit), async (req, res) => {
    res.json(await auth.login(parse(loginSchema, req.body)));
  });
  app.get('/auth/me', requireAuth(auth), (req, res) => res.json({ user: req.user }));

  const w = express.Router();
  w.use(requireAuth(auth));
  w.get('/', (req, res) => res.json(wallet.getBalance(req.user.id)));
  w.post('/deposit', (req, res) => res.json(wallet.deposit(req.user.id, parseAmount(req.body?.amount))));
  w.post('/withdraw', (req, res) => res.json(wallet.withdraw(req.user.id, parseAmount(req.body?.amount))));
  w.post('/transfer', (req, res) => {
    const { replayed, ...result } = wallet.transfer(
      req.user, req.body?.toEmail, parseAmount(req.body?.amount), req.get('Idempotency-Key'));
    res.status(replayed ? 200 : 201).json(result);
  });
  w.get('/transactions', (req, res) => res.json(wallet.listTransactions(req.user.id, paginationSchema.parse(req.query))));
  app.use('/wallet', w);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
