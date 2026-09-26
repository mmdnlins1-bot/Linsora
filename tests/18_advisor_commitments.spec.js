const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.use({ timezoneId: 'America/Sao_Paulo' });

test.describe('18. Integração Contas Recorrentes + Conselheiro', () => {

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

  test('Teste 1: Conta recorrente ativa gera ocorrência esperada no fluxo da aplicação', async ({ page }) => {
    // Cadastrar conta recorrente via formulário da UI
    await page.click('#btnGoToRecurring');
    await expect(page.locator('#tabRecurringBills')).toBeVisible();
    await page.click('#btnAddRecurring');
    await expect(page.locator('#modalBillForm')).toBeVisible();

    await page.fill('#billTitleInput', 'Internet Fibra Teste');
    await page.fill('#billAmountInput', '30000'); // R$ 300,00
    await page.selectOption('#billCategoryInput', 'Moradia');
    await page.fill('#billDueDayInput', '30');
    await page.fill('#billStartInput', '2026-01-01');
    await page.click('#btnSaveBill');

    await expect(page.locator('#modalBillForm')).toHaveClass(/hidden/);
    await expect(page.locator('#toastContainer')).toContainText('cadastrada com sucesso');

    // A ocorrência para o mês corrente deve existir no estado da aplicação
    const occs = await page.evaluate(() => {
      const today = new Date();
      const p = (v) => String(v).padStart(2, '0');
      const currentMonthKey = `${today.getFullYear()}-${p(today.getMonth() + 1)}`;
      return window.linsoraStore.state.occurrences.filter(o => o.dueDate.startsWith(currentMonthKey));
    });

    expect(occs.length).toBeGreaterThanOrEqual(1);
    expect(occs[0].status).toBe('PENDING');
    expect(occs[0].expectedAmount).toBe(300);
  });

  test('Teste 2: Executar a garantia de geração mais de uma vez não cria duplicatas (idempotente)', async ({ page }) => {
    await page.evaluate(async () => {
      await window.linsoraStore.addRecurringBill({
        title: 'Internet Idempotente',
        amount: 300,
        category: 'Moradia',
        frequency: 'MONTHLY',
        due_day: 30,
        start_date: '2026-01-01',
        end_date: null,
        active: true
      });
      window.linsoraStore.ensureCurrentWindowOccurrences();
    });

    const countInitial = await page.evaluate(() => window.linsoraStore.state.occurrences.length);
    expect(countInitial).toBe(1);

    // Chamar múltiplas vezes
    await page.evaluate(() => {
      window.linsoraStore.ensureCurrentWindowOccurrences();
      window.linsoraStore.ensureCurrentWindowOccurrences();
      window.linsoraStore.ensureCurrentWindowOccurrences();
    });

    const countAfter = await page.evaluate(() => window.linsoraStore.state.occurrences.length);
    expect(countAfter).toBe(1);
  });

  test('Teste 3: Ocorrência futura de conta recorrente entra em committedItems', async ({ page }) => {
    await page.evaluate(async () => {
      await window.linsoraStore.addRecurringBill({
        title: 'Internet Mensal',
        amount: 300,
        category: 'Moradia',
        frequency: 'MONTHLY',
        due_day: 30,
        start_date: '2026-01-01',
        end_date: null,
        active: true
      });
      window.linsoraStore.ensureCurrentWindowOccurrences();
    });

    const committed = await page.evaluate(() => {
      const today = new Date();
      const p = (v) => String(v).padStart(2, '0');
      const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
      const endKey = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(lastDay)}`;
      return window.linsoraStore.getCommittedAmountUntil(endKey);
    });

    expect(committed.total).toBe(300);
    expect(committed.items.length).toBe(1);
    expect(committed.items[0].title).toBe('Internet Mensal');
    expect(committed.items[0].amount).toBe(300);
  });

  test('Teste 4: availableAfterCommitments considera corretamente o compromisso', async ({ page }) => {
    const metrics = await page.evaluate(async () => {
      window.linsoraStore.state.accounts = [{ id: 'acc1', balance: 2000, name: 'Conta Principal' }];
      window.linsoraStore.state.transactions = [
        { type: 'RECEITA', amount: 2000, date: window.LinsoraUtils.toLocalDateKey() + 'T12:00:00', account: 'Conta Principal' }
      ];
      await window.linsoraStore.addRecurringBill({
        title: 'Internet',
        amount: 300,
        category: 'Moradia',
        frequency: 'MONTHLY',
        due_day: 30,
        start_date: '2026-01-01',
        end_date: null,
        active: true
      });
      window.linsoraStore.ensureCurrentWindowOccurrences();
      return window.LinsoraStrategicAdvisor.calculateRealMetrics(window.linsoraStore.state);
    });

    expect(metrics.committedAmount).toBe(300);
    expect(metrics.availableBalanceForMonth).toBe(2000);
    expect(metrics.availableAfterCommitments).toBe(1700);
  });

  test('Teste 5: handleViabilityQuestion() utiliza a margem após compromissos para decidir a viabilidade', async ({ page }) => {
    // Configura 1000 de saldo e receita livre, com 300 de conta recorrente -> margem livre restante é 700.
    await page.evaluate(async () => {
      window.linsoraStore.state.accounts = [{ id: 'acc1', balance: 1000, name: 'Conta Principal' }];
      window.linsoraStore.state.transactions = [
        { type: 'RECEITA', amount: 1000, date: window.LinsoraUtils.toLocalDateKey() + 'T12:00:00', account: 'Conta Principal' }
      ];
      await window.linsoraStore.addRecurringBill({
        title: 'Internet',
        amount: 300,
        category: 'Moradia',
        frequency: 'MONTHLY',
        due_day: 30,
        start_date: '2026-01-01',
        end_date: null,
        active: true
      });
      window.linsoraStore.ensureCurrentWindowOccurrences();
    });

    // Simula consulta de R$ 800,00 (caberia nos 1000 brutos, mas ultrapassa os 700 pós-compromissos)
    await page.click('#btnOpenAdvisorFromFeed');
    await expect(page.locator('#modalStrategicAdvisor')).not.toHaveClass(/hidden/);

    await page.fill('#advisorQueryInput', 'Posso gastar 800 reais hoje?');
    await page.click('#btnSubmitAdvisorQuery');

    const responseCard = page.locator('.advisor-bot-msg').last();
    await expect(responseCard).toBeVisible({ timeout: 5000 });

    // Deve alertar que o gasto comprometeria a margem disponível
    await expect(responseCard).toContainText('comprometeria sua margem disponível');
    await expect(responseCard).toContainText('Internet');
    await expect(responseCard).toContainText('R$ 300,00');
  });

  test('Teste 6: A resposta do Conselheiro inclui compromisso relevante quando ele influencia a análise', async ({ page }) => {
    await page.evaluate(async () => {
      window.linsoraStore.state.accounts = [{ id: 'acc1', balance: 5000, name: 'Conta Principal' }];
      window.linsoraStore.state.transactions = [
        { type: 'RECEITA', amount: 5000, date: window.LinsoraUtils.toLocalDateKey() + 'T12:00:00', account: 'Conta Principal' }
      ];
      await window.linsoraStore.addRecurringBill({
        title: 'Internet Fibra',
        amount: 300,
        category: 'Moradia',
        frequency: 'MONTHLY',
        due_day: 30,
        start_date: '2026-01-01',
        end_date: null,
        active: true
      });
      window.linsoraStore.ensureCurrentWindowOccurrences();
    });

    await page.click('#btnOpenAdvisorFromFeed');
    await expect(page.locator('#modalStrategicAdvisor')).not.toHaveClass(/hidden/);

    await page.fill('#advisorQueryInput', 'Posso gastar 1000 reais hoje?');
    await page.click('#btnSubmitAdvisorQuery');

    const responseCard = page.locator('.advisor-bot-msg').last();
    await expect(responseCard).toBeVisible({ timeout: 5000 });

    // A resposta deve citar a Internet Fibra e o valor do compromisso
    await expect(responseCard).toContainText('Internet Fibra');
    await expect(responseCard).toContainText('R$ 300,00');
  });

  test('Teste 7: A resposta não inventa compromissos quando committedItems está vazio', async ({ page }) => {
    await page.evaluate(() => {
      window.linsoraStore.state.accounts = [{ id: 'acc1', balance: 5000, name: 'Conta Principal' }];
      window.linsoraStore.state.transactions = [
        { type: 'RECEITA', amount: 5000, date: window.LinsoraUtils.toLocalDateKey() + 'T12:00:00', account: 'Conta Principal' }
      ];
      window.linsoraStore.state.recurringBills = [];
      window.linsoraStore.state.occurrences = [];
      window.linsoraStore.state.cards = [];
    });

    await page.click('#btnOpenAdvisorFromFeed');
    await expect(page.locator('#modalStrategicAdvisor')).not.toHaveClass(/hidden/);

    await page.fill('#advisorQueryInput', 'Posso gastar 150 hoje?');
    await page.click('#btnSubmitAdvisorQuery');

    const responseCard = page.locator('.advisor-bot-msg').last();
    await expect(responseCard).toBeVisible({ timeout: 5000 });

    // Não deve inventar ou listar compromissos
    const text = await responseCard.innerText();
    expect(text).not.toContain('em compromissos próximos');
    expect(text).not.toContain('um compromisso de');
  });

  test('Teste 8: A seção "Ver detalhes técnicos" renderiza os indicadores verticalmente', async ({ page }) => {
    await page.evaluate(async () => {
      window.linsoraStore.state.accounts = [{ id: 'acc1', balance: 3000, name: 'Conta Principal' }];
      window.linsoraStore.state.transactions = [
        { type: 'RECEITA', amount: 3000, date: window.LinsoraUtils.toLocalDateKey() + 'T12:00:00', account: 'Conta Principal' }
      ];
      await window.linsoraStore.addRecurringBill({
        title: 'Internet',
        amount: 250,
        category: 'Moradia',
        frequency: 'MONTHLY',
        due_day: 30,
        start_date: '2026-01-01',
        end_date: null,
        active: true
      });
      window.linsoraStore.ensureCurrentWindowOccurrences();
    });

    await page.click('#btnOpenAdvisorFromFeed');
    await expect(page.locator('#modalStrategicAdvisor')).not.toHaveClass(/hidden/);

    await page.fill('#advisorQueryInput', 'Posso gastar 200 reais hoje?');
    await page.click('#btnSubmitAdvisorQuery');

    const responseCard = page.locator('.advisor-bot-msg').filter({ hasText: 'Simulação de Gasto' }).last();
    await expect(responseCard).toBeVisible({ timeout: 5000 });

    // Abrir o <details>
    const details = responseCard.locator('details');
    await expect(details).toBeVisible();
    await details.locator('summary').click();

    // Deve conter a lista vertical de métricas técnicas
    const techList = responseCard.locator('.technical-metrics-list');
    await expect(techList).toBeVisible();

    const items = techList.locator('.tech-metric-item');
    await expect(items).toHaveCount(6);

    // Validar cada um dos 6 indicadores esperados
    await expect(techList).toContainText('Caixa Livre do Mês');
    await expect(techList).toContainText('Saldo em Contas');
    await expect(techList).toContainText('Receitas do Mês');
    await expect(techList).toContainText('Despesas do Mês');
    await expect(techList).toContainText('Compromissos do mês');
    await expect(techList).toContainText('Limite Diário');

    // Validar que cada item possui estrutura vertical (span de rótulo e strong de valor)
    const firstItem = items.first();
    await expect(firstItem.locator('span')).toContainText('Caixa Livre do Mês');
    await expect(firstItem.locator('strong')).toBeVisible();
  });

});
