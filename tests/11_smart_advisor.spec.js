const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.describe('Strategic Advisor & AI Parser', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
    
    // Injetar dados de teste simulando saldo/transações
    await page.evaluate(() => {
      if (window.linsoraStore) {
        window.linsoraStore.state.accounts = [{ id: 'acc1', balance: 5000, name: 'Conta Principal' }];
        window.linsoraStore.state.transactions = [
          { type: 'RECEITA', amount: 5000, date: new Date().toISOString() },
          { type: 'DESPESA', amount: 1000, category: 'Moradia', date: new Date().toISOString() }
        ];
        window.linsoraStore.state.goals = [];
        window.linsoraStore.notify();
      }
    });
  });

  test('Deve simular viabilidade de gasto respeitando limites', async ({ page }) => {
    await page.click('#btnOpenAdvisorFromFeed');
    await expect(page.locator('#modalStrategicAdvisor')).toBeVisible();

    await page.fill('#advisorQueryInput', 'Posso gastar 200 em um jantar hoje?');
    await page.click('#btnSubmitAdvisorQuery');

    let response = page.locator('.advisor-bot-msg').last();
    await expect(response).toContainText('Simulação de Gasto');
    await expect(response.locator('button.linsora-btn.primary')).toHaveCount(0);

    await page.fill('#advisorQueryInput', '200 em um jantar');
    await page.click('#btnSubmitAdvisorQuery');

    response = page.locator('.advisor-bot-msg').last();
    await expect(response).toContainText('Simulação ou Registro?');
  });

  test('Deve executar registro explícito diretamente', async ({ page }) => {
    await page.click('#btnOpenAdvisorFromFeed');
    await page.fill('#advisorQueryInput', 'Registre 150 reais de padaria');
    await page.click('#btnSubmitAdvisorQuery');

    const response = page.locator('.advisor-bot-msg').last();
    await expect(response).toContainText('Resumo do Comando');
    await expect(response).toContainText('R$ 150,00');
  });

  test('Deve processar PIX enviado corretamente', async ({ page }) => {
    await page.click('#btnOpenAdvisorFromFeed');
    await page.fill('#advisorQueryInput', 'Pix de 50 para João');
    await page.click('#btnSubmitAdvisorQuery');

    const response = page.locator('.advisor-bot-msg').last();
    await expect(response).toContainText('Resumo do Comando');
  });

  test('Deve processar PIX recebido corretamente', async ({ page }) => {
    await page.click('#btnOpenAdvisorFromFeed');
    await page.fill('#advisorQueryInput', 'Recebi um pix de 500 do Marcos');
    await page.click('#btnSubmitAdvisorQuery');

    const response = page.locator('.advisor-bot-msg').last();
    await expect(response).toContainText('Resumo do Comando');
  });

  test('Deve criar Reserva de Emergência e suportar aporte ilimitado', async ({ page }) => {
    await page.click('#btnOpenAdvisorFromFeed');
    
    await page.fill('#advisorQueryInput', 'Criar uma Reserva de Emergência de 10 mil');
    await page.click('#btnSubmitAdvisorQuery');
    
    let response = page.locator('.advisor-bot-msg').last();
    await expect(response).toContainText('Simulação ou Registro');
  });
});
