const { randomUUID } = require('node:crypto');

/** Every SQL query lives here. Statements are prepared once and reused. */
function createRepository(db) {
  const stmt = {
    insertUser: db.prepare(
      'INSERT INTO users (id, name, email, password_hash, created_at) VALUES (@id, @name, @email, @password_hash, @created_at)'),
    insertWallet: db.prepare('INSERT INTO wallets (user_id, balance) VALUES (?, 0)'),
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),

    balance: db.prepare('SELECT balance FROM wallets WHERE user_id = ?'),
    credit: db.prepare('UPDATE wallets SET balance = balance + ? WHERE user_id = ?'),
    // Checks and subtracts in one statement: no gap for another request to overdraw.
    debit: db.prepare('UPDATE wallets SET balance = balance - @amount WHERE user_id = @userId AND balance >= @amount'),
    nextSeq: db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM transactions'),
    insertTx: db.prepare(`INSERT INTO transactions (id, seq, user_id, type, amount, balance_after, counterparty, created_at)
      VALUES (@id, @seq, @user_id, @type, @amount, @balance_after, @counterparty, @created_at)`),
    txById: db.prepare('SELECT * FROM transactions WHERE id = ?'),
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

    getBalance: (userId) => stmt.balance.get(userId)?.balance ?? 0,
    credit: (userId, amount) => stmt.credit.run(amount, userId),
    /** Returns false (and changes nothing) if the balance is too low. */
    debit: (userId, amount) => stmt.debit.run({ amount, userId }).changes === 1,
    addTransaction({ userId, type, amount, balanceAfter, counterparty = null }) {
      const row = {
        id: randomUUID(), seq: stmt.nextSeq.get().seq, user_id: userId, type, amount,
        balance_after: balanceAfter, counterparty, created_at: new Date().toISOString(),
      };
      stmt.insertTx.run(row);
      return stmt.txById.get(row.id);
    },
  };
}

module.exports = { createRepository };
