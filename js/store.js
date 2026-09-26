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
    this.filterCategory = null;
    this.customPeriod = null;
    this.searchQuery = '';
    this.cashflowMetric = 'all';
    this.cashflowPeriod = 'monthly';

    // Ouvir falhas de sincronizacao remota e avisar o usuario
    window.addEventListener('linsora:sync-error', (evt) => {
      const detail = evt?.detail || {};
      const msg = detail.savedLocally
        ? 'Seus dados foram salvos localmente, mas não foi possível sincronizar com o servidor. Verifique sua conexão.'
        : 'Erro ao sincronizar dados com o servidor.';
      if (window.LinsoraNotifications?.show) {
        window.LinsoraNotifications.show(msg, 'warning');
      } else if (window.LinsoraLogger) {
        window.LinsoraLogger.error('[sync-error]', detail);
      }
    });
  }

  async init(userObj = null) {
    const userId = userObj?.id || window.supabaseRepo?.currentUserId || 'guest';
    this.state = await window.supabaseRepo.getDbData(userId, userObj);
    // Integração recorrências → fluxo real (abertura/recarga do app):
    // garante as ocorrências do mês corrente de forma idempotente, sem
    // alterar o motor. Silent para não duplicar o notify abaixo.
    try {
      if (typeof this.ensureCurrentWindowOccurrences === 'function') {
        this.ensureCurrentWindowOccurrences({ silent: true });
      }
    } catch (e) { /* motor indisponível: segue sem ocorrências */ }
    this.currentTheme = localStorage.getItem('LINSORA_THEME') || 'dark';
    document.documentElement.setAttribute('data-theme', this.currentTheme);
    this.notify();
  }

  async loadUserData(userObj, options = {}) {
    if (!userObj) return;
    this.state = await window.supabaseRepo.getDbData(userObj.id, userObj, options);
    // Integração recorrências → fluxo real (login/registro/troca de usuário):
    // garante as ocorrências do mês corrente de forma idempotente, sem
    // alterar o motor. Silent para não duplicar o notify abaixo.
    try {
      if (typeof this.ensureCurrentWindowOccurrences === 'function') {
        this.ensureCurrentWindowOccurrences({ silent: true });
      }
    } catch (e) { /* motor indisponível: segue sem ocorrências */ }
    this.notify();
  }

  clearState() {
    const previousUserId = this.state?.user?.id;
    if (window.LinsoraLogger) {
      window.LinsoraLogger.logout('Estado em memória resetado com sucesso', previousUserId);
    }
    this.state = null;
    this.listeners.forEach(fn => fn(null));
  }

  subscribe(listener) {
    this.listeners.push(listener);
  }

  notify() {
    if (this.state && this.state.user) {
      try {
        window.supabaseRepo.saveDbData(this.state, this.state.user.id);
      } catch (err) {
        console.warn('[LINSORA Store] Falha ao salvar estado remoto (modo offline):', err?.message || err);
      }
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

  /* ------------------------------------------------------------------------
     OPERAÇÕES DE TRANSAÇÕES
     ------------------------------------------------------------------------ */
  applyTransactionImpact(tx, isRevert = false) {
    if (!tx || !tx.amount) return;
    const factor = isRevert ? -1 : 1;
    if (tx.type === 'RECEITA') {
      this.adjustAccountBalance(tx.account, tx.amount * factor);
    } else if (tx.type === 'DESPESA') {
      if (tx.account && tx.account.includes('Cartão')) {
        const card = this.state.cards.find(c => tx.account.includes(c.name));
        if (card) {
          card.limitUsed = Math.max(0, card.limitUsed + (tx.amount * factor));
        }
      } else {
        this.adjustAccountBalance(tx.account, -tx.amount * factor);
      }
    }
  }

  async saveTransaction(txData) {
    if (txData.id) {
      const index = this.state.transactions.findIndex(t => t.id === txData.id);
      if (index !== -1) {
        const oldTx = this.state.transactions[index];
        this.applyTransactionImpact(oldTx, true); // Reverte o impacto antigo

        const updatedTx = { ...oldTx, ...txData };
        this.state.transactions[index] = updatedTx;
        this.applyTransactionImpact(updatedTx, false); // Aplica o novo impacto
        if (window.LinsoraLogger) window.LinsoraLogger.update('Transação', { id: txData.id, amount: updatedTx.amount }, this.state?.user?.id);
      }
    } else {
      const newTx = {
        id: 'tx_' + Date.now(),
        userId: this.state?.user?.id || 'usr_guest',
        ...txData,
        status: txData.status || 'CONCLUIDO'
      };
      this.state.transactions.unshift(newTx);
      this.applyTransactionImpact(newTx, false);
      if (window.LinsoraLogger) window.LinsoraLogger.write('Transação', { description: newTx.description, amount: newTx.amount, type: newTx.type }, this.state?.user?.id);
    }

    this.notify();
  }

  async deleteTransaction(txId) {
    const tx = this.state.transactions.find(t => t.id === txId);
    if (tx) {
      this.applyTransactionImpact(tx, true); // Reverte o saldo ao excluir
      this.state.transactions = this.state.transactions.filter(t => t.id !== txId);
      if (window.LinsoraLogger) window.LinsoraLogger.update('Exclusão de Transação', { id: txId, description: tx.description }, this.state?.user?.id);
      this.notify();
      // Propagar DELETE ao Supabase remoto
      const userId = this.state?.user?.id;
      const remoteResult = await window.supabaseRepo.deleteDbRecord('transactions', txId, userId);
      if (!remoteResult.success && window.LinsoraNotifications?.show) {
        window.LinsoraNotifications.show('Transação excluída localmente, mas não foi possível remover do servidor.', 'warning');
      }
    }
  }

  async duplicateTransaction(txId) {
    const original = this.state.transactions.find(t => t.id === txId);
    if (original) {
      const copy = {
        ...original,
        id: 'tx_' + Date.now(),
        description: `${original.description} (Cópia)`,
        date: LinsoraUtils.toLocalDateKey()
      };
      this.state.transactions.unshift(copy);
      this.applyTransactionImpact(copy, false);
      this.notify();
    }
  }

  /* ------------------------------------------------------------------------
     OPERAÇÕES DE CONTAS & PIX
     ------------------------------------------------------------------------ */
  adjustAccountBalance(accountName, deltaAmount) {
    if (!accountName) return false;
    const acc = this.state.accounts.find(a => a.name.toLowerCase().includes(accountName.toLowerCase()));
    // Sem fallback silencioso para accounts[0]: conta não encontrada =
    // nenhum débito/crédito em outra conta. Retorna se aplicou.
    if (!acc) return false;
    acc.balance += deltaAmount;
    return true;
  }

  /**
   * Resolve a conta/cartão informado no lançamento (formulário manual).
   * Retorna {ok:true, kind:'bank'|'card'|'none', account?, card?} ou
   * {ok:false, reason}. Nunca escolhe outra conta silenciosamente:
   * - 'Cartão <nome>' exige cartão correspondente (DESPESA);
   * - nome bancário exige conta correspondente;
   * - vazio só passa quando não existe nenhuma conta/cartão (legado
   *   sem impacto possível); com opções existentes, exige escolha.
   */
  resolveTxAccount(accountValue, type) {
    const accounts = this.state?.accounts || [];
    const cards = this.state?.cards || [];
    const raw = String(accountValue || '').trim();
    if (!raw) {
      if (accounts.length === 0 && cards.length === 0) return { ok: true, kind: 'none' };
      return { ok: false, reason: 'Selecione uma conta ou um cartão para lançar.' };
    }
    if (raw.includes('Cartão')) {
      if (type && type !== 'DESPESA') {
        return { ok: false, reason: 'Receitas devem ser lançadas em conta bancária, não em cartão.' };
      }
      const card = cards.find((c) => raw === `Cartão ${c.name}` || raw.includes(c.name));
      if (!card) {
        return { ok: false, reason: 'Selecione um cartão válido. Nenhum cartão correspondente foi encontrado.' };
      }
      return { ok: true, kind: 'card', card, account: `Cartão ${card.name}` };
    }
    const acc = accounts.find((a) => a.name.toLowerCase() === raw.toLowerCase())
      || accounts.find((a) => a.name.toLowerCase().includes(raw.toLowerCase()));
    if (!acc) {
      return { ok: false, reason: 'Conta não encontrada. Selecione uma conta válida.' };
    }
    return { ok: true, kind: 'bank', account: acc };
  }

  async addAccount(accData) {
    const colors = ['#820AD1', '#FF7A00', '#EC7000', '#0047BB', '#059669'];
    const icons = ['🟣', '🟠', '🟦', '🏛️', '💰'];
    const newAcc = {
      id: 'acc_' + Date.now(),
      userId: this.state?.user?.id || 'usr_guest',
      name: accData.name,
      bank: accData.name,
      type: accData.type,
      balance: parseFloat(accData.balance) || 0,
      color: colors[this.state.accounts.length % colors.length],
      icon: icons[this.state.accounts.length % icons.length]
    };
    this.state.accounts.push(newAcc);
    if (window.LinsoraLogger) window.LinsoraLogger.write('Conta Bancária', { name: newAcc.name, balance: newAcc.balance }, this.state?.user?.id);
    this.notify();
  }

  async deleteAccount(accId) {
    if (!accId) return false;
    this.state.accounts = this.state.accounts.filter(a => a.id !== accId);
    if (window.LinsoraLogger) window.LinsoraLogger.update('Exclusão de Conta', { accId }, this.state?.user?.id);
    this.notify();
    // Propagar DELETE ao Supabase remoto
    const userId = this.state?.user?.id;
    const remoteResult = await window.supabaseRepo.deleteDbRecord('accounts', accId, userId);
    if (!remoteResult.success && window.LinsoraNotifications?.show) {
      window.LinsoraNotifications.show('Conta excluída localmente, mas não foi possível remover do servidor.', 'warning');
    }
    return true;
  }

  async executePixTransfer(pixKey, amount, accountName) {
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) return false;

    const pixTx = {
      id: 'tx_pix_' + Date.now(),
      userId: this.state?.user?.id || 'usr_guest',
      type: 'DESPESA',
      description: `Pix enviado (${pixKey})`,
      amount: numAmount,
      category: 'Outros',
      date: LinsoraUtils.toLocalDateKey(),
      account: accountName || (this.state.accounts[0] ? this.state.accounts[0].name : 'Conta Principal'),
      status: 'CONCLUIDO',
      repetition: 'SINGLE',
      notes: 'Transferência Pix realizada via Linsora'
    };

    this.state.transactions.unshift(pixTx);
    this.adjustAccountBalance(pixTx.account, -numAmount);
    if (window.LinsoraLogger) window.LinsoraLogger.write('Transferência Pix', { pixKey, amount: numAmount }, this.state?.user?.id);
    this.notify();
    return true;
  }

  async addPixKey(type, key, bank) {
    const newPix = {
      id: 'pix_' + Date.now(),
      userId: this.state?.user?.id || 'usr_guest',
      type: type.toUpperCase(),
      key,
      bank: bank || 'Nubank'
    };
    this.state.pixKeys.push(newPix);
    if (window.LinsoraLogger) window.LinsoraLogger.write('Chave Pix', { type, key }, this.state?.user?.id);
    this.notify();
  }

  /* ------------------------------------------------------------------------
     OPERAÇÕES DE CARTÕES & FATURAS
     ------------------------------------------------------------------------ */
  async addCard(cardData) {
    const classes = ['nubank', 'inter', 'aurablack'];
    const newCard = {
      id: 'card_' + Date.now(),
      userId: this.state?.user?.id || 'usr_guest',
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
    if (window.LinsoraLogger) window.LinsoraLogger.write('Cartão de Crédito', { name: newCard.name, limit: newCard.limitTotal }, this.state?.user?.id);
    this.notify();
  }

  async deleteCard(cardId) {
    if (!cardId) return false;
    this.state.cards = this.state.cards.filter(c => c.id !== cardId);
    if (window.LinsoraLogger) window.LinsoraLogger.update('Exclusão de Cartão', { cardId }, this.state?.user?.id);
    this.notify();
    // Propagar DELETE ao Supabase remoto
    const userId = this.state?.user?.id;
    const remoteResult = await window.supabaseRepo.deleteDbRecord('cards', cardId, userId);
    if (!remoteResult.success && window.LinsoraNotifications?.show) {
      window.LinsoraNotifications.show('Cartão excluído localmente, mas não foi possível remover do servidor.', 'warning');
    }
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
        userId: this.state?.user?.id || 'usr_guest',
        type: 'DESPESA',
        description: `Pagamento da Fatura ${card.name}`,
        amount: payAmount,
        category: 'Outros',
        date: LinsoraUtils.toLocalDateKey(),
        account: accountName,
        status: 'CONCLUIDO',
        repetition: 'SINGLE',
        notes: 'Quitação integral da fatura'
      });

      this.adjustAccountBalance(accountName, -payAmount);
      if (window.LinsoraLogger) window.LinsoraLogger.write('Pagamento Fatura Cartão', { cardName: card.name, amount: payAmount }, this.state?.user?.id);
      this.notify();
      return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------------
     COMPRAS E PAGAMENTOS NO CARTÃO DE CRÉDITO (vínculo transação↔cartão).
     - COMPRA: gera dívida no cartão (limitUsed += valor) via saveTransaction
       com account `Cartão <nome>`; a conta bancária NÃO é tocada
       (applyTransactionImpact já separa os dois caminhos). Guarda cardId na
       transação para identificação exata, sem confundir com pagamento.
     - PAGAMENTO (parcial ou total): reduz limitUsed e debita a conta
       bancária UMA vez cada; registra UMA transação marcada isCardPayment,
       sem recriar a despesa original. Nunca duplica financeiro.
     - Identificação: um único cartão vincula automaticamente; com vários,
       só vincula quando o nome/marca é mencionado; ambíguo = null (nunca
       escolhe silenciosamente um cartão errado).
     ------------------------------------------------------------------------ */
  findCardByHint(hint) {
    const cards = this.state?.cards || [];
    const h = String(hint || '').toLowerCase().trim();
    if (!h) return null;
    // Hint genérico ("cartao", "cartão de crédito", "fatura", "rotativo")
    // nunca é nome de cartão: não pode casar com nenhum cartão real.
    if (['cartao', 'credito', 'fatura', 'rotativo', 'cartao de credito'].includes(h)) return null;
    const norm = (v) => String(v || '').toLowerCase();
    return cards.find((c) => norm(c.name).includes(h) || norm(c.brand).includes(h) || h.includes(norm(c.name))) || null;
  }

  resolvePurchaseCard(hint) {
    const cards = this.state?.cards || [];
    const h = String(hint || '').toLowerCase().trim();
    // Hint genérico ou ausente não identifica cartão: com exatamente um
    // cartão, usa-o automaticamente; com vários, retorna null (ambíguo).
    const generic = ['cartao', 'credito', 'fatura', 'rotativo', 'cartao de credito'];
    const cleanHint = (!h || generic.includes(h)) ? null : hint;
    if (cleanHint) return this.findCardByHint(cleanHint);
    if (cards.length === 1) return cards[0];
    return null;
  }

  async addCardPurchase({ amount, description, category, date, card, notes } = {}) {
    if (!card || !(Number(amount) > 0)) return null;
    await this.saveTransaction({
      type: 'DESPESA',
      amount: Number(amount),
      description: description || `Compra no cartão ${card.name}`,
      category: category || 'Outros',
      date: date || LinsoraUtils.toLocalDateKey(),
      account: `Cartão ${card.name}`,
      cardId: card.id,
      paymentMethod: 'credit',
      notes: notes || ''
    });
    return true;
  }

  async payCardAmount(cardId, amount, accountName = null) {
    const card = (this.state?.cards || []).find((c) => c.id === cardId);
    const value = Number(amount);
    if (!card || !(value > 0)) return null;
    const used = Number(card.limitUsed) || 0;
    const payValue = Math.min(value, used);
    if (!(payValue > 0)) return null;
    const account = accountName || (this.state.accounts[0] ? this.state.accounts[0].name : 'Conta Principal');
    card.limitUsed = Math.max(0, used - payValue);
    await this.saveTransaction({
      type: 'DESPESA',
      amount: payValue,
      description: `Pagamento da Fatura ${card.name}`,
      category: 'Outros',
      date: LinsoraUtils.toLocalDateKey(),
      account,
      cardId: card.id,
      isCardPayment: true,
      notes: payValue >= used ? 'Quitação integral da fatura' : 'Pagamento parcial da fatura'
    });
    if (window.LinsoraLogger) window.LinsoraLogger.write('Pagamento Fatura Cartão', { cardName: card.name, amount: payValue }, this.state?.user?.id);
    return { paid: payValue, remaining: Number(card.limitUsed) || 0, cardId: card.id };
  }

  /* ------------------------------------------------------------------------
     COMPROMISSOS FINANCEIROS (ETAPA 1) — recorrências + motor puro.
     Sem UI: estado via API do store; sem novas consultas (usa dados em memória).
     ------------------------------------------------------------------------ */
  async addRecurringBill(billData) {
    const data = billData || {};
    const title = String(data.title || '').trim();
    const amount = parseFloat(data.amount);
    const frequency = String(data.frequency || 'MONTHLY').toUpperCase();
    const dueDay = parseInt(data.due_day ?? data.dueDay, 10);
    const start = String(data.start_date ?? data.startDate ?? '').slice(0, 10);
    const endRaw = data.end_date ?? data.endDate ?? null;
    const end = endRaw ? String(endRaw).slice(0, 10) : null;
    const category = String(data.category || '').trim();
    // Validações da V1 (mensal, dia 1..31, valor > 0, início obrigatório)
    if (!title) return false;
    if (!(amount > 0)) return false;
    if (!category) return false;
    if (frequency !== 'MONTHLY') return false;
    if (!(dueDay >= 1 && dueDay <= 31)) return false;
    if (!/^\d{4}-\d{2}-\d{2}/.test(start)) return false;
    if (end && end < start) return false;

    const rec = {
      // ID UUID v4: compatível com recurring_bills.id (UUID) no Supabase.
      // Registros legados 'rb_*' continuam válidos localmente (migração em
      // normalizeLegacyRecurringIds) e são filtrados só no upsert remoto.
      id: LinsoraUtils.generateUUID(),
      userId: this.state?.user?.id || 'usr_guest',
      title,
      amount,
      category,
      frequency: 'MONTHLY',
      dueDay,
      startDate: start,
      endDate: end,
      active: data.active !== false
    };
    if (!Array.isArray(this.state.recurringBills)) this.state.recurringBills = [];
    this.state.recurringBills.push(rec);
    this.notify();
    return rec;
  }

  /**
   * Atualiza a regra recorrente (mesmas validações da criação).
   * Nunca altera ocorrências PAID nem reescreve PENDING existentes:
   * novas gerações usam os dados atualizados.
   */
  async updateRecurringBill(billId, billData) {
    const data = billData || {};
    const bills = this.state?.recurringBills || [];
    const bill = bills.find((b) => b.id === billId && (b.userId || b.user_id) === this.state?.user?.id);
    if (!bill) return false;
    const title = String(data.title || '').trim();
    const amount = parseFloat(data.amount);
    const dueDay = parseInt(data.due_day ?? data.dueDay, 10);
    const start = String(data.start_date ?? data.startDate ?? '').slice(0, 10);
    const endRaw = data.end_date ?? data.endDate ?? null;
    const end = endRaw ? String(endRaw).slice(0, 10) : null;
    const category = String(data.category || '').trim();
    if (!title || !(amount > 0) || !category) return false;
    if (!(dueDay >= 1 && dueDay <= 31)) return false;
    if (!/^\d{4}-\d{2}-\d{2}/.test(start)) return false;
    if (end && end < start) return false;

    bill.title = title;
    bill.amount = amount;
    bill.category = category;
    bill.dueDay = dueDay;
    bill.startDate = start;
    bill.endDate = end;
    this.notify();
    return true;
  }

  /**
   * Ativa/desativa a regra. Ao desativar, PENDING futuras (due > hoje)
   * viram SKIPPED com motivo; vencidas e PAID permanecem intactas.
   * Reativar não restaura SKIPPED (motor gera novas quando necessário).
   */
  async toggleRecurringBillActive(billId) {
    const bills = this.state?.recurringBills || [];
    const uid = this.state?.user?.id;
    const bill = bills.find((b) => b.id === billId && (b.userId || b.user_id) === uid);
    if (!bill) return false;
    bill.active = bill.active === false;
    if (bill.active === false) {
      const today = LinsoraUtils.toLocalDateKey();
      (this.state?.occurrences || [])
        .filter((o) => o.recurringBillId === billId && o.userId === uid && o.status === 'PENDING' && o.dueDate && o.dueDate > today)
        .forEach((o) => {
          o.status = 'SKIPPED';
          o.skippedReason = 'Regra desativada';
        });
    }
    this.notify();
    return bill.active !== false;
  }

  /**
   * Exclusão real da regra (destrutiva: occurrences somem pelo CASCADE
   * no banco; localmente filtra as vinculadas). Transactions preservadas.
   */
  async deleteRecurringBill(billId) {
    const uid = this.state?.user?.id;
    const bills = this.state?.recurringBills || [];
    if (!bills.some((b) => b.id === billId && (b.userId || b.user_id) === uid)) return false;
    this.state.recurringBills = bills.filter((b) => b.id !== billId);
    this.state.occurrences = (this.state?.occurrences || []).filter((o) => o.recurringBillId !== billId);
    this.notify();
    const remoteResult = await window.supabaseRepo.deleteDbRecord('recurring_bills', billId, uid);
    if (!remoteResult.success && window.LinsoraNotifications?.show) {
      window.LinsoraNotifications.show('Conta excluída localmente, mas não foi possível remover do servidor.', 'warning');
    }
    return true;
  }

  /**
   * Persiste o estado sem notificar listeners (sem re-render da UI).
   * Usado pelos pontos de garantia (ensures): a ocorrência precisa
   * sobreviver a reload/logout/login, mas a garantia não deve redesenhar
   * a interface. Fire-and-forget: saveDbData grava o localStorage na hora
   * e sincroniza com o Supabase em segundo plano (somente linhas com IDs
   * UUID válidos sobem; legados 'rb_*'/'rbocc_*' permanecem locais —
   * ver syncToSupabaseRemote). Nunca lança.
   */
  persistState() {
    try {
      if (this.state?.user && window.supabaseRepo?.saveDbData) {
        const p = window.supabaseRepo.saveDbData(this.state, this.state.user.id);
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    } catch (e) { /* durabilidade best-effort: a memória segue válida */ }
  }

  /**
   * Normalização local, idempotente e NÃO destrutiva de IDs legados das
   * recorrências ('rb_*'/'rbocc_*') para UUID v4. IMPORTANTE (isolamento
   * multiusuário): esta função NUNCA altera titularidade — só toca linhas
   * que JÁ pertencem ao usuário corrente; linhas de outro usuário (inclusive
   * placeholder guest) são intocadas. A transferência guest→conta ocorre
   * somente via reivindicação consentida (claim guest em supabase-client.js),
   * que já entrega as linhas com o userId correto. Reescreve referências
   * (occurrence.recurringBillId) e remove duplicatas da chave
   * (userId + recurringBillId + dueDate), preferindo PENDING.
   * Retorna a quantidade de ajustes.
   */
  normalizeLegacyRecurringIds() {
    const uid = this.state?.user?.id;
    if (!uid || !Array.isArray(this.state?.recurringBills) || !Array.isArray(this.state?.occurrences)) return 0;
    const isUUID = (v) => (window.LinsoraUtils?.isUUID
      ? window.LinsoraUtils.isUUID(v)
      : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || '')));
    let changed = 0;
    const billIdMap = new Map();
    this.state.recurringBills.forEach((b) => {
      if ((b.userId ?? b.user_id) !== uid) return;
      if (!isUUID(b.id)) {
        const nu = LinsoraUtils.generateUUID();
        billIdMap.set(b.id, nu);
        b.id = nu;
        changed += 1;
      }
    });
    this.state.occurrences.forEach((o) => {
      if (o.userId !== uid) return;
      if (billIdMap.has(o.recurringBillId)) {
        o.recurringBillId = billIdMap.get(o.recurringBillId);
        changed += 1;
      }
      if (!isUUID(o.id)) {
        o.id = LinsoraUtils.generateUUID();
        changed += 1;
      }
    });
    if (changed > 0) {
      const rank = { PENDING: 0, PAID: 1, SKIPPED: 2 };
      const best = new Map();
      this.state.occurrences.forEach((o) => {
        const k = `${o.userId}|${o.recurringBillId}|${o.dueDate}`;
        const cur = best.get(k);
        if (!cur || (rank[o.status] ?? 9) < (rank[cur.status] ?? 9)) best.set(k, o);
      });
      if (best.size !== this.state.occurrences.length) {
        this.state.occurrences = this.state.occurrences.filter(
          (o) => best.get(`${o.userId}|${o.recurringBillId}|${o.dueDate}`) === o
        );
      }
    }
    return changed;
  }

  /**
   * Garante ocorrências PENDING para a janela (idempotente: nunca duplica —
   * chave userId + recurringBillId + dueDate).
   * Retorna a quantidade criada. Durabilidade: se criou ocorrências ou
   * migrou IDs legados, persiste (localStorage + sync Supabase); com
   * silent:true, persiste SEM notificar listeners, preservando o cálculo
   * puro a jusante (getCommitmentsUntilNextReceipt segue leitura pura).
   */
  ensureRecurringOccurrences(windowStartKey, windowEndKey, options = {}) {
    if (!windowStartKey || !windowEndKey || windowEndKey < windowStartKey) return 0;
    const uid = this.state?.user?.id;
    if (!uid) return 0;
    if (!Array.isArray(this.state.recurringBills)) this.state.recurringBills = [];
    if (!Array.isArray(this.state.occurrences)) this.state.occurrences = [];
    let migrated = 0;
    try { migrated = this.normalizeLegacyRecurringIds(); } catch (e) { migrated = 0; }
    let added = 0;
    this.state.recurringBills.forEach((bill) => {
      if ((bill.userId || bill.user_id) !== uid) return;
      const generated = LinsoraUtils.generateMonthlyOccurrences(bill, windowStartKey, windowEndKey);
      generated.forEach((g) => {
        const exists = this.state.occurrences.some((o) =>
          o.userId === uid && o.recurringBillId === g.recurring_bill_id && o.dueDate === g.due_date
        );
        if (!exists) {
          this.state.occurrences.push({
            // ID UUID v4: compatível com recurring_bill_occurrences.id (UUID).
            id: LinsoraUtils.generateUUID(),
            recurringBillId: g.recurring_bill_id,
            userId: uid,
            dueDate: g.due_date,
            expectedAmount: g.expected_amount,
            status: 'PENDING',
            paidAmount: null,
            paidAt: null,
            transactionId: null
          });
          added += 1;
        }
      });
    });
    if (added + migrated > 0) {
      if (options?.silent !== true) this.notify();
      else if (options?.persist !== false) this.persistState();
    }
    return added;
  }

  /**
   * Garante ocorrências para a janela do mês corrente.
   * Idempotente, não duplica ocorrências existentes.
   */
  ensureCurrentWindowOccurrences(options = {}) {
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth();
    const p = (v) => String(v).padStart(2, '0');
    const startKey = `${y}-${p(m + 1)}-01`;
    const lastDay = new Date(y, m + 1, 0).getDate();
    const endKey = `${y}-${p(m + 1)}-${p(lastDay)}`;
    return this.ensureRecurringOccurrences(startKey, endKey, options);
  }

  /**
   * Altera status de ocorrência (nível de dado, sem UI). Valida enum,
   * titularidade e vínculo de transação com o mesmo usuário.
   */
  setOccurrenceStatus(occurrenceId, patch = {}) {
    const uid = this.state?.user?.id;
    const occs = this.state?.occurrences || [];
    const occ = occs.find((o) => o.id === occurrenceId && o.userId === uid);
    if (!occ) return false;
    const status = patch.status;
    if (!['PENDING', 'PAID', 'SKIPPED'].includes(status)) return false;
    if (patch.transaction_id !== undefined && patch.transaction_id !== null) {
      const tx = (this.state?.transactions || []).find(
        (t) => t.id === patch.transaction_id && t.userId === uid
      );
      if (!tx) return false;
      occ.transactionId = patch.transaction_id;
    }
    occ.status = status;
    if (status === 'PAID') {
      occ.paidAmount = patch.paid_amount !== undefined && patch.paid_amount !== null
        ? patch.paid_amount
        : occ.expectedAmount;
      if (!occ.paidAt) occ.paidAt = new Date().toISOString();
    }
    if (status === 'SKIPPED' && patch.skipped_reason !== undefined) {
      occ.skippedReason = patch.skipped_reason;
    }
    this.notify();
    return true;
  }

  getAccountsBalance() {
    if (!this.state || !this.state.accounts) return 0;
    return this.state.accounts.reduce((acc, a) => acc + (Number(a.balance) || 0), 0);
  }

  /**
   * Motor central de compromissos: quanto do dinheiro atual já está
   * comprometido até dateKey (YYYY-MM-DD). Puro sobre o estado em memória.
   * Inclui: ocorrências PENDING (qualquer due_date <= dateKey, inclusive
   * vencidas) + UMA obrigação por cartão com limit_used > 0 cujo vencimento
   * seja elegível. Exclui: PAID, SKIPPED, transactions, goals,
   * monthlyContribution, receitas futuras, patrimônio, fixed_bills e
   * qualquer dado de outro usuário.
   */
  getCommittedAmountUntil(dateKey) {
    const empty = { total: 0, items: [] };
    if (!dateKey || !this.state?.user?.id) return empty;
    const uid = this.state.user.id;
    const todayKey = LinsoraUtils.toLocalDateKey();
    const items = [];

    (this.state.occurrences || [])
      .filter((o) => o.userId === uid && o.status === 'PENDING' && o.dueDate && o.dueDate <= dateKey)
      .forEach((o) => {
        const bill = (this.state.recurringBills || []).find((b) => b.id === o.recurringBillId);
        items.push({
          type: 'RECURRING_BILL',
          title: (bill && bill.title) || 'Conta recorrente',
          amount: Number(o.expectedAmount) || 0,
          dueDate: o.dueDate,
          originId: o.id
        });
      });

    (this.state.cards || [])
      .filter((c) => (c.userId || c.user_id) === uid && (Number(c.limitUsed ?? c.limit_used) || 0) > 0)
      .forEach((c) => {
        const due = LinsoraUtils.resolveInvoiceDueDate(
          c.dueDay ?? c.due_day, todayKey, dateKey, todayKey
        );
        if (due && due <= dateKey) {
          items.push({
            type: 'CARD_INVOICE',
            title: `Fatura ${c.name}`,
            amount: Number(c.limitUsed ?? c.limit_used) || 0,
            dueDate: due,
            originId: c.id
          });
        }
      });

    const total = items.reduce((acc, i) => acc + (Number(i.amount) || 0), 0);
    return { total, items };
  }

  /**
   * Margem disponível: saldos das contas menos compromissos elegíveis.
   * Conceitual (V1): sem receitas futuras, sem metas, sem patrimônio.
   */
  getAvailableMargin(dateKey) {
    return this.getAccountsBalance() - this.getCommittedAmountUntil(dateKey).total;
  }

  /* ------------------------------------------------------------------------
     CICLO FINANCEIRO DO CONSELHEIRO (V1) — hoje até o próximo recebimento.
     A Visão Consolidada continua mensal (getCurrentMonthCommitments);
     o Conselheiro usa o ciclo (getCommitmentsUntilNextReceipt).
     ------------------------------------------------------------------------ */

  /**
   * Próximo recebimento (V1): menor data futura entre transactions do tipo
   * RECEITA com date > hoje (chave YYYY-MM-DD). Retorna a data (YYYY-MM-DD)
   * ou null quando não há recebimento futuro cadastrado.
   * LIMITAÇÃO V1: baseia-se apenas em recebimentos futuros já cadastrados
   * como transação; não existe receita recorrente/salário modelado, e
   * receitas passadas ou de hoje são ignoradas.
   */
  getNextReceiptDate(todayKey) {
    const today = todayKey || LinsoraUtils.toLocalDateKey();
    let next = null;
    (this.state?.transactions || []).forEach((t) => {
      if (!t || t.type !== 'RECEITA') return;
      const d = String(t.date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}/.test(d) || d <= today) return;
      if (!next || d < next) next = d;
    });
    return next;
  }

  /**
   * Janela do ciclo: { startDate, endDate, nextReceiptDate, usedFallback }.
   * startDate = hoje; endDate = próximo recebimento ou, na ausência dele,
   * o último dia do mês atual (usedFallback = true).
   */
  getCommitmentWindow(todayKey) {
    const today = todayKey || LinsoraUtils.toLocalDateKey();
    const nextReceiptDate = this.getNextReceiptDate(today);
    if (nextReceiptDate) {
      return { startDate: today, endDate: nextReceiptDate, nextReceiptDate, usedFallback: false };
    }
    const p = (v) => String(v).padStart(2, '0');
    const parts = String(today).split('-').map(Number);
    const lastDay = new Date(parts[0], parts[1], 0).getDate();
    return {
      startDate: today,
      endDate: `${parts[0]}-${p(parts[1])}-${p(lastDay)}`,
      nextReceiptDate: null,
      usedFallback: true
    };
  }

  /**
   * Compromissos do mês (Visão Consolidada): primeiro ao último dia do mês
   * corrente. Reutiliza o motor existente; não usar o ciclo aqui.
   */
  getCurrentMonthCommitments() {
    const today = new Date();
    const p = (v) => String(v).padStart(2, '0');
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const monthEndKey = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(lastDay)}`;
    return this.getCommittedAmountUntil(monthEndKey);
  }

  /**
   * Garante ocorrências recorrentes até o fim do ciclo (idempotente, sem
   * criar transações nem alterar saldos). Deve ser chamado nos pontos de
   * entrada do fluxo (antes do cálculo), nunca dentro de cálculo/render.
   * Retorna a janela utilizada.
   */
  ensureCycleOccurrences() {
    const win = this.getCommitmentWindow();
    try {
      if (typeof this.ensureRecurringOccurrences === 'function') {
        this.ensureRecurringOccurrences(win.startDate, win.endDate, { silent: true });
      }
    } catch (e) { /* mantém cálculo com ocorrências já existentes */ }
    return win;
  }

  /**
   * Compromissos do Conselheiro: leitura pura sobre o estado (não gera
   * ocorrências — use ensureCycleOccurrences() antes). Reutiliza
   * getCommittedAmountUntil(endDate). Retorna a janela + total/items.
   */
  getCommitmentsUntilNextReceipt() {
    const win = this.getCommitmentWindow();
    const committed = this.getCommittedAmountUntil(win.endDate);
    return {
      startDate: win.startDate,
      endDate: win.endDate,
      nextReceiptDate: win.nextReceiptDate,
      usedFallback: win.usedFallback,
      total: committed.total,
      items: committed.items
    };
  }

  /* ------------------------------------------------------------------------
     OPERAÇÕES DE METAS
     ------------------------------------------------------------------------ */
  async addGoal(goalData) {
    const icons = ['🎯', '✈️', '🚗', '🏠', '💎', '📈', '🛡️', '💰'];
    const newGoal = {
      id: 'goal_' + Date.now(),
      userId: (this.state && this.state.user) ? this.state.user.id : 'usr_guest',
      title: goalData.title || 'Nova Meta',
      target: goalData.target !== undefined && goalData.target !== null && goalData.target !== '' ? (parseFloat(goalData.target) || 0) : 1000,
      current: parseFloat(goalData.current) || 0,
      category: goalData.category || 'Economia',
      deadline: goalData.deadline || '2026-12-31',
      icon: goalData.icon || icons[this.state.goals.length % icons.length],
      color: goalData.color || '#10B981',
      monthlyContribution: parseFloat(goalData.monthlyContribution) || 0
    };
    this.state.goals.push(newGoal);
    if (window.LinsoraLogger) window.LinsoraLogger.write('Meta Financeira Criada', { title: newGoal.title, target: newGoal.target }, this.state?.user?.id);
    this.notify();
    return newGoal;
  }

  async updateGoal(goalId, goalData) {
    if (!goalId) return false;
    const goal = this.state.goals.find(g => g.id === goalId);
    if (goal) {
      if (goalData.title) goal.title = goalData.title;
      if (goalData.target !== undefined) goal.target = parseFloat(goalData.target) || 0;
      if (goalData.current !== undefined) goal.current = parseFloat(goalData.current) || 0;
      if (goalData.deadline) goal.deadline = goalData.deadline;
      if (goalData.icon) goal.icon = goalData.icon;
      if (goalData.color) goal.color = goalData.color;
      if (goalData.monthlyContribution !== undefined) goal.monthlyContribution = parseFloat(goalData.monthlyContribution) || 0;

      if (window.LinsoraLogger) window.LinsoraLogger.update('Meta Atualizada', { goalId, title: goal.title }, this.state?.user?.id);
      this.notify();
      return true;
    }
    return false;
  }

  async updateGoalProgress(goalId, amountToAdd) {
    if (!goalId) return false;
    const goal = this.state.goals.find(g => g.id === goalId);
    if (goal) {
      goal.current = (parseFloat(goal.current) || 0) + parseFloat(amountToAdd);
      if (window.LinsoraLogger) window.LinsoraLogger.update('Progresso de Meta Atualizado', { goalId, amount: amountToAdd }, this.state?.user?.id);
      this.notify();
      return true;
    }
    return false;
  }

  async deleteGoal(goalId) {
    if (!goalId) return false;
    const initialLen = this.state.goals.length;
    this.state.goals = this.state.goals.filter(g => g.id !== goalId);
    if (this.state.goals.length < initialLen) {
      if (window.LinsoraLogger) window.LinsoraLogger.update('Meta Excluída', { goalId }, this.state?.user?.id);
      this.notify();
      // Propagar DELETE ao Supabase remoto
      const userId = this.state?.user?.id;
      const remoteResult = await window.supabaseRepo.deleteDbRecord('goals', goalId, userId);
      if (!remoteResult.success && window.LinsoraNotifications?.show) {
        window.LinsoraNotifications.show('Meta excluída localmente, mas não foi possível remover do servidor.', 'warning');
      }
      return true;
    }
    return false;
  }

  async depositToGoal(goalId, amount) {
    const numericAmount = parseFloat(amount);
    if (!goalId || isNaN(numericAmount) || numericAmount <= 0) return false;

    const goal = this.state.goals.find(g => g.id === goalId);
    if (goal) {
      const currentVal = parseFloat(goal.current) || 0;
      const targetVal = parseFloat(goal.target) || 999999999;
      goal.current = currentVal + numericAmount;
      if (window.LinsoraLogger) window.LinsoraLogger.update('Aporte em Meta', { goalTitle: goal.title, amount: numericAmount, newTotal: goal.current }, this.state?.user?.id);
      this.notify();
      return true;
    }
    return false;
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
   * Transações do mês calendário atual (01 → hoje, local, sem UTC/futuras).
   * Reutiliza a infraestrutura de período do Extrato (getPeriodBounds/txInBounds),
   * disponível globalmente em tempo de execução. Base dos indicadores "do Mês".
   */
  getCurrentMonthTransactions() {
    if (!this.state || !this.state.transactions) return [];
    if (typeof getPeriodBounds !== 'function' || typeof txInBounds !== 'function') {
      return [...this.state.transactions];
    }
    const bounds = getPeriodBounds('THIS_MONTH');
    return this.state.transactions.filter(t => txInBounds(t, bounds));
  }

  getCurrentMonthIncome() {
    return this.getCurrentMonthTransactions()
      .filter(t => t.type === 'RECEITA')
      .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
  }

  getCurrentMonthExpense() {
    return this.getCurrentMonthTransactions()
      .filter(t => t.type === 'DESPESA' && !this.isCardPurchaseLeg(t))
      .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
  }

  /**
   * Perna da COMPRA no cartão (dívida em limitUsed, sem saída bancária).
   * Regra de caixa (anti-dupla-contagem): a compra NÃO entra na despesa do
   * mês; só o PAGAMENTO da fatura (isCardPayment, conta bancária) conta
   * como saída. Histórico de ambos preservado; só a métrica exclui a
   * compra: modelo novo (paymentMethod 'credit') ou conta 'Cartão <nome>'
   * com cartão correspondente existente.
   */
  isCardPurchaseLeg(t) {
    if (!t || t.type !== 'DESPESA' || t.isCardPayment) return false;
    if (t.paymentMethod === 'credit') return true;
    const acc = String(t.account || '');
    if (acc.includes('Cartão')) {
      const cards = this.state?.cards || [];
      return cards.some((c) => acc.includes(c.name));
    }
    return false;
  }

  getCurrentMonthBalance() {
    return this.getCurrentMonthIncome() - this.getCurrentMonthExpense();
  }

  getCurrentMonthCommitmentPct() {
    const income = this.getCurrentMonthIncome();
    if (income <= 0) return 0;
    const expense = this.getCurrentMonthExpense();
    return Math.min(100, Math.round((expense / income) * 100));
  }

  getCurrentMonthSaved() {
    const balance = this.getCurrentMonthBalance();
    return balance > 0 ? balance : 0;
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
    const income = this.getCurrentMonthIncome();
    const expense = this.getCurrentMonthExpense();
    const commitmentPct = this.getCurrentMonthCommitmentPct();

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
    return `Visualizado hoje às ${hours}:${mins}`;
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

    const income = this.getCurrentMonthIncome();
    const expense = this.getCurrentMonthExpense();
    const balance = this.getCurrentMonthBalance();
    const hideValues = this.isHideValues;
    const goals = this.state.goals || [];

    // Encontrar maior categoria do mês atual
    const expTxs = this.getCurrentMonthTransactions().filter(t => t.type === 'DESPESA');
    const catTotals = {};
    expTxs.forEach(t => catTotals[t.category] = (catTotals[t.category] || 0) + (Number(t.amount) || 0));
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
        text: `Suas despesas superaram suas receitas em ${LinsoraUtils.formatBRL(Math.abs(balance), hideValues)}. Recomendamos cortar gastos secundários em ${topCat || 'Outros'}.`
      };
    }

    if (balance > 0 && goals.length > 0) {
      const targetGoal = goals[0];
      return {
        isActionable: true,
        title: '🎯 Oportunidade de Economia',
        text: `Você possui ${LinsoraUtils.formatBRL(balance, hideValues)} livres este mês. Que tal guardar uma parte na sua meta "${LinsoraUtils.escapeHTML(targetGoal.title)}"?`
      };
    }

    if (balance > 0) {
      return {
        isActionable: true,
        title: '✨ Boa Margem Financeira',
        text: `Suas receitas superaram as despesas em ${LinsoraUtils.formatBRL(balance, hideValues)}. Mantenha essa margem para reforçar sua reserva de emergência.`
      };
    }

    return {
      isActionable: true,
      title: '📊 Análise de Movimentações',
      text: `Seu maior volume de gasto no mês foi em ${topCat || 'Alimentação'} (${LinsoraUtils.formatBRL(topCatVal, hideValues)}).`
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
