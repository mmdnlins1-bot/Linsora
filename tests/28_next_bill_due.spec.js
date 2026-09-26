const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.use({ timezoneId: 'America/Sao_Paulo' });

// 28. nextBillDue não reanuncia data paga: o fallback derivado pula datas
// que já possuem ocorrência (PENDING/PAID/SKIPPED). Vale para o card
// "Próximos compromissos" e para a lista de contas recorrentes (ambos usam
// nextBillDue, sem lógica duplicada). Nada é ressuscitado, nada é criado.
// Roda nos projetos chromium (desktop) e mobile-chrome (mobile) via config.

const FIXED_NOW = new Date('2026-09-25T12:00:00-03:00');
const TODAY = '2026-09-25';
const UID_A = 'user-a-0001';
const UID_B = 'user-b-0002';

test.describe('28. Pago nao volta como proximo compromisso', () => {

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

  function bill(id, uid, title = 'Internet', amount = 120, dueDay = 29) {
    return {
      id, userId: uid, title, amount, category: 'Moradia', frequency: 'MONTHLY',
      dueDay, startDate: '2026-01-01', endDate: null, active: true,
    };
  }

  function occ(id, billId, uid, dueDate, status, amount = 120) {
    return {
      id, recurringBillId: billId, userId: uid, dueDate,
      expectedAmount: amount, status, paidAmount: null, paidAt: null,
      transactionId: null,
    };
  }

  async function seedState(page, uid, bills, occs) {
    await page.evaluate(([u, b, o]) => {
      window.linsoraStore.state.user = { id: u, name: 'U', email: 'u@linsora.com.br' };
      window.linsoraStore.state.accounts = [];
      window.linsoraStore.state.cards = [];
      window.linsoraStore.state.transactions = [];
      window.linsoraStore.state.recurringBills = b;
      window.linsoraStore.state.occurrences = o;
    }, [uid, bills, occs]);
  }

  async function nextDue(page, billId) {
    return page.evaluate(([id, today]) => {
      const bills = window.linsoraStore.state.recurringBills;
      const b = bills.find((x) => x.id === id);
      return window.LinsoraUtils.nextBillDue(b, window.linsoraStore.state.occurrences, today);
    }, [billId, TODAY]);
  }

  async function occCount(page) {
    return page.evaluate(() => window.linsoraStore.state.occurrences.length);
  }

  async function cardTexts(page) {
    await page.evaluate(() => {
      window.LinsoraUI.renderUpcomingCommitments('upcomingBillsList', 3);
    });
    return page.locator('#upcomingBillsList').innerText();
  }

  test('Caso 1: 29/09 PAID nao aparece como proximo; nada e ressuscitado', async ({ page }) => {
    await seedState(page, UID_A,
      [bill('b1', UID_A)],
      [occ('o1', 'b1', UID_A, '2026-09-29', 'PAID')]);
    const before = await occCount(page);
    const nxt = await nextDue(page, 'b1');
    expect(nxt).not.toBe(null);
    expect(nxt.dueDate).not.toBe('2026-09-29');
    expect(nxt.dueDate).toBe('2026-10-29');
    expect(await occCount(page)).toBe(before);
    const card = await cardTexts(page);
    expect(card).toContain('29/10/2026');
    expect(card).not.toContain('29/09/2026');
    const st = await page.evaluate(() => window.linsoraStore.state.occurrences.map((o) => o.status));
    expect(st).toEqual(['PAID']);
  });

  test('Caso 2: 29/09 PAID + 29/10 PENDING => proximo e 29/10', async ({ page }) => {
    await seedState(page, UID_A,
      [bill('b1', UID_A)],
      [occ('o1', 'b1', UID_A, '2026-09-29', 'PAID'), occ('o2', 'b1', UID_A, '2026-10-29', 'PENDING')]);
    const nxt = await nextDue(page, 'b1');
    expect(nxt.dueDate).toBe('2026-10-29');
    expect(nxt.source).toBe('occurrence');
    expect(nxt.overdue).toBe(false);
    expect(await cardTexts(page)).toContain('29/10/2026');
  });

  test('Caso 3: 29/09 PAID sem futura materializada => deriva 29/10 sem duplicar', async ({ page }) => {
    await seedState(page, UID_A,
      [bill('b1', UID_A)],
      [occ('o1', 'b1', UID_A, '2026-09-29', 'PAID')]);
    const before = await occCount(page);
    const nxt = await nextDue(page, 'b1');
    expect(nxt.dueDate).toBe('2026-10-29');
    expect(nxt.source).toBe('derived');
    // Nenhuma ocorrência criada, nenhum status alterado.
    expect(await occCount(page)).toBe(before);
    const st = await page.evaluate(() => window.linsoraStore.state.occurrences.map((o) => `${o.dueDate}:${o.status}`));
    expect(st).toEqual(['2026-09-29:PAID']);
  });

  test('Caso 4: 29/09 SKIPPED + 29/10 PENDING => proximo e 29/10', async ({ page }) => {
    await seedState(page, UID_A,
      [bill('b1', UID_A)],
      [occ('o1', 'b1', UID_A, '2026-09-29', 'SKIPPED'), occ('o2', 'b1', UID_A, '2026-10-29', 'PENDING')]);
    const nxt = await nextDue(page, 'b1');
    expect(nxt.dueDate).toBe('2026-10-29');
    expect(await cardTexts(page)).toContain('29/10/2026');
    expect(await cardTexts(page)).not.toContain('29/09/2026');
  });

  test('Caso 5: 29/09 PENDING continua normalmente', async ({ page }) => {
    await seedState(page, UID_A,
      [bill('b1', UID_A)],
      [occ('o1', 'b1', UID_A, '2026-09-29', 'PENDING')]);
    const nxt = await nextDue(page, 'b1');
    expect(nxt.dueDate).toBe('2026-09-29');
    expect(nxt.source).toBe('occurrence');
    expect(nxt.overdue).toBe(false);
    expect(await cardTexts(page)).toContain('29/09/2026');
  });

  test('Caso 6: dois usuarios com mesmo nome veem somente os proprios', async ({ page }) => {
    await seedState(page, UID_A,
      [bill('bA', UID_A), bill('bB', UID_B)],
      [
        occ('oA1', 'bA', UID_A, '2026-09-29', 'PAID'),
        occ('oA2', 'bA', UID_A, '2026-10-29', 'PENDING'),
        occ('oB1', 'bB', UID_B, '2026-09-29', 'PENDING'),
      ]);
    const cardA = await cardTexts(page);
    expect(cardA).toContain('29/10/2026');
    expect(cardA).not.toContain('29/09/2026');
    // Troca para o usuário B no mesmo estado: só os dados dele aparecem.
    await page.evaluate((u) => {
      window.linsoraStore.state.user = { id: u, name: 'B', email: 'b@linsora.com.br' };
      window.LinsoraUI.renderUpcomingCommitments('upcomingBillsList', 3);
    }, UID_B);
    const cardB = await page.locator('#upcomingBillsList').innerText();
    expect(cardB).toContain('29/09/2026');
    expect(cardB).not.toContain('29/10/2026');
    // Unidade: cada conta enxerga sua própria próxima data.
    const nA = await nextDue(page, 'bA');
    const nB = await nextDue(page, 'bB');
    expect(nA.dueDate).toBe('2026-10-29');
    expect(nB.dueDate).toBe('2026-09-29');
  });

  test('Caso 7: PAID e SKIPPED seguem fora de getCommittedAmountUntil', async ({ page }) => {
    await seedState(page, UID_A,
      [
        bill('bI', UID_A, 'Internet', 120, 29),
        bill('bA', UID_A, 'Aluguel', 2000, 30),
        bill('bE', UID_A, 'Energia', 300, 28),
      ],
      [
        occ('oI', 'bI', UID_A, '2026-09-29', 'PAID', 120),
        occ('oA', 'bA', UID_A, '2026-09-30', 'PENDING', 2000),
        occ('oE', 'bE', UID_A, '2026-09-28', 'SKIPPED', 300),
      ]);
    const c = await page.evaluate(() => window.linsoraStore.getCommittedAmountUntil('2026-09-30'));
    expect(c.total).toBe(2000);
    expect(c.items.map((i) => i.title)).toEqual(['Aluguel']);
  });
});
