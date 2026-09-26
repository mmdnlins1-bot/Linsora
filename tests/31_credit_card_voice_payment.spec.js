const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.use({ timezoneId: 'America/Sao_Paulo' });

// 31. Pagamento de fatura do cartão por comando de voz (Bloco A):
// frases reais "pagamento da fatura / paguei a fatura / pagamento rotativo"
// com cartão único resolvem automaticamente via payCardAmount; com dois
// cartões sem nome pedem escolha sem tocar o financeiro; com nome usam
// somente o cartão indicado; nome inexistente não lança despesa bancária.
// Roda nos projetos chromium (desktop) e mobile-chrome (mobile) via config.

const FIXED_NOW = new Date('2026-09-25T12:00:00-03:00');

test.describe('31. Pagamento da fatura do cartao por voz', () => {

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

  async function addCard(page, name, limitTotal, brand) {
    await page.evaluate(async ({ name, limitTotal, brand }) => {
      await window.linsoraStore.addCard({ name, brand: brand || name, limitTotal, closingDay: 15, dueDay: 22 });
      await new Promise((r) => setTimeout(r, 5));
    }, { name, limitTotal, brand });
  }

  async function purchaseOnCard(page, cardName, amount, description) {
    await page.evaluate(async ({ cardName, amount, description }) => {
      const card = window.linsoraStore.state.cards.find((c) => c.name === cardName);
      await window.linsoraStore.addCardPurchase({
        amount, description: description || 'Compra original', category: 'Compras',
        date: '2026-09-25', card,
      });
    }, { cardName, amount, description });
  }

  async function voicePay(page, phrase) {
    await page.evaluate(async (text) => {
      window.VoiceAssistantUI.currentParsedTx = window.TransactionAIParser.parseText(text);
      await window.VoiceAssistantUI.confirmAndSave();
    }, phrase);
  }

  async function cardState(page) {
    return page.evaluate(() => ({
      cards: window.linsoraStore.state.cards.map((c) => ({
        name: c.name, limitTotal: Number(c.limitTotal), limitUsed: Number(c.limitUsed),
      })),
      bank: window.linsoraStore.getAccountsBalance(),
      txs: window.linsoraStore.state.transactions.map((t) => ({
        description: t.description, amount: Number(t.amount), account: t.account,
        cardId: t.cardId || null, isCardPayment: t.isCardPayment === true, type: t.type,
        paymentMethod: t.paymentMethod || null,
      })),
    }));
  }

  test('Parser: as 4 frases de fatura/rotativo viram credit + isCardPayment sem hint generico', async ({ page }) => {
    const parsed = await page.evaluate(() => {
      const phrases = [
        'pagamento da fatura do cartão de crédito de 300 reais',
        '300 reais paguei a fatura do cartão de crédito',
        'pagamento rotativo do cartão de crédito 250 reais',
        'paguei 250 reais da fatura do cartão de crédito',
      ];
      return phrases.map((text) => {
        const p = window.TransactionAIParser.parseText(text);
        return { method: p.paymentMethod, hint: p.cardHint, pay: p.isCardPayment, amount: p.amount, type: p.type };
      });
    });
    expect(parsed[0]).toEqual({ method: 'credit', hint: null, pay: true, amount: 300, type: 'DESPESA' });
    expect(parsed[1]).toEqual({ method: 'credit', hint: null, pay: true, amount: 300, type: 'DESPESA' });
    expect(parsed[2]).toEqual({ method: 'credit', hint: null, pay: true, amount: 250, type: 'DESPESA' });
    expect(parsed[3]).toEqual({ method: 'credit', hint: null, pay: true, amount: 250, type: 'DESPESA' });
  });

  test('A. Fatura com cartao unico: banco 3600->3300, usado 500->200, 1 isCardPayment', async ({ page }) => {
    await setupBank(page, 3600);
    await addCard(page, 'Nubank', 1000);
    await purchaseOnCard(page, 'Nubank', 500, 'Compra original');
    await voicePay(page, 'pagamento da fatura do cartão de crédito de 300 reais');
    const st = await cardState(page);
    expect(st.bank).toBe(3300);
    expect(st.cards).toHaveLength(1);
    expect(st.cards[0].limitUsed).toBe(200);
    expect(st.txs).toHaveLength(2);
    expect(st.txs.filter((t) => t.description === 'Compra original' && t.amount === 500)).toHaveLength(1);
    const payments = st.txs.filter((t) => t.isCardPayment);
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe(300);
    expect(payments[0].account).toBe('Conta Principal');
    // Nenhuma despesa bancária genérica adicional além do pagamento.
    const genericBank = st.txs.filter((t) => !t.isCardPayment && t.account === 'Conta Principal');
    expect(genericBank).toHaveLength(0);
  });

  test('B. Ordem diferente com cartao unico: mesmo resultado do teste A', async ({ page }) => {
    await setupBank(page, 3600);
    await addCard(page, 'Nubank', 1000);
    await purchaseOnCard(page, 'Nubank', 500, 'Compra original');
    await voicePay(page, '300 reais paguei a fatura do cartão de crédito');
    const st = await cardState(page);
    expect(st.bank).toBe(3300);
    expect(st.cards[0].limitUsed).toBe(200);
    expect(st.txs).toHaveLength(2);
    const payments = st.txs.filter((t) => t.isCardPayment);
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe(300);
  });

  test('C. Rotativo com cartao unico: pagamento parcial 250 sem nova divida', async ({ page }) => {
    await setupBank(page, 3600);
    await addCard(page, 'Nubank', 1000);
    await purchaseOnCard(page, 'Nubank', 500, 'Compra original');
    await voicePay(page, 'pagamento rotativo do cartão de crédito 250 reais');
    const st = await cardState(page);
    expect(st.bank).toBe(3350);
    expect(st.cards[0].limitUsed).toBe(250);
    const payments = st.txs.filter((t) => t.isCardPayment);
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe(250);
    expect(st.txs.filter((t) => t.description === 'Compra original' && t.amount === 500)).toHaveLength(1);
    expect(st.txs).toHaveLength(2);
  });

  test('D. "Paguei a fatura" com cartao unico: banco 3600->3350, usado 500->250', async ({ page }) => {
    await setupBank(page, 3600);
    await addCard(page, 'Nubank', 1000);
    await purchaseOnCard(page, 'Nubank', 500, 'Compra original');
    await voicePay(page, 'paguei 250 reais da fatura do cartão de crédito');
    const st = await cardState(page);
    expect(st.bank).toBe(3350);
    expect(st.cards[0].limitUsed).toBe(250);
    const payments = st.txs.filter((t) => t.isCardPayment);
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe(250);
  });

  test('E. Dois cartoes sem nome: 0 transacoes novas, tudo intacto, pede escolha', async ({ page }) => {
    await setupBank(page, 3600);
    await addCard(page, 'Nubank', 1000, 'Nubank');
    await addCard(page, 'Inter', 2000, 'Inter');
    await purchaseOnCard(page, 'Nubank', 500, 'Compra original');
    await voicePay(page, 'pagamento da fatura do cartão de crédito de 300 reais');
    const st = await cardState(page);
    expect(st.txs).toHaveLength(1);
    expect(st.bank).toBe(3600);
    expect(st.cards.find((c) => c.name === 'Nubank').limitUsed).toBe(500);
    expect(st.cards.find((c) => c.name === 'Inter').limitUsed).toBe(0);
    expect(st.txs.filter((t) => t.isCardPayment)).toHaveLength(0);
    await expect(page.locator('#modalTransactionForm')).not.toHaveClass(/hidden/);
  });

  test('F. Dois cartoes com nome: somente o Nubank e reduzido', async ({ page }) => {
    await setupBank(page, 3600);
    await addCard(page, 'Nubank', 1000, 'Nubank');
    await addCard(page, 'Inter', 2000, 'Inter');
    await purchaseOnCard(page, 'Nubank', 500, 'Compra original');
    await voicePay(page, 'paguei 300 reais da fatura do Nubank');
    const st = await cardState(page);
    expect(st.cards.find((c) => c.name === 'Nubank').limitUsed).toBe(200);
    expect(st.cards.find((c) => c.name === 'Inter').limitUsed).toBe(0);
    expect(st.bank).toBe(3300);
    const payments = st.txs.filter((t) => t.isCardPayment);
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe(300);
  });

  test('G. Nome inexistente: nada muda, pede identificacao', async ({ page }) => {
    await setupBank(page, 3600);
    await addCard(page, 'Nubank', 1000, 'Nubank');
    await purchaseOnCard(page, 'Nubank', 500, 'Compra original');
    await voicePay(page, 'paguei 300 reais da fatura do cartão BancoX');
    const st = await cardState(page);
    expect(st.txs).toHaveLength(1);
    expect(st.bank).toBe(3600);
    expect(st.cards[0].limitUsed).toBe(500);
    expect(st.txs.filter((t) => t.isCardPayment)).toHaveLength(0);
    await expect(page.locator('#modalTransactionForm')).not.toHaveClass(/hidden/);
  });

  test('H. Regressao de compra: compra 500 no credito nao debita o banco', async ({ page }) => {
    await setupBank(page, 3600);
    await addCard(page, 'Nubank', 1000);
    await page.evaluate(async () => {
      window.VoiceAssistantUI.currentParsedTx = window.TransactionAIParser.parseText('compra de 500 reais no cartão de crédito');
      await window.VoiceAssistantUI.confirmAndSave();
    });
    const st = await cardState(page);
    expect(st.cards[0].limitUsed).toBe(500);
    expect(st.bank).toBe(3600);
    expect(st.txs).toHaveLength(1);
    expect(st.txs[0].cardId).toBeTruthy();
    expect(st.txs[0].paymentMethod).toBe('credit');
    expect(st.txs[0].isCardPayment).toBe(false);
  });

  test('Conselheiro: executeAction com isCardPayment usa payCardAmount', async ({ page }) => {
    await setupBank(page, 3600);
    await addCard(page, 'Nubank', 1000);
    await purchaseOnCard(page, 'Nubank', 500, 'Compra original');
    await page.evaluate(async () => {
      const parsed = window.TransactionAIParser.parseText('paguei 300 reais da fatura do cartão de crédito');
      window.LinsoraStrategicAdvisor.executeAction({
        type: 'EXECUTE_TRANSACTION',
        payload: {
          type: 'DESPESA', amount: 300, description: parsed.description,
          category: 'Outros', date: parsed.date, paymentMethod: parsed.paymentMethod,
          cardHint: parsed.cardHint, isCardPayment: parsed.isCardPayment,
        },
      });
      await new Promise((r) => setTimeout(r, 50));
    });
    const st = await cardState(page);
    expect(st.cards[0].limitUsed).toBe(200);
    expect(st.bank).toBe(3300);
    expect(st.txs.filter((t) => t.isCardPayment)).toHaveLength(1);
  });
});
