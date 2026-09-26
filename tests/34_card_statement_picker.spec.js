const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.use({ timezoneId: 'America/Sao_Paulo' });

// 34. Bloco D2: seletor reestilizado, extrato individual e lançamentos da fatura.
// Roda nos projetos chromium (desktop) e mobile-chrome (mobile) via config.

const FIXED_NOW = new Date('2026-09-25T12:00:00-03:00');

test.describe('34. Bloco D2 - extrato e lançamentos por cartão', () => {

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

  async function addCard(page, name, limitTotal, brand) {
    await page.evaluate(async ({ name, limitTotal, brand }) => {
      await window.linsoraStore.addCard({ name, brand: brand || name, limitTotal, closingDay: 15, dueDay: 22 });
      await new Promise((r) => setTimeout(r, 5));
    }, { name, limitTotal, brand });
  }

  async function purchase(page, cardName, amount, description) {
    await page.evaluate(async ({ cardName, amount, description }) => {
      const card = window.linsoraStore.state.cards.find((c) => c.name === cardName);
      await window.linsoraStore.addCardPurchase({
        amount, description, category: 'Compras', date: '2026-09-25', card,
      });
    }, { cardName, amount, description });
  }

  async function goCardsTab(page) {
    await page.evaluate(() => window.switchTab('tabCards'));
    await expect(page.locator('#tabCards')).toBeVisible();
  }

  test('1-3. Nubank e Inter: sem cruzamento nos lançamentos', async ({ page }) => {
    await setupBank(page, 5000);
    await addCard(page, 'Nubank', 5000, 'Nubank');
    await addCard(page, 'Banco Inter', 5000, 'Inter');
    await purchase(page, 'Nubank', 100, 'Compra Nubank');
    await purchase(page, 'Banco Inter', 200, 'Compra Inter');
    const res = await page.evaluate(() => {
      const cards = window.linsoraStore.state.cards;
      const nubank = cards.find((c) => c.name === 'Nubank');
      const inter = cards.find((c) => c.name === 'Banco Inter');
      const nubankTxs = window.linsoraStore.getCardTransactions(nubank.id);
      const interTxs = window.linsoraStore.getCardTransactions(inter.id);
      return {
        nubank: nubankTxs.map((t) => t.description),
        inter: interTxs.map((t) => t.description),
      };
    });
    expect(res.nubank).toEqual(['Compra Nubank']);
    expect(res.inter).toEqual(['Compra Inter']);
    // D2-C: faturaItemsList acompanha o cartão selecionado.
    await goCardsTab(page);
    await page.evaluate(() => {
      const nubank = window.linsoraStore.state.cards.find((c) => c.name === 'Nubank');
      window.LinsoraUI.selectCard(nubank.id);
    });
    await expect(page.locator('#faturaItemsList')).toContainText('Compra Nubank');
    await expect(page.locator('#faturaItemsList')).not.toContainText('Compra Inter');
    await page.evaluate(() => {
      const inter = window.linsoraStore.state.cards.find((c) => c.name === 'Banco Inter');
      window.LinsoraUI.selectCard(inter.id);
    });
    await expect(page.locator('#faturaItemsList')).toContainText('Compra Inter');
    await expect(page.locator('#faturaItemsList')).not.toContainText('Compra Nubank');
  });

  test('4. Vínculo primário por cardId mesmo com account divergente', async ({ page }) => {
    await setupBank(page, 5000);
    await addCard(page, 'Nubank', 5000, 'Nubank');
    await purchase(page, 'Nubank', 100, 'Compra cardId');
    const found = await page.evaluate(() => {
      const card = window.linsoraStore.state.cards.find((c) => c.name === 'Nubank');
      const tx = window.linsoraStore.state.transactions.find((t) => t.description === 'Compra cardId');
      tx.account = 'Conta Divergente';
      const list = window.linsoraStore.getCardTransactions(card.id);
      return list.some((t) => t.description === 'Compra cardId');
    });
    expect(found).toBe(true);
  });

  test('5. Fallback por account quando cardId está ausente (dado remoto)', async ({ page }) => {
    await setupBank(page, 5000);
    await addCard(page, 'Nubank', 5000, 'Nubank');
    await purchase(page, 'Nubank', 100, 'Compra remota');
    const found = await page.evaluate(() => {
      const card = window.linsoraStore.state.cards.find((c) => c.name === 'Nubank');
      const tx = window.linsoraStore.state.transactions.find((t) => t.description === 'Compra remota');
      delete tx.cardId;
      delete tx.paymentMethod;
      const list = window.linsoraStore.getCardTransactions(card.id);
      return list.some((t) => t.description === 'Compra remota');
    });
    expect(found).toBe(true);
  });

  test('6. Isolamento: usuário A nunca recebe transações do usuário B', async ({ page }) => {
    await setupBank(page, 5000);
    await addCard(page, 'Nubank', 5000, 'Nubank');
    await purchase(page, 'Nubank', 100, 'Compra A');
    const res = await page.evaluate(() => {
      const card = window.linsoraStore.state.cards.find((c) => c.name === 'Nubank');
      const uid = window.linsoraStore.state.user.id;
      window.linsoraStore.state.transactions.unshift({
        id: 'tx_foreign', userId: 'other-user', type: 'DESPESA', description: 'Compra B',
        amount: 999, category: 'Compras', date: '2026-09-25',
        account: 'Cartão Nubank', cardId: card.id, status: 'CONCLUIDO',
      });
      window.linsoraStore.state.transactions.unshift({
        id: 'tx_foreign2', user_id: 'other-user', type: 'DESPESA', description: 'Compra B2',
        amount: 999, category: 'Compras', date: '2026-09-25',
        account: 'Cartão Nubank', status: 'CONCLUIDO',
      });
      const list = window.linsoraStore.getCardTransactions(card.id);
      return { mine: uid, descs: list.map((t) => t.description) };
    });
    expect(res.descs).toEqual(['Compra A']);
  });

  test('7. Cartão sem lançamentos: estado vazio amigável', async ({ page }) => {
    await setupBank(page, 5000);
    await addCard(page, 'Nubank', 5000, 'Nubank');
    await goCardsTab(page);
    await page.evaluate(() => {
      const card = window.linsoraStore.state.cards.find((c) => c.name === 'Nubank');
      window.LinsoraUI.selectCard(card.id);
    });
    await expect(page.locator('#faturaItemsList')).toContainText('Nenhum lançamento neste cartão');
    await page.locator('#btnViewCardStatement').click();
    await expect(page.locator('#modalCardStatement')).not.toHaveClass(/hidden/);
    await expect(page.locator('#cardStatementTitle')).toContainText('Nubank');
    await expect(page.locator('#cardStatementList')).toContainText('Nenhum lançamento neste cartão');
    await page.locator('#btnCardStatementOk').click();
    await expect(page.locator('#modalCardStatement')).toHaveClass(/hidden/);
  });

  test('8-9. Ver extrato abre somente o cartão selecionado', async ({ page }) => {
    await setupBank(page, 5000);
    await addCard(page, 'Nubank', 5000, 'Nubank');
    await addCard(page, 'Banco Inter', 5000, 'Inter');
    await purchase(page, 'Nubank', 100, 'Compra Nubank');
    await purchase(page, 'Banco Inter', 250, 'Compra Inter');
    await goCardsTab(page);
    await page.evaluate(() => {
      const inter = window.linsoraStore.state.cards.find((c) => c.name === 'Banco Inter');
      window.LinsoraUI.selectCard(inter.id);
    });
    await expect(page.locator('#faturaItemsList')).toContainText('Compra Inter');
    await page.locator('#btnViewCardStatement').click();
    await expect(page.locator('#modalCardStatement')).not.toHaveClass(/hidden/);
    await expect(page.locator('#cardStatementTitle')).toContainText('Banco Inter');
    await expect(page.locator('#cardStatementList')).toContainText('Compra Inter');
    await expect(page.locator('#cardStatementList')).not.toContainText('Compra Nubank');
    await expect(page.locator('#cardStatementTotal')).toContainText('250,00');
    await page.locator('#btnCardStatementOk').click();
    await expect(page.locator('#modalCardStatement')).toHaveClass(/hidden/);
    // Troca de seleção: extrato acompanha o novo cartão.
    await page.evaluate(() => {
      const nubank = window.linsoraStore.state.cards.find((c) => c.name === 'Nubank');
      window.LinsoraUI.selectCard(nubank.id);
    });
    await page.locator('#btnViewCardStatement').click();
    await expect(page.locator('#cardStatementTitle')).toContainText('Nubank');
    await expect(page.locator('#cardStatementList')).toContainText('Compra Nubank');
    await expect(page.locator('#cardStatementList')).not.toContainText('Compra Inter');
  });

  test('10. D2-A: picker mostra Disponível + valor e nome como ação', async ({ page }) => {
    await setupBank(page, 5000);
    await addCard(page, 'Nubank', 1000, 'Nubank');
    await addCard(page, 'Banco Inter', 5000, 'Inter');
    await page.evaluate(async () => {
      const card = window.linsoraStore.state.cards.find((c) => c.name === 'Nubank');
      await window.linsoraStore.addCardPurchase({ amount: 555, description: 'Uso', category: 'Compras', date: '2026-09-25', card });
      window.VoiceAssistantUI.currentParsedTx = window.TransactionAIParser.parseText('compra no cartão de crédito de 100 reais');
      await window.VoiceAssistantUI.confirmAndSave();
    });
    await expect(page.locator('#modalCardPicker')).not.toHaveClass(/hidden/);
    await expect(page.locator('#cardPickerList .card-picker-avail-label')).toHaveText(['Disponível', 'Disponível']);
    await expect(page.locator('#cardPickerList')).toContainText('445,00');
    await expect(page.locator('#cardPickerList')).toContainText('5.000,00');
    await expect(page.locator('#cardPickerList .card-picker-select')).toHaveText(['Nubank', 'Banco Inter']);
    await expect(page.locator('#cardPickerList')).not.toContainText('Selecionar');
    await expect(page.locator('#modalCreditConfirm')).toHaveClass(/hidden/);
  });

  test('11. Cartão sem limite continua desabilitado, sem botão', async ({ page }) => {
    await setupBank(page, 5000);
    await addCard(page, 'Nubank', 1000, 'Nubank');
    await addCard(page, 'Banco Inter', 5000, 'Inter');
    await addCard(page, 'Santander', 2000, 'Santander');
    await page.evaluate(async () => {
      const nubank = window.linsoraStore.state.cards.find((c) => c.name === 'Nubank');
      await window.linsoraStore.addCardPurchase({ amount: 1000, description: 'Uso total', category: 'Compras', date: '2026-09-25', card: nubank });
      window.VoiceAssistantUI.currentParsedTx = window.TransactionAIParser.parseText('compra no cartão de crédito de 100 reais');
      await window.VoiceAssistantUI.confirmAndSave();
    });
    await expect(page.locator('#modalCardPicker')).not.toHaveClass(/hidden/);
    const disabled = page.locator('#cardPickerList .card-picker-item.disabled');
    await expect(disabled).toHaveCount(1);
    await expect(disabled).toContainText('Nubank');
    await expect(disabled).toContainText('Sem limite suficiente');
    await expect(disabled.locator('.card-picker-select')).toHaveCount(0);
    await expect(page.locator('#cardPickerList .card-picker-select')).toHaveCount(2);
  });

  test('12. Pagamento de fatura não aparece como compra no extrato', async ({ page }) => {
    await setupBank(page, 5000);
    await addCard(page, 'Nubank', 5000, 'Nubank');
    await purchase(page, 'Nubank', 400, 'Compra Nubank');
    await page.evaluate(async () => {
      const card = window.linsoraStore.state.cards.find((c) => c.name === 'Nubank');
      await window.linsoraStore.payCardAmount(card.id, 150);
    });
    const res = await page.evaluate(() => {
      const card = window.linsoraStore.state.cards.find((c) => c.name === 'Nubank');
      return window.linsoraStore.getCardTransactions(card.id).map((t) => t.description);
    });
    expect(res).toEqual(['Compra Nubank']);
  });
});
