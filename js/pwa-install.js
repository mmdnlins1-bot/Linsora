/**
 * ============================================================================
 * LINSORA — EXPERIÊNCIA DE INSTALAÇÃO PWA (js/pwa-install.js)
 * Módulo isolado: beforeinstallprompt (Android/Chrome/Desktop) + orientação iOS.
 * NÃO interfere em auth, dados, Supabase, store ou regras de negócio.
 * Preferência local: LINSORA_INSTALL_DISMISSED (nunca enviada ao Supabase).
 * ============================================================================
 */
(function () {
  'use strict';

  var DISMISS_KEY = 'LINSORA_INSTALL_DISMISSED';
  var DISMISS_DAYS = 7;
  var STABLE_DELAY_MS = 4000;
  var RECHECK_MS = 10000;
  var BANNER_ID = 'linsoraInstallBanner';

  var deferredPrompt = null;
  var shownThisSession = false;
  var timerStarted = false;

  /* ------------------------------------------------------------------ */
  /* Detecção de plataforma                                              */
  /* ------------------------------------------------------------------ */

  function getPlatform() {
    var ua = navigator.userAgent || '';
    var platform = navigator.platform || '';
    var maxTouch = navigator.maxTouchPoints || 0;
    var uaDataPlatform = '';
    try {
      if (navigator.userAgentData && navigator.userAgentData.platform) {
        uaDataPlatform = navigator.userAgentData.platform;
      }
    } catch (e) { /* sem userAgentData: segue com UA */ }

    var isIOSDevice =
      /iphone|ipad|ipod/i.test(ua) ||
      /iOS/i.test(uaDataPlatform) ||
      // iPad moderno identifica-se como "Macintosh" + touch
      (platform === 'Macintosh' && maxTouch > 1);

    if (isIOSDevice) return 'ios';

    if (/android/i.test(ua) || uaDataPlatform === 'Android') return 'android';

    return 'desktop';
  }

  /* ------------------------------------------------------------------ */
  /* PWA já instalada?                                                   */
  /* ------------------------------------------------------------------ */

  function isInstalled() {
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
        return true;
      }
    } catch (e) { /* matchMedia indisponível */ }
    // iOS Safari: flag legada de standalone
    if (window.navigator && window.navigator.standalone === true) return true;
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* Dispensa (local, com expiração)                                     */
  /* ------------------------------------------------------------------ */

  function isDismissed() {
    try {
      var raw = localStorage.getItem(DISMISS_KEY);
      if (!raw) return false;
      var ts = parseInt(raw, 10);
      if (isNaN(ts)) return false;
      return (Date.now() - ts) < DISMISS_DAYS * 24 * 60 * 60 * 1000;
    } catch (e) {
      return false;
    }
  }

  function setDismissed() {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch (e) { /* storage indisponível: segue sem persistir */ }
  }

  /* ------------------------------------------------------------------ */
  /* Aplicação estável? (não interromper login/onboarding/modais)        */
  /* ------------------------------------------------------------------ */

  function isAppStable() {
    var main = document.getElementById('appMain');
    if (!main || !main.classList.contains('active')) return false;
    // Nenhum modal do Linsora aberto no momento
    var openModal = document.querySelector('.linsora-modal-overlay:not(.hidden)');
    if (openModal) return false;
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Banner (construído via DOM, sem dependência de outros módulos)      */
  /* ------------------------------------------------------------------ */

  function getBanner() {
    return document.getElementById(BANNER_ID);
  }

  function buildBanner() {
    if (getBanner()) return getBanner();

    var banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.className = 'linsora-install-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-live', 'polite');
    banner.setAttribute('aria-label', 'Instalar o Linsora');
    banner.hidden = true;

    var icon = document.createElement('img');
    icon.src = './icon-192.png';
    icon.alt = '';
    icon.setAttribute('aria-hidden', 'true');
    icon.className = 'linsora-install-icon';
    banner.appendChild(icon);

    var textWrap = document.createElement('div');
    textWrap.className = 'linsora-install-text';
    banner.appendChild(textWrap);

    var title = document.createElement('strong');
    title.className = 'linsora-install-title';
    title.textContent = 'Instale o Linsora';
    textWrap.appendChild(title);

    var desc = document.createElement('span');
    desc.className = 'linsora-install-desc';
    textWrap.appendChild(desc);

    var steps = document.createElement('ol');
    steps.className = 'linsora-install-steps';
    textWrap.appendChild(steps);

    var actions = document.createElement('div');
    actions.className = 'linsora-install-actions';
    banner.appendChild(actions);

    var btnPrimary = document.createElement('button');
    btnPrimary.type = 'button';
    btnPrimary.className = 'linsora-btn primary sm linsora-install-go';
    actions.appendChild(btnPrimary);

    var btnLater = document.createElement('button');
    btnLater.type = 'button';
    btnLater.className = 'linsora-btn secondary sm linsora-install-later';
    actions.appendChild(btnLater);

    var btnClose = document.createElement('button');
    btnClose.type = 'button';
    btnClose.className = 'linsora-install-close';
    btnClose.setAttribute('aria-label', 'Fechar convite de instalação');
    btnClose.textContent = '✕';
    banner.appendChild(btnClose);

    btnClose.addEventListener('click', dismiss);
    btnLater.addEventListener('click', dismiss);
    btnPrimary.addEventListener('click', onPrimaryAction);
    banner.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') dismiss();
    });

    document.body.appendChild(banner);
    return banner;
  }

  function fillBanner(mode) {
    var banner = getBanner();
    if (!banner) return;
    var desc = banner.querySelector('.linsora-install-desc');
    var steps = banner.querySelector('.linsora-install-steps');
    var btnPrimary = banner.querySelector('.linsora-install-go');
    var btnLater = banner.querySelector('.linsora-install-later');

    steps.innerHTML = '';

    if (mode === 'ios') {
      desc.textContent = 'Para instalar o Linsora no seu iPhone:';
      var items = [
        '1. Toque em Compartilhar.',
        "2. Escolha 'Adicionar à Tela de Início'.",
        "3. Toque em 'Adicionar'."
      ];
      items.forEach(function (t) {
        var li = document.createElement('li');
        li.textContent = t;
        steps.appendChild(li);
      });
      steps.hidden = false;
      btnPrimary.textContent = 'Entendi';
      btnPrimary.dataset.action = 'acknowledge';
      btnLater.textContent = 'Agora não';
      btnLater.hidden = false;
    } else {
      desc.textContent = 'Adicione o Linsora à tela inicial para acessar suas finanças com mais rapidez.';
      steps.hidden = true;
      btnPrimary.textContent = 'Instalar';
      btnPrimary.dataset.action = 'install';
      btnLater.textContent = 'Agora não';
      btnLater.hidden = false;
    }
  }

  function show(mode) {
    var banner = buildBanner();
    fillBanner(mode);
    banner.dataset.mode = mode;
    banner.hidden = false;
    shownThisSession = true;
  }

  function hide() {
    var banner = getBanner();
    if (banner) banner.hidden = true;
  }

  function dismiss() {
    setDismissed();
    hide();
  }

  /* ------------------------------------------------------------------ */
  /* Ações                                                               */
  /* ------------------------------------------------------------------ */

  function onPrimaryAction() {
    var banner = getBanner();
    var action = banner
      ? banner.querySelector('.linsora-install-go').dataset.action
      : 'install';

    if (action === 'acknowledge') {
      // iOS: só orientação, sem instalação automática
      dismiss();
      return;
    }

    if (!deferredPrompt) {
      // Prompt nativo indisponível: não simula instalação
      dismiss();
      return;
    }

    var promptEvent = deferredPrompt;
    deferredPrompt = null;

    try {
      promptEvent.prompt();
      if (promptEvent.userChoice && typeof promptEvent.userChoice.then === 'function') {
        promptEvent.userChoice.then(function (choice) {
          if (choice && choice.outcome === 'accepted') {
            hide();
          } else {
            dismiss();
          }
        }).catch(function () {
          dismiss();
        });
      } else {
        hide();
      }
    } catch (e) {
      dismiss();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Avaliação: quando mostrar?                                          */
  /* ------------------------------------------------------------------ */

  function evaluate() {
    if (shownThisSession) return false;
    if (isInstalled()) return false;
    if (isDismissed()) return false;
    if (!isAppStable()) return false;

    var platform = getPlatform();

    if (platform === 'ios') {
      show('ios');
      return true;
    }

    // Android/Desktop: somente se o navegador oferecer instalação real
    if (deferredPrompt) {
      show('native');
      return true;
    }

    return false;
  }

  function schedule() {
    if (timerStarted) return;
    timerStarted = true;
    window.setTimeout(function () {
      evaluate();
      window.setInterval(evaluate, RECHECK_MS);
    }, STABLE_DELAY_MS);
  }

  /* ------------------------------------------------------------------ */
  /* Eventos do navegador                                                */
  /* ------------------------------------------------------------------ */

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    // Se o app já estiver estável, avalia imediatamente
    evaluate();
  });

  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    hide();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      buildBanner();
      schedule();
    });
  } else {
    buildBanner();
    schedule();
  }

  /* API pública (isolada; usada também para verificação) */
  window.LinsoraPwaInstall = {
    getPlatform: getPlatform,
    isInstalled: isInstalled,
    isDismissed: isDismissed,
    isAppStable: isAppStable,
    evaluate: evaluate,
    dismiss: dismiss,
    hasDeferredPrompt: function () { return !!deferredPrompt; }
  };
})();
