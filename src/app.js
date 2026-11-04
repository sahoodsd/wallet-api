const express = require('express');
const { openDatabase } = require('./db/database');
const { createRepository } = require('./db/repository');
const { createAuthService } = require('./services/auth.service');
const { requireAuth, notFoundHandler, errorHandler } = require('./middleware');
const { registerSchema, loginSchema, parse } = require('./validation');

function createApp({ db = openDatabase(), jwtSecret = process.env.JWT_SECRET || 'dev-secret' } = {}) {
  const repo = createRepository(db);
  const auth = createAuthService(repo, { jwtSecret });

  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.post('/auth/register', async (req, res) => {
    res.status(201).json(await auth.register(parse(registerSchema, req.body)));
  });
  app.post('/auth/login', async (req, res) => {
    res.json(await auth.login(parse(loginSchema, req.body)));
  });
  app.get('/auth/me', requireAuth(auth), (req, res) => res.json({ user: req.user }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
