const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.use({ timezoneId: 'America/Sao_Paulo' });

// 32. Bloco C: compra com cartao identificado/generico + "posso sacar?".
// Roda nos projetos chromium (desktop) e mobile-chrome (mobile) via config.

const FIXED_NOW = new Date('2026-09-25T12:00:00-03:00');

test.describe('32. Bloco C - compra por cartao e saque', () => {

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
      window.linsoraStore.persistState();
    }, balance);
  }

  async function addCard(page, name, limitTotal, limitUsed, brand) {
    await page.evaluate(async ({ name, limitTotal, limitUsed, brand }) => {
      await window.linsoraStore.addCard({ name, brand: brand || name, limitTotal, closingDay: 15, dueDay: 22 });
      const card = window.linsoraStore.state.cards.find((c) => c.name === name);
      card.limitUsed = limitUsed || 0;
      window.linsoraStore.persistState();
      await new Promise((r) => setTimeout(r, 5));
    }, { name, limitTotal, limitUsed, brand });
  }

  async function voiceBuy(page, phrase) {
    await page.evaluate(async (text) => {
      window.VoiceAssistantUI.currentParsedTx = window.TransactionAIParser.parseText(text);
      await window.VoiceAssistantUI.confirmAndSave();
    }, phrase);
  }

  async function cardState(page) {
    return page.evaluate(() => ({
      cards: window.linsoraStore.state.cards.map((c) => ({
        id: c.id, name: c.name, limitTotal: Number(c.limitTotal), limitUsed: Number(c.limitUsed),
      })),
      bank: window.linsoraStore.getAccountsBalance(),
      txs: window.linsoraStore.state.transactions.map((t) => ({
        description: t.description, amount: Number(t.amount), account: t.account,
        cardId: t.cardId || null, isCardPayment: t.isCardPayment === true, type: t.type,
        paymentMethod: t.paymentMethod || null,
      })),
    }));
  }

  test('Parser: "compra no cartao de credito do banco Inter de mil reais" vira credit + hint banco inter', async ({ page }) => {
    const parsed = await page.evaluate(() => {
      const p = window.TransactionAIParser.parseText('compra no cartão de crédito do banco Inter de mil reais');
      return { method: p.paymentMethod, hint: p.cardHint, pay: p.isCardPayment, amount: p.amount, type: p.type };
    });
    expect(parsed.method).toBe('credit');
    expect(parsed.pay).toBe(false);
    expect(parsed.amount).toBe(1000);
    expect(parsed.type).toBe('DESPESA');
    expect(parsed.hint).toBe('banco inter');
  });

  test('Parser: fatura do Bloco A continua com hint null', async ({ page }) => {
    const parsed = await page.evaluate(() => {
      const phrases = [
        'pagamento da fatura do cartão de crédito de 300 reais',
        'paguei 250 reais da fatura do cartão de crédito',
      ];
      return phrases.map((text) => {
        const p = window.TransactionAIParser.parseText(text);
        return { method: p.paymentMethod, hint: p.cardHint, pay: p.isCardPayment };
      });
    });
    expect(parsed[0]).toEqual({ method: 'credit', hint: null, pay: true });
    expect(parsed[1]).toEqual({ method: 'credit', hint: null, pay: true });
  });

  test('A. Compra explicita no Inter: Inter +1000, Nubank e banco intactos', async ({ page }) => {
    await setupBank(page, 3100);
    await addCard(page, 'Nubank', 5000, 4000, 'Nubank');
    await addCard(page, 'Banco Inter', 5000, 0, 'Inter');
    await voiceBuy(page, 'compra no cartão de crédito do banco Inter de mil reais');
    const st = await cardState(page);
    expect(st.bank).toBe(3100);
    expect(st.cards.find((c) => c.name === 'Banco Inter').limitUsed).toBe(1000);
    expect(st.cards.find((c) => c.name === 'Nubank').limitUsed).toBe(4000);
    expect(st.txs).toHaveLength(1);
    expect(st.txs[0].account).toBe('Cartão Banco Inter');
    expect(st.txs[0].paymentMethod).toBe('credit');
    expect(st.txs[0].isCardPayment).toBe(false);
  });

  test('B. Explicito sem limite: nada salvo, nenhum fallback', async ({ page }) => {
    await setupBank(page, 3100);
    await addCard(page, 'Nubank', 5000, 0, 'Nubank');
    await addCard(page, 'Banco Inter', 5000, 4800, 'Inter');
    await voiceBuy(page, 'compra no cartão de crédito do banco Inter de mil reais');
    const st = await cardState(page);
    expect(st.txs).toHaveLength(0);
    expect(st.bank).toBe(3100);
    expect(st.cards.find((c) => c.name === 'Banco Inter').limitUsed).toBe(4800);
    expect(st.cards.find((c) => c.name === 'Nubank').limitUsed).toBe(0);
    await expect(page.locator('#modalCardPicker')).toHaveClass(/hidden/);
  });

  test('C. Generica com 1 elegivel: auto no Inter', async ({ page }) => {
    await setupBank(page, 3100);
    await addCard(page, 'Nubank', 1000, 1000, 'Nubank');
    await addCard(page, 'Banco Inter', 5000, 0, 'Inter');
    await voiceBuy(page, 'compra no cartão de crédito de 1000 reais');
    const st = await cardState(page);
    expect(st.txs).toHaveLength(1);
    expect(st.txs[0].account).toBe('Cartão Banco Inter');
    expect(st.cards.find((c) => c.name === 'Banco Inter').limitUsed).toBe(1000);
    expect(st.cards.find((c) => c.name === 'Nubank').limitUsed).toBe(1000);
    expect(st.bank).toBe(3100);
    await expect(page.locator('#modalCardPicker')).toHaveClass(/hidden/);
  });

  test('D. Generica com 2 elegiveis: modal aparece, nada auto', async ({ page }) => {
    await setupBank(page, 3100);
    await addCard(page, 'Nubank', 5000, 3000, 'Nubank');
    await addCard(page, 'Banco Inter', 5000, 0, 'Inter');
    await voiceBuy(page, 'compra no cartão de crédito de 1000 reais');
    let st = await cardState(page);
    expect(st.txs).toHaveLength(0);
    expect(st.bank).toBe(3100);
    await expect(page.locator('#modalCardPicker')).not.toHaveClass(/hidden/);
    // Seleciona o Inter pelo modal: identidade preservada por cardId.
    const interId = st.cards.find((c) => c.name === 'Banco Inter').id;
    await page.locator(`#cardPickerList .card-picker-select[data-card-id="${interId}"]`).click();
    await page.waitForTimeout(150);
    st = await cardState(page);
    expect(st.txs).toHaveLength(1);
    expect(st.txs[0].account).toBe('Cartão Banco Inter');
    expect(st.cards.find((c) => c.name === 'Banco Inter').limitUsed).toBe(1000);
    expect(st.cards.find((c) => c.name === 'Nubank').limitUsed).toBe(3000);
  });

  test('E. Tres cartoes, 2 elegiveis: terceiro desabilitado', async ({ page }) => {
    await setupBank(page, 3100);
    await addCard(page, 'Nubank', 1000, 1000, 'Nubank');
    await addCard(page, 'Banco Inter', 5000, 1500, 'Inter');
    await addCard(page, 'Santander', 5000, 3000, 'Santander');
    await voiceBuy(page, 'compra no cartão de crédito de 1000 reais');
    const st = await cardState(page);
    expect(st.txs).toHaveLength(0);
    await expect(page.locator('#modalCardPicker')).not.toHaveClass(/hidden/);
    const disabled = page.locator('#cardPickerList .card-picker-item.disabled');
    await expect(disabled).toHaveCount(1);
    await expect(disabled).toContainText('Nubank');
    await expect(disabled).toContainText('Sem limite suficiente');
    await expect(page.locator('#cardPickerList .card-picker-select')).toHaveCount(2);
  });

  test('F. Nenhum elegivel: erro, nada salvo', async ({ page }) => {
    await setupBank(page, 3100);
    await addCard(page, 'Nubank', 1000, 1000, 'Nubank');
    await addCard(page, 'Banco Inter', 1000, 900, 'Inter');
    await voiceBuy(page, 'compra no cartão de crédito de 1000 reais');
    const st = await cardState(page);
    expect(st.txs).toHaveLength(0);
    expect(st.bank).toBe(3100);
    await expect(page.locator('#modalCardPicker')).toHaveClass(/hidden/);
  });

  test('G. Compra normal 1 cartao continua funcionando', async ({ page }) => {
    await setupBank(page, 3600);
    await addCard(page, 'Nubank', 1000, 0);
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
  });

  test('H. Fatura Bloco A continua funcionando', async ({ page }) => {
    await setupBank(page, 3600);
    await addCard(page, 'Nubank', 1000, 500);
    await page.evaluate(async () => {
      window.VoiceAssistantUI.currentParsedTx = window.TransactionAIParser.parseText('pagamento da fatura do cartão de crédito de 300 reais');
      await window.VoiceAssistantUI.confirmAndSave();
    });
    const st = await cardState(page);
    expect(st.bank).toBe(3300);
    expect(st.cards[0].limitUsed).toBe(200);
    expect(st.txs.filter((t) => t.isCardPayment)).toHaveLength(1);
  });

  test('I. Rotativo parcial continua funcionando', async ({ page }) => {
    await setupBank(page, 3600);
    await addCard(page, 'Nubank', 1000, 500);
    await page.evaluate(async () => {
      window.VoiceAssistantUI.currentParsedTx = window.TransactionAIParser.parseText('pagamento rotativo do cartão de crédito 250 reais');
      await window.VoiceAssistantUI.confirmAndSave();
    });
    const st = await cardState(page);
    expect(st.bank).toBe(3350);
    expect(st.cards[0].limitUsed).toBe(250);
    expect(st.txs.filter((t) => t.isCardPayment)).toHaveLength(1);
  });

  test('J. "posso sacar 100?" com 3100: viavel por saldo', async ({ page }) => {
    await setupBank(page, 3100);
    const res = await page.evaluate(() => {
      const intent = window.LinsoraStrategicAdvisor.detectIntent('posso sacar 100 reais?');
      const advice = window.LinsoraStrategicAdvisor.processQuery('posso sacar 100 reais?');
      return { intent, severity: advice.severity, title: advice.title, rec: advice.recommendation, diag: advice.diagnosis };
    });
    expect(res.intent).toBe('WITHDRAW_QUESTION');
    expect(res.severity).toBe('success');
    expect(res.rec).toMatch(/saldo suficiente/i);
  });

  test('K. "posso sacar 4000?" com 3100: insuficiencia de saldo', async ({ page }) => {
    await setupBank(page, 3100);
    const res = await page.evaluate(() => {
      const advice = window.LinsoraStrategicAdvisor.processQuery('posso sacar 4000 reais?');
      return { severity: advice.severity, rec: advice.recommendation };
    });
    expect(res.severity).toBe('danger');
    expect(res.rec).toMatch(/saldo.*suficiente|faltam/i);
  });

  test('L. "posso gastar 100?" continua em QUESTION com margem do ciclo', async ({ page }) => {
    await setupBank(page, 3100);
    const res = await page.evaluate(() => {
      const intent = window.LinsoraStrategicAdvisor.detectIntent('posso gastar 100 reais?');
      return { intent };
    });
    expect(res.intent).toBe('QUESTION');
    expect(res.intent).not.toBe('WITHDRAW_QUESTION');
  });

  test('Conselheiro: compra explicita valida limite sem fallback', async ({ page }) => {
    await setupBank(page, 3100);
    await addCard(page, 'Nubank', 5000, 0, 'Nubank');
    await addCard(page, 'Banco Inter', 5000, 4800, 'Inter');
    const err = await page.evaluate(() => {
      const parsed = window.TransactionAIParser.parseText('compra no cartão de crédito do banco Inter de 1000 reais');
      try {
        window.LinsoraStrategicAdvisor.executeAction({
          type: 'EXECUTE_TRANSACTION',
          payload: {
            type: 'DESPESA', amount: 1000, description: parsed.description,
            category: 'Outros', date: parsed.date, paymentMethod: parsed.paymentMethod,
            cardHint: parsed.cardHint, isCardPayment: parsed.isCardPayment, rawText: 'compra no cartão de crédito do banco Inter de 1000 reais',
          },
        });
        return null;
      } catch (e) { return String(e.message); }
    });
    expect(err).toMatch(/limite suficiente/i);
    const st = await cardState(page);
    expect(st.txs).toHaveLength(0);
    expect(st.cards.find((c) => c.name === 'Nubank').limitUsed).toBe(0);
  });
});
