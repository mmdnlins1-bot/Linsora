/**
 * ============================================================================
 * LINSORA — COMPONENTES DE INTERFACE & RENDERIZADORES (components.js)
 * Alinhamento Visual Global em Todas as Telas com Glassmorphism e Ícones Vibrantes
 * ============================================================================
 */

class LinsoraUIComponentEngine {
  constructor() {}

  /**
   * Renderiza a lista de transações com suporte a Empty State e Estilo Padronizado
   */
  renderTransactionsList(containerId, transactions = [], limit = null) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!transactions || transactions.length === 0) {
      container.innerHTML = `
        <div class="empty-state-card">
          <div class="empty-icon">💸</div>
          <p>Nenhuma transação cadastrada</p>
          <span class="empty-sub">Clique no botão **+ Nova Transação** ou nas Ações Rápidas para registrar.</span>
        </div>
      `;
      return;
    }

    const list = limit ? transactions.slice(0, limit) : transactions;
    const hideValues = window.linsoraStore.isHideValues;

    container.innerHTML = list.map(tx => {
      const isIncome = tx.type === 'RECEITA';
      const icon = LinsoraUtils.getCategoryIcon(tx.category);
      const formattedVal = (isIncome ? '+ ' : '- ') + LinsoraUtils.formatBRL(tx.amount, hideValues);
      const dateFormatted = LinsoraUtils.formatDateBR(tx.date);

      return `
        <div class="transaction-card ${isIncome ? 'income-card' : 'expense-card'}" onclick="LinsoraUI.openTxDetails('${tx.id}')">
          <div class="tx-left">
            <div class="tx-icon-wrapper ${isIncome ? 'income-glow' : 'expense-glow'}">${icon}</div>
            <div class="tx-info">
              <span class="tx-title">${LinsoraUtils.escapeHTML(tx.description)}</span>
              <span class="tx-meta">${LinsoraUtils.escapeHTML(tx.category)} • ${LinsoraUtils.escapeHTML(tx.account)} • ${dateFormatted}</span>
            </div>
          </div>
          <div class="tx-right">
            <span class="tx-amount ${isIncome ? 'income' : 'expense'}">${formattedVal}</span>
            <span class="badge-status-chip ${isIncome ? 'success' : 'danger'}">${tx.status || 'Concluído'}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  /**
   * Renderiza a Barra de Saúde Financeira Condicional
   */
  renderFinancialHealthScore(healthObj) {
    const container = document.getElementById('healthScoreWidget');
    if (!container) return;

    if (!healthObj.hasEnoughData) {
      container.innerHTML = `
        <div class="health-empty-banner">
          <span class="health-empty-icon">📊</span>
          <span class="health-empty-text">Sem dados para cálculo de saúde financeira</span>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="health-score-ring" style="border-color: ${healthObj.color};">
        <span class="health-number">${healthObj.score}</span>
        <span class="health-scale">/100</span>
      </div>
      <div class="health-info">
        <div class="health-header-row">
          <span class="health-title">Saúde Financeira</span>
          <span class="health-status-badge" style="color: ${healthObj.color};">${healthObj.label}</span>
        </div>
        <div class="health-progress-bar">
          <div class="health-progress-fill" style="width: ${healthObj.score}%; background-color: ${healthObj.color};"></div>
        </div>
        <span class="health-sub">${healthObj.sub}</span>
      </div>
    `;
  }

  /**
   * Renderiza os Cards de Resumo Financeiro ou Banner Simplificado se sem dados
   */
  renderResumoWidgets(commitmentPct, savedAmount, openInvoicesTotal, goalsAvgPct, billsCount, availableAmount, hasTxData) {
    const container = document.getElementById('resumoWidgetsContainer');
    if (!container) return;

    const hideValues = window.linsoraStore.isHideValues;

    if (!hasTxData) {
      container.innerHTML = `
        <div class="empty-resumo-banner">
          <div class="empty-resumo-info">
            <strong>Nenhum lançamento registrado no mês</strong>
            <p>Adicione receitas ou despesas para visualizar o percentual da renda comprometido, economia e saldo livre.</p>
          </div>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="resumo-widgets-grid">
        <div class="resumo-widget-card">
          <span class="widget-label">Renda Comprometida</span>
          <strong class="widget-value">${commitmentPct}%</strong>
          <div class="widget-bar"><div class="widget-bar-fill" style="width: ${commitmentPct}%; background-color: ${commitmentPct > 80 ? '#EF4444' : commitmentPct > 60 ? '#F59E0B' : '#10B981'};"></div></div>
          <span class="widget-sub">${commitmentPct > 80 ? '⚠️ Crítico' : commitmentPct > 60 ? 'Atenção' : 'Ideal'}</span>
        </div>

        <div class="resumo-widget-card">
          <span class="widget-label">Economizado no Mês</span>
          <strong class="widget-value positive">${LinsoraUtils.formatBRL(savedAmount, hideValues)}</strong>
          <span class="widget-sub">Saldo positivo retido</span>
        </div>

        <div class="resumo-widget-card">
          <span class="widget-label">Faturas Abertas</span>
          <strong class="widget-value warning">${LinsoraUtils.formatBRL(openInvoicesTotal, hideValues)}</strong>
          <span class="widget-sub">Cartões acumulados</span>
        </div>

        <div class="resumo-widget-card">
          <span class="widget-label">Progresso de Metas</span>
          <strong class="widget-value">${goalsAvgPct}%</strong>
          <div class="widget-bar"><div class="widget-bar-fill emerald" style="width: ${goalsAvgPct}%;"></div></div>
          <span class="widget-sub">Média dos objetivos</span>
        </div>
      </div>
    `;
  }

  /**
   * Renderiza o módulo de Saúde Financeira, Diagnóstico Automático e Consultoria Inteligente
   */
  renderHealthTab(state) {
    const transactions = state?.transactions || [];
    const hideValues = window.linsoraStore?.isHideValues || false;

    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    
    const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthKey = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`;

    const currentTxs = transactions.filter(t => t.date && t.date.startsWith(currentMonthKey));
    const prevTxs = transactions.filter(t => t.date && t.date.startsWith(prevMonthKey));

    const currentIncome = currentTxs.filter(t => t.type === 'RECEITA').reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
    const currentExpense = currentTxs.filter(t => t.type === 'DESPESA').reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

    const prevIncome = prevTxs.filter(t => t.type === 'RECEITA').reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
    const prevExpense = prevTxs.filter(t => t.type === 'DESPESA').reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

    let score = 70;
    let statusText = 'Estável';
    let statusClass = 'warning';
    let summaryText = '';

    const commitmentRate = currentIncome > 0 ? (currentExpense / currentIncome) * 100 : (currentExpense > 0 ? 100 : 0);
    const savingsRate = currentIncome > 0 ? Math.max(0, ((currentIncome - currentExpense) / currentIncome) * 100) : 0;

    if (transactions.length === 0) {
      score = 50;
      statusText = 'Aguardando Dados';
      statusClass = 'info';
      summaryText = 'Ainda não há dados suficientes para calcular o diagnóstico da sua saúde financeira. Comece registrando suas receitas e despesas!';
    } else {
      if (commitmentRate <= 50) {
        score = Math.min(100, Math.round(85 + (savingsRate * 0.15)));
        statusText = 'Excelente';
        statusClass = 'success';
        summaryText = `Parabéns! Sua saúde financeira está excelente. Você está comprometendo apenas ${Math.round(commitmentRate)}% da sua renda e poupando ${Math.round(savingsRate)}% das suas receitas.`;
      } else if (commitmentRate <= 75) {
        score = Math.round(70 + (savingsRate * 0.1));
        statusText = 'Equilibrada';
        statusClass = 'success';
        summaryText = `Sua saúde financeira está estável. Seus gastos comprometem ${Math.round(commitmentRate)}% das suas receitas do mês.`;
      } else if (commitmentRate <= 95) {
        score = Math.round(45 + ((100 - commitmentRate) * 0.5));
        statusText = 'Atenção';
        statusClass = 'warning';
        summaryText = `Atenção: Suas despesas comprometem ${Math.round(commitmentRate)}% das suas receitas do mês. Recomendamos atenção aos gastos discricionários.`;
      } else {
        score = Math.max(15, Math.round(30 - ((commitmentRate - 100) * 0.3)));
        statusText = 'Crítico';
        statusClass = 'danger';
        summaryText = `Alerta Crítico: Suas despesas atingiram ${Math.round(commitmentRate)}% das suas receitas. Recomendamos revisão imediata para reequilíbrio financeiro.`;
      }

      const compEl = document.getElementById('healthCommitmentRate');
      if (compEl) compEl.innerText = `${Math.round(commitmentRate)}%`;
      
      const compStatEl = document.getElementById('healthCommitmentStatus');
      if (compStatEl) compStatEl.innerText = commitmentRate <= 70 ? '🟢 Dentro do limite seguro (até 70%)' : '🟡 Alto comprometimento da renda';

      const compBadgeEl = document.getElementById('healthCommitmentBadge');
      if (compBadgeEl) {
        compBadgeEl.innerText = commitmentRate <= 50 ? 'Ideal' : commitmentRate <= 75 ? 'Seguro' : 'Alerta';
        compBadgeEl.className = `health-badge-chip ${commitmentRate <= 50 ? 'emerald' : commitmentRate <= 75 ? 'warning' : 'danger'}`;
      }

      const compFillEl = document.getElementById('healthCommitmentBarFill');
      if (compFillEl) {
        compFillEl.style.width = `${Math.min(100, Math.round(commitmentRate))}%`;
        compFillEl.style.background = commitmentRate <= 50 ? 'var(--accent-green-neon)' : commitmentRate <= 75 ? '#F59E0B' : '#EF4444';
      }

      const savEl = document.getElementById('healthSavingsRate');
      if (savEl) savEl.innerText = `${Math.round(savingsRate)}%`;

      const savStatEl = document.getElementById('healthSavingsStatus');
      if (savStatEl) savStatEl.innerText = savingsRate >= 20 ? '🚀 Meta de poupança atingida!' : '💡 Recomendado: guardar ao menos 20%';

      const savBadgeEl = document.getElementById('healthSavingsBadge');
      if (savBadgeEl) {
        savBadgeEl.innerText = savingsRate >= 20 ? 'Excelente' : savingsRate >= 10 ? 'Regular' : 'Abaixo';
        savBadgeEl.className = `health-badge-chip ${savingsRate >= 20 ? 'emerald' : savingsRate >= 10 ? 'warning' : 'danger'}`;
      }

      const savFillEl = document.getElementById('healthSavingsBarFill');
      if (savFillEl) {
        savFillEl.style.width = `${Math.min(100, Math.round(savingsRate))}%`;
      }
    }

    const numEl = document.getElementById('healthScoreNum');
    if (numEl) numEl.innerText = `${score}/100`;

    const badgeEl = document.getElementById('healthStatusBadge');
    if (badgeEl) {
      badgeEl.innerText = statusText;
      badgeEl.className = `badge-status-chip ${statusClass}`;
    }

    const fillEl = document.getElementById('healthScoreBarFill');
    if (fillEl) {
      fillEl.style.width = `${score}%`;
      fillEl.style.background = score >= 75 ? 'var(--accent-green-neon)' : (score >= 50 ? '#F59E0B' : '#EF4444');
    }

    const summaryEl = document.getElementById('healthScoreSummary');
    if (summaryEl) summaryEl.innerText = summaryText;

    this.renderHealthInsights('healthInsightsContainer', currentTxs, prevTxs, currentIncome, currentExpense, prevIncome, prevExpense, hideValues);
    this.renderCategoryVariationsGrid('healthCategoryVariationsGrid', currentTxs, prevTxs, hideValues);
  }

  renderHealthInsights(containerId, currentTxs, prevTxs, currentIncome, currentExpense, prevIncome, prevExpense, hideValues = false) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (currentTxs.length < 2 && prevTxs.length === 0) {
      container.innerHTML = `
        <div class="linsora-card insight-card info">
          <div class="insight-icon">💡</div>
          <div class="insight-content">
            <strong>Pouco Histórico Registrado</strong>
            <p>Ainda não há dados suficientes para uma comparação detalhada. Continue registrando suas transações para liberar seus diagnósticos e insights personalizados!</p>
          </div>
        </div>
      `;
      return;
    }

    const insights = [];

    // Redesenho do Maior Ofensor Orçamentário como Card de Alerta Hero
    const catCurrent = {};
    currentTxs.filter(t => t.type === 'DESPESA').forEach(t => {
      catCurrent[t.category] = (catCurrent[t.category] || 0) + Number(t.amount);
    });

    let topCategory = null;
    let topCategoryVal = 0;
    Object.entries(catCurrent).forEach(([cat, val]) => {
      if (val > topCategoryVal) {
        topCategoryVal = val;
        topCategory = cat;
      }
    });

    if (topCategory && currentExpense > 0) {
      const topPct = Math.round((topCategoryVal / currentExpense) * 100);
      const incomePct = currentIncome > 0 ? Math.round((topCategoryVal / currentIncome) * 100) : null;
      
      let tipText = '';
      if (topCategoryVal > 0) {
        tipText = `Sua categoria ${topCategory} consumiu ${LinsoraUtils.formatBRL(topCategoryVal, hideValues)} (${topPct}% das suas despesas no mês). `;
        if (incomePct !== null && incomePct > 30) {
          tipText += `Isso compromete ${incomePct}% de toda a sua renda mensal. Recomendamos estipular um teto limite para esta categoria e revisar gastos recorrentes.`;
        } else if (incomePct !== null) {
          tipText += `Uma economia de 15% nesta categoria liberaria ${LinsoraUtils.formatBRL(topCategoryVal * 0.15, hideValues)} para acelerar o progresso das suas metas!`;
        } else {
          tipText += `Acompanhe os lançamentos de ${topCategory} semanalmente para manter o controle absoluto do seu orçamento.`;
        }
      } else {
        tipText = 'Acompanhe seus lançamentos diários para manter o controle absoluto do seu orçamento.';
      }

      insights.push({
        isHeroOffender: true,
        type: 'danger',
        category: topCategory,
        amount: topCategoryVal,
        pct: topPct,
        incomePct,
        tipText
      });
    }

    if (prevExpense > 0) {
      const expenseDiffPct = Math.round(((currentExpense - prevExpense) / prevExpense) * 100);
      if (expenseDiffPct > 0) {
        insights.push({
          type: 'danger',
          icon: '📈',
          title: 'Aumento Global de Despesas',
          message: `Seus gastos totais aumentaram ${expenseDiffPct}% em relação ao mês anterior (${LinsoraUtils.formatBRL(currentExpense, hideValues)} vs ${LinsoraUtils.formatBRL(prevExpense, hideValues)}).`
        });
      } else if (expenseDiffPct < 0) {
        insights.push({
          type: 'success',
          icon: '🎉',
          title: 'Economia Conquistada',
          message: `Parabéns! Você reduziu seus gastos totais em ${Math.abs(expenseDiffPct)}% em relação ao mês anterior!`
        });
      }
    }

    const catPrev = {};
    prevTxs.filter(t => t.type === 'DESPESA').forEach(t => {
      catPrev[t.category] = (catPrev[t.category] || 0) + Number(t.amount);
    });

    Object.keys(catCurrent).forEach(cat => {
      if (cat === topCategory) return; // já destacado no hero
      const currVal = catCurrent[cat];
      const prevVal = catPrev[cat] || 0;

      if (prevVal > 0) {
        const diffPct = Math.round(((currVal - prevVal) / prevVal) * 100);
        if (diffPct >= 15) {
          insights.push({
            type: 'warning',
            icon: '⚠️',
            title: `Variação Significativa em ${cat}`,
            message: `Sua conta/despesa de ${cat} aumentou ${diffPct}% em relação ao mês passado (de ${LinsoraUtils.formatBRL(prevVal, hideValues)} para ${LinsoraUtils.formatBRL(currVal, hideValues)}).`
          });
        } else if (diffPct <= -10) {
          insights.push({
            type: 'success',
            icon: '🟢',
            title: `Redução de Custos em ${cat}`,
            message: `Você economizou ${Math.abs(diffPct)}% em ${cat} neste mês!`
          });
        }
      }
    });

    if (insights.length === 0) {
      insights.push({
        type: 'success',
        icon: '✨',
        title: 'Finanças Sob Controle',
        message: 'Seus padrões de consumo permanecem estáveis dentro da média habituada.'
      });
    }

    container.innerHTML = insights.map(i => {
      if (i.isHeroOffender) {
        return `
          <div class="linsora-card hero-offender-card">
            <div class="offender-badge-row">
              <span class="offender-alert-badge">🚨 ALERTA FINANCEIRO</span>
              <span class="offender-category-pill">${i.category}</span>
            </div>
            <h4 class="offender-title">Maior Ofensor Orçamentário</h4>
            <div class="offender-stats-grid">
              <div class="offender-stat-item">
                <span class="offender-stat-label">Valor Gasto no Mês</span>
                <strong class="offender-stat-val main-amount">${LinsoraUtils.formatBRL(i.amount, hideValues)}</strong>
              </div>
              <div class="offender-stat-item">
                <span class="offender-stat-label">Impacto no Orçamento</span>
                <strong class="offender-stat-val highlight-red">${i.pct}% <small>das despesas</small></strong>
              </div>
              ${i.incomePct !== null ? `
              <div class="offender-stat-item">
                <span class="offender-stat-label">Comprometimento Renda</span>
                <strong class="offender-stat-val">${i.incomePct}% <small>da renda total</small></strong>
              </div>
              ` : ''}
            </div>
            <div class="offender-tip-box">
              <div class="offender-tip-header">
                <span class="tip-icon">💡</span>
                <strong>Dica Prática Linsora:</strong>
              </div>
              <p>${i.tipText}</p>
            </div>
          </div>
        `;
      }
      return `
        <div class="linsora-card insight-card ${i.type}">
          <div class="insight-icon">${i.icon}</div>
          <div class="insight-content">
            <strong>${i.title}</strong>
            <p>${i.message}</p>
          </div>
        </div>
      `;
    }).join('');
  }

  renderCategoryVariationsGrid(containerId, currentTxs, prevTxs, hideValues) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const catCurrent = {};
    currentTxs.filter(t => t.type === 'DESPESA').forEach(t => {
      catCurrent[t.category] = (catCurrent[t.category] || 0) + Number(t.amount);
    });

    const catPrev = {};
    prevTxs.filter(t => t.type === 'DESPESA').forEach(t => {
      catPrev[t.category] = (catPrev[t.category] || 0) + Number(t.amount);
    });

    // Lista dinâmica de categorias ativas (categorias com lançamentos atuais/anteriores + padrão)
    const baseCats = ['Alimentação', 'Moradia', 'Transporte', 'Lazer', 'Saúde', 'Outros'];
    const activeCats = Array.from(new Set([...baseCats, ...Object.keys(catCurrent), ...Object.keys(catPrev)]));

    container.innerHTML = activeCats.map(cat => {
      const curr = catCurrent[cat] || 0;
      const prev = catPrev[cat] || 0;

      let badgeHTML = `<span class="category-variation-badge neutral">Sem dados ant.</span>`;
      if (prev > 0) {
        const pct = Math.round(((curr - prev) / prev) * 100);
        if (pct > 0) {
          badgeHTML = `<span class="category-variation-badge danger">+${pct}% 🔺</span>`;
        } else if (pct < 0) {
          badgeHTML = `<span class="category-variation-badge success">${pct}% 🔻</span>`;
        } else {
          badgeHTML = `<span class="category-variation-badge neutral">0% 🟢</span>`;
        }
      }

      return `
        <div class="linsora-card category-variation-item">
          <div class="cat-var-top">
            <span class="cat-var-name">${LinsoraUtils.getCategoryIcon(cat)} ${cat}</span>
            ${badgeHTML}
          </div>
          <div class="cat-var-val">${LinsoraUtils.formatBRL(curr, hideValues)}</div>
        </div>
      `;
    }).join('');
  }

  renderGoalsList(containerId, goals = []) {
    const container = document.getElementById(containerId);
    const overviewContainer = document.getElementById('goalsOverviewContainer');
    const insightsContainer = document.getElementById('goalsSmartInsights');
    if (!container) return;

    const hideValues = window.linsoraStore.isHideValues;

    // 1. ESTADO VAZIO INSPIRADOR
    if (!goals || goals.length === 0) {
      if (overviewContainer) overviewContainer.innerHTML = '';
      if (insightsContainer) insightsContainer.innerHTML = '';

      container.innerHTML = `
        <div class="inspired-empty-state">
          <div class="inspired-empty-icon">🎯</div>
          <h3 class="inspired-empty-title">Dê o primeiro passo para realizar seus objetivos!</h3>
          <p class="inspired-empty-desc">
            Crie metas para sua reserva de emergência, uma viagem dos sonhos ou a compra do seu primeiro veículo. 
            Defina o valor e prazo e o Linsora calcula exatamente quanto você precisa guardar por mês.
          </p>
          <button type="button" class="linsora-btn primary lg margin-top-xs" onclick="LinsoraUI.openModal('modalGoalForm')">
            🚀 Criar Minha Primeira Meta
          </button>
        </div>
      `;
      return;
    }

    // 2. VISÃO GERAL DE METAS (OVERVIEW CARD GLOBAL)
    const totalCurrent = goals.reduce((acc, g) => acc + (parseFloat(g.current) || 0), 0);
    const totalTarget = goals.reduce((acc, g) => acc + (parseFloat(g.target) || 0), 0);
    const overallPct = totalTarget > 0 ? Math.min(100, Math.round((totalCurrent / totalTarget) * 100)) : 0;

    if (overviewContainer) {
      overviewContainer.innerHTML = `
        <div class="goals-overview-card">
          <div class="goals-overview-header">
            <h3><span>🎯</span> Progresso Global das Metas</h3>
            <span class="badge-status-chip success">${overallPct}% Concluído</span>
          </div>

          <div class="limit-progress-bar" style="height: 12px; margin: 8px 0 14px 0;">
            <div class="limit-progress-fill" style="width: ${overallPct}%; background: linear-gradient(90deg, #10B981, #06B6D4, #6366F1);"></div>
          </div>

          <div class="goals-overview-grid">
            <div class="overview-metric-item">
              <span>Guardado Total</span>
              <strong style="color: var(--accent-green-neon);">${LinsoraUtils.formatBRL(totalCurrent, hideValues)}</strong>
            </div>
            <div class="overview-metric-item">
              <span>Objetivo Acumulado</span>
              <strong>${LinsoraUtils.formatBRL(totalTarget, hideValues)}</strong>
            </div>
            <div class="overview-metric-item">
              <span>Metas Ativas</span>
              <strong style="color: var(--accent-cyan);">${goals.length} metas</strong>
            </div>
          </div>
        </div>
      `;
    }

    // 3. CARDS DAS METAS INDIVIDUAIS COM APORTE RÁPIDO & CÁLCULOS
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const goalCalculations = goals.map(g => {
      const currentVal = parseFloat(g.current) || 0;
      const targetVal = parseFloat(g.target) || 0;
      const remainingVal = Math.max(0, targetVal - currentVal);
      const pct = targetVal > 0 ? Math.min(100, Math.round((currentVal / targetVal) * 100)) : 0;

      let daysLeft = null;
      let monthsLeft = 1;
      let isExpired = false;

      if (g.deadline) {
        const parts = String(g.deadline).split('-').map(Number);
        if (parts.length === 3) {
          const deadlineDate = new Date(parts[0], parts[1] - 1, parts[2], 23, 59, 59);
          const diffMs = deadlineDate.getTime() - today.getTime();
          daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

          if (daysLeft < 0 && pct < 100) {
            isExpired = true;
          } else {
            monthsLeft = Math.max(1, Math.ceil(daysLeft / 30.44));
          }
        }
      }

      const suggestedMonthly = (!isExpired && remainingVal > 0) ? (remainingVal / monthsLeft) : 0;
      const formattedDate = g.deadline ? LinsoraUtils.formatDateBR(g.deadline) : 'Sem prazo';

      return {
        ...g,
        currentVal,
        targetVal,
        remainingVal,
        pct,
        daysLeft,
        monthsLeft,
        isExpired,
        suggestedMonthly,
        formattedDate
      };
    });

    container.innerHTML = goalCalculations.map(g => {
      const isReserve = g.type === 'RESERVA' || g.category === 'RESERVA_EMERGENCIA' || (g.title && g.title.toLowerCase().includes('reserva'));
      const monthlyContribution = parseFloat(g.monthlyContribution || g.monthly_contribution) || 150;

      if (isReserve) {
        const storeState = window.linsoraStore?.state || {};
        const transactions = storeState.transactions || [];
        const now = new Date();
        const monthTx = transactions.filter(t => {
          const d = new Date(t.date || t.created_at);
          return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() && t.type === 'DESPESA';
        });
        const monthExpense = monthTx.reduce((sum, t) => sum + (Number(t.amount) || 0), 0) || 1500;
        const monthsCovered = (g.currentVal / Math.max(1, monthExpense)).toFixed(1);

        return `
          <div class="goal-item-card-enhanced reserve-card-theme" style="border-left: 4px solid #10B981;">
            <div class="goal-top">
              <span class="goal-title">🛡️ ${LinsoraUtils.escapeHTML(g.title)}</span>
              <span class="badge-status-chip success">Reserva de Emergência</span>
            </div>

            <div class="goal-values" style="margin-top: 10px;">
              <span>Acumulado Total: <strong>${LinsoraUtils.formatBRL(g.currentVal, hideValues)}</strong></span>
              <span>Aporte Mensal: <strong style="color: var(--accent-green-neon);">${LinsoraUtils.formatBRL(monthlyContribution, hideValues)}/mês</strong></span>
            </div>

            <div class="goal-monthly-suggestion" style="background: rgba(16, 185, 129, 0.1); border-color: rgba(16, 185, 129, 0.3); color: var(--accent-green-neon);">
              🛡️ Segurança Financeira: Seu saldo acumulado garante <strong>~${monthsCovered} meses</strong> de despesas cobertas!
            </div>

            <div class="goal-time-rhythm">
              <span>🔄 Função Acumulativa Contínua (Aportes Automáticos)</span>
              <span>Total Guardado: ${LinsoraUtils.formatBRL(g.currentVal, hideValues)}</span>
            </div>

            <div class="goal-card-actions">
              <button type="button" class="linsora-btn primary sm btn-deposit-goal" data-deposit-goal="${g.id}" data-deposit-title="${LinsoraUtils.escapeHTML(g.title)}">
                ➕ Registrar Aporte
              </button>
              <button type="button" class="linsora-btn secondary sm btn-edit-goal" data-goal-id="${g.id}">
                ✏️ Editar
              </button>
              <button type="button" class="linsora-btn danger sm btn-delete-goal" data-goal-id="${g.id}" data-goal-title="${LinsoraUtils.escapeHTML(g.title)}">
                🗑️ Excluir
              </button>
            </div>
          </div>
        `;
      }

      return `
        <div class="goal-item-card-enhanced">
          <div class="goal-top">
            <span class="goal-title">${g.icon || '🎯'} ${LinsoraUtils.escapeHTML(g.title)}</span>
            <span class="cat-pct-chip">${g.pct}%</span>
          </div>

          <div class="limit-progress-bar">
            <div class="limit-progress-fill" style="width: ${g.pct}%; background: ${g.pct >= 100 ? '#10B981' : g.isExpired ? '#EF4444' : 'linear-gradient(90deg, #10B981, #06B6D4)'};"></div>
          </div>

          <div class="goal-values">
            <span>Guardado: <strong>${LinsoraUtils.formatBRL(g.currentVal, hideValues)}</strong></span>
            <span>Alvo: <strong>${LinsoraUtils.formatBRL(g.targetVal, hideValues)}</strong></span>
          </div>

          ${g.pct >= 100 ? `
            <div class="goal-monthly-suggestion" style="background: rgba(16,185,129,0.12); border-color: rgba(16,185,129,0.3); color: var(--accent-green-neon);">
              🎉 Meta Concluída! Parabéns pelo seu objetivo alcançado!
            </div>
          ` : g.isExpired ? `
            <div class="goal-monthly-suggestion" style="background: rgba(239,68,68,0.12); border-color: rgba(239,68,68,0.3); color: #EF4444;">
              ⚠️ Prazo vencido em ${g.formattedDate}. Edite a meta e escolha um novo prazo para recalcular os aportes.
            </div>
          ` : `
            <div class="goal-monthly-suggestion">
              💡 Guarde <strong>${LinsoraUtils.formatBRL(g.suggestedMonthly, hideValues)}/mês</strong> até ${g.formattedDate}
            </div>
          `}

          <div class="goal-time-rhythm">
            ${g.isExpired ? `
              <span style="color: #EF4444; font-weight: 600;">⏱️ Status: Prazo Encerrado</span>
            ` : `
              <span>⏱️ Ritmo estimado: ~${g.daysLeft !== null && g.daysLeft <= 30 ? `${g.daysLeft} dias restantes` : `${g.monthsLeft} ${g.monthsLeft === 1 ? 'mês restante' : 'meses restantes'}`}</span>
            `}
            <span>Faltam: ${LinsoraUtils.formatBRL(g.remainingVal, hideValues)}</span>
          </div>

          <div class="goal-card-actions">
            ${g.pct < 100 ? `
              <button type="button" class="linsora-btn primary sm btn-deposit-goal" data-deposit-goal="${g.id}" data-deposit-title="${LinsoraUtils.escapeHTML(g.title)}">
                ➕ Aporte
              </button>
            ` : ''}
            <button type="button" class="linsora-btn secondary sm btn-edit-goal" data-goal-id="${g.id}">
              ✏️ Editar
            </button>
            <button type="button" class="linsora-btn danger sm btn-delete-goal" data-goal-id="${g.id}" data-goal-title="${LinsoraUtils.escapeHTML(g.title)}">
              🗑️ Excluir
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Adicionar eventos nos botões de ação
    container.querySelectorAll('.btn-deposit-goal').forEach(btn => {
      btn.onclick = () => {
        const goalId = btn.getAttribute('data-deposit-goal');
        const goalTitle = btn.getAttribute('data-deposit-title');
        const inputId = document.getElementById('depositGoalId');
        const titleEl = document.getElementById('depositGoalTitle');
        if (inputId) inputId.value = goalId;
        if (titleEl) titleEl.innerText = `Meta: "${goalTitle}"`;
        LinsoraUI.openModal('modalDepositGoal');
      };
    });

    container.querySelectorAll('.btn-edit-goal').forEach(btn => {
      btn.onclick = () => {
        const goalId = btn.getAttribute('data-goal-id');
        const goal = goals.find(item => item.id === goalId);
        if (goal) {
          const idInput = document.getElementById('goalIdInput');
          const titleInput = document.getElementById('goalTitleInput');
          const targetInput = document.getElementById('goalTargetInput');
          const currentInput = document.getElementById('goalCurrentInput');
          const deadlineInput = document.getElementById('goalDeadlineInput');

          if (idInput) idInput.value = goal.id;
          if (titleInput) titleInput.value = goal.title;
          if (targetInput) targetInput.value = LinsoraUtils.formatBRL(goal.target).replace('R$', '').trim();
          if (currentInput) currentInput.value = LinsoraUtils.formatBRL(goal.current).replace('R$', '').trim();
          if (deadlineInput) deadlineInput.value = goal.deadline || '';

          const modalTitle = document.querySelector('#modalGoalForm .modal-header h3');
          if (modalTitle) modalTitle.innerText = '✏️ Editar Meta Financeira';

          LinsoraUI.openModal('modalGoalForm');
        }
      };
    });

    container.querySelectorAll('.btn-delete-goal').forEach(btn => {
      btn.onclick = async () => {
        const goalId = btn.getAttribute('data-goal-id');
        const goalTitle = btn.getAttribute('data-goal-title');
        const confirmed = await LinsoraUI.showConfirmModal(goalTitle);
        if (confirmed) {
          await window.linsoraStore.deleteGoal(goalId);
          LinsoraUI.showToast(`Meta "${goalTitle}" excluída com sucesso!`, 'info');
        }
      };
    });

    // 4. INSIGHTS INTELIGENTES & RITMO DE ECONOMIA
    if (insightsContainer) {
      const monthBalance = window.linsoraStore ? window.linsoraStore.getMonthBalance() : 0;
      
      const activeValidGoals = goalCalculations.filter(g => g.pct < 100 && !g.isExpired);
      const expiredGoals = goalCalculations.filter(g => g.isExpired);

      const totalSuggestedMonthly = activeValidGoals.reduce((acc, g) => acc + g.suggestedMonthly, 0);
      const isBalanced = monthBalance >= totalSuggestedMonthly;

      let messageHTML = '';
      if (expiredGoals.length > 0) {
        messageHTML = `
          <p>
            ⚠️ <strong>Atenção:</strong> Você possui ${expiredGoals.length} meta(s) com prazo vencido (${expiredGoals.map(e => `"${LinsoraUtils.escapeHTML(e.title)}"`).join(', ')}). 
            Edite a data limite para recalcular seu plano de economia mensal.
            ${activeValidGoals.length > 0 ? `<br>Para as metas ativas, o aporte mensal sugerido é de <strong>${LinsoraUtils.formatBRL(totalSuggestedMonthly, hideValues)}/mês</strong>.` : ''}
          </p>
        `;
      } else if (activeValidGoals.length > 0) {
        messageHTML = `
          <p>
            Para atingir todas as suas ${activeValidGoals.length} metas ativas nos prazos estipulados, o aporte mensal sugerido é de 
            <strong>${LinsoraUtils.formatBRL(totalSuggestedMonthly, hideValues)}/mês</strong>. 
            ${isBalanced ? 
              'Seu saldo mensal atual cobre confortavelmente seus aportes! Continue no mesmo ritmo.' : 
              'Dica: Reavalie algumas despesas não essenciais para manter seus aportes no prazo.'}
          </p>
        `;
      } else {
        messageHTML = `
          <p>🎉 Todas as suas metas foram concluídas! Crie novos objetivos financeiros para continuar evoluindo.</p>
        `;
      }

      insightsContainer.innerHTML = `
        <div class="goals-smart-insights-card">
          <div class="insights-icon">${expiredGoals.length > 0 ? '⚠️' : '💡'}</div>
          <div class="insights-body">
            <strong>Inteligência de Metas Linsora</strong>
            ${messageHTML}
          </div>
        </div>
      `;
    }
  }

  renderFixedBillsList(containerId, bills = []) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const totalSum = bills.reduce((acc, b) => acc + b.amount, 0);
    const badge = document.getElementById('fixedBillsTotalBadge');
    if (badge) badge.innerText = `Total: ${LinsoraUtils.formatBRL(totalSum, window.linsoraStore.isHideValues)}/mês`;

    if (!bills || bills.length === 0) {
      container.innerHTML = `
        <div class="empty-state-card">
          <div class="empty-icon">📅</div>
          <p>Nenhuma conta fixa mensal cadastrada</p>
        </div>
      `;
      return;
    }

    const hideValues = window.linsoraStore.isHideValues;

    container.innerHTML = bills.map(b => `
      <div class="fixed-bill-card">
        <div style="display:flex; align-items:center; gap:10px;">
          <div class="fixed-bill-icon">📅</div>
          <div>
            <strong style="font-size:13.5px;">${LinsoraUtils.escapeHTML(b.title)}</strong>
            <span style="display:block; font-size:11px; color:var(--text-muted);">Vence dia ${b.dueDay}</span>
          </div>
        </div>
        <strong style="font-size:14px; color:var(--accent-red);">${LinsoraUtils.formatBRL(b.amount, hideValues)}</strong>
      </div>
    `).join('');
  }

  renderNotificationsFeed(containerId, notifs = []) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!notifs || notifs.length === 0) {
      container.innerHTML = `<div class="empty-state-card"><p>Nenhum alerta recente.</p></div>`;
      return;
    }

    container.innerHTML = notifs.map(n => `
      <div class="notification-item-card ${n.type}">
        <strong>${n.title}</strong>
        <p>${n.message}</p>
      </div>
    `).join('');
  }

  openTxDetails(txId) {
    const tx = window.linsoraStore.state.transactions.find(t => t.id === txId);
    if (!tx) return;

    window.selectedTxId = txId;
    const container = document.getElementById('txDetailViewContent');
    const hideValues = window.linsoraStore.isHideValues;

    if (container) {
      container.innerHTML = `
        <div class="tx-detail-amount ${tx.type === 'RECEITA' ? 'income' : 'expense'}">
          ${tx.type === 'RECEITA' ? '+ ' : '- '} ${LinsoraUtils.formatBRL(tx.amount, hideValues)}
        </div>
        <div style="font-size:14px; text-align:center; color:var(--text-muted); margin-bottom:12px;">
          ${LinsoraUtils.escapeHTML(tx.description)}
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; font-size:13px; background:var(--bg-input); padding:12px; border-radius:var(--radius-md);">
          <div><span style="color:var(--text-muted); font-size:11px; display:block;">Categoria</span><strong>${LinsoraUtils.escapeHTML(tx.category)}</strong></div>
          <div><span style="color:var(--text-muted); font-size:11px; display:block;">Data</span><strong>${LinsoraUtils.formatDateBR(tx.date)}</strong></div>
          <div><span style="color:var(--text-muted); font-size:11px; display:block;">Conta</span><strong>${LinsoraUtils.escapeHTML(tx.account)}</strong></div>
          <div><span style="color:var(--text-muted); font-size:11px; display:block;">Repetição</span><strong>${LinsoraUtils.translateRepetition(tx.repetition)}</strong></div>
        </div>
      `;
    }

    this.openModal('modalTransactionDetails');
  }

  updateCategoryDropdown(type = 'DESPESA') {
    const categories = LinsoraUtils.getCategoriesByType(type);
    const dropdown = document.getElementById('txCategory');
    if (dropdown) {
      dropdown.innerHTML = categories.map(c => `<option value="${c}">${c}</option>`).join('');
    }
  }

  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('hidden');
  }

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('hidden');
  }

  /**
   * Exibe o modal nativo de confirmação de exclusão do Linsora.
   * Substitui o window.confirm() padrão do navegador.
   * @param {string} itemName - Nome do item a ser excluído
   * @returns {Promise<boolean>} - true se o usuário confirmou, false se cancelou
   */
  showConfirmModal(itemName) {
    return new Promise((resolve) => {
      const modal   = document.getElementById('modalConfirmDelete');
      const msgEl   = document.getElementById('confirmDeleteMsg');
      const btnOk   = document.getElementById('btnConfirmDeleteConfirm');
      const btnCancel = document.getElementById('btnConfirmDeleteCancel');

      if (!modal || !msgEl || !btnOk || !btnCancel) {
        // Fallback gracioso se o modal ainda não existir no DOM
        resolve(window.confirm(`Tem certeza que deseja excluir "${itemName}"?`));
        return;
      }

      msgEl.textContent = `Tem certeza que deseja excluir "${itemName}"? Esta ação não pode ser desfeita.`;

      const cleanup = () => {
        modal.classList.add('hidden');
        btnOk.removeEventListener('click', onConfirm);
        btnCancel.removeEventListener('click', onCancel);
        modal.removeEventListener('click', onBackdrop);
      };

      const onConfirm = () => { cleanup(); resolve(true); };
      const onCancel  = () => { cleanup(); resolve(false); };
      const onBackdrop = (e) => { if (e.target === modal) onCancel(); };

      btnOk.addEventListener('click', onConfirm);
      btnCancel.addEventListener('click', onCancel);
      modal.addEventListener('click', onBackdrop);

      modal.classList.remove('hidden');
    });
  }

  /**
   * Renderiza o carrossel de cartões de crédito e atualiza a exibição da fatura selecionada
   */
  renderCardsCarousel(containerId, cards = []) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!cards || cards.length === 0) {
      container.innerHTML = `
        <div class="empty-state-card" style="width: 100%;">
          <div class="empty-icon">💳</div>
          <p>Nenhum cartão cadastrado</p>
          <span class="empty-sub">Clique em **+ Novo Cartão** para adicionar seu primeiro cartão de crédito.</span>
        </div>
      `;
      this.updateFaturaDetailsCard(null);
      return;
    }

    if (!window.selectedCardId || !cards.some(c => c.id === window.selectedCardId)) {
      window.selectedCardId = cards[0].id;
    }

    container.innerHTML = cards.map(card => {
      const isSelected = card.id === window.selectedCardId;
      const colorClass = card.colorClass || 'nubank';
      const last4 = card.last4 || '0000';
      const brandUpper = (card.brand || 'MASTERCARD').toUpperCase();

      return `
        <div class="credit-card-physical ${colorClass} ${isSelected ? 'selected' : ''}" onclick="LinsoraUI.selectCard('${card.id}')">
          <div class="cc-top">
            <div class="cc-chip"></div>
            <span class="cc-flag">${LinsoraUtils.escapeHTML(brandUpper)}</span>
          </div>
          <div class="cc-number">•••• •••• •••• ${LinsoraUtils.escapeHTML(last4)}</div>
          <div class="cc-bottom">
            <span>${LinsoraUtils.escapeHTML(card.name)}</span>
            <span>Venc. Dia ${card.dueDay || 10}</span>
          </div>
        </div>
      `;
    }).join('');

    const selectedCard = cards.find(c => c.id === window.selectedCardId) || cards[0];
    this.updateFaturaDetailsCard(selectedCard);
  }

  selectCard(cardId) {
    window.selectedCardId = cardId;
    const cards = (window.linsoraStore && window.linsoraStore.state && window.linsoraStore.state.cards) || [];
    this.renderCardsCarousel('cardsCarousel', cards);
  }

  updateFaturaDetailsCard(card) {
    const cardNameEl = document.getElementById('faturaCardName');
    const statusBadgeEl = document.getElementById('faturaStatusBadge');
    const totalValEl = document.getElementById('faturaTotalValue');
    const limitUsedEl = document.getElementById('limitUsedText');
    const limitAvailEl = document.getElementById('limitAvailText');
    const limitFillEl = document.getElementById('limitProgressFill');
    const closingDateEl = document.getElementById('faturaClosingDate');
    const dueDateEl = document.getElementById('faturaDueDate');
    const bestDayEl = document.getElementById('faturaBestDay');

    if (!card) {
      if (cardNameEl) cardNameEl.innerText = 'Nenhum cartão selecionado';
      if (statusBadgeEl) {
        statusBadgeEl.innerText = 'Sem Cartão';
        statusBadgeEl.className = 'badge-status-chip info';
      }
      if (totalValEl) totalValEl.innerText = 'R$ 0,00';
      if (limitUsedEl) limitUsedEl.innerText = 'R$ 0,00';
      if (limitAvailEl) limitAvailEl.innerText = 'R$ 0,00';
      if (limitFillEl) limitFillEl.style.width = '0%';
      if (closingDateEl) closingDateEl.innerText = '--';
      if (dueDateEl) dueDateEl.innerText = '--';
      if (bestDayEl) bestDayEl.innerText = '--';
      return;
    }

    const hideValues = window.linsoraStore ? window.linsoraStore.isHideValues : false;
    const limitTotal = parseFloat(card.limitTotal) || 0;
    const limitUsed = parseFloat(card.limitUsed) || 0;
    const limitAvail = Math.max(0, limitTotal - limitUsed);
    const limitPct = limitTotal > 0 ? Math.min(100, Math.round((limitUsed / limitTotal) * 100)) : 0;

    if (cardNameEl) cardNameEl.innerText = card.name;
    if (statusBadgeEl) {
      if (limitUsed === 0) {
        statusBadgeEl.innerText = 'Paga / Zerada 🟢';
        statusBadgeEl.className = 'badge-status-chip success';
      } else {
        statusBadgeEl.innerText = `Fatura Aberta (${limitPct}%) 🟡`;
        statusBadgeEl.className = 'badge-status-chip warning';
      }
    }

    if (totalValEl) totalValEl.innerText = LinsoraUtils.formatBRL(limitUsed, hideValues);
    if (limitUsedEl) limitUsedEl.innerText = LinsoraUtils.formatBRL(limitUsed, hideValues);
    if (limitAvailEl) limitAvailEl.innerText = LinsoraUtils.formatBRL(limitAvail, hideValues);
    if (limitFillEl) limitFillEl.style.width = `${limitPct}%`;

    const closingDay = card.closingDay || 15;
    const dueDay = card.dueDay || 22;
    const bestDay = closingDay + 1 > 30 ? 1 : closingDay + 1;

    if (closingDateEl) closingDateEl.innerText = `Dia ${closingDay}`;
    if (dueDateEl) dueDateEl.innerText = `Dia ${dueDay}`;
    if (bestDayEl) bestDayEl.innerText = `Dia ${bestDay}`;
  }

  showToast(message, type = 'success') {
    LinsoraUtils.showToast(message, type);
  }
}

window.LinsoraUI = new LinsoraUIComponentEngine();
