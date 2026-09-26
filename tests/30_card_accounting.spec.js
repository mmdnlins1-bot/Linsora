const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.use({ timezoneId: 'America/Sao_Paulo' });

// 30. Cartão: contabilização compra/pagamento sem fallback silencioso.
// Compra = dívida no cartão (banco intacto); pagamento = saída bancária +
// redução da dívida, sem segunda despesa. Formulário manual exige conta ou
// cartão válido; conta inexistente nunca atinge accounts[0]; métrica mensal
// conta só a saída real (pagamento), nunca compra+pagamento somados.
// Roda nos projetos chromium (desktop) e mobile-chrome (mobile) via config.

const FIXED_NOW = new Date('2026-09-25T12:00:00-03:00');

test.describe('30. Cartao: contabilizacao sem fallback silencioso', () => {

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

  async function setup(page, bank, cards) {
    await page.evaluate(async ({ bank, cards }) => {
      const uid = window.linsoraStore.state.user.id;
      window.linsoraStore.state.accounts = [{ id: 'acc1', userId: uid, balance: bank, name: 'Conta Principal' }];
      window.linsoraStore.state.transactions = [];
      window.linsoraStore.state.cards = [];
      for (const c of cards) {
        await window.linsoraStore.addCard({ name: c.name, brand: c.name, limitTotal: c.limit, closingDay: 15, dueDay: 22 });
        await new Promise((r) => setTimeout(r, 5));
      }
      window.linsoraStore.persistState();
    }, { bank, cards });
  }

  async function finance(page) {
    return page.evaluate(() => ({
      bank: window.linsoraStore.getAccountsBalance(),
      cards: window.linsoraStore.state.cards.map((c) => ({
        name: c.name, limitTotal: Number(c.limitTotal), limitUsed: Number(c.limitUsed),
        avail: Number(c.limitTotal) - Number(c.limitUsed),
      })),
      txs: window.linsoraStore.state.transactions.map((t) => ({
        description: t.description, amount: Number(t.amount), account: t.account,
        cardId: t.cardId || null, isCardPayment: t.isCardPayment === true, type: t.type,
      })),
      monthExpense: window.linsoraStore.getCurrentMonthExpense(),
      netWorth: window.linsoraStore.getTotalNetWorth(),
    }));
  }

  test('A. Compra 300: banco 3600, usado 300, disponivel 4700', async ({ page }) => {
    await setup(page, 3600, [{ name: 'Nubank', limit: 5000 }]);
    await page.evaluate(async () => {
      const card = window.linsoraStore.resolvePurchaseCard(null);
      await window.linsoraStore.addCardPurchase({ amount: 300, description: 'Compra A', category: 'Compras', date: '2026-09-25', card });
    });
    const st = await finance(page);
    expect(st.bank).toBe(3600);
    expect(st.cards[0].limitUsed).toBe(300);
    expect(st.cards[0].avail).toBe(4700);
  });

  test('B. Segunda compra 200: usado 500, disponivel 4500, banco intacto', async ({ page }) => {
    await setup(page, 3600, [{ name: 'Nubank', limit: 5000 }]);
    await page.evaluate(async () => {
      const card = window.linsoraStore.resolvePurchaseCard(null);
      await window.linsoraStore.addCardPurchase({ amount: 300, description: 'Compra A', category: 'Compras', date: '2026-09-25', card });
      await window.linsoraStore.addCardPurchase({ amount: 200, description: 'Compra B', category: 'Compras', date: '2026-09-25', card });
    });
    const st = await finance(page);
    expect(st.bank).toBe(3600);
    expect(st.cards[0].limitUsed).toBe(500);
    expect(st.cards[0].avail).toBe(4500);
  });

  test('C. Pagamento parcial 200: banco 3400, usado 300', async ({ page }) => {
    await setup(page, 3600, [{ name: 'Nubank', limit: 5000 }]);
    await page.evaluate(async () => {
      const card = window.linsoraStore.resolvePurchaseCard(null);
      await window.linsoraStore.addCardPurchase({ amount: 300, description: 'Compra A', category: 'Compras', date: '2026-09-25', card });
      await window.linsoraStore.addCardPurchase({ amount: 200, description: 'Compra B', category: 'Compras', date: '2026-09-25', card });
      await window.linsoraStore.payCardAmount(card.id, 200);
    });
    const st = await finance(page);
    expect(st.bank).toBe(3400);
    expect(st.cards[0].limitUsed).toBe(300);
  });

  test('D. Pagamento total 300: banco 3100, usado 0, sem segunda reducao', async ({ page }) => {
    await setup(page, 3600, [{ name: 'Nubank', limit: 5000 }]);
    await page.evaluate(async () => {
      const card = window.linsoraStore.resolvePurchaseCard(null);
      await window.linsoraStore.addCardPurchase({ amount: 300, description: 'Compra A', category: 'Compras', date: '2026-09-25', card });
      await window.linsoraStore.addCardPurchase({ amount: 200, description: 'Compra B', category: 'Compras', date: '2026-09-25', card });
      await window.linsoraStore.payCardAmount(card.id, 200);
      await window.linsoraStore.payCardAmount(card.id, 300);
    });
    const st = await finance(page);
    expect(st.bank).toBe(3100);
    expect(st.cards[0].limitUsed).toBe(0);
    expect(st.cards[0].avail).toBe(5000);
    // Exatamente 2 pagamentos (200+300), compras intactas, sem tx extra.
    const pays = st.txs.filter((t) => t.isCardPayment);
    expect(pays.map((t) => t.amount).sort((a, b) => a - b)).toEqual([200, 300]);
    expect(st.txs).toHaveLength(4);
  });

  test('E. Voz com um unico cartao: confirmação compacta e +300 no cartao, banco intacto', async ({ page }) => {
    await setup(page, 3600, [{ name: 'Nubank', limit: 5000 }]);
    await page.evaluate(async () => {
      window.VoiceAssistantUI.currentParsedTx = window.TransactionAIParser.parseText('Fiz uma compra de 300 reais no cartão');
      await window.VoiceAssistantUI.confirmAndSave();
    });
    // Bloco D1: confirmação compacta (sem modal genérico) antes de salvar.
    await expect(page.locator('#modalCreditConfirm')).not.toHaveClass(/hidden/);
    await expect(page.locator('#creditConfCard')).toContainText('Nubank');
    await page.locator('#btnCreditConfConfirm').click();
    await page.waitForTimeout(150);
    const st = await finance(page);
    expect(st.cards[0].limitUsed).toBe(300);
    expect(st.bank).toBe(3600);
    expect(st.txs).toHaveLength(1);
    expect(st.txs[0].account).toBe('Cartão Nubank');
  });

  test('F. Voz ambigua: modal de selecao, nada muda, sem auto-escolha', async ({ page }) => {
    await setup(page, 3600, [{ name: 'Nubank', limit: 5000 }, { name: 'Inter', limit: 2000 }]);
    await page.evaluate(async () => {
      window.VoiceAssistantUI.currentParsedTx = window.TransactionAIParser.parseText('Fiz uma compra de 300 reais no cartão');
      await window.VoiceAssistantUI.confirmAndSave();
    });
    const st = await finance(page);
    expect(st.cards.every((c) => c.limitUsed === 0)).toBe(true);
    expect(st.bank).toBe(3600);
    expect(st.txs).toHaveLength(0);
    // Bloco C: 2 cartões elegíveis abrem o modalCardPicker (nunca o
    // formulário e nunca auto-escolha do primeiro cartão).
    await expect(page.locator('#modalCardPicker')).not.toHaveClass(/hidden/);
    await expect(page.locator('#modalTransactionForm')).toHaveClass(/hidden/);
    await expect(page.locator('#cardPickerList .card-picker-select')).toHaveCount(2);
  });

  test('G. Voz nomeada com dois cartoes: confirmação compacta e somente Nubank +300', async ({ page }) => {
    await setup(page, 3600, [{ name: 'Nubank', limit: 5000 }, { name: 'Inter', limit: 2000 }]);
    await page.evaluate(async () => {
      window.VoiceAssistantUI.currentParsedTx = window.TransactionAIParser.parseText('Fiz uma compra de 300 reais no cartão nubank');
      await window.VoiceAssistantUI.confirmAndSave();
    });
    // Bloco D1: confirmação compacta identifica o Nubank, sem seletor.
    await expect(page.locator('#modalCreditConfirm')).not.toHaveClass(/hidden/);
    await expect(page.locator('#creditConfCard')).toContainText('Nubank');
    await page.locator('#btnCreditConfConfirm').click();
    await page.waitForTimeout(150);
    const st = await finance(page);
    expect(st.cards.find((c) => c.name === 'Nubank').limitUsed).toBe(300);
    expect(st.cards.find((c) => c.name === 'Inter').limitUsed).toBe(0);
    expect(st.bank).toBe(3600);
  });

  test('H. Formulario manual: cartao vincula; conta fantasma bloqueia', async ({ page }) => {
    await setup(page, 3600, [{ name: 'Nubank', limit: 5000 }]);
    await page.click('.bottom-nav .nav-item[data-tab="tabTransactions"]');
    await expect(page.locator('#tabTransactions')).toBeVisible();
    await page.click('#btnNewTransactionHeader');
    await expect(page.locator('#modalTransactionForm')).toBeVisible();
    const options = await page.evaluate(() => Array.from(document.getElementById('txAccount').options).map((o) => o.value));
    expect(options).toContain('Conta Principal');
    expect(options).toContain('Cartão Nubank');

    await page.fill('#txAmount', '30000');
    await page.fill('#txDescription', 'Compra manual');
    await page.selectOption('#txAccount', 'Cartão Nubank');
    await page.click('#btnSaveTransaction');
    await expect(page.locator('#modalTransactionForm')).toHaveClass(/hidden/, { timeout: 5000 });

    let st = await finance(page);
    expect(st.cards[0].limitUsed).toBe(300);
    expect(st.bank).toBe(3600);

    // Conta inexistente (dado obsoleto): bloqueia, sem tx, sem tocar banco.
    await page.click('#btnNewTransactionHeader');
    await expect(page.locator('#modalTransactionForm')).toBeVisible();
    await page.evaluate(() => {
      const sel = document.getElementById('txAccount');
      sel.insertAdjacentHTML('beforeend', '<option value="Conta Antiga">Conta Antiga</option>');
      sel.value = 'Conta Antiga';
    });
    await page.fill('#txAmount', '10000');
    await page.fill('#txDescription', 'Lancamento obsoleto');
    await page.click('#btnSaveTransaction');
    await expect(page.locator('#modalTransactionForm')).toBeVisible({ timeout: 5000 });
    st = await finance(page);
    expect(st.txs).toHaveLength(1);
    expect(st.bank).toBe(3600);
    expect(st.cards[0].limitUsed).toBe(300);
  });

  test('I. Conta inexistente: erro controlado, nunca accounts[0]', async ({ page }) => {
    await setup(page, 3600, [{ name: 'Nubank', limit: 5000 }]);
    const out = await page.evaluate(() => {
      const before = window.linsoraStore.getAccountsBalance();
      const applied = window.linsoraStore.adjustAccountBalance('Conta Inexistente XYZ', -100);
      const missing = window.linsoraStore.resolveTxAccount('Conta Inexistente XYZ', 'DESPESA');
      const okBank = window.linsoraStore.resolveTxAccount('Conta Principal', 'DESPESA');
      const okCard = window.linsoraStore.resolveTxAccount('Cartão Nubank', 'DESPESA');
      const badCard = window.linsoraStore.resolveTxAccount('Cartão Fantasma', 'DESPESA');
      return {
        applied, after: window.linsoraStore.getAccountsBalance(), before,
        missingOk: missing.ok, bankOk: okBank.ok, cardOk: okCard.ok, badCardOk: badCard.ok,
      };
    });
    expect(out.applied).toBe(false);
    expect(out.after).toBe(out.before);
    expect(out.missingOk).toBe(false);
    expect(out.bankOk).toBe(true);
    expect(out.cardOk).toBe(true);
    expect(out.badCardOk).toBe(false);
  });

  test('J. Metrica mensal: compra 500 + pagamento 200 = saida 200', async ({ page }) => {
    // Regra adotada: compra no cartão é dívida (fora da despesa do mês);
    // só o pagamento (saída bancária real) conta na métrica. Histórico
    // de ambos preservado; sem somar 500+200 como 700.
    await setup(page, 3600, [{ name: 'Nubank', limit: 5000 }]);
    await page.evaluate(async () => {
      const card = window.linsoraStore.resolvePurchaseCard(null);
      await window.linsoraStore.addCardPurchase({ amount: 500, description: 'Compra A', category: 'Compras', date: '2026-09-25', card });
      await window.linsoraStore.payCardAmount(card.id, 200);
    });
    const st = await finance(page);
    expect(st.monthExpense).toBe(200);
    expect(st.txs).toHaveLength(2);
    expect(st.bank).toBe(3400);
    expect(st.cards[0].limitUsed).toBe(300);
  });

  test('K. Patrimonio: compra reflete obrigacao, sem dupla reducao', async ({ page }) => {
    await setup(page, 3600, [{ name: 'Nubank', limit: 5000 }]);
    const before = await finance(page);
    expect(before.netWorth).toBe(3600);
    await page.evaluate(async () => {
      const card = window.linsoraStore.resolvePurchaseCard(null);
      await window.linsoraStore.addCardPurchase({ amount: 300, description: 'Compra A', category: 'Compras', date: '2026-09-25', card });
    });
    const st = await finance(page);
    expect(st.bank).toBe(3600);
    expect(st.cards[0].limitUsed).toBe(300);
    expect(st.netWorth).toBe(3300);
  });
});
