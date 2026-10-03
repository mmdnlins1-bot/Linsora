const { test, expect } = require('@playwright/test');

// 42. Recuperação de senha ("Esqueci minha senha") de ponta a ponta.
// Login -> modal -> e-mail -> link -> reset-password.html -> nova senha -> login.
// Usa mocks/stubs: nenhum usuário real, nenhum e-mail real, nenhum segredo real.
// O SDK Supabase real é usado na página de redefinição, com o REST Auth
// simulado via page.route (sessão de recuperação via hash implícito).

const FAKE_SUPABASE_URL = 'https://supabase-ficticio-recuperacao.supabase.co';
const FAKE_ANON_KEY = 'anon-key-ficticia-para-testes-000';
const RECOVERY_HASH =
  '#access_token=fake-access-token-abc123' +
  '&expires_in=3600' +
  '&refresh_token=fake-refresh-token-xyz789' +
  '&token_type=bearer' +
  '&type=recovery';
const NEW_PASSWORD = 'S3nh4-F1ct1c1a-Xy9Z';

async function gotoAuth(page) {
  await page.goto('/');
  await page.waitForFunction(
    () => window.linsoraStore && window.LinsoraAccess && window.supabaseRepo,
    { timeout: 10000 }
  );
  await page.evaluate(() => localStorage.setItem('LINSORA_SEEN_ONBOARDING', 'true'));
  await page.reload();
  await page.waitForFunction(
    () => window.linsoraStore && window.LinsoraAccess && window.supabaseRepo,
    { timeout: 10000 }
  );
  await expect(page.locator('#authScreen')).toBeVisible({ timeout: 8000 });
}

async function openRecoveryModal(page) {
  await page.click('#btnForgotPassword');
  await expect(page.locator('#modalForgotPassword')).toBeVisible();
}

async function useFakeSupabaseConfig(page) {
  await page.addInitScript(({ url, key }) => {
    window.__LINSORA_SUPABASE__ = { url, anonKey: key };
    try {
      localStorage.setItem('LINSORA_SEEN_ONBOARDING', 'true');
    } catch (e) { /* ignora */ }
  }, { url: FAKE_SUPABASE_URL, key: FAKE_ANON_KEY });
}

async function mockAuthRest(page, counters) {
  await page.route(FAKE_SUPABASE_URL + '/auth/v1/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (req.method() === 'PUT' && url.endsWith('/auth/v1/user')) {
      counters.updateUser += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'usr-ficticio-rec-1', email: 'rec.ficticia@exemplo.com' }),
      });
    } else if (url.includes('/auth/v1/logout')) {
      counters.logout += 1;
      await route.fulfill({ status: 204, body: '' });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
  });
}

async function gotoResetPage(page, hash) {
  await page.goto('/reset-password.html' + (hash || ''));
  await page.waitForFunction(() => window.supabase, { timeout: 10000 });
}

async function waitRecoveryReady(page) {
  await page.waitForFunction(
    () => {
      const form = document.getElementById('resetPasswordForm');
      const btn = document.getElementById('btnSaveNewPassword');
      return form && !form.classList.contains('hidden') && btn && !btn.disabled;
    },
    { timeout: 10000 }
  );
}

async function fillNewPasswords(page, password, confirm) {
  await page.fill('#newPassword', password);
  await page.fill('#confirmPassword', confirm === undefined ? password : confirm);
}

test.describe('42. Recuperação de senha', () => {
  test('1. "Esqueci minha senha?" abre o modal de recuperação', async ({ page }) => {
    await gotoAuth(page);
    await openRecoveryModal(page);
    await expect(page.locator('#recoveryEmail')).toBeVisible();
    await expect(page.locator('#btnSendRecoveryEmail')).toBeVisible();
    await expect(page.locator('#modalForgotPassword')).toContainText('Recuperar Senha');
    // Retorno ao login: fechar o modal revela a tela de login novamente.
    await page.click('#modalForgotPassword [data-close-modal="modalForgotPassword"]');
    await expect(page.locator('#modalForgotPassword')).toBeHidden();
    await expect(page.locator('#authScreen')).toBeVisible();
  });

  test('2. e-mail vazio não envia nada', async ({ page }) => {
    await gotoAuth(page);
    await openRecoveryModal(page);
    await page.evaluate(() => {
      window.__resetCalls__ = 0;
      const repo = window.supabaseRepo;
      const orig = repo.resetPassword.bind(repo);
      repo.resetPassword = async (email) => {
        window.__resetCalls__ += 1;
        return orig(email);
      };
      document.getElementById('recoveryEmail').removeAttribute('required');
      document.getElementById('recoveryEmail').value = '';
    });
    await page.click('#btnSendRecoveryEmail');
    expect(await page.evaluate(() => window.__resetCalls__)).toBe(0);
    await expect(page.locator('#modalForgotPassword')).toBeVisible();
  });

  test('3. e-mail válido chama resetPassword com redirectTo e mostra toast', async ({ page }) => {
    await gotoAuth(page);
    await openRecoveryModal(page);
    await page.evaluate(() => {
      window.__capturedRecovery__ = null;
      window.supabaseRepo.supabase = {
        auth: {
          resetPasswordForEmail: async (email, options) => {
            window.__capturedRecovery__ = {
              email,
              redirectTo: options && options.redirectTo,
            };
            return { error: null };
          },
        },
      };
    });
    await page.fill('#recoveryEmail', 'Rec.Ficticia@Exemplo.com');
    await page.click('#btnSendRecoveryEmail');
    const captured = await page.evaluate(() => window.__capturedRecovery__);
    expect(captured.email).toBe('rec.ficticia@exemplo.com');
    expect(captured.redirectTo).toBe('http://localhost:3000/reset-password.html');
    await expect(page.locator('#modalForgotPassword')).toBeHidden();
    await expect(page.locator('#toastContainer')).toContainText('Link de redefinição enviado');
  });

  test('4. reset-password sem link válido bloqueia (fail-closed)', async ({ page }) => {
    await useFakeSupabaseConfig(page);
    // Sem nenhum parâmetro de recuperação.
    await gotoResetPage(page, '');
    await expect(page.locator('#recoveryStatus')).toContainText('inválido', { timeout: 10000 });
    await expect(page.locator('#resetPasswordForm')).toBeHidden();
    // Link com erro explícito também bloqueia (query distinta força recarregamento).
    await page.goto('/reset-password.html?caso=erro#error=access_denied&error_description=link-expirado-ficticio');
    await expect(page.locator('#recoveryStatus')).toContainText('expirou ou é inválido', { timeout: 10000 });
    await expect(page.locator('#resetPasswordForm')).toBeHidden();
    await expect(page.locator('#linkBackLogin')).toBeVisible();
  });

  test('5. sessão de recuperação válida libera o formulário', async ({ page }) => {
    const counters = { updateUser: 0, logout: 0 };
    await useFakeSupabaseConfig(page);
    await mockAuthRest(page, counters);
    await gotoResetPage(page, RECOVERY_HASH);
    await waitRecoveryReady(page);
    await expect(page.locator('#recoveryStatus')).toContainText('Defina sua nova senha');
    expect(await page.evaluate(() => window.location.hash)).toBe('');
    expect(counters.updateUser).toBe(0);
  });

  test('6. senhas diferentes impedem o envio', async ({ page }) => {
    const counters = { updateUser: 0, logout: 0 };
    await useFakeSupabaseConfig(page);
    await mockAuthRest(page, counters);
    await gotoResetPage(page, RECOVERY_HASH);
    await waitRecoveryReady(page);
    await fillNewPasswords(page, NEW_PASSWORD, 'outra-senha-ficticia-1');
    await page.click('#btnSaveNewPassword');
    await expect(page.locator('#recoveryStatus')).toContainText('não coincidem');
    expect(counters.updateUser).toBe(0);
  });

  test('7. senha com menos de 6 caracteres impede o envio', async ({ page }) => {
    const counters = { updateUser: 0, logout: 0 };
    await useFakeSupabaseConfig(page);
    await mockAuthRest(page, counters);
    await gotoResetPage(page, RECOVERY_HASH);
    await waitRecoveryReady(page);
    // Remove as travas nativas (minlength/required) para exercitar a
    // validação JS da página; o navegador já barraria sozinho.
    await page.evaluate(() => {
      for (const id of ['newPassword', 'confirmPassword']) {
        const el = document.getElementById(id);
        el.removeAttribute('minlength');
        el.removeAttribute('required');
      }
    });
    await fillNewPasswords(page, '12345');
    await page.click('#btnSaveNewPassword');
    await expect(page.locator('#recoveryStatus')).toContainText('mínimo 6');
    expect(counters.updateUser).toBe(0);
  });

  test('8. updateUser é chamado exatamente uma vez', async ({ page }) => {
    const counters = { updateUser: 0, logout: 0 };
    await useFakeSupabaseConfig(page);
    await mockAuthRest(page, counters);
    await gotoResetPage(page, RECOVERY_HASH);
    await waitRecoveryReady(page);
    await fillNewPasswords(page, NEW_PASSWORD);
    await page.evaluate(() => {
      const form = document.getElementById('resetPasswordForm');
      form.requestSubmit();
      form.requestSubmit();
    });
    await expect(page.locator('#recoveryStatus')).toContainText('Senha alterada com sucesso', { timeout: 10000 });
    expect(counters.updateUser).toBe(1);
  });

  test('9. sucesso mostra confirmação e retorno ao login', async ({ page }) => {
    const counters = { updateUser: 0, logout: 0 };
    await useFakeSupabaseConfig(page);
    await mockAuthRest(page, counters);
    await gotoResetPage(page, RECOVERY_HASH);
    await waitRecoveryReady(page);
    await fillNewPasswords(page, NEW_PASSWORD);
    await page.click('#btnSaveNewPassword');
    await expect(page.locator('#recoveryStatus')).toContainText('Senha alterada com sucesso', { timeout: 10000 });
    await expect(page.locator('#resetPasswordForm')).toBeHidden();
    const backHref = await page.locator('#btnBackToLoginPrimary').getAttribute('href');
    expect(backHref).toBe('/');
    expect(counters.logout).toBe(1);
    await page.click('#btnBackToLoginPrimary');
    await page.waitForFunction(
      () => window.linsoraStore && window.LinsoraAccess && window.supabaseRepo,
      { timeout: 10000 }
    );
    await expect(page.locator('#authScreen')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#appMain')).toBeHidden();
  });

  test('10. nenhuma senha ou token é exposta em logs ou interface', async ({ page }) => {
    const counters = { updateUser: 0, logout: 0 };
    const consoleTexts = [];
    page.on('console', (msg) => consoleTexts.push(msg.text()));
    await useFakeSupabaseConfig(page);
    await mockAuthRest(page, counters);
    await gotoResetPage(page, RECOVERY_HASH);
    await waitRecoveryReady(page);
    await fillNewPasswords(page, NEW_PASSWORD);
    await page.click('#btnSaveNewPassword');
    await expect(page.locator('#recoveryStatus')).toContainText('Senha alterada com sucesso', { timeout: 10000 });
    expect(consoleTexts.join('\n')).not.toContain(NEW_PASSWORD);
    expect(consoleTexts.join('\n')).not.toContain('fake-access-token-abc123');
    expect(page.url()).not.toContain(NEW_PASSWORD);
    expect(page.url()).not.toContain('access_token');
    const bodyText = await page.evaluate(() => document.body.innerText);
    expect(bodyText).not.toContain(NEW_PASSWORD);
    expect(await page.locator('#newPassword').getAttribute('type')).toBe('password');
    expect(await page.locator('#confirmPassword').getAttribute('type')).toBe('password');
  });

  test('11. (A) raiz com recovery hash redireciona para reset-password.html sem abrir login/gate', async ({ page }) => {
    const counters = { updateUser: 0, logout: 0 };
    await useFakeSupabaseConfig(page);
    await mockAuthRest(page, counters);
    await page.goto('/#access_token=fake-token-123&type=recovery&refresh_token=fake-ref-456&expires_in=3600&token_type=bearer');
    await page.waitForURL((url) => url.pathname.includes('reset-password.html'), { timeout: 10000 });
    expect(page.url()).toContain('/reset-password.html');
    await waitRecoveryReady(page);
    await expect(page.locator('#recoveryStatus')).toContainText('Defina sua nova senha');
    await expect(page.locator('#authScreen')).toHaveCount(0);
    await expect(page.locator('#subscriptionBlockedOverlay')).toHaveCount(0);
  });

  test('12. (B) raiz com erro/expirado redireciona para reset-password.html com aviso adequado', async ({ page }) => {
    await useFakeSupabaseConfig(page);
    await page.goto('/#error=access_denied&error_code=403&error_description=Email+link+is+invalid+or+has+expired&type=recovery');
    await page.waitForURL((url) => url.pathname.includes('reset-password.html'), { timeout: 10000 });
    expect(page.url()).toContain('/reset-password.html');
    await expect(page.locator('#recoveryStatus')).toContainText('expirou ou é inválido', { timeout: 10000 });
    await expect(page.locator('#resetPasswordForm')).toBeHidden();
    await expect(page.locator('#linkBackLogin')).toBeVisible();
  });

  test('13. (C) raiz com PKCE code query redireciona preservando o code', async ({ page }) => {
    await useFakeSupabaseConfig(page);
    await page.goto('/?code=auth-code-ficticio-12345');
    await page.waitForURL((url) => url.pathname.includes('reset-password.html'), { timeout: 10000 });
    expect(page.url()).toContain('/reset-password.html');
    expect(page.url()).toContain('code=auth-code-ficticio-12345');
  });

  test('14. (D) acesso normal à raiz e hashes arbitrários não redirecionam', async ({ page }) => {
    await gotoAuth(page);
    expect(page.url()).not.toContain('reset-password.html');
    await expect(page.locator('#authScreen')).toBeVisible();

    await page.goto('/#outra-coisa');
    await page.waitForFunction(
      () => window.linsoraStore && window.LinsoraAccess && window.supabaseRepo,
      { timeout: 10000 }
    );
    expect(page.url()).not.toContain('reset-password.html');
    await expect(page.locator('#authScreen')).toBeVisible();
  });

  test('15. (E) fluxo recovery -> reset-password -> voltar para login permanece na raiz sem loop', async ({ page }) => {
    const counters = { updateUser: 0, logout: 0 };
    await useFakeSupabaseConfig(page);
    await mockAuthRest(page, counters);
    await page.goto('/#access_token=fake-token-loop-123&type=recovery&refresh_token=fake-ref-loop-456&expires_in=3600&token_type=bearer');
    await page.waitForURL((url) => url.pathname.includes('reset-password.html'), { timeout: 10000 });
    await waitRecoveryReady(page);

    await page.click('#linkBackLogin');
    await page.waitForURL((url) => url.pathname === '/' || url.pathname.endsWith('/index.html'), { timeout: 10000 });
    expect(page.url()).not.toContain('reset-password.html');
    await page.waitForFunction(
      () => window.linsoraStore && window.LinsoraAccess && window.supabaseRepo,
      { timeout: 10000 }
    );
    await expect(page.locator('#authScreen')).toBeVisible({ timeout: 8000 });
    await page.waitForTimeout(1000);
    expect(page.url()).not.toContain('reset-password.html');
  });
});
