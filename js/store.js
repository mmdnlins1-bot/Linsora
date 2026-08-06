/**
 * ============================================================================
 * LINSORA — GERENCIADOR DE ESTADO REATIVO CENTRAL (store.js)
 * Saúde Financeira Condicional, Patrimônio com Variação & Insights Acionáveis
 * ============================================================================
 */

class LinsoraStore {
  constructor() {
    this.state = null;
    this.listeners = [];
    this.isHideValues = false;
    this.currentTheme = 'dark';
    this.activeTab = 'tabDashboard';
    this.filterType = 'all';
    this.filterPeriod = 'ALL';
    this.searchQuery = '';
    this.cashflowMetric = 'all';
    this.cashflowPeriod = 'monthly';
  }

  async init(userObj = null) {
    const userId = userObj?.id || window.supabaseRepo.currentUserId || 'guest';
    this.state = await window.supabaseRepo.getDbData(userId, userObj);
    this.currentTheme = localStorage.getItem('LINSORA_THEME') || 'dark';
    document.documentElement.setAttribute('data-theme', this.currentTheme);
    this.notify();
  }

  async loadUserData(userObj) {
    if (!userObj) return;
    this.state = await window.supabaseRepo.getDbData(userObj.id, userObj);
    this.notify();
  }

  subscribe(listener) {
    this.listeners.push(listener);
  }

  notify() {
    if (this.state && this.state.user) {
      window.supabaseRepo.saveDbData(this.state, this.state.user.id);
    }
    this.listeners.forEach(fn => fn(this.state));
  }

  togglePrivacy() {
    this.isHideValues = !this.isHideValues;
    this.notify();
    return this.isHideValues;
  }

  toggleTheme() {
    this.currentTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('LINSORA_THEME', this.currentTheme);
    document.documentElement.setAttribute('data-theme', this.currentTheme);
    this.notify();
    return this.currentTheme;
  }

  toggleAiClassification() {
    if (!this.state.user) return false;
    this.state.user.isAiClassificationEnabled = !this.state.user.isAiClassificationEnabled;
    this.notify();
    return this.state.user.isAiClassificationEnabled;
  }

  setPinCode(pin) {
    if (!this.state.user) return;
    this.state.user.pinCode = pin;
    this.state.user.isPinEnabled = true;
    this.notify();
  }

  togglePinSecurity() {
    if (!this.state.user) return false;
    this.state.user.isPinEnabled = !this.state.user.isPinEnabled;
    this.notify();
    return this.state.user.isPinEnabled;
  }

  /* ------------------------------------------------------------------------
     OPERAÇÕES DE TRANSAÇÕES
     ------------------------------------------------------------------------ */
  async saveTransaction(txData) {
    if (txData.id) {
      const index = this.state.transactions.findIndex(t => t.id === txData.id);
      if (index !== -1) {
        this.state.transactions[index] = { ...this.state.transactions[index], ...txData };
      }
    } else {
      const newTx = {
        id: 'tx_' + Date.now(),
        userId: this.state.user.id,
        ...txData,
        status: txData.status || 'CONCLUIDO'
      };
      this.state.transactions.unshift(newTx);
      
      if (newTx.type === 'RECEITA') {
        this.adjustAccountBalance(newTx.account, newTx.amount);
      } else if (newTx.type === 'DESPESA') {
        if (newTx.account.includes('Cartão')) {
          const card = this.state.cards.find(c => newTx.account.includes(c.name));
          if (card) {
            card.limitUsed += newTx.amount;
          }
        } else {
          this.adjustAccountBalance(newTx.account, -newTx.amount);
        }
      }
    }

    this.notify();
  }

  async deleteTransaction(txId) {
    this.state.transactions = this.state.transactions.filter(t => t.id !== txId);
    this.notify();
  }

  async duplicateTransaction(txId) {
    const original = this.state.transactions.find(t => t.id === txId);
    if (original) {
      const copy = {
        ...original,
        id: 'tx_' + Date.now(),
        description: `${original.description} (Cópia)`,
        date: new Date().toISOString().split('T')[0]
      };
      this.state.transactions.unshift(copy);

      if (copy.type === 'RECEITA') {
        this.adjustAccountBalance(copy.account, copy.amount);
      } else if (copy.type === 'DESPESA' && !copy.account.includes('Cartão')) {
        this.adjustAccountBalance(copy.account, -copy.amount);
      }

      this.notify();
    }
  }

  /* ------------------------------------------------------------------------
     OPERAÇÕES DE CONTAS & PIX
     ------------------------------------------------------------------------ */
  adjustAccountBalance(accountName, deltaAmount) {
    let acc = this.state.accounts.find(a => a.name.toLowerCase().includes(accountName.toLowerCase()));
    if (!acc && this.state.accounts.length > 0) {
      acc = this.state.accounts[0];
    }
    if (acc) {
      acc.balance += deltaAmount;
    }
  }

  async addAccount(accData) {
    const colors = ['#820AD1', '#FF7A00', '#EC7000', '#0047BB', '#059669'];
    const icons = ['🟣', '🟠', '🟦', '🏛️', '💰'];
    const newAcc = {
      id: 'acc_' + Date.now(),
      userId: this.state.user.id,
      name: accData.name,
      bank: accData.name,
      type: accData.type,
      balance: parseFloat(accData.balance) || 0,
      color: colors[this.state.accounts.length % colors.length],
      icon: icons[this.state.accounts.length % icons.length]
    };
    this.state.accounts.push(newAcc);
    this.notify();
  }

  async executePixTransfer(pixKey, amount, accountName) {
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) return false;

    const pixTx = {
      id: 'tx_pix_' + Date.now(),
      userId: this.state.user.id,
      type: 'DESPESA',
      description: `Pix enviado (${pixKey})`,
      amount: numAmount,
      category: 'Outros',
      date: new Date().toISOString().split('T')[0],
      account: accountName || (this.state.accounts[0] ? this.state.accounts[0].name : 'Conta Principal'),
      status: 'CONCLUIDO',
      repetition: 'SINGLE',
      notes: 'Transferência Pix realizada via Linsora'
    };

    this.state.transactions.unshift(pixTx);
    this.adjustAccountBalance(pixTx.account, -numAmount);
    this.notify();
    return true;
  }

  async addPixKey(type, key, bank) {
    const newPix = {
      id: 'pix_' + Date.now(),
      userId: this.state.user.id,
      type: type.toUpperCase(),
      key,
      bank: bank || 'Nubank'
    };
    this.state.pixKeys.push(newPix);
    this.notify();
  }

  /* ------------------------------------------------------------------------
     OPERAÇÕES DE CARTÕES & FATURAS
     ------------------------------------------------------------------------ */
  async addCard(cardData) {
    const classes = ['nubank', 'inter', 'aurablack'];
    const newCard = {
      id: 'card_' + Date.now(),
      userId: this.state.user.id,
      name: cardData.name,
      brand: cardData.brand,
      last4: Math.floor(1000 + Math.random() * 9000).toString(),
      limitTotal: parseFloat(cardData.limitTotal) || 5000,
      limitUsed: 0,
      closingDay: parseInt(cardData.closingDay) || 15,
      dueDay: parseInt(cardData.dueDay) || 22,
      colorClass: classes[this.state.cards.length % classes.length],
      status: 'ABERTA'
    };
    this.state.cards.push(newCard);
    this.notify();
  }

  async deleteCard(cardId) {
    if (!cardId) return false;
    this.state.cards = this.state.cards.filter(c => c.id !== cardId);
    this.notify();
    return true;
  }

  async payCardInvoice(cardId) {
    const card = this.state.cards.find(c => c.id === cardId);
    if (card && card.limitUsed > 0) {
      const payAmount = card.limitUsed;
      card.limitUsed = 0;
      card.status = 'PAGA';

      const accountName = this.state.accounts[0] ? this.state.accounts[0].name : 'Conta Principal';

      this.state.transactions.unshift({
        id: 'tx_pay_card_' + Date.now(),
        userId: this.state.user.id,
        type: 'DESPESA',
        description: `Pagamento da Fatura ${card.name}`,
        amount: payAmount,
        category: 'Outros',
        date: new Date().toISOString().split('T')[0],
        account: accountName,
        status: 'CONCLUIDO',
        repetition: 'SINGLE',
        notes: 'Quitação integral da fatura'
      });

      this.adjustAccountBalance(accountName, -payAmount);
      this.notify();
      return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------------
     OPERAÇÕES DE METAS
     ------------------------------------------------------------------------ */
  async addGoal(goalData) {
    const icons = ['🎯', '✈️', '🚗', '🏠', '💎', '📈'];
    const newGoal = {
      id: 'goal_' + Date.now(),
      userId: this.state.user.id,
      title: goalData.title,
      target: parseFloat(goalData.target) || 1000,
      current: parseFloat(goalData.current) || 0,
      category: 'Economia',
      deadline: goalData.deadline || '2026-12-31',
      icon: icons[this.state.goals.length % icons.length]
    };
    this.state.goals.push(newGoal);
    this.notify();
  }

  /* ------------------------------------------------------------------------
     MÉTRICAS, SAÚDE FINANCEIRA & RECOMENDAÇÕES ACIONÁVEIS
     ------------------------------------------------------------------------ */
  
  /**
   * Verifica se há dados suficientes para cálculo da saúde financeira
   */
  hasEnoughDataForHealthScore() {
    if (!this.state) return false;
    const hasTx = (this.state.transactions || []).length > 0;
    const hasAccounts = (this.state.accounts || []).length > 0;
    return hasTx || hasAccounts;
  }

  /**
   * Indicador de Saúde Financeira (0 a 100) — Condicional
   */
  calculateFinancialHealthScore() {
    if (!this.hasEnoughDataForHealthScore()) {
      return {
        hasEnoughData: false,
        text: 'sem dados para cálculo'
      };
    }

    let score = 100;
    const income = this.getMonthIncome();
    const expense = this.getMonthExpense();
    const commitmentPct = this.getIncomeCommitmentPct();

    if (income > 0) {
      if (commitmentPct > 90) score -= 35;
      else if (commitmentPct > 75) score -= 20;
      else if (commitmentPct > 60) score -= 10;
    } else if (expense > 0) {
      score -= 25;
    }

    const goalsPct = this.getAverageGoalProgress();
    if (goalsPct < 20) score -= 15;
    else if (goalsPct < 50) score -= 8;

    const openInvoices = this.getOpenInvoicesTotal();
    if (openInvoices > 3000) score -= 15;
    else if (openInvoices > 1000) score -= 8;

    score = Math.max(10, Math.min(100, score));

    let label = 'Excelente 🟢';
    let color = '#10B981';
    let sub = 'Contas em dia, boa margem de receita e progresso de metas.';

    if (score < 50) {
      label = 'Atenção 🔴';
      color = '#EF4444';
      sub = 'Despesas elevadas ou receita insuficiente. Reduza custos desnecessários.';
    } else if (score < 75) {
      label = 'Moderado 🟡';
      color = '#F59E0B';
      sub = 'Suas finanças estão estáveis, mas seu comprometimento exige cuidado.';
    }

    return {
      hasEnoughData: true,
      score,
      label,
      color,
      sub
    };
  }

  getMonthBalance() {
    return this.getMonthIncome() - this.getMonthExpense();
  }

  getIncomeCommitmentPct() {
    const income = this.getMonthIncome();
    if (income <= 0) return 0;
    const expense = this.getMonthExpense();
    return Math.min(100, Math.round((expense / income) * 100));
  }

  getSavedAmountMonth() {
    const balance = this.getMonthBalance();
    return balance > 0 ? balance : 0;
  }

  getOpenInvoicesTotal() {
    if (!this.state || !this.state.cards) return 0;
    return this.state.cards.reduce((acc, c) => acc + c.limitUsed, 0);
  }

  getAverageGoalProgress() {
    if (!this.state || !this.state.goals || this.state.goals.length === 0) return 0;
    const totalPct = this.state.goals.reduce((acc, g) => {
      const pct = g.target > 0 ? (g.current / g.target) * 100 : 0;
      return acc + pct;
    }, 0);
    return Math.min(100, Math.round(totalPct / this.state.goals.length));
  }

  /**
   * Variação do Patrimônio no Mês
   */
  getMonthNetWorthVariation() {
    const balance = this.getMonthBalance();
    const hideValues = this.isHideValues;
    const formatted = LinsoraUtils.formatBRL(Math.abs(balance), hideValues);

    if (balance > 0) {
      return { text: `+ ${formatted} este mês`, isPositive: true };
    } else if (balance < 0) {
      return { text: `- ${formatted} este mês`, isPositive: false };
    } else {
      return { text: `Sem variação no mês`, isPositive: true };
    }
  }

  /**
   * Data e hora da última atualização
   */
  getLastUpdatedTimestamp() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const mins = String(now.getMinutes()).padStart(2, '0');
    return `Atualizado hoje às ${hours}:${mins}`;
  }

  /**
   * Insights Inteligentes Orientados a Ações Práticas
   */
  generateSmartInsights() {
    if (!this.state || !this.state.transactions || this.state.transactions.length === 0) {
      return {
        isActionable: false,
        title: '💡 Comece Agora',
        text: 'Registre sua primeira receita ou despesa para desbloquear recomendações práticas de economia e hábitos.'
      };
    }

    const income = this.getMonthIncome();
    const expense = this.getMonthExpense();
    const balance = this.getMonthBalance();
    const hideValues = this.isHideValues;
    const goals = this.state.goals || [];

    // Encontrar maior categoria
    const expTxs = this.state.transactions.filter(t => t.type === 'DESPESA');
    const catTotals = {};
    expTxs.forEach(t => catTotals[t.category] = (catTotals[t.category] || 0) + t.amount);
    let topCat = null;
    let topCatVal = 0;
    Object.keys(catTotals).forEach(c => {
      if (catTotals[c] > topCatVal) {
        topCatVal = catTotals[c];
        topCat = c;
      }
    });

    if (expense > income && income > 0) {
      return {
        isActionable: true,
        title: '⚠️ Alerta de Orçamento',
        text: `Suas despesas superaram suas receitas em **${LinsoraUtils.formatBRL(Math.abs(balance), hideValues)}**. Recomendamos cortar gastos secundários em **${topCat || 'Outros'}**.`
      };
    }

    if (balance > 0 && goals.length > 0) {
      const targetGoal = goals[0];
      return {
        isActionable: true,
        title: '🎯 Oportunidade de Economia',
        text: `Você possui **${LinsoraUtils.formatBRL(balance, hideValues)}** livres este mês. Que tal guardar uma parte na sua meta **"${targetGoal.title}"**?`
      };
    }

    if (balance > 0) {
      return {
        isActionable: true,
        title: '✨ Boa Margem Financeira',
        text: `Suas receitas superaram as despesas em **${LinsoraUtils.formatBRL(balance, hideValues)}**. Mantenha essa margem para reforçar sua reserva de emergência.`
      };
    }

    return {
      isActionable: true,
      title: '📊 Análise de Movimentações',
      text: `Seu maior volume de gasto no mês foi em **${topCat || 'Alimentação'}** (${LinsoraUtils.formatBRL(topCatVal, hideValues)}).`
    };
  }

  getTotalNetWorth() {
    if (!this.state) return 0;
    const accountsSum = (this.state.accounts || []).reduce((acc, a) => acc + a.balance, 0);
    const cardsDebt = (this.state.cards || []).reduce((acc, c) => acc + c.limitUsed, 0);
    return accountsSum - cardsDebt;
  }

  getMonthIncome() {
    if (!this.state || !this.state.transactions) return 0;
    return this.state.transactions
      .filter(t => t.type === 'RECEITA')
      .reduce((acc, t) => acc + t.amount, 0);
  }

  getMonthExpense() {
    if (!this.state || !this.state.transactions) return 0;
    return this.state.transactions
      .filter(t => t.type === 'DESPESA')
      .reduce((acc, t) => acc + t.amount, 0);
  }
}

window.linsoraStore = new LinsoraStore();
