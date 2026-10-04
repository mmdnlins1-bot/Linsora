const { test, expect } = require('@playwright/test');

// 46. Funil de primeiro acesso: visitante novo -> landing -> login.
// Somente roteamento de entrada; gate trial/assinatura intocado.

async function waitBoot(page) {
  await page.waitForFunction(
    () => window.linsoraStore && window.LinsoraAccess && window.supabaseRepo,
    { timeout: 10000 }
  );
}

test.describe('46. Primeiro acesso via Landing Page', () => {
  test('1. storage limpo + sem sessão: / leva à landing', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/landing\.html/, { timeout: 15000 });
    await expect(page.locator('#hero')).toBeVisible();
  });

  test('2. CTA da landing: /?vamos-comecar=1 abre o login sem loop', async ({ page }) => {
    await page.goto('/?vamos-comecar=1');
    await waitBoot(page);
    await expect(page.locator('#authScreen')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#appMain')).toBeHidden();
    // Sem voltar para a landing ao recarregar (flag gravada, sem loop).
    await page.reload();
    await waitBoot(page);
    await expect(page).toHaveURL(/\/$/, { timeout: 10000 });
    await expect(page.locator('#authScreen')).toBeVisible({ timeout: 10000 });
  });

  test('3. parâmetro do funil é removido da URL', async ({ page }) => {
    await page.goto('/?vamos-comecar=1');
    await waitBoot(page);
    await expect(page.locator('#authScreen')).toBeVisible({ timeout: 10000 });
    expect(page.url()).not.toContain('vamos-comecar');
    expect(await page.evaluate(() => localStorage.getItem('LINSORA_SEEN_ONBOARDING'))).toBe('true');
  });

  test('4. usuário conhecido deslogado: / abre o login direto', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('LINSORA_SEEN_ONBOARDING', 'true'));
    await page.goto('/');
    await waitBoot(page);
    await expect(page).toHaveURL(/\/$/, { timeout: 10000 });
    await expect(page.locator('#authScreen')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#appMain')).toBeHidden();
  });

  test('5. sessão válida: / entra no app sem landing', async ({ page }) => {
    const uid = 'f46f46f4-1111-4222-8333-444444444444';
    await page.addInitScript((id) => {
      localStorage.setItem('LINSORA_SEEN_ONBOARDING', 'true');
      localStorage.setItem('LINSORA_ACTIVE_LOCAL_SESSION', JSON.stringify({ id, name: 'Sessao', email: 'sessao@linsora.com.br' }));
      localStorage.setItem(`LINSORA_DB_CACHE_${id}`, JSON.stringify({
        user: { id, name: 'Sessao', email: 'sessao@linsora.com.br' },
        accounts: [], transactions: [], goals: [], cards: [],
        pixKeys: [], fixedBills: [], recurringBills: [], occurrences: [],
      }));
    }, uid);
    await page.addInitScript(() => {
      const wrap = () => {
        const repo = window.supabaseRepo;
        if (repo && !repo.__testWrapped46) {
          repo.__testWrapped46 = true;
          repo.checkSubscriptionAccess = async () => ({ state: 'granted' });
          repo.claimSubscription = async () => ({ success: true, claimed: false });
        }
      };
      if (window.supabaseRepo) wrap();
      const iv = setInterval(() => {
        wrap();
        if (window.supabaseRepo && window.supabaseRepo.__testWrapped46) clearInterval(iv);
      }, 20);
    });
    await page.goto('/');
    await waitBoot(page);
    await expect(page.locator('#appMain')).toBeVisible({ timeout: 15000 });
    expect(page.url()).not.toContain('landing');
  });

  test('6. recovery mantém prioridade sobre o funil', async ({ page }) => {
    await page.goto('/?code=fake-code-123');
    await expect(page).toHaveURL(/reset-password\.html/, { timeout: 10000 });
    await page.goto('/#access_token=fake&type=recovery');
    await expect(page).toHaveURL(/reset-password\.html/, { timeout: 10000 });
  });

  test('7. CTAs da landing apontam para o funil', async ({ page }) => {
    await page.goto('/landing.html');
    await expect(page.locator('#hero')).toBeVisible();
    for (const sel of ['header a.lp-btn', '#hero a.lp-btn-primary', '#comecar .lp-btn']) {
      await expect(page.locator(sel).first()).toHaveAttribute('href', '/?vamos-comecar=1');
    }
  });
});
