const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.use({ timezoneId: 'America/Sao_Paulo' });

// 22. Persistência de compromissos recorrentes (IDs UUID + durabilidade).
// Relógio fixo em 25/09/2026 para os cenários Energia (28/09) e Aluguel (30/09).
// Roda nos projetos chromium (desktop) e mobile-chrome (mobile) via config.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIXED_NOW = new Date('2026-09-25T12:00:00-03:00');

test.describe('22. Compromissos recorrentes persistentes', () => {

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

  function cacheKeys() {
    return Object.keys(localStorage).filter((k) => k.startsWith('LINSORA_DB_CACHE_'));
  }

  async function seedEnergiaAluguel(page) {
    return page.evaluate(async () => {
      const uid = window.linsoraStore.state.user.id;
      const energia = await window.linsoraStore.addRecurringBill({
        title: 'Energia', amount: 300, category: 'Moradia',
        frequency: 'MONTHLY', due_day: 28, start_date: '2026-01-01', end_date: null, active: true,
      });
      const aluguel = await window.linsoraStore.addRecurringBill({
        title: 'Aluguel', amount: 2000, category: 'Moradia',
        frequency: 'MONTHLY', due_day: 30, start_date: '2026-01-01', end_date: null, active: true,
      });
      const added = window.linsoraStore.ensureCycleOccurrences();
      window.linsoraStore.persistState();
      return {
        uid,
        energiaId: energia.id,
        aluguelId: aluguel.id,
        window: { startDate: added.startDate, endDate: added.endDate, usedFallback: added.usedFallback },
      };
    });
  }

  test('A/B/C: cria regra, gera ocorrência, ambos com ID UUID', async ({ page }) => {
    const out = await page.evaluate(() => {
      const before = window.linsoraStore.state.occurrences.length;
      return window.linsoraStore.addRecurringBill({
        title: 'Energia', amount: 300, category: 'Moradia',
        frequency: 'MONTHLY', due_day: 28, start_date: '2026-01-01', end_date: null, active: true,
      }).then((bill) => {
        const added = window.linsoraStore.ensureRecurringOccurrences('2026-09-01', '2026-09-30');
        const occ = window.linsoraStore.state.occurrences.find((o) => o.recurringBillId === bill.id);
        return {
          billId: bill.id,
          occId: occ?.id,
          dueDate: occ?.dueDate,
          status: occ?.status,
          expectedAmount: occ?.expectedAmount,
          added,
          before,
        };
      });
    });
    expect(out.billId).toMatch(UUID_RE);
    expect(out.occId).toMatch(UUID_RE);
    expect(out.dueDate).toBe('2026-09-28');
    expect(out.status).toBe('PENDING');
    expect(out.expectedAmount).toBe(300);
    expect(out.added).toBe(1);
  });

  test('D: ocorrência criada é persistida no armazenamento local', async ({ page }) => {
    await seedEnergiaAluguel(page);
    await page.waitForFunction(() => {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith('LINSORA_DB_CACHE_'));
      return keys.some((k) => {
        try {
          const d = JSON.parse(localStorage.getItem(k));
          return (d?.occurrences || []).length >= 2;
        } catch (e) { return false; }
      });
    }, { timeout: 8000 });
    const persisted = await page.evaluate(() => {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith('LINSORA_DB_CACHE_'));
      for (const k of keys) {
        const d = JSON.parse(localStorage.getItem(k));
        if ((d?.occurrences || []).length >= 2) return d.occurrences;
      }
      return [];
    });
    expect(persisted.length).toBeGreaterThanOrEqual(2);
    expect(persisted.every((o) => UUID_RE.test(o.id))).toBe(true);
  });

  test('E/F: reload + novo login preservam Energia 28/09 e Aluguel 30/09', async ({ page }) => {
    await seedEnergiaAluguel(page);
    await page.waitForFunction(() => {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith('LINSORA_DB_CACHE_'));
      return keys.some((k) => {
        try { return (JSON.parse(localStorage.getItem(k))?.occurrences || []).length >= 2; }
        catch (e) { return false; }
      });
    }, { timeout: 8000 });

    await page.reload();
    await login(page);

    const st = await page.evaluate(() => {
      const c = window.LinsoraStrategicAdvisor
        ? window.linsoraStore.getCommitmentsUntilNextReceipt()
        : null;
      return {
        bills: window.linsoraStore.state.recurringBills.map((b) => b.title).sort(),
        occs: window.linsoraStore.state.occurrences
          .filter((o) => o.status === 'PENDING')
          .map((o) => o.dueDate).sort(),
        cycle: c ? { total: c.total, items: c.items.map((i) => `${i.title}:${i.amount}:${i.dueDate}`), endDate: c.endDate } : null,
      };
    });
    expect(st.bills).toEqual(['Aluguel', 'Energia']);
    expect(st.occs).toContain('2026-09-28');
    expect(st.occs).toContain('2026-09-30');
    expect(st.cycle.total).toBe(2300);
    expect(st.cycle.endDate).toBe('2026-09-30');
  });

  test('G: geração idempotente nunca duplica (Aluguel 30/09 único)', async ({ page }) => {
    await seedEnergiaAluguel(page);
    const counts = await page.evaluate(() => {
      const win = window.linsoraStore.getCommitmentWindow();
      const a = window.linsoraStore.ensureRecurringOccurrences(win.startDate, win.endDate);
      const b = window.linsoraStore.ensureRecurringOccurrences(win.startDate, win.endDate);
      const c = window.linsoraStore.ensureCycleOccurrences();
      const d = window.linsoraStore.ensureRecurringOccurrences(win.startDate, win.endDate);
      const occs = window.linsoraStore.state.occurrences.filter(
        (o) => o.dueDate === '2026-09-30' && o.status === 'PENDING'
      );
      return { a, b, d, endDate: c.endDate, sept30: occs.length, total: window.linsoraStore.state.occurrences.length };
    });
    expect(counts.a).toBe(0);
    expect(counts.b).toBe(0);
    expect(counts.d).toBe(0);
    expect(counts.sept30).toBe(1);
  });

  test('G2: migração de IDs legados rb_* é segura, única e idempotente', async ({ page }) => {
    const out = await page.evaluate(() => {
      const uid = window.linsoraStore.state.user.id;
      window.linsoraStore.state.recurringBills.push({
        id: 'rb_legacy1', userId: uid, title: 'Legada', amount: 50,
        category: 'Moradia', frequency: 'MONTHLY', dueDay: 15,
        startDate: '2026-09-01', endDate: null, active: true,
      });
      window.linsoraStore.state.occurrences.push({
        id: 'rbocc_legacy1', recurringBillId: 'rb_legacy1', userId: uid,
        dueDate: '2026-09-15', expectedAmount: 50, status: 'PENDING',
        paidAmount: null, paidAt: null, transactionId: null,
      });
      const added1 = window.linsoraStore.ensureRecurringOccurrences('2026-09-01', '2026-09-30');
      const bill = window.linsoraStore.state.recurringBills.find((b) => b.title === 'Legada');
      const occs = window.linsoraStore.state.occurrences.filter((o) => o.dueDate === '2026-09-15');
      const added2 = window.linsoraStore.ensureRecurringOccurrences('2026-09-01', '2026-09-30');
      const occsAfter = window.linsoraStore.state.occurrences.filter((o) => o.dueDate === '2026-09-15');
      return {
        added1,
        billId: bill.id,
        occIds: occs.map((o) => o.id),
        occBillRef: occs.map((o) => o.recurringBillId),
        countBefore: occs.length,
        added2,
        countAfter: occsAfter.length,
      };
    });
    expect(out.added1).toBe(0); // já existia; só migrou o formato do ID
    expect(out.billId).toMatch(UUID_RE);
    expect(out.occIds).toHaveLength(1);
    expect(out.occIds[0]).toMatch(UUID_RE);
    expect(out.occBillRef[0]).toBe(out.billId);
    expect(out.added2).toBe(0);
    expect(out.countAfter).toBe(1);
  });

  test('H/I/J: PENDING entra; PAID e SKIPPED não entram', async ({ page }) => {
    await seedEnergiaAluguel(page);
    const res = await page.evaluate(() => {
      const end = '2026-09-30';
      const pending = window.linsoraStore.getCommittedAmountUntil(end).total;
      const occs = window.linsoraStore.state.occurrences.filter((o) => o.status === 'PENDING');
      window.linsoraStore.setOccurrenceStatus(occs[0].id, { status: 'PAID' });
      const afterPaid = window.linsoraStore.getCommittedAmountUntil(end).total;
      const rest = window.linsoraStore.state.occurrences.filter((o) => o.status === 'PENDING');
      window.linsoraStore.setOccurrenceStatus(rest[0].id, { status: 'SKIPPED' });
      const afterSkipped = window.linsoraStore.getCommittedAmountUntil(end).total;
      return { pending, afterPaid, afterSkipped };
    });
    expect(res.pending).toBe(2300);
    expect(res.afterPaid).toBe(2000);
    expect(res.afterSkipped).toBe(0);
  });

  test('K/L: ciclo sem receita futura encontra Energia e Aluguel (total 2300)', async ({ page }) => {
    const seed = await seedEnergiaAluguel(page);
    expect(seed.window).toEqual({ startDate: '2026-09-25', endDate: '2026-09-30', usedFallback: true });
    const cycle = await page.evaluate(() => window.linsoraStore.getCommitmentsUntilNextReceipt());
    expect(cycle.startDate).toBe('2026-09-25');
    expect(cycle.endDate).toBe('2026-09-30');
    expect(cycle.nextReceiptDate).toBe(null);
    expect(cycle.usedFallback).toBe(true);
    expect(cycle.total).toBe(2300);
    const byTitle = Object.fromEntries(cycle.items.map((i) => [i.title, i]));
    expect(byTitle.Energia.amount).toBe(300);
    expect(byTitle.Energia.dueDate).toBe('2026-09-28');
    expect(byTitle.Aluguel.amount).toBe(2000);
    expect(byTitle.Aluguel.dueDate).toBe('2026-09-30');
  });

  test('M/N: ciclo até 05/10 inclui 30/09 e exclui 07/10', async ({ page }) => {
    const cycle = await page.evaluate(async () => {
      const uid = window.linsoraStore.state.user.id;
      await window.linsoraStore.addRecurringBill({
        title: 'Aluguel', amount: 2000, category: 'Moradia',
        frequency: 'MONTHLY', due_day: 30, start_date: '2026-01-01', end_date: null, active: true,
      });
      await window.linsoraStore.addRecurringBill({
        title: 'Internet', amount: 300, category: 'Moradia',
        frequency: 'MONTHLY', due_day: 7, start_date: '2026-01-01', end_date: null, active: true,
      });
      // Gera janela ampla (set+out) e quita as vencidas de setembro (contas antigas).
      window.linsoraStore.ensureRecurringOccurrences('2026-09-01', '2026-10-31');
      const today = window.LinsoraUtils.toLocalDateKey();
      window.linsoraStore.state.occurrences
        .filter((o) => o.userId === uid && o.dueDate && o.dueDate < today && o.status === 'PENDING')
        .forEach((o) => window.linsoraStore.setOccurrenceStatus(o.id, { status: 'PAID' }));
      window.linsoraStore.state.transactions.push({
        id: window.LinsoraUtils.generateUUID(), userId: uid, type: 'RECEITA',
        description: 'Salario', amount: 5000, category: 'Salário',
        date: '2026-10-05T12:00:00', account: 'Conta Principal', status: 'CONCLUIDO',
      });
      window.linsoraStore.ensureCycleOccurrences();
      return window.linsoraStore.getCommitmentsUntilNextReceipt();
    });
    expect(cycle.startDate).toBe('2026-09-25');
    expect(cycle.endDate).toBe('2026-10-05');
    expect(cycle.usedFallback).toBe(false);
    expect(cycle.total).toBe(2000);
    expect(cycle.items.map((i) => i.title)).toEqual(['Aluguel']);
  });

  test('O: ciclo até 15/10 inclui o compromisso de 07/10', async ({ page }) => {
    const cycle = await page.evaluate(async () => {
      const uid = window.linsoraStore.state.user.id;
      await window.linsoraStore.addRecurringBill({
        title: 'Internet', amount: 300, category: 'Moradia',
        frequency: 'MONTHLY', due_day: 7, start_date: '2026-01-01', end_date: null, active: true,
      });
      window.linsoraStore.ensureRecurringOccurrences('2026-09-01', '2026-10-31');
      const today = window.LinsoraUtils.toLocalDateKey();
      window.linsoraStore.state.occurrences
        .filter((o) => o.userId === uid && o.dueDate && o.dueDate < today && o.status === 'PENDING')
        .forEach((o) => window.linsoraStore.setOccurrenceStatus(o.id, { status: 'PAID' }));
      window.linsoraStore.state.transactions.push({
        id: window.LinsoraUtils.generateUUID(), userId: uid, type: 'RECEITA',
        description: 'Salario', amount: 5000, category: 'Salário',
        date: '2026-10-15T12:00:00', account: 'Conta Principal', status: 'CONCLUIDO',
      });
      window.linsoraStore.ensureCycleOccurrences();
      return window.linsoraStore.getCommitmentsUntilNextReceipt();
    });
    expect(cycle.endDate).toBe('2026-10-15');
    expect(cycle.total).toBe(300);
    expect(cycle.items.map((i) => `${i.title}:${i.dueDate}`)).toEqual(['Internet:2026-10-07']);
  });

  test('Conselheiro: pergunta de gasto lista Energia+Aluguel e o fluxo de confirmação quita', async ({ page }) => {
    await seedEnergiaAluguel(page);
    // Margem para a regra de proximidade: receita 5000 -> margem 2700,
    // gasto 100 -> restante 2600 <= 2x2300 (pergunta); sem isso o gasto
    // seria inviável (saldo 0) e a conferência não abriria.
    await page.evaluate(() => {
      const uid = window.linsoraStore.state.user.id;
      window.linsoraStore.state.accounts = [{ id: 'acc1', userId: uid, balance: 0, name: 'Conta Principal' }];
      window.linsoraStore.state.transactions.push({
        id: window.LinsoraUtils.generateUUID(), userId: uid, type: 'RECEITA',
        description: 'Salario', amount: 5000, category: 'Salário',
        date: '2026-09-25T12:00:00', account: 'Conta Principal', status: 'CONCLUIDO',
      });
    });
    const first = await page.evaluate(() => {
      const advice = window.LinsoraStrategicAdvisor.processQuery('Posso gastar 100 reais hoje?');
      return {
        options: (advice.commitmentOptions || []).map((o) => o.title).sort(),
        recommendation: advice.recommendation,
      };
    });
    expect(first.options).toEqual(['Aluguel', 'Energia']);
    expect(first.recommendation).toContain('já pagou');

    const second = await page.evaluate(() => {
      const advice = window.LinsoraStrategicAdvisor.processQuery('1 e 2');
      return { title: advice.title, recommendation: advice.recommendation };
    });
    expect(second.title).toContain('Confirmar');

    const third = await page.evaluate(() => {
      const advice = window.LinsoraStrategicAdvisor.processQuery('sim, pode confirmar');
      const m = window.LinsoraStrategicAdvisor.calculateRealMetrics(window.linsoraStore.state);
      const paid = (advice.settlementBlocks || []).filter((b) => b.kind === 'paid');
      return {
        paidLabels: paid.map((b) => b.label),
        cycleCommitted: m.cycleCommittedAmount,
      };
    });
    expect(third.cycleCommitted).toBe(0);
    expect(third.paidLabels.length).toBeGreaterThan(0);
  });
});
