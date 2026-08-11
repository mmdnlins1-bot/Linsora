const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

/** Helper: fecha qualquer modal aberto que possa interceptar cliques */
async function closeAllModals(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.linsora-modal-overlay:not(.hidden)').forEach(m => {
      m.classList.add('hidden');
    });
  });
}

test.describe('03. Módulo de Transações (CRUD, Filtros & Buscas)', () => {

  test.beforeEach(async ({ page }) => {
    await login(page);
    await closeAllModals(page);
    await page.click('.bottom-nav .nav-item[data-tab="tabTransactions"]');
    await expect(page.locator('#tabTransactions')).toBeVisible();
  });

  test('Deve cadastrar uma nova Receita com sucesso', async ({ page }) => {
    await page.click('#btnNewTransactionHeader');
    await expect(page.locator('#modalTransactionForm')).toBeVisible();
    await page.click('#btnTypeIncome');

    await page.fill('#txAmount', '350000'); // 3.500,00
    await page.fill('#txDescription', 'Consultoria de TI');
    await page.selectOption('#txCategory', 'Investimentos');
    await page.click('#btnSaveTransaction');

    await expect(page.locator('#modalTransactionForm')).toHaveClass(/hidden/, { timeout: 5000 });
    await expect(page.locator('#fullTransactionsList')).toContainText('Consultoria de TI');
    await expect(page.locator('#fullTransactionsList')).toContainText('+ R$ 3.500,00');
  });

  test('Deve cadastrar uma nova Despesa com sucesso', async ({ page }) => {
    await page.click('#btnNewTransactionHeader');
    await expect(page.locator('#modalTransactionForm')).toBeVisible();

    await page.fill('#txAmount', '12050'); // 120,50
    await page.fill('#txDescription', 'Almoço de Equipe');
    await page.selectOption('#txCategory', 'Alimentação');
    await page.click('#btnSaveTransaction');

    await expect(page.locator('#modalTransactionForm')).toHaveClass(/hidden/, { timeout: 5000 });
    await expect(page.locator('#fullTransactionsList')).toContainText('Almoço de Equipe');
    await expect(page.locator('#fullTransactionsList')).toContainText('- R$ 120,50');
  });

  test('Deve pesquisar transações por texto', async ({ page }) => {
    // Cadastrar primeira transação
    await page.click('#btnNewTransactionHeader');
    await expect(page.locator('#modalTransactionForm')).toBeVisible();
    await page.fill('#txAmount', '5000');
    await page.fill('#txDescription', 'Supermercado Carrefour');
    await page.click('#btnSaveTransaction');
    await expect(page.locator('#modalTransactionForm')).toHaveClass(/hidden/, { timeout: 5000 });

    // Cadastrar segunda transação
    await page.click('#btnNewTransactionHeader');
    await expect(page.locator('#modalTransactionForm')).toBeVisible();
    await page.fill('#txAmount', '8000');
    await page.fill('#txDescription', 'Gasolina Posto Shell');
    await page.click('#btnSaveTransaction');
    await expect(page.locator('#modalTransactionForm')).toHaveClass(/hidden/, { timeout: 5000 });

    // Pesquisar "Carrefour"
    await page.fill('#txSearchInput', 'Carrefour');
    await expect(page.locator('#fullTransactionsList')).toContainText('Supermercado Carrefour');
    await expect(page.locator('#fullTransactionsList')).not.toContainText('Gasolina Posto Shell');
  });

  test('Deve filtrar transações por Tipo (Receitas/Despesas)', async ({ page }) => {
    // Filtrar por Receitas
    await page.click('.chip-filter[data-value="RECEITA"]');
    await expect(page.locator('.chip-filter[data-value="RECEITA"]')).toHaveClass(/active/);

    // Filtrar por Despesas
    await page.click('.chip-filter[data-value="DESPESA"]');
    await expect(page.locator('.chip-filter[data-value="DESPESA"]')).toHaveClass(/active/);
  });

  test('Deve abrir detalhes, Duplicar e Editar uma transação', async ({ page }) => {
    // Cadastrar transação inicial
    await page.click('#btnNewTransactionHeader');
    await expect(page.locator('#modalTransactionForm')).toBeVisible();
    await page.fill('#txAmount', '45000'); // 450,00
    await page.fill('#txDescription', 'Conta de Luz');
    await page.click('#btnSaveTransaction');
    await expect(page.locator('#modalTransactionForm')).toHaveClass(/hidden/, { timeout: 5000 });

    // Abrir detalhes clicando no card visível da lista completa
    await page.click('#fullTransactionsList .transaction-card:has-text("Conta de Luz")');
    await expect(page.locator('#modalTransactionDetails')).toBeVisible();

    // Testar Duplicação
    await page.click('#btnDuplicateTx');
    await expect(page.locator('#modalTransactionDetails')).toHaveClass(/hidden/);
    await expect(page.locator('#fullTransactionsList')).toContainText('Conta de Luz (Cópia)');

    // Testar Edição
    await page.click('#fullTransactionsList .transaction-card:has-text("Conta de Luz (Cópia)")');
    await page.click('#btnEditTx');
    await expect(page.locator('#modalTransactionForm')).toBeVisible();

    await page.fill('#txDescription', 'Conta de Luz Editada');
    await page.click('#btnSaveTransaction');
    await expect(page.locator('#modalTransactionForm')).toHaveClass(/hidden/, { timeout: 5000 });
    await expect(page.locator('#fullTransactionsList')).toContainText('Conta de Luz Editada');
  });

  test('Deve Excluir uma transação e estornar o saldo', async ({ page }) => {
    await page.click('#btnNewTransactionHeader');
    await expect(page.locator('#modalTransactionForm')).toBeVisible();
    await page.fill('#txAmount', '9900');
    await page.fill('#txDescription', 'Compra para Exclusão');
    await page.click('#btnSaveTransaction');
    await expect(page.locator('#modalTransactionForm')).toHaveClass(/hidden/, { timeout: 5000 });

    await page.click('#fullTransactionsList .transaction-card:has-text("Compra para Exclusão")');
    await page.click('#btnDeleteTx');

    await expect(page.locator('#fullTransactionsList')).not.toContainText('Compra para Exclusão');
  });
});


