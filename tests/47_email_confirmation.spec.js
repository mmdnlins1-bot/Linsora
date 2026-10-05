const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// 47. Confirmação de e-mail obrigatória + onboarding de cadastro.
// Somente mocks/stubs: nenhum usuário real, nenhum e-mail real, nenhum segredo.

function repoRoot() {
  return path.resolve(__dirname, '..');
}

function readSource(rel) {
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8');
}

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

async function gotoKnownUser(page) {
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

test.describe('47. Confirmação de e-mail + onboarding de cadastro', () => {
  test('1. /?vamos-comecar=1 abre CADASTRO (não login)', async ({ page }) => {
    await gotoFunnel(page);
    await expect(page.locator('#authTitle')).toHaveText('Crie sua conta');
    await expect(page.locator('#authSubtitle')).toHaveText('Comece seu teste gratuito de 24 horas.');
    await expect(page.locator('#btnSubmitAuth')).toHaveText('Criar minha conta');
    await expect(page.locator('#toggleText')).toHaveText('Já tenho uma conta.');
    await expect(page.locator('#btnToggleAuthMode')).toHaveText('Entrar');
    expect(page.url()).not.toContain('vamos-comecar');
  });

  test('2. cadastro mostra Nome + Confirmar senha', async ({ page }) => {
    await gotoFunnel(page);
    await expect(page.locator('#nameGroup')).toBeVisible();
    await expect(page.locator('#confirmPasswordGroup')).toBeVisible();
    await expect(page.locator('#authName')).toBeVisible();
    await expect(page.locator('#authConfirmPassword')).toBeVisible();
  });

  test('3. alternância cadastro <-> login preservada', async ({ page }) => {
    await gotoFunnel(page);
    await page.click('#btnToggleAuthMode');
    await expect(page.locator('#authTitle')).toHaveText('Entrar na sua conta');
    await expect(page.locator('#btnSubmitAuth')).toHaveText('Entrar');
    await expect(page.locator('#toggleText')).toHaveText('Não tenho uma conta.');
    await expect(page.locator('#btnToggleAuthMode')).toHaveText('Criar conta');
    await expect(page.locator('#nameGroup')).toBeHidden();
    await page.click('#btnToggleAuthMode');
    await expect(page.locator('#authTitle')).toHaveText('Crie sua conta');
    await expect(page.locator('#nameGroup')).toBeVisible();
  });

  test('4. signUp sem session retorna needsConfirmation (Supabase Auth é a autoridade)', async ({ page }) => {
    await gotoKnownUser(page);
    const res = await page.evaluate(async () => {
      window.supabaseRepo.supabase = {
        auth: {
          signUp: async () => ({ data: { user: { id: 'user-ficticio-1' }, session: null }, error: null }),
        },
      };
      return window.supabaseRepo.signUpWithEmail('Nome Ficticio', 'nao.confirmado@exemplo.com', 'senhaFicticia123');
    });
    expect(res.success).toBe(true);
    expect(res.needsConfirmation).toBe(true);
    expect(res.user).toBeNull();
  });

  test('5. cadastro sem session NÃO entra no app, NÃO cria sessão local e NÃO executa o gate', async ({ page }) => {
    await gotoFunnel(page);
    await page.evaluate(() => {
      window.__gateCalls__ = 0;
      const repo = window.supabaseRepo;
      const origGate = repo.checkSubscriptionAccess.bind(repo);
      repo.checkSubscriptionAccess = async (...a) => {
        window.__gateCalls__ += 1;
        return origGate(...a);
      };
      repo.supabase = {
        auth: {
          signUp: async () => ({ data: { user: { id: 'user-ficticio-2' }, session: null }, error: null }),
        },
      };
      try { localStorage.removeItem('LINSORA_ACTIVE_LOCAL_SESSION'); } catch (e) {}
    });
    await page.fill('#authName', 'Usuario Pendente');
    await page.fill('#authEmail', 'pendente@exemplo.com');
    await page.fill('#authPassword', 'senhaFicticia123');
    await page.fill('#authConfirmPassword', 'senhaFicticia123');
    await page.click('#btnSubmitAuth');
    await expect(page.locator('#confirmationPending')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#confirmationPending')).toContainText('e-mail de confirmação');
    await expect(page.locator('#toastContainer')).toContainText('e-mail de confirmação');
    await expect(page.locator('#appMain')).toBeHidden();
    await expect(page.locator('#authScreen')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('LINSORA_ACTIVE_LOCAL_SESSION'))).toBeNull();
    expect(await page.evaluate(() => window.__gateCalls__ || 0)).toBe(0);
    expect(await page.evaluate(() => window.supabaseRepo.currentUserId)).not.toBe('user-ficticio-2');
  });

  test('6. signUp envia emailRedirectTo com marcador email_confirmed=1', async ({ page }) => {
    await gotoKnownUser(page);
    const captured = await page.evaluate(async () => {
      window.__capturedSignUp__ = null;
      window.supabaseRepo.supabase = {
        auth: {
          signUp: async (args) => {
            window.__capturedSignUp__ = args;
            return { data: { user: { id: 'u' }, session: null }, error: null };
          },
        },
      };
      await window.supabaseRepo.signUpWithEmail('Nome', 'cap@exemplo.com', 'senha123456');
      return window.__capturedSignUp__;
    });
    expect(captured.options.emailRedirectTo).toContain('email_confirmed=1');
    expect(captured.options.data.full_name).toBe('Nome');
  });

  test('7. login de usuário não confirmado recebe mensagem adequada + reenvio', async ({ page }) => {
    await gotoKnownUser(page);
    await page.evaluate(() => {
      window.supabaseRepo.supabase = {
        auth: {
          signInWithPassword: async () => ({ data: null, error: { message: 'Email not confirmed' } }),
          resend: async () => ({ data: {}, error: null }),
        },
      };
    });
    await page.fill('#authEmail', 'naoconfirmado@exemplo.com');
    await page.fill('#authPassword', 'senhaFicticia123');
    await page.click('#btnSubmitAuth');
    await expect(page.locator('#toastContainer')).toContainText('ainda não foi confirmado');
    await expect(page.locator('#confirmationPending')).toBeVisible();
    await expect(page.locator('#appMain')).toBeHidden();
    // Reenvio usa a API oficial (resend signup).
    await page.fill('#authEmail', 'naoconfirmado@exemplo.com');
    await page.click('#btnResendConfirmation');
    await expect(page.locator('#toastContainer')).toContainText('reenviado');
  });

  test('8. usuário confirmado consegue entrar (login normal preservado)', async ({ page }) => {
    await gotoKnownUser(page);
    await page.evaluate(() => {
      window.supabaseRepo.signInWithEmail = async () => ({
        success: true,
        user: { id: 'uid-ficticio-8', name: 'Confirmado', email: 'confirmado@exemplo.com' },
      });
      window.supabaseRepo.checkSubscriptionAccess = async () => ({ state: 'granted' });
      window.linsoraStore.loadUserData = async (u) => {
        window.linsoraStore.state.user = { id: u.id, name: u.name, email: u.email };
      };
    });
    await page.fill('#authEmail', 'confirmado@exemplo.com');
    await page.fill('#authPassword', 'senhaFicticia123');
    await page.click('#btnSubmitAuth');
    await expect(page.locator('#appMain')).toBeVisible({ timeout: 8000 });
  });

  test('9. senha incorreta continua rejeitada', async ({ page }) => {
    await gotoKnownUser(page);
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
    await expect(page.locator('#toastContainer')).toContainText('incorretos');
    await expect(page.locator('#appMain')).toBeHidden();
  });

  test('10. confirmação não reinicia trial (trigger/RPC intactos)', async ({ page }) => {
    const migration = readSource('supabase_migration_trial_24h.sql');
    expect(migration).toContain('handle_new_trial');
    expect(migration).toContain('get_trial_status');
    expect(migration).toContain('COALESCE(public.subscriptions.trial_started_at');
    await gotoKnownUser(page);
    const hasRpc = await page.evaluate(() => typeof window.supabaseRepo.checkTrialAccess === 'function');
    expect(hasRpc).toBe(true);
    const gateFn = await page.evaluate(() => window.supabaseRepo.checkSubscriptionAccess.toString());
    expect(gateFn).toContain('checkTrialAccess');
  });

  test('11. logout volta ao login (não fica preso em cadastro)', async ({ page }) => {
    await gotoKnownUser(page);
    await page.evaluate(() => {
      window.supabaseRepo.signInWithEmail = async () => ({
        success: true,
        user: { id: 'uid-ficticio-11', name: 'Sessao', email: 'sessao@exemplo.com' },
      });
      window.supabaseRepo.checkSubscriptionAccess = async () => ({ state: 'granted' });
      window.linsoraStore.loadUserData = async (u) => {
        window.linsoraStore.state.user = { id: u.id, name: u.name, email: u.email };
      };
    });
    await page.fill('#authEmail', 'sessao@exemplo.com');
    await page.fill('#authPassword', 'senhaFicticia123');
    await page.click('#btnSubmitAuth');
    await expect(page.locator('#appMain')).toBeVisible({ timeout: 8000 });
    await page.click('.bottom-nav .nav-item[data-tab="tabProfile"]');
    await page.evaluate(() => document.getElementById('btnLogout')?.click());
    await expect(page.locator('#authScreen')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#authTitle')).toHaveText('Entrar na sua conta');
  });

  test('12. nenhum segredo no frontend', async ({ page }) => {
    // Comentários de guarda ("NUNCA service_role no frontend") são
    // documentação permitida; o proibido é USO: chave JWT embutida,
    // variável de segredo com valor, ou referência de leitura da chave.
    for (const rel of ['index.html', 'js/app.js', 'js/supabase-client.js', 'js/landing.js']) {
      const src = readSource(rel);
      const codeLines = src.split('\n').filter((line) => {
        const t = line.trim();
        if (/^<!--/.test(t) || /^\*/.test(t) || /^\/\//.test(t)) return false;
        if (/NUNCA|Somente URL pública/i.test(line)) return false;
        return true;
      });
      const code = codeLines.join('\n');
      expect(code).not.toMatch(/service_role/i);
      expect(code).not.toMatch(/SUPABASE_SERVICE_ROLE/);
      expect(code).not.toMatch(/RESEND_API_KEY/);
      expect(code).not.toMatch(/eyJhbGciOi/);
    }
    const client = readSource('js/supabase-client.js');
    expect(client).not.toMatch(/smtp.*pass|api[_-]?key\s*[:=]\s*['"]re_/i);
  });

  test('13. sem bypass: data.user sozinho não concede acesso', async ({ page }) => {
    const client = readSource('js/supabase-client.js');
    // O caminho do signUp exige session; sem session retorna needsConfirmation.
    expect(client).toContain('needsConfirmation');
    expect(client).toContain('!data.session');
    // Após signUp, saveActiveLocalSession só ocorre no ramo COM session.
    const signUpBlock = client.slice(client.indexOf('async signUpWithEmail'));
    const needsIdx = signUpBlock.indexOf('needsConfirmation');
    const saveIdx = signUpBlock.indexOf('saveActiveLocalSession');
    expect(needsIdx).toBeGreaterThan(-1);
    expect(saveIdx).toBeGreaterThan(needsIdx);
    // RLS/multitenancy intocados: nenhuma policy nova no frontend.
    expect(client).not.toMatch(/CREATE\s+POLICY/i);
  });

  test('14. isolamento entre usuários preservado (cache só do próprio id)', async ({ page }) => {
    await gotoKnownUser(page);
    const ok = await page.evaluate(() => {
      const idA = 'uid-A-ficticio';
      const idB = 'uid-B-ficticio';
      try {
        localStorage.setItem('LINSORA_DB_CACHE_' + idA, JSON.stringify({ user: { id: idA } }));
        localStorage.setItem('LINSORA_DB_CACHE_' + idB, JSON.stringify({ user: { id: idB } }));
      } catch (e) { return false; }
      const removed = window.supabaseRepo.removeUserFinancialCache(idA);
      let otherKept = false;
      try { otherKept = localStorage.getItem('LINSORA_DB_CACHE_' + idB) !== null; } catch (e) {}
      try { localStorage.removeItem('LINSORA_DB_CACHE_' + idA); } catch (e) {}
      try { localStorage.removeItem('LINSORA_DB_CACHE_' + idB); } catch (e) {}
      return removed === true && otherKept === true;
    });
    expect(ok).toBe(true);
  });

  test('15. boas-vindas: endpoint server-side sem segredo e sem envio fictício', async () => {
    const api = readSource('api/send-welcome.js');
    expect(api).toContain('email_confirmed_at');
    expect(api).toContain('linsora-welcome-');
    expect(api).toContain('welcome-provider-unconfigured');
    expect(api).not.toMatch(/sk-[A-Za-z0-9]|re_[A-Za-z0-9]{10,}|BEGIN PRIVATE KEY/);
    const client = readSource('js/supabase-client.js') + readSource('js/app.js');
    expect(client).not.toContain('/api/send-welcome');
  });
});
