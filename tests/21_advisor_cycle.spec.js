const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.use({ timezoneId: 'America/Sao_Paulo' });

// 21. Conselheiro: ciclo financeiro até o próximo recebimento.
// Cenários com datas relativas ao dia real de execução (sem datas fixas):
// aluguel vence ~hoje+2, internet ~hoje+12, recebimentos ~hoje+10 (A) e
// ~hoje+20 (B). Nenhuma fórmula de saldo é alterada por estes testes.

test.describe('21. Conselheiro: ciclo até o próximo recebimento', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();
    await login(page);
    await expect(page.locator('#tabDashboard')).toBeVisible();
  });

  function keyOf(d) {
    const p = (v) => String(v).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function shift(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return keyOf(d);
  }

  // Base mensal: receita 10000 + despesa 5940 no dia atual, saldo 0.
  // receiptOffsets: dias à frente com RECEITA futura (ex.: [10] ou [20]).
  async function seedCycle(page, receiptOffsets) {
    const today = keyOf(new Date());
    const aluguelDueDay = new Date(new Date().setDate(new Date().getDate() + 2)).getDate();
    const internetDueDay = new Date(new Date().setDate(new Date().getDate() + 12)).getDate();
    return page.evaluate(async ({ today, aluguelDueDay, internetDueDay, receiptOffsets }) => {
      const uid = window.linsoraStore.state.user.id;
      // Salário de hoje em horário local (toISOString após 21h locais cai no
      // dia seguinte em UTC e seria lido como recebimento futuro).
      const now = `${window.LinsoraUtils.toLocalDateKey()}T12:00:00`;
      window.linsoraStore.state.accounts = [{ id: 'acc1', balance: 0, name: 'Conta Principal' }];
      window.linsoraStore.state.goals = [];
      window.linsoraStore.state.transactions = [
        { id: 'tx_r', userId: uid, type: 'RECEITA', amount: 10000, description: 'Salario', category: 'Salário', date: now, account: 'Conta Principal', status: 'CONCLUIDO' },
        { id: 'tx_d', userId: uid, type: 'DESPESA', amount: 5940, description: 'Mercado', category: 'Alimentação', date: now, account: 'Conta Principal', status: 'CONCLUIDO' },
        ...receiptOffsets.map((off, i) => {
          const d = new Date();
          d.setDate(d.getDate() + off);
          const p = (v) => String(v).padStart(2, '0');
          const key = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
          return { id: `tx_f${i}`, userId: uid, type: 'RECEITA', amount: 5000, description: 'Recebimento futuro', category: 'Salário', date: `${key}T12:00:00`, account: 'Conta Principal', status: 'CONCLUIDO' };
        })
      ];
      await window.linsoraStore.addRecurringBill({
        title: 'Aluguel', amount: 2000, category: 'Moradia',
        frequency: 'MONTHLY', due_day: aluguelDueDay, start_date: '2026-01-01', end_date: null, active: true,
      });
      await window.linsoraStore.addRecurringBill({
        title: 'Internet', amount: 300, category: 'Moradia',
        frequency: 'MONTHLY', due_day: internetDueDay, start_date: '2026-01-01', end_date: null, active: true,
      });
      // Gera ocorrências do mês corrente + até o fim do ciclo e marca como
      // pagas as vencidas antes de hoje (simula contas antigas já quitadas).
      // Ordem importa: a janela mensal (que inclui vencidas do mês) primeiro.
      window.linsoraStore.ensureCurrentWindowOccurrences();
      const cyc = window.linsoraStore.ensureCycleOccurrences();
      const bills = window.linsoraStore.state.recurringBills;
      const ids = new Set(bills.map(b => b.id));
      window.linsoraStore.state.occurrences
        .filter(o => ids.has(o.recurringBillId) && o.dueDate && o.dueDate < today && o.status === 'PENDING')
        .forEach(o => window.linsoraStore.setOccurrenceStatus(o.id, { status: 'PAID' }));
      const m = window.LinsoraStrategicAdvisor.calculateRealMetrics(window.linsoraStore.state);
      return {
        today,
        nextReceipt: window.linsoraStore.getNextReceiptDate(),
        window: { startDate: cyc.startDate, endDate: cyc.endDate, usedFallback: cyc.usedFallback },
        cycleCommittedAmount: m.cycleCommittedAmount,
        cycleItems: m.cycleCommittedItems.map(i => i.title),
        cycleDays: m.cycleDays,
        available: m.availableBalanceForMonth,
        cycleMargin: m.cycleAvailableAfterCommitments,
        cycleDaily: m.cycleDailyLimit,
        monthlyCommitted: m.committedAmount,
        txCount: window.linsoraStore.state.transactions.length,
        balance: m.totalBalance,
      };
    }, { today, aluguelDueDay, internetDueDay, receiptOffsets });
  }

  function norm(s) {
    return String(s || '').replace(/\u00a0/g, ' ');
  }

  async function sendAndWait(page, text) {
    const before = await page.locator('.advisor-bot-msg').count();
    await page.fill('#advisorQueryInput', text);
    await page.click('#btnSubmitAdvisorQuery');
    await page.waitForFunction(
      (n) => document.querySelectorAll('.advisor-bot-msg').length > n, before, { timeout: 8000 }
    );
  }

  test('Teste 1: getNextReceiptDate retorna a menor data futura (A e B) e null sem receita (C)', async ({ page }) => {
    const a = await seedCycle(page, [10, 20]);
    expect(a.nextReceipt).toBe(shift(10));
    const b = await seedCycle(page, [20]);
    expect(b.nextReceipt).toBe(shift(20));
    const c = await seedCycle(page, []);
    expect(c.nextReceipt).toBe(null);
  });

  test('Teste 2: janela do ciclo e dias inclusivos', async ({ page }) => {
    const a = await seedCycle(page, [10]);
    expect(a.window.startDate).toBe(a.today);
    expect(a.window.endDate).toBe(shift(10));
    expect(a.window.usedFallback).toBe(false);
    const days = await page.evaluate(
      ([s, e]) => window.LinsoraStrategicAdvisor.constructor.inclusiveDaysBetween(s, e),
      [a.today, shift(10)]
    );
    expect(days).toBe(11);
    expect(await page.evaluate(() => window.LinsoraStrategicAdvisor.constructor.inclusiveDaysBetween('2026-09-25', '2026-10-05'))).toBe(11);
    expect(await page.evaluate(() => window.LinsoraStrategicAdvisor.constructor.inclusiveDaysBetween('2026-09-25', '2026-10-15'))).toBe(21);
    expect(await page.evaluate(() => window.LinsoraStrategicAdvisor.constructor.inclusiveDaysBetween('2026-09-25', '2026-09-25'))).toBe(1);
    const c = await seedCycle(page, []);
    expect(c.window.usedFallback).toBe(true);
    const lastDay = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    expect(c.window.endDate).toBe(`${c.today.slice(0, 8)}${String(lastDay).padStart(2, '0')}`);
  });

  test('Teste 3 (A): internet depois do recebimento não entra; margem 2060-base e diária = margem/11', async ({ page }) => {
    const st = await seedCycle(page, [10]);
    expect(st.cycleCommittedAmount).toBe(2000);
    expect(st.cycleItems).toEqual(['Aluguel']);
    expect(st.cycleDays).toBe(11);
    expect(st.cycleMargin).toBe(st.available - 2000);
    expect(st.cycleDaily).toBeCloseTo(st.cycleMargin / 11, 10);
  });

  test('Teste 4 (B): internet antes do recebimento entra; compromissos 2300 e diária = margem/21', async ({ page }) => {
    const st = await seedCycle(page, [20]);
    expect(st.cycleCommittedAmount).toBe(2300);
    expect(st.cycleItems.sort()).toEqual(['Aluguel', 'Internet']);
    expect(st.cycleDays).toBe(21);
    expect(st.cycleMargin).toBe(st.available - 2300);
    expect(st.cycleDaily).toBeCloseTo(st.cycleMargin / 21, 10);
  });

  test('Teste 5 (C): sem receita futura usa fallback do fim do mês', async ({ page }) => {
    const st = await seedCycle(page, []);
    expect(st.window.usedFallback).toBe(true);
    expect(st.cycleCommittedAmount).toBe(st.monthlyCommitted);
    expect(st.cycleMargin).toBe(st.available - st.monthlyCommitted);
    const m = await page.evaluate(() => {
      const x = window.LinsoraStrategicAdvisor.calculateRealMetrics(window.linsoraStore.state);
      return { daysRemaining: x.daysRemaining, cycleDays: x.cycleDays };
    });
    // No fallback, o ciclo coincide com o restante do mês.
    expect(st.cycleDays).toBe(m.daysRemaining);
    expect(m.cycleDays).toBe(m.daysRemaining);
    expect(st.cycleDaily).toBeCloseTo(st.cycleMargin / st.cycleDays, 10);
  });

  test('Teste 6: pergunta "posso gastar" usa o ciclo e o novo texto de limite', async ({ page }) => {
    await seedCycle(page, [10]);
    await page.click('#btnOpenAdvisorFromFeed');
    await expect(page.locator('#modalStrategicAdvisor')).not.toHaveClass(/hidden/);
    await sendAndWait(page, 'Posso gastar 1000 reais hoje?');
    const text = norm(await page.locator('.advisor-bot-msg').last().innerText());
    expect(text).toContain('limite diário até o próximo recebimento');
    expect(text).not.toContain('teto diário');
    // Somente o aluguel é listado para conferência (internet fora do ciclo).
    const items = page.locator('.advisor-bot-msg').last().locator('.commitment-option-item');
    await expect(items).toHaveCount(1);
    await expect(items.nth(0)).toContainText('Aluguel');
  });

  test('Teste 7: fluxo completo no ciclo (paga aluguel, sem duplicar, sem texto duplicado)', async ({ page }) => {
    const st = await seedCycle(page, [10]);
    const txBefore = st.txCount;
    await page.click('#btnOpenAdvisorFromFeed');
    await expect(page.locator('#modalStrategicAdvisor')).not.toHaveClass(/hidden/);
    await sendAndWait(page, 'Posso gastar 1000 reais hoje?');
    await expect(page.locator('.advisor-bot-msg').last()).toContainText('já pagou alguma dessas contas');
    await sendAndWait(page, '1');
    const confirm = page.locator('.advisor-bot-msg').last();
    await expect(confirm).toContainText('Deseja marcar essa conta como paga');
    await confirm.getByRole('button', { name: 'Confirmar' }).click();
    const result = page.locator('.advisor-bot-msg').last();
    await expect(result).toContainText('marcado como pago', { timeout: 8000 });
    const text = norm(await result.innerText());
    expect(text).toContain('Limite diário até o próximo recebimento');
    expect(text).toContain('É viável no ciclo, mas o gasto fica acima do limite diário planejado.');
    expect(text).not.toContain('teto diário');
    expect(text).not.toContain('Você tem');
    const after = await page.evaluate(() => {
      const bills = window.linsoraStore.state.recurringBills;
      const aluguel = bills.find(b => b.title === 'Aluguel');
      const internet = bills.find(b => b.title === 'Internet');
      const occs = window.linsoraStore.state.occurrences;
      const today = window.LinsoraUtils.toLocalDateKey();
      const win = window.linsoraStore.getCommitmentWindow();
      const inCycle = (bill) => occs.filter(o => o.recurringBillId === bill.id && o.dueDate >= today && o.dueDate <= win.endDate);
      const m = window.LinsoraStrategicAdvisor.calculateRealMetrics(window.linsoraStore.state);
      return {
        aluguelPaid: inCycle(aluguel).filter(o => o.status === 'PAID').length,
        aluguelPending: inCycle(aluguel).filter(o => o.status === 'PENDING').length,
        internetInCycle: inCycle(internet).length,
        cycleCommitted: m.cycleCommittedAmount,
        txCount: window.linsoraStore.state.transactions.length,
        balance: window.linsoraStore.getAccountsBalance(),
      };
    });
    expect(after.aluguelPaid).toBe(1);
    expect(after.aluguelPending).toBe(0);
    // Internet fora do ciclo: nenhuma ocorrência dela dentro da janela.
    expect(after.internetInCycle).toBe(0);
    expect(after.cycleCommitted).toBe(0);
    expect(after.txCount).toBe(txBefore);
    expect(after.balance).toBe(0);
  });
});
