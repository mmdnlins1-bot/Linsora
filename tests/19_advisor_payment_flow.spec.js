const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.use({ timezoneId: 'America/Sao_Paulo' });

test.describe('19. Conselheiro: conferencia de compromissos pagos', () => {

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

  async function seedTwoBills(page) {
    await page.evaluate(async () => {
      window.linsoraStore.state.accounts = [{ id: 'acc1', balance: 5000, name: 'Conta Principal' }];
      window.linsoraStore.state.transactions = [
        { id: 'tx_seed', userId: window.linsoraStore.state.user.id, type: 'RECEITA', amount: 5000, description: 'Salario', category: 'Salário', date: new Date().toISOString(), account: 'Conta Principal', status: 'CONCLUIDO' }
      ];
      await window.linsoraStore.addRecurringBill({
        title: 'Aluguel', amount: 2000, category: 'Moradia',
        frequency: 'MONTHLY', due_day: 10, start_date: '2026-01-01', end_date: null, active: true,
      });
      await window.linsoraStore.addRecurringBill({
        title: 'Internet', amount: 120, category: 'Moradia',
        frequency: 'MONTHLY', due_day: 20, start_date: '2026-01-01', end_date: null, active: true,
      });
      window.linsoraStore.ensureCurrentWindowOccurrences();
    });
  }

  async function openAdvisor(page) {
    await page.click('#btnOpenAdvisorFromFeed');
    await expect(page.locator('#modalStrategicAdvisor')).not.toHaveClass(/hidden/);
  }

  async function sendAndWait(page, text) {
    const before = await page.locator('.advisor-bot-msg').count();
    await page.fill('#advisorQueryInput', text);
    await page.click('#btnSubmitAdvisorQuery');
    await page.waitForFunction(
      (n) => document.querySelectorAll('.advisor-bot-msg').length > n, before, { timeout: 8000 }
    );
  }

  async function ask(page, text) {
    await openAdvisor(page);
    await sendAndWait(page, text);
  }

  function norm(s) {
    return String(s || '').replace(/\u00a0/g, ' ');
  }

  async function lastBotText(page) {
    const t = await page.locator('.advisor-bot-msg').last().innerText();
    return norm(t);
  }

  test('Teste 1: pergunta de gasto com compromissos gera pergunta contextual', async ({ page }) => {
    await seedTwoBills(page);
    await ask(page, 'Posso gastar 100 reais hoje?');
    const text = await lastBotText(page);
    expect(text).toContain('já pagou alguma dessas contas');
    expect(text).toContain('Aluguel');
    expect(text).toContain('Internet');
  });

  test('Teste 2: compromissos aparecem numerados', async ({ page }) => {
    await seedTwoBills(page);
    await ask(page, 'Posso gastar 100 reais hoje?');
    const items = page.locator('.advisor-bot-msg').last().locator('.commitment-option-item');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('1.');
    await expect(items.nth(0)).toContainText('Aluguel');
    await expect(items.nth(1)).toContainText('2.');
    await expect(items.nth(1)).toContainText('Internet');
  });

  test('Teste 3: resposta 1 identifica o primeiro compromisso', async ({ page }) => {
    await seedTwoBills(page);
    await ask(page, 'Posso gastar 100 reais hoje?');
    await expect(page.locator('.advisor-bot-msg').last()).toContainText('já pagou alguma dessas contas');
    await sendAndWait(page, '1');
    const resp = page.locator('.advisor-bot-msg').last();
    await expect(resp).toContainText('Aluguel');
    await expect(resp).toContainText('Confirmar');
    await expect(resp).toContainText('Cancelar');
  });

  test('Teste 4: resposta 1 e 2 identifica os dois', async ({ page }) => {
    await seedTwoBills(page);
    await ask(page, 'Posso gastar 100 reais hoje?');
    await expect(page.locator('.advisor-bot-msg').last()).toContainText('já pagou alguma dessas contas');
    await sendAndWait(page, '1 e 2');
    const text = await lastBotText(page);
    expect(text).toContain('Aluguel');
    expect(text).toContain('Internet');
    expect(text).toContain('as 2 contas como pagas');
  });

  test('Teste 5: nenhuma nao altera dados', async ({ page }) => {
    await seedTwoBills(page);
    await ask(page, 'Posso gastar 100 reais hoje?');
    await expect(page.locator('.advisor-bot-msg').last()).toContainText('já pagou alguma dessas contas');
    await sendAndWait(page, 'nenhuma');
    await expect(page.locator('.advisor-bot-msg').last()).toContainText('mantive todos os compromissos como pendentes');
    const st = await page.evaluate(() => ({
      pending: window.linsoraStore.state.occurrences.filter(o => o.status === 'PENDING').length,
      committed: window.linsoraStore.getCommittedAmountUntil('2099-12-31').total,
    }));
    expect(st.pending).toBe(2);
    expect(st.committed).toBe(2120);
  });

  test('Teste 6: resposta ambigua pede esclarecimento', async ({ page }) => {
    await page.evaluate(async () => {
      // Margem 250 (500 - 100 - 150); gasto 100 -> restante 150 <= 2x250:
      // a conferência abre para testar a ambiguidade dos dois "internet".
      window.linsoraStore.state.accounts = [{ id: 'acc1', balance: 500, name: 'Conta Principal' }];
      window.linsoraStore.state.transactions = [
        { id: 'tx_seed', userId: window.linsoraStore.state.user.id, type: 'RECEITA', amount: 500, description: 'Salario', category: 'Salário', date: new Date().toISOString(), account: 'Conta Principal', status: 'CONCLUIDO' }
      ];
      await window.linsoraStore.addRecurringBill({
        title: 'Internet Casa', amount: 100, category: 'Moradia',
        frequency: 'MONTHLY', due_day: 10, start_date: '2026-01-01', end_date: null, active: true,
      });
      await window.linsoraStore.addRecurringBill({
        title: 'Internet Empresa', amount: 150, category: 'Moradia',
        frequency: 'MONTHLY', due_day: 20, start_date: '2026-01-01', end_date: null, active: true,
      });
      window.linsoraStore.ensureCurrentWindowOccurrences();
    });
    await ask(page, 'Posso gastar 100 reais hoje?');
    await expect(page.locator('.advisor-bot-msg').last()).toContainText('já pagou alguma dessas contas');
    await sendAndWait(page, 'paguei a internet');
    const text = await lastBotText(page);
    expect(text).toContain('Qual conta você quis dizer');
  });

  test('Teste 7: resposta 1 NAO altera estado antes da confirmacao', async ({ page }) => {
    await seedTwoBills(page);
    await ask(page, 'Posso gastar 100 reais hoje?');
    await expect(page.locator('.advisor-bot-msg').last()).toContainText('já pagou alguma dessas contas');
    await sendAndWait(page, '1');
    await expect(page.locator('.advisor-bot-msg').last()).toContainText('Deseja marcar essa conta como paga');
    const st = await page.evaluate(() => ({
      pending: window.linsoraStore.state.occurrences.filter(o => o.status === 'PENDING').length,
      paid: window.linsoraStore.state.occurrences.filter(o => o.status === 'PAID').length,
      txs: window.linsoraStore.state.transactions.length,
      committed: window.linsoraStore.getCommittedAmountUntil('2099-12-31').total,
    }));
    expect(st.pending).toBe(2);
    expect(st.paid).toBe(0);
    expect(st.txs).toBe(1);
    expect(st.committed).toBe(2120);
  });

  test('Teste 8: confirmacao marca a ocorrencia como paga pelo fluxo existente', async ({ page }) => {
    await seedTwoBills(page);
    await ask(page, 'Posso gastar 100 reais hoje?');
    await expect(page.locator('.advisor-bot-msg').last()).toContainText('já pagou alguma dessas contas');
    await sendAndWait(page, '1');
    const confirm = page.locator('.advisor-bot-msg').last();
    await expect(confirm).toContainText('Deseja marcar essa conta como paga');
    await confirm.getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.locator('.advisor-bot-msg').last()).toContainText('marcado como pago', { timeout: 8000 });
    const occ = await page.evaluate(() => {
      const bills = window.linsoraStore.state.recurringBills;
      const aluguel = bills.find(b => b.title === 'Aluguel');
      return window.linsoraStore.state.occurrences.find(o => o.recurringBillId === aluguel.id);
    });
    expect(occ.status).toBe('PAID');
    expect(occ.paidAmount).toBe(2000);
    expect(occ.transactionId).toBe(null);
  });

  test('Teste 9: apos pagar, compromisso sai dos pendentes', async ({ page }) => {
    await seedTwoBills(page);
    await ask(page, 'Posso gastar 100 reais hoje?');
    await sendAndWait(page, '1');
    const confirm = page.locator('.advisor-bot-msg').last();
    await expect(confirm).toContainText('Deseja marcar essa conta como paga');
    await confirm.getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.locator('.advisor-bot-msg').last()).toContainText('marcado como pago', { timeout: 8000 });
    const committed = await page.evaluate(
      () => window.linsoraStore.getCommittedAmountUntil('2099-12-31')
    );
    expect(committed.total).toBe(120);
    expect(committed.items.map(i => i.title)).toEqual(['Internet']);
  });

  test('Teste 10: availableAfterCommitments recalculado', async ({ page }) => {
    await seedTwoBills(page);
    await ask(page, 'Posso gastar 100 reais hoje?');
    await sendAndWait(page, '1');
    const confirm = page.locator('.advisor-bot-msg').last();
    await expect(confirm).toContainText('Deseja marcar essa conta como paga');
    await confirm.getByRole('button', { name: 'Confirmar' }).click();
    await expect(page.locator('.advisor-bot-msg').last()).toContainText('marcado como pago', { timeout: 8000 });
    const metrics = await page.evaluate(
      () => window.LinsoraStrategicAdvisor.calculateRealMetrics(window.linsoraStore.state)
    );
    expect(metrics.committedAmount).toBe(120);
    expect(metrics.availableBalanceForMonth).toBe(5000);
    expect(metrics.availableAfterCommitments).toBe(4880);
  });

  test('Teste 11: pergunta original respondida apos recalculo', async ({ page }) => {
    await seedTwoBills(page);
    await ask(page, 'Posso gastar 100 reais hoje?');
    await sendAndWait(page, '1');
    const confirm = page.locator('.advisor-bot-msg').last();
    await expect(confirm).toContainText('Deseja marcar essa conta como paga');
    await confirm.getByRole('button', { name: 'Confirmar' }).click();
    const text = await lastBotText(page);
    expect(text).toContain('R$ 100,00');
    expect(text).toContain('4.880,00');
    expect(text).toContain('4.780,00');
    expect(text).toContain('Internet');
  });

  test('Teste 12: sem duplicacao de transacao ou pagamento', async ({ page }) => {
    await seedTwoBills(page);
    await ask(page, 'Posso gastar 100 reais hoje?');
    await sendAndWait(page, '1 e 2');
    const confirm = page.locator('.advisor-bot-msg').last();
    await expect(confirm).toContainText('Deseja marcar as 2 contas como pagas');
    const btn = confirm.getByRole('button', { name: 'Confirmar' });
    await btn.click();
    await expect(page.locator('.advisor-bot-msg').last()).toContainText('foram marcados como pagos', { timeout: 8000 });
    const confirmCard = page.locator('.advisor-bot-msg', { hasText: 'Deseja marcar as 2 contas' });
    await expect(confirmCard.getByRole('button', { name: 'Processando...' })).toHaveCount(1);
    await expect(confirmCard.getByRole('button', { name: 'Processando...' }).first()).toBeDisabled();
    await expect(confirmCard.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
    const st = await page.evaluate(() => ({
      occs: window.linsoraStore.state.occurrences.length,
      paid: window.linsoraStore.state.occurrences.filter(o => o.status === 'PAID').length,
      txs: window.linsoraStore.state.transactions.length,
    }));
    expect(st.occs).toBe(2);
    expect(st.paid).toBe(2);
    expect(st.txs).toBe(1);
  });
});
