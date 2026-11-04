const express = require('express');
const { openDatabase } = require('./db/database');
const { notFoundHandler, errorHandler } = require('./middleware');

function createApp({ db = openDatabase(), jwtSecret = process.env.JWT_SECRET || 'dev-secret' } = {}) {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
