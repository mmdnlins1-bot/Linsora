const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.use({ timezoneId: 'America/Sao_Paulo' });

// 29. Conselheiro: gasto igual/próximo da margem e inviável com números.
// Usa somente valores já calculados (saldo, margem, restante, pendentes,
// próximo recebimento). Sem frases genéricas no ramo de margem zerada.
// Roda nos projetos chromium (desktop) e mobile-chrome (mobile): Teste F.

const FIXED_NOW = new Date('2026-09-25T12:00:00-03:00');

test.describe('29. Gasto na margem: fatos e numeros reais', () => {

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

  async function seedFinance(page, { balance = 0, salarySept = 0, futureSalary = null, bills = [] } = {}) {
    await page.evaluate(async ({ balance, salarySept, futureSalary, bills }) => {
      const uid = window.linsoraStore.state.user.id;
      window.linsoraStore.state.accounts = [{ id: 'acc1', userId: uid, balance, name: 'Conta Principal' }];
      window.linsoraStore.state.transactions = [];
      window.linsoraStore.state.goals = [];
      window.linsoraStore.state.cards = [];
      if (salarySept > 0) {
        window.linsoraStore.state.transactions.push({
          id: 'tx_seed', userId: uid, type: 'RECEITA', amount: salarySept,
          description: 'Salario', category: 'Salário', date: '2026-09-25T12:00:00',
          account: 'Conta Principal', status: 'CONCLUIDO',
        });
      }
      if (futureSalary) {
        window.linsoraStore.state.transactions.push({
          id: 'tx_fut', userId: uid, type: 'RECEITA', amount: futureSalary.amount,
          description: 'Recebimento futuro', category: 'Salário', date: `${futureSalary.date}T12:00:00`,
          account: 'Conta Principal', status: 'CONCLUIDO',
        });
      }
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
    }, { balance, salarySept, futureSalary, bills });
  }

  async function askEval(page, text) {
    return page.evaluate((q) => {
      const norm = (s) => String(s || '').replace(/\u00a0/g, ' ');
      const a = window.LinsoraStrategicAdvisor.processQuery(q);
      return {
        severity: a.severity,
        rec: norm(a.recommendation),
        hasOptions: Array.isArray(a.commitmentOptions) && a.commitmentOptions.length > 0,
        titles: (a.commitmentOptions || []).map((o) => o.title).sort(),
        flowActive: window.LinsoraStrategicAdvisor.commitmentFlow !== null,
      };
    }, text);
  }

  test('A1. 3600/3600 sem compromissos: viavel, R$0 restante, sem generico', async ({ page }) => {
    await seedFinance(page, { balance: 3600 });
    const r = await askEval(page, 'Posso gastar 3600 reais hoje?');
    expect(r.severity).not.toBe('danger');
    expect(r.rec).toContain('R$ 3.600,00');
    expect(r.rec).toContain('R$ 0,00');
    expect(r.rec).toContain('fim do mês');
    expect(r.rec).toContain('Não há compromissos pendentes');
    expect(r.rec).not.toContain('segurar a onda');
    expect(r.rec).not.toContain('segure');
    expect(r.rec).not.toContain('maneire');
    expect(r.hasOptions).toBe(false);
    expect(r.flowActive).toBe(false);
  });

  test('A2. 3600/3600 com Internet e recebimento 05/10: fatos + data', async ({ page }) => {
    await seedFinance(page, {
      balance: 3600, salarySept: 3720,
      futureSalary: { amount: 5000, date: '2026-10-05' },
      bills: [{ title: 'Internet', amount: 120, dueDay: 28 }],
    });
    const r = await askEval(page, 'Posso gastar 3600 reais hoje?');
    expect(r.severity).toBe('warning');
    expect(r.rec).toContain('R$ 3.600,00');
    expect(r.rec).toContain('R$ 0,00');
    expect(r.rec).toContain('Internet');
    expect(r.rec).toContain('R$ 120,00');
    expect(r.rec).toContain('05/10/2026');
    expect(r.rec).not.toContain('segurar a onda');
    // Regra de relevância intacta: restante ~0 <= 2x120, pode perguntar.
    expect(r.hasOptions).toBe(true);
    expect(r.titles).toEqual(['Internet']);
    expect(r.flowActive).toBe(true);
  });

  test('B. 3600/3700: inviavel com margem, pedido e diferenca', async ({ page }) => {
    await seedFinance(page, { balance: 3600 });
    const r = await askEval(page, 'Posso gastar 3700 reais hoje?');
    expect(r.rec).toContain('R$ 3.600,00');
    expect(r.rec).toContain('R$ 3.700,00');
    expect(r.rec).toContain('R$ 100,00');
    expect(r.hasOptions).toBe(false);
    expect(r.flowActive).toBe(false);
  });

  test('C. 3600/400 com Internet: restante 3200, sem pergunta distante', async ({ page }) => {
    await seedFinance(page, {
      balance: 0, salarySept: 3720,
      bills: [{ title: 'Internet', amount: 120, dueDay: 28 }],
    });
    const r = await askEval(page, 'Posso gastar 400 reais hoje?');
    expect(r.severity).toBe('success');
    expect(r.rec).toContain('R$ 3.200,00');
    expect(r.rec).toContain('fim do mês');
    expect(r.hasOptions).toBe(false);
    expect(r.flowActive).toBe(false);
  });

  test('D. Margem 240, compromisso 120, gasto 50: restante 190, pode perguntar', async ({ page }) => {
    await seedFinance(page, {
      balance: 0, salarySept: 360,
      bills: [{ title: 'Internet', amount: 120, dueDay: 28 }],
    });
    const r = await askEval(page, 'Posso gastar 50 reais hoje?');
    expect(r.rec).toContain('R$ 190,00');
    expect(r.hasOptions).toBe(true);
    expect(r.titles).toEqual(['Internet']);
    expect(r.flowActive).toBe(true);
  });

  test('E. Margem 5000, gasto 6000: inviavel, sem fluxo de compromisso', async ({ page }) => {
    await seedFinance(page, { balance: 5000, salarySept: 5000 });
    const r = await askEval(page, 'Posso gastar 6000 reais hoje?');
    expect(r.rec).toContain('R$ 5.000,00');
    expect(r.rec).toContain('R$ 6.000,00');
    expect(r.rec).toContain('R$ 1.000,00');
    expect(r.hasOptions).toBe(false);
    expect(r.flowActive).toBe(false);
    await page.evaluate(() => { window.LinsoraStrategicAdvisor.processQuery('1'); });
    const occs = await page.evaluate(() => window.linsoraStore.state.occurrences.map((o) => o.status));
    expect(occs.every((s) => s !== 'PAID')).toBe(true);
  });
});
