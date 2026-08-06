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
          <span class="widget-sub">${commitmentPct > 80 ? '⚠️ Nível crítico' : commitmentPct > 60 ? 'Atenção ao orçamento' : 'Dentro do limite ideal'}</span>
        </div>

        <div class="resumo-widget-card">
          <span class="widget-label">Economizado no Mês</span>
          <strong class="widget-value positive">${LinsoraUtils.formatBRL(savedAmount, hideValues)}</strong>
          <span class="widget-sub">Saldo positivo retido</span>
        </div>

        <div class="resumo-widget-card">
          <span class="widget-label">Contas a Vencer</span>
          <strong class="widget-value ${billsCount > 0 ? 'warning' : ''}">${billsCount} pendentes</strong>
          <span class="widget-sub">${billsCount > 0 ? 'Exige atenção ao prazo' : 'Todas em dia'}</span>
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

        <div class="resumo-widget-card">
          <span class="widget-label">Disponível no Mês</span>
          <strong class="widget-value">${LinsoraUtils.formatBRL(availableAmount, hideValues)}</strong>
          <span class="widget-sub">Margem para gastos</span>
        </div>
      </div>
    `;
  }

  /**
   * Renderiza o Grid de Contas Bancárias Padronizado
   */
  renderAccountsGrid(containerId, accounts = []) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const totalEl = document.getElementById('accountsTotalBalance');
    const totalSum = accounts.reduce((acc, a) => acc + a.balance, 0);
    if (totalEl) totalEl.innerText = LinsoraUtils.formatBRL(totalSum, window.linsoraStore.isHideValues);

    if (!accounts || accounts.length === 0) {
      container.innerHTML = `
        <div class="empty-state-card">
          <div class="empty-icon">🏛️</div>
          <p>Nenhuma conta bancária cadastrada</p>
          <span class="empty-sub">Clique em **+ Nova Conta** para vincular seu banco.</span>
        </div>
      `;
      return;
    }

    const hideValues = window.linsoraStore.isHideValues;

    container.innerHTML = accounts.map(acc => {
      const formattedVal = LinsoraUtils.formatBRL(acc.balance, hideValues);
      return `
        <div class="account-tile-item">
          <div class="acc-brand">
            <div class="acc-logo-box" style="background: linear-gradient(135deg, ${acc.color || '#059669'}, #047857);">
              ${acc.icon || '🏛️'}
            </div>
            <div>
              <strong class="acc-name">${LinsoraUtils.escapeHTML(acc.name)}</strong>
              <span class="acc-type-chip">${acc.type}</span>
            </div>
          </div>
          <div class="acc-val">${formattedVal}</div>
        </div>
      `;
    }).join('');

    this.updateAccountDropdowns(accounts);
  }

  updateAccountDropdowns(accounts = []) {
    const txSelect = document.getElementById('txAccount');
    const pixBankSelect = document.getElementById('pixBankSelect');

    if (txSelect) {
      if (accounts.length === 0) {
        txSelect.innerHTML = `<option value="Conta Principal">Conta Principal</option>`;
      } else {
        txSelect.innerHTML = accounts.map(a => `<option value="${LinsoraUtils.escapeHTML(a.name)}">${LinsoraUtils.escapeHTML(a.name)}</option>`).join('');
      }
    }

    if (pixBankSelect) {
      if (accounts.length === 0) {
        pixBankSelect.innerHTML = `<option value="Conta Principal">Conta Principal</option>`;
      } else {
        pixBankSelect.innerHTML = accounts.map(a => `<option value="${LinsoraUtils.escapeHTML(a.name)}">${LinsoraUtils.escapeHTML(a.name)}</option>`).join('');
      }
    }
  }

  renderCardsCarousel(containerId, cards = []) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!cards || cards.length === 0) {
      container.innerHTML = `
        <div class="empty-state-card" style="width: 100%;">
          <div class="empty-icon">💳</div>
          <p>Nenhum cartão de crédito cadastrado</p>
          <span class="empty-sub">Clique em **+ Novo Cartão** para acompanhar suas faturas.</span>
        </div>
      `;
      this.updateFaturaDetails(null);
      return;
    }

    container.innerHTML = cards.map((c, index) => {
      const isSelected = window.selectedCardId === c.id || (index === 0 && !window.selectedCardId);
      if (isSelected) window.selectedCardId = c.id;

      return `
        <div class="credit-card-physical ${c.colorClass || 'nubank'} ${isSelected ? 'selected' : ''}" onclick="LinsoraUI.selectCard('${c.id}')">
          <div class="cc-top">
            <div class="cc-chip"></div>
            <span class="cc-flag">${c.brand}</span>
          </div>
          <div class="cc-number">•••• •••• •••• ${c.last4 || '4892'}</div>
          <div class="cc-bottom">
            <span>${LinsoraUtils.escapeHTML(c.name)}</span>
            <span>Vence dia ${c.dueDay}</span>
          </div>
        </div>
      `;
    }).join('');

    const activeCard = cards.find(c => c.id === window.selectedCardId) || cards[0];
    this.updateFaturaDetails(activeCard);
  }

  updateFaturaDetails(card) {
    const hideValues = window.linsoraStore.isHideValues;

    if (!card) {
      document.getElementById('faturaCardName').innerText = 'Nenhum cartão cadastrado';
      document.getElementById('faturaTotalValue').innerText = LinsoraUtils.formatBRL(0, hideValues);
      document.getElementById('limitUsedText').innerText = LinsoraUtils.formatBRL(0, hideValues);
      document.getElementById('limitAvailText').innerText = LinsoraUtils.formatBRL(0, hideValues);
      document.getElementById('limitProgressFill').style.width = '0%';
      document.getElementById('faturaClosingDate').innerText = '--';
      document.getElementById('faturaDueDate').innerText = '--';
      document.getElementById('faturaBestDay').innerText = '--';
      document.getElementById('faturaItemsList').innerHTML = `<p style="font-size:12px; color:var(--text-muted); text-align:center; padding:16px;">Nenhum cartão cadastrado.</p>`;
      return;
    }

    document.getElementById('faturaCardName').innerText = card.name;
    document.getElementById('faturaTotalValue').innerText = LinsoraUtils.formatBRL(card.limitUsed, hideValues);
    
    const limitAvail = card.limitTotal - card.limitUsed;
    document.getElementById('limitUsedText').innerText = LinsoraUtils.formatBRL(card.limitUsed, hideValues);
    document.getElementById('limitAvailText').innerText = LinsoraUtils.formatBRL(limitAvail, hideValues);

    const pct = card.limitTotal > 0 ? Math.min(100, Math.round((card.limitUsed / card.limitTotal) * 100)) : 0;
    document.getElementById('limitProgressFill').style.width = `${pct}%`;

    document.getElementById('faturaClosingDate').innerText = `${card.closingDay}/08`;
    document.getElementById('faturaDueDate').innerText = `${card.dueDay}/08`;
    document.getElementById('faturaBestDay').innerText = `${card.closingDay + 1}/08`;

    const cardTxs = window.linsoraStore.state.transactions.filter(t => t.account.includes(card.name) || t.account.includes('Cartão'));
    const itemsList = document.getElementById('faturaItemsList');
    if (itemsList) {
      if (cardTxs.length === 0) {
        itemsList.innerHTML = `<p style="font-size:12px; color:var(--text-muted); text-align:center; padding:16px;">Nenhuma compra nesta fatura.</p>`;
      } else {
        itemsList.innerHTML = cardTxs.map(t => `
          <div style="display:flex; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--border-color); font-size:13px;">
            <span>${LinsoraUtils.escapeHTML(t.description)}</span>
            <strong>${LinsoraUtils.formatBRL(t.amount, hideValues)}</strong>
          </div>
        `).join('');
      }
    }
  }

  selectCard(cardId) {
    window.selectedCardId = cardId;
    this.renderCardsCarousel('cardsCarousel', window.linsoraStore.state.cards);
  }

  renderPixKeysList(containerId, pixKeys = []) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const textCount = document.getElementById('pixKeysCountText');
    if (textCount) textCount.innerHTML = `✨ Chaves Pix Ativas: <strong>${pixKeys.length} cadastradas</strong>`;

    if (!pixKeys || pixKeys.length === 0) {
      container.innerHTML = `
        <div class="empty-state-card">
          <div class="empty-icon">⚡</div>
          <p>Nenhuma chave Pix cadastrada</p>
          <span class="empty-sub">Clique em **+ Cadastrar Chave** para registrar suas chaves.</span>
        </div>
      `;
      return;
    }

    container.innerHTML = pixKeys.map(k => `
      <div class="pix-key-item">
        <div class="pix-key-left">
          <div class="pix-key-icon">⚡</div>
          <div>
            <strong style="display:block; font-size:13.5px;">${k.type}: ${LinsoraUtils.escapeHTML(k.key)}</strong>
            <span style="font-size:11px; color:var(--text-muted);">${k.bank}</span>
          </div>
        </div>
        <span class="badge-status-chip success">Ativa</span>
      </div>
    `).join('');
  }

  renderGoalsList(containerId, goals = []) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!goals || goals.length === 0) {
      container.innerHTML = `
        <div class="empty-state-card">
          <div class="empty-icon">🎯</div>
          <p>Nenhuma meta financeira cadastrada</p>
          <span class="empty-sub">Clique em **+ Nova Meta** para acompanhar seus objetivos de economia.</span>
        </div>
      `;
      return;
    }

    const hideValues = window.linsoraStore.isHideValues;

    container.innerHTML = goals.map(g => {
      const pct = g.target > 0 ? Math.min(100, Math.round((g.current / g.target) * 100)) : 0;
      return `
        <div class="goal-item-card">
          <div class="goal-top">
            <span class="goal-title">${g.icon || '🎯'} ${LinsoraUtils.escapeHTML(g.title)}</span>
            <span class="cat-pct-chip">${pct}%</span>
          </div>
          <div class="limit-progress-bar" style="margin: 10px 0;">
            <div class="limit-progress-fill" style="width: ${pct}%; background: linear-gradient(90deg, #10B981, #06B6D4);"></div>
          </div>
          <div class="goal-values">
            <span>Guardado: <strong>${LinsoraUtils.formatBRL(g.current, hideValues)}</strong></span>
            <span>Alvo: <strong>${LinsoraUtils.formatBRL(g.target, hideValues)}</strong></span>
          </div>
        </div>
      `;
    }).join('');
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
          <div><span style="color:var(--text-muted); font-size:11px; display:block;">Categoria</span><strong>${tx.category}</strong></div>
          <div><span style="color:var(--text-muted); font-size:11px; display:block;">Data</span><strong>${LinsoraUtils.formatDateBR(tx.date)}</strong></div>
          <div><span style="color:var(--text-muted); font-size:11px; display:block;">Conta</span><strong>${tx.account}</strong></div>
          <div><span style="color:var(--text-muted); font-size:11px; display:block;">Repetição</span><strong>${tx.repetition}</strong></div>
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

  showToast(message, type = 'success') {
    LinsoraUtils.showToast(message, type);
  }
}

window.LinsoraUI = new LinsoraUIComponentEngine();
