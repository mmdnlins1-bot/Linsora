const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

// Todos os testes deste arquivo rodam com fuso America/Sao_Paulo (UTC-3),
// onde o bug de UTC aparecia: 00:00-02:59 virava dia anterior, 21:00-23:59
// virava dia seguinte ao usar toISOString().split('T')[0].
test.use({ timezoneId: 'America/Sao_Paulo' });

test.describe('15. Datas locais sem deslocamento UTC', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();
    await login(page);
  });

  test('A: helper retorna a data local para datas determinísticas', async ({ page }) => {
    const out = await page.evaluate(() => ({
      madrugada: window.LinsoraUtils.toLocalDateKey(new Date(2026, 8, 1, 0, 30)),
      noite: window.LinsoraUtils.toLocalDateKey(new Date(2026, 8, 24, 23, 30)),
      padrao: window.LinsoraUtils.toLocalDateKey(),
    }));
    expect(out.madrugada).toBe('2026-09-01');
    expect(out.noite).toBe('2026-09-24');
    expect(out.padrao).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('B: 01/09 22:30 em São Paulo gera 2026-09-01 (nunca 2026-09-02)', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-01T22:30:00-03:00') });
    await page.reload();
    const out = await page.evaluate(() => ({
      helper: window.LinsoraUtils.toLocalDateKey(new Date()),
      legado: new Date().toISOString().split('T')[0],
    }));
    expect(out.helper).toBe('2026-09-01');
    // Prova de que o teste detectaria o bug antigo (fuso negativo desloca p/ frente à noite):
    expect(out.legado).toBe('2026-09-02');
  });

  test('C: 24/09 23:30 em São Paulo gera 2026-09-24 (nunca 2026-09-25)', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-24T23:30:00-03:00') });
    await page.reload();
    const out = await page.evaluate(() => ({
      helper: window.LinsoraUtils.toLocalDateKey(new Date()),
      legado: new Date().toISOString().split('T')[0],
    }));
    expect(out.helper).toBe('2026-09-24');
    expect(out.legado).toBe('2026-09-25');
  });

  test('D: 2026-09-01 é setembro e 2026-10-01 é outubro', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-24T12:00:00-03:00') });
    await page.reload();
    const out = await page.evaluate(() => {
      const inBounds = (date) => window.txInBounds(
        { date }, window.getPeriodBounds('THIS_MONTH')
      );
      return {
        set: inBounds('2026-09-01'),
        outubro: inBounds('2026-10-01'),
        dezembro: window.getTxMonthKey({ date: '2025-12-31' }),
        janeiro: window.getTxMonthKey({ date: '2026-01-01' }),
      };
    });
    expect(out.set).toBe(true);
    expect(out.outubro).toBe(false);
    expect(out.dezembro).toBe('2025-12');
    expect(out.janeiro).toBe('2026-01');
    expect(out.dezembro).not.toBe(out.janeiro);
  });

  test('E: Conselheiro contabiliza 2026-09-01 em setembro', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-24T12:00:00-03:00') });
    await page.reload();
    await page.evaluate(() => window.linsoraStore.saveTransaction({
      type: 'DESPESA', amount: 500, description: 'Aluguel Set',
      category: 'Moradia', date: '2026-09-01',
      account: 'Conta', repetition: 'SINGLE', notes: '',
    }));
    const metrics = await page.evaluate(
      () => window.LinsoraStrategicAdvisor.calculateRealMetrics(window.linsoraStore.state)
    );
    expect(metrics.monthExpense).toBe(500);
  });

  test('F: reserva não desloca data do primeiro dia para o mês anterior', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-24T12:00:00-03:00') });
    await page.reload();
    await page.evaluate(async () => {
      await window.linsoraStore.addGoal({
        title: 'Reserva Teste', target: 10000, current: 100,
        category: 'RESERVA_EMERGENCIA', deadline: '2027-01-01', icon: '🛡️',
      });
      await window.linsoraStore.saveTransaction({
        type: 'DESPESA', amount: 500, description: 'Aluguel Set',
        category: 'Moradia', date: '2026-09-01',
        account: 'Conta', repetition: 'SINGLE', notes: '',
      });
    });
    // 100 / 500 = 0.2 meses (código antigo cairia no fallback 1500 → 0.1)
    await expect(page.locator('#goalsGridList')).toContainText('0.2 meses');
  });

  test('G: voz usa âncora local para hoje e ontem', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-24T12:00:00-03:00') });
    await page.reload();
    const out = await page.evaluate(() => ({
      hoje: window.TransactionAIParser.parseText('gastei 50 reais no mercado hoje').date,
      ontem: window.TransactionAIParser.parseText('gastei 30 reais na padaria ontem').date,
    }));
    expect(out.hoje).toBe('2026-09-24');
    expect(out.ontem).toBe('2026-09-23');
  });

  test('H: Dashboard classifica 2026-09-01 no mês atual', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-09-24T12:00:00-03:00') });
    await page.reload();
    await page.evaluate(() => window.linsoraStore.saveTransaction({
      type: 'RECEITA', amount: 1000, description: 'Salário Set',
      category: 'Salário', date: '2026-09-01',
      account: 'Conta', repetition: 'SINGLE', notes: '',
    }));
    const found = await page.evaluate(() =>
      window.linsoraStore.getCurrentMonthTransactions().some(t => t.description === 'Salário Set')
    );
    expect(found).toBe(true);
    const future = await page.evaluate(() =>
      window.txInBounds({ date: '2026-10-05' }, window.getPeriodBounds('THIS_MONTH'))
    );
    expect(future).toBe(false);
  });
});
