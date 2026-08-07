const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.describe('05. Módulo de Planejamento, Metas & Área Pix', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Deve cadastrar uma nova Meta Financeira na aba Planejamento', async ({ page }) => {
    await page.click('.bottom-nav .nav-item[data-tab="tabGoals"]');
    await expect(page.locator('#tabGoals')).toBeVisible();

    await page.click('#btnAddGoal');
    await expect(page.locator('#modalGoalForm')).toBeVisible();

    await page.fill('#goalTitleInput', 'Viagem para o Japão');
    await page.fill('#goalTargetInput', '2000000'); // 20.000,00
    await page.fill('#goalCurrentInput', '500000'); // 5.000,00
    await page.fill('#goalDeadlineInput', '2026-12-31');
    await page.click('#btnSaveGoal');

    await expect(page.locator('#modalGoalForm')).toHaveClass(/hidden/);
    await expect(page.locator('#goalsGridList')).toContainText('Viagem para o Japão');
    await expect(page.locator('#goalsGridList')).toContainText('25%'); // 5.000 / 20.000
  });

  test('Deve cadastrar uma Chave Pix e realizar uma transferência Pix', async ({ page }) => {
    await page.click('.bottom-nav .nav-item[data-tab="tabAccounts"]');
    
    // Cadastrar chave Pix
    await page.click('#btnAddPixKey');
    await expect(page.locator('#modalPixKeyForm')).toBeVisible();

    await page.selectOption('#pixTypeSelect', 'EMAIL');
    await page.fill('#pixKeyValue', 'pix@linsora.com.br');
    await page.click('#btnSavePixKey');

    await expect(page.locator('#modalPixKeyForm')).toHaveClass(/hidden/);
    await expect(page.locator('#pixKeysList')).toContainText('pix@linsora.com.br');

    // Executar transferência Pix
    await page.click('.bottom-nav .nav-item[data-tab="tabDashboard"]');
    await page.click('#btnQuickPix');
    await expect(page.locator('#modalPixArea')).toBeVisible();

    await page.fill('#pixKeyInput', 'pix@linsora.com.br');
    await page.fill('#pixAmountInput', '25000'); // 250,00
    await page.click('#btnConfirmPixTransfer');
    await page.click('#btnFinalConfirmPix');

    await expect(page.locator('#modalPixArea')).toHaveClass(/hidden/);
    await expect(page.locator('#toastContainer')).toContainText('Pix de R$ 250,00 enviado!');
  });
});
