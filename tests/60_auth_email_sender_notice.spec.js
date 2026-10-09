const { test, expect } = require('@playwright/test');

// 60. Avisos sobre a identificação do remetente dos e-mails de autenticação.
// Os e-mails transacionais seguem pelos e-mails nativos do provedor de auth
// (hook Resend desativado por padrão), por isso o texto usa a versão segura
// e genérica, sem afirmar um nome exato de remetente.
// Somente mocks/stubs: nenhum usuário real, nenhum e-mail real, nenhum segredo.

const NOTICE_FRAGMENT = 'identificação diferente de Linsora';
const SPAM_FRAGMENT = 'caixa de spam';

async function gotoFunnel(page) {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/?vamos-comecar=1');
  await page.waitForFunction(
    () => window.linsoraStore && window.supabaseRepo && window.setAuthMode,
    { timeout: 10000 }
  );
  await expect(page.locator('#authScreen')).toBeVisible({ timeout: 8000 });
}

async function gotoAuth(page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('LINSORA_SEEN_ONBOARDING', 'true'); } catch (e) { /* ignora */ }
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

async function mockSignUpNoSession(page) {
  await page.evaluate(() => {
    window.supabaseRepo.supabase = {
      auth: {
        signUp: async () => ({ data: { user: { id: 'user-aviso-1' }, session: null }, error: null }),
      },
    };
    try { localStorage.removeItem('LINSORA_ACTIVE_LOCAL_SESSION'); } catch (e) {}
  });
}

test.describe('60. Avisos de remetente nos e-mails de autenticação', () => {
  test('1. cadastro com confirmação pendente exibe o aviso sem substituir a mensagem existente', async ({ page }) => {
    await gotoFunnel(page);
    await mockSignUpNoSession(page);
    await page.fill('#authName', 'Usuario Aviso');
    await page.fill('#authEmail', 'aviso@exemplo.com');
    await page.fill('#authPassword', 'senhaFicticia123');
    await page.fill('#authConfirmPassword', 'senhaFicticia123');
    await page.click('#btnSubmitAuth');
    await expect(page.locator('#confirmationPending')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#confirmationPendingText')).toContainText('e-mail de confirmação');
    const notice = page.locator('#authSenderNotice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(NOTICE_FRAGMENT);
    await expect(notice).toContainText(SPAM_FRAGMENT);
    await expect(page.locator('#toastContainer')).toContainText('e-mail de confirmação');
  });

  test('2. modal de recuperação exibe o aviso e o sucesso existente continua', async ({ page }) => {
    await gotoAuth(page);
    await page.click('#btnForgotPassword');
    await expect(page.locator('#modalForgotPassword')).toBeVisible();
    const notice = page.locator('#recoverySenderNotice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(NOTICE_FRAGMENT);
    await expect(notice).toContainText(SPAM_FRAGMENT);
    await page.evaluate(() => {
      window.supabaseRepo.supabase = {
        auth: {
          resetPasswordForEmail: async () => ({ error: null }),
        },
      };
    });
    await page.fill('#recoveryEmail', 'rec.aviso@exemplo.com');
    await page.click('#btnSendRecoveryEmail');
    await expect(page.locator('#modalForgotPassword')).toBeHidden();
    await expect(page.locator('#toastContainer')).toContainText('Link de redefinição enviado');
  });

  test('3. validações e erros existentes não foram substituídos', async ({ page }) => {
    await gotoFunnel(page);
    await page.fill('#authEmail', 'validacao@exemplo.com');
    await page.fill('#authPassword', 'senhaFicticia123');
    await page.fill('#authConfirmPassword', 'outraSenha456');
    await page.click('#btnSubmitAuth');
    await expect(page.locator('#toastContainer')).toContainText('As senhas não coincidem');
    await gotoAuth(page);
    await page.click('#btnForgotPassword');
    await expect(page.locator('#modalForgotPassword')).toBeVisible();
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

  test('4. aviso não aparece em telas sem relação com esses fluxos', async ({ page }) => {
    await page.goto('/landing.html');
    await expect(page.locator('#hero')).toBeVisible();
    expect(await page.locator('#authSenderNotice').count()).toBe(0);
    expect(await page.locator('#recoverySenderNotice').count()).toBe(0);
    await gotoAuth(page);
    await expect(page.locator('#confirmationPending')).toBeHidden();
    await expect(page.locator('#authSenderNotice')).toBeHidden();
  });

  test('5. sem duplicação ao reabrir o modal ou repetir o fluxo', async ({ page }) => {
    await gotoAuth(page);
    await page.click('#btnForgotPassword');
    await expect(page.locator('#modalForgotPassword')).toBeVisible();
    await page.click('#modalForgotPassword [data-close-modal="modalForgotPassword"]');
    await expect(page.locator('#modalForgotPassword')).toBeHidden();
    await page.click('#btnForgotPassword');
    await expect(page.locator('#modalForgotPassword')).toBeVisible();
    expect(await page.locator('#recoverySenderNotice').count()).toBe(1);
    await gotoFunnel(page);
    await mockSignUpNoSession(page);
    await page.fill('#authName', 'Usuario Aviso');
    await page.fill('#authEmail', 'aviso2@exemplo.com');
    await page.fill('#authPassword', 'senhaFicticia123');
    await page.fill('#authConfirmPassword', 'senhaFicticia123');
    await page.click('#btnSubmitAuth');
    await expect(page.locator('#confirmationPending')).toBeVisible({ timeout: 5000 });
    expect(await page.locator('#authSenderNotice').count()).toBe(1);
  });

  test('6. layout mobile sem overflow com os avisos visíveis', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await gotoAuth(page);
    await page.click('#btnForgotPassword');
    await expect(page.locator('#modalForgotPassword')).toBeVisible();
    await expect(page.locator('#recoverySenderNotice')).toBeVisible();
    const modalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(modalOverflow).toBeLessThanOrEqual(1);
    await page.click('#modalForgotPassword [data-close-modal="modalForgotPassword"]');
    await gotoFunnel(page);
    await mockSignUpNoSession(page);
    await page.fill('#authName', 'Usuario Aviso');
    await page.fill('#authEmail', 'aviso.mobile@exemplo.com');
    await page.fill('#authPassword', 'senhaFicticia123');
    await page.fill('#authConfirmPassword', 'senhaFicticia123');
    await page.click('#btnSubmitAuth');
    await expect(page.locator('#authSenderNotice')).toBeVisible({ timeout: 5000 });
    const authOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(authOverflow).toBeLessThanOrEqual(1);
  });

  test('7. fluxos de autenticação continuam funcionando (regressão mínima)', async ({ page }) => {
    await gotoFunnel(page);
    const captured = await page.evaluate(async () => {
      window.__capturedSignUp__ = null;
      const repo = window.supabaseRepo;
      repo.supabase = {
        auth: {
          signUp: async (payload) => {
            window.__capturedSignUp__ = payload;
            return { data: { user: { id: 'user-aviso-2' }, session: null }, error: null };
          },
        },
      };
      return repo.signUpWithEmail('Nome Ficticio', 'regressao@exemplo.com', 'senhaFicticia123').then((res) => ({
        res,
        captured: window.__capturedSignUp__,
      }));
    });
    expect(captured.res.needsConfirmation).toBe(true);
    expect(String(captured.captured.options.emailRedirectTo)).toContain('email_confirmed=1');
    await gotoAuth(page);
    await page.click('#btnForgotPassword');
    await page.evaluate(() => {
      window.__capturedRecovery__ = null;
      window.supabaseRepo.supabase = {
        auth: {
          resetPasswordForEmail: async (email, options) => {
            window.__capturedRecovery__ = { email, redirectTo: options && options.redirectTo };
            return { error: null };
          },
        },
      };
    });
    await page.fill('#recoveryEmail', 'Regressao@Exemplo.com');
    await page.click('#btnSendRecoveryEmail');
    const recovery = await page.evaluate(() => window.__capturedRecovery__);
    expect(recovery.email).toBe('regressao@exemplo.com');
    expect(recovery.redirectTo).toBe('http://localhost:3000/reset-password.html');
  });
});
