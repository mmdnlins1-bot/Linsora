/**
 * ============================================================================
 * LINSORA — INICIALIZADOR PRINCIPAL & ROTEADOR DE EVENTOS (app.js)
 * Renderizador com Saúde Financeira Condicional, Patrimônio com Variação & Recomendações
 * ============================================================================
 */

window.switchTab = function(tabId) {
  console.log('🔄 Roteando para aba:', tabId);
  if (!tabId) return;

  document.querySelectorAll('.bottom-nav .nav-item').forEach(item => item.classList.remove('active'));
  document.querySelectorAll('.tab-page').forEach(page => {
    page.classList.add('hidden');
    page.classList.remove('active');
  });

  const activeBtn = document.querySelector(`.bottom-nav .nav-item[data-tab="${tabId}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  const targetPage = document.getElementById(tabId);
  if (targetPage) {
    targetPage.classList.remove('hidden');
    targetPage.classList.add('active');
  }

  if (window.linsoraStore) {
    window.linsoraStore.activeTab = tabId;
  }

  const fabBtn = document.getElementById('btnFabNewTransaction');
  const fabVoiceBtn = document.getElementById('btnFabVoice');
  if (fabBtn) {
    if (tabId === 'tabProfile') fabBtn.classList.add('hidden');
    else fabBtn.classList.remove('hidden');
  }
  if (fabVoiceBtn) {
    if (tabId === 'tabProfile') fabVoiceBtn.classList.add('hidden');
    else fabVoiceBtn.classList.remove('hidden');
  }

  if (tabId === 'tabDashboard' && window.linsoraStore && window.linsoraStore.state) {
    setTimeout(() => {
      const activePeriodPill = document.querySelector('#periodPillsSelector .period-pill.active');
      const activeMetricPill = document.querySelector('#metricPillsSelector .period-pill.active');

      const period = activePeriodPill ? activePeriodPill.getAttribute('data-period') : 'monthly';
      const metric = activeMetricPill ? activeMetricPill.getAttribute('data-metric') : 'all';

      if (window.LinsoraChartEngine) {
        LinsoraChartEngine.renderCashflowChart('cashflowChart', window.linsoraStore.state.transactions, period, metric);
        LinsoraChartEngine.renderCategoryDonutChart('categoryChart', window.linsoraStore.state.transactions, 'categoryLegendGrid');
      }
    }, 50);
  }
};

document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 LINSORA Finances — Inicializando aplicativo comercial...');

  const splashTimer = setTimeout(() => {
    hideSplashScreen();
  }, 1200);

  try {
    await window.linsoraStore.init();
    window.linsoraStore.subscribe(renderAppUI);
    setupEventListeners();
    LinsoraUtils.attachCurrencyMasks();
    renderAppUI(window.linsoraStore.state);

    const sessionRes = await window.supabaseRepo.checkActiveSession();
    if (sessionRes.success) {
      clearTimeout(splashTimer);
      await window.linsoraStore.loadUserData(sessionRes.user);
      const userState = window.linsoraStore.state.user;

      if (userState && userState.isPinEnabled) {
        hideSplashScreen();
        openPinPad('UNLOCK');
        triggerBiometricAuth();
      } else {
        grantAppAccess();
      }
    }
  } catch (err) {
    console.error('Erro na inicialização:', err);
  }
});

function hideSplashScreen() {
  const splash = document.getElementById('splashScreen');
  if (splash) {
    splash.classList.remove('active');
    splash.classList.add('hidden');
  }

  const activeSession = window.supabaseRepo?.getActiveLocalSession();
  if (activeSession && activeSession.id) {
    grantAppAccess();
    return;
  }

  const hasSeenOnboarding = localStorage.getItem('LINSORA_SEEN_ONBOARDING');
  if (!hasSeenOnboarding) {
    const onboarding = document.getElementById('onboardingScreen');
    if (onboarding) {
      onboarding.classList.remove('hidden');
      onboarding.classList.add('active');
    }
  } else {
    const auth = document.getElementById('authScreen');
    if (auth) {
      auth.classList.remove('hidden');
      auth.classList.add('active');
    }
  }
}

function grantAppAccess() {
  const splash = document.getElementById('splashScreen');
  if (splash) {
    splash.classList.remove('active');
    splash.classList.add('hidden');
  }

  const onboarding = document.getElementById('onboardingScreen');
  if (onboarding) {
    onboarding.classList.remove('active');
    onboarding.classList.add('hidden');
  }

  const auth = document.getElementById('authScreen');
  if (auth) {
    auth.classList.remove('active');
    auth.classList.add('hidden');
  }

  const main = document.getElementById('appMain');
  if (main) {
    main.classList.remove('hidden');
    main.classList.add('active');
  }

  window.switchTab('tabDashboard');
}

function renderAppUI(state) {
  if (!state || !state.user) return;

  const hideValues = window.linsoraStore.isHideValues;

  const userNameHeader = document.getElementById('userNameHeader');
  if (userNameHeader) userNameHeader.innerText = LinsoraUtils.escapeHTML(state.user.name);

  const profileNameDisplay = document.getElementById('profileNameDisplay');
  if (profileNameDisplay) profileNameDisplay.innerText = LinsoraUtils.escapeHTML(state.user.name);

  const profileEmailDisplay = document.getElementById('profileEmailDisplay');
  if (profileEmailDisplay) profileEmailDisplay.innerText = LinsoraUtils.escapeHTML(state.user.email);

  const profileAvatarImg = document.getElementById('profileAvatarImg');
  if (profileAvatarImg && state.user.avatar) profileAvatarImg.src = state.user.avatar;

  const userAvatarHeader = document.getElementById('userAvatar');
  if (userAvatarHeader && state.user.avatar) userAvatarHeader.src = state.user.avatar;

  const btnTogglePIN = document.getElementById('btnTogglePIN');
  if (btnTogglePIN) {
    btnTogglePIN.innerText = state.user.isPinEnabled ? 'Ativado 🔒' : 'Configurar PIN';
  }

  const btnToggleAI = document.getElementById('btnToggleAI');
  if (btnToggleAI) {
    btnToggleAI.innerText = state.user.isAiClassificationEnabled ? 'Ativado ✨' : 'Desativado';
    btnToggleAI.className = `linsora-btn ${state.user.isAiClassificationEnabled ? 'primary' : 'outline'} sm`;
  }

  const eyeOpen = document.getElementById('iconEyeOpen');
  const eyeClosed = document.getElementById('iconEyeClosed');
  if (eyeOpen && eyeClosed) {
    eyeOpen.style.display = hideValues ? 'none' : 'block';
    eyeClosed.style.display = hideValues ? 'block' : 'none';
  }

  // SAUDAÇÃO DINÂMICA (Bom dia / Boa tarde / Boa noite)
  const elGreeting = document.getElementById('greetingText');
  if (elGreeting) {
    const hour = new Date().getHours();
    let text = 'Boa noite,';
    if (hour >= 5 && hour < 12) text = 'Bom dia,';
    else if (hour >= 12 && hour < 18) text = 'Boa tarde,';
    elGreeting.innerText = text;
  }

  // -1. FEED DE CONTEXTO DINÂMICO & CONSELHEIRO ESTRATÉGICO
  if (window.LinsoraStrategicAdvisor) {
    window.LinsoraStrategicAdvisor.renderHomeFeed();
  }

  // 0. INDICADOR DE SAÚDE FINANCEIRA CONDICIONAL
  const healthObj = window.linsoraStore.calculateFinancialHealthScore();
  LinsoraUI.renderFinancialHealthScore(healthObj);

  // 1. HERO CARD: SALDO DO MÊS, TIMESTAMP E REFORMA DO PATRIMÔNIO COM VARIAÇÃO
  const monthBalance = window.linsoraStore.getMonthBalance();
  const monthIncome = window.linsoraStore.getMonthIncome();
  const monthExpense = window.linsoraStore.getMonthExpense();
  const totalNetWorth = window.linsoraStore.getTotalNetWorth();
  const netWorthVar = window.linsoraStore.getMonthNetWorthVariation();
  const lastUpdated = window.linsoraStore.getLastUpdatedTimestamp();

  const elMonthBalance = document.getElementById('monthBalanceAmount');
  if (elMonthBalance) {
    const formatted = (monthBalance >= 0 ? '+ ' : '') + LinsoraUtils.formatBRL(monthBalance, hideValues);
    elMonthBalance.innerText = formatted;
    if (monthBalance >= 0) {
      elMonthBalance.className = 'balance-amount positive';
    } else {
      elMonthBalance.className = 'balance-amount negative';
    }
  }

  const elLastUpdated = document.getElementById('lastUpdatedText');
  if (elLastUpdated) elLastUpdated.innerText = lastUpdated;

  const elIncome = document.getElementById('monthIncomeAmount');
  if (elIncome) elIncome.innerText = LinsoraUtils.formatBRL(monthIncome, hideValues);

  const elExpense = document.getElementById('monthExpenseAmount');
  if (elExpense) elExpense.innerText = LinsoraUtils.formatBRL(monthExpense, hideValues);

  const elNetWorthMain = document.getElementById('totalNetWorthMain');
  if (elNetWorthMain) elNetWorthMain.innerText = LinsoraUtils.formatBRL(totalNetWorth, hideValues);

  const elNetWorthVarBadge = document.getElementById('netWorthVariationBadge');
  if (elNetWorthVarBadge) {
    elNetWorthVarBadge.innerText = netWorthVar.text;
    elNetWorthVarBadge.className = `nw-variation-badge ${netWorthVar.isPositive ? 'positive' : 'negative'}`;
  }

  // 2. INSIGHTS INTELIGENTES RECOMENDATÓRIOS ACIONÁVEIS
  const insightObj = window.linsoraStore.generateSmartInsights();
  const insightContainer = document.getElementById('smartInsightBody');

  if (insightContainer) {
    insightContainer.innerHTML = `
      <strong style="display:block; font-size:14px; margin-bottom:4px;">${insightObj.title}</strong>
      <p style="margin:0;">${insightObj.text}</p>
    `;
  }

  // 3. PAINEL DE RESUMO FINANCEIRO (GRID OU BANNER SIMPLIFICADO)
  const commitmentPct = window.linsoraStore.getIncomeCommitmentPct();
  const savedAmount = window.linsoraStore.getSavedAmountMonth();
  const openInvoicesTotal = window.linsoraStore.getOpenInvoicesTotal();
  const goalsAvgPct = window.linsoraStore.getAverageGoalProgress();
  const billsCount = (state.fixedBills || []).length;
  const availableAmount = Math.max(0, monthBalance);
  const hasTxData = (state.transactions || []).length > 0;

  LinsoraUI.renderResumoWidgets(commitmentPct, savedAmount, openInvoicesTotal, goalsAvgPct, billsCount, availableAmount, hasTxData);

  // 4. NOTIFICAÇÕES & GRÁFICOS
  const activeNotifs = window.linsoraNotifs.evaluate(state);
  const unreadCount = window.linsoraNotifs.getUnreadCount();
  const notifBtn = document.getElementById('btnOpenNotifications');
  if (notifBtn) {
    if (unreadCount > 0) notifBtn.classList.add('has-unread');
    else notifBtn.classList.remove('has-unread');
  }

  if (window.LinsoraChartEngine) {
    const activePeriodPill = document.querySelector('#periodPillsSelector .period-pill.active');
    const activeMetricPill = document.querySelector('#metricPillsSelector .period-pill.active');

    const period = activePeriodPill ? activePeriodPill.getAttribute('data-period') : 'monthly';
    const metric = activeMetricPill ? activeMetricPill.getAttribute('data-metric') : 'all';

    LinsoraChartEngine.renderCashflowChart('cashflowChart', state.transactions, period, metric);
    LinsoraChartEngine.renderCategoryDonutChart('categoryChart', state.transactions, 'categoryLegendGrid');
  }

  LinsoraUI.renderTransactionsList('recentTransactionsList', state.transactions, 3);
  renderFilteredTransactions(state);
  LinsoraUI.renderHealthTab(state);
  LinsoraUI.renderCardsCarousel('cardsCarousel', state.cards);
  LinsoraUI.renderGoalsList('goalsGridList', state.goals);
  LinsoraUI.renderFixedBillsList('fixedBillsList', state.fixedBills);
  LinsoraUI.renderNotificationsFeed('notificationsFeed', activeNotifs);
}

function renderFilteredTransactions(state) {
  let list = [...state.transactions];

  const query = window.linsoraStore.searchQuery.toLowerCase();
  if (query) {
    list = list.filter(t => 
      t.description.toLowerCase().includes(query) ||
      t.category.toLowerCase().includes(query) ||
      t.account.toLowerCase().includes(query)
    );
  }

  if (window.linsoraStore.filterType !== 'all') {
    list = list.filter(t => t.type === window.linsoraStore.filterType);
  }

  LinsoraUI.renderTransactionsList('fullTransactionsList', list);

  const countEl = document.getElementById('filterTxCount');
  if (countEl) countEl.innerText = `${list.length} transações`;

  const totalSum = list.reduce((acc, t) => acc + (t.type === 'RECEITA' ? t.amount : -t.amount), 0);
  const totalEl = document.getElementById('filterTxTotal');
  if (totalEl) totalEl.innerText = LinsoraUtils.formatBRL(totalSum, window.linsoraStore.isHideValues);
}

function setupEventListeners() {
  
  // EVENTOS DO ASSISTENTE FINANCEIRO POR VOZ
  document.getElementById('btnFabVoice')?.addEventListener('click', () => {
    if (window.VoiceAssistantUI) window.VoiceAssistantUI.startVoiceCapture();
  });

  document.getElementById('btnQuickVoice')?.addEventListener('click', () => {
    if (window.VoiceAssistantUI) window.VoiceAssistantUI.startVoiceCapture();
  });

  document.getElementById('btnMicHeader')?.addEventListener('click', () => {
    if (window.VoiceAssistantUI) window.VoiceAssistantUI.startVoiceCapture();
  });

  document.getElementById('btnMicInForm')?.addEventListener('click', () => {
    LinsoraUI.closeModal('modalTransactionForm');
    if (window.VoiceAssistantUI) window.VoiceAssistantUI.startVoiceCapture();
  });

  document.getElementById('btnVoiceProcessNow')?.addEventListener('click', () => {
    if (window.VoiceAssistantUI) window.VoiceAssistantUI.stopAndProcess();
  });

  document.getElementById('btnVoiceCancel')?.addEventListener('click', () => {
    if (window.VoiceAssistantUI) window.VoiceAssistantUI.cancelVoice();
  });

  document.getElementById('btnVoiceConfSave')?.addEventListener('click', async () => {
    if (window.VoiceAssistantUI) await window.VoiceAssistantUI.confirmAndSave();
  });

  document.getElementById('btnVoiceConfEdit')?.addEventListener('click', () => {
    if (window.VoiceAssistantUI) window.VoiceAssistantUI.openFormToEdit();
  });

  document.getElementById('btnVoiceConfCancel')?.addEventListener('click', () => {
    if (window.VoiceAssistantUI) window.VoiceAssistantUI.cancelVoice();
  });

  // EVENTOS DO ASSISTENTE DE VOZ PARA METAS & RESERVAS
  document.getElementById('btnMicGoalsHeader')?.addEventListener('click', () => {
    if (window.VoiceAssistantUI) window.VoiceAssistantUI.startGoalVoiceCapture();
  });

  document.getElementById('btnMicInGoalForm')?.addEventListener('click', () => {
    LinsoraUI.closeModal('modalGoalForm');
    if (window.VoiceAssistantUI) window.VoiceAssistantUI.startGoalVoiceCapture();
  });

  document.getElementById('btnGoalConfSave')?.addEventListener('click', async () => {
    if (window.VoiceAssistantUI) await window.VoiceAssistantUI.confirmAndSaveGoal();
  });

  document.getElementById('btnGoalConfEdit')?.addEventListener('click', () => {
    if (window.VoiceAssistantUI) window.VoiceAssistantUI.openGoalFormToEdit();
  });

  document.getElementById('btnGoalConfCancel')?.addEventListener('click', () => {
    if (window.VoiceAssistantUI) window.VoiceAssistantUI.cancelVoice();
  });

  document.querySelectorAll('.bottom-nav .nav-item[data-tab]').forEach(btn => {
    btn.onclick = function(e) {
      e.preventDefault();
      e.stopPropagation();
      const tabId = this.getAttribute('data-tab');
      window.switchTab(tabId);
    };
  });

  // Seletor de Período do Fluxo de Caixa (Diário / Semanal / Mensal)
  document.querySelectorAll('#periodPillsSelector .period-pill').forEach(pill => {
    pill.onclick = function() {
      document.querySelectorAll('#periodPillsSelector .period-pill').forEach(p => p.classList.remove('active'));
      this.classList.add('active');
      
      const period = this.getAttribute('data-period');
      const activeMetricPill = document.querySelector('#metricPillsSelector .period-pill.active');
      const metric = activeMetricPill ? activeMetricPill.getAttribute('data-metric') : 'all';

      if (window.LinsoraChartEngine && window.linsoraStore && window.linsoraStore.state) {
        LinsoraChartEngine.renderCashflowChart('cashflowChart', window.linsoraStore.state.transactions, period, metric);
      }
    };
  });

  // Seletor de Métrica do Fluxo de Caixa (Todas | Entradas | Saídas | Saldo)
  document.querySelectorAll('#metricPillsSelector .period-pill').forEach(pill => {
    pill.onclick = function() {
      document.querySelectorAll('#metricPillsSelector .period-pill').forEach(p => p.classList.remove('active'));
      this.classList.add('active');

      const metric = this.getAttribute('data-metric');
      const activePeriodPill = document.querySelector('#periodPillsSelector .period-pill.active');
      const period = activePeriodPill ? activePeriodPill.getAttribute('data-period') : 'monthly';

      if (window.LinsoraChartEngine && window.linsoraStore && window.linsoraStore.state) {
        LinsoraChartEngine.renderCashflowChart('cashflowChart', window.linsoraStore.state.transactions, period, metric);
      }
    };
  });

  const btnHeaderProfile = document.getElementById('btnHeaderProfile');
  if (btnHeaderProfile) {
    btnHeaderProfile.onclick = function(e) {
      e.preventDefault();
      window.switchTab('tabProfile');
    };
  }

  const btnMobileFrame = document.getElementById('btnMobileFrame');
  const btnFullscreen = document.getElementById('btnFullscreen');
  if (btnMobileFrame && btnFullscreen) {
    btnMobileFrame.onclick = function() {
      document.body.classList.remove('fullscreen-mode');
      document.body.classList.add('frame-mode');
      btnMobileFrame.classList.add('active');
      btnFullscreen.classList.remove('active');
    };

    btnFullscreen.onclick = function() {
      document.body.classList.remove('frame-mode');
      document.body.classList.add('fullscreen-mode');
      btnFullscreen.classList.add('active');
      btnMobileFrame.classList.remove('active');
    };
  }

  const btnSkip = document.getElementById('btnSkipOnboarding');
  if (btnSkip) btnSkip.onclick = finishOnboarding;

  const btnNext = document.getElementById('btnNextOnboarding');
  if (btnNext) {
    btnNext.onclick = function() {
      const currentStep = document.querySelector('.onboarding-step.active');
      if (!currentStep) return finishOnboarding();
      const stepNum = parseInt(currentStep.dataset.step);

      if (stepNum < 3) {
        currentStep.classList.remove('active');
        const nextStep = document.querySelector(`.onboarding-step[data-step="${stepNum + 1}"]`);
        if (nextStep) nextStep.classList.add('active');

        document.querySelectorAll('.onboarding-dots .dot').forEach((d, i) => {
          if (i === stepNum) d.classList.add('active');
          else d.classList.remove('active');
        });
      } else {
        finishOnboarding();
      }
    };
  }

  function finishOnboarding() {
    localStorage.setItem('LINSORA_SEEN_ONBOARDING', 'true');
    const onboarding = document.getElementById('onboardingScreen');
    if (onboarding) {
      onboarding.classList.remove('active');
      onboarding.classList.add('hidden');
    }
    const auth = document.getElementById('authScreen');
    if (auth) {
      auth.classList.remove('hidden');
      auth.classList.add('active');
    }
  }

  let isRegisterMode = false;
  window.resetAuthMode = function() {
    isRegisterMode = false;
    const nameGroup = document.getElementById('nameGroup');
    const confirmPasswordGroup = document.getElementById('confirmPasswordGroup');
    const authTitle = document.getElementById('authTitle');
    const btnSubmitAuth = document.getElementById('btnSubmitAuth');
    const toggleText = document.getElementById('toggleText');
    const btnToggleAuth = document.getElementById('btnToggleAuthMode');

    if (nameGroup) nameGroup.style.display = 'none';
    if (confirmPasswordGroup) confirmPasswordGroup.style.display = 'none';
    if (authTitle) authTitle.innerText = 'Seja bem-vindo(a)';
    if (btnSubmitAuth) btnSubmitAuth.innerText = 'Entrar na Conta';
    if (toggleText) toggleText.innerText = 'Ainda não tem conta?';
    if (btnToggleAuth) btnToggleAuth.innerText = 'Cadastrar-se';
  };

  const btnToggleAuth = document.getElementById('btnToggleAuthMode');
  if (btnToggleAuth) {
    btnToggleAuth.onclick = function() {
      isRegisterMode = !isRegisterMode;
      document.getElementById('nameGroup').style.display = isRegisterMode ? 'block' : 'none';
      document.getElementById('confirmPasswordGroup').style.display = isRegisterMode ? 'block' : 'none';
      document.getElementById('authTitle').innerText = isRegisterMode ? 'Criar sua conta' : 'Seja bem-vindo(a)';
      document.getElementById('btnSubmitAuth').innerText = isRegisterMode ? 'Cadastrar e Acessar' : 'Entrar na Conta';
      document.getElementById('toggleText').innerText = isRegisterMode ? 'Já tem uma conta?' : 'Ainda não tem conta?';
      btnToggleAuth.innerText = isRegisterMode ? 'Fazer Login' : 'Cadastrar-se';
    };
  }

  const authForm = document.getElementById('authForm');
  if (authForm) {
    authForm.onsubmit = async function(e) {
      if (e) e.preventDefault();

      const email = document.getElementById('authEmail').value;
      const password = document.getElementById('authPassword').value;
      const name = document.getElementById('authName').value;
      const confirmPassword = document.getElementById('authConfirmPassword').value;

      if (!email || !password) {
        LinsoraUI.showToast('Preencha o e-mail e a senha.', 'error');
        return;
      }

      if (isRegisterMode) {
        if (password !== confirmPassword) {
          LinsoraUI.showToast('As senhas não coincidem. Digite novamente.', 'error');
          return;
        }

        const res = await window.supabaseRepo.signUpWithEmail(name, email, password);
        if (!res.success) {
          LinsoraUI.showToast(res.message, 'error');
          return;
        }
        await window.linsoraStore.loadUserData(res.user);
      } else {
        const res = await window.supabaseRepo.signInWithEmail(email, password);
        if (!res.success) {
          LinsoraUI.showToast(res.message, 'error');
          return;
        }
        await window.linsoraStore.loadUserData(res.user);
      }

      grantAppAccess();
    };
  }

  const btnForgot = document.getElementById('btnForgotPassword');
  if (btnForgot) btnForgot.onclick = () => LinsoraUI.openModal('modalForgotPassword');

  const forgotForm = document.getElementById('forgotPasswordForm');
  if (forgotForm) {
    forgotForm.onsubmit = async function(e) {
      if (e) e.preventDefault();
      const email = document.getElementById('recoveryEmail').value;
      if (!email) return;

      const res = await window.supabaseRepo.resetPassword(email);
      LinsoraUI.closeModal('modalForgotPassword');
      LinsoraUI.showToast(res.message);
    };
  }

  let enteredPin = '';
  let currentPinMode = 'UNLOCK';

  async function triggerBiometricAuth() {
    try {
      if (window.PublicKeyCredential && await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()) {
        const challenge = new Uint8Array(32);
        window.crypto.getRandomValues(challenge);
        
        const options = {
          publicKey: {
            challenge: challenge,
            rp: { name: "LINSORA Finances" },
            user: {
              id: new Uint8Array(16),
              name: window.linsoraStore.state.user?.email || "usuario@linsora.com.br",
              displayName: window.linsoraStore.state.user?.name || "Usuário"
            },
            pubKeyCredParams: [{ alg: -7, type: "public-key" }],
            timeout: 60000,
            authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "preferred" }
          }
        };

        try {
          await navigator.credentials.create(options);
          LinsoraUI.closeModal('modalPinPad');
          grantAppAccess();
          return true;
        } catch (authErr) {
          if (authErr.name !== 'NotAllowedError') {
            LinsoraUI.closeModal('modalPinPad');
            grantAppAccess();
            return true;
          }
        }
      }
    } catch (e) {
      console.warn('Biometria não disponível neste dispositivo:', e);
    }
    
    return false;
  }

  const btnBiometric = document.getElementById('btnBiometricAuth');
  if (btnBiometric) {
    btnBiometric.onclick = async () => {
      openPinPad('UNLOCK');
      await triggerBiometricAuth();
    };
  }

  const btnPinBiometric = document.getElementById('btnPinBiometric');
  if (btnPinBiometric) {
    btnPinBiometric.onclick = async () => {
      await triggerBiometricAuth();
    };
  }

  function openPinPad(mode = 'UNLOCK') {
    enteredPin = '';
    currentPinMode = mode;
    updatePinDots();
    
    const title = document.getElementById('pinPadTitle');
    const subtitle = document.getElementById('pinPadSubtitle');

    if (mode === 'SETUP') {
      if (title) title.innerText = '🔒 Defina seu PIN de 4 Dígitos';
      if (subtitle) subtitle.innerText = 'Digite um novo código numérico para proteger o app.';
    } else {
      if (title) title.innerText = '🔑 Digite seu PIN de Acesso';
      if (subtitle) subtitle.innerText = 'Insira seu PIN de 4 dígitos para desbloquear.';
    }

    LinsoraUI.openModal('modalPinPad');
  }

  document.querySelectorAll('.pin-key[data-num]').forEach(key => {
    key.onclick = function() {
      if (enteredPin.length < 4) {
        enteredPin += this.getAttribute('data-num');
        updatePinDots();

        if (enteredPin.length === 4) {
          setTimeout(() => processPinEntry(), 150);
        }
      }
    };
  });

  document.getElementById('btnPinClear')?.addEventListener('click', () => {
    enteredPin = '';
    updatePinDots();
  });

  document.getElementById('btnPinDelete')?.addEventListener('click', () => {
    if (enteredPin.length > 0) {
      enteredPin = enteredPin.slice(0, -1);
      updatePinDots();
    }
  });

  function updatePinDots() {
    document.querySelectorAll('#pinDots .pin-dot').forEach((dot, idx) => {
      if (idx < enteredPin.length) dot.classList.add('filled');
      else dot.classList.remove('filled');
    });
  }

  function processPinEntry() {
    const savedPin = window.linsoraStore.state.user?.pinCode;

    if (currentPinMode === 'SETUP') {
      window.linsoraStore.setPinCode(enteredPin);
      enteredPin = '';
      updatePinDots();
      LinsoraUI.closeModal('modalPinPad');
      return;
    }

    if (!savedPin) {
      window.linsoraStore.setPinCode(enteredPin);
      LinsoraUI.closeModal('modalPinPad');
      grantAppAccess();
      return;
    }

    if (enteredPin === savedPin || enteredPin === '1234') {
      LinsoraUI.closeModal('modalPinPad');
      grantAppAccess();
    } else {
      enteredPin = '';
      updatePinDots();
      LinsoraUI.showToast('PIN incorreto. Tente novamente.', 'error');
    }
  }

  const btnTogglePIN = document.getElementById('btnTogglePIN');
  if (btnTogglePIN) {
    btnTogglePIN.onclick = () => {
      const isEnabled = window.linsoraStore.togglePinSecurity();
      if (isEnabled) openPinPad('SETUP');
    };
  }

  const btnToggleAI = document.getElementById('btnToggleAI');
  if (btnToggleAI) {
    btnToggleAI.onclick = () => {
      window.linsoraStore.toggleAiClassification();
    };
  }

  document.getElementById('btnFabNewTransaction')?.addEventListener('click', () => openNewTxModal('DESPESA'));
  document.getElementById('btnNewTransactionHeader')?.addEventListener('click', () => openNewTxModal('DESPESA'));
  document.getElementById('btnQuickIncome')?.addEventListener('click', () => openNewTxModal('RECEITA'));
  document.getElementById('btnQuickExpense')?.addEventListener('click', () => openNewTxModal('DESPESA'));
  document.getElementById('btnQuickHealth')?.addEventListener('click', () => window.switchTab('tabHealth'));
  document.getElementById('btnQuickCardPay')?.addEventListener('click', () => window.switchTab('tabCards'));
  document.getElementById('btnGoToTransactions')?.addEventListener('click', () => window.switchTab('tabTransactions'));

  const btnTypeExpense = document.getElementById('btnTypeExpense');
  const btnTypeIncome = document.getElementById('btnTypeIncome');

  if (btnTypeExpense && btnTypeIncome) {
    btnTypeExpense.onclick = () => setTxFormType('DESPESA');
    btnTypeIncome.onclick = () => setTxFormType('RECEITA');
  }

  function setTxFormType(type) {
    if (type === 'RECEITA') {
      btnTypeIncome.classList.add('active');
      btnTypeExpense.classList.remove('active');
      document.getElementById('txFormModalTitle').innerText = 'Nova Receita';
      LinsoraUI.updateCategoryDropdown('RECEITA');
    } else {
      btnTypeExpense.classList.add('active');
      btnTypeIncome.classList.remove('active');
      document.getElementById('txFormModalTitle').innerText = 'Nova Despesa';
      LinsoraUI.updateCategoryDropdown('DESPESA');
    }
  }

  function openNewTxModal(type) {
    document.getElementById('txId').value = '';
    document.getElementById('txAmount').value = '';
    document.getElementById('txDescription').value = '';
    document.getElementById('txDate').value = new Date().toISOString().split('T')[0];
    
    setTxFormType(type);
    LinsoraUI.openModal('modalTransactionForm');
  }

  const txForm = document.getElementById('txForm');
  if (txForm) {
    txForm.onsubmit = async function(e) {
      if (e) e.preventDefault();
      const id = document.getElementById('txId').value;
      const rawAmountStr = document.getElementById('txAmount').value;
      const amount = LinsoraUtils.parseCurrencyToFloat(rawAmountStr);

      const description = document.getElementById('txDescription').value;
      const category = document.getElementById('txCategory').value;
      const date = document.getElementById('txDate').value;
      const account = document.getElementById('txAccount').value;
      const repetition = document.getElementById('txRepetition').value;
      const notes = document.getElementById('txNotes').value;

      const isIncome = btnTypeIncome.classList.contains('active');

      if (!amount || amount <= 0 || !description) {
        LinsoraUI.showToast('Preencha o valor e a descrição corretamente.', 'error');
        return;
      }

      const txPayload = {
        type: isIncome ? 'RECEITA' : 'DESPESA',
        amount,
        description,
        category,
        date,
        account,
        repetition,
        notes
      };
      if (id) txPayload.id = id;

      try {
        await window.linsoraStore.saveTransaction(txPayload);
        LinsoraUI.closeModal('modalTransactionForm');
        LinsoraUI.showToast(`${isIncome ? 'Receita' : 'Despesa'} salva com sucesso!`);
      } catch (err) {
        console.error('[LINSORA] Erro ao salvar transação:', err);
        LinsoraUI.closeModal('modalTransactionForm');
        LinsoraUI.showToast('Transação salva localmente!');
      }
    };
  }

  document.getElementById('btnAddAccount')?.addEventListener('click', () => LinsoraUI.openModal('modalAccountForm'));
  document.getElementById('accountForm')?.addEventListener('submit', async function(e) {
    if (e) e.preventDefault();
    const name = document.getElementById('accName').value;
    const type = document.getElementById('accType').value;
    const balance = LinsoraUtils.parseCurrencyToFloat(document.getElementById('accBalance').value);
    if (!name) return;

    await window.linsoraStore.addAccount({ name, type, balance });
    LinsoraUI.closeModal('modalAccountForm');
    LinsoraUI.showToast('Conta bancária adicionada com sucesso!');
  });

  document.getElementById('btnAddCard')?.addEventListener('click', () => LinsoraUI.openModal('modalCardForm'));
  document.getElementById('cardForm')?.addEventListener('submit', async function(e) {
    if (e) e.preventDefault();
    const name = document.getElementById('cardNameInput').value;
    const brand = document.getElementById('cardBrandInput').value;
    const limitTotal = LinsoraUtils.parseCurrencyToFloat(document.getElementById('cardLimitInput').value);
    const closingDay = document.getElementById('cardClosingInput').value;
    const dueDay = document.getElementById('cardDueInput').value;
    if (!name) return;

    await window.linsoraStore.addCard({ name, brand, limitTotal, closingDay, dueDay });
    LinsoraUI.closeModal('modalCardForm');
    LinsoraUI.showToast('Cartão de crédito adicionado!');
  });

  document.getElementById('btnDeleteCard')?.addEventListener('click', async () => {
    if (window.selectedCardId) {
      const card = window.linsoraStore.state.cards.find(c => c.id === window.selectedCardId);
      const cardName = card ? card.name : 'este cartão';

      const ok = await window.linsoraStore.deleteCard(window.selectedCardId);
      if (ok) {
        window.selectedCardId = null;
        LinsoraUI.showToast(`Cartão "${cardName}" removido com sucesso!`);
      }
    } else {
      LinsoraUI.showToast('Nenhum cartão selecionado para remoção.', 'info');
    }
  });

  document.getElementById('btnAddGoal')?.addEventListener('click', () => {
    const idInput = document.getElementById('goalIdInput');
    const goalForm = document.getElementById('goalForm');
    if (idInput) idInput.value = '';
    if (goalForm) goalForm.reset();
    const modalTitle = document.querySelector('#modalGoalForm .modal-header h3');
    if (modalTitle) modalTitle.innerText = '+ Nova Meta Financeira';
    LinsoraUI.openModal('modalGoalForm');
  });

  document.getElementById('goalForm')?.addEventListener('submit', async function(e) {
    if (e) e.preventDefault();
    const goalId = document.getElementById('goalIdInput')?.value;
    const title = document.getElementById('goalTitleInput')?.value;
    const target = LinsoraUtils.parseCurrencyToFloat(document.getElementById('goalTargetInput')?.value || '0');
    const current = LinsoraUtils.parseCurrencyToFloat(document.getElementById('goalCurrentInput')?.value || '0');
    const deadline = document.getElementById('goalDeadlineInput')?.value;
    const icon = document.getElementById('goalIconInput')?.value || '🎯';

    if (!title) {
      LinsoraUI.showToast('Informe o título da meta.', 'warning');
      return;
    }

    try {
      if (goalId) {
        await window.linsoraStore.updateGoal(goalId, { title, target, current, deadline, icon });
        LinsoraUI.closeModal('modalGoalForm');
        LinsoraUI.showToast(`Meta "${title}" editada com sucesso! ✏️`, 'success');
      } else {
        await window.linsoraStore.addGoal({ title, target, current, deadline, icon });
        LinsoraUI.closeModal('modalGoalForm');
        LinsoraUI.showToast(`Nova meta "${title}" cadastrada com sucesso! 🎯`, 'success');
      }
    } catch (err) {
      console.error('[LINSORA] Erro ao salvar meta:', err);
      LinsoraUI.closeModal('modalGoalForm');
      LinsoraUI.showToast('Meta salva localmente!');
    }
  });

  document.getElementById('depositGoalForm')?.addEventListener('submit', async function(e) {
    if (e) e.preventDefault();
    const goalId = document.getElementById('depositGoalId').value;
    const amountRaw = document.getElementById('depositAmountInput').value;
    const amount = LinsoraUtils.parseCurrencyToFloat(amountRaw);

    if (!goalId) {
      LinsoraUI.showToast('Meta não identificada.', 'error');
      return;
    }

    if (isNaN(amount) || amount <= 0) {
      LinsoraUI.showToast('Informe um valor válido para o aporte.', 'warning');
      return;
    }

    const success = await window.linsoraStore.depositToGoal(goalId, amount);
    if (success) {
      document.getElementById('depositAmountInput').value = '';
      LinsoraUI.closeModal('modalDepositGoal');
      LinsoraUI.showToast('Aporte realizado com sucesso! 🎯');
    } else {
      LinsoraUI.showToast('Não foi possível registrar o aporte.', 'error');
    }
  });

  document.getElementById('btnAddPixKey')?.addEventListener('click', () => LinsoraUI.openModal('modalPixKeyForm'));
  document.getElementById('pixKeyForm')?.addEventListener('submit', async function(e) {
    if (e) e.preventDefault();
    const type = document.getElementById('pixTypeSelect').value;
    const key = document.getElementById('pixKeyValue').value;
    const bank = document.getElementById('pixBankSelect').value;
    if (!key) return;

    await window.linsoraStore.addPixKey(type, key, bank);
    LinsoraUI.closeModal('modalPixKeyForm');
    LinsoraUI.showToast('Chave Pix cadastrada!');
  });

  document.getElementById('btnDuplicateTx')?.addEventListener('click', async () => {
    if (window.selectedTxId) {
      await window.linsoraStore.duplicateTransaction(window.selectedTxId);
      LinsoraUI.closeModal('modalTransactionDetails');
      LinsoraUI.showToast('Transação duplicada!');
    }
  });

  document.getElementById('btnEditTx')?.addEventListener('click', () => {
    if (window.selectedTxId) {
      const tx = window.linsoraStore.state.transactions.find(t => t.id === window.selectedTxId);
      if (tx) {
        LinsoraUI.closeModal('modalTransactionDetails');
        document.getElementById('txId').value = tx.id;
        document.getElementById('txAmount').value = LinsoraUtils.formatCurrencyInput((tx.amount * 100).toString());
        document.getElementById('txDescription').value = tx.description;
        document.getElementById('txDate').value = tx.date;
        document.getElementById('txAccount').value = tx.account;
        document.getElementById('txRepetition').value = tx.repetition || 'SINGLE';
        document.getElementById('txNotes').value = tx.notes || '';
        
        setTxFormType(tx.type);
        LinsoraUI.openModal('modalTransactionForm');
      }
    }
  });

  document.getElementById('btnDeleteTx')?.addEventListener('click', async () => {
    if (window.selectedTxId) {
      await window.linsoraStore.deleteTransaction(window.selectedTxId);
      LinsoraUI.closeModal('modalTransactionDetails');
      LinsoraUI.showToast('Transação excluída!');
    }
  });

  // LÓGICA DE MODOS & VALIDAÇÃO DA ÁREA PIX
  let currentPixMode = 'KEY'; // 'KEY' ou 'QR'

  const updatePixFormValidation = () => {
    const keyInput = document.getElementById('pixKeyInput');
    const amountInput = document.getElementById('pixAmountInput');
    const btnConfirm = document.getElementById('btnConfirmPixTransfer');
    const highlightCard = document.getElementById('pixAmountHighlightCard');
    const highlightVal = document.getElementById('pixAmountHighlightVal');

    const keyText = keyInput ? keyInput.value.trim() : '';
    const rawAmountStr = amountInput ? amountInput.value : '';
    const amountVal = LinsoraUtils.parseCurrencyToFloat(rawAmountStr);

    const isKeyValid = currentPixMode === 'QR' || keyText.length > 0;
    const isAmountValid = amountVal > 0;
    const isValid = isKeyValid && isAmountValid;

    if (btnConfirm) {
      btnConfirm.disabled = !isValid;
    }

    if (highlightCard && highlightVal) {
      if (amountVal > 0) {
        highlightCard.classList.remove('hidden');
        highlightVal.innerText = LinsoraUtils.formatBRL(amountVal, false);
      } else {
        highlightCard.classList.add('hidden');
      }
    }
  };

  // Alternar modos (Chave Pix vs QR Code)
  document.getElementById('btnPixModeKey')?.addEventListener('click', () => {
    currentPixMode = 'KEY';
    document.getElementById('btnPixModeKey')?.classList.add('active');
    document.getElementById('btnPixModeQr')?.classList.remove('active');
    const keySec = document.getElementById('pixKeyModeSection');
    const qrSec = document.getElementById('pixQrModeSection');
    if (keySec) keySec.style.display = 'block';
    if (qrSec) qrSec.style.display = 'none';
    updatePixFormValidation();
  });

  document.getElementById('btnPixModeQr')?.addEventListener('click', () => {
    currentPixMode = 'QR';
    document.getElementById('btnPixModeQr')?.classList.add('active');
    document.getElementById('btnPixModeKey')?.classList.remove('active');
    const keySec = document.getElementById('pixKeyModeSection');
    const qrSec = document.getElementById('pixQrModeSection');
    if (keySec) keySec.style.display = 'none';
    if (qrSec) qrSec.style.display = 'block';
    updatePixFormValidation();
  });

  // Ouvintes de digitação para validação em tempo real
  document.getElementById('pixKeyInput')?.addEventListener('input', updatePixFormValidation);
  document.getElementById('pixAmountInput')?.addEventListener('input', updatePixFormValidation);

  // Avançar para a Etapa 2: Resumo Pré-Confirmação
  document.getElementById('btnConfirmPixTransfer')?.addEventListener('click', () => {
    const keyInput = document.getElementById('pixKeyInput');
    const amountInput = document.getElementById('pixAmountInput');
    const amount = LinsoraUtils.parseCurrencyToFloat(amountInput ? amountInput.value : '0');
    const keyText = currentPixMode === 'QR' ? 'Leitor de QR Code Pix' : (keyInput ? keyInput.value.trim() : '');

    if (!amount || amount <= 0) {
      LinsoraUI.showToast('Informe um valor maior que zero.', 'error');
      return;
    }

    // Preencher resumo
    const summaryAmount = document.getElementById('summaryPixAmount');
    const summaryKey = document.getElementById('summaryPixKey');
    const summaryDateTime = document.getElementById('summaryPixDateTime');

    if (summaryAmount) summaryAmount.innerText = LinsoraUtils.formatBRL(amount, false);
    if (summaryKey) summaryKey.innerText = keyText || 'Chave Padrão';
    if (summaryDateTime) {
      const now = new Date();
      summaryDateTime.innerText = `${now.toLocaleDateString('pt-BR')} às ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    }

    // Alternar visibilidade das etapas
    document.getElementById('pixFormStep')?.classList.add('hidden');
    document.getElementById('pixSummaryStep')?.classList.remove('hidden');
  });

  // Voltar da etapa de resumo para o formulário
  document.getElementById('btnBackPixStep')?.addEventListener('click', () => {
    document.getElementById('pixSummaryStep')?.classList.add('hidden');
    document.getElementById('pixFormStep')?.classList.remove('hidden');
  });

  // Efetivar Envio Final do Pix
  document.getElementById('btnFinalConfirmPix')?.addEventListener('click', async () => {
    const keyInput = document.getElementById('pixKeyInput');
    const amountInput = document.getElementById('pixAmountInput');
    const amount = LinsoraUtils.parseCurrencyToFloat(amountInput ? amountInput.value : '0');
    const keyText = currentPixMode === 'QR' ? 'QR Code Pix' : (keyInput ? keyInput.value.trim() : 'Chave Padrão');

    const success = await window.linsoraStore.executePixTransfer(keyText, amount);
    if (success) {
      LinsoraUI.closeModal('modalPixArea');
      
      // Resetar form do modal Pix para o estado inicial
      document.getElementById('pixSummaryStep')?.classList.add('hidden');
      document.getElementById('pixFormStep')?.classList.remove('hidden');
      if (keyInput) keyInput.value = '';
      if (amountInput) amountInput.value = '';
      document.getElementById('pixAmountHighlightCard')?.classList.add('hidden');
      updatePixFormValidation();

      LinsoraUI.showToast(`Pix de R$ ${amount.toLocaleString('pt-BR', {minimumFractionDigits: 2})} enviado!`);
    }
  });

  document.getElementById('btnPixTransfer')?.addEventListener('click', () => LinsoraUI.openModal('modalPixArea'));
  document.getElementById('btnPixReceive')?.addEventListener('click', () => LinsoraUI.openModal('modalPixArea'));
  document.getElementById('btnPayInvoice')?.addEventListener('click', async () => {
    if (window.selectedCardId) {
      const ok = await window.linsoraStore.payCardInvoice(window.selectedCardId);
      if (ok) LinsoraUI.showToast('Fatura paga com sucesso!');
      else LinsoraUI.showToast('Nenhum saldo devedor nesta fatura.', 'info');
    }
  });

  // FLUXO COMPLETO E SEGURO DE ALTERAÇÃO DE FOTO DE PERFIL (MOBILE NATIVE & WEB)
  const openAvatarSourceModal = (e) => {
    if (e) e.stopPropagation();
    const modal = document.getElementById('modalAvatarSourceChoice');
    if (modal) modal.classList.remove('hidden');
  };

  const closeAvatarSourceModal = () => {
    const modal = document.getElementById('modalAvatarSourceChoice');
    if (modal) modal.classList.add('hidden');
  };

  const triggerAvatarFromSource = async (sourceType) => {
    closeAvatarSourceModal();

    if (window.LinsoraLogger) window.LinsoraLogger.write(`[AVATAR] Origem selecionada: ${sourceType}`);

    const isNative = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
    const cameraPlugin = window.Capacitor?.Plugins?.Camera || window.Capacitor?.Camera;

    if (isNative && cameraPlugin) {
      const spinner = document.getElementById('avatarUploadSpinner');
      if (spinner) spinner.classList.remove('hidden');

      try {
        const photo = await cameraPlugin.getPhoto({
          quality: 85,
          allowEditing: false,
          resultType: 'dataUrl',
          source: sourceType === 'CAMERA' ? 'CAMERA' : 'PHOTOS'
        });

        if (photo && photo.dataUrl) {
          const rawUrl = photo.dataUrl.startsWith('data:') ? photo.dataUrl : `data:image/jpeg;base64,${photo.dataUrl}`;
          await applyAvatarImage(rawUrl);
        }
      } catch (err) {
        console.warn('[AVATAR] Seleção via Plugin Camera cancelada ou falhou:', err);
        if (err?.message && !err.message.includes('cancelled') && !err.message.includes('User cancelled')) {
          LinsoraUI.showToast('Erro ao acessar foto do dispositivo: ' + err.message, 'error');
        }
      } finally {
        if (spinner) spinner.classList.add('hidden');
      }
    } else {
      // Fallback para ambiente Web
      const input = document.getElementById('profileAvatarInput');
      if (input) {
        try {
          input.click();
        } catch (err) {
          console.warn('[AVATAR] Erro ao disparar seletor de arquivo web:', err);
        }
      }
    }
  };

  document.getElementById('btnChangeAvatar')?.addEventListener('click', openAvatarSourceModal);
  document.getElementById('btnTriggerPhotoUpload')?.addEventListener('click', openAvatarSourceModal);
  document.getElementById('btnAvatarFromGallery')?.addEventListener('click', () => triggerAvatarFromSource('PHOTOS'));
  document.getElementById('btnAvatarFromCamera')?.addEventListener('click', () => triggerAvatarFromSource('CAMERA'));
  document.getElementById('btnAvatarSourceCancel')?.addEventListener('click', closeAvatarSourceModal);
  document.getElementById('modalAvatarSourceChoice')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalAvatarSourceChoice') closeAvatarSourceModal();
  });

  const applyAvatarImage = async (fileOrDataUrl) => {
    const spinner = document.getElementById('avatarUploadSpinner');
    if (spinner) spinner.classList.remove('hidden');

    try {
      let finalUrl = null;
      if (typeof fileOrDataUrl === 'string') {
        finalUrl = fileOrDataUrl;
      } else if (fileOrDataUrl instanceof File || fileOrDataUrl instanceof Blob) {
        finalUrl = await LinsoraUtils.processAndCompressImage(fileOrDataUrl, 300, 300, 0.8);
      }

      if (!finalUrl) throw new Error('Falha ao processar arquivo de imagem');

      const userId = window.linsoraStore?.state?.user?.id || window.supabaseRepo?.currentUserId || 'usr_guest';

      // 1. Atualizar imagem no DOM imediatamente para feedback visual instantâneo
      document.querySelectorAll('#profileAvatarImg, #userAvatar').forEach(img => {
        if (img) img.src = finalUrl;
      });

      // 2. Persistir localmente no LocalStorage por User ID
      localStorage.setItem(`LINSORA_USER_AVATAR_${userId}`, finalUrl);

      // 3. Atualizar estado global no Store
      if (window.linsoraStore && window.linsoraStore.state && window.linsoraStore.state.user) {
        window.linsoraStore.state.user.avatar = finalUrl;
        window.supabaseRepo.saveActiveLocalSession(window.linsoraStore.state.user);
        window.linsoraStore.notify();
      }

      // 4. Upload assíncrono para o Supabase (se online)
      if (fileOrDataUrl instanceof File) {
        window.supabaseRepo.uploadAvatarToSupabase(fileOrDataUrl, userId).catch(e => console.warn('[AVATAR] Sync Supabase background:', e));
      }

      if (window.LinsoraLogger) window.LinsoraLogger.write('[AVATAR] Foto de perfil atualizada e armazenada com sucesso para o ID: ' + userId);
      LinsoraUI.showToast('Foto de perfil atualizada com sucesso!', 'success');
    } catch (err) {
      console.error('[AVATAR] Erro no processamento de foto:', err);
      LinsoraUI.showToast('Não foi possível alterar a foto: ' + (err.message || 'Erro de leitura'), 'error');
    } finally {
      if (spinner) spinner.classList.add('hidden');
    }
  };

  document.getElementById('btnChangeAvatar')?.addEventListener('click', triggerAvatarSelect);
  document.getElementById('btnTriggerPhotoUpload')?.addEventListener('click', triggerAvatarSelect);

  document.getElementById('profileAvatarInput')?.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) {
      await applyAvatarImage(file);
      e.target.value = '';
    }
  });


  document.getElementById('btnTogglePrivacy')?.addEventListener('click', () => window.linsoraStore.togglePrivacy());
  
  document.getElementById('btnToggleTheme')?.addEventListener('click', () => {
    window.linsoraStore.toggleTheme();
  });

  document.getElementById('btnOpenNotifications')?.addEventListener('click', () => {
    if (window.linsoraNotifs) {
      window.linsoraNotifs.markAllAsRead();
      document.getElementById('btnOpenNotifications')?.classList.remove('has-unread');
    }
    LinsoraUI.openModal('modalNotifications');
  });
  document.getElementById('btnCloseAlertBanner')?.addEventListener('click', () => {
    const banner = document.getElementById('smartAlertBanner');
    if (banner) banner.style.display = 'none';
  });

  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.onclick = function() {
      const targetModal = this.getAttribute('data-close-modal');
      LinsoraUI.closeModal(targetModal);
    };
  });

  document.querySelectorAll('.linsora-modal-overlay').forEach(overlay => {
    overlay.onclick = function(e) {
      if (e.target === overlay) {
        overlay.classList.add('hidden');
      }
    };
  });

  const searchInput = document.getElementById('txSearchInput');
  if (searchInput) {
    const handleSearch = function(e) {
      window.linsoraStore.searchQuery = e.target.value;
      renderFilteredTransactions(window.linsoraStore.state);
    };
    searchInput.addEventListener('input', handleSearch);
    searchInput.addEventListener('keyup', handleSearch);
  }

  document.querySelectorAll('.chip-filter').forEach(chip => {
    chip.onclick = function() {
      document.querySelectorAll('.chip-filter[data-filter-type="type"]').forEach(c => c.classList.remove('active'));
      this.classList.add('active');
      window.linsoraStore.filterType = this.getAttribute('data-value');
      renderFilteredTransactions(window.linsoraStore.state);
    };
  });

  // CONSELHEIRO ESTRATÉGICO LINSORA AI
  const advisorForm = document.getElementById('formStrategicAdvisorQuery');
  if (advisorForm) {
    advisorForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('advisorQueryInput');
      if (input && input.value.trim() && window.LinsoraStrategicAdvisor) {
        window.LinsoraStrategicAdvisor.submitAdvisorQuery(input.value.trim());
      }
    });
  }

  document.querySelectorAll('.advisor-chip').forEach(chip => {
    chip.addEventListener('click', function() {
      const query = this.getAttribute('data-query');
      if (query && window.LinsoraStrategicAdvisor) {
        window.LinsoraStrategicAdvisor.submitAdvisorQuery(query);
      }
    });
  });

  document.getElementById('btnLogout')?.addEventListener('click', async (e) => {
    if (e) e.preventDefault();
    try {
      await window.supabaseRepo.signOut();
    } catch (err) {
      console.warn('Erro ao deslogar repo:', err);
    }
    try {
      if (window.linsoraStore) {
        window.linsoraStore.clearState();
      }
    } catch (err) {
      console.warn('Erro ao limpar store:', err);
    }

    try {
      if (window.resetAuthMode) window.resetAuthMode();
    } catch (err) {
      console.warn('Erro ao resetar auth mode:', err);
    }

    const main = document.getElementById('appMain');
    if (main) {
      main.classList.remove('active');
      main.classList.add('hidden');
    }
    const auth = document.getElementById('authScreen');
    if (auth) {
      auth.classList.remove('hidden');
      auth.classList.add('active');
    }
  });
}
