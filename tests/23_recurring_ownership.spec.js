const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.use({ timezoneId: 'America/Sao_Paulo' });

// 23. Titularidade das recorrências: o usuário autenticado (state.user.id) é
// a fonte de verdade. Somente placeholder pré-autenticação
// ('guest'/'usr_guest'/vazio) é adotado; outro usuário concreto NUNCA é.
// Roda nos projetos chromium (desktop) e mobile-chrome (mobile) via config.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIXED_NOW = new Date('2026-09-25T12:00:00-03:00');
const AUTH_UUID = '123e4567-e89b-42d3-a456-426614174000';
const FOREIGN_UUID = '123e4567-e89b-42d3-a456-426614174999';

test.describe('23. Titularidade das recorrências', () => {

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

  // Simula um usuário autenticado (UUID real) com recorrências legadas
  // criadas antes do login (userId placeholder). Retorna o estado base.
  async function seedLegacyAs(page, uid) {
    return page.evaluate((authId) => {
      window.linsoraStore.state.user.id = authId;
      const mkBill = (title, amount, dueDay) => ({
        id: `rb_legacy_${dueDay}`, userId: 'usr_guest', title, amount,
        category: 'Moradia', frequency: 'MONTHLY', dueDay,
        startDate: '2026-01-01', endDate: null, active: true,
      });
      window.linsoraStore.state.recurringBills.push(
        mkBill('Energia', 300, 28),
        mkBill('Aluguel', 2000, 30)
      );
      const win = window.linsoraStore.ensureCycleOccurrences();
      window.linsoraStore.persistState();
      const uidNow = window.linsoraStore.state.user.id;
      return {
        uid: uidNow,
        window: { startDate: win.startDate, endDate: win.endDate },
        bills: window.linsoraStore.state.recurringBills.map((b) => ({
          title: b.title, id: b.id, userId: b.userId, amount: b.amount,
          category: b.category, startDate: b.startDate, active: b.active,
        })),
        occs: window.linsoraStore.state.occurrences.map((o) => ({
          bill: o.recurringBillId, dueDate: o.dueDate, status: o.status,
          userId: o.userId, expectedAmount: o.expectedAmount,
        })),
      };
    }, uid);
  }

  test('A: recorrência de placeholder é materializada em PENDING para o autenticado', async ({ page }) => {
    const st = await seedLegacyAs(page, AUTH_UUID);
    expect(st.window).toEqual({ startDate: '2026-09-25', endDate: '2026-09-30' });
    const byDue = Object.fromEntries(st.occs.map((o) => [o.dueDate, o]));
    expect(byDue['2026-09-28'].status).toBe('PENDING');
    expect(byDue['2026-09-28'].expectedAmount).toBe(300);
    expect(byDue['2026-09-28'].userId).toBe(AUTH_UUID);
    expect(byDue['2026-09-30'].status).toBe('PENDING');
    expect(byDue['2026-09-30'].expectedAmount).toBe(2000);
    expect(byDue['2026-09-30'].userId).toBe(AUTH_UUID);
  });

  test('B: userId correto em regra e ocorrência; demais campos preservados', async ({ page }) => {
    const st = await seedLegacyAs(page, AUTH_UUID);
    for (const b of st.bills) {
      expect(b.userId).toBe(AUTH_UUID);
      expect(b.id).toMatch(UUID_RE);
    }
    const energia = st.bills.find((b) => b.title === 'Energia');
    expect(energia.amount).toBe(300);
    expect(energia.category).toBe('Moradia');
    expect(energia.startDate).toBe('2026-01-01');
    expect(energia.active).toBe(true);
    for (const o of st.occs) {
      expect(o.userId).toBe(AUTH_UUID);
      expect(st.bills.some((b) => b.id === o.bill)).toBe(true);
    }
  });

  test('C: userId concreto de outro usuário NUNCA é importado', async ({ page }) => {
    const out = await page.evaluate(([authId, foreignId]) => {
      window.linsoraStore.state.user.id = authId;
      window.linsoraStore.state.recurringBills.push({
        id: 'rb_outro', userId: foreignId, title: 'Conta Alheia', amount: 999,
        category: 'Moradia', frequency: 'MONTHLY', dueDay: 28,
        startDate: '2026-01-01', endDate: null, active: true,
      });
      window.linsoraStore.state.occurrences.push({
        id: 'rbocc_outra', recurringBillId: 'rb_outro', userId: foreignId,
        dueDate: '2026-09-28', expectedAmount: 999, status: 'PENDING',
        paidAmount: null, paidAt: null, transactionId: null,
      });
      const win = window.linsoraStore.ensureCycleOccurrences();
      const bill = window.linsoraStore.state.recurringBills.find((b) => b.title === 'Conta Alheia');
      const occ = window.linsoraStore.state.occurrences.find((o) => o.recurringBillId === 'rb_outro');
      return {
        endDate: win.endDate,
        billUserId: bill.userId,
        occUserId: occ.userId,
        committed: window.linsoraStore.getCommittedAmountUntil('2026-09-30').total,
        ownOccs: window.linsoraStore.state.occurrences.filter((o) => o.userId === authId).length,
      };
    }, [AUTH_UUID, FOREIGN_UUID]);
    expect(out.billUserId).toBe(FOREIGN_UUID);
    expect(out.occUserId).toBe(FOREIGN_UUID);
    expect(out.committed).toBe(0);
    expect(out.ownOccs).toBe(0);
  });

  test('D/E: reload + novo login mantêm titularidade e compromissos', async ({ page }) => {
    await page.evaluate(async () => {
      await window.linsoraStore.addRecurringBill({
        title: 'Energia', amount: 300, category: 'Moradia',
        frequency: 'MONTHLY', due_day: 28, start_date: '2026-01-01', end_date: null, active: true,
      });
      await window.linsoraStore.addRecurringBill({
        title: 'Aluguel', amount: 2000, category: 'Moradia',
        frequency: 'MONTHLY', due_day: 30, start_date: '2026-01-01', end_date: null, active: true,
      });
      window.linsoraStore.ensureCycleOccurrences();
      window.linsoraStore.persistState();
    });
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
      const uid = window.linsoraStore.state.user.id;
      return {
        uid,
        bills: window.linsoraStore.state.recurringBills.map((b) => ({ title: b.title, userId: b.userId })),
        occs: window.linsoraStore.state.occurrences.map((o) => ({ dueDate: o.dueDate, status: o.status, userId: o.userId })),
        committed: window.linsoraStore.getCommittedAmountUntil('2026-09-30').total,
        // Mesmo predicado usado pela lista de recorrências da interface.
        listed: window.linsoraStore.state.recurringBills
          .filter((b) => (b.userId || b.user_id) === uid).map((b) => b.title).sort(),
      };
    });
    expect(st.bills.length).toBe(2);
    expect(st.bills.every((b) => b.userId === st.uid)).toBe(true);
    expect(st.occs.every((o) => o.userId === st.uid)).toBe(true);
    expect(st.occs.filter((o) => o.status === 'PENDING').map((o) => o.dueDate).sort())
      .toEqual(['2026-09-28', '2026-09-30']);
    expect(st.committed).toBe(2300);
    expect(st.listed).toEqual(['Aluguel', 'Energia']);
  });

  test('F/G: Energia e Aluguel PENDING; getCommittedAmountUntil(30/09) = 2300', async ({ page }) => {
    await seedLegacyAs(page, AUTH_UUID);
    const out = await page.evaluate(() => {
      const r = window.linsoraStore.getCommittedAmountUntil('2026-09-30');
      return {
        total: r.total,
        items: r.items.map((i) => `${i.type}:${i.title}:${i.amount}:${i.dueDate}`),
      };
    });
    expect(out.total).toBe(2300);
    expect(out.items.sort()).toEqual([
      'RECURRING_BILL:Aluguel:2000:2026-09-30',
      'RECURRING_BILL:Energia:300:2026-09-28',
    ]);
  });

  test('H: getPendingRecurringOptions retorna as duas opções', async ({ page }) => {
    await seedLegacyAs(page, AUTH_UUID);
    const opts = await page.evaluate(() => {
      const m = window.LinsoraStrategicAdvisor.calculateRealMetrics(window.linsoraStore.state);
      return window.LinsoraStrategicAdvisor.getPendingRecurringOptions(m)
        .map((o) => `${o.title}:${o.amount}:${o.dueDate}`);
    });
    expect(opts.sort()).toEqual(['Aluguel:2000:2026-09-30', 'Energia:300:2026-09-28']);
  });

  test('I: "posso gastar R$2.000?" volta a apresentar a confirmação', async ({ page }) => {
    await seedLegacyAs(page, AUTH_UUID);
    const res = await page.evaluate(() => {
      const advice = window.LinsoraStrategicAdvisor.processQuery('Posso gastar 2000 reais hoje?');
      return {
        options: (advice.commitmentOptions || []).map((o) => o.title).sort(),
        recommendation: advice.recommendation,
      };
    });
    expect(res.options).toEqual(['Aluguel', 'Energia']);
    expect(res.recommendation).toContain('já pagou');
  });

  test('J/K: confirmar só a Energia marca só ela como PAID; Aluguel segue PENDING', async ({ page }) => {
    await seedLegacyAs(page, AUTH_UUID);
    const first = await page.evaluate(() => {
      const advice = window.LinsoraStrategicAdvisor.processQuery('Posso gastar 2000 reais hoje?');
      return advice.commitmentOptions || [];
    });
    const nEnergia = first.find((o) => o.title === 'Energia').n;
    await page.evaluate((n) => {
      window.LinsoraStrategicAdvisor.processQuery(String(n));
    }, nEnergia);
    const after = await page.evaluate(() => {
      const advice = window.LinsoraStrategicAdvisor.processQuery('sim, pode confirmar');
      const occs = window.linsoraStore.state.occurrences;
      const byBill = {};
      window.linsoraStore.state.recurringBills.forEach((b) => { byBill[b.id] = b.title; });
      return {
        statuses: occs.map((o) => `${byBill[o.recurringBillId]}:${o.dueDate}:${o.status}`).sort(),
        cycleCommitted: window.linsoraStore.getCommitmentsUntilNextReceipt().total,
        paidBlocks: (advice.settlementBlocks || []).filter((b) => b.kind === 'paid').length,
      };
    });
    expect(after.statuses).toContain('Energia:2026-09-28:PAID');
    expect(after.statuses).toContain('Aluguel:2026-09-30:PENDING');
    expect(after.cycleCommitted).toBe(2000);
    expect(after.paidBlocks).toBeGreaterThan(0);
  });

  test('L: outro usuário não enxerga esses compromissos', async ({ page }) => {
    await seedLegacyAs(page, AUTH_UUID);
    const out = await page.evaluate((foreignId) => {
      window.linsoraStore.state.user.id = foreignId;
      const uid = window.linsoraStore.state.user.id;
      const committed = window.linsoraStore.getCommittedAmountUntil('2026-09-30');
      return {
        total: committed.total,
        items: committed.items.length,
        listed: window.linsoraStore.state.recurringBills
          .filter((b) => (b.userId || b.user_id) === uid).length,
        upcoming: window.linsoraStore.state.recurringBills
          .filter((b) => (b.userId || b.user_id) === uid).length,
      };
    }, FOREIGN_UUID);
    expect(out.total).toBe(0);
    expect(out.items).toBe(0);
    expect(out.listed).toBe(0);
    expect(out.upcoming).toBe(0);
  });
});
