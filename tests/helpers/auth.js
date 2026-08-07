const { expect } = require('@playwright/test');

/**
 * Realiza o fluxo completo de login na aplicação LINSORA.
 * 
 * 1. Define 'LINSORA_SEEN_ONBOARDING' como 'true' para pular a apresentação.
 * 2. Garante que a tela de login (#authScreen) está visível.
 * 3. Preenche as credenciais padrão (ou customizadas) de e-mail e senha.
 * 4. Submete o formulário de autenticação (#btnSubmitAuth).
 * 5. AGUARDA EXPLICITAMENTE que a interface principal (#appMain) fique visível
 *    com expect(locator).toBeVisible() antes de prosseguir para qualquer outra ação.
 * 
 * @param {import('@playwright/test').Page} page - Instância da página do Playwright
 * @param {Object} [options]
 * @param {string} [options.email='teste@linsora.com.br']
 * @param {string} [options.password='123456']
 * @param {boolean} [options.skipOnboarding=true]
 */
async function login(page, options = {}) {
  const {
    email = 'teste@linsora.com.br',
    password = '123456',
    skipOnboarding = true
  } = options;

  await page.goto('/');

  if (skipOnboarding) {
    await page.evaluate(() => localStorage.setItem('LINSORA_SEEN_ONBOARDING', 'true'));
    await page.reload();
  }

  // Garantir que a tela de auth esteja pronta e visível
  await expect(page.locator('#authScreen')).toBeVisible();

  // Preencher credenciais obrigatórias
  await page.fill('#authEmail', email);
  await page.fill('#authPassword', password);
  await page.click('#btnSubmitAuth');

  // Esperar explicitamente a interface principal carregar e ficar visível
  await expect(page.locator('#appMain')).toBeVisible();
}

module.exports = { login };
