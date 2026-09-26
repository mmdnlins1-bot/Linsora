const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.use({ timezoneId: 'America/Sao_Paulo' });

// 33. Bloco D1: roteamento direto de compra no crédito (sem modal genérico),
// confirmação compacta, merenda e descrições com acentos.
// Roda nos projetos chromium (desktop) e mobile-chrome (mobile) via config.

const FIXED_NOW = new Date('2026-09-25T12:00:00-03:00');

test.describe('33. Bloco D1 - roteamento direto e linguagem natural', () => {

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

  async function voiceDirect(page, phrase) {
    await page.evaluate((text) => {
      window.VoiceAssistantUI.processCapturedVoice(text);
    }, phrase);
    await page.waitForTimeout(150);
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

  test('P1. "50 reais no crédito" vira credit genérico', async ({ page }) => {
    const p = await page.evaluate(() => window.TransactionAIParser.parseText('50 reais no crédito'));
    expect(p.paymentMethod).toBe('credit');
    expect(p.cardHint).toBe(null);
    expect(p.isCardPayment).toBe(false);
    expect(p.type).toBe('DESPESA');
    expect(p.amount).toBe(50);
  });

  test('P2. "passei 50 reais no crédito" vira credit genérico', async ({ page }) => {
    const p = await page.evaluate(() => window.TransactionAIParser.parseText('passei 50 reais no crédito'));
    expect(p.paymentMethod).toBe('credit');
    expect(p.cardHint).toBe(null);
    expect(p.isCardPayment).toBe(false);
    expect(p.amount).toBe(50);
  });

  test('P3. "passei 50 reais no cartão" vira credit genérico', async ({ page }) => {
    const p = await page.evaluate(() => window.TransactionAIParser.parseText('passei 50 reais no cartão'));
    expect(p.paymentMethod).toBe('credit');
    expect(p.cardHint).toBe(null);
    expect(p.isCardPayment).toBe(false);
    expect(p.amount).toBe(50);
  });

  test('P4. "compra de 50 no cartão de crédito" vira credit com descrição acentuada', async ({ page }) => {
    const p = await page.evaluate(() => window.TransactionAIParser.parseText('compra de 50 reais no cartão de crédito'));
    expect(p.paymentMethod).toBe('credit');
    expect(p.cardHint).toBe(null);
    expect(p.isCardPayment).toBe(false);
    expect(p.description).toContain('cartão');
    expect(p.description).not.toContain('cartã crédito');
    expect(p.description).not.toMatch(/cartã[^o]/);
  });

  test('P5. "50 reais de gasolina" é despesa Transporte, sem crédito', async ({ page }) => {
    const p = await page.evaluate(() => window.TransactionAIParser.parseText('50 reais de gasolina'));
    expect(p.type).toBe('DESPESA');
    expect(p.category).toBe('Transporte');
    expect(p.paymentMethod).toBe(null);
    expect(p.isCardPayment).toBe(false);
  });

  test('P6. "50 reais de merenda" é Alimentação', async ({ page }) => {
    const p = await page.evaluate(() => window.TransactionAIParser.parseText('50 reais de merenda'));
    expect(p.type).toBe('DESPESA');
    expect(p.category).toBe('Alimentação');
    expect(p.paymentMethod).toBe(null);
  });

  test('P7. "50 reais de lanche" continua Alimentação', async ({ page }) => {
    const p = await page.evaluate(() => window.TransactionAIParser.parseText('50 reais de lanche'));
    expect(p.category).toBe('Alimentação');
  });

  test('P8. "50 reais na lanchonete" continua Alimentação', async ({ page }) => {
    const p = await page.evaluate(() => window.TransactionAIParser.parseText('50 reais na lanchonete'));
    expect(p.category).toBe('Alimentação');
  });

  test('N9. "paguei 50 da fatura" continua pagamento, nunca compra', async ({ page }) => {
    const p = await page.evaluate(() => window.TransactionAIParser.parseText('paguei 50 reais da fatura do cartão'));
    expect(p.isCardPayment).toBe(true);
    expect(p.paymentMethod).toBe('credit');
  });

  test('N10. "50 de gasolina" nunca vira crédito nem pagamento', async ({ page }) => {
    const p = await page.evaluate(() => window.TransactionAIParser.parseText('50 reais de gasolina'));
    expect(p.paymentMethod).toBe(null);
    expect(p.isCardPayment).toBe(false);
  });

  test('N11. "posso sacar 100?" continua WITHDRAW_QUESTION', async ({ page }) => {
    const intent = await page.evaluate(() => window.LinsoraStrategicAdvisor.detectIntent('posso sacar 100 reais?'));
    expect(intent).toBe('WITHDRAW_QUESTION');
  });

  test('N12. "posso gastar 100?" continua QUESTION', async ({ page }) => {
    const intent = await page.evaluate(() => window.LinsoraStrategicAdvisor.detectIntent('posso gastar 100 reais?'));
    expect(intent).toBe('QUESTION');
  });

  test('U13. Genérica no crédito pula o modal genérico e abre o seletor', async ({ page }) => {
    await setupBank(page, 3100);
    await addCard(page, 'Nubank', 5000, 3000, 'Nubank');
    await addCard(page, 'Banco Inter', 5000, 0, 'Inter');
    await voiceDirect(page, 'compra de 50 reais no cartão de crédito');
    await expect(page.locator('#modalVoiceConfirmation')).toHaveClass(/hidden/);
    await expect(page.locator('#modalCardPicker')).not.toHaveClass(/hidden/);
    await expect(page.locator('#modalCreditConfirm')).toHaveClass(/hidden/);
    const st = await cardState(page);
    expect(st.txs).toHaveLength(0);
    expect(st.bank).toBe(3100);
  });

  test('U14. Gasolina continua no modal normal de despesa', async ({ page }) => {
    await setupBank(page, 3100);
    await addCard(page, 'Nubank', 5000, 0, 'Nubank');
    await voiceDirect(page, 'compra de 150 reais de gasolina');
    await expect(page.locator('#modalVoiceConfirmation')).not.toHaveClass(/hidden/);
    await expect(page.locator('#modalCardPicker')).toHaveClass(/hidden/);
    await expect(page.locator('#modalCreditConfirm')).toHaveClass(/hidden/);
    await expect(page.locator('#voiceConfCategory')).toContainText('Transporte');
  });

  test('U15. 1 elegível: confirmação compacta e lançamento direto', async ({ page }) => {
    await setupBank(page, 3100);
    await addCard(page, 'Nubank', 1000, 1000, 'Nubank');
    await addCard(page, 'Banco Inter', 5000, 0, 'Inter');
    await voiceDirect(page, 'compra de 50 reais no cartão de crédito');
    await expect(page.locator('#modalVoiceConfirmation')).toHaveClass(/hidden/);
    await expect(page.locator('#modalCardPicker')).toHaveClass(/hidden/);
    await expect(page.locator('#modalCreditConfirm')).not.toHaveClass(/hidden/);
    await expect(page.locator('#creditConfCard')).toContainText('Banco Inter');
    await expect(page.locator('#creditConfAmount')).toContainText('50,00');
    let st = await cardState(page);
    expect(st.txs).toHaveLength(0);
    await page.locator('#btnCreditConfConfirm').click();
    await page.waitForTimeout(150);
    st = await cardState(page);
    expect(st.txs).toHaveLength(1);
    expect(st.txs[0].account).toBe('Cartão Banco Inter');
    expect(st.txs[0].paymentMethod).toBe('credit');
    expect(st.cards.find((c) => c.name === 'Banco Inter').limitUsed).toBe(50);
    expect(st.cards.find((c) => c.name === 'Nubank').limitUsed).toBe(1000);
    expect(st.bank).toBe(3100);
    await expect(page.locator('#modalCreditConfirm')).toHaveClass(/hidden/);
  });

  test('U16. 2+ elegíveis: seletor e depois confirmação compacta', async ({ page }) => {
    await setupBank(page, 3100);
    await addCard(page, 'Nubank', 5000, 3000, 'Nubank');
    await addCard(page, 'Banco Inter', 5000, 0, 'Inter');
    await voiceDirect(page, '50 reais no crédito');
    await expect(page.locator('#modalVoiceConfirmation')).toHaveClass(/hidden/);
    await expect(page.locator('#modalCardPicker')).not.toHaveClass(/hidden/);
    const st0 = await cardState(page);
    const interId = st0.cards.find((c) => c.name === 'Banco Inter').id;
    await page.locator(`#cardPickerList .card-picker-select[data-card-id="${interId}"]`).click();
    await page.waitForTimeout(150);
    await expect(page.locator('#modalCardPicker')).toHaveClass(/hidden/);
    await expect(page.locator('#modalCreditConfirm')).not.toHaveClass(/hidden/);
    await expect(page.locator('#creditConfCard')).toContainText('Banco Inter');
    let st = await cardState(page);
    expect(st.txs).toHaveLength(0);
    await page.locator('#btnCreditConfConfirm').click();
    await page.waitForTimeout(150);
    st = await cardState(page);
    expect(st.txs).toHaveLength(1);
    expect(st.txs[0].account).toBe('Cartão Banco Inter');
    expect(st.bank).toBe(3100);
  });

  test('U17. Explícito vai só ao Inter, sem seletor', async ({ page }) => {
    await setupBank(page, 3100);
    await addCard(page, 'Nubank', 5000, 0, 'Nubank');
    await addCard(page, 'Banco Inter', 5000, 0, 'Inter');
    await voiceDirect(page, 'compra no cartão de crédito do banco Inter de 50 reais');
    await expect(page.locator('#modalVoiceConfirmation')).toHaveClass(/hidden/);
    await expect(page.locator('#modalCardPicker')).toHaveClass(/hidden/);
    await expect(page.locator('#modalCreditConfirm')).not.toHaveClass(/hidden/);
    await expect(page.locator('#creditConfCard')).toContainText('Banco Inter');
    await page.locator('#btnCreditConfConfirm').click();
    await page.waitForTimeout(150);
    const st = await cardState(page);
    expect(st.txs).toHaveLength(1);
    expect(st.txs[0].account).toBe('Cartão Banco Inter');
    expect(st.cards.find((c) => c.name === 'Nubank').limitUsed).toBe(0);
    expect(st.bank).toBe(3100);
  });

  test('U18. Explícito sem limite: erro, nada salvo, sem confirmação', async ({ page }) => {
    await setupBank(page, 3100);
    await addCard(page, 'Nubank', 5000, 0, 'Nubank');
    await addCard(page, 'Banco Inter', 5000, 4950, 'Inter');
    await voiceDirect(page, 'compra no cartão de crédito do banco Inter de 100 reais');
    const st = await cardState(page);
    expect(st.txs).toHaveLength(0);
    expect(st.bank).toBe(3100);
    expect(st.cards.find((c) => c.name === 'Nubank').limitUsed).toBe(0);
    await expect(page.locator('#modalCreditConfirm')).toHaveClass(/hidden/);
    await expect(page.locator('#modalCardPicker')).toHaveClass(/hidden/);
  });

  test('U19. Cancelar a confirmação compacta não salva nada', async ({ page }) => {
    await setupBank(page, 3100);
    await addCard(page, 'Nubank', 1000, 1000, 'Nubank');
    await addCard(page, 'Banco Inter', 5000, 0, 'Inter');
    await voiceDirect(page, 'compra de 50 reais no cartão de crédito');
    await expect(page.locator('#modalCreditConfirm')).not.toHaveClass(/hidden/);
    await page.locator('#btnCreditConfCancel').click();
    await page.waitForTimeout(150);
    const st = await cardState(page);
    expect(st.txs).toHaveLength(0);
    expect(st.bank).toBe(3100);
    expect(st.cards.find((c) => c.name === 'Banco Inter').limitUsed).toBe(0);
    await expect(page.locator('#modalCreditConfirm')).toHaveClass(/hidden/);
  });
});
