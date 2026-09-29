const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.use({ timezoneId: 'America/Sao_Paulo' });

// 35. Modal de pagamento da fatura (total ou parcial). Somente UI nova;
// a lógica financeira permanece em payCardInvoice/payCardAmount.

const FIXED_NOW = new Date('2026-09-25T12:00:00-03:00');

test.describe('35. Pagamento total ou parcial da fatura', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.clock.install({ time: FIXED_NOW });
    await page.reload();
    await login(page);
    await expect(page.locator('#tabDashboard')).toBeVisible();
  });

  async function setupBank(page, balance) {
    await page.evaluate((bal) => {
      const uid = window.linsoraStore.state.user.id;
      window.linsoraStore.state.accounts = [{ id: 'acc1', userId: uid, balance: bal, name: 'Conta Principal' }];
      window.linsoraStore.state.transactions = [];
      window.linsoraStore.state.cards = [];
      window.linsoraStore.state.occurrences = [];
      window.linsoraStore.state.recurringBills = [];
      window.selectedCardId = null;
      window.linsoraStore.persistState();
    }, balance);
  }

  async function addCard(page, name, limitTotal) {
    await page.evaluate(async ({ name, limitTotal }) => {
      await window.linsoraStore.addCard({ name, brand: name, limitTotal, closingDay: 15, dueDay: 22 });
      await new Promise((r) => setTimeout(r, 5));
    }, { name, limitTotal });
  }

  async function purchase(page, amount) {
    await page.evaluate(async (amount) => {
      const card = window.linsoraStore.state.cards.find((c) => c.name === 'Nubank');
      await window.linsoraStore.addCardPurchase({
        amount, description: 'Compra X', category: 'Compras', date: '2026-09-25', card,
      });
    }, amount);
  }

  async function openCardsWithDebt(page, amount) {
    await setupBank(page, 500000);
    await addCard(page, 'Nubank', 500000);
    await purchase(page, amount);
    await page.evaluate(() => window.switchTab('tabCards'));
    await expect(page.locator('#tabCards')).toBeVisible();
    await page.evaluate(() => {
      const card = window.linsoraStore.state.cards.find((c) => c.name === 'Nubank');
      window.LinsoraUI.selectCard(card.id);
    });
  }

  async function snapshot(page) {
    return page.evaluate(() => {
      const card = window.linsoraStore.state.cards.find((c) => c.name === 'Nubank');
      const acc = window.linsoraStore.state.accounts.find((a) => a.name === 'Conta Principal');
      const txs = window.linsoraStore.state.transactions.filter((t) => t.description === 'Pagamento da Fatura Nubank');
      return {
        used: card.limitUsed,
        available: Number(card.limitTotal) - Number(card.limitUsed),
        balance: acc.balance,
        payTxs: txs.length,
        tx: txs[0] ? { amount: txs[0].amount, cardId: txs[0].cardId, isCardPayment: ('isCardPayment' in txs[0]) ? txs[0].isCardPayment : null, account: txs[0].account } : null,
      };
    });
  }

  async function choosePartial(page, value) {
    await page.locator('input[name="payInvoiceType"][value="partial"]').check();
    await page.locator('#payInvoiceAmount').fill(value);
  }

  test('1. Clicar em Pagar fatura abre o modal com total e cartão', async ({ page }) => {
    await openCardsWithDebt(page, 500);
    await page.locator('#btnPayInvoice').click();
    await expect(page.locator('#modalPayInvoice')).not.toHaveClass(/hidden/);
    await expect(page.locator('#payInvoiceTotal')).toContainText('500,00');
    await expect(page.locator('#payInvoiceCard')).toContainText('Nubank');
    await expect(page.locator('input[name="payInvoiceType"][value="total"]')).toBeChecked();
  });

  test('2. Pagamento total de R$ 500 quita a fatura', async ({ page }) => {
    await openCardsWithDebt(page, 500);
    await page.locator('#btnPayInvoice').click();
    await page.locator('#btnPayInvoiceConfirm').click();
    await expect(page.locator('#modalPayInvoice')).toHaveClass(/hidden/);
    const s = await snapshot(page);
    expect(s.used).toBe(0);
    expect(s.balance).toBe(500000 - 500);
    expect(s.payTxs).toBe(1);
    expect(s.tx.amount).toBe(500);
  });

  test('3. Parcial R$ 100 em fatura de R$ 500: conta -100, usado 400, resta 400', async ({ page }) => {
    await openCardsWithDebt(page, 500);
    await page.locator('#btnPayInvoice').click();
    await choosePartial(page, '100');
    await expect(page.locator('#payInvoiceRemaining')).toContainText('400,00');
    await page.locator('#btnPayInvoiceConfirm').click();
    await expect(page.locator('#modalPayInvoice')).toHaveClass(/hidden/);
    const s = await snapshot(page);
    expect(s.balance).toBe(500000 - 100);
    expect(s.used).toBe(400);
    expect(s.available).toBe(500000 - 400);
    expect(s.payTxs).toBe(1);
    expect(s.tx.amount).toBe(100);
    const cardId = await page.evaluate(() => window.linsoraStore.state.cards.find((c) => c.name === 'Nubank').id);
    expect(s.tx.cardId).toBe(cardId);
    expect(s.tx.isCardPayment).toBe(true);
  });

  test('4. Parcial R$ 50 em fatura de R$ 500', async ({ page }) => {
    await openCardsWithDebt(page, 500);
    await page.locator('#btnPayInvoice').click();
    await choosePartial(page, '50');
    await page.locator('#btnPayInvoiceConfirm').click();
    const s = await snapshot(page);
    expect(s.used).toBe(450);
    expect(s.balance).toBe(500000 - 50);
    expect(s.payTxs).toBe(1);
    expect(s.tx.isCardPayment).toBe(true);
  });

  test('5. Parcial R$ 200 em fatura de R$ 500', async ({ page }) => {
    await openCardsWithDebt(page, 500);
    await page.locator('#btnPayInvoice').click();
    await choosePartial(page, '200');
    await expect(page.locator('#payInvoiceRemaining')).toContainText('300,00');
    await page.locator('#btnPayInvoiceConfirm').click();
    const s = await snapshot(page);
    expect(s.used).toBe(300);
    expect(s.balance).toBe(500000 - 200);
    expect(s.payTxs).toBe(1);
  });

  test('6. Parcial igual à fatura (R$ 500) zera o utilizado', async ({ page }) => {
    await openCardsWithDebt(page, 500);
    await page.locator('#btnPayInvoice').click();
    await choosePartial(page, '500');
    await expect(page.locator('#payInvoiceRemaining')).toContainText('0,00');
    await page.locator('#btnPayInvoiceConfirm').click();
    const s = await snapshot(page);
    expect(s.used).toBe(0);
    expect(s.balance).toBe(500000 - 500);
    expect(s.payTxs).toBe(1);
  });

  test('7. Valor zero é rejeitado sem lançar', async ({ page }) => {
    await openCardsWithDebt(page, 500);
    await page.locator('#btnPayInvoice').click();
    await choosePartial(page, '0');
    await page.locator('#btnPayInvoiceConfirm').click();
    await expect(page.locator('#payInvoiceError')).toBeVisible();
    await expect(page.locator('#modalPayInvoice')).not.toHaveClass(/hidden/);
    const s = await snapshot(page);
    expect(s.used).toBe(500);
    expect(s.balance).toBe(500000);
    expect(s.payTxs).toBe(0);
  });

  test('8. Valor negativo é rejeitado sem lançar', async ({ page }) => {
    await openCardsWithDebt(page, 500);
    await page.locator('#btnPayInvoice').click();
    await choosePartial(page, '-50');
    await page.locator('#btnPayInvoiceConfirm').click();
    await expect(page.locator('#payInvoiceError')).toBeVisible();
    const s = await snapshot(page);
    expect(s.used).toBe(500);
    expect(s.balance).toBe(500000);
    expect(s.payTxs).toBe(0);
  });

  test('9. Campo vazio é rejeitado sem lançar', async ({ page }) => {
    await openCardsWithDebt(page, 500);
    await page.locator('#btnPayInvoice').click();
    await page.locator('input[name="payInvoiceType"][value="partial"]').check();
    await page.locator('#payInvoiceAmount').fill('');
    await page.locator('#btnPayInvoiceConfirm').click();
    await expect(page.locator('#payInvoiceError')).toBeVisible();
    const s = await snapshot(page);
    expect(s.used).toBe(500);
    expect(s.payTxs).toBe(0);
  });

  test('10. Valor maior que a fatura é rejeitado sem lançar', async ({ page }) => {
    await openCardsWithDebt(page, 500);
    await page.locator('#btnPayInvoice').click();
    await choosePartial(page, '600');
    await page.locator('#btnPayInvoiceConfirm').click();
    await expect(page.locator('#payInvoiceError')).toBeVisible();
    const s = await snapshot(page);
    expect(s.used).toBe(500);
    expect(s.balance).toBe(500000);
    expect(s.payTxs).toBe(0);
  });

  test('11. Fatura zerada: nenhum pagamento é lançado', async ({ page }) => {
    await setupBank(page, 500000);
    await addCard(page, 'Nubank', 500000);
    await page.evaluate(() => window.switchTab('tabCards'));
    await expect(page.locator('#tabCards')).toBeVisible();
    await page.evaluate(() => {
      const card = window.linsoraStore.state.cards.find((c) => c.name === 'Nubank');
      window.LinsoraUI.selectCard(card.id);
    });
    await page.locator('#btnPayInvoice').click();
    await expect(page.locator('#modalPayInvoice')).toHaveClass(/hidden/);
    await expect(page.locator('#toastContainer')).toBeVisible();
    const s = await snapshot(page);
    expect(s.used).toBe(0);
    expect(s.balance).toBe(500000);
    expect(s.payTxs).toBe(0);
  });
});
