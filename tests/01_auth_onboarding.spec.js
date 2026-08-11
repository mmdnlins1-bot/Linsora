const { test, expect } = require('@playwright/test');

test.describe('01. Fluxo de Autenticação & Onboarding', () => {

  test.beforeEach(async ({ page }) => {
    // Limpar armazenamento para simular primeiro acesso
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();
    // Aguardar a splash screen aparecer
    await expect(page.locator('#splashScreen')).toBeVisible({ timeout: 5000 });
  });

  test('Deve carregar a Splash Screen e ocultá-la após timeout', async ({ page }) => {
    const splash = page.locator('#splashScreen');
    await expect(splash).toBeVisible();
    // A splash deve sumir em até 5 segundos (timer de 1200ms + margem)
    await expect(splash).toHaveClass(/hidden/, { timeout: 5000 });
  });

  test('Deve navegar pelas etapas de Onboarding e acessar a tela de Login', async ({ page }) => {
    // Aguardar a splash sumir e onboarding aparecer
    await expect(page.locator('#onboardingScreen')).toBeVisible({ timeout: 5000 });

    // Step 1 -> Step 2
    await page.click('#btnNextOnboarding');
    const step2 = page.locator('.onboarding-step[data-step="2"]');
    await expect(step2).toHaveClass(/active/);

    // Step 2 -> Step 3
    await page.click('#btnNextOnboarding');
    const step3 = page.locator('.onboarding-step[data-step="3"]');
    await expect(step3).toHaveClass(/active/);

    // Step 3 -> Auth Screen
    await page.click('#btnNextOnboarding');
    await expect(page.locator('#onboardingScreen')).toHaveClass(/hidden/);
    await expect(page.locator('#authScreen')).toBeVisible();
  });

  test('Deve alternar entre Login e Cadastro', async ({ page }) => {
    await expect(page.locator('#onboardingScreen')).toBeVisible({ timeout: 5000 });
    await page.click('#btnSkipOnboarding');

    await expect(page.locator('#authScreen')).toBeVisible();
    const btnToggle = page.locator('#btnToggleAuthMode');
    await btnToggle.click();

    await expect(page.locator('#authTitle')).toHaveText('Criar sua conta');
    await expect(page.locator('#nameGroup')).toBeVisible();
    await expect(page.locator('#confirmPasswordGroup')).toBeVisible();

    await btnToggle.click();
    await expect(page.locator('#authTitle')).toHaveText('Seja bem-vindo(a)');
  });

  test('Deve permitir Entrar na Conta (Modo Convidado / Email)', async ({ page }) => {
    await expect(page.locator('#onboardingScreen')).toBeVisible({ timeout: 5000 });
    await page.click('#btnSkipOnboarding');

    await page.fill('#authEmail', 'teste@linsora.com.br');
    await page.fill('#authPassword', '123456');
    await page.click('#btnSubmitAuth');

    await expect(page.locator('#authScreen')).toHaveClass(/hidden/);
    await expect(page.locator('#appMain')).toBeVisible();
    await expect(page.locator('#userNameHeader')).toBeVisible();
  });

  test('Deve realizar Logout com segurança', async ({ page }) => {
    await expect(page.locator('#onboardingScreen')).toBeVisible({ timeout: 5000 });
    await page.click('#btnSkipOnboarding');

    await page.fill('#authEmail', 'teste@linsora.com.br');
    await page.fill('#authPassword', '123456');
    await page.click('#btnSubmitAuth');

    // Espera explícita da interface principal estar visível
    await expect(page.locator('#appMain')).toBeVisible();

    // Ir para a guia perfil e clicar em Logout
    await page.click('.bottom-nav .nav-item[data-tab="tabProfile"]');
    await expect(page.locator('#tabProfile')).toBeVisible();

    await page.evaluate(() => document.getElementById('btnLogout')?.click());

    await expect(page.locator('#appMain')).toHaveClass(/hidden/);
    await expect(page.locator('#authScreen')).toBeVisible();
  });
});


