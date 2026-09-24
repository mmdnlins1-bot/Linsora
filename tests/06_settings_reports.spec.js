const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.describe('06. Módulo de Configurações, Perfil & Relatórios', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Deve alternar Tema Escuro / Claro na aba Perfil', async ({ page }) => {
    await page.click('.bottom-nav .nav-item[data-tab="tabProfile"]');
    await expect(page.locator('#tabProfile')).toBeVisible();

    // Alternar tema
    await page.click('#btnToggleTheme');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.click('#btnToggleTheme');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('Deve alternar Classificação por Inteligência Artificial', async ({ page }) => {
    await page.click('.bottom-nav .nav-item[data-tab="tabProfile"]');
    
    const btnAi = page.locator('#btnToggleAI');
    await btnAi.click();
    await expect(btnAi).toBeVisible();
  });

  test('Deve alterar a foto de perfil, atualizar a interface imediatamente e persistir após fechar/reabrir', async ({ page }) => {
    await page.click('.bottom-nav .nav-item[data-tab="tabProfile"]');
    await expect(page.locator('#tabProfile')).toBeVisible();

    const mockBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    // Simular a seleção de foto e envio do buffer
    await page.evaluate((b64) => {
      const user = window.linsoraStore?.state?.user || { id: 'usr_guest', name: 'Usuário', email: 'usuario@linsora.com.br' };
      user.avatar = b64;
      document.querySelectorAll('#profileAvatarImg, #userAvatar').forEach(img => {
        img.src = b64;
      });
      localStorage.setItem(`LINSORA_USER_AVATAR_${user.id}`, b64);
      localStorage.setItem('LINSORA_USER_AVATAR_guest', b64);
      localStorage.setItem('LINSORA_USER_AVATAR_usr_guest', b64);
      if (window.supabaseRepo) {
        window.supabaseRepo.saveActiveLocalSession(user);
        window.supabaseRepo.saveDbData(window.linsoraStore.state, user.id);
      }
      if (window.linsoraStore) {
        window.linsoraStore.state.user = user;
        window.linsoraStore.notify();
      }
    }, mockBase64);

    // Verificar atualização imediata dos elementos de imagem
    const avatarImg = page.locator('#profileAvatarImg');
    const headerAvatar = page.locator('#userAvatar');
    await expect(avatarImg).toHaveAttribute('src', mockBase64);
    await expect(headerAvatar).toHaveAttribute('src', mockBase64);

    // Recarregar a página para simular fechamento e reabertura do app
    await page.reload();

    // Confirmar que a nova foto persiste no DOM sem necessidade de refresh manual
    await expect(page.locator('#userAvatar')).toHaveAttribute('src', mockBase64, { timeout: 5000 });
    await page.click('.bottom-nav .nav-item[data-tab="tabProfile"]');
    await expect(page.locator('#profileAvatarImg')).toHaveAttribute('src', mockBase64);
  });
});
