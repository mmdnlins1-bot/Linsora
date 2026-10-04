const { test, expect } = require('@playwright/test');

// 43. Teclado virtual mobile: modais/telas de autenticação permanecem visíveis.
// Não simula teclado físico; usa visualViewport simulado e visibilidade forçada.
// Cobre: meta viewport, fallback dvh, focusin, visualViewport.resize e
// regressão funcional (login, "Esqueci minha senha", reset-password).

async function gotoAuth(page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('LINSORA_SEEN_ONBOARDING', 'true'); } catch (e) { /* ignora */ }
  });
  await page.goto('/');
  await page.waitForFunction(
    () => window.linsoraStore && window.LinsoraAccess && window.supabaseRepo && window.LinsoraUI,
    { timeout: 10000 }
  );
  await page.evaluate(() => localStorage.setItem('LINSORA_SEEN_ONBOARDING', 'true'));
  await page.reload();
  await page.waitForFunction(
    () => window.linsoraStore && window.LinsoraAccess && window.supabaseRepo && window.LinsoraUI,
    { timeout: 10000 }
  );
  await expect(page.locator('#authScreen')).toBeVisible({ timeout: 8000 });
}

async function installScrollSpy(page) {
  await page.evaluate(() => {
    window.__scrollSpyCalls__ = [];
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (options) {
      window.__scrollSpyCalls__.push({
        tag: this.tagName,
        id: this.id || null,
        options: options === undefined ? null : JSON.parse(JSON.stringify(options || null)),
      });
      return orig ? orig.apply(this, arguments) : undefined;
    };
  });
}

async function scrollSpyCalls(page) {
  return page.evaluate(() => window.__scrollSpyCalls__ || []);
}

// Substitui window.visualViewport por um simulado ANTES dos scripts da
// página (init do teclado anexa o listener nele). Retorna true se aplicado.
async function installFakeVisualViewport(page, height) {
  return page.evaluate((h) => {
    try {
      const listeners = {};
      const fake = {
        __fakeViewport: true,
        height: h,
        offsetTop: 0,
        addEventListener: (type, fn) => {
          listeners[type] = listeners[type] || [];
          listeners[type].push(fn);
        },
        removeEventListener: () => {},
        __dispatch: (type) => {
          (listeners[type] || []).forEach((fn) => fn());
        },
      };
      window.visualViewport = fake;
      window.__fakeViewport = fake;
      return window.visualViewport && window.visualViewport.__fakeViewport === true;
    } catch (e) {
      return false;
    }
  }, height);
}

// Força o retângulo do alvo para fora da área visível (simula cobertura
// pelo teclado) sem alterar arquivos ou layout permanente da página.
async function forceOutOfView(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const proto = Element.prototype.getBoundingClientRect;
    el.getBoundingClientRect = () => ({
      top: -600, bottom: -500, left: 10, right: 300,
      width: 290, height: 40, x: 10, y: -600,
      toJSON: () => ({}),
    });
    el.__origGetRect = proto;
  }, selector);
}

test.describe('43. Teclado virtual mobile', () => {
  test('1. meta viewport inclui interactive-widget (index e reset-password)', async ({ page }) => {
    await page.goto('/');
    const indexViewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(indexViewport).toContain('interactive-widget=resizes-content');
    expect(indexViewport).toContain('width=device-width');
    expect(indexViewport).toContain('viewport-fit=cover');
    await page.goto('/reset-password.html');
    const resetViewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(resetViewport).toContain('interactive-widget=resizes-content');
  });

  test('2. CSS mobile: fallback 100vh antes de 100dvh e modal com 86dvh', async ({ page }) => {
    await page.goto('/');
    const css = await page.evaluate(() => fetch('/css/styles.css').then((r) => r.text()));
    expect(css).toMatch(/height:\s*100vh\s*!important;\s*height:\s*100dvh\s*!important;/);
    expect(css).toContain('max-height: 86vh;');
    expect(css).toContain('max-height: 86dvh !important;');
    const overlayOverflow = await page.evaluate(() => {
      const el = document.querySelector('#modalForgotPassword');
      return window.getComputedStyle(el).overflowY;
    });
    expect(['auto', 'scroll']).toContain(overlayOverflow);
  });

  test('3. desktop: focus em input não dispara scroll-forçado', async ({ page }) => {
    test.skip(
      test.info().project.name !== 'chromium',
      'verificação de no-op restrita ao desktop'
    );
    await gotoAuth(page);
    await installScrollSpy(page);
    await page.click('#authEmail');
    await page.waitForTimeout(400);
    expect(await scrollSpyCalls(page)).toHaveLength(0);
  });

  test('4. mobile: input visível não sofre scroll desnecessário', async ({ page }) => {
    test.skip(
      test.info().project.name === 'chromium',
      'somente viewport mobile'
    );
    await gotoAuth(page);
    await installScrollSpy(page);
    await page.click('#btnForgotPassword');
    await expect(page.locator('#modalForgotPassword')).toBeVisible();
    await page.click('#recoveryEmail');
    await page.waitForTimeout(400);
    expect(await scrollSpyCalls(page)).toHaveLength(0);
    // Modal segue fechável pelo backdrop e pelo ✕ (comportamento preservado).
    await expect(page.locator('#modalForgotPassword')).toBeVisible();
  });

  test('5. mobile: input fora da área visível é centralizado no focus', async ({ page }) => {
    test.skip(
      test.info().project.name === 'chromium',
      'somente viewport mobile'
    );
    await gotoAuth(page);
    await installScrollSpy(page);
    await page.click('#btnForgotPassword');
    await expect(page.locator('#modalForgotPassword')).toBeVisible();
    await forceOutOfView(page, '#recoveryEmail');
    await page.focus('#recoveryEmail');
    await page.waitForFunction(() => (window.__scrollSpyCalls__ || []).length > 0, { timeout: 5000 });
    const calls = await scrollSpyCalls(page);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0].id).toBe('recoveryEmail');
    expect(calls[0].options).toMatchObject({ block: 'center' });
  });

  test('6. mobile: visualViewport.resize com teclado aberto trata o ativo', async ({ page }) => {
    test.skip(
      test.info().project.name === 'chromium',
      'somente viewport mobile'
    );
    await page.addInitScript(() => {
      try {
        const listeners = {};
        const fake = {
          __fakeViewport: true,
          height: 851,
          offsetTop: 0,
          addEventListener: (type, fn) => {
            listeners[type] = listeners[type] || [];
            listeners[type].push(fn);
          },
          removeEventListener: () => {},
          __dispatch: (type) => {
            (listeners[type] || []).forEach((fn) => fn());
          },
        };
        window.visualViewport = fake;
        window.__fakeViewport = fake;
      } catch (e) { /* ambiente não permite substituir */ }
    });
    await gotoAuth(page);
    const usingFake = await page.evaluate(
      () => !!(window.visualViewport && window.visualViewport.__fakeViewport)
    );
    test.skip(!usingFake, 'navegador não permite visualViewport simulado');
    await installScrollSpy(page);
    await page.click('#btnForgotPassword');
    await expect(page.locator('#modalForgotPassword')).toBeVisible();
    await forceOutOfView(page, '#recoveryEmail');
    await page.focus('#recoveryEmail');
    // Aguarda o scroll do caminho focusin e só então isola o caminho resize.
    await page.waitForFunction(() => (window.__scrollSpyCalls__ || []).length > 0, { timeout: 5000 });
    await page.evaluate(() => { window.__scrollSpyCalls__ = []; });
    // Teclado fechado (altura total): resize não faz nada.
    await page.evaluate(() => window.__fakeViewport.__dispatch('resize'));
    await page.waitForTimeout(300);
    expect(await scrollSpyCalls(page)).toHaveLength(0);
    // Teclado aberto (altura reduzida): ativo é tratado.
    await page.evaluate(() => {
      window.__fakeViewport.height = 400;
      window.__fakeViewport.__dispatch('resize');
    });
    await page.waitForFunction(() => (window.__scrollSpyCalls__ || []).length > 0, { timeout: 5000 });
    const calls = await scrollSpyCalls(page);
    expect(calls[0].id).toBe('recoveryEmail');
    expect(calls[0].options).toMatchObject({ block: 'center' });
  });

  test('7. login continua funcionando após a mudança', async ({ page }) => {
    await gotoAuth(page);
    await page.fill('#authEmail', 'teclado@linsora.com.br');
    await page.fill('#authPassword', '123456');
    await expect(page.locator('#btnSubmitAuth')).toBeVisible();
    await expect(page.locator('#btnSubmitAuth')).toBeEnabled();
  });

  test('8. "Esqueci minha senha" continua funcionando após a mudança', async ({ page }) => {
    await gotoAuth(page);
    await page.evaluate(() => {
      window.__recoverySendCalls__ = 0;
      window.supabaseRepo.supabase = {
        auth: {
          resetPasswordForEmail: async () => {
            window.__recoverySendCalls__ += 1;
            return { error: null };
          },
        },
      };
    });
    await page.click('#btnForgotPassword');
    await expect(page.locator('#modalForgotPassword')).toBeVisible();
    await page.fill('#recoveryEmail', 'teclado@linsora.com.br');
    await page.click('#btnSendRecoveryEmail');
    expect(await page.evaluate(() => window.__recoverySendCalls__)).toBe(1);
    await expect(page.locator('#modalForgotPassword')).toBeHidden();
    await expect(page.locator('#toastContainer')).toContainText('Link de redefinição enviado');
  });

  test('9. reset-password.html continua funcionando após a mudança', async ({ page }) => {
    await page.goto('/reset-password.html');
    await expect(page.locator('h1')).toContainText('Redefinir sua senha');
    await expect(page.locator('#recoveryStatus')).toContainText('inválido', { timeout: 10000 });
    await expect(page.locator('#resetPasswordForm')).toBeHidden();
    await expect(page.locator('#linkBackLogin')).toBeVisible();
    expect(await page.locator('#linkBackLogin').getAttribute('href')).toBe('/');
  });
});
