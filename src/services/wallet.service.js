const { unprocessable } = require('../errors');
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
  };
}

module.exports = { createWalletService };
