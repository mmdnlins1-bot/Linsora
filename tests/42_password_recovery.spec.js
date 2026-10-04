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
    // O SDK (detectSessionInUrl) pode higienizar o hash após consumir;
    // a página NÃO limpa manualmente antes do sucesso (ver teste 22/G).
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
    await expect(page.locator('#recoveryStatus')).toContainText('pelo menos 6');
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

  // Cobertura IMPLICIT adicional (A-H). Somente tokens/senhas fictícios.
  test('16. (A) IMPLICIT válido estabelece sessão sem expor segredo', async ({ page }) => {
    const counters = { updateUser: 0, logout: 0 };
    const consoleTexts = [];
    page.on('console', (msg) => consoleTexts.push(msg.text()));
    await useFakeSupabaseConfig(page);
    await mockAuthRest(page, counters);
    await gotoResetPage(page, RECOVERY_HASH);
    await waitRecoveryReady(page);
    // Sessão persistida pelo SDK sob chave sb-*-auth-token (formato interno
    // pode variar entre versões; basta existir e conter usuário/token fake).
    const sess = await page.evaluate(() => {
      const keys = Object.keys(localStorage).filter((k) => k.indexOf('sb-') === 0 && k.indexOf('auth-token') !== -1);
      if (keys.length === 0) return { hasKeys: false, blob: '' };
      const blob = keys.map((k) => String(localStorage.getItem(k) || '')).join('\n').slice(0, 2000);
      return { hasKeys: true, blob };
    });
    expect(sess.hasKeys).toBe(true);
    expect(sess.blob).toContain('fake-access-token-abc123');
    expect(consoleTexts.join('\n')).not.toContain('fake-access-token-abc123');
    expect(consoleTexts.join('\n')).not.toContain('fake-refresh-token-xyz789');
  });

  test('17. (B) sem falso "expirado" antes do timeout; libera após sessão válida', async ({ page }) => {
    const counters = { updateUser: 0, logout: 0 };
    await useFakeSupabaseConfig(page);
    await mockAuthRest(page, counters);
    await gotoResetPage(page, RECOVERY_HASH);
    await page.waitForTimeout(400);
    const earlyStatus = await page.locator('#recoveryStatus').innerText();
    expect(earlyStatus).not.toContain('expirou ou é inválido');
    await waitRecoveryReady(page);
    await expect(page.locator('#recoveryStatus')).toContainText('Defina sua nova senha');
  });

  test('18. (C) sessão ausente mantém bloqueio e não chama updateUser', async ({ page }) => {
    const counters = { updateUser: 0, logout: 0 };
    await useFakeSupabaseConfig(page);
    await mockAuthRest(page, counters);
    // Hash de erro explícito: SDK não estabelece sessão; boot expira após timeout.
    await gotoResetPage(page, '#error=access_denied&error_description=link-expirado-ficticio&type=recovery');
    await expect(page.locator('#recoveryStatus')).toContainText(/inválido|expirou/, { timeout: 10000 });
    await expect(page.locator('#resetPasswordForm')).toBeHidden();
    expect(counters.updateUser).toBe(0);
  });

  test('19. (D) updateUser usa Authorization Bearer e ocorre 1x no sucesso', async ({ page }) => {
    const counters = { updateUser: 0, logout: 0 };
    let authHeader = '';
    await useFakeSupabaseConfig(page);
    await page.route(FAKE_SUPABASE_URL + '/auth/v1/*', async (route) => {
      const req = route.request();
      const url = req.url();
      if (req.method() === 'PUT' && url.endsWith('/auth/v1/user')) {
        counters.updateUser += 1;
        authHeader = req.headers()['authorization'] || '';
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
    await gotoResetPage(page, RECOVERY_HASH);
    await waitRecoveryReady(page);
    await fillNewPasswords(page, NEW_PASSWORD);
    await page.click('#btnSaveNewPassword');
    await expect(page.locator('#recoveryStatus')).toContainText('Senha alterada com sucesso', { timeout: 10000 });
    expect(counters.updateUser).toBe(1);
    expect(authHeader).toMatch(/^Bearer\s+.+/);
    expect(authHeader).not.toContain(NEW_PASSWORD);
  });

  test('20. (E) updateUser 401 orienta novo link sem expor token nem loop', async ({ page }) => {
    const counters = { updateUser: 0, logout: 0 };
    const consoleTexts = [];
    page.on('console', (msg) => consoleTexts.push(msg.text()));
    await useFakeSupabaseConfig(page);
    await page.route(FAKE_SUPABASE_URL + '/auth/v1/*', async (route) => {
      const req = route.request();
      const url = req.url();
      if (req.method() === 'PUT' && url.endsWith('/auth/v1/user')) {
        counters.updateUser += 1;
        await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ msg: 'invalid JWT: unable to parse or verify signature, token has expired' }) });
      } else if (url.includes('/auth/v1/logout')) {
        counters.logout += 1;
        await route.fulfill({ status: 204, body: '' });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
    });
    await gotoResetPage(page, RECOVERY_HASH);
    await waitRecoveryReady(page);
    await fillNewPasswords(page, NEW_PASSWORD);
    await page.click('#btnSaveNewPassword');
    await expect(page.locator('#recoveryStatus')).toContainText('expirou', { timeout: 10000 });
    await expect(page.locator('#recoveryStatus')).toContainText('novo link');
    expect(counters.updateUser).toBe(1);
    expect(counters.logout).toBe(0);
    // Sessão expirada bloqueia: botão desabilitado e nenhuma nova chamada,
    // mesmo com submit programático (sem loop).
    await expect(page.locator('#btnSaveNewPassword')).toBeDisabled();
    await page.evaluate(() => {
      const form = document.getElementById('resetPasswordForm');
      if (form) form.requestSubmit();
    });
    await page.waitForTimeout(500);
    expect(counters.updateUser).toBe(1);
    expect(consoleTexts.join('\n')).not.toContain('fake-access-token-abc123');
    const bodyText = await page.evaluate(() => document.body.innerText);
    expect(bodyText).not.toContain('fake-access-token-abc123');
    // Em erro a página NÃO higieniza manualmente (a limpeza só ocorre no
    // sucesso; o SDK pode já ter consumido o hash ao estabelecer a sessão).
  });

  test('21. (F) erro de rede permite nova tentativa', async ({ page }) => {
    const counters = { updateUser: 0, logout: 0 };
    await useFakeSupabaseConfig(page);
    let failFirst = true;
    await page.route(FAKE_SUPABASE_URL + '/auth/v1/*', async (route) => {
      const req = route.request();
      const url = req.url();
      if (req.method() === 'PUT' && url.endsWith('/auth/v1/user')) {
        counters.updateUser += 1;
        if (failFirst) {
          failFirst = false;
          await route.abort('failed');
          return;
        }
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
    await gotoResetPage(page, RECOVERY_HASH);
    await waitRecoveryReady(page);
    await fillNewPasswords(page, NEW_PASSWORD);
    await page.click('#btnSaveNewPassword');
    await expect(page.locator('#recoveryStatus')).toContainText('conexão', { timeout: 10000 });
    expect(counters.updateUser).toBe(1);
    // Retry permitido: segunda tentativa com rede OK deve ter sucesso.
    await page.click('#btnSaveNewPassword');
    await expect(page.locator('#recoveryStatus')).toContainText('Senha alterada com sucesso', { timeout: 10000 });
    expect(counters.updateUser).toBe(2);
  });

  test('22. (G) sucesso limpa hash somente depois; encerra sessão', async ({ page }) => {
    const counters = { updateUser: 0, logout: 0 };
    await useFakeSupabaseConfig(page);
    await mockAuthRest(page, counters);
    await gotoResetPage(page, RECOVERY_HASH);
    await waitRecoveryReady(page);
    await fillNewPasswords(page, NEW_PASSWORD);
    await page.click('#btnSaveNewPassword');
    await expect(page.locator('#recoveryStatus')).toContainText('Senha alterada com sucesso', { timeout: 10000 });
    await expect(page.locator('#resetPasswordForm')).toBeHidden();
    expect(counters.updateUser).toBe(1);
    expect(counters.logout).toBe(1);
    expect(await page.evaluate(() => window.location.hash)).toBe('');
    expect(page.url()).not.toContain('access_token');
    const after = await page.evaluate(async () => {
      const keys = Object.keys(localStorage).filter((k) => k.indexOf('sb-') === 0);
      let anyToken = false;
      for (const k of keys) {
        try {
          const parsed = JSON.parse(localStorage.getItem(k));
          if (parsed && (parsed.access_token || (parsed.currentSession && parsed.currentSession.access_token))) { anyToken = true; break; }
        } catch (e) { /* ignora */ }
      }
      return anyToken;
    });
    expect(after).toBe(false);
  });

  test('23. (H) nenhum vazamento em storage/console/URL/corpo', async ({ page }) => {
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
    const dump = await page.evaluate(() => ({
      ls: Object.keys(localStorage).map((k) => k + '=' + (localStorage.getItem(k) || '')).join('\n'),
      url: window.location.href,
      body: document.body.innerText,
      hash: window.location.hash,
    }));
    for (const hay of [consoleTexts.join('\n'), dump.ls, dump.url, dump.body]) {
      expect(hay).not.toContain(NEW_PASSWORD);
      expect(hay).not.toContain('fake-access-token-abc123');
      expect(hay).not.toContain('fake-refresh-token-xyz789');
    }
    expect(dump.hash).toBe('');
  });

  // Pós-recovery (commit da auditoria): botão único + limpeza do snapshot local.
  const STALE_SNAPSHOT = JSON.stringify({ id: 'usr-ficticio-stale-1', email: 'stale.ficticio@exemplo.com', name: 'Stale Ficticio' });

  async function seedLocalSnapshot(page) {
    await page.evaluate((snap) => {
      localStorage.setItem('LINSORA_ACTIVE_LOCAL_SESSION', snap);
    }, STALE_SNAPSHOT);
  }

  async function seedIdbSnapshot(page) {
    await page.evaluate((snap) => new Promise((resolve, reject) => {
      const req = indexedDB.open('LinsoraSecureDB', 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('linsora_auth')) db.createObjectStore('linsora_auth');
      };
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction('linsora_auth', 'readwrite');
          tx.objectStore('linsora_auth').put(snap, 'LINSORA_ACTIVE_LOCAL_SESSION');
          tx.oncomplete = () => { try { db.close(); } catch (e) {} resolve(); };
          tx.onerror = () => { try { db.close(); } catch (e) {} reject(tx.error); };
        } catch (e) { try { db.close(); } catch (e2) {} reject(e); }
      };
      req.onerror = () => reject(req.error);
    }), STALE_SNAPSHOT);
  }

  async function readIdbSnapshot(page) {
    return page.evaluate(() => new Promise((resolve) => {
      try {
        const req = indexedDB.open('LinsoraSecureDB', 1);
        req.onsuccess = () => {
          const db = req.result;
          try {
            if (!db.objectStoreNames.contains('linsora_auth')) { try { db.close(); } catch (e) {} resolve(null); return; }
            const tx = db.transaction('linsora_auth', 'readonly');
            const get = tx.objectStore('linsora_auth').get('LINSORA_ACTIVE_LOCAL_SESSION');
            get.onsuccess = () => { try { db.close(); } catch (e) {} resolve(get.result === undefined ? null : get.result); };
            get.onerror = () => { try { db.close(); } catch (e) {} resolve(null); };
          } catch (e) { try { db.close(); } catch (e2) {} resolve(null); }
        };
        req.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    }));
  }

  test('24. (A) sucesso mostra UM único "Voltar para o login"', async ({ page }) => {
    const counters = { updateUser: 0, logout: 0 };
    await useFakeSupabaseConfig(page);
    await mockAuthRest(page, counters);
    await gotoResetPage(page, RECOVERY_HASH);
    await waitRecoveryReady(page);
    // Antes do sucesso o link de texto existe normalmente.
    await expect(page.locator('#linkBackLogin')).toBeVisible();
    await fillNewPasswords(page, NEW_PASSWORD);
    await page.click('#btnSaveNewPassword');
    await expect(page.locator('#recoveryStatus')).toContainText('Senha alterada com sucesso', { timeout: 10000 });
    await expect(page.locator('#btnBackToLoginPrimary')).toBeVisible();
    await expect(page.locator('#linkBackLogin')).toBeHidden();
    expect(await page.locator('#btnBackToLoginPrimary').getAttribute('href')).toBe('/');
  });

  test('25. (B) sucesso remove o snapshot local do localStorage', async ({ page }) => {
    const counters = { updateUser: 0, logout: 0 };
    await useFakeSupabaseConfig(page);
    await mockAuthRest(page, counters);
    await gotoResetPage(page, RECOVERY_HASH);
    await waitRecoveryReady(page);
    // Semeia após o boot: o snapshot só precisa existir antes do sucesso.
    await seedLocalSnapshot(page);
    await page.evaluate(() => localStorage.setItem('LINSORA_SENTINEL_TEST', 'sentinel-ficticio-1'));
    expect(await page.evaluate(() => localStorage.getItem('LINSORA_ACTIVE_LOCAL_SESSION'))).not.toBeNull();
    await fillNewPasswords(page, NEW_PASSWORD);
    await page.click('#btnSaveNewPassword');
    await expect(page.locator('#recoveryStatus')).toContainText('Senha alterada com sucesso', { timeout: 10000 });
    expect(await page.evaluate(() => localStorage.getItem('LINSORA_ACTIVE_LOCAL_SESSION'))).toBeNull();
    // Outras chaves do app não são apagadas pela limpeza.
    expect(await page.evaluate(() => localStorage.getItem('LINSORA_SENTINEL_TEST'))).toBe('sentinel-ficticio-1');
    await page.evaluate(() => localStorage.removeItem('LINSORA_SENTINEL_TEST'));
  });

  test('26. (C) sucesso remove o snapshot do IndexedDB', async ({ page }) => {
    const counters = { updateUser: 0, logout: 0 };
    await useFakeSupabaseConfig(page);
    await mockAuthRest(page, counters);
    await gotoResetPage(page, RECOVERY_HASH);
    await waitRecoveryReady(page);
    await seedIdbSnapshot(page);
    expect(await readIdbSnapshot(page)).not.toBeNull();
    await fillNewPasswords(page, NEW_PASSWORD);
    await page.click('#btnSaveNewPassword');
    await expect(page.locator('#recoveryStatus')).toContainText('Senha alterada com sucesso', { timeout: 10000 });
    expect(await readIdbSnapshot(page)).toBeNull();
  });

  test('27. (D) pós-recovery com snapshot stale: / abre login, sem planos', async ({ page }) => {
    const counters = { updateUser: 0, logout: 0 };
    await useFakeSupabaseConfig(page);
    await mockAuthRest(page, counters);
    await gotoResetPage(page, RECOVERY_HASH);
    await waitRecoveryReady(page);
    await seedLocalSnapshot(page);
    await seedIdbSnapshot(page);
    await fillNewPasswords(page, NEW_PASSWORD);
    await page.click('#btnSaveNewPassword');
    await expect(page.locator('#recoveryStatus')).toContainText('Senha alterada com sucesso', { timeout: 10000 });
    await page.goto('/');
    await page.waitForFunction(
      () => window.linsoraStore && window.LinsoraAccess && window.supabaseRepo,
      { timeout: 10000 }
    );
    await expect(page.locator('#authScreen')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#appMain')).toBeHidden();
    await expect(page.locator('#subscriptionScreen')).toBeHidden();
  });

  test('28. (E) falha no updateUser NÃO limpa o snapshot (só sucesso limpa)', async ({ page }) => {
    const counters = { updateUser: 0, logout: 0 };
    await useFakeSupabaseConfig(page);
    await page.route(FAKE_SUPABASE_URL + '/auth/v1/*', async (route) => {
      const req = route.request();
      const url = req.url();
      if (req.method() === 'PUT' && url.endsWith('/auth/v1/user')) {
        counters.updateUser += 1;
        await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ msg: 'invalid JWT: token has expired' }) });
      } else if (url.includes('/auth/v1/logout')) {
        counters.logout += 1;
        await route.fulfill({ status: 204, body: '' });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
    });
    await gotoResetPage(page, RECOVERY_HASH);
    await waitRecoveryReady(page);
    await seedLocalSnapshot(page);
    await fillNewPasswords(page, NEW_PASSWORD);
    await page.click('#btnSaveNewPassword');
    await expect(page.locator('#recoveryStatus')).toContainText('expirou', { timeout: 10000 });
    expect(counters.updateUser).toBe(1);
    expect(await page.evaluate(() => localStorage.getItem('LINSORA_ACTIVE_LOCAL_SESSION'))).not.toBeNull();
  });

  test('29. (F) pós-sucesso sem segredos residuais', async ({ page }) => {
    const counters = { updateUser: 0, logout: 0 };
    const consoleTexts = [];
    page.on('console', (msg) => consoleTexts.push(msg.text()));
    await useFakeSupabaseConfig(page);
    await mockAuthRest(page, counters);
    await gotoResetPage(page, RECOVERY_HASH);
    await waitRecoveryReady(page);
    await seedLocalSnapshot(page);
    await fillNewPasswords(page, NEW_PASSWORD);
    await page.click('#btnSaveNewPassword');
    await expect(page.locator('#recoveryStatus')).toContainText('Senha alterada com sucesso', { timeout: 10000 });
    const dump = await page.evaluate(() => ({
      ls: Object.keys(localStorage).map((k) => k + '=' + (localStorage.getItem(k) || '')).join('\n'),
      url: window.location.href,
      body: document.body.innerText,
    }));
    expect(await page.evaluate(() => localStorage.getItem('LINSORA_ACTIVE_LOCAL_SESSION'))).toBeNull();
    for (const hay of [consoleTexts.join('\n'), dump.ls, dump.url, dump.body]) {
      expect(hay).not.toContain(NEW_PASSWORD);
      expect(hay).not.toContain('fake-access-token-abc123');
      expect(hay).not.toContain('fake-refresh-token-xyz789');
      expect(hay).not.toContain('stale.ficticio@exemplo.com');
    }
  });

  // Refinamento cirúrgico: volta ao login, regra visível, validação e same_password.
  test('30. (A) sucesso: só "Voltar para o login" e vai direto ao Login sem subscriptionScreen', async ({ page }) => {
    const counters = { updateUser: 0, logout: 0 };
    await useFakeSupabaseConfig(page);
    await mockAuthRest(page, counters);
    await gotoResetPage(page, RECOVERY_HASH);
    await waitRecoveryReady(page);
    await fillNewPasswords(page, NEW_PASSWORD);
    await page.click('#btnSaveNewPassword');
    await expect(page.locator('#recoveryStatus')).toContainText('Senha alterada com sucesso', { timeout: 10000 });
    await expect(page.locator('#btnBackToLoginPrimary')).toBeVisible();
    await expect(page.locator('#linkBackLogin')).toBeHidden();
    await expect(page.locator('#resetPasswordForm')).toBeHidden();
    await page.click('#btnBackToLoginPrimary');
    await page.waitForFunction(
      () => window.linsoraStore && window.LinsoraAccess && window.supabaseRepo,
      { timeout: 10000 }
    );
    await expect(page.locator('#authScreen')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#appMain')).toBeHidden();
    await expect(page.locator('#subscriptionScreen')).toBeHidden();
  });

  test('31. (B) conta sem assinatura: pós-recovery volta ao Login sem abrir planos', async ({ page }) => {
    const counters = { updateUser: 0, logout: 0 };
    await useFakeSupabaseConfig(page);
    await mockAuthRest(page, counters);
    await gotoResetPage(page, RECOVERY_HASH);
    await waitRecoveryReady(page);
    await seedLocalSnapshot(page);
    await fillNewPasswords(page, NEW_PASSWORD);
    await page.click('#btnSaveNewPassword');
    await expect(page.locator('#recoveryStatus')).toContainText('Senha alterada com sucesso', { timeout: 10000 });
    // Clicar em voltar leva ao Login; o gate de assinatura só pode aparecer
    // depois de um novo login, nunca como consequência do retorno.
    await page.click('#btnBackToLoginPrimary');
    await page.waitForFunction(
      () => window.linsoraStore && window.LinsoraAccess && window.supabaseRepo,
      { timeout: 10000 }
    );
    await expect(page.locator('#authScreen')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#subscriptionScreen')).toBeHidden();
    await expect(page.locator('#appMain')).toBeHidden();
  });

  test('32. (C) senha com 5 caracteres: mensagem de mínimo e sem updateUser', async ({ page }) => {
    const counters = { updateUser: 0, logout: 0 };
    await useFakeSupabaseConfig(page);
    await mockAuthRest(page, counters);
    await gotoResetPage(page, RECOVERY_HASH);
    await waitRecoveryReady(page);
    // A regra fica visível desde a abertura, antes de qualquer envio.
    await expect(page.locator('#newPasswordHint')).toContainText('pelo menos 6');
    await expect(page.locator('#confirmPasswordHint')).toContainText('mesma senha');
    await expect(page.locator('#newPassword')).toHaveAttribute('placeholder', 'Nova senha');
    await page.evaluate(() => {
      for (const id of ['newPassword', 'confirmPassword']) {
        const el = document.getElementById(id);
        el.removeAttribute('minlength');
        el.removeAttribute('required');
      }
    });
    await fillNewPasswords(page, '12345');
    await page.click('#btnSaveNewPassword');
    await expect(page.locator('#recoveryStatus')).toContainText('pelo menos 6');
    expect(counters.updateUser).toBe(0);
    await expect(page.locator('#resetPasswordForm')).toBeVisible();
  });

  test('33. (D) confirmação diferente: mensagem de divergência e sem updateUser', async ({ page }) => {
    const counters = { updateUser: 0, logout: 0 };
    await useFakeSupabaseConfig(page);
    await mockAuthRest(page, counters);
    await gotoResetPage(page, RECOVERY_HASH);
    await waitRecoveryReady(page);
    await fillNewPasswords(page, NEW_PASSWORD, 'outra-senha-ficticia-2');
    await page.click('#btnSaveNewPassword');
    await expect(page.locator('#recoveryStatus')).toContainText('não coincidem');
    expect(counters.updateUser).toBe(0);
    await expect(page.locator('#resetPasswordForm')).toBeVisible();
  });

  test('34. (E) senha igual à anterior (same_password 422) mostra mensagem específica', async ({ page }) => {
    const counters = { updateUser: 0, logout: 0 };
    await useFakeSupabaseConfig(page);
    await page.route(FAKE_SUPABASE_URL + '/auth/v1/*', async (route) => {
      const req = route.request();
      const url = req.url();
      if (req.method() === 'PUT' && url.endsWith('/auth/v1/user')) {
        counters.updateUser += 1;
        await route.fulfill({
          status: 422,
          contentType: 'application/json',
          // Resposta real do Supabase Auth: code same_password.
          body: JSON.stringify({ code: 'same_password', msg: 'New password should be different from the old password.' }),
        });
      } else if (url.includes('/auth/v1/logout')) {
        counters.logout += 1;
        await route.fulfill({ status: 204, body: '' });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
    });
    await gotoResetPage(page, RECOVERY_HASH);
    await waitRecoveryReady(page);
    await fillNewPasswords(page, 'senha-reutilizada-1');
    await page.click('#btnSaveNewPassword');
    await expect(page.locator('#recoveryStatus')).toContainText('diferente da senha anterior', { timeout: 10000 });
    const statusText = await page.locator('#recoveryStatus').innerText();
    expect(statusText).not.toContain('pelo menos 6');
    expect(counters.updateUser).toBe(1);
    // Recuperação de erro permite nova tentativa (formulário segue visível).
    await expect(page.locator('#resetPasswordForm')).toBeVisible();
  });

  test('35. (F) senha válida chama updateUser e conclui o sucesso', async ({ page }) => {
    const counters = { updateUser: 0, logout: 0 };
    await useFakeSupabaseConfig(page);
    await mockAuthRest(page, counters);
    await gotoResetPage(page, RECOVERY_HASH);
    await waitRecoveryReady(page);
    await fillNewPasswords(page, NEW_PASSWORD);
    await page.click('#btnSaveNewPassword');
    await expect(page.locator('#recoveryStatus')).toContainText('Senha alterada com sucesso', { timeout: 10000 });
    expect(counters.updateUser).toBe(1);
    expect(counters.logout).toBe(1);
  });

  test('36. (G) sem exposição de segredos em erro same_password ou validação local', async ({ page }) => {
    const counters = { updateUser: 0, logout: 0 };
    const consoleTexts = [];
    page.on('console', (msg) => consoleTexts.push(msg.text()));
    await useFakeSupabaseConfig(page);
    await page.route(FAKE_SUPABASE_URL + '/auth/v1/*', async (route) => {
      const req = route.request();
      const url = req.url();
      if (req.method() === 'PUT' && url.endsWith('/auth/v1/user')) {
        counters.updateUser += 1;
        await route.fulfill({
          status: 422,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'same_password', msg: 'New password should be different from the old password.' }),
        });
      } else if (url.includes('/auth/v1/logout')) {
        counters.logout += 1;
        await route.fulfill({ status: 204, body: '' });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
    });
    await gotoResetPage(page, RECOVERY_HASH);
    await waitRecoveryReady(page);
    const SAME_AS_NEW = 'senha-reutilizada-2-xy';
    await fillNewPasswords(page, SAME_AS_NEW);
    await page.click('#btnSaveNewPassword');
    await expect(page.locator('#recoveryStatus')).toContainText('diferente da senha anterior', { timeout: 10000 });
    const dump = await page.evaluate(() => ({
      url: window.location.href,
      body: document.body.innerText,
    }));
    for (const hay of [consoleTexts.join('\n'), dump.url, dump.body]) {
      expect(hay).not.toContain(SAME_AS_NEW);
      expect(hay).not.toContain('fake-access-token-abc123');
      expect(hay).not.toContain('fake-refresh-token-xyz789');
    }
  });
});
