const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.use({ timezoneId: 'America/Sao_Paulo' });

test.describe('16. Motor de compromissos (Etapa 1)', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();
    await login(page);
  });

  // Janela do mês corrente calculada no navegador (determinístico em qualquer data)
  async function curMonth(page) {
    return page.evaluate(() => {
      const n = new Date();
      const p = (v) => String(v).padStart(2, '0');
      const start = `${n.getFullYear()}-${p(n.getMonth() + 1)}-01`;
      const end = `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate())}`;
      return { start, end, due10: `${n.getFullYear()}-${p(n.getMonth() + 1)}-10` };
    });
  }

  async function addAccount(page, name, balance) {
    return page.evaluate(([n, b]) => window.linsoraStore.addAccount(
      { name: n, type: 'CORRENTE', balance: b }
    ), [name, balance]);
  }

  async function addBill(page, overrides = {}) {
    return page.evaluate((o) => window.linsoraStore.addRecurringBill({
      title: 'Internet', amount: 100, category: 'Serviços',
      frequency: 'MONTHLY', due_day: 10,
      start_date: '2026-01-01', end_date: null, active: true, ...o,
    }), overrides);
  }

  async function committed(page, dateKey) {
    return page.evaluate((k) => window.linsoraStore.getCommittedAmountUntil(k), dateKey);
  }

  test('1: cria recurring_bill válida e rejeita inválidas', async ({ page }) => {
    const bill = await addBill(page);
    expect(bill).toBeTruthy();
    expect(bill.id).toMatch(/^rb_/);
    expect(bill.frequency).toBe('MONTHLY');
    const count = await page.evaluate(() => window.linsoraStore.state.recurringBills.length);
    expect(count).toBe(1);
    expect(await addBill(page, { title: '' })).toBe(false);
    expect(await addBill(page, { amount: 0 })).toBe(false);
    expect(await addBill(page, { due_day: 32 })).toBe(false);
    expect(await addBill(page, { frequency: 'WEEKLY' })).toBe(false);
    expect(await addBill(page, { start_date: '2026-02-01', end_date: '2026-01-01' })).toBe(false);
  });

  test('2: ocorrência mensal dentro da janela', async ({ page }) => {
    const { start, end, due10 } = await curMonth(page);
    await addBill(page, { due_day: 10 });
    const added = await page.evaluate(
      ([s, e]) => window.linsoraStore.ensureRecurringOccurrences(s, e), [start, end]
    );
    expect(added).toBe(1);
    const occ = await page.evaluate(() => window.linsoraStore.state.occurrences[0]);
    expect(occ.dueDate).toBe(due10);
    expect(occ.status).toBe('PENDING');
    expect(occ.expectedAmount).toBe(100);
  });

  test('3/4: clamp de dia 31 em fevereiro e abril', async ({ page }) => {
    const out = await page.evaluate(() => ({
      feb: window.LinsoraUtils.generateMonthlyOccurrences(
        { id: 'b1', user_id: 'u1', amount: 50, due_day: 31, start_date: '2026-01-01', active: true },
        '2026-02-01', '2026-02-28'),
      apr: window.LinsoraUtils.generateMonthlyOccurrences(
        { id: 'b1', user_id: 'u1', amount: 50, due_day: 31, start_date: '2026-01-01', active: true },
        '2026-04-01', '2026-04-30'),
      inactive: window.LinsoraUtils.generateMonthlyOccurrences(
        { id: 'b1', user_id: 'u1', amount: 50, due_day: 10, start_date: '2026-01-01', active: false },
        '2026-09-01', '2026-09-30'),
    }));
    expect(out.feb.map(o => o.due_date)).toEqual(['2026-02-28']);
    expect(out.apr.map(o => o.due_date)).toEqual(['2026-04-30']);
    expect(out.inactive).toEqual([]);
  });

  test('5: geração idempotente não duplica', async ({ page }) => {
    const { start, end } = await curMonth(page);
    await addBill(page, { due_day: 10 });
    const a = await page.evaluate(
      ([s, e]) => window.linsoraStore.ensureRecurringOccurrences(s, e), [start, end]
    );
    const b = await page.evaluate(
      ([s, e]) => window.linsoraStore.ensureRecurringOccurrences(s, e), [start, end]
    );
    expect(a).toBe(1);
    expect(b).toBe(0);
    const count = await page.evaluate(() => window.linsoraStore.state.occurrences.length);
    expect(count).toBe(1);
  });

  test('6/7/8: PENDING entra, PAID e SKIPPED não entram', async ({ page }) => {
    const { start, end } = await curMonth(page);
    await addBill(page, { due_day: 10 });
    await page.evaluate(
      ([s, e]) => window.linsoraStore.ensureRecurringOccurrences(s, e), [start, end]
    );
    let res = await committed(page, end);
    expect(res.total).toBe(100);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].type).toBe('RECURRING_BILL');

    await page.evaluate(() => {
      const occ = window.linsoraStore.state.occurrences[0];
      return window.linsoraStore.setOccurrenceStatus(occ.id, { status: 'PAID' });
    });
    res = await committed(page, end);
    expect(res.total).toBe(0);

    await page.evaluate(() => {
      const occ = window.linsoraStore.state.occurrences[0];
      return window.linsoraStore.setOccurrenceStatus(occ.id, { status: 'SKIPPED' });
    });
    res = await committed(page, end);
    expect(res.total).toBe(0);

    expect(await page.evaluate(
      () => window.linsoraStore.setOccurrenceStatus('inexistente', { status: 'PAID' })
    )).toBe(false);
    expect(await page.evaluate(() => {
      const occ = window.linsoraStore.state.occurrences[0];
      return window.linsoraStore.setOccurrenceStatus(occ.id, { status: 'FUTURO' });
    })).toBe(false);
  });

  test('6b: ocorrência vencida continua elegível', async ({ page }) => {
    const { end } = await curMonth(page);
    await page.evaluate(() => {
      const uid = window.linsoraStore.state.user.id;
      window.linsoraStore.state.occurrences.push({
        id: 'rbocc_old', recurringBillId: 'rb_old', userId: uid,
        dueDate: '2020-01-05', expectedAmount: 75, status: 'PENDING',
        paidAmount: null, paidAt: null, transactionId: null,
      });
    });
    const res = await committed(page, end);
    expect(res.total).toBe(75);
  });

  test('9: outro usuário nunca entra; vínculo cruzado rejeitado', async ({ page }) => {
    const { start, end } = await curMonth(page);
    await addBill(page, { due_day: 10 });
    await page.evaluate(
      ([s, e]) => window.linsoraStore.ensureRecurringOccurrences(s, e), [start, end]
    );
    await page.evaluate(() => {
      window.linsoraStore.state.occurrences.push({
        id: 'rbocc_fake', recurringBillId: 'rb_fake', userId: 'outro_usuario',
        dueDate: '2026-09-10', expectedAmount: 9999, status: 'PENDING',
        paidAmount: null, paidAt: null, transactionId: null,
      });
      window.linsoraStore.state.transactions.push({
        id: 'tx_fake', userId: 'outro_usuario', type: 'DESPESA',
        description: 'Fake', amount: 1, category: 'Outros',
        date: '2026-09-01', account: 'Conta', status: 'CONCLUIDO',
      });
    });
    const res = await committed(page, end);
    expect(res.total).toBe(100);
    expect(res.items.every(i => i.originId !== 'rbocc_fake')).toBe(true);

    expect(await page.evaluate(
      () => window.linsoraStore.setOccurrenceStatus('rbocc_fake', { status: 'PAID' })
    )).toBe(false);
    const ownId = await page.evaluate(() => window.linsoraStore.state.occurrences[0].id);
    expect(await page.evaluate(
      ([id]) => window.linsoraStore.setOccurrenceStatus(id, { status: 'PAID', transaction_id: 'tx_fake' }), [ownId]
    )).toBe(false);
  });

  test('10/11: cartão sem uso não entra; com uso e vencimento na janela entra', async ({ page }) => {
    const { end } = await curMonth(page);
    await page.evaluate(() => window.linsoraStore.addCard(
      { name: 'Visa Teste', brand: 'Visa', limitTotal: 5000, closingDay: 15, dueDay: 1 }
    ));
    let res = await committed(page, end);
    expect(res.items.filter(i => i.type === 'CARD_INVOICE')).toHaveLength(0);

    await page.evaluate(([d]) => window.linsoraStore.saveTransaction({
      type: 'DESPESA', amount: 300, description: 'Compra cartão',
      category: 'Outros', date: d, account: 'Cartão Visa Teste',
      repetition: 'SINGLE', notes: '',
    }), [end]);
    res = await committed(page, end);
    const inv = res.items.find(i => i.type === 'CARD_INVOICE');
    expect(inv).toBeTruthy();
    expect(inv.amount).toBe(300);
  });

  test('12/13: vencimento fora da janela futura não entra; vencida entra', async ({ page }) => {
    const out = await page.evaluate(() => ({
      futuro: window.LinsoraUtils.resolveInvoiceDueDate(25, '2026-10-01', '2026-10-05', '2026-09-24'),
      vencida: window.LinsoraUtils.resolveInvoiceDueDate(10, '2026-09-20', '2026-09-24', '2026-09-24'),
      dentro: window.LinsoraUtils.resolveInvoiceDueDate(10, '2026-09-01', '2026-09-30', '2026-09-24'),
    }));
    expect(out.futuro).toBe(null);
    expect(out.vencida).toBe('2026-09-10');
    expect(out.dentro).toBe('2026-09-10');
  });

  test('14/15: pagar fatura zera compromisso sem dupla contagem', async ({ page }) => {
    const { end } = await curMonth(page);
    await addAccount(page, 'Conta Teste', 800);
    await page.evaluate(() => window.linsoraStore.addCard(
      { name: 'Visa Paga', brand: 'Visa', limitTotal: 5000, closingDay: 15, dueDay: 1 }
    ));
    await page.evaluate(([d]) => window.linsoraStore.saveTransaction({
      type: 'DESPESA', amount: 300, description: 'Compra cartão',
      category: 'Outros', date: d, account: 'Cartão Visa Paga',
      repetition: 'SINGLE', notes: '',
    }), [end]);

    expect(await page.evaluate(
      ([k]) => window.linsoraStore.getAvailableMargin(k), [end]
    )).toBe(500);

    await page.evaluate(async () => {
      const card = window.linsoraStore.state.cards.find(c => c.name === 'Visa Paga');
      return window.linsoraStore.payCardInvoice(card.id);
    });
    expect(await page.evaluate(
      ([k]) => window.linsoraStore.getAvailableMargin(k), [end]
    )).toBe(500);
    const res = await committed(page, end);
    expect(res.items.filter(i => i.type === 'CARD_INVOICE')).toHaveLength(0);
  });

  test('16: recorrência + cartão combinados', async ({ page }) => {
    const { start, end } = await curMonth(page);
    await addAccount(page, 'Conta Combo', 1000);
    await addBill(page, { title: 'Luz', amount: 200, due_day: 10 });
    await page.evaluate(
      ([s, e]) => window.linsoraStore.ensureRecurringOccurrences(s, e), [start, end]
    );
    await page.evaluate(() => window.linsoraStore.addCard(
      { name: 'Master Combo', brand: 'Mastercard', limitTotal: 5000, closingDay: 15, dueDay: 1 }
    ));
    await page.evaluate(([d]) => window.linsoraStore.saveTransaction({
      type: 'DESPESA', amount: 300, description: 'Compra cartão',
      category: 'Outros', date: d, account: 'Cartão Master Combo',
      repetition: 'SINGLE', notes: '',
    }), [end]);

    expect(await page.evaluate(
      ([k]) => window.linsoraStore.getAvailableMargin(k), [end]
    )).toBe(500);
  });

  test('17/18/19: metas, fórmula exata e fixed_bills fora do motor', async ({ page }) => {
    const { start, end } = await curMonth(page);
    await addAccount(page, 'Conta Metas', 1000);
    await addBill(page, { title: 'Luz', amount: 200, due_day: 10 });
    await page.evaluate(
      ([s, e]) => window.linsoraStore.ensureRecurringOccurrences(s, e), [start, end]
    );
    const antes = await committed(page, end);

    await page.evaluate(() => window.linsoraStore.addGoal({
      title: 'Viagem', target: 10000, current: 0,
      category: 'Economia', deadline: '2027-01-01', icon: '🎯', monthlyContribution: 500,
    }));
    await page.evaluate(() => {
      window.linsoraStore.state.fixedBills.push(
        { id: 'fb1', title: 'Legada', amount: 777, dueDay: 5 }
      );
    });

    const depois = await committed(page, end);
    expect(depois.total).toBe(antes.total);
    expect(depois.total).toBe(200);
    const margem = await page.evaluate(
      ([k]) => window.linsoraStore.getAvailableMargin(k), [end]
    );
    expect(margem).toBe(800);
  });

  test('20: isolamento entre usuários A e B', async ({ page }) => {
    const { start, end } = await curMonth(page);
    await addBill(page, { title: 'Internet A', amount: 100, due_day: 10 });
    await page.evaluate(
      ([s, e]) => window.linsoraStore.ensureRecurringOccurrences(s, e), [start, end]
    );
    expect((await committed(page, end)).total).toBe(100);

    await page.click('.bottom-nav .nav-item[data-tab="tabProfile"]');
    await expect(page.locator('#tabProfile')).toBeVisible();
    await page.click('#btnLogout');
    await expect(page.locator('#authScreen')).toBeVisible();

    await page.click('#btnToggleAuthMode');
    await page.fill('#authName', 'Usuário B');
    await page.fill('#authEmail', 'usuarioB@linsora.com.br');
    await page.fill('#authPassword', 'senha456');
    await page.fill('#authConfirmPassword', 'senha456');
    await page.click('#btnSubmitAuth');
    await expect(page.locator('#appMain')).toBeVisible();

    expect(await page.evaluate(
      () => window.linsoraStore.state.recurringBills.length
    )).toBe(0);
    expect((await committed(page, end)).total).toBe(0);
  });

  test('21: datas locais corretas às 22:30 e 23:30', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-24T22:30:00-03:00') });
    await page.reload();
    const out = await page.evaluate(() => ({
      hoje: window.LinsoraUtils.toLocalDateKey(new Date()),
      dez: window.LinsoraUtils.generateMonthlyOccurrences(
        { id: 'b1', user_id: 'u1', amount: 50, due_day: 10, start_date: '2026-01-01', active: true },
        '2026-09-01', '2026-09-30').map(o => o.due_date),
      fev: window.LinsoraUtils.clampDayOfMonth(2026, 1, 31),
      fatura: window.LinsoraUtils.resolveInvoiceDueDate(31, '2026-02-01', '2026-02-28', '2026-02-15'),
    }));
    expect(out.hoje).toBe('2026-09-24');
    expect(out.dez).toEqual(['2026-09-10']);
    expect(out.fev).toBe(28);
    expect(out.fatura).toBe('2026-02-28');
  });
});
