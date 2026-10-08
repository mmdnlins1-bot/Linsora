const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

// 59. Extrato: clicar numa categoria filtra E rola até o resultado.

test.describe('59. Scroll ao filtrar categoria no Extrato', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();
    await login(page);
    await page.evaluate(() => {
      document.querySelectorAll('.linsora-modal-overlay:not(.hidden)').forEach(m => {
        m.classList.add('hidden');
      });
    });
    await page.click('.bottom-nav .nav-item[data-tab="tabTransactions"]');
    await expect(page.locator('#tabTransactions')).toBeVisible();
  });

  async function seedThreeCategories(page) {
    // Seed direto no store (o modal de lançamento está com o dropdown de
    // categorias vazio neste ambiente — falha pré-existente, fora do escopo).
    await page.evaluate(() => {
      const uid = window.linsoraStore.state.user.id;
      const base = { userId: uid, type: 'DESPESA', status: 'CONCLUIDO', account: 'Banco', date: '2026-10-05' };
      window.linsoraStore.state.transactions.push(
        { ...base, id: 'tx-scroll-1', description: 'Mercado Scroll', amount: 100, category: 'Alimentação' },
        { ...base, id: 'tx-scroll-2', description: 'Uber Scroll', amount: 50, category: 'Transporte' },
        { ...base, id: 'tx-scroll-3', description: 'Pix para João', amount: 70, category: 'Transferência' }
      );
      window.linsoraStore.persistState();
    });
    await page.reload();
    await page.click('.bottom-nav .nav-item[data-tab="tabTransactions"]');
    await expect(page.locator('#tabTransactions')).toBeVisible();
    await expect(page.locator('#fullTransactionsList')).toContainText('Uber Scroll');
  }

  async function movementsTop(page) {
    return page.evaluate(() => {
      const el = document.getElementById('extratoMovementsSection');
      if (!el) return null;
      return el.getBoundingClientRect().top;
    });
  }

  async function expectScrolledToResult(page) {
    // Após o scroll suave, o topo da seção deve estar visível próximo ao header.
    await page.waitForFunction(() => {
      const el = document.getElementById('extratoMovementsSection');
      if (!el) return false;
      return el.getBoundingClientRect().top < window.innerHeight * 0.5;
    }, { timeout: 5000 });
    const top = await movementsTop(page);
    expect(top).toBeLessThan(await page.evaluate(() => window.innerHeight * 0.5));
  }

  test('1. clique em Transferência: filtra, renderiza e rola até o resultado', async ({ page }) => {
    await seedThreeCategories(page);
    await page.click('.category-variation-item:has-text("Transferência")');
    await expect(page.locator('#activeCategoryName')).toHaveText('Transferência');
    await expect(page.locator('#extratoMovementsTitle')).toHaveText('Movimentações de Transferência');
    await expect(page.locator('#fullTransactionsList')).toContainText('Pix para João');
    await expect(page.locator('#fullTransactionsList')).not.toContainText('Uber Scroll');
    await expectScrolledToResult(page);
  });

  test('2. clique em Transporte: mesmo comportamento', async ({ page }) => {
    await seedThreeCategories(page);
    await page.click('.category-variation-item:has-text("Transporte")');
    await expect(page.locator('#activeCategoryName')).toHaveText('Transporte');
    await expect(page.locator('#fullTransactionsList')).toContainText('Uber Scroll');
    await expect(page.locator('#fullTransactionsList')).not.toContainText('Pix para João');
    await expectScrolledToResult(page);
  });

  test('3. troca direta Alimentação → Transporte substitui e continua rolando', async ({ page }) => {
    await seedThreeCategories(page);
    await page.click('.category-variation-item:has-text("Alimentação")');
    await expect(page.locator('#activeCategoryName')).toHaveText('Alimentação');
    await page.click('.category-variation-item:has-text("Transporte")');
    await expect(page.locator('#activeCategoryName')).toHaveText('Transporte');
    await expect(page.locator('#fullTransactionsList')).toContainText('Uber Scroll');
    await expect(page.locator('#fullTransactionsList')).not.toContainText('Mercado Scroll');
    await expectScrolledToResult(page);
  });

  test('4. comportamento atual do Extrato preservado (limpar filtro)', async ({ page }) => {
    await seedThreeCategories(page);
    await page.click('.category-variation-item:has-text("Transporte")');
    await expect(page.locator('#activeCategoryName')).toHaveText('Transporte');
    await page.click('#btnActiveCategory');
    await expect(page.locator('#categoryActiveRow')).toHaveClass(/hidden/);
    await expect(page.locator('#extratoAnalysisTitle')).toHaveText('Análise Financeira');
    await expect(page.locator('#fullTransactionsList')).toContainText('Uber Scroll');
    await expect(page.locator('#fullTransactionsList')).toContainText('Mercado Scroll');
  });
});
