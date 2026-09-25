const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.use({ timezoneId: 'America/Sao_Paulo' });

// 26. Conselheiro: relevância da conferência (viabilidade + proximidade) e
// envio mobile. A conferência de compromissos só abre quando o gasto é
// viável na margem do ciclo E o restante após o gasto fica próximo
// (<= 2x) dos compromissos PENDING do ciclo. O envio do form cobre
// teclados móveis que não emitem 'keypress' (Gboard "Ir").
// Roda nos projetos chromium (desktop) e mobile-chrome (mobile) via config.

const FIXED_NOW = new Date('2026-09-25T12:00:00-03:00');

test.describe('26. Relevancia da conferencia + envio mobile', () => {

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

  async function seedFinance(page, { balance = 0, salary = 0, bills = [] } = {}) {
    await page.evaluate(async ({ balance, salary, bills }) => {
      const uid = window.linsoraStore.state.user.id;
      window.linsoraStore.state.accounts = [{ id: 'acc1', userId: uid, balance, name: 'Conta Principal' }];
      window.linsoraStore.state.transactions = salary > 0 ? [{
        id: 'tx_seed', userId: uid, type: 'RECEITA', amount: salary,
        description: 'Salario', category: 'Salário', date: '2026-09-25T12:00:00',
        account: 'Conta Principal', status: 'CONCLUIDO',
      }] : [];
      window.linsoraStore.state.goals = [];
      for (const b of bills) {
        await window.linsoraStore.addRecurringBill({
          title: b.title, amount: b.amount, category: 'Moradia',
          frequency: 'MONTHLY', due_day: b.dueDay, start_date: '2026-01-01',
          end_date: null, active: true,
        });
      }
      window.linsoraStore.ensureCurrentWindowOccurrences();
      window.linsoraStore.ensureCycleOccurrences();
      window.linsoraStore.persistState();
    }, { balance, salary, bills });
  }

  async function askEval(page, text) {
    return page.evaluate((q) => {
      const a = window.LinsoraStrategicAdvisor.processQuery(q);
      return {
        hasOptions: Array.isArray(a.commitmentOptions) && a.commitmentOptions.length > 0,
        titles: (a.commitmentOptions || []).map((o) => o.title).sort(),
        rec: a.recommendation || '',
        severity: a.severity,
        flowActive: window.LinsoraStrategicAdvisor.commitmentFlow !== null,
      };
    }, text);
  }

  async function pendingStatuses(page) {
    return page.evaluate(() => window.linsoraStore.state.occurrences
      .filter((o) => o.dueDate && o.dueDate.startsWith('2026-09'))
      .map((o) => o.status).sort());
  }

  test('1. Gasto inviavel (6000 > margem): sem pergunta de compromissos', async ({ page }) => {
    await seedFinance(page, { balance: 5000, salary: 5000, bills: [{ title: 'Internet', amount: 120, dueDay: 28 }] });
    const r = await askEval(page, 'Posso gastar 6000 reais hoje?');
    expect(r.hasOptions).toBe(false);
    expect(r.flowActive).toBe(false);
    expect(r.rec).toContain('Faltam fundos');
    // Responder "1" depois não pode marcar nada como pago.
    await page.evaluate(() => { window.LinsoraStrategicAdvisor.processQuery('1'); });
    expect(await pendingStatuses(page)).toEqual(['PENDING']);
  });

  test('2. Gasto distante (400, restante 4480 > 240): viavel, sem pergunta', async ({ page }) => {
    await seedFinance(page, { balance: 5000, salary: 5000, bills: [{ title: 'Internet', amount: 120, dueDay: 28 }] });
    const r = await askEval(page, 'Posso gastar 400 reais hoje?');
    expect(r.hasOptions).toBe(false);
    expect(r.flowActive).toBe(false);
    expect(r.severity).not.toBe('danger');
    expect(await pendingStatuses(page)).toEqual(['PENDING']);
  });

  test('3. Gasto proximo (50, restante 70 <= 240): pergunta o compromisso', async ({ page }) => {
    await seedFinance(page, { balance: 240, salary: 240, bills: [{ title: 'Internet', amount: 120, dueDay: 28 }] });
    const r = await askEval(page, 'Posso gastar 50 reais hoje?');
    expect(r.hasOptions).toBe(true);
    expect(r.titles).toEqual(['Internet']);
    expect(r.rec).toContain('já pagou');
    expect(r.flowActive).toBe(true);
  });

  test('4. Varios compromissos: soma dos PENDING (2300) na proximidade', async ({ page }) => {
    await seedFinance(page, {
      balance: 0, salary: 8000,
      bills: [
        { title: 'Energia', amount: 300, dueDay: 28 },
        { title: 'Aluguel', amount: 2000, dueDay: 30 },
      ],
    });
    // Margem 5700; gasto 5000 -> restante 700 <= 4600: pergunta (2 opções).
    const r = await askEval(page, 'Posso gastar 5000 reais hoje?');
    expect(r.hasOptions).toBe(true);
    expect(r.titles).toEqual(['Aluguel', 'Energia']);
  });

  test('5. PAID nao entra no calculo de proximidade', async ({ page }) => {
    await seedFinance(page, {
      balance: 0, salary: 8000,
      bills: [
        { title: 'Energia', amount: 300, dueDay: 28 },
        { title: 'Aluguel', amount: 2000, dueDay: 30 },
      ],
    });
    await page.evaluate(() => {
      const occ = window.linsoraStore.state.occurrences.find((o) => o.dueDate === '2026-09-28');
      window.linsoraStore.setOccurrenceStatus(occ.id, { status: 'PAID' });
    });
    // Só Aluguel pendente: pergunta lista apenas ele.
    const r = await askEval(page, 'Posso gastar 5000 reais hoje?');
    expect(r.hasOptions).toBe(true);
    expect(r.titles).toEqual(['Aluguel']);
  });

  test('6. SKIPPED nao entra no calculo de proximidade', async ({ page }) => {
    await seedFinance(page, {
      balance: 0, salary: 8000,
      bills: [
        { title: 'Energia', amount: 300, dueDay: 28 },
        { title: 'Aluguel', amount: 2000, dueDay: 30 },
      ],
    });
    await page.evaluate(() => {
      const occ = window.linsoraStore.state.occurrences.find((o) => o.dueDate === '2026-09-28');
      window.linsoraStore.setOccurrenceStatus(occ.id, { status: 'SKIPPED' });
    });
    const r = await askEval(page, 'Posso gastar 5000 reais hoje?');
    expect(r.hasOptions).toBe(true);
    expect(r.titles).toEqual(['Aluguel']);
  });

  async function sendAndWait(page, text) {
    const before = await page.locator('.advisor-bot-msg').count();
    await page.fill('#advisorQueryInput', text);
    await page.click('#btnSubmitAdvisorQuery');
    await page.waitForFunction(
      (n) => document.querySelectorAll('.advisor-bot-msg').length > n, before, { timeout: 8000 }
    );
  }

  test('7/8. Fluxo completo (desktop e mobile): pergunta, "1", confirma, PAID, recalculo, layout', async ({ page }) => {
    // Margem 5700 (salário 8000 - 2300); gasto 2000 -> restante 3700 <= 4600.
    await seedFinance(page, {
      balance: 0, salary: 8000,
      bills: [
        { title: 'Energia', amount: 300, dueDay: 28 },
        { title: 'Aluguel', amount: 2000, dueDay: 30 },
      ],
    });
    await page.click('#btnOpenAdvisorFromFeed');
    await expect(page.locator('#modalStrategicAdvisor')).not.toHaveClass(/hidden/);

    await sendAndWait(page, 'Posso gastar 2000 reais hoje?');
    await expect(page.locator('.advisor-bot-msg').last()).toContainText('já pagou alguma dessas contas');
    const items = page.locator('.advisor-bot-msg').last().locator('.commitment-option-item');
    await expect(items).toHaveCount(2);

    await sendAndWait(page, '1');
    const confirm = page.locator('.advisor-bot-msg').last();
    await expect(confirm).toContainText('Deseja marcar essa conta como paga');
    await confirm.getByRole('button', { name: 'Confirmar' }).click();

    const result = page.locator('.advisor-bot-msg').last();
    await expect(result).toContainText('marcado como pago', { timeout: 8000 });
    await expect(result.locator('.settlement-blocks')).toBeVisible();

    const st = await page.evaluate(() => {
      const byBill = {};
      window.linsoraStore.state.recurringBills.forEach((b) => { byBill[b.id] = b.title; });
      return {
        statuses: window.linsoraStore.state.occurrences
          .filter((o) => o.dueDate && o.dueDate.startsWith('2026-09'))
          .map((o) => `${byBill[o.recurringBillId]}:${o.dueDate}:${o.status}`).sort(),
        committed: window.linsoraStore.getCommittedAmountUntil('2026-09-30').total,
      };
    });
    expect(st.statuses).toContain('Energia:2026-09-28:PAID');
    expect(st.statuses).toContain('Aluguel:2026-09-30:PENDING');
    expect(st.committed).toBe(2000);
  });

  test('Envio pelo submit do form (teclado movel): processa a pergunta', async ({ page }) => {
    await seedFinance(page, { balance: 240, salary: 240, bills: [{ title: 'Internet', amount: 120, dueDay: 28 }] });
    await page.click('#btnOpenAdvisorFromFeed');
    await expect(page.locator('#modalStrategicAdvisor')).not.toHaveClass(/hidden/);

    const before = await page.locator('.advisor-bot-msg').count();
    await page.fill('#advisorQueryInput', 'Posso gastar 50 reais hoje?');
    // Simula o botão "Ir/Enviar" do teclado virtual: dispara o submit do
    // form sem passar por click nem keypress.
    await page.locator('#advisorForm').evaluate((f) => { f.requestSubmit(); });
    await page.waitForFunction(
      (n) => document.querySelectorAll('.advisor-bot-msg').length > n, before, { timeout: 8000 }
    );
    await expect(page.locator('.advisor-bot-msg').last()).toContainText('já pagou alguma dessas contas');
  });
});
