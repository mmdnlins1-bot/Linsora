const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.describe('Avatar Upload & Compression', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Deve comprimir e atualizar o avatar no painel principal', async ({ page }) => {
    // Vamos para a aba Perfil
    await page.click('[data-tab="tabProfile"]');
    await expect(page.locator('#tabProfile')).toHaveClass(/active/);

    // Preparar arquivo de teste (mock image buffer)
    const buffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );

    // Mocar o input type="file" que está invisível, mas aceita arquivos
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.click('#btnChangeAvatar');
    const fileChooser = await fileChooserPromise;
    
    // Passar a imagem para o input
    await fileChooser.setFiles({
      name: 'avatar_test.png',
      mimeType: 'image/png',
      buffer: buffer
    });

    // Esperar a compressão e a UI ser atualizada
    // O Utils usa timeout e Canvas, pode levar 1s
    await page.waitForTimeout(1000);
    
    // O Toast de sucesso deve aparecer
    const toast = page.locator('.toast.success');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('Foto de perfil atualizada com sucesso');

    // A imagem do perfil deve ter mudado para um DataURL do Canvas
    const avatarImg = await page.getAttribute('#profileAvatarImg', 'src');
    expect(avatarImg).toContain('data:image/jpeg;base64');
    
    // Checar se refletiu no header
    const headerImg = await page.getAttribute('#userAvatar', 'src');
    expect(headerImg).toContain('data:image/jpeg;base64');
  });

});
