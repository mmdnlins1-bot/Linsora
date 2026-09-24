const { test, expect } = require('@playwright/test');

test.describe('07. Auditoria de Multi-Usuários, Isolamento de Dados & Troca de Contas', () => {

  test.beforeEach(async ({ page }) => {
    // Acessar página inicial sem limpar armazenamento global no meio do teste
    await page.goto('/');
  });

  test('Fluxo completo multi-usuário: Cadastro, Isolamento Estrito, Troca de Contas e Persistência', async ({ page }) => {
    // Limpeza inicial explícita de storage
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();

    // ------------------------------------------------------------------------
    // 1. ETAPA ONBOARDING -> TELA DE AUTH
    // ------------------------------------------------------------------------
    await expect(page.locator('#onboardingScreen')).toBeVisible({ timeout: 5000 });
    await page.click('#btnSkipOnboarding');
    await expect(page.locator('#authScreen')).toBeVisible();

    // ------------------------------------------------------------------------
    // 2. CADASTRO & LOGIN DO USUÁRIO A
    // ------------------------------------------------------------------------
    await page.click('#btnToggleAuthMode');
    await expect(page.locator('#authTitle')).toHaveText('Criar sua conta');

    await page.fill('#authName', 'Usuário A');
    await page.fill('#authEmail', 'usuarioA@linsora.com.br');
    await page.fill('#authPassword', 'senha123');
    await page.fill('#authConfirmPassword', 'senha123');
    await page.click('#btnSubmitAuth');

    await expect(page.locator('#authScreen')).toHaveClass(/hidden/);
    await expect(page.locator('#appMain')).toBeVisible();
    await expect(page.locator('#userNameHeader')).toHaveText('Usuário A');

    // Usuário A cadastra uma receita de R$ 10.000,00 (via FAB +)
    await page.click('#btnFabNewTransaction');
    await expect(page.locator('#modalTransactionForm')).toBeVisible();
    await page.click('#btnTypeIncome');
    await page.fill('#txAmount', '1000000'); // R$ 10.000,00
    await page.fill('#txDescription', 'Salário Exclusivo Usuário A');
    await page.click('#btnSaveTransaction');

    await expect(page.locator('#modalTransactionForm')).toHaveClass(/hidden/);
    await expect(page.locator('#monthIncomeAmount')).toContainText('R$ 10.000,00');
    await expect(page.locator('#recentTransactionsList')).toContainText('Salário Exclusivo Usuário A');

    // Guardar o id de A para a verificação S3 (cache removido no logout)
    const userIdA = await page.evaluate(() => window.linsoraStore.state.user.id);

    // ------------------------------------------------------------------------
    // 3. LOGOUT DO USUÁRIO A
    // ------------------------------------------------------------------------
    await page.click('.bottom-nav .nav-item[data-tab="tabProfile"]');
    await expect(page.locator('#tabProfile')).toBeVisible();
    await page.click('#btnLogout');

    await expect(page.locator('#appMain')).toHaveClass(/hidden/);
    await expect(page.locator('#authScreen')).toBeVisible();

    // S3: o cache financeiro local de A deve ter sido removido no logout
    expect(await page.evaluate((id) => localStorage.getItem('LINSORA_DB_CACHE_' + id) === null, userIdA)).toBe(true);

    // ------------------------------------------------------------------------
    // 4. CADASTRO & LOGIN DO USUÁRIO B (VERIFICAÇÃO DE ISOLAMENTO 100% ZERADO)
    // ------------------------------------------------------------------------
    await page.click('#btnToggleAuthMode');
    await expect(page.locator('#authTitle')).toHaveText('Criar sua conta');

    await page.fill('#authName', 'Usuário B');
    await page.fill('#authEmail', 'usuarioB@linsora.com.br');
    await page.fill('#authPassword', 'senha456');
    await page.fill('#authConfirmPassword', 'senha456');
    await page.click('#btnSubmitAuth');

    await expect(page.locator('#authScreen')).toHaveClass(/hidden/);
    await expect(page.locator('#appMain')).toBeVisible();
    await expect(page.locator('#userNameHeader')).toHaveText('Usuário B');

    // Garantir que Usuário B NÃO enxerga as transações do Usuário A!
    await expect(page.locator('#recentTransactionsList')).not.toContainText('Salário Exclusivo Usuário A');
    await expect(page.locator('#monthIncomeAmount')).toContainText('R$ 0,00');

    // Usuário B cadastra sua própria despesa de R$ 450,00 (via FAB +)
    await page.click('#btnFabNewTransaction');
    await expect(page.locator('#modalTransactionForm')).toBeVisible();
    await page.fill('#txAmount', '45000'); // R$ 450,00
    await page.fill('#txDescription', 'Mercado Exclusivo Usuário B');
    await page.click('#btnSaveTransaction');

    await expect(page.locator('#modalTransactionForm')).toHaveClass(/hidden/);
    await expect(page.locator('#monthExpenseAmount')).toContainText('R$ 450,00');
    await expect(page.locator('#recentTransactionsList')).toContainText('Mercado Exclusivo Usuário B');

    // Guardar o id de B para a verificação S3 (cache removido no logout)
    const userIdB = await page.evaluate(() => window.linsoraStore.state.user.id);

    // ------------------------------------------------------------------------
    // 5. TROCA DE CONTAS: LOGOUT DE B & RELOGIN DE A (POLÍTICA S3)
    // Em modo local sem backend, o logout remove o cache financeiro (ETAPA 8C),
    // então o relogin NÃO restaura a transação antiga de A. Com Supabase real,
    // os dados seriam reconstruídos do servidor.
    // ------------------------------------------------------------------------
    await page.click('.bottom-nav .nav-item[data-tab="tabProfile"]');
    await expect(page.locator('#tabProfile')).toBeVisible();
    await page.click('#btnLogout');

    await expect(page.locator('#appMain')).toHaveClass(/hidden/);
    await expect(page.locator('#authScreen')).toBeVisible();

    // S3: o cache financeiro local de B também deve ter sido removido
    expect(await page.evaluate((id) => localStorage.getItem('LINSORA_DB_CACHE_' + id) === null, userIdB)).toBe(true);

    // Login com Usuário A
    await page.fill('#authEmail', 'usuarioA@linsora.com.br');
    await page.fill('#authPassword', 'senha123');
    await page.click('#btnSubmitAuth');

    await expect(page.locator('#appMain')).toBeVisible();
    await expect(page.locator('#userNameHeader')).toHaveText('Usuário A');

    // Isolamento: nenhum dado de B aparece para A
    await expect(page.locator('#recentTransactionsList')).not.toContainText('Mercado Exclusivo Usuário B');
    // S3 (modo local): a transação antiga de A NÃO volta sem backend
    await expect(page.locator('#recentTransactionsList')).not.toContainText('Salário Exclusivo Usuário A');
    await expect(page.locator('#monthIncomeAmount')).toContainText('R$ 0,00');

    // Nova transação como A na sessão atual (via FAB +)
    await page.click('#btnFabNewTransaction');
    await expect(page.locator('#modalTransactionForm')).toBeVisible();
    await page.click('#btnTypeIncome');
    await page.fill('#txAmount', '200000'); // R$ 2.000,00
    await page.fill('#txDescription', 'Salário A Nova Sessão');
    await page.click('#btnSaveTransaction');

    await expect(page.locator('#modalTransactionForm')).toHaveClass(/hidden/);
    await expect(page.locator('#recentTransactionsList')).toContainText('Salário A Nova Sessão');
    await expect(page.locator('#monthIncomeAmount')).toContainText('R$ 2.000,00');

    // ------------------------------------------------------------------------
    // 6. PERSISTÊNCIA DA SESSÃO DO USUÁRIO A APÓS RECARREGAR PÁGINA (RELOAD SEM LOGOUT)
    // ------------------------------------------------------------------------
    await page.reload();
    await expect(page.locator('#appMain')).toBeVisible();
    await expect(page.locator('#userNameHeader')).toHaveText('Usuário A');
    await expect(page.locator('#recentTransactionsList')).toContainText('Salário A Nova Sessão');
    await expect(page.locator('#monthIncomeAmount')).toContainText('R$ 2.000,00');
  });

  test('Deve rejeitar cadastro duplicado com o mesmo e-mail', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();
    // Aguardar splash sumir e onboarding aparecer
    await expect(page.locator('#splashScreen')).toBeVisible({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500); // Aguardar timer da splash (1200ms)

    await page.click('#btnSkipOnboarding');
    await page.click('#btnToggleAuthMode');

    // Cadastrar usuarioX
    await page.fill('#authName', 'Usuário X');
    await page.fill('#authEmail', 'duplicado@linsora.com.br');
    await page.fill('#authPassword', '123456');
    await page.fill('#authConfirmPassword', '123456');
    await page.click('#btnSubmitAuth');

    await expect(page.locator('#appMain')).toBeVisible();

    // Logout
    await page.click('.bottom-nav .nav-item[data-tab="tabProfile"]');
    await page.click('#btnLogout');
    await expect(page.locator('#authScreen')).toBeVisible();

    // Tentar cadastrar novamente o mesmo e-mail
    await page.click('#btnToggleAuthMode');
    await page.fill('#authName', 'Outro Nome');
    await page.fill('#authEmail', 'duplicado@linsora.com.br');
    await page.fill('#authPassword', '654321');
    await page.fill('#authConfirmPassword', '654321');
    await page.click('#btnSubmitAuth');

    // Deve exibir toast de erro informando e-mail já cadastrado
    await expect(page.locator('#toastContainer')).toContainText('Este e-mail já está cadastrado');
    await expect(page.locator('#authScreen')).toBeVisible();
  });
});
