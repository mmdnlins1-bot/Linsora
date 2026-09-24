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

  // 1. Setup básico: store, listeners de UI e máscaras
  //    NÃO chama renderAppUI ainda — a splash screen permanece ativa
  //    (evita o flash visual da tela de login antes da verificação de sessão)
  await window.linsoraStore.init();
  window.linsoraStore.subscribe(renderAppUI);
  setupEventListeners();
  LinsoraUtils.attachCurrencyMasks();

  // 2. Warm-up do storage: carrega os tokens Supabase do storage persistente
  //    (Capacitor Preferences + localStorage) para o _supabaseMemCache ANTES
  //    de criar o cliente. Crítico para que getSession() encontre o token
  //    já na primeira chamada, inclusive após fechar totalmente o app.
  console.log('[AUDITORIA_SESSAO] Pré-aquecendo storage do Supabase...');
  if (window.supabaseRepo?.warmUpStorage) {
    await window.supabaseRepo.warmUpStorage();
  }

  // 3. Inicialização ÚNICA do SDK (o construtor não inicializa; initSupabaseSDK
  //    é idempotente e registra onAuthStateChange uma única vez).
  if (window.supabaseRepo?.initSupabaseSDK) {
    window.supabaseRepo.initSupabaseSDK();
  }

  // 4. Verificar sessão ativa — splash permanece visível durante esta operação
  console.log('[AUDITORIA_SESSAO] Inicializando app. Aguardando restauração da sessão...');
  const sessionRes = await window.supabaseRepo.checkActiveSession();
  console.log('[AUDITORIA_SESSAO] Restauração da sessão concluída. Resultado:', sessionRes?.success);

  // 5. Roteamento único e definitivo após a verificação.
  // Sessão válida entra direto no aplicativo (sem PIN/biometria).
  if (sessionRes.success) {
    // Carrega os dados do usuário e renderiza a UI com estado real
    await window.linsoraStore.loadUserData(sessionRes.user);
    renderAppUI(window.linsoraStore.state);
    grantAppAccess();
  } else {
    // Sem sessão: renderiza estado vazio e exibe tela de login
    renderAppUI(window.linsoraStore.state);
    console.log('[AUDITORIA_SESSAO] Usuário não logado. Exibindo tela de login/onboarding.');
    hideSplashScreen();
  }
});


function hideSplashScreen() {
  const splash = document.getElementById('splashScreen');
  if (splash) {
    splash.classList.remove('active');
    splash.classList.add('hidden');
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

// Exposto para os testes automatizados (tests/helpers/auth.js) acionarem
// a entrada no app sem passar pelo formulário. Sem efeito no fluxo real.
window.grantAppAccess = grantAppAccess;

function renderAppUI(state) {
  if (!state) return;

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
  LinsoraUI.renderCardsCarousel('cardsCarousel', state.cards);
  LinsoraUI.renderGoalsList('goalsGridList', state.goals);
  LinsoraUI.renderFixedBillsList('fixedBillsList', state.fixedBills);
  LinsoraUI.renderNotificationsFeed('notificationsFeed', activeNotifs);
}

function toLocalDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addLocalDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function getPeriodMonthKey(date, monthsAgo = 0) {
  const ref = new Date(date.getFullYear(), date.getMonth() - monthsAgo, 1);
  return `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}`;
}

function getTxMonthKey(tx) {
  return (tx && tx.date) ? String(tx.date).slice(0, 7) : '';
}

function isValidTxDate(tx) {
  return !!tx && /^\d{4}-\d{2}-\d{2}/.test(String(tx.date || ''));
}

/**
 * Limites do período selecionado em chaves locais YYYY-MM-DD (sem UTC,
 * sem deslocamento de dia). Retorna null para Todo Período (sem limites).
 */
function getPeriodBounds() {
  const period = window.linsoraStore.filterPeriod || 'ALL';
  const today = new Date();
  const todayKey = toLocalDateKey(today);
  switch (period) {
    case 'TODAY':
      return { start: todayKey, end: todayKey };
    case 'THIS_WEEK': {
      const monday = addLocalDays(today, -((today.getDay() + 6) % 7));
      return { start: toLocalDateKey(monday), end: todayKey };
    }
    case 'LAST_7_DAYS':
      return { start: toLocalDateKey(addLocalDays(today, -6)), end: todayKey };
    case 'THIS_MONTH':
      return { start: todayKey.slice(0, 7) + '-01', end: todayKey };
    case 'LAST_30_DAYS':
      return { start: toLocalDateKey(addLocalDays(today, -29)), end: todayKey };
    case 'LAST_90_DAYS':
      return { start: toLocalDateKey(addLocalDays(today, -89)), end: todayKey };
    case 'THIS_YEAR':
      return { start: `${today.getFullYear()}-01-01`, end: todayKey };
    case 'CUSTOM': {
      const custom = window.linsoraStore.customPeriod;
      if (custom && custom.start && custom.end && custom.end >= custom.start) {
        return { start: custom.start, end: custom.end };
      }
      return null;
    }
    case 'ALL':
    default:
      return null;
  }
}

function txInBounds(tx, bounds) {
  if (!bounds) return true;
  if (!isValidTxDate(tx)) return false;
  const key = String(tx.date).slice(0, 10);
  return key >= bounds.start && key <= bounds.end;
}

function txMatchesType(tx, filterType) {
  return !filterType || filterType === 'all' || tx.type === filterType;
}

function txMatchesCategory(tx, filterCategory) {
  return !filterCategory || (tx.category || 'Outros') === filterCategory;
}

/**
 * Sincroniza os controles de filtro com o estado (após limpar ou trocar filtros).
 */
function syncExtratoFilterUI() {
  const store = window.linsoraStore;
  const periodSelect = document.getElementById('periodSelect');
  if (periodSelect) periodSelect.value = store.filterPeriod || 'ALL';

  document.querySelectorAll('.chip-filter[data-filter-type="type"]').forEach(c => {
    c.classList.toggle('active', c.getAttribute('data-value') === (store.filterType || 'all'));
  });

  const customRow = document.getElementById('customPeriodRow');
  if (customRow) customRow.classList.toggle('hidden', (store.filterPeriod || 'ALL') !== 'CUSTOM');

  const catRow = document.getElementById('categoryActiveRow');
  const catName = document.getElementById('activeCategoryName');
  if (catRow) catRow.classList.toggle('hidden', !store.filterCategory);
  if (catName) catName.innerText = store.filterCategory || '';

  const searchInput = document.getElementById('txSearchInput');
  const clearSearch = document.getElementById('btnClearSearch');
  if (searchInput && document.activeElement !== searchInput) searchInput.value = store.searchQuery || '';
  if (clearSearch) clearSearch.classList.toggle('hidden', !(store.searchQuery || '').trim());

  const clearAll = document.getElementById('btnClearFilters');
  if (clearAll) {
    const hasActive = (store.filterType && store.filterType !== 'all')
      || (store.filterPeriod && store.filterPeriod !== 'ALL')
      || !!store.filterCategory
      || !!(store.searchQuery || '').trim();
    clearAll.classList.toggle('hidden', !hasActive);
  }
}

/**
 * Janela equivalente no mês anterior (mesmos números de dia, com trava no
 * tamanho do mês). Ex.: dia 24/09 → compara 01–24/09 com 01–24/08.
 */
function getEquivalentPrevWindow() {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();
  const prevLen = new Date(y, m, 0).getDate();
  const dd = Math.min(d, prevLen);
  const p = (v) => String(v).padStart(2, '0');
  const pm = m === 0 ? 11 : m - 1;
  const py = m === 0 ? y - 1 : y;
  return { start: `${py}-${p(pm + 1)}-01`, end: `${py}-${p(pm + 1)}-${p(dd)}` };
}

// Visão resumida das movimentações: no máximo 3 + "Ver todas"
let extratoExpanded = false;

function renderFilteredTransactions(state) {
  const store = window.linsoraStore;
  const all = [...(state.transactions || [])];
  const hideValues = store.isHideValues;

  // Período selecionado (datas reais, sem UTC)
  const bounds = getPeriodBounds();
  const periodTxs = all.filter(t => txInBounds(t, bounds));

  // Categoria inválida no novo contexto: remove e informa (sem travar a tela)
  let activeCat = store.filterCategory;
  if (activeCat) {
    const stillValid = periodTxs.some(t => txMatchesType(t, store.filterType) && txMatchesCategory(t, activeCat));
    if (!stillValid) {
      store.filterCategory = null;
      activeCat = null;
      LinsoraUI.showToast(`Sem movimentações de categoria para os filtros atuais.`, 'info');
    }
  }

  // Conjunto combinado (período + tipo + categoria) move resumo e análise
  const combined = periodTxs.filter(t => txMatchesType(t, store.filterType) && txMatchesCategory(t, activeCat));

  // Lista: combinado + busca textual
  let list = [...combined];
  const query = (store.searchQuery || '').toLowerCase();
  if (query) {
    list = list.filter(t =>
      t.description.toLowerCase().includes(query) ||
      t.category.toLowerCase().includes(query) ||
      t.account.toLowerCase().includes(query)
    );
  }

  LinsoraUI.renderTransactionsList('fullTransactionsList', extratoExpanded ? list : list.slice(0, 3));

  const countEl = document.getElementById('extratoListCount');
  if (countEl) countEl.innerText = list.length === 1 ? '1 movimentação' : `${list.length} movimentações`;

  const toggleBtn = document.getElementById('btnToggleMovements');
  if (toggleBtn) {
    if (list.length > 3) {
      toggleBtn.classList.remove('hidden');
      toggleBtn.innerText = extratoExpanded ? 'Ver menos' : `Ver todas (${list.length})`;
    } else {
      toggleBtn.classList.add('hidden');
    }
  }

  // Resumo do período + filtros (somente dados reais do conjunto combinado)
  const periodIncome = combined.filter(t => t.type === 'RECEITA').reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
  const periodExpense = combined.filter(t => t.type === 'DESPESA').reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
  const periodBalance = periodIncome - periodExpense;

  const incomeEl = document.getElementById('periodIncome');
  if (incomeEl) incomeEl.innerText = LinsoraUtils.formatBRL(periodIncome, hideValues);

  const expenseEl = document.getElementById('periodExpense');
  if (expenseEl) expenseEl.innerText = LinsoraUtils.formatBRL(periodExpense, hideValues);

  const balanceEl = document.getElementById('periodBalance');
  if (balanceEl) {
    balanceEl.innerText = LinsoraUtils.formatBRL(periodBalance, hideValues);
    balanceEl.className = `summary-val ${periodBalance >= 0 ? 'positive' : 'negative'}`;
  }

  // Título da análise reflete o filtro de categoria
  const analysisTitle = document.getElementById('extratoAnalysisTitle');
  if (analysisTitle) analysisTitle.innerText = activeCat ? `Análise de ${activeCat}` : 'Análise Financeira';

  // Estado sem dados: mensagens claras, sem gráficos ou indicadores
  const hasPeriodData = periodTxs.length > 0;
  const emptyBlock = document.getElementById('extratoEmptyBlock');
  if (emptyBlock) emptyBlock.classList.toggle('hidden', hasPeriodData);

  const summaryBar = document.getElementById('periodSummaryBar');
  if (summaryBar) summaryBar.classList.toggle('hidden', !hasPeriodData || !!activeCat);

  const analysisSection = document.getElementById('extratoAnalysisSection');
  if (analysisSection) analysisSection.classList.toggle('hidden', !hasPeriodData);

  // Análise: conjunto combinado + comparação com o mês anterior (modo mensal).
  // Com categoria, a comparação usa a janela equivalente do mês anterior.
  if (hasPeriodData) {
    const showComparison = (store.filterPeriod || 'ALL') === 'THIS_MONTH';
    const prevKey = getPeriodMonthKey(new Date(), 1);
    const prevBase = showComparison ? all.filter(t => getTxMonthKey(t) === prevKey) : [];
    const prevTxs = prevBase.filter(t => txMatchesType(t, store.filterType) && txMatchesCategory(t, activeCat));
    const distBase = activeCat ? periodTxs.filter(t => txMatchesType(t, store.filterType)) : combined;
    let catCompare = null;
    if (showComparison && activeCat) {
      const win = getEquivalentPrevWindow();
      const inPrevWin = (t) => isValidTxDate(t) && String(t.date).slice(0, 10) >= win.start && String(t.date).slice(0, 10) <= win.end;
      const catExpenseOf = (arr) => arr
        .filter(t => t.type === 'DESPESA' && (t.category || 'Outros') === activeCat)
        .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
      // Janela atual = próprio período (Este mês = dia 01 → hoje); anterior = equivalente
      catCompare = { curr: catExpenseOf(periodTxs), prev: catExpenseOf(all.filter(inPrevWin)) };
    }
    LinsoraUI.renderExtratoAnalysis('extratoAnalysisContainer', {
      combined, period: periodTxs, dist: distBase, prev: prevTxs,
      showComparison, activeCategory: activeCat, catCompare,
    });
  } else {
    LinsoraUI.renderExtratoAnalysis('extratoAnalysisContainer', {});
  }

  syncExtratoFilterUI();
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

  // ETAPA 6B: o ✕ do modal de escuta reutiliza o cancelamento existente,
  // interrompendo o reconhecimento em vez de apenas ocultar o modal.
  document.getElementById('btnCloseVoiceListening')?.addEventListener('click', () => {
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

  // FLUXO COMPLETO DE UPLOAD DE FOTO DE PERFIL
  const processAndUploadAvatarDataUrl = async (dataUrl) => {
    const spinner = document.getElementById('avatarUploadSpinner');
    if (spinner) spinner.classList.remove('hidden');

    try {
      let finalUrl = dataUrl;

      // Se o cliente Supabase estiver autenticado, tenta salvar no bucket de avatars
      if (window.supabaseRepo && window.supabaseRepo.supabase && window.supabaseRepo.currentUserId && window.supabaseRepo.currentUserId !== 'guest') {
        try {
          const userId = window.supabaseRepo.currentUserId;
          const fileName = `avatar_${userId}_${Date.now()}.jpg`;
          const blob = LinsoraUtils.dataURItoBlob(dataUrl);

          const { data, error } = await window.supabaseRepo.supabase.storage
            .from('avatars')
            .upload(fileName, blob, { upsert: true, contentType: 'image/jpeg' });

          if (!error && data) {
            const { data: publicUrlData } = window.supabaseRepo.supabase.storage
              .from('avatars')
              .getPublicUrl(fileName);
            if (publicUrlData && publicUrlData.publicUrl) {
              finalUrl = publicUrlData.publicUrl;
            }
          }
        } catch (supErr) {
          console.warn('Fallback para imagem de cache local:', supErr);
        }
      }

      // Persistência no Estado (Garante salvamento no LocalStorage)
      if (window.linsoraStore && window.linsoraStore.state && window.linsoraStore.state.user) {
        window.linsoraStore.state.user.avatar = finalUrl;
        window.linsoraStore.notify(); // Aciona syncUp e saveDbData
      }

      // Atualiza UI Instantaneamente
      const avatarImg = document.getElementById('profileAvatarImg');
      if (avatarImg) avatarImg.src = finalUrl;
      const userAvatarHeader = document.getElementById('userAvatar');
      if (userAvatarHeader) userAvatarHeader.src = finalUrl;

      LinsoraUI.showToast('Foto de perfil atualizada com sucesso', 'success');

    } catch (err) {
      console.error('Erro ao processar foto:', err);
      LinsoraUI.showToast('Erro ao processar foto. Tente novamente.', 'error');
    } finally {
      if (spinner) spinner.classList.add('hidden');
    }
  };

  const triggerAvatarSelect = () => {
    console.log('Iniciando seleção de avatar com HTML5 Input nativo...');
    const input = document.getElementById('profileAvatarInput');
    if (input) input.click();
  };
  
  const btnChangeAvatar = document.getElementById('btnChangeAvatar');
  if (btnChangeAvatar) btnChangeAvatar.addEventListener('click', triggerAvatarSelect);
  
  const btnTriggerPhotoUpload = document.getElementById('btnTriggerPhotoUpload');
  if (btnTriggerPhotoUpload) btnTriggerPhotoUpload.addEventListener('click', triggerAvatarSelect);

  const profileAvatarInput = document.getElementById('profileAvatarInput');
  if (profileAvatarInput) {
    profileAvatarInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      const spinner = document.getElementById('avatarUploadSpinner');
      if (spinner) spinner.classList.remove('hidden');

      try {
        // Compressão via Canvas (Garante que funcione em WebView/Android)
        const compressedDataUrl = await LinsoraUtils.processAndCompressImage(file, 400, 400, 0.7);
        await processAndUploadAvatarDataUrl(compressedDataUrl);
      } catch (err) {
        console.error('Erro ao comprimir imagem local:', err);
        LinsoraUI.showToast('Erro ao processar arquivo.', 'error');
      } finally {
        if (spinner) spinner.classList.add('hidden');
        profileAvatarInput.value = ''; // Reset do input
      }
    });
  }

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
        // ETAPA 6B: fechar a escuta pelo backdrop também interrompe o
        // reconhecimento (mesmo defeito do ✕). Demais modais inalterados.
        if (overlay.id === 'modalVoiceListening' && window.VoiceAssistantUI) {
          window.VoiceAssistantUI.cancelVoice();
        } else {
          overlay.classList.add('hidden');
        }
      }
    };
  });

  const searchInput = document.getElementById('txSearchInput');
  if (searchInput) {
    searchInput.oninput = function(e) {
      window.linsoraStore.searchQuery = e.target.value;
      renderFilteredTransactions(window.linsoraStore.state);
    };
  }

  document.getElementById('btnClearSearch')?.addEventListener('click', () => {
    window.linsoraStore.searchQuery = '';
    const searchInputEl = document.getElementById('txSearchInput');
    if (searchInputEl) searchInputEl.value = '';
    renderFilteredTransactions(window.linsoraStore.state);
  });

  // Categorias clicáveis na análise (delegação única: sem múltiplos listeners)
  const analysisContainer = document.getElementById('extratoAnalysisContainer');
  const toggleCategoryFilter = (row) => {
    if (!row || !row.getAttribute) return;
    let cat = null;
    try {
      cat = decodeURIComponent(row.getAttribute('data-category') || '');
    } catch (err) {
      cat = null;
    }
    if (!cat) return;
    window.linsoraStore.filterCategory = window.linsoraStore.filterCategory === cat ? null : cat;
    renderFilteredTransactions(window.linsoraStore.state);
  };
  analysisContainer?.addEventListener('click', (e) => {
    const row = e.target && e.target.closest ? e.target.closest('[data-category]') : null;
    if (row) toggleCategoryFilter(row);
  });
  analysisContainer?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target && e.target.closest ? e.target.closest('[data-category]') : null;
    if (row) {
      e.preventDefault();
      toggleCategoryFilter(row);
    }
  });

  document.getElementById('btnActiveCategory')?.addEventListener('click', () => {
    window.linsoraStore.filterCategory = null;
    renderFilteredTransactions(window.linsoraStore.state);
  });

  document.getElementById('btnToggleMovements')?.addEventListener('click', () => {
    extratoExpanded = !extratoExpanded;
    renderFilteredTransactions(window.linsoraStore.state);
  });

  document.getElementById('btnClearFilters')?.addEventListener('click', () => {
    window.linsoraStore.filterType = 'all';
    window.linsoraStore.filterPeriod = 'ALL';
    window.linsoraStore.filterCategory = null;
    window.linsoraStore.customPeriod = null;
    window.linsoraStore.searchQuery = '';
    const searchInputEl = document.getElementById('txSearchInput');
    if (searchInputEl) searchInputEl.value = '';
    renderFilteredTransactions(window.linsoraStore.state);
  });

  const periodSelect = document.getElementById('periodSelect');
  if (periodSelect) {
    periodSelect.onchange = function() {
      const value = this.value;
      window.linsoraStore.filterPeriod = value;
      if (value === 'CUSTOM') {
        // Preserva as datas já escolhidas; pré-preenche com o mês atual
        // somente na primeira entrada ou se o estado estiver inválido
        const current = window.linsoraStore.customPeriod;
        if (!current || !current.start || !current.end || current.end < current.start) {
          const today = new Date();
          const start = `${getPeriodMonthKey(today, 0)}-01`;
          window.linsoraStore.customPeriod = { start, end: toLocalDateKey(today) };
        }
        const kept = window.linsoraStore.customPeriod;
        const startInput = document.getElementById('customStart');
        const endInput = document.getElementById('customEnd');
        if (startInput) startInput.value = kept.start;
        if (endInput) endInput.value = kept.end;
      }
      renderFilteredTransactions(window.linsoraStore.state);
    };
  }

  document.getElementById('btnApplyCustomPeriod')?.addEventListener('click', () => {
    const startInput = document.getElementById('customStart');
    const endInput = document.getElementById('customEnd');
    const start = startInput ? startInput.value : '';
    const end = endInput ? endInput.value : '';
    if (!start || !end) {
      LinsoraUI.showToast('Selecione a data inicial e a data final.', 'error');
      return;
    }
    if (end < start) {
      LinsoraUI.showToast('A data final não pode ser anterior à data inicial.', 'error');
      return;
    }
    window.linsoraStore.filterPeriod = 'CUSTOM';
    window.linsoraStore.customPeriod = { start, end };
    renderFilteredTransactions(window.linsoraStore.state);
    LinsoraUI.showToast('Período personalizado aplicado.', 'success');
  });

  document.querySelectorAll('.chip-filter').forEach(chip => {
    chip.onclick = function() {
      const group = this.getAttribute('data-filter-type');
      const value = this.getAttribute('data-value');
      if (group === 'period') {
        document.querySelectorAll('.chip-filter[data-filter-type="period"]').forEach(c => c.classList.remove('active'));
        this.classList.add('active');
        window.linsoraStore.filterPeriod = value;
      } else {
        document.querySelectorAll('.chip-filter[data-filter-type="type"]').forEach(c => c.classList.remove('active'));
        this.classList.add('active');
        window.linsoraStore.filterType = value;
      }
      renderFilteredTransactions(window.linsoraStore.state);
    };
  });

  document.getElementById('btnLogout')?.addEventListener('click', async () => {
    await window.supabaseRepo.signOut();
    if (window.linsoraStore) {
      window.linsoraStore.clearState();
    }

    if (window.resetAuthMode) window.resetAuthMode();

    const main = document.getElementById('appMain');
    if (main) main.classList.add('hidden');
    const auth = document.getElementById('authScreen');
    if (auth) auth.classList.remove('hidden');
  });
}
