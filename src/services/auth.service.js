const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { conflict, unauthorized } = require('../errors');

/** The only way a user leaves the API: drops password_hash and renames fields. */
const toPublicUser = (u) => ({ id: u.id, name: u.name, email: u.email, createdAt: u.created_at });

function createAuthService(repo, { jwtSecret }) {
  const sign = (u) => jwt.sign({ sub: u.id }, jwtSecret, { expiresIn: '1h' });

  return {
    async register({ name, email, password }) {
      if (repo.findUserByEmail(email)) throw conflict('Email is already registered');
      const passwordHash = await bcrypt.hash(password, 10);
      try {
        const user = repo.createUserWithWallet({ name, email, passwordHash });
        return { user: toPublicUser(user), token: sign(user) };
      } catch (err) {
        // Two signups with the same email can both pass the check above while bcrypt runs.
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') throw conflict('Email is already registered');
        throw err;
      }
    },

    async login({ email, password }) {
      const user = repo.findUserByEmail(email);
      const ok = user ? await bcrypt.compare(password, user.password_hash) : false;
      // Same 401 for unknown email and wrong password, so emails can't be enumerated.
      if (!user || !ok) throw unauthorized('Invalid email or password');
      return { token: sign(user) };
    },

    verify(token) {
      try {
        const payload = jwt.verify(token, jwtSecret);
        const user = repo.findUserById(String(payload.sub));
        if (!user) throw new Error('user gone');
        return toPublicUser(user);
      } catch {
        throw unauthorized();
      }
    },
  };
}

module.exports = { createAuthService, toPublicUser };
