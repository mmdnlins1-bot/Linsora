const { expect } = require('@playwright/test');

/**
 * Realiza o fluxo completo de login na aplicação LINSORA.
 * 
 * 1. Navega para a raiz da aplicação e aguarda o app.js carregar.
 * 2. Invoca grantAppAccess() para pular splash/onboarding/auth (modo de teste).
 * 3. Garante que #appMain está visível e que todos os modais estão fechados.
 * 4. Aguarda que o estado do store seja carregado (user presente).
 * 
 * @param {import('@playwright/test').Page} page
 * @param {Object} [options]
 * @param {string} [options.email='teste@linsora.com.br']
 * @param {string} [options.password='123456']
 */
async function login(page, options = {}) {
  await page.goto('/');

  // Aguardar a inicialização do app.js
  await page.waitForFunction(() => typeof window.grantAppAccess === 'function', { timeout: 10000 });

  // Definir onboarding como visto e acionar grantAppAccess
  await page.evaluate(() => {
    localStorage.setItem('LINSORA_SEEN_ONBOARDING', 'true');
    if (typeof window.grantAppAccess === 'function') {
      window.grantAppAccess();
    }
  });

  // Aguardar appMain visível
  await expect(page.locator('#appMain')).toBeVisible({ timeout: 8000 });

  // Fechar TODOS os modais que possam estar abertos de execuções anteriores
  await page.evaluate(() => {
    document.querySelectorAll('.linsora-modal-overlay:not(.hidden)').forEach(m => {
      m.classList.add('hidden');
    });
  });

  // Aguardar que o store esteja inicializado com dados do usuário
  await page.waitForFunction(() => {
    return window.linsoraStore &&
           window.linsoraStore.state &&
           window.linsoraStore.state.user;
  }, { timeout: 8000 });
}

module.exports = { login };
