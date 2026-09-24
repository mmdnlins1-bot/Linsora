const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.describe('10 - Assistente Pessoal Inteligente & Conselheiro Estratégico', () => {
  test.beforeEach(async ({ page }) => {
    // Autenticação usando o helper oficial do projeto
    await login(page);
    await expect(page.locator('#tabDashboard')).toBeVisible();
  });

  test('Deve renderizar o Feed de Contexto Dinâmico no topo da Home', async ({ page }) => {
    const feedContainer = page.locator('#strategicFeedContainer');
    await expect(feedContainer).toBeVisible();

    const feedCard = page.locator('#strategicFeedContainer .smart-insights-card');
    await expect(feedCard).toBeVisible();

    const advisorBtn = page.locator('#btnOpenAdvisorFromFeed');
    await expect(advisorBtn).toBeVisible();
    await expect(advisorBtn).toContainText('Consultar');
  });

  test('Deve abrir o Conselheiro Estratégico e responder a uma pergunta sobre compra discricionária', async ({ page }) => {
    await page.click('#btnOpenAdvisorFromFeed');

    const modal = page.locator('#modalStrategicAdvisor');
    await expect(modal).not.toHaveClass(/hidden/);

    const input = page.locator('#advisorQueryInput');
    await input.fill('Posso gastar 300 reais hoje?');
    await page.click('#btnSubmitAdvisorQuery');

    const userMsg = page.locator('.advisor-user-msg').last();
    await expect(userMsg).toBeVisible({ timeout: 5000 });
    await expect(userMsg).toContainText('Posso gastar 300 reais hoje?');

    const responseCard = page.locator('.advisor-bot-msg').last();
    await expect(responseCard).toBeVisible({ timeout: 5000 });

    await expect(responseCard).toContainText('Simulação de Gasto');
    await expect(responseCard).toContainText('Faltam fundos');
  });

  test('Deve interpretar pergunta em linguagem natural sobre gastos e responder com cálculos reais', async ({ page }) => {
    await page.click('#btnOpenAdvisorFromFeed');
    await expect(page.locator('#modalStrategicAdvisor')).not.toHaveClass(/hidden/);

    const input = page.locator('#advisorQueryInput');
    await input.fill('posso gastar R$ 150 hoje?');
    await page.click('#btnSubmitAdvisorQuery');

    const responseCard = page.locator('.advisor-bot-msg').last();
    await expect(responseCard).toBeVisible({ timeout: 5000 });

    // Verificar os cálculos reais fornecidos pela inteligência financeira
    await expect(responseCard).toContainText('Análise de viabilidade');
    await expect(responseCard).toContainText('Caixa Livre do Mês');
    await expect(responseCard).toContainText('Análise Diagnóstica');
  });

  test('Deve responder com alerta de risco e limite recomendado para um gasto excessivo (cenário negativo)', async ({ page }) => {
    await page.click('#btnOpenAdvisorFromFeed');
    await expect(page.locator('#modalStrategicAdvisor')).not.toHaveClass(/hidden/);

    const input = page.locator('#advisorQueryInput');
    await input.fill('posso gastar R$ 50000 hoje?');
    await page.click('#btnSubmitAdvisorQuery');

    const responseCard = page.locator('.advisor-bot-msg').last();
    await expect(responseCard).toBeVisible({ timeout: 5000 });

    await expect(responseCard).toContainText('Faltam fundos');
    await expect(responseCard).toContainText('Caixa Livre do Mês');
  });

  test('Deve responder a pergunta "esqueci de pagar alguma conta?" verificando despesas recorrentes pendentes', async ({ page }) => {
    await page.click('#btnOpenAdvisorFromFeed');
    await expect(page.locator('#modalStrategicAdvisor')).not.toHaveClass(/hidden/);

    const input = page.locator('#advisorQueryInput');
    await input.fill('esqueci de pagar alguma conta?');
    await page.click('#btnSubmitAdvisorQuery');

    const responseCard = page.locator('.advisor-bot-msg').last();
    await expect(responseCard).toBeVisible({ timeout: 5000 });

    await expect(responseCard).toContainText('Diagnóstico Orçamentário');
    await expect(responseCard).toContainText('Ver detalhes técnicos');
  });

  test('Deve interpretar comando de voz/texto de consulta orçamentária e direcionar para o Conselheiro', async ({ page }) => {
    await page.evaluate(() => {
      if (window.VoiceAssistantUIController) {
        const controller = new window.VoiceAssistantUIController();
        controller.processCapturedVoice('posso gastar 50 em pizza hoje?');
      } else if (window.VoiceAssistantUI) {
        window.VoiceAssistantUI.processCapturedVoice('posso gastar 50 em pizza hoje?');
      }
    });

    const modal = page.locator('#modalStrategicAdvisor');
    await expect(modal).not.toHaveClass(/hidden/);

    const responseCard = page.locator('.advisor-bot-msg').last();
    await expect(responseCard).toBeVisible();
    await expect(responseCard).toContainText('Análise Diagnóstica');
  });

  test('Deve atualizar o feed do Conselheiro após criar e excluir movimentação', async ({ page }) => {
    const feedCard = page.locator('#strategicFeedContainer .smart-insights-card');
    await expect(feedCard).toBeVisible();

    const baseline = await page.locator('#strategicFeedContainer').innerHTML();

    // Cria receita relevante via fluxo normal do store (notify -> renderAppUI)
    await page.evaluate(() => window.linsoraStore.saveTransaction({
      type: 'RECEITA',
      amount: 5000,
      description: 'Salário Feed Teste',
      category: 'Salário',
      date: window.LinsoraUtils.toLocalDateKey(),
      account: 'Conta Principal',
      repetition: 'SINGLE',
      notes: '',
    }));

    const afterCreate = await page.locator('#strategicFeedContainer').innerHTML();
    expect(afterCreate).not.toBe(baseline);
    // Sem duplicação: continua existindo exatamente um card com botão funcional
    await expect(page.locator('#strategicFeedContainer .smart-insights-card')).toHaveCount(1);
    await expect(page.locator('#btnOpenAdvisorFromFeed')).toBeVisible();

    // Exclui a movimentação: feed deve ser recalculado (volta ao estado anterior)
    await page.evaluate(async () => {
      const tx = window.linsoraStore.state.transactions.find(t => t.description === 'Salário Feed Teste');
      if (tx) await window.linsoraStore.deleteTransaction(tx.id);
    });

    const afterDelete = await page.locator('#strategicFeedContainer').innerHTML();
    expect(afterDelete).toBe(baseline);
    await expect(page.locator('#strategicFeedContainer .smart-insights-card')).toHaveCount(1);
  });
});
