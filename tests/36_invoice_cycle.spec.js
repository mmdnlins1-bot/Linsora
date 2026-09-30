const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.use({ timezoneId: 'America/Sao_Paulo' });

// 36. Etapa 1 do extrato por fatura: getInvoiceCycle(closingDay, year, month)
// (month 0-11, padrão JS). Função pura em js/utils.js — sem estado, sem UI,
// sem Supabase, sem pagamento. Verifica exatamente { start, end }.

test.describe('36. Ciclo da fatura (getInvoiceCycle)', () => {
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

  async function cycle(page, closingDay, year, month) {
    return page.evaluate(
      ([cd, y, m]) => window.LinsoraUtils.getInvoiceCycle(cd, y, m),
      [closingDay, year, month]
    );
  }

  test('1. fechamento 10, agosto/2026', async ({ page }) => {
    expect(await cycle(page, 10, 2026, 7)).toEqual({ start: '2026-07-11', end: '2026-08-10' });
  });

  test('2. fechamento 10, setembro/2026', async ({ page }) => {
    expect(await cycle(page, 10, 2026, 8)).toEqual({ start: '2026-08-11', end: '2026-09-10' });
  });

  test('3. fechamento 1', async ({ page }) => {
    expect(await cycle(page, 1, 2026, 8)).toEqual({ start: '2026-08-02', end: '2026-09-01' });
  });

  test('4. fechamento 15', async ({ page }) => {
    expect(await cycle(page, 15, 2026, 8)).toEqual({ start: '2026-08-16', end: '2026-09-15' });
  });

  test('5. fechamento 31 em mês de 31 dias (julho/2026)', async ({ page }) => {
    expect(await cycle(page, 31, 2026, 6)).toEqual({ start: '2026-07-01', end: '2026-07-31' });
  });

  test('6. fechamento 31 em abril (30 dias)', async ({ page }) => {
    expect(await cycle(page, 31, 2026, 3)).toEqual({ start: '2026-04-01', end: '2026-04-30' });
  });

  test('7. fechamento 31 em fevereiro/2026 (28 dias)', async ({ page }) => {
    expect(await cycle(page, 31, 2026, 1)).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });

  test('8. fechamento 31 em fevereiro/2028 (bissexto, 29 dias)', async ({ page }) => {
    expect(await cycle(page, 31, 2028, 1)).toEqual({ start: '2028-02-01', end: '2028-02-29' });
  });

  test('9. virada de ano: janeiro/2026 começa em dezembro/2025', async ({ page }) => {
    expect(await cycle(page, 10, 2026, 0)).toEqual({ start: '2025-12-11', end: '2026-01-10' });
  });

  test('10. fechamento inválido usa default 15', async ({ page }) => {
    const expected = { start: '2026-08-16', end: '2026-09-15' };
    expect(await cycle(page, 0, 2026, 8)).toEqual(expected);
    expect(await cycle(page, 32, 2026, 8)).toEqual(expected);
    expect(await cycle(page, -5, 2026, 8)).toEqual(expected);
    expect(await cycle(page, 'abc', 2026, 8)).toEqual(expected);
    expect(await cycle(page, NaN, 2026, 8)).toEqual(expected);
  });

  test('11. fechamento ausente usa default 15', async ({ page }) => {
    const expected = { start: '2026-08-16', end: '2026-09-15' };
    expect(await cycle(page, undefined, 2026, 8)).toEqual(expected);
    expect(await cycle(page, null, 2026, 8)).toEqual(expected);
    expect(await cycle(page, '', 2026, 8)).toEqual(expected);
  });

  test('12. sem problema de UTC/fuso: resultado independe da hora atual', async ({ page }) => {
    const expected = { start: '2026-08-11', end: '2026-09-10' };
    for (const iso of ['2026-09-25T00:30:00-03:00', '2026-09-25T23:30:00-03:00', '2026-01-01T00:05:00-03:00']) {
      await page.clock.install({ time: new Date(iso) });
      await page.reload();
      await login(page);
      expect(await cycle(page, 10, 2026, 8)).toEqual(expected);
      expect(await cycle(page, '10', 2026, 8)).toEqual(expected);
    }
    // Pura e determinística: chamadas repetidas retornam o mesmo objeto.
    const twice = await page.evaluate(() => {
      const a = window.LinsoraUtils.getInvoiceCycle(10, 2026, 8);
      const b = window.LinsoraUtils.getInvoiceCycle(10, 2026, 8);
      return { a, b };
    });
    expect(twice.a).toEqual(twice.b);
  });
});
