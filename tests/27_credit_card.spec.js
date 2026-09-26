const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.use({ timezoneId: 'America/Sao_Paulo' });

// 27. Cartão de crédito: compra vincula limitUsed (sem tocar a conta),
// pagamento reduz limitUsed + conta (sem duplicar despesa), identificação
// por nome e ambiguidade segura, persistência no reload.
// Roda nos projetos chromium (desktop) e mobile-chrome (mobile) via config.

const FIXED_NOW = new Date('2026-09-25T12:00:00-03:00');

test.describe('27. Cartao de credito: compra e pagamento', () => {

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
      window.linsoraStore.persistState();
    }, balance);
  }

  async function addCard(page, name, limitTotal, brand = 'Nubank') {
    await page.evaluate(async ({ name, limitTotal, brand }) => {
      await window.linsoraStore.addCard({ name, brand, limitTotal, closingDay: 15, dueDay: 22 });
      await new Promise((r) => setTimeout(r, 5));
    }, { name, limitTotal, brand });
  }

  async function cardState(page) {
    return page.evaluate(() => ({
      cards: window.linsoraStore.state.cards.map((c) => ({
        name: c.name, limitTotal: Number(c.limitTotal), limitUsed: Number(c.limitUsed),
        avail: Number(c.limitTotal) - Number(c.limitUsed),
      })),
      bank: window.linsoraStore.getAccountsBalance(),
      txs: window.linsoraStore.state.transactions.map((t) => ({
        description: t.description, amount: Number(t.amount), account: t.account,
        cardId: t.cardId || null, isCardPayment: t.isCardPayment === true, type: t.type,
      })),
    }));
  }

  test('9. Compra 500 no credito: used 500, disponivel 500, conta intacta', async ({ page }) => {
    await setupBank(page, 2000);
    await addCard(page, 'Nubank', 1000);
    await page.evaluate(async () => {
      const card = window.linsoraStore.resolvePurchaseCard(null);
      await window.linsoraStore.addCardPurchase({
        amount: 500, description: 'Compra teste', category: 'Compras',
        date: '2026-09-25', card,
      });
    });
    const st = await cardState(page);
    expect(st.cards).toHaveLength(1);
    expect(st.cards[0].limitUsed).toBe(500);
    expect(st.cards[0].avail).toBe(500);
    expect(st.bank).toBe(2000);
    expect(st.txs).toHaveLength(1);
    expect(st.txs[0].account).toBe('Cartão Nubank');
    expect(st.txs[0].cardId).toBeTruthy();
  });

  test('10/11. Compra 300 + pagamento parcial 200: sem duplicar financeiro', async ({ page }) => {
    await setupBank(page, 2000);
    await addCard(page, 'Nubank', 1000);
    await page.evaluate(async () => {
      const card = window.linsoraStore.resolvePurchaseCard(null);
      await window.linsoraStore.addCardPurchase({ amount: 500, description: 'Compra A', category: 'Compras', date: '2026-09-25', card });
      const same = window.linsoraStore.resolvePurchaseCard(null);
      await window.linsoraStore.addCardPurchase({ amount: 300, description: 'Compra B', category: 'Compras', date: '2026-09-25', card: same });
    });
    let st = await cardState(page);
    expect(st.cards[0].limitUsed).toBe(800);
    expect(st.bank).toBe(2000);

    const pay = await page.evaluate(async () => {
      const card = window.linsoraStore.state.cards.find((c) => c.name === 'Nubank');
      return window.linsoraStore.payCardAmount(card.id, 200);
    });
    expect(pay.paid).toBe(200);
    expect(pay.remaining).toBe(600);

    st = await cardState(page);
    expect(st.cards[0].limitUsed).toBe(600);
    expect(st.bank).toBe(1800);
    // Compra original permanece 500; exatamente 1 pagamento; nada duplicado.
    expect(st.txs.filter((t) => t.description === 'Compra A' && t.amount === 500)).toHaveLength(1);
    expect(st.txs.filter((t) => t.description === 'Compra B' && t.amount === 300)).toHaveLength(1);
    const payments = st.txs.filter((t) => t.isCardPayment);
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe(200);
    expect(payments[0].account).toBe('Conta Principal');
    expect(st.txs).toHaveLength(3);
  });

  test('12. Pagamento total zera o utilizado', async ({ page }) => {
    await setupBank(page, 2000);
    await addCard(page, 'Nubank', 1000);
    await page.evaluate(async () => {
      const card = window.linsoraStore.resolvePurchaseCard(null);
      await window.linsoraStore.addCardPurchase({ amount: 500, description: 'Compra A', category: 'Compras', date: '2026-09-25', card });
      await window.linsoraStore.payCardAmount(card.id, 500);
    });
    const st = await cardState(page);
    expect(st.cards[0].limitUsed).toBe(0);
    expect(st.cards[0].avail).toBe(1000);
    expect(st.bank).toBe(1500);
  });

  test('13. Dois cartoes, compra nomeando A: somente A recebe o uso', async ({ page }) => {
    await setupBank(page, 2000);
    await addCard(page, 'Nubank', 1000, 'Nubank');
    await addCard(page, 'Inter', 2000, 'Inter');
    await page.evaluate(async () => {
      const card = window.linsoraStore.resolvePurchaseCard('nubank');
      await window.linsoraStore.addCardPurchase({ amount: 500, description: 'Compra A', category: 'Compras', date: '2026-09-25', card });
    });
    const st = await cardState(page);
    const a = st.cards.find((c) => c.name === 'Nubank');
    const b = st.cards.find((c) => c.name === 'Inter');
    expect(a.limitUsed).toBe(500);
    expect(b.limitUsed).toBe(0);
    expect(st.bank).toBe(2000);
  });

  test('14. Dois cartoes sem identificacao: pergunta, nada muda', async ({ page }) => {
    await setupBank(page, 2000);
    await addCard(page, 'Nubank', 1000, 'Nubank');
    await addCard(page, 'Inter', 2000, 'Inter');
    const resolved = await page.evaluate(() => window.linsoraStore.resolvePurchaseCard(null));
    expect(resolved).toBe(null);
    // Rota da voz sem dica (Bloco C): NENHUMA despesa bancária silenciosa;
    // com 2 cartões elegíveis abre o modal modalCardPicker (substitui o
    // fluxo antigo toast + formulário). Nada muda no financeiro.
    await page.evaluate(async () => {
      window.VoiceAssistantUI.currentParsedTx = window.TransactionAIParser.parseText('Fiz uma compra de 500 reais no cartão');
      await window.VoiceAssistantUI.confirmAndSave();
    });
    const st = await cardState(page);
    expect(st.cards.every((c) => c.limitUsed === 0)).toBe(true);
    expect(st.txs).toHaveLength(0);
    expect(st.bank).toBe(2000);
    await expect(page.locator('#modalCardPicker')).not.toHaveClass(/hidden/);
    await expect(page.locator('#modalTransactionForm')).toHaveClass(/hidden/);
  });

  test('15. Reload/reabertura: utilizado permanece correto', async ({ page }) => {
    await setupBank(page, 2000);
    await addCard(page, 'Nubank', 1000);
    await page.evaluate(async () => {
      const card = window.linsoraStore.resolvePurchaseCard(null);
      await window.linsoraStore.addCardPurchase({ amount: 500, description: 'Compra A', category: 'Compras', date: '2026-09-25', card });
    });
    await page.reload();
    await login(page);
    const st = await cardState(page);
    expect(st.cards).toHaveLength(1);
    expect(st.cards[0].limitUsed).toBe(500);
    expect(st.cards[0].avail).toBe(500);
    expect(st.txs.some((t) => t.description === 'Compra A' && t.amount === 500)).toBe(true);
  });

  test('Voz: compra nomeada vincula; pagamento reduz cartão + conta', async ({ page }) => {
    await setupBank(page, 2000);
    await addCard(page, 'Nubank', 1000, 'Nubank');
    await addCard(page, 'Inter', 2000, 'Inter');

    const parsed = await page.evaluate(() => {
      const p1 = window.TransactionAIParser.parseText('Fiz uma compra de 500 reais no cartão nubank');
      const p2 = window.TransactionAIParser.parseText('Paguei 200 reais do cartão nubank');
      const p3 = window.TransactionAIParser.parseText('Paguei a conta de luz');
      return [
        { method: p1.paymentMethod, hint: p1.cardHint, pay: p1.isCardPayment, amount: p1.amount, type: p1.type },
        { method: p2.paymentMethod, hint: p2.cardHint, pay: p2.isCardPayment, amount: p2.amount },
        { method: p3.paymentMethod, hint: p3.cardHint, pay: p3.isCardPayment },
      ];
    });
    expect(parsed[0]).toEqual({ method: 'credit', hint: 'nubank', pay: false, amount: 500, type: 'DESPESA' });
    expect(parsed[1].pay).toBe(true);
    expect(parsed[1].hint).toBe('nubank');
    expect(parsed[1].amount).toBe(200);
    expect(parsed[2]).toEqual({ method: null, hint: null, pay: false });

    await page.evaluate(async () => {
      window.VoiceAssistantUI.currentParsedTx = window.TransactionAIParser.parseText('Fiz uma compra de 500 reais no cartão nubank');
      await window.VoiceAssistantUI.confirmAndSave();
    });
    let st = await cardState(page);
    expect(st.cards.find((c) => c.name === 'Nubank').limitUsed).toBe(500);
    expect(st.cards.find((c) => c.name === 'Inter').limitUsed).toBe(0);
    expect(st.bank).toBe(2000);

    await page.evaluate(async () => {
      window.VoiceAssistantUI.currentParsedTx = window.TransactionAIParser.parseText('Paguei 200 reais do cartão nubank');
      await window.VoiceAssistantUI.confirmAndSave();
    });
    st = await cardState(page);
    expect(st.cards.find((c) => c.name === 'Nubank').limitUsed).toBe(300);
    expect(st.bank).toBe(1800);
    expect(st.txs.filter((t) => t.isCardPayment)).toHaveLength(1);
  });
});
