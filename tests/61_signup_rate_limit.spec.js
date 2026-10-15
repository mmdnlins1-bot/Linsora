const { test, expect } = require('@playwright/test');

// 61. Rate limit do Supabase Auth no cadastro/reenvio exibido em português.
// Somente mocks/stubs: nenhum usuário real, nenhum e-mail real, nenhum segredo.

const RATE_LIMIT_EN = 'For security purposes, you can only request this after 44 seconds.';

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

test.describe('61. Rate limit do Supabase Auth em português', () => {
  test('1. mapAuthErrorMessage traduz o erro de frequência (com segundos)', async ({ page }) => {
    await gotoAuth(page);
    const res = await page.evaluate((msg) => {
      const repo = window.supabaseRepo;
      return {
        pt: repo.mapAuthErrorMessage(msg),
        isRate: repo.isAuthRateLimitError(msg),
        wait: repo.getAuthRateLimitWaitSeconds(msg),
      };
    }, RATE_LIMIT_EN);
    expect(res.isRate).toBe(true);
    expect(res.wait).toBe(44);
    expect(res.pt).toContain('Por segurança');
    expect(res.pt).toContain('44 segundos');
    expect(res.pt).not.toContain('For security purposes');
  });

  test('2. erro de frequência sem segundos usa mensagem genérica em português', async ({ page }) => {
    await gotoAuth(page);
    const res = await page.evaluate(() => {
      const repo = window.supabaseRepo;
      const variants = [
        { message: 'over_email_send_rate_limit' },
        { message: 'Email rate limit exceeded', status: 429 },
        'For security purposes, you can only request this after X seconds.',
      ];
      return variants.map((v) => ({
        isRate: repo.isAuthRateLimitError(v),
        wait: repo.getAuthRateLimitWaitSeconds(v),
        pt: repo.mapAuthErrorMessage(v),
      }));
    });
    for (const r of res) {
      expect(r.isRate).toBe(true);
      expect(r.pt).toContain('Por segurança');
      expect(r.pt).toContain('aguarde alguns instantes');
      expect(r.pt).not.toContain('For security purposes');
      expect(r.pt).not.toContain('over_email_send_rate_limit');
    }
    expect(res[0].wait).toBe(0);
  });

  test('3. outras mensagens de auth preservadas (sem regressão)', async ({ page }) => {
    await gotoAuth(page);
    const res = await page.evaluate(() => {
      const repo = window.supabaseRepo;
      return {
        invalid: repo.mapAuthErrorMessage('Invalid login credentials'),
        exists: repo.mapAuthErrorMessage('User already registered'),
        weak: repo.mapAuthErrorMessage('Password should be at least 6 characters'),
        unconfirmed: repo.mapAuthErrorMessage('Email not confirmed'),
        unknown: repo.mapAuthErrorMessage('Some unexpected provider message'),
        empty: repo.mapAuthErrorMessage(''),
      };
    });
    expect(res.invalid).toContain('incorretos');
    expect(res.exists).toContain('já está cadastrado');
    expect(res.weak).toContain('mínimo 6 caracteres');
    expect(res.unconfirmed).toContain('não foi confirmado');
    expect(res.unknown).toBe('Some unexpected provider message');
    expect(res.empty).toBe('Ocorreu um erro na autenticação.');
  });

  test('4. cadastro com rate limit mostra toast em português (sem texto em inglês)', async ({ page }) => {
    await gotoFunnel(page);
    await page.evaluate((msg) => {
      window.supabaseRepo.supabase = {
        auth: {
          signUp: async () => ({ data: null, error: { message: msg } }),
        },
      };
      try { localStorage.removeItem('LINSORA_ACTIVE_LOCAL_SESSION'); } catch (e) {}
    }, RATE_LIMIT_EN);
    await page.fill('#authName', 'Usuario Limite');
    await page.fill('#authEmail', 'limite@exemplo.com');
    await page.fill('#authPassword', 'senhaFicticia123');
    await page.fill('#authConfirmPassword', 'senhaFicticia123');
    await page.click('#btnSubmitAuth');
    const toast = page.locator('#toastContainer');
    await expect(toast).toContainText('Por segurança', { timeout: 5000 });
    await expect(toast).toContainText('e-mail de confirmação');
    await expect(toast).not.toContainText('For security purposes');
    await expect(toast).not.toContainText('only request this after');
  });

  test('5. erro de frequência não é apresentado como envio bem-sucedido', async ({ page }) => {
    await gotoFunnel(page);
    await page.evaluate((msg) => {
      window.supabaseRepo.supabase = {
        auth: {
          signUp: async () => ({ data: null, error: { message: msg } }),
        },
      };
      try { localStorage.removeItem('LINSORA_ACTIVE_LOCAL_SESSION'); } catch (e) {}
    }, RATE_LIMIT_EN);
    await page.fill('#authName', 'Usuario Erro');
    await page.fill('#authEmail', 'erro@exemplo.com');
    await page.fill('#authPassword', 'senhaFicticia123');
    await page.fill('#authConfirmPassword', 'senhaFicticia123');
    await page.click('#btnSubmitAuth');
    await expect(page.locator('#toastContainer')).toContainText('Por segurança', { timeout: 5000 });
    await expect(page.locator('#toastContainer')).not.toContainText('Conta criada');
    await expect(page.locator('#confirmationPending')).toBeHidden();
    await expect(page.locator('#appMain')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('LINSORA_ACTIVE_LOCAL_SESSION'))).toBeNull();
  });

  test('6. mensagem de sucesso do cadastro continua correta quando aceito', async ({ page }) => {
    await gotoFunnel(page);
    await page.evaluate(() => {
      window.supabaseRepo.supabase = {
        auth: {
          signUp: async () => ({ data: { user: { id: 'user-sucesso-61' }, session: null }, error: null }),
        },
      };
      try { localStorage.removeItem('LINSORA_ACTIVE_LOCAL_SESSION'); } catch (e) {}
    });
    await page.fill('#authName', 'Usuario Sucesso');
    await page.fill('#authEmail', 'sucesso@exemplo.com');
    await page.fill('#authPassword', 'senhaFicticia123');
    await page.fill('#authConfirmPassword', 'senhaFicticia123');
    await page.click('#btnSubmitAuth');
    await expect(page.locator('#confirmationPending')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#confirmationPendingText')).toContainText('Conta criada! Enviamos um e-mail de confirmação');
    await expect(page.locator('#toastContainer')).toContainText('Conta criada! Enviamos um e-mail de confirmação');
    await expect(page.locator('#appMain')).toBeHidden();
  });

  test('7. cadastro dispara uma única chamada (sem envio adicional)', async ({ page }) => {
    await gotoFunnel(page);
    await page.evaluate(() => {
      window.__calls61__ = { signUp: 0, resend: 0 };
      window.__releaseSignUp61__ = null;
      window.supabaseRepo.supabase = {
        auth: {
          signUp: (...a) => {
            window.__calls61__.signUp += 1;
            return new Promise((resolve) => {
              window.__releaseSignUp61__ = () => resolve({ data: { user: { id: 'u-61-7' }, session: null }, error: null });
            });
          },
          resend: async () => {
            window.__calls61__.resend += 1;
            return { data: {}, error: null };
          },
        },
      };
      try { localStorage.removeItem('LINSORA_ACTIVE_LOCAL_SESSION'); } catch (e) {}
    });
    await page.fill('#authName', 'Usuario Unico');
    await page.fill('#authEmail', 'unico@exemplo.com');
    await page.fill('#authPassword', 'senhaFicticia123');
    await page.fill('#authConfirmPassword', 'senhaFicticia123');
    // Dois envios sincronizados: o segundo deve ser ignorado pela guarda.
    await page.evaluate(() => {
      const form = document.getElementById('authForm');
      form.requestSubmit();
      form.requestSubmit();
    });
    await page.waitForTimeout(300);
    const mid = await page.evaluate(() => ({
      calls: window.__calls61__,
      submitDisabled: document.getElementById('btnSubmitAuth').disabled,
      inFlight: window.__isAuthSubmitInFlight__ ? window.__isAuthSubmitInFlight__() : null,
    }));
    expect(mid.calls.signUp).toBe(1);
    expect(mid.calls.resend).toBe(0);
    expect(mid.submitDisabled).toBe(true);
    expect(mid.inFlight).toBe(true);
    await page.evaluate(() => window.__releaseSignUp61__ && window.__releaseSignUp61__());
    await expect(page.locator('#confirmationPending')).toBeVisible({ timeout: 5000 });
    const after = await page.evaluate(() => ({
      calls: window.__calls61__,
      submitDisabled: document.getElementById('btnSubmitAuth').disabled,
    }));
    expect(after.calls.signUp).toBe(1);
    expect(after.calls.resend).toBe(0);
    expect(after.submitDisabled).toBe(false);
  });

  test('8. reenvio impede cliques duplicados durante a solicitação', async ({ page }) => {
    await gotoAuth(page);
    await page.evaluate(() => {
      window.__resendCalls61__ = 0;
      window.__releaseResend61__ = null;
      window.supabaseRepo.supabase = {
        auth: {
          resend: async () => {
            window.__resendCalls61__ += 1;
            return new Promise((resolve) => {
              window.__releaseResend61__ = () => resolve({ data: {}, error: null });
            });
          },
        },
      };
    });
    await page.fill('#authEmail', 'reenviolimite@exemplo.com');
    await page.evaluate(() => {
      const btn = document.getElementById('btnResendConfirmation');
      btn.click();
      // Segundo clique via dispatch (ignora o estado disabled do botão):
      // a guarda do handler deve descartá-lo.
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.waitForTimeout(300);
    const mid = await page.evaluate(() => ({
      calls: window.__resendCalls61__,
      disabled: document.getElementById('btnResendConfirmation').disabled,
    }));
    expect(mid.calls).toBe(1);
    expect(mid.disabled).toBe(true);
    await page.evaluate(() => window.__releaseResend61__ && window.__releaseResend61__());
    await expect(page.locator('#toastContainer')).toContainText('reenviado', { timeout: 5000 });
    expect(await page.evaluate(() => window.__resendCalls61__)).toBe(1);
  });

  test('9. reenvio com rate limit mostra PT e aplica espera visível no botão', async ({ page }) => {
    await gotoAuth(page);
    await page.evaluate(() => {
      window.supabaseRepo.supabase = {
        auth: {
          resend: async () => ({
            data: null,
            error: { message: 'For security purposes, you can only request this after 3 seconds.' },
          }),
        },
      };
    });
    await page.fill('#authEmail', 'espera@exemplo.com');
    // O botão de reenvio fica dentro de #confirmationPending (oculta no
    // login): aciona via DOM, como o fluxo real após um cadastro aceito.
    await page.evaluate(() => document.getElementById('btnResendConfirmation').click());
    const toast = page.locator('#toastContainer');
    await expect(toast).toContainText('Por segurança', { timeout: 5000 });
    await expect(toast).toContainText('3 segundos');
    await expect(toast).not.toContainText('For security purposes');
    const btn = page.locator('#btnResendConfirmation');
    await expect(btn).toBeDisabled();
    await expect(btn).toContainText('Aguarde');
  });

  test('11. cooldown acima de 120s bloqueia pelo prazo real (sem liberação prematura)', async ({ page }) => {
    await gotoAuth(page);
    await page.evaluate(() => {
      window.__resendCalls61b__ = 0;
      window.supabaseRepo.supabase = {
        auth: {
          resend: async () => {
            window.__resendCalls61b__ += 1;
            return {
              data: null,
              error: { message: 'For security purposes, you can only request this after 180 seconds.' },
            };
          },
        },
      };
    });
    await page.fill('#authEmail', 'esperalonga@exemplo.com');
    await page.evaluate(() => document.getElementById('btnResendConfirmation').click());
    const toast = page.locator('#toastContainer');
    await expect(toast).toContainText('Por segurança', { timeout: 5000 });
    await expect(toast).toContainText('180 segundos');
    await expect(toast).not.toContainText('For security purposes');
    const btn = page.locator('#btnResendConfirmation');
    await expect(btn).toBeDisabled();
    await expect(btn).toContainText('Aguarde');
    // O horizonte de bloqueio respeita o prazo real (> 120s), sem teto visual.
    const remaining = await page.evaluate(() => window.__getResendCooldownRemaining__());
    expect(remaining).toBeGreaterThan(120);
    expect(remaining).toBeLessThanOrEqual(180);
    // Nova tentativa durante o cooldown: nenhuma chamada adicional de resend.
    await page.evaluate(() => {
      document.getElementById('btnResendConfirmation').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__resendCalls61b__)).toBe(1);
    await expect(btn).toBeDisabled();
  });

  test('10. validações e outros erros continuam funcionando', async ({ page }) => {
    await gotoFunnel(page);
    // Senhas diferentes (validação local).
    await page.fill('#authName', 'Usuario Val');
    await page.fill('#authEmail', 'val@exemplo.com');
    await page.fill('#authPassword', 'senhaFicticia123');
    await page.fill('#authConfirmPassword', 'outraSenha456');
    await page.click('#btnSubmitAuth');
    await expect(page.locator('#toastContainer')).toContainText('senhas não coincidem', { timeout: 5000 });
    // Credenciais inválidas no login (mapeamento preservado).
    await gotoAuth(page);
    await page.evaluate(() => {
      window.supabaseRepo.supabase = {
        auth: {
          signInWithPassword: async () => ({ data: null, error: { message: 'Invalid login credentials' } }),
        },
      };
    });
    await page.fill('#authEmail', 'alguem@exemplo.com');
    await page.fill('#authPassword', 'errada123');
    await page.click('#btnSubmitAuth');
    await expect(page.locator('#toastContainer')).toContainText('incorretos', { timeout: 5000 });
    await expect(page.locator('#appMain')).toBeHidden();
  });
});
