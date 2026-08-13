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

    const feedCard = page.locator('.strategic-feed-card');
    await expect(feedCard).toBeVisible();

    const advisorBtn = page.locator('#btnOpenAdvisorFromFeed');
    await expect(advisorBtn).toBeVisible();
    await expect(advisorBtn).toContainText('Consultar Conselheiro');
  });

  test('Deve abrir o Conselheiro Estratégico e responder a uma pergunta sobre compra discricionária', async ({ page }) => {
    await page.click('#btnOpenAdvisorFromFeed');

    const modal = page.locator('#modalStrategicAdvisor');
    await expect(modal).not.toHaveClass(/hidden/);

    const chipCompra = page.locator('.advisor-chip[data-query="Posso gastar 300 reais hoje?"]');
    await expect(chipCompra).toBeVisible();

    await chipCompra.click();

    const responseCard = page.locator('.advisor-res-card').last();
    await expect(responseCard).toBeVisible({ timeout: 5000 });

    await expect(responseCard).toContainText('Diagnóstico');
    await expect(responseCard).toContainText('Impacto no Orçamento');
    await expect(responseCard).toContainText('Recomendação Prática');
  });

  test('Deve interpretar pergunta em linguagem natural sobre gastos e responder com cálculos reais', async ({ page }) => {
    await page.click('#btnOpenAdvisorFromFeed');
    await expect(page.locator('#modalStrategicAdvisor')).not.toHaveClass(/hidden/);

    const input = page.locator('#advisorQueryInput');
    await input.fill('posso gastar R$ 150 hoje?');
    await page.click('#btnSubmitAdvisorQuery');

    const responseCard = page.locator('.advisor-res-card').last();
    await expect(responseCard).toBeVisible({ timeout: 5000 });

    // Verificar os cálculos reais fornecidos pela inteligência financeira
    await expect(responseCard).toContainText('próximo salário');
    await expect(responseCard).toContainText('saldo seguro');
    await expect(responseCard).toContainText('Diagnóstico');
    await expect(responseCard).toContainText('Recomendação Prática');
  });

  test('Deve interpretar comando de voz/texto de consulta orçamentária e direcionar para o Conselheiro', async ({ page }) => {
    await page.evaluate(() => {
      if (window.VoiceAssistantUIController) {
        const controller = new window.VoiceAssistantUIController();
        controller.processCapturedVoice('como está meu orçamento este mês?');
      } else if (window.VoiceAssistantUI) {
        window.VoiceAssistantUI.processCapturedVoice('como está meu orçamento este mês?');
      }
    });

    const modal = page.locator('#modalStrategicAdvisor');
    await expect(modal).not.toHaveClass(/hidden/);

    const responseCard = page.locator('.advisor-res-card').last();
    await expect(responseCard).toBeVisible();
    await expect(responseCard).toContainText('Diagnóstico');
  });
});
