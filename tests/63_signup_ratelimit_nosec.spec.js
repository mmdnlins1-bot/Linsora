const { test, expect } = require('@playwright/test');

// 63. Saída para rate limit no cadastro sem segundos identificáveis.
// Sem caixa/resenvio (estado da conta não confirmado): só orientação PT.
// Somente mocks/stubs: nenhum usuário real, nenhum e-mail real.

async function gotoFunnel(page) {
  await page.goto('/');
  await page.evaluate(() => {
    try { localStorage.clear(); } catch (e) {}
    try { sessionStorage.clear(); } catch (e) {}
  });
  await page.goto('/?vamos-comecar=1');
  await page.waitForFunction(
    () => window.linsoraStore && window.supabaseRepo && window.setAuthMode,
    { timeout: 10000 }
  );
  await expect(page.locator('#authScreen')).toBeVisible({ timeout: 8000 });
}

async function fillSignup(page, name, email) {
  await page.fill('#authName', name);
  await page.fill('#authEmail', email);
  await page.fill('#authPassword', 'senhaFicticia123');
  await page.fill('#authConfirmPassword', 'senhaFicticia123');
}

// Conta chamadas de rede Auth via cliente fictício instalado antes do boot.
async function mockCountingAuth(page, signUpImpl) {
  await page.addInitScript((implSrc) => {
    // Limpa tudo, mas marca onboarding visto para que o reload (já sem o
    // parâmetro do funil) abra o login em vez da landing.
    try { localStorage.clear(); } catch (e) {}
    try { sessionStorage.clear(); } catch (e) {}
    try { localStorage.setItem('LINSORA_SEEN_ONBOARDING', 'true'); } catch (e) {}
    window.__calls63__ = { signUp: 0, resend: 0 };
    // eslint-disable-next-line no-eval
    window.__signUpImpl63__ = eval('(' + implSrc + ')');
    const iv = setInterval(() => {
      try {
        const repo = window.supabaseRepo;
        if (repo && !repo.__mocked63__) {
          repo.__mocked63__ = true;
          repo.supabase = {
            auth: {
              signUp: async (...args) => {
                window.__calls63__.signUp += 1;
                return window.__signUpImpl63__(...args);
              },
              resend: async () => {
                window.__calls63__.resend += 1;
                return { data: {}, error: null };
              },
              getSession: async () => ({ data: { session: null }, error: null }),
            },
          };
          clearInterval(iv);
        }
      } catch (e) {}
    }, 30);
  }, signUpImpl);
}

test.describe('63. Rate limit no cadastro sem segundos: saída segura', () => {
  test('1. rate limit sem segundos: orientação PT, sem afirmar sucesso, sem caixa/resenvio', async ({ page }) => {
    await gotoFunnel(page);
    await page.evaluate(() => {
      window.supabaseRepo.supabase = {
        auth: {
          // Limite sem countdown parseável (genérico do servidor).
          signUp: async () => ({ data: null, error: { message: 'email rate limit exceeded', status: 429 } }),
        },
      };
      try { localStorage.removeItem('LINSORA_ACTIVE_LOCAL_SESSION'); } catch (e) {}
    });
    await fillSignup(page, 'Usuario Limite', 'limite63@exemplo.com');
    await page.click('#btnSubmitAuth');
    const toast = page.locator('#toastContainer');
    await expect(toast).toContainText('temporariamente limitado', { timeout: 5000 });
    await expect(toast).toContainText('tente criar sua conta novamente');
    await expect(toast).not.toContainText('Conta criada');
    await expect(toast).not.toContainText('e-mail de confirmação');
    await expect(toast).not.toContainText('reenviado');
    await expect(page.locator('#confirmationPending')).toBeHidden();
    await expect(page.locator('#btnResendConfirmation')).toBeHidden();
    await expect(page.locator('#appMain')).toBeHidden();
    await expect(page.locator('#authScreen')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('LINSORA_ACTIVE_LOCAL_SESSION'))).toBeNull();
  });

  test('2. rate limit com segundos: countdown e cooldown preservados', async ({ page }) => {
    await gotoFunnel(page);
    await page.evaluate(() => {
      window.supabaseRepo.supabase = {
        auth: {
          signUp: async () => ({
            data: null,
            error: { message: 'For security purposes, you can only request this after 44 seconds.' },
          }),
        },
      };
      try { localStorage.removeItem('LINSORA_ACTIVE_LOCAL_SESSION'); } catch (e) {}
    });
    await fillSignup(page, 'Usuario Prazo', 'prazo63@exemplo.com');
    await page.click('#btnSubmitAuth');
    const toast = page.locator('#toastContainer');
    await expect(toast).toContainText('Por segurança', { timeout: 5000 });
    await expect(toast).toContainText('44 segundos');
    await expect(toast).not.toContainText('For security purposes');
    const remaining = await page.evaluate(() => window.__getResendCooldownRemaining__());
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(44);
    await expect(page.locator('#confirmationPending')).toBeHidden();
    await expect(page.locator('#appMain')).toBeHidden();
  });

  test('3. erro comum de cadastro: comportamento existente preservado', async ({ page }) => {
    await gotoFunnel(page);
    await page.evaluate(() => {
      window.supabaseRepo.supabase = {
        auth: {
          signUp: async () => ({ data: null, error: { message: 'User already registered' } }),
        },
      };
    });
    await fillSignup(page, 'Usuario Existe', 'existe63@exemplo.com');
    await page.click('#btnSubmitAuth');
    await expect(page.locator('#toastContainer')).toContainText('já está cadastrado', { timeout: 5000 });
    await expect(page.locator('#toastContainer')).not.toContainText('temporariamente limitado');
    await expect(page.locator('#confirmationPending')).toBeHidden();
    await expect(page.locator('#appMain')).toBeHidden();
  });

  test('4. nenhuma chamada automática ao carregar ou recarregar a página', async ({ page }) => {
    await mockCountingAuth(
      page,
      '() => ({ data: null, error: { message: "email rate limit exceeded", status: 429 } })'
    );
    await page.goto('/?vamos-comecar=1');
    await page.waitForFunction(
      () => window.linsoraStore && window.supabaseRepo && window.setAuthMode,
      { timeout: 10000 }
    );
    await expect(page.locator('#authScreen')).toBeVisible({ timeout: 8000 });
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__calls63__)).toEqual({ signUp: 0, resend: 0 });
    await expect(page.locator('#toastContainer')).not.toContainText('temporariamente limitado');
    await page.reload();
    await page.waitForFunction(
      () => window.linsoraStore && window.supabaseRepo && window.setAuthMode,
      { timeout: 10000 }
    );
    await expect(page.locator('#authScreen')).toBeVisible({ timeout: 8000 });
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__calls63__)).toEqual({ signUp: 0, resend: 0 });
    await expect(page.locator('#toastContainer')).not.toContainText('temporariamente limitado');
    await expect(page.locator('#confirmationPending')).toBeHidden();
  });
});
