const { expect } = require('@playwright/test');

/**
 * Realiza o fluxo REAL de login na aplicação LINSORA (sem atalhos globais).
 *
 * 1. Navega para a raiz, marca o onboarding como visto e recarrega para que
 *    o boot exiba a tela de login.
 * 2. Preenche o formulário de login e envia (modo local sem Supabase faz
 *    auto-registro; com Supabase usa a conta real).
 * 3. O gate de assinatura é exercido de verdade: sem backend configurado o
 *    acesso segue liberado (modo local); com backend, vale a subscription.
 * 4. Garante que #appMain está visível e que todos os modais estão fechados.
 * 5. Aguarda que o estado do store seja carregado (user presente).
 *
 * @param {import('@playwright/test').Page} page
 * @param {Object} [options]
 * @param {string} [options.email='teste@linsora.com.br']
 * @param {string} [options.password='123456']
 */
async function login(page, options = {}) {
  const email = options.email || 'teste@linsora.com.br';
  const password = options.password || '123456';

  await page.addInitScript(() => {
    try { localStorage.setItem('LINSORA_SEEN_ONBOARDING', 'true'); } catch (e) { /* ignora */ }
  });
  await page.goto('/');

  // Aguardar a inicialização do app.js
  await page.waitForFunction(
    () => window.linsoraStore && window.LinsoraAccess && window.supabaseRepo,
    { timeout: 10000 }
  );

  // Marcar onboarding como visto e recarregar para o boot decidir a rota:
  // com sessão válida entra direto no app; sem sessão exibe o login.
  await page.evaluate(() => {
    localStorage.setItem('LINSORA_SEEN_ONBOARDING', 'true');
  });
  await page.reload();
  await page.waitForFunction(
    () => window.linsoraStore && window.LinsoraAccess && window.supabaseRepo,
    { timeout: 10000 }
  );
  await page.waitForFunction(() => {
    const noHidden = (el) => el && !el.classList.contains('hidden');
    return noHidden(document.getElementById('appMain')) ||
           noHidden(document.getElementById('authScreen'));
  }, { timeout: 15000 });

  // Sessão restaurada: já está no app, sem precisar do formulário.
  if (await page.locator('#appMain:not(.hidden)').count()) {
    await expect(page.locator('#appMain')).toBeVisible({ timeout: 8000 });
  } else {
    // Fluxo real de login pelo formulário (passa pelo gate de assinatura).
    await expect(page.locator('#authScreen')).toBeVisible({ timeout: 8000 });
    await page.fill('#authEmail', email);
    await page.fill('#authPassword', password);
    await page.click('#btnSubmitAuth');
    // Aguardar appMain visível
    await expect(page.locator('#appMain')).toBeVisible({ timeout: 15000 });
  }

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
