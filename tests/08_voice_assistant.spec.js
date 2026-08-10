const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.describe('08. Assistente Financeiro por Voz (NLP Parser & Fluxo de Confirmação/Edição)', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.click('.bottom-nav .nav-item[data-tab="tabTransactions"]');
    await expect(page.locator('#tabTransactions')).toBeVisible();
  });

  test('Deve interpretar frases em linguagem natural através do TransactionAIParser', async ({ page }) => {
    const resultExpense = await page.evaluate(() => {
      return window.TransactionAIParser.parseText('Gastei 45 reais no mercado hoje');
    });

    expect(resultExpense.type).toBe('DESPESA');
    expect(resultExpense.amount).toBe(45);
    expect(resultExpense.category).toBe('Alimentação');
    expect(resultExpense.description).toContain('Mercado');

    const resultIncome = await page.evaluate(() => {
      return window.TransactionAIParser.parseText('Recebi 3500 reais de salario no dia 10');
    });

    expect(resultIncome.type).toBe('RECEITA');
    expect(resultIncome.amount).toBe(3500);
    expect(resultIncome.category).toBe('Salário');

    const resultTransport = await page.evaluate(() => {
      return window.TransactionAIParser.parseText('Comprei gasolina de 150 ontem');
    });

    expect(resultTransport.type).toBe('DESPESA');
    expect(resultTransport.amount).toBe(150);
    expect(resultTransport.category).toBe('Transporte');
  });

  test('Deve abrir o assistente de voz e processar fala -> card de confirmação -> salvar no Supabase', async ({ page }) => {
    // 1. Clicar no botão de microfone no topo do extrato
    await expect(page.locator('#btnMicHeader')).toBeVisible();
    await page.click('#btnMicHeader');

    // 2. Verificar abertura do modal de escuta
    await expect(page.locator('#modalVoiceListening')).toBeVisible();

    // 3. Simular entrada de voz/texto
    await page.fill('#voiceManualInput', 'Gastei 85,50 no restaurante hoje');
    await page.click('#btnVoiceProcessNow');

    // 4. Modal de escuta fecha e card de confirmação abre
    await expect(page.locator('#modalVoiceListening')).toHaveClass(/hidden/);
    await expect(page.locator('#modalVoiceConfirmation')).toBeVisible();

    // 5. Validar informações interpretadas no Card de Confirmação
    await expect(page.locator('#voiceConfAmount')).toContainText('85,50');
    await expect(page.locator('#voiceConfTypeBadge')).toContainText('Despesa');
    await expect(page.locator('#voiceConfCategory')).toContainText('Alimentação');

    // 6. Clicar em Salvar no Card de Confirmação
    await page.click('#btnVoiceConfSave');

    // 7. Card fecha e a transação aparece na lista do Supabase
    await expect(page.locator('#modalVoiceConfirmation')).toHaveClass(/hidden/);
    await expect(page.locator('#fullTransactionsList')).toContainText('Restaurante');
    await expect(page.locator('#fullTransactionsList')).toContainText('- R$ 85,50');
  });

  test('Deve permitir a opção "Editar" para alterar campos no formulário antes de salvar', async ({ page }) => {
    // 1. Abrir assistente de voz
    await page.click('#btnMicHeader');
    await expect(page.locator('#modalVoiceListening')).toBeVisible();

    // 2. Processar texto com valor e descrição
    await page.fill('#voiceManualInput', 'Gastei 120 reais em roupas');
    await page.click('#btnVoiceProcessNow');

    // 3. Verificar card de confirmação
    await expect(page.locator('#modalVoiceConfirmation')).toBeVisible();

    // 4. Clicar no botão "Editar"
    await page.click('#btnVoiceConfEdit');

    // 5. Card de confirmação fecha e abre o formulário principal com campos preenchidos
    await expect(page.locator('#modalVoiceConfirmation')).toHaveClass(/hidden/);
    await expect(page.locator('#modalTransactionForm')).toBeVisible();

    // 6. Validar pré-preenchimento
    await expect(page.locator('#txAmount')).toHaveValue('120,00');
    await expect(page.locator('#txDescription')).toHaveValue('Roupas');

    // 7. Alterar a descrição para "Roupas e Calçados" e salvar pelo formulário
    await page.fill('#txDescription', 'Roupas e Calçados');
    await page.click('#btnSaveTransaction');

    // 8. Verificar salvamento com sucesso
    await expect(page.locator('#modalTransactionForm')).toHaveClass(/hidden/);
    await expect(page.locator('#fullTransactionsList')).toContainText('Roupas e Calçados');
  });

});
