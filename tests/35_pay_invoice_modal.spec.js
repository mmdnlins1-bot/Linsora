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

  // A máscara pt-BR existente trabalha com entrada de centavos:
  // digitar '10000' -> '100,00'. Por isso os valores abaixo são passados
  // em centavos (sem separador), simulando a digitação real do usuário.
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
    await choosePartial(page, '10000');
    await expect(page.locator('#payInvoiceAmount')).toHaveValue('100,00');
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
    await choosePartial(page, '5000');
    await expect(page.locator('#payInvoiceAmount')).toHaveValue('50,00');
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
    await choosePartial(page, '20000');
    await expect(page.locator('#payInvoiceAmount')).toHaveValue('200,00');
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
    await choosePartial(page, '50000');
    await expect(page.locator('#payInvoiceAmount')).toHaveValue('500,00');
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
    await expect(page.locator('#payInvoiceAmount')).toHaveValue('0,00');
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
    await page.locator('input[name="payInvoiceType"][value="partial"]').check();
    // A máscara remove '-' durante a digitação; define o valor diretamente
    // (sem disparar o input/máscara) para cobrir o ramo negativo da validação.
    await page.evaluate(() => {
      document.getElementById('payInvoiceAmount').value = '-50';
    });
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
    await choosePartial(page, '60000');
    await expect(page.locator('#payInvoiceAmount')).toHaveValue('600,00');
    await page.locator('#btnPayInvoiceConfirm').click();
    await expect(page.locator('#payInvoiceError')).toBeVisible();
    const s = await snapshot(page);
    expect(s.used).toBe(500);
    expect(s.balance).toBe(500000);
    expect(s.payTxs).toBe(0);
  });

  test('12. Máscara: digitar 15000 exibe R$ 150,00 e paga 150', async ({ page }) => {
    await openCardsWithDebt(page, 500);
    await page.locator('#btnPayInvoice').click();
    await choosePartial(page, '15000');
    await expect(page.locator('#payInvoiceAmount')).toHaveValue('150,00');
    await expect(page.locator('#payInvoiceRemaining')).toContainText('350,00');
    await page.locator('#btnPayInvoiceConfirm').click();
    await expect(page.locator('#modalPayInvoice')).toHaveClass(/hidden/);
    const s = await snapshot(page);
    expect(s.used).toBe(350);
    expect(s.balance).toBe(500000 - 150);
    expect(s.payTxs).toBe(1);
    expect(s.tx.amount).toBe(150);
    expect(s.tx.isCardPayment).toBe(true);
  });

  test('13. Máscara: digitar 15050 exibe R$ 150,50 e paga 150.5', async ({ page }) => {
    await openCardsWithDebt(page, 500);
    await page.locator('#btnPayInvoice').click();
    await choosePartial(page, '15050');
    await expect(page.locator('#payInvoiceAmount')).toHaveValue('150,50');
    await expect(page.locator('#payInvoiceRemaining')).toContainText('349,50');
    await page.locator('#btnPayInvoiceConfirm').click();
    await expect(page.locator('#modalPayInvoice')).toHaveClass(/hidden/);
    const s = await snapshot(page);
    expect(s.used).toBeCloseTo(349.5, 2);
    expect(s.balance).toBeCloseTo(500000 - 150.5, 2);
    expect(s.payTxs).toBe(1);
    expect(s.tx.amount).toBeCloseTo(150.5, 2);
    expect(s.tx.isCardPayment).toBe(true);
  });

  test('14. Máscara: digitar 150000 exibe R$ 1.500,00 e paga 1500', async ({ page }) => {
    await openCardsWithDebt(page, 2000);
    await page.locator('#btnPayInvoice').click();
    await choosePartial(page, '150000');
    await expect(page.locator('#payInvoiceAmount')).toHaveValue('1.500,00');
    await expect(page.locator('#payInvoiceRemaining')).toContainText('500,00');
    await page.locator('#btnPayInvoiceConfirm').click();
    await expect(page.locator('#modalPayInvoice')).toHaveClass(/hidden/);
    const s = await snapshot(page);
    expect(s.used).toBe(500);
    expect(s.balance).toBe(500000 - 1500);
    expect(s.payTxs).toBe(1);
    expect(s.tx.amount).toBe(1500);
    expect(s.tx.isCardPayment).toBe(true);
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
