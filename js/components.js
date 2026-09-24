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
   * Renderiza a Análise Financeira do Extrato a partir das movimentações do período.
   * Usa somente dados reais do usuário: sem nota de 0 a 10, sem categorias fictícias
   * e sem diagnóstico inventado. Com período vazio, limpa o container (o bloco de
   * estado sem dados é controlado pelo Extrato).
   */
  renderExtratoAnalysis(containerId, periodTxs = [], prevTxs = [], showComparison = false, activeCategory = null) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const hideValues = window.linsoraStore ? window.linsoraStore.isHideValues : false;

    const txs = Array.isArray(periodTxs) ? periodTxs : [];
    if (txs.length === 0) {
      container.innerHTML = '';
      return;
    }

    const sumByType = (list, type) => list
      .filter(t => t.type === type)
      .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

    const income = sumByType(txs, 'RECEITA');
    const expense = sumByType(txs, 'DESPESA');
    const balance = income - expense;
    const commitment = income > 0 ? expense / income : (expense > 0 ? 1 : 0);

    // 1. Classificação descritiva do período (objetiva, sem nota arbitrária)
    let statusLabel = 'Equilibrado';
    let statusClass = 'success';
    let statusIcon = '⚖️';
    let statusText = '';
    if (balance < 0) {
      statusLabel = 'Déficit no período';
      statusClass = 'danger';
      statusIcon = '📉';
      statusText = `Suas saídas superaram as entradas em ${LinsoraUtils.formatBRL(Math.abs(balance), hideValues)} neste período.`;
    } else if (commitment > 0.7) {
      statusLabel = 'Atenção';
      statusClass = 'warning';
      statusIcon = '⚠️';
      statusText = `Suas saídas comprometem ${Math.round(commitment * 100)}% das entradas do período.`;
    } else {
      statusText = `Suas entradas cobrem as saídas com margem de ${LinsoraUtils.formatBRL(balance, hideValues)} no período.`;
    }

    // 2. Relação entradas x saídas (barras proporcionais)
    const maxVal = Math.max(income, expense, 1);
    const incomePct = Math.round((income / maxVal) * 100);
    const expensePct = Math.round((expense / maxVal) * 100);

    // 3. Distribuição real das despesas por categoria (só categorias com movimento)
    const catTotals = {};
    txs.filter(t => t.type === 'DESPESA').forEach(t => {
      const cat = t.category || 'Outros';
      catTotals[cat] = (catTotals[cat] || 0) + (Number(t.amount) || 0);
    });
    const catEntries = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);

    // 4. Comparação com o mês anterior (somente totais, somente no modo mensal)
    let comparisonHTML = '';
    if (showComparison) {
      const prevList = Array.isArray(prevTxs) ? prevTxs : [];
      const cmpRow = (label, curr, prev) => {
        let badge = '<span class="category-variation-badge neutral">sem base ant.</span>';
        if (prev > 0) {
          const pct = Math.round(((curr - prev) / prev) * 100);
          if (pct > 0) badge = `<span class="category-variation-badge danger">+${pct}%</span>`;
          else if (pct < 0) badge = `<span class="category-variation-badge success">${pct}%</span>`;
          else badge = '<span class="category-variation-badge neutral">0%</span>';
        }
        return `
          <div class="extrato-cmp-row">
            <span>${LinsoraUtils.escapeHTML(label)}</span>
            <span class="extrato-cmp-vals">
              <span>${LinsoraUtils.formatBRL(prev, hideValues)}</span>
              <span>→</span>
              <strong>${LinsoraUtils.formatBRL(curr, hideValues)}</strong>
              ${badge}
            </span>
          </div>
        `;
      };
      const prevIncome = sumByType(prevList, 'RECEITA');
      const prevExpense = sumByType(prevList, 'DESPESA');
      comparisonHTML = `
        <div class="linsora-card">
          <strong class="extrato-card-title">Comparado ao mês anterior</strong>
          ${cmpRow('Entradas', income, prevIncome)}
          ${cmpRow('Saídas', expense, prevExpense)}
          ${cmpRow('Saldo', balance, prevIncome - prevExpense)}
        </div>
      `;
    }

    // 5. Insights derivados dos dados reais
    const insights = [];
    if (balance < 0) {
      insights.push({
        type: 'danger', icon: '⚠️', title: statusLabel,
        message: `Suas despesas ficaram acima das entradas neste período (${LinsoraUtils.formatBRL(expense, hideValues)} em saídas vs ${LinsoraUtils.formatBRL(income, hideValues)} em entradas).`
      });
    } else if (balance > 0) {
      insights.push({
        type: 'success', icon: '✅', title: statusLabel,
        message: `Suas entradas ficaram acima das despesas neste período (${LinsoraUtils.formatBRL(income, hideValues)} em entradas vs ${LinsoraUtils.formatBRL(expense, hideValues)} em saídas).`
      });
    } else {
      insights.push({
        type: 'info', icon: '⚖️', title: statusLabel,
        message: 'Entradas e despesas se equilibraram neste período.'
      });
    }
    if (expense > 0 && catEntries.length > 0) {
      const [topCat, topVal] = catEntries[0];
      const topPct = Math.round((topVal / expense) * 100);
      insights.push({
        type: 'info', icon: '📊', title: 'Concentração de gastos',
        message: `Uma parte significativa das suas despesas está concentrada em ${LinsoraUtils.escapeHTML(topCat)} (${topPct}% — ${LinsoraUtils.formatBRL(topVal, hideValues)}).`
      });
    }

    container.innerHTML = `
      <div class="linsora-card insight-card ${statusClass}">
        <div class="insight-icon">${statusIcon}</div>
        <div class="insight-content">
          <strong>${LinsoraUtils.escapeHTML(statusLabel)}</strong>
          <p>${statusText}</p>
        </div>
      </div>

      <div class="linsora-card">
        <strong class="extrato-card-title">Entradas x Saídas</strong>
        <div class="extrato-ie-row">
          <span class="extrato-ie-label">Entradas</span>
          <div class="widget-bar"><div class="widget-bar-fill emerald" style="width: ${incomePct}%;"></div></div>
          <span class="extrato-ie-val positive">${LinsoraUtils.formatBRL(income, hideValues)}</span>
        </div>
        <div class="extrato-ie-row">
          <span class="extrato-ie-label">Saídas</span>
          <div class="widget-bar"><div class="widget-bar-fill" style="width: ${expensePct}%;"></div></div>
          <span class="extrato-ie-val negative">${LinsoraUtils.formatBRL(expense, hideValues)}</span>
        </div>
      </div>

      ${!activeCategory && expense > 0 ? `
      <strong class="extrato-card-title">Distribuição dos gastos</strong>
      ${catEntries.map(([cat, val]) => {
        const pct = Math.round((val / expense) * 100);
        return `
          <div class="linsora-card category-variation-item clickable" data-category="${encodeURIComponent(cat)}" role="button" tabindex="0" title="Filtrar por ${LinsoraUtils.escapeHTML(cat)}">
            <div class="cat-var-top">
              <span class="cat-var-name">${LinsoraUtils.getCategoryIcon(cat)} ${LinsoraUtils.escapeHTML(cat)}</span>
              <span class="cat-var-pct">${pct}%</span>
            </div>
            <div class="widget-bar"><div class="widget-bar-fill" style="width: ${pct}%;"></div></div>
            <div class="cat-var-val">${LinsoraUtils.formatBRL(val, hideValues)}</div>
          </div>
        `;
      }).join('')}
      ` : ''}

      ${comparisonHTML}

      ${insights.map(i => `
        <div class="linsora-card insight-card ${i.type}">
          <div class="insight-icon">${i.icon}</div>
          <div class="insight-content">
            <strong>${LinsoraUtils.escapeHTML(i.title)}</strong>
            <p>${i.message}</p>
          </div>
        </div>
      `).join('')}
    `;
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
            ${g.targetVal > 0 ? `<span class="cat-pct-chip">${g.pct}%</span>` : ''}
          </div>

          ${g.targetVal > 0 ? `
          <div class="limit-progress-bar">
            <div class="limit-progress-fill" style="width: ${g.pct}%; background: ${g.pct >= 100 ? '#10B981' : g.isExpired ? '#EF4444' : 'linear-gradient(90deg, #10B981, #06B6D4)'};"></div>
          </div>
          ` : '<div style="margin-top: 10px;"></div>'}

          <div class="goal-values">
            <span>Guardado: <strong>${LinsoraUtils.formatBRL(g.currentVal, hideValues)}</strong></span>
            ${g.targetVal > 0 ? `<span>Alvo: <strong>${LinsoraUtils.formatBRL(g.targetVal, hideValues)}</strong></span>` : ''}
          </div>

          ${g.targetVal === 0 ? '' : (g.pct >= 100 ? `
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
          `)}

          ${g.targetVal > 0 ? `
          <div class="goal-time-rhythm">
            ${g.isExpired ? `
              <span style="color: #EF4444; font-weight: 600;">⏱️ Status: Prazo Encerrado</span>
            ` : `
              <span>⏱️ Ritmo estimado: ~${g.daysLeft !== null && g.daysLeft <= 30 ? `${g.daysLeft} dias restantes` : `${g.monthsLeft} ${g.monthsLeft === 1 ? 'mês restante' : 'meses restantes'}`}</span>
            `}
            <span>Faltam: ${LinsoraUtils.formatBRL(g.remainingVal, hideValues)}</span>
          </div>
          ` : ''}

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
