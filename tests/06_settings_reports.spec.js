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

  test('Deve abrir o teclado PIN de Segurança', async ({ page }) => {
    await page.click('.bottom-nav .nav-item[data-tab="tabProfile"]');
    
    await page.click('#btnTogglePIN');
    await expect(page.locator('#modalPinPad')).toBeVisible();
    await expect(page.locator('#pinPadTitle')).toContainText('PIN');

    // Digitar PIN 1-2-3-4
    await page.click('.pin-key[data-num="1"]');
    await page.click('.pin-key[data-num="2"]');
    await page.click('.pin-key[data-num="3"]');
    await page.click('.pin-key[data-num="4"]');

    await expect(page.locator('#modalPinPad')).toHaveClass(/hidden/, { timeout: 5000 });
  });

  test('Deve disparar a geração de Relatório PDF na aba Relatórios', async ({ page }) => {
    await page.click('.bottom-nav .nav-item[data-tab="tabProfile"]');
    await expect(page.locator('#tabProfile')).toBeVisible();

    await page.click('#btnExportPDF');
    const pdfTemplate = page.locator('#pdfPrintTemplate');
    await expect(pdfTemplate).toContainText('LINSORA');
  });
});
