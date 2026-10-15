const { test, expect } = require('@playwright/test');

// 62. Retorno da confirmação de e-mail: sem falso sucesso.
// `?email_confirmed=1` sozinho NÃO é prova de confirmação; erros do
// Supabase (`error`/`error_code`) e ausência de sessão não geram toast de
// sucesso. Somente mocks/stubs: nenhum usuário real, nenhum e-mail real.

async function gotoConfirmReturn(page, query) {
  await page.goto('/');
  await page.evaluate(() => {
    try { localStorage.clear(); } catch (e) {}
    try { sessionStorage.clear(); } catch (e) {}
  });
  await page.goto('/' + query);
  await page.waitForFunction(
    () => window.linsoraStore && window.supabaseRepo && window.setAuthMode,
    { timeout: 10000 }
  );
  await expect(page.locator('#authScreen')).toBeVisible({ timeout: 8000 });
}

async function gotoLogin(page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('LINSORA_SEEN_ONBOARDING', 'true'); } catch (e) {}
  });
  await page.goto('/');
  await page.waitForFunction(
    () => window.linsoraStore && window.supabaseRepo,
    { timeout: 10000 }
  );
  await page.evaluate(() => localStorage.setItem('LINSORA_SEEN_ONBOARDING', 'true'));
  await page.reload();
  await page.waitForFunction(
    () => window.linsoraStore && window.supabaseRepo,
    { timeout: 10000 }
  );
  await expect(page.locator('#authScreen')).toBeVisible({ timeout: 8000 });
}

// Instala (via init script, antes do boot) um cliente Supabase fictício com
// troca PKCE e sessão controladas. A sessão só existe após o exchange,
// para não entrar pelo caminho de sessão restaurada.
async function mockConfirmFlow(page, { exchangeOk }) {
  await page.addInitScript((opts) => {
    try { localStorage.clear(); } catch (e) {}
    try { sessionStorage.clear(); } catch (e) {}
    window.__session62__ = {
      user: {
        id: 'uid-62-ok',
        email: 'ok@exemplo.com',
        user_metadata: { full_name: 'Usuario Ok' },
      },
    };
    window.__exchanged62__ = false;
    window.__exchangeCalls62__ = 0;
    window.__exchangeOk62__ = opts.exchangeOk;
    const iv = setInterval(() => {
      try {
        const repo = window.supabaseRepo;
        if (repo && !repo.__mocked62__) {
          repo.__mocked62__ = true;
          repo.supabase = {
            auth: {
              exchangeCodeForSession: async () => {
                window.__exchangeCalls62__ += 1;
                if (!window.__exchangeOk62__) {
                  return { data: { session: null, user: null }, error: { message: 'ficticio-code-verifier-ausente' } };
                }
                window.__exchanged62__ = true;
                return { data: { session: window.__session62__, user: window.__session62__.user }, error: null };
              },
              getSession: async () => ({
                data: { session: window.__exchanged62__ ? window.__session62__ : null },
                error: null,
              }),
            },
          };
          repo.checkSubscriptionAccess = async () => ({ state: 'granted' });
        }
        if (window.linsoraStore && !window.linsoraStore.__mocked62__) {
          window.linsoraStore.__mocked62__ = true;
          window.linsoraStore.loadUserData = async (u) => {
            window.linsoraStore.state.user = { id: u.id, name: u.name, email: u.email };
          };
        }
        if (window.supabaseRepo && window.supabaseRepo.__mocked62__ && window.linsoraStore && window.linsoraStore.__mocked62__) {
          clearInterval(iv);
        }
      } catch (e) {}
    }, 30);
  }, { exchangeOk });
  await page.goto('/?email_confirmed=1&code=ficticio-62-abc123');
  await page.waitForFunction(
    () => window.linsoraStore && window.supabaseRepo && window.setAuthMode,
    { timeout: 10000 }
  );
}

test.describe('62. Retorno da confirmação sem falso sucesso', () => {
  test('1. link expirado (otp_expired): sem sucesso, com orientação em PT', async ({ page }) => {
    await gotoConfirmReturn(page, '?email_confirmed=1&error=access_denied&error_code=otp_expired&error_description=ficticio-expirado');
    const toast = page.locator('#toastContainer');
    await expect(toast).toContainText('expirou ou já foi usado', { timeout: 8000 });
    await expect(toast).toContainText('Solicite um novo e-mail');
    await expect(toast).not.toContainText('E-mail confirmado com sucesso');
    await expect(page.locator('#confirmationPending')).toBeVisible();
    await expect(page.locator('#appMain')).toBeHidden();
    await expect(page.locator('#authScreen')).toBeVisible();
  });

  test('2. sem código e sem sessão: mensagem neutra, sem afirmar confirmação', async ({ page }) => {
    await gotoConfirmReturn(page, '?email_confirmed=1');
    const toast = page.locator('#toastContainer');
    await expect(toast).toContainText('Se você já confirmou', { timeout: 8000 });
    await expect(toast).not.toContainText('E-mail confirmado com sucesso');
    await expect(page.locator('#appMain')).toBeHidden();
    await expect(page.locator('#authScreen')).toBeVisible();
  });

  test('3. código com troca PKCE válida e sessão: sucesso preservado', async ({ page }) => {
    await mockConfirmFlow(page, { exchangeOk: true });
    await expect(page.locator('#appMain')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#toastContainer')).toContainText('E-mail confirmado com sucesso! Bem-vindo ao Linsora.', { timeout: 8000 });
    expect(await page.evaluate(() => window.__exchangeCalls62__)).toBe(1);
    expect(page.url()).not.toContain('code=');
  });

  test('4. código com troca PKCE falhando: sem sucesso, acesso bloqueado', async ({ page }) => {
    await mockConfirmFlow(page, { exchangeOk: false });
    await expect(page.locator('#authScreen')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#appMain')).toBeHidden();
    const toast = page.locator('#toastContainer');
    await expect(toast).toContainText('Se você já confirmou', { timeout: 8000 });
    await expect(toast).not.toContainText('E-mail confirmado com sucesso');
    await expect(toast).not.toContainText('code-verifier');
    expect(await page.evaluate(() => window.__exchangeCalls62__)).toBe(1);
  });

  test('5. link inválido permite solicitar novo e-mail (reenvio existente)', async ({ page }) => {
    await gotoConfirmReturn(page, '?email_confirmed=1&error=access_denied&error_description=ficticio-invalido');
    await expect(page.locator('#confirmationPending')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#btnResendConfirmation')).toBeVisible();
    await page.evaluate(() => {
      window.supabaseRepo.supabase = {
        auth: {
          resend: async () => ({ data: {}, error: null }),
        },
      };
    });
    await page.fill('#authEmail', 'novo@exemplo.com');
    await page.click('#btnResendConfirmation');
    await expect(page.locator('#toastContainer')).toContainText('reenviado', { timeout: 5000 });
  });

  test('6. retorno de recovery continua independente (vai para reset-password)', async ({ page }) => {
    await page.goto('/?code=ficticio-recovery-62');
    await page.waitForURL('**/reset-password.html**', { timeout: 8000 });
    expect(page.url()).toContain('reset-password.html');
    expect(page.url()).toContain('code=ficticio-recovery-62');
  });

  test('7. login com email_not_confirmed mantém mensagem em PT', async ({ page }) => {
    await gotoLogin(page);
    await page.evaluate(() => {
      window.supabaseRepo.supabase = {
        auth: {
          signInWithPassword: async () => ({ data: null, error: { message: 'Email not confirmed' } }),
        },
      };
    });
    await page.fill('#authEmail', 'naoconfirmado@exemplo.com');
    await page.fill('#authPassword', 'senhaFicticia123');
    await page.click('#btnSubmitAuth');
    await expect(page.locator('#toastContainer')).toContainText('ainda não foi confirmado', { timeout: 5000 });
    await expect(page.locator('#confirmationPending')).toBeVisible();
    await expect(page.locator('#appMain')).toBeHidden();
  });

  test('8. reenvio com rate limit mantém PT e cooldown', async ({ page }) => {
    await gotoLogin(page);
    await page.evaluate(() => {
      window.supabaseRepo.supabase = {
        auth: {
          resend: async () => ({
            data: null,
            error: { message: 'For security purposes, you can only request this after 7 seconds.' },
          }),
        },
      };
    });
    await page.fill('#authEmail', 'limite62@exemplo.com');
    await page.evaluate(() => document.getElementById('btnResendConfirmation').click());
    const toast = page.locator('#toastContainer');
    await expect(toast).toContainText('Por segurança', { timeout: 5000 });
    await expect(toast).toContainText('7 segundos');
    await expect(toast).not.toContainText('For security purposes');
    await expect(page.locator('#btnResendConfirmation')).toBeDisabled();
  });
});
