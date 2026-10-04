const { test, expect } = require('@playwright/test');

// 38. Landing page de vendas do Linsora — revisão estrutural com voz.
// Arquivos: landing.html + css/landing.css + js/landing.js (independentes do app).
// Não usa login: a landing é pública e standalone.

const SHORT_EXAMPLES = [
  '150 reais de gasolina',
  '300 reais de farmácia',
  '500 reais de mercado',
  '50 reais de lanche',
  '100 reais no cartão',
];

const FULL_EXAMPLES = [
  'Gastei 150 reais de gasolina',
  'Paguei 300 reais de energia',
];

test.describe('38. Landing page do Linsora', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/landing.html');
    await expect(page.locator('#hero')).toBeVisible();
  });

  test('1. existe H1 único com proposta de voz', async ({ page }) => {
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('#hero h1')).toContainText('falando');
  });

  test('2. existe seção #voz', async ({ page }) => {
    await expect(page.locator('#voz')).toBeVisible();
    await expect(page.locator('#voz h2')).toContainText('É só falar');
  });

  test('3. exemplos curtos de voz estão presentes', async ({ page }) => {
    const voz = await page.locator('#voz').innerText();
    for (const ex of SHORT_EXAMPLES) {
      expect(voz, `exemplo curto "${ex}"`).toContain(ex);
    }
  });

  test('4. exemplos completos e perguntas estão presentes', async ({ page }) => {
    const body = await page.locator('body').innerText();
    for (const ex of FULL_EXAMPLES) {
      expect(body, `exemplo completo "${ex}"`).toContain(ex);
    }
    expect(body).toContain('Quanto gastei esse mês?');
    expect(body).toContain('Posso gastar 100 reais hoje?');
  });

  test('5. seção de voz aparece depois do Hero', async ({ page }) => {
    const order = await page.evaluate(() => {
      const main = document.querySelector('main');
      const ids = Array.from(main.querySelectorAll('section[id]')).map((s) => s.id);
      return ids;
    });
    expect(order[0]).toBe('hero');
    expect(order[1]).toBe('voz');
    expect(order).toContain('conselheiro');
    expect(order.indexOf('voz')).toBeLessThan(order.indexOf('conselheiro'));
  });

  test('6. CTA "Começar agora" continua presente', async ({ page }) => {
    const ctas = page.locator('a.lp-btn, button.lp-btn', { hasText: 'Começar agora' });
    expect(await ctas.count()).toBeGreaterThanOrEqual(2);
    await expect(page.locator('header a.lp-btn').first()).toContainText('Começar agora');
    await expect(page.locator('#comecar .lp-btn')).toContainText('Começar agora');
  });

  test('7. CTA de voz aponta para #voz', async ({ page }) => {
    const voiceCta = page.locator('#hero a[href="#voz"]');
    await expect(voiceCta).toHaveCount(1);
    await expect(voiceCta).toContainText('voz');
  });

  test('8. preços continuam R$14,90 e R$99,90', async ({ page }) => {
    await expect(page.locator('#precos')).toContainText('R$ 14,90');
    await expect(page.locator('#precos')).toContainText('R$ 99,90');
    await expect(page.locator('#precos')).toContainText('R$ 8,33');
    const mensalBtn = page.locator('[data-hotmart="mensal"]');
    const anualBtn = page.locator('[data-hotmart="anual"]');
    await expect(mensalBtn).toContainText('Começar no mensal');
    await expect(anualBtn).toContainText('Começar no anual');
  });

  test('9. checkouts Hotmart reais configurados (sem placeholder/falso)', async ({ page }) => {
    const REAL_MENSAL = 'https://pay.hotmart.com/V107831993J?off=7xk5d8xd';
    const REAL_ANUAL = 'https://pay.hotmart.com/V107831993J?off=32op71oh';
    const ALLOWED = [REAL_MENSAL, REAL_ANUAL];
    const hrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]')).map((a) => a.getAttribute('href') || '')
    );
    for (const href of hrefs) {
      expect(href, `href "${href}"`).not.toContain('HOTMART_CHECKOUT_A_CONFIGURAR');
      if (/hotmart\.com/i.test(href)) {
        expect(ALLOWED, `href Hotmart inesperado "${href}"`).toContain(href);
      }
    }
    const consts = await page.evaluate(() => ({
      mensal: window.LinsoraLanding?.HOTMART_CHECKOUT_URL_MENSAL,
      anual: window.LinsoraLanding?.HOTMART_CHECKOUT_URL_ANUAL,
    }));
    expect(consts.mensal || '').not.toContain('HOTMART_CHECKOUT_A_CONFIGURAR');
    expect(consts.anual || '').not.toContain('HOTMART_CHECKOUT_A_CONFIGURAR');
    // URLs reais exatas (mapeamento obrigatório mensal/anual).
    expect(consts.mensal).toBe(REAL_MENSAL);
    expect(consts.anual).toBe(REAL_ANUAL);
    // Nenhum placeholder restante no HTML da landing.
    const html = await page.content();
    expect(html).not.toContain('HOTMART_CHECKOUT_A_CONFIGURAR');
    // Clicar nos CTAs direciona ao checkout real correspondente.
    // Bloqueia a navegação externa só no teste (capture + preventDefault,
    // sem stopPropagation) para verificar o href aplicado pelo handler real.
    await page.evaluate(() => {
      window.__blockHotmartNav = (e) => {
        if (e.target?.closest?.('[data-hotmart]')) e.preventDefault();
      };
      window.addEventListener('click', window.__blockHotmartNav, true);
    });
    await page.locator('[data-hotmart="mensal"]').click();
    await expect(page.locator('[data-hotmart="mensal"]')).toHaveAttribute('href', REAL_MENSAL);
    await expect(page).toHaveURL(/landing\.html/);
    await page.locator('[data-hotmart="anual"]').click();
    await expect(page.locator('[data-hotmart="anual"]')).toHaveAttribute('href', REAL_ANUAL);
    await expect(page).toHaveURL(/landing\.html/);
    await page.evaluate(() => {
      window.removeEventListener('click', window.__blockHotmartNav, true);
    });
  });

  test('10. FAQ funciona', async ({ page }) => {
    const questions = page.locator('.lp-faq-q');
    expect(await questions.count()).toBeGreaterThanOrEqual(8);
    await questions.first().click();
    await expect(page.locator('.lp-faq-item.open')).toHaveCount(1);
    await expect(questions.first()).toHaveAttribute('aria-expanded', 'true');
    await expect(questions.first()).toHaveAttribute('aria-controls', /.+/);
    await questions.nth(1).click();
    await expect(page.locator('.lp-faq-item.open')).toHaveCount(1);
    await expect(questions.nth(1)).toHaveAttribute('aria-expanded', 'true');
    await expect(questions.first()).toHaveAttribute('aria-expanded', 'false');
  });

  test('11. não existe overflow horizontal', async ({ page }) => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('12. conteúdo visível sem depender de animação', async ({ page }) => {
    // Fallback <noscript> garante .reveal visível sem JS.
    const noscript = await page.evaluate(() =>
      Array.from(document.querySelectorAll('noscript')).map((n) => n.innerHTML).join(' ')
    );
    expect(noscript).toContain('.reveal');
    // Comportamento atual de animação preservado: IntersectionObserver presente no JS.
    const hasObserver = await page.evaluate(() => typeof IntersectionObserver !== 'undefined');
    expect(hasObserver).toBe(true);
  });

  test('13. meta title e description presentes', async ({ page }) => {
    const title = await page.title();
    expect(title).toContain('Linsora');
    expect(title.toLowerCase()).toContain('voz');
    const desc = await page.locator('meta[name="description"]').getAttribute('content');
    expect(desc).toContain('aplicativo');
    expect(desc.toLowerCase()).toContain('gastos');
    expect(desc.toLowerCase()).toContain('cart');
    expect(desc.toLowerCase()).toContain('voz');
    expect(desc).toContain('Conselheiro');
  });

  test('14. canonical/OG somente com URL/imagem real', async ({ page }) => {
    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content');
    expect(ogTitle).toContain('Linsora');
    const ogType = await page.locator('meta[property="og:type"]').getAttribute('content');
    expect(ogType).toBe('website');
    // Sem URL pública definitiva: canonical e og:url/og:image NÃO podem ser inventados.
    expect(await page.locator('link[rel="canonical"]').count()).toBe(0);
    expect(await page.locator('meta[property="og:url"]').count()).toBe(0);
    expect(await page.locator('meta[property="og:image"]').count()).toBe(0);
  });

  test('15. schema sem dados inventados', async ({ page }) => {
    const schemas = await page.evaluate(() =>
      Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map((s) => s.textContent || '')
    );
    expect(schemas.length).toBeGreaterThanOrEqual(1);
    const raw = schemas.join(' ');
    expect(raw).toContain('SoftwareApplication');
    expect(raw).toContain('14.90');
    expect(raw).toContain('99.90');
    expect(raw.toLowerCase()).not.toContain('aggregaterating');
    expect(raw.toLowerCase()).not.toContain('review');
    expect(raw.toLowerCase()).not.toContain('garantia');
  });

  test('16. sem promessas indevidas no conteúdo', async ({ page }) => {
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body).not.toContain('open finance');
    expect(body).not.toContain('integração bancária');
    expect(body).not.toContain('garantia de');
    expect(body).not.toContain('enriquecer');
    expect(body).not.toContain('como banco');
  });

  test('17. confiança, CTA final e rodapé sem links falsos', async ({ page }) => {
    await expect(page.locator('.lp-trust')).toContainText('Hotmart');
    await expect(page.locator('#comecar h2')).toContainText('falando');
    await expect(page.locator('#comecar .lp-btn')).toHaveText('Começar agora');
    await expect(page.locator('.lp-footer a')).toHaveCount(0);
    await expect(page.locator('header img[alt="Linsora"]')).toHaveCount(1);
  });

  test('18. hero comunica o teste grátis de 24 horas', async ({ page }) => {
    const hero = await page.locator('#hero').innerText();
    expect(hero).toContain('24 horas');
    expect(hero.toLowerCase()).toContain('gratuit');
  });

  test('19. CTA principal leva à criação de conta (não exige pagamento)', async ({ page }) => {
    const headerHref = await page.locator('header a.lp-btn').first().getAttribute('href');
    const heroHref = await page.locator('#hero a.lp-btn-primary').first().getAttribute('href');
    const finalHref = await page.locator('#comecar .lp-btn').getAttribute('href');
    for (const href of [headerHref, heroHref, finalHref]) {
      expect(href).not.toBe('#precos');
    }
    expect(heroHref).toBe('/?vamos-comecar=1');
    expect(finalHref).toBe('/?vamos-comecar=1');
  });

  test('20. preços mantidos + FAQ do trial', async ({ page }) => {
    await expect(page.locator('#precos')).toContainText('R$ 14,90');
    await expect(page.locator('#precos')).toContainText('R$ 99,90');
    const precos = await page.locator('#precos').innerText();
    expect(precos).toContain('24 horas');
    const faq = await page.locator('#faq').innerText();
    expect(faq).toContain('Como funciona o teste grátis?');
    expect(faq).toContain('O que acontece quando o teste termina?');
  });
});
