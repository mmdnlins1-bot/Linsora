const { test, expect } = require('@playwright/test');

test.describe('01. Fluxo de Autenticação & Onboarding', () => {

  test.beforeEach(async ({ page }) => {
    // Simula visitante vindo pela landing: limpa o storage e entra pelo
    // funil (?vamos-comecar=1), que registra a flag e exibe o login direto
    // (onboarding interno não é mais a porta de entrada).
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto('/?vamos-comecar=1');
  });

  test('Deve carregar a Splash Screen e ocultá-la após timeout', async ({ page }) => {
    const splash = page.locator('#splashScreen');
    await expect(splash).toHaveClass(/hidden/, { timeout: 5000 });
  });

  test('Vai direto ao login após o funil da landing (sem onboarding interno)', async ({ page }) => {
    await expect(page.locator('#authScreen')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#onboardingScreen')).toHaveClass(/hidden/);
    expect(page.url()).not.toContain('vamos-comecar');
  });

  test('Deve alternar entre Login e Cadastro com validação de campos', async ({ page }) => {
    await expect(page.locator('#authScreen')).toBeVisible({ timeout: 8000 });
    const btnToggle = page.locator('#btnToggleAuthMode');
    await btnToggle.click();

    await expect(page.locator('#authTitle')).toHaveText('Criar sua conta');
    await expect(page.locator('#nameGroup')).toBeVisible();
    await expect(page.locator('#confirmPasswordGroup')).toBeVisible();

    // Tentar cadastrar com senhas divergentes
    await page.fill('#authName', 'Usuário Teste Novo');
    await page.fill('#authEmail', 'novo_usuario@linsora.com.br');
    await page.fill('#authPassword', '123456');
    await page.fill('#authConfirmPassword', '654321');
    await page.click('#btnSubmitAuth');

    // Toast de erro para senhas que não coincidem
    await expect(page.locator('#toastContainer')).toContainText('As senhas não coincidem');

    await btnToggle.click();
    await expect(page.locator('#authTitle')).toHaveText('Seja bem-vindo(a)');
  });

  test('Deve criar nova conta e realizar login automático com salvamento no banco', async ({ page }) => {
    await expect(page.locator('#authScreen')).toBeVisible({ timeout: 8000 });

    const btnToggle = page.locator('#btnToggleAuthMode');
    await btnToggle.click();

    const uniqueEmail = `novo_user_${Date.now()}@linsora.com.br`;
    await page.fill('#authName', 'Carlos Eduardo');
    await page.fill('#authEmail', uniqueEmail);
    await page.fill('#authPassword', 'senhaSegura123');
    await page.fill('#authConfirmPassword', 'senhaSegura123');
    await page.click('#btnSubmitAuth');

    await expect(page.locator('#authScreen')).toHaveClass(/hidden/);
    await expect(page.locator('#appMain')).toBeVisible();
    await expect(page.locator('#userNameHeader')).toHaveText('Carlos Eduardo');
  });

  test('Deve manter a sessão ativa ao fechar/recarregar o app (Persistência da Sessão)', async ({ page }) => {
    await expect(page.locator('#authScreen')).toBeVisible({ timeout: 8000 });

    await page.fill('#authEmail', 'persistente@linsora.com.br');
    await page.fill('#authPassword', '123456');
    await page.click('#btnSubmitAuth');

    await expect(page.locator('#appMain')).toBeVisible();

    // Simular o usuário fechando e reabrindo o aplicativo (Page Reload)
    await page.reload();

    // O aplicativo deve ir diretamente para a interface principal sem passar pelo login
    await expect(page.locator('#appMain')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#authScreen')).toHaveClass(/hidden/);
    await expect(page.locator('#onboardingScreen')).toHaveClass(/hidden/);
  });

  test('Deve realizar Logout apenas quando o usuário clicar no botão "Sair"', async ({ page }) => {
    await expect(page.locator('#authScreen')).toBeVisible({ timeout: 8000 });

    await page.fill('#authEmail', 'teste@linsora.com.br');
    await page.fill('#authPassword', '123456');
    await page.click('#btnSubmitAuth');

    await expect(page.locator('#appMain')).toBeVisible();

    // Ir para a guia perfil e clicar no botão Sair
    await page.click('.bottom-nav .nav-item[data-tab="tabProfile"]');
    await expect(page.locator('#tabProfile')).toBeVisible();
    await page.waitForTimeout(300);

    await page.evaluate(() => document.getElementById('btnLogout')?.click());

    await expect(page.locator('#appMain')).toHaveClass(/hidden/);
    await expect(page.locator('#authScreen')).toBeVisible();
  });
});
