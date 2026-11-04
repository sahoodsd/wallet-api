const { badRequest, notFound, unprocessable } = require('../errors');
const { toMajor } = require('../validation');

const CURRENCY = 'AED';

/** API shape of a transaction row. Money leaves the API as "50.00" strings. */
const txView = (t) => ({
  id: t.id,
  type: t.type,
  amount: toMajor(t.amount),
  balanceAfter: toMajor(t.balance_after),
  counterparty: t.counterparty,
  createdAt: t.created_at,
});

function createWalletService(repo) {
  const balanceView = (userId) => ({ balance: toMajor(repo.getBalance(userId)), currency: CURRENCY });

  return {
    getBalance: balanceView,

    deposit(userId, amount) {
      return repo.transaction(() => {
        repo.credit(userId, amount);
        const tx = repo.addTransaction({ userId, type: 'DEPOSIT', amount, balanceAfter: repo.getBalance(userId) });
        return { ...balanceView(userId), transaction: txView(tx) };
      });
    },

    withdraw(userId, amount) {
      return repo.transaction(() => {
        if (!repo.debit(userId, amount)) throw unprocessable('INSUFFICIENT_FUNDS', 'Balance is too low');
        const tx = repo.addTransaction({ userId, type: 'WITHDRAWAL', amount, balanceAfter: repo.getBalance(userId) });
        return { ...balanceView(userId), transaction: txView(tx) };
      });
    },

    /**
     * Moves money between two wallets in one SQLite transaction: if anything throws,
     * the debit is rolled back too, so money is never lost or created halfway.
     */
    transfer(from, toEmail, amount) {
      if (typeof toEmail !== 'string' || !toEmail.trim()) throw badRequest('toEmail is required');

      return repo.transaction(() => {
        const recipient = repo.findUserByEmail(toEmail.trim().toLowerCase());
        if (!recipient) throw notFound('Recipient not found');
        if (recipient.id === from.id) throw badRequest('Cannot transfer to yourself');

        if (!repo.debit(from.id, amount)) throw unprocessable('INSUFFICIENT_FUNDS', 'Balance is too low');
        repo.credit(recipient.id, amount);

        const out = repo.addTransaction({
          userId: from.id, type: 'TRANSFER_OUT', amount,
          balanceAfter: repo.getBalance(from.id), counterparty: recipient.email,
        });
        repo.addTransaction({
          userId: recipient.id, type: 'TRANSFER_IN', amount,
          balanceAfter: repo.getBalance(recipient.id), counterparty: from.email,
        });

        return { ...balanceView(from.id), transaction: txView(out) };
      });
    },

    listTransactions(userId, { page, limit }) {
      const { rows, total } = repo.listTransactions(userId, limit, (page - 1) * limit);
      return { data: rows.map(txView), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
    },
  };
}

module.exports = { createWalletService };
