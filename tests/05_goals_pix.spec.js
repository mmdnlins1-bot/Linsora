const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.describe('05. Módulo de Planejamento & Metas Financeiras', () => {

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

    await expect(page.locator('#modalGoalForm')).toHaveClass(/hidden/, { timeout: 5000 });
    await expect(page.locator('#goalsGridList')).toContainText('Viagem para o Japão');
    await expect(page.locator('#goalsGridList')).toContainText('25%'); // 5.000 / 20.000
  });

  test('Deve realizar um aporte adicional em uma Meta existente', async ({ page }) => {
    await page.click('.bottom-nav .nav-item[data-tab="tabGoals"]');
    await expect(page.locator('#tabGoals')).toBeVisible();

    // Cadastrar meta inicial
    await page.click('#btnAddGoal');
    await page.fill('#goalTitleInput', 'Disney World');
    await page.fill('#goalTargetInput', '2000000'); // 20.000,00
    await page.fill('#goalCurrentInput', '30000'); // 300,00
    await page.fill('#goalDeadlineInput', '2027-06-30');
    await page.click('#btnSaveGoal');

    await expect(page.locator('#modalGoalForm')).toHaveClass(/hidden/, { timeout: 5000 });
    await expect(page.locator('#goalsGridList')).toContainText('Disney World');

    // Clicar em + Adicionar valor
    await page.click('.btn-deposit-goal[data-deposit-title="Disney World"]');
    await expect(page.locator('#modalDepositGoal')).toBeVisible();

    // Preencher aporte de 3.000,00 (300000) e confirmar
    await page.fill('#depositAmountInput', '300000');
    await page.click('#btnSaveGoalDeposit');

    await expect(page.locator('#modalDepositGoal')).toHaveClass(/hidden/, { timeout: 5000 });
    await expect(page.locator('#goalsGridList')).toContainText('Guardado: R$ 3.300,00');
  });
});

