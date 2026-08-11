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

    // Testes de Intenção e Banimento de Salário para Despesas
    const resultTvBox = await page.evaluate(() => {
      return window.TransactionAIParser.parseText('pagamento do TV box no valor de r$ 40');
    });

    expect(resultTvBox.type).toBe('DESPESA');
    expect(resultTvBox.amount).toBe(40);
    expect(resultTvBox.category).toBe('Serviços');
    expect(resultTvBox.category).not.toBe('Salário');

    const resultApt = await page.evaluate(() => {
      return window.TransactionAIParser.parseText('pagamento do apartamento no valor de r$ 1100');
    });

    expect(resultApt.type).toBe('DESPESA');
    expect(resultApt.amount).toBe(1100);
    expect(resultApt.category).toBe('Moradia');
    expect(resultApt.category).not.toBe('Salário');

    const resultEnergia = await page.evaluate(() => {
      return window.TransactionAIParser.parseText('conta de energia no valor de r$ 150');
    });

    expect(resultEnergia.type).toBe('DESPESA');
    expect(resultEnergia.amount).toBe(150);
    expect(resultEnergia.category).toBe('Moradia');
    expect(resultEnergia.category).not.toBe('Salário');

    // Teste de Tradução de Termos Técnicos para Português
    const translationTest = await page.evaluate(() => {
      return {
        single: window.LinsoraUtils.translateRepetition('SINGLE'),
        monthly: window.LinsoraUtils.translateRepetition('MONTHLY'),
        parceled: window.LinsoraUtils.translateRepetition('PARCELED')
      };
    });

    expect(translationTest.single).toBe('Única');
    expect(translationTest.monthly).toBe('Mensal');
    expect(translationTest.parceled).toBe('Parcelada');
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

  test('Deve abrir o assistente de voz diretamente do botão flutuante (FAB) e do atalho no Dashboard', async ({ page }) => {
    // Ir para a aba Dashboard
    await page.click('.bottom-nav .nav-item[data-tab="tabDashboard"]');
    await expect(page.locator('#tabDashboard')).toBeVisible();

    // 1. Testar FAB Flutuante de Voz (#btnFabVoice)
    await expect(page.locator('#btnFabVoice')).toBeVisible();
    await page.click('#btnFabVoice');
    await expect(page.locator('#modalVoiceListening')).toBeVisible();
    await page.click('#btnVoiceCancel');
    await expect(page.locator('#modalVoiceListening')).toHaveClass(/hidden/);

    // 2. Testar Atalho Rápido no Dashboard (#btnQuickVoice)
    await expect(page.locator('#btnQuickVoice')).toBeVisible();
    await page.click('#btnQuickVoice');
    await expect(page.locator('#modalVoiceListening')).toBeVisible();
  });

  test('Deve detectar intenção de meta ao falar palavras-chave de meta/reserva e jamais lançar como despesa', async ({ page }) => {
    await page.click('.bottom-nav .nav-item[data-tab="tabDashboard"]');
    await expect(page.locator('#btnFabVoice')).toBeVisible();
    await page.click('#btnFabVoice');
    await expect(page.locator('#modalVoiceListening')).toBeVisible();

    // Falar uma frase de criação de meta com prazo e aporte mensal
    await page.fill('#voiceManualInput', 'crie uma meta de r$ 10000 até julho de 2027 apontando r$ 500 por mês');
    await page.click('#btnVoiceProcessNow');

    // NUNCA deve abrir o card de confirmação de despesa (#modalVoiceConfirmation)
    await expect(page.locator('#modalVoiceConfirmation')).toHaveClass(/hidden/);

    // DEVE abrir o card de confirmação de meta (#modalGoalVoiceConfirmation)
    await expect(page.locator('#modalGoalVoiceConfirmation')).toBeVisible();
    await expect(page.locator('#goalConfTarget')).toContainText('10.000,00');
    await expect(page.locator('#goalConfMonthly')).toContainText('500,00/mês');
  });

});
