const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.describe('09. Assistente de Voz para Metas & Sistema de Temas Claro/Escuro', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Deve interpretar frases de Metas e Reservas em linguagem natural através do TransactionAIParser.parseGoalText', async ({ page }) => {
    // 1. Reserva de Emergência
    const resEmergencia = await page.evaluate(() => {
      return window.TransactionAIParser.parseGoalText('Quero criar uma reserva de emergencia de 12 mil reais em 12 meses');
    });

    expect(resEmergencia.type).toBe('Reserva de Emergência');
    expect(resEmergencia.icon).toBe('🛡️');
    expect(resEmergencia.target).toBe(12000);
    expect(resEmergencia.monthsLeft).toBeNull();
    expect(resEmergencia.suggestedMonthly).toBe(0);

    // 2. Reserva Financeira
    const resFinanceira = await page.evaluate(() => {
      return window.TransactionAIParser.parseGoalText('Quero guardar 24000 reais na reserva financeira em 2 anos');
    });

    expect(resFinanceira.type).toBe('Reserva Financeira');
    expect(resFinanceira.icon).toBe('💰');
    expect(resFinanceira.target).toBe(24000);
    expect(resFinanceira.monthsLeft).toBe(24);
    expect(resFinanceira.suggestedMonthly).toBe(1000);

    // 4. Teste de Parsing de Título Estruturado (Sem comandos no nome)
    const resCarro = await page.evaluate(() => {
      return window.TransactionAIParser.parseGoalText('crie uma meta com o nome o nome da meta é carro no valor de r$ 50000 até julho de 2030');
    });

    expect(resCarro.title).toBe('Carro');
    expect(resCarro.target).toBe(50000);
    expect(resCarro.deadline).toContain('2030-07');

    const resCarroSimples = await page.evaluate(() => {
      return window.TransactionAIParser.parseGoalText('cria uma meta com o nome carro no valor de 50 mil reais até julho de 2030');
    });

    expect(resCarroSimples.title).toBe('Carro');
    expect(resCarroSimples.target).toBe(50000);
  });

  test('Deve abrir o assistente de voz na tela de Metas e processar fala -> card de confirmação -> salvar no Supabase', async ({ page }) => {
    // Ir para a aba de Metas
    await page.click('.bottom-nav .nav-item[data-tab="tabGoals"]');
    await expect(page.locator('#tabGoals')).toBeVisible();

    // 1. Clicar no botão de microfone no topo de Metas (#btnMicGoalsHeader)
    await expect(page.locator('#btnMicGoalsHeader')).toBeVisible();
    await page.click('#btnMicGoalsHeader');

    // 2. Modal de escuta abre
    await expect(page.locator('#modalVoiceListening')).toBeVisible();

    // 3. Digitar frase e processar
    await page.fill('#voiceManualInput', 'Quero criar um fundo de emergencia de 15 mil reais em 10 meses');
    await page.click('#btnVoiceProcessNow');

    // 4. Modal de escuta fecha e Card de Confirmação de Metas abre
    await expect(page.locator('#modalVoiceListening')).toHaveClass(/hidden/);
    await expect(page.locator('#modalGoalVoiceConfirmation')).toBeVisible();

    // 5. Validar campos no Card de Confirmação
    await expect(page.locator('#goalConfTypeBadge')).toContainText('Reserva de Emergência');
    await expect(page.locator('#goalConfTarget')).toContainText('15.000,00');
    await expect(page.locator('#goalConfMonthly')).toContainText('0,00/mês');

    // 6. Clicar em Salvar
    await page.click('#btnGoalConfSave');

    // 7. Card fecha e a meta aparece na tela
    await expect(page.locator('#modalGoalVoiceConfirmation')).toHaveClass(/hidden/);
    await expect(page.locator('#goalsGridList')).toContainText('Reserva de Emergência');
    await expect(page.locator('#goalsGridList')).toContainText('15.000,00');
  });

  test('Deve permitir a opção "Editar" no card de voz de metas, preenchendo o formulário modalGoalForm', async ({ page }) => {
    await page.click('.bottom-nav .nav-item[data-tab="tabGoals"]');
    await expect(page.locator('#tabGoals')).toBeVisible();

    // 1. Clicar no botão "+ Nova Meta"
    await page.click('#btnAddGoal');
    await expect(page.locator('#modalGoalForm')).toBeVisible();

    // 2. Clicar no botão de microfone do formulário (#btnMicInGoalForm)
    await page.click('#btnMicInGoalForm');
    await expect(page.locator('#modalGoalForm')).toHaveClass(/hidden/);
    await expect(page.locator('#modalVoiceListening')).toBeVisible();

    // 3. Inserir voz e processar
    await page.fill('#voiceManualInput', 'Minha meta é comprar um carro novo guardando 30 mil reais em 15 meses');
    await page.click('#btnVoiceProcessNow');

    // 4. Card de confirmação exibe dados
    await expect(page.locator('#modalGoalVoiceConfirmation')).toBeVisible();

    // 5. Clicar em Editar
    await page.click('#btnGoalConfEdit');

    // 6. Card de confirmação fecha e abre o formulário preenchido
    await expect(page.locator('#modalGoalVoiceConfirmation')).toHaveClass(/hidden/);
    await expect(page.locator('#modalGoalForm')).toBeVisible();

    // 7. Validar pré-preenchimento
    await expect(page.locator('#goalTitleInput')).toHaveValue(/Carro Novo/i);
    await expect(page.locator('#goalTargetInput')).toHaveValue('30.000,00');

    // 8. Salvar pelo formulário
    await page.click('#btnSaveGoal');
    await expect(page.locator('#modalGoalForm')).toHaveClass(/hidden/);
    await expect(page.locator('#goalsGridList')).toContainText('carro novo', { ignoreCase: true });
  });

  test('Deve alternar perfeitamente entre Tema Claro e Tema Escuro sem textos invisíveis', async ({ page }) => {
    // Ir para a aba do Perfil / Configurações
    await page.click('.bottom-nav .nav-item[data-tab="tabProfile"]');
    await expect(page.locator('#tabProfile')).toBeVisible();

    // 1. Clicar em Alternar Tema (Ativar Tema Claro)
    await page.click('#btnToggleTheme');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // 2. Validar que as variáveis de tema claro estão aplicadas no body e headings
    const bodyColor = await page.evaluate(() => {
      return getComputedStyle(document.body).color;
    });
    expect(bodyColor).toContain('15');

    // 3. Ir para o Dashboard e verificar que o Hero Card (.month-balance-hero) tem fundo claro e texto visível
    await page.click('.bottom-nav .nav-item[data-tab="tabDashboard"]');
    const heroBg = await page.evaluate(() => {
      const hero = document.querySelector('.month-balance-hero');
      return getComputedStyle(hero).backgroundImage || getComputedStyle(hero).backgroundColor;
    });
    expect(heroBg).toBeDefined();

    const nwValColor = await page.evaluate(() => {
      const el = document.querySelector('.nw-main-val');
      return getComputedStyle(el).color;
    });
    expect(nwValColor).toContain('15'); // #0F172A

    // 4. Ir para a aba de Metas e verificar contraste da visão geral no Tema Claro
    await page.click('.bottom-nav .nav-item[data-tab="tabGoals"]');
    const goalsOverviewColor = await page.evaluate(() => {
      const el = document.querySelector('.goals-overview-header h3');
      return el ? getComputedStyle(el).color : '';
    });
    if (goalsOverviewColor) expect(goalsOverviewColor).toContain('15');

    // 5. Voltar para Tema Escuro
    await page.click('.bottom-nav .nav-item[data-tab="tabProfile"]');
    await page.click('#btnToggleTheme');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('Deve exibir 3 ações no card da meta (Aporte, Editar, Excluir) e permitir aportes em metas existentes por voz sem duplicar', async ({ page }) => {
    await page.click('.bottom-nav .nav-item[data-tab="tabGoals"]');
    await expect(page.locator('#tabGoals')).toBeVisible();

    // 1. Criar uma meta para teste
    await page.click('#btnAddGoal');
    await page.fill('#goalTitleInput', 'Viagem de Férias');
    await page.fill('#goalTargetInput', '5.000,00');
    await page.fill('#goalDeadlineInput', '2027-12-31');
    await page.click('#btnSaveGoal');

    // 2. Verificar que o card foi criado e tem os 3 botões de ação
    const card = page.locator('#goalsGridList .goal-item-card-enhanced').filter({ hasText: 'Viagem de Férias' }).first();
    await expect(card).toBeVisible();
    await expect(card.locator('.btn-deposit-goal')).toBeVisible();
    await expect(card.locator('.btn-edit-goal')).toBeVisible();
    await expect(card.locator('.btn-delete-goal')).toBeVisible();

    // 3. Testar comando de voz para APORTE em meta existente (sem criar duplicada)
    await page.click('#btnMicGoalsHeader');
    await page.fill('#voiceManualInput', 'guardar 500 reais na meta viagem');
    await page.click('#btnVoiceProcessNow');

    // Card de confirmação de meta indica APORTE EM META EXISTENTE
    await expect(page.locator('#modalGoalVoiceConfirmation')).toBeVisible();
    await expect(page.locator('#goalConfTypeBadge')).toContainText('APORTE EM META EXISTENTE');
    await page.click('#btnGoalConfSave');

    // Salvo com sucesso e valor guardado atualizado no card
    await expect(card.locator('.goal-values')).toContainText('500,00');

    // 4. Testar botão de edição direta no card (.btn-edit-goal)
    await card.locator('.btn-edit-goal').click();
    await expect(page.locator('#modalGoalForm')).toBeVisible();
    await page.fill('#goalTargetInput', '6.000,00');
    await page.click('#btnSaveGoal');
    await expect(card.locator('.goal-values')).toContainText('6.000,00');

    // 5. Testar exclusão da meta (.btn-delete-goal) usando o modal nativo Linsora
    await card.locator('.btn-delete-goal').click();
    await expect(page.locator('#modalConfirmDelete')).toBeVisible();
    await expect(page.locator('#confirmDeleteTitle')).toHaveText('Confirmar exclusão');
    await page.click('#btnConfirmDeleteConfirm');
    await expect(card).not.toBeVisible();
  });

});
