const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.use({ timezoneId: 'America/Sao_Paulo' });

// 20. Conselheiro: apresentação empilhada do resultado do fluxo de compromissos.
// Somente visual: aluguel R$ 2.000 pago + energia R$ 300 restante, gasto R$ 700.
// Nenhuma fórmula financeira é alterada por estes testes.

test.describe('20. Conselheiro: layout do resultado do fluxo', () => {

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

  // Cenário espelho do teste real em produção:
  // saldo 0 em contas, receita 5000, despesa 940 -> caixa 4060;
  // aluguel 2000 + energia 300 pendentes -> após pagar o aluguel,
  // margem 3760 e margem após gasto de 700 = 3060.
  async function seedProductionLike(page) {
    await page.evaluate(async () => {
      window.linsoraStore.state.accounts = [{ id: 'acc1', balance: 0, name: 'Conta Principal' }];
      const now = new Date().toISOString();
      window.linsoraStore.state.transactions = [
        { id: 'tx_r', userId: window.linsoraStore.state.user.id, type: 'RECEITA', amount: 5000, description: 'Salario', category: 'Salário', date: now, account: 'Conta Principal', status: 'CONCLUIDO' },
        { id: 'tx_d', userId: window.linsoraStore.state.user.id, type: 'DESPESA', amount: 940, description: 'Mercado', category: 'Alimentação', date: now, account: 'Conta Principal', status: 'CONCLUIDO' }
      ];
      await window.linsoraStore.addRecurringBill({
        title: 'Aluguel', amount: 2000, category: 'Moradia',
        frequency: 'MONTHLY', due_day: 10, start_date: '2026-01-01', end_date: null, active: true,
      });
      await window.linsoraStore.addRecurringBill({
        title: 'Energia', amount: 300, category: 'Moradia',
        frequency: 'MONTHLY', due_day: 28, start_date: '2026-01-01', end_date: null, active: true,
      });
      window.linsoraStore.ensureCurrentWindowOccurrences();
    });
  }

  async function sendAndWait(page, text) {
    const before = await page.locator('.advisor-bot-msg').count();
    await page.fill('#advisorQueryInput', text);
    await page.click('#btnSubmitAdvisorQuery');
    await page.waitForFunction(
      (n) => document.querySelectorAll('.advisor-bot-msg').length > n, before, { timeout: 8000 }
    );
  }

  async function confirmAluguelPaid(page) {
    await page.click('#btnOpenAdvisorFromFeed');
    await expect(page.locator('#modalStrategicAdvisor')).not.toHaveClass(/hidden/);
    await sendAndWait(page, 'Posso gastar 700 reais hoje?');
    await expect(page.locator('.advisor-bot-msg').last()).toContainText('já pagou alguma dessas contas');
    await sendAndWait(page, '1');
    const confirm = page.locator('.advisor-bot-msg').last();
    await expect(confirm).toContainText('Deseja marcar essa conta como paga');
    await confirm.getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.locator('.advisor-bot-msg').last()).toContainText('marcado como pago', { timeout: 8000 });
    return page.locator('.advisor-bot-msg').last();
  }

  function norm(s) {
    return String(s || '').replace(/\u00a0/g, ' ');
  }

  test('Teste 1: resultado aparece em blocos empilhados, não em parágrafo único', async ({ page }) => {
    await seedProductionLike(page);
    const result = await confirmAluguelPaid(page);
    const blocks = result.locator('.settlement-block');
    await expect(blocks).toHaveCount(7);
    for (const label of ['Gasto solicitado', 'Compromisso pago', 'Saldo em contas', 'Compromissos restantes', 'Margem após compromissos', 'Margem após o gasto', 'Limite diário até']) {
      await expect(result.locator('.settlement-blocks')).toContainText(label);
    }
  });

  test('Teste 2: valores com destaque próprio e cor de despesa no valor pago', async ({ page }) => {
    await seedProductionLike(page);
    const result = await confirmAluguelPaid(page);
    const text = norm(await result.innerText());
    expect(text).toContain('R$ 700,00');
    expect(text).toContain('- R$ 2.000,00');
    expect(text).toContain('R$ 0,00');
    expect(text).toContain('R$ 300,00');
    expect(text).toContain('R$ 3.760,00');
    expect(text).toContain('R$ 3.060,00');
    const paidValue = result.locator('.settlement-value.expense');
    await expect(paidValue).toContainText('- R$ 2.000,00');
    await expect(result.locator('.settlement-value.positive').first()).toBeVisible();
    await expect(result.locator('.settlement-value.pending').first()).toContainText('R$ 300,00');
  });

  test('Teste 3: frase "em contas" não aparece mais como parágrafo corrido', async ({ page }) => {
    await seedProductionLike(page);
    const result = await confirmAluguelPaid(page);
    const text = norm(await result.innerText());
    expect(text).not.toContain('em contas.');
    expect(text).not.toContain('Você tem');
    expect(text).not.toContain('Restam');
    await expect(result.locator('.settlement-blocks')).toContainText('Saldo em contas');
  });

  test('Teste 4: regra financeira intacta (PAID/PENDING + margens recalculadas)', async ({ page }) => {
    await seedProductionLike(page);
    await confirmAluguelPaid(page);
    const st = await page.evaluate(() => {
      const bills = window.linsoraStore.state.recurringBills;
      const aluguel = bills.find(b => b.title === 'Aluguel');
      const energia = bills.find(b => b.title === 'Energia');
      const m = window.LinsoraStrategicAdvisor.calculateRealMetrics(window.linsoraStore.state);
      return {
        aluguelStatus: window.linsoraStore.state.occurrences.find(o => o.recurringBillId === aluguel.id).status,
        energiaStatus: window.linsoraStore.state.occurrences.find(o => o.recurringBillId === energia.id).status,
        committed: m.committedAmount,
        after: m.availableAfterCommitments,
      };
    });
    expect(st.aluguelStatus).toBe('PAID');
    expect(st.energiaStatus).toBe('PENDING');
    expect(st.committed).toBe(300);
    expect(st.after).toBe(3760);
  });

  test('Teste 5: sem scroll horizontal nos blocos (mobile)', async ({ page }) => {
    await seedProductionLike(page);
    const result = await confirmAluguelPaid(page);
    const overflow = await result.evaluate((el) => {
      const blocks = el.querySelector('.settlement-blocks');
      if (!blocks) return { has: false, sw: 0, cw: 0 };
      return { has: true, sw: blocks.scrollWidth, cw: blocks.clientWidth };
    });
    expect(overflow.has).toBe(true);
    expect(overflow.sw).toBeLessThanOrEqual(overflow.cw + 1);
  });
});
