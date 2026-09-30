/**
 * ============================================================================
 * LINSORA — LANDING PAGE (landing.js)
 * Arquivo independente: acordeão do FAQ, revelação discreta das seções e
 * preparação dos botões para o checkout da Hotmart. Sem dependências,
 * sem tocar na lógica do aplicativo.
 * ============================================================================
 */

// Checkout Hotmart: URLs reais oficiais configuradas.
const HOTMART_CHECKOUT_URL_MENSAL = 'https://pay.hotmart.com/V107831993J?off=7xk5d8xd';
const HOTMART_CHECKOUT_URL_ANUAL = 'https://pay.hotmart.com/V107831993J?off=32op71oh';

window.LinsoraLanding = {
  HOTMART_CHECKOUT_URL_MENSAL,
  HOTMART_CHECKOUT_URL_ANUAL,
};

document.addEventListener('DOMContentLoaded', () => {
  // FAQ: acordeão (um item aberto por vez).
  const items = Array.from(document.querySelectorAll('.lp-faq-item'));
  items.forEach((item) => {
    const btn = item.querySelector('.lp-faq-q');
    const panel = item.querySelector('.lp-faq-a');
    if (!btn || !panel) return;
    btn.addEventListener('click', () => {
      const isOpen = item.classList.contains('open');
      items.forEach((other) => {
        other.classList.remove('open');
        other.querySelector('.lp-faq-q')?.setAttribute('aria-expanded', 'false');
        const p = other.querySelector('.lp-faq-a');
        if (p) p.style.maxHeight = '';
      });
      if (!isOpen) {
        item.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
        panel.style.maxHeight = `${panel.scrollHeight}px`;
      }
    });
  });

  // Revelação discreta das seções (sem dependências).
  const revealEls = Array.from(document.querySelectorAll('.reveal'));
  if ('IntersectionObserver' in window && revealEls.length > 0) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    revealEls.forEach((el) => observer.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('visible'));
  }

  // CTAs da Hotmart: com as URLs reais configuradas acima, o clique
  // define o href para o checkout correspondente (sem outra alteração no HTML).
  // Se um dia a URL estiver vazia/inválida, não navega para fora.
  const checkoutUrls = {
    mensal: HOTMART_CHECKOUT_URL_MENSAL,
    anual: HOTMART_CHECKOUT_URL_ANUAL,
  };
  document.querySelectorAll('[data-hotmart]').forEach((el) => {
    el.addEventListener('click', (evt) => {
      const plan = el.getAttribute('data-hotmart');
      const url = checkoutUrls[plan];
      if (!url || !/^https?:\/\//.test(url)) {
        evt.preventDefault();
        if (window.console && typeof window.console.info === 'function') {
          window.console.info(`[LinsoraLanding] Checkout "${plan}" ainda não configurado.`);
        }
        return;
      }
      el.setAttribute('href', url);
      el.setAttribute('rel', 'nofollow sponsored noopener');
    });
  });
});
