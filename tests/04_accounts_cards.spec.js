const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.describe('04. Módulo de Cartões de Crédito', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Deve cadastrar um novo Cartão de Crédito e exibir no carrossel', async ({ page }) => {
    await page.click('.bottom-nav .nav-item[data-tab="tabCards"]');
    await expect(page.locator('#tabCards')).toBeVisible();

    await page.click('#btnAddCard');
    await expect(page.locator('#modalCardForm')).toBeVisible();

    await page.fill('#cardNameInput', 'Cartão XP Infinite');
    await page.selectOption('#cardBrandInput', 'Visa');
    await page.fill('#cardLimitInput', '1500000'); // 15.000,00
    await page.fill('#cardClosingInput', '10');
    await page.fill('#cardDueInput', '17');
    await page.click('#btnSaveCard');

    await expect(page.locator('#modalCardForm')).toHaveClass(/hidden/);
    await expect(page.locator('#cardsCarousel')).toContainText('Cartão XP Infinite');
    await expect(page.locator('#faturaCardName')).toHaveText('Cartão XP Infinite');
  });

  test('Deve simular o pagamento da fatura do cartão selecionado', async ({ page }) => {
    await page.click('.bottom-nav .nav-item[data-tab="tabCards"]');
    await expect(page.locator('#tabCards')).toBeVisible();

    await page.click('#btnAddCard');
    await page.fill('#cardNameInput', 'Nubank Platinum');
    await page.fill('#cardLimitInput', '800000');
    await page.fill('#cardClosingInput', '5');
    await page.fill('#cardDueInput', '12');
    await page.click('#btnSaveCard');

    await page.click('#btnPayInvoice');
    await expect(page.locator('#toastContainer')).toBeVisible();
  });
});

