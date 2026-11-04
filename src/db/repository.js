const { randomUUID } = require('node:crypto');

/** Every SQL query lives here. Statements are prepared once and reused. */
function createRepository(db) {
  const stmt = {
    insertUser: db.prepare(
      'INSERT INTO users (id, name, email, password_hash, created_at) VALUES (@id, @name, @email, @password_hash, @created_at)'),
    insertWallet: db.prepare('INSERT INTO wallets (user_id, balance) VALUES (?, 0)'),
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  };

  return {
    transaction: (fn) => db.transaction(fn)(),

    createUserWithWallet({ name, email, passwordHash }) {
      const row = { id: randomUUID(), name, email, password_hash: passwordHash, created_at: new Date().toISOString() };
      db.transaction(() => {
        stmt.insertUser.run(row);
        stmt.insertWallet.run(row.id);
      })();
      return row;
    },
    findUserByEmail: (email) => stmt.userByEmail.get(email),
    findUserById: (id) => stmt.userById.get(id),
  };
}

module.exports = { createRepository };
