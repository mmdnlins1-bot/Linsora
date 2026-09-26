/**
 * ============================================================================
 * LINSORA — CONTROLADOR DE INTERFACE DO ASSISTENTE DE VOZ (voice-assistant-ui.js)
 * Modais de escuta, card de confirmação, edição e salvamento no Supabase
 * ============================================================================
 */

class VoiceAssistantUIController {
  constructor() {
    this.currentMode = 'TRANSACTION'; // 'TRANSACTION' ou 'GOAL'
    this.currentParsedTx = null;
    this.currentParsedGoal = null;
    this.lastTranscript = '';
    // ETAPA 6C: controle de processamento (anti-duplo + indicador).
    this.isProcessing = false;
    this.processScheduled = false;
    this.processTimer = null;
  }

  /**
   * Verifica se já existe captura ativa ou processamento em andamento.
   */
  _isBusy() {
    return this.isProcessing || this.processScheduled ||
      (window.VoiceRecognitionEngine && window.VoiceRecognitionEngine.isListening);
  }

  /**
   * Limpa o processamento pendente/agendado, se existir. Idempotente.
   */
  _clearPendingProcess() {
    if (this.processTimer) {
      clearTimeout(this.processTimer);
      this.processTimer = null;
    }
    this.processScheduled = false;
    this.isProcessing = false;
  }

  /**
   * Abre o modal de escuta para Transações.
   */
  async startVoiceCapture() {
    // ETAPA 6C: não inicia outra captura enquanto houver uma ativa/em processamento.
    if (this._isBusy()) return;
    this.currentMode = 'TRANSACTION';
    this.lastTranscript = '';
    this.currentParsedTx = null;

    const transcriptEl = document.getElementById('voiceTranscriptText');
    const statusEl = document.getElementById('voiceStatusSubtitle');
    const waveEl = document.getElementById('voiceWaveAnimation');

    if (transcriptEl) transcriptEl.innerText = 'Fale agora, ex: "Gastei 45 reais no mercado hoje"...';
    if (statusEl) statusEl.innerText = 'Ouvindo lançamento em tempo real...';
    if (waveEl) waveEl.classList.add('active');

    LinsoraUI.openModal('modalVoiceListening');
    this._initEngineListening(statusEl, transcriptEl, waveEl);
  }

  /**
   * Abre o modal de escuta para Metas e Reservas Financeiras.
   */
  async startGoalVoiceCapture() {
    // ETAPA 6C: não inicia outra captura enquanto houver uma ativa/em processamento.
    if (this._isBusy()) return;
    this.currentMode = 'GOAL';
    this.lastTranscript = '';
    this.currentParsedGoal = null;

    const transcriptEl = document.getElementById('voiceTranscriptText');
    const statusEl = document.getElementById('voiceStatusSubtitle');
    const waveEl = document.getElementById('voiceWaveAnimation');

    if (transcriptEl) transcriptEl.innerText = 'Fale agora, ex: "Quero criar uma reserva de emergência de 10 mil reais em 12 meses"...';
    if (statusEl) statusEl.innerText = 'Ouvindo meta ou reserva financeiras...';
    if (waveEl) waveEl.classList.add('active');

    LinsoraUI.openModal('modalVoiceListening');
    this._initEngineListening(statusEl, transcriptEl, waveEl);
  }

  async _initEngineListening(statusEl, transcriptEl, waveEl) {
    const started = await window.VoiceRecognitionEngine.startListening({
      onStart: () => {
        if (statusEl) statusEl.innerText = 'Microfone ativado. Fale seu objetivo ou lançamento...';
      },
      onResult: (transcriptText, isFinal) => {
        this.lastTranscript = transcriptText;
        if (transcriptEl) transcriptEl.innerText = `"${transcriptText}"`;

        if (isFinal && transcriptText.trim().length > 3) {
          // ETAPA 6C: no máximo um processamento por captura; estado visual
          // "processando" separado de "ouvindo".
          if (this.processScheduled || this.isProcessing) return;
          this.processScheduled = true;
          if (statusEl) statusEl.innerText = 'Processando sua fala...';
          if (waveEl) waveEl.classList.remove('active');
          this.processTimer = setTimeout(() => {
            this.processTimer = null;
            this.processCapturedVoice(transcriptText);
          }, 600);
        }
      },
      onError: (errorMsg) => {
        // ETAPA 6C: erro encerra a captura — nada pode ser processado depois.
        this._clearPendingProcess();
        if (statusEl) statusEl.innerText = `⚠️ ${errorMsg}`;
        if (waveEl) waveEl.classList.remove('active');
        LinsoraUI.showToast(errorMsg, 'warning');
      },
      onEnd: () => {
        if (waveEl) waveEl.classList.remove('active');
      }
    });

    if (!started && !window.VoiceRecognitionEngine.isSupported) {
      if (statusEl) statusEl.innerText = 'Voz não suportada neste navegador. Digite abaixo:';
    }
  }

  /**
   * Para a escuta manualmente e processa o texto capturado.
   */
  stopAndProcess() {
    // ETAPA 6C: processamento manual cancela o agendamento automático pendente.
    if (this.processTimer) {
      clearTimeout(this.processTimer);
      this.processTimer = null;
    }
    this.processScheduled = false;
    window.VoiceRecognitionEngine.stopListening();
    const textInput = document.getElementById('voiceManualInput');
    const textToProcess = (textInput && textInput.value.trim()) || this.lastTranscript;

    if (textToProcess && textToProcess.trim().length > 0) {
      this.processCapturedVoice(textToProcess);
    } else {
      LinsoraUI.showToast('Nenhum texto capturado. Tente novamente.', 'info');
      LinsoraUI.closeModal('modalVoiceListening');
    }
  }

  /**
   * Envia o texto para a IA Parser e exibe o Card de Confirmação correspondente.
   * @param {string} rawText 
   */
  processCapturedVoice(rawText) {
    // ETAPA 6C: marca processamento ativo; liberado ao final em todos os caminhos.
    this.isProcessing = true;
    this.processScheduled = false;
    window.VoiceRecognitionEngine.stopListening();
    LinsoraUI.closeModal('modalVoiceListening');

    const lowerText = (rawText || '').toLowerCase();
    
    // Intercept: se for uma pergunta, redireciona para o Consultor (Strategic Advisor)
    if (window.LinsoraStrategicAdvisor) {
      const intent = window.LinsoraStrategicAdvisor.detectIntent(lowerText);
      if (intent === 'QUESTION' || intent === 'WITHDRAW_QUESTION') {
        window.LinsoraStrategicAdvisor.openAdvisorModal(rawText);
        this.isProcessing = false;
        return;
      }
    }

    const isGoalIntent = this.currentMode === 'GOAL' || (window.TransactionAIParser && window.TransactionAIParser.hasGoalIntent(lowerText));

    if (isGoalIntent) {
      const parsedGoal = window.TransactionAIParser.parseGoalText(rawText);
      this.currentParsedGoal = parsedGoal;
      this.openGoalConfirmationCard(parsedGoal);
    } else {
      const categories = (window.linsoraStore && window.linsoraStore.state && window.linsoraStore.state.categories) || [];
      const parsedTx = window.TransactionAIParser.parseText(rawText, categories);
      this.currentParsedTx = parsedTx;
      this.openConfirmationCard(parsedTx);
    }
    this.isProcessing = false;
  }

  /**
   * Exibe o Card de Confirmação de Transações.
   */
  openConfirmationCard(parsed) {
    const isIncome = parsed.type === 'RECEITA';

    const badgeEl = document.getElementById('voiceConfTypeBadge');
    const amountEl = document.getElementById('voiceConfAmount');
    const categoryEl = document.getElementById('voiceConfCategory');
    const descEl = document.getElementById('voiceConfDescription');
    const dateEl = document.getElementById('voiceConfDate');
    const rawEl = document.getElementById('voiceConfRawText');

    if (badgeEl) {
      badgeEl.className = `voice-conf-badge ${isIncome ? 'income' : 'expense'}`;
      badgeEl.textContent = isIncome ? '💰 Receita' : '💸 Despesa';
    }

    if (amountEl) {
      amountEl.className = `voice-conf-amount-val ${isIncome ? 'income' : 'expense'}`;
      amountEl.innerText = (isIncome ? '+ ' : '- ') + LinsoraUtils.formatBRL(parsed.amount);
    }

    if (categoryEl) {
      const icon = LinsoraUtils.getCategoryIcon(parsed.category);
      categoryEl.textContent = '';
      const chip = document.createElement('span');
      chip.className = 'cat-chip-icon';
      chip.textContent = icon;
      categoryEl.appendChild(chip);
      categoryEl.appendChild(document.createTextNode(' ' + parsed.category));
    }

    if (descEl) descEl.innerText = parsed.description;
    if (dateEl) dateEl.innerText = LinsoraUtils.formatDateBR(parsed.date);
    if (rawEl) rawEl.innerText = `"${parsed.rawText}"`;

    LinsoraUI.openModal('modalVoiceConfirmation');
  }

  /**
   * Exibe o Card de Confirmação de Metas.
   */
  openGoalConfirmationCard(parsed) {
    const badgeEl = document.getElementById('goalConfTypeBadge');
    const titleEl = document.getElementById('goalConfTitle');
    const targetEl = document.getElementById('goalConfTarget');
    const deadlineEl = document.getElementById('goalConfDeadline');
    const monthlyEl = document.getElementById('goalConfMonthly');
    const rawEl = document.getElementById('goalConfRawText');

    if (badgeEl) {
      if (parsed.isExistingGoal) {
        badgeEl.textContent = `➕ APORTE EM META EXISTENTE`;
        badgeEl.style.background = 'rgba(16, 185, 129, 0.2)';
        badgeEl.style.color = 'var(--accent-green-neon)';
      } else {
        badgeEl.textContent = `${parsed.icon} ${parsed.type}`;
        badgeEl.style.background = '';
        badgeEl.style.color = '';
      }
    }

    if (titleEl) titleEl.innerText = parsed.title;
    if (targetEl) {
      if (parsed.isExistingGoal) {
        targetEl.innerText = `+ ${LinsoraUtils.formatBRL(parsed.amount)} (Novo total: ${LinsoraUtils.formatBRL(parsed.newCurrent)})`;
      } else {
        targetEl.innerText = LinsoraUtils.formatBRL(parsed.target);
      }
    }
    if (deadlineEl) deadlineEl.innerText = parsed.deadline ? LinsoraUtils.formatDateBR(parsed.deadline) : 'Sem prazo';
    if (monthlyEl) {
      if (parsed.isExistingGoal) {
        const pct = parsed.target > 0 ? Math.min(100, Math.round((parsed.newCurrent / parsed.target) * 100)) : 0;
        monthlyEl.innerText = `Progresso: ${pct}% de ${LinsoraUtils.formatBRL(parsed.target)}`;
      } else {
        monthlyEl.innerText = LinsoraUtils.formatBRL(parsed.suggestedMonthly) + '/mês';
      }
    }
    if (rawEl) rawEl.innerText = `"${parsed.rawText}"`;

    LinsoraUI.openModal('modalGoalVoiceConfirmation');
  }

  /**
   * Confirma e Salva a Transação no Supabase.
   */
  async confirmAndSave() {
    if (!this.currentParsedTx) {
      LinsoraUI.showToast('Erro ao identificar transação.', 'error');
      return;
    }

    // Validação central: transação financeira exige valor finito maior que zero.
    // Frases sem valor (ex: "gastei no mercado") permanecem no fluxo de
    // confirmação/edição em vez de salvar R$ 0,00.
    const parsedAmount = Number(this.currentParsedTx.amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      LinsoraUI.showToast('Não identifiquei um valor válido. Toque em Editar, informe o valor e salve.', 'error');
      return;
    }

    const accounts = (window.linsoraStore && window.linsoraStore.state && window.linsoraStore.state.accounts) || [];
    const defaultAccount = accounts.length > 0 ? accounts[0].name : 'Carteira Principal';
    const cardHint = this.currentParsedTx.cardHint || null;

    // Pagamento de fatura ("paguei X da fatura [do Nome]"): reduz limitUsed
    // do cartão identificado + debita a conta, sem recriar a despesa
    // original. Pagamento NUNCA cai silenciosamente no fluxo bancário:
    // cartão ambíguo/não identificado pede escolha explícita (mesma
    // filosofia da compra ambígua), sem tocar saldo ou limitUsed.
    if (this.currentParsedTx.isCardPayment) {
      const store = window.linsoraStore;
      const payCard = store?.resolvePurchaseCard ? store.resolvePurchaseCard(cardHint) : null;
      if (payCard) {
        try {
          const res = await store.payCardAmount(payCard.id, parsedAmount);
          LinsoraUI.closeModal('modalVoiceConfirmation');
          if (res) {
            LinsoraUI.showToast(`Pagamento de ${LinsoraUtils.formatBRL(res.paid)} registrado no cartão ${payCard.name}! 🎙️`);
          } else {
            LinsoraUI.showToast('Cartão sem valor em aberto para este pagamento.', 'info');
          }
        } catch (err) {
          console.error('[LINSORA Voice] Erro ao pagar fatura:', err);
          LinsoraUI.closeModal('modalVoiceConfirmation');
          LinsoraUI.showToast('Pagamento salvo localmente!');
        }
        this.currentParsedTx = null;
        return;
      }
      const cards = (store && store.state && store.state.cards) || [];
      LinsoraUI.closeModal('modalVoiceConfirmation');
      if (cardHint) {
        LinsoraUI.showToast(`Cartão "${cardHint}" não identificado. Selecione o cartão no formulário para concluir.`, 'error');
      } else if (cards.length > 1) {
        LinsoraUI.showToast('Qual cartão? Selecione o cartão no formulário para concluir.', 'info');
      } else if (cards.length === 0) {
        LinsoraUI.showToast('Nenhum cartão cadastrado para este pagamento.', 'error');
      } else {
        LinsoraUI.showToast('Não foi possível identificar o cartão.', 'error');
      }
      this.openFormToEdit();
      return;
    }

    // Compra no crédito (Bloco C):
    // - Cartão explícito: resolve exclusivamente o indicado, valida limite
    //   disponível (limitTotal - limitUsed) e salva somente nele. Sem limite
    //   ou sem identificação: erro controlado, sem fallback para outro
    //   cartão, sem despesa bancária e sem abrir o formulário.
    // - Cartão genérico: usa getEligibleCards(amount): 0 = erro; 1 = auto;
    //   2+ = modal modalCardPicker (nunca toast + formulário silencioso).
    // O ramo isCardPayment acima (pagamento de fatura, Bloco A) segue intacto.
    if (this.currentParsedTx.paymentMethod === 'credit'
        && this.currentParsedTx.type === 'DESPESA'
        && !this.currentParsedTx.isCardPayment
        && window.linsoraStore) {
      const store = window.linsoraStore;
      const hasExplicitHint = Boolean(String(cardHint || '').trim());
      if (hasExplicitHint) {
        const purchaseCard = store.resolvePurchaseCard ? store.resolvePurchaseCard(cardHint) : null;
        if (!purchaseCard) {
          LinsoraUI.closeModal('modalVoiceConfirmation');
          LinsoraUI.showToast(`Cartão "${cardHint}" não identificado. Verifique o nome do cartão.`, 'error');
          this.currentParsedTx = null;
          return;
        }
        const available = store.getCardAvailableLimit
          ? store.getCardAvailableLimit(purchaseCard)
          : Math.max(0, (Number(purchaseCard.limitTotal) || 0) - (Number(purchaseCard.limitUsed) || 0));
        if (parsedAmount > available) {
          LinsoraUI.closeModal('modalVoiceConfirmation');
          LinsoraUI.showToast(`${purchaseCard.name} não possui limite suficiente para essa compra. Limite disponível: ${LinsoraUtils.formatBRL(available)}.`, 'error');
          this.currentParsedTx = null;
          return;
        }
        try {
          await store.addCardPurchase({
            amount: parsedAmount,
            description: this.currentParsedTx.description,
            category: this.currentParsedTx.category,
            date: this.currentParsedTx.date,
            card: purchaseCard,
            notes: `Voz: "${this.currentParsedTx.rawText}"`
          });
          LinsoraUI.closeModal('modalVoiceConfirmation');
          LinsoraUI.showToast(`Compra de ${LinsoraUtils.formatBRL(parsedAmount)} lançada no cartão ${purchaseCard.name}! 🎙️`);
        } catch (err) {
          console.error('[LINSORA Voice] Erro ao salvar compra no cartão:', err);
          LinsoraUI.closeModal('modalVoiceConfirmation');
          LinsoraUI.showToast(err?.message || 'Cartão sem limite suficiente para essa compra.', 'error');
        }
        this.currentParsedTx = null;
        return;
      }
      const eligible = store.getEligibleCards ? store.getEligibleCards(parsedAmount) : [];
      if (eligible.length === 0) {
        LinsoraUI.closeModal('modalVoiceConfirmation');
        const total = (store.state?.cards || []).length;
        LinsoraUI.showToast(total === 0
          ? 'Nenhum cartão cadastrado para essa compra.'
          : 'Nenhum cartão possui limite suficiente para essa compra.', 'error');
        this.currentParsedTx = null;
        return;
      }
      if (eligible.length === 1) {
        const only = eligible[0];
        try {
          await store.addCardPurchase({
            amount: parsedAmount,
            description: this.currentParsedTx.description,
            category: this.currentParsedTx.category,
            date: this.currentParsedTx.date,
            card: only,
            notes: `Voz: "${this.currentParsedTx.rawText}"`
          });
          LinsoraUI.closeModal('modalVoiceConfirmation');
          LinsoraUI.showToast(`Compra de ${LinsoraUtils.formatBRL(parsedAmount)} lançada no cartão ${only.name}! 🎙️`);
        } catch (err) {
          console.error('[LINSORA Voice] Erro ao salvar compra no cartão:', err);
          LinsoraUI.closeModal('modalVoiceConfirmation');
          LinsoraUI.showToast(err?.message || 'Cartão sem limite suficiente para essa compra.', 'error');
        }
        this.currentParsedTx = null;
        return;
      }
      // 2+ elegíveis: modal de seleção por cardId (sem auto-escolha).
      const pendingTx = {
        amount: parsedAmount,
        description: this.currentParsedTx.description,
        category: this.currentParsedTx.category,
        date: this.currentParsedTx.date,
        rawText: this.currentParsedTx.rawText
      };
      LinsoraUI.closeModal('modalVoiceConfirmation');
      this.currentParsedTx = null;
      if (window.LinsoraCardPicker?.open) {
        window.LinsoraCardPicker.open({
          amount: pendingTx.amount,
          onSelect: async (cardId) => {
            try {
              const chosen = (store.state?.cards || []).find((c) => c.id === cardId);
              if (!chosen) {
                LinsoraUI.showToast('Cartão selecionado inválido.', 'error');
                return;
              }
              await store.addCardPurchase({
                amount: pendingTx.amount,
                description: pendingTx.description,
                category: pendingTx.category,
                date: pendingTx.date,
                card: chosen,
                notes: `Voz: "${pendingTx.rawText}"`
              });
              LinsoraUI.showToast(`Compra de ${LinsoraUtils.formatBRL(pendingTx.amount)} lançada no cartão ${chosen.name}! 🎙️`);
            } catch (err) {
              console.error('[LINSORA Voice] Erro ao salvar compra escolhida:', err);
              LinsoraUI.showToast(err?.message || 'Cartão sem limite suficiente para essa compra.', 'error');
            }
          },
          onCancel: () => {}
        });
      } else {
        LinsoraUI.showToast('Há mais de um cartão elegível. Selecione o cartão no formulário.', 'info');
        this.currentParsedTx = { ...pendingTx, paymentMethod: 'credit', type: 'DESPESA', cardHint: null, isCardPayment: false, amount: pendingTx.amount };
        this.openFormToEdit();
        return;
      }
      return;
    }

    // Demais lançamentos (bancários): mantém o comportamento atual
    // (despesa na conta padrão).
    let txAccount = defaultAccount;
    let txCardId = null;

    const txPayload = {
      type: this.currentParsedTx.type,
      amount: parsedAmount,
      description: this.currentParsedTx.description,
      category: this.currentParsedTx.category,
      date: this.currentParsedTx.date,
      account: txAccount,
      repetition: 'SINGLE',
      notes: `Voz: "${this.currentParsedTx.rawText}"`
    };
    if (txCardId) {
      txPayload.cardId = txCardId;
      txPayload.paymentMethod = 'credit';
    }

    try {
      await window.linsoraStore.saveTransaction(txPayload);
      LinsoraUI.closeModal('modalVoiceConfirmation');
      LinsoraUI.showToast(`Lançamento (${txPayload.type === 'RECEITA' ? 'Receita' : 'Despesa'}) salvo com sucesso via Voz! 🎙️`);
    } catch (err) {
      console.error('[LINSORA Voice] Erro ao salvar transação:', err);
      LinsoraUI.closeModal('modalVoiceConfirmation');
      LinsoraUI.showToast('Lançamento salvo localmente!');
    }
    this.currentParsedTx = null;
  }

  /**
   * Confirma e Salva a Meta Financeira no Supabase.
   */
  async confirmAndSaveGoal() {
    if (!this.currentParsedGoal) {
      LinsoraUI.showToast('Erro ao identificar meta.', 'error');
      return;
    }

    try {
      if (this.currentParsedGoal.isExistingGoal) {
        await window.linsoraStore.depositToGoal(this.currentParsedGoal.goalId, this.currentParsedGoal.amount);
        LinsoraUI.closeModal('modalGoalVoiceConfirmation');
        LinsoraUI.showToast(`Aporte de ${LinsoraUtils.formatBRL(this.currentParsedGoal.amount)} adicionado à meta "${this.currentParsedGoal.title}"! 🎯`, 'success');
      } else {
        const goalPayload = {
          title: this.currentParsedGoal.title,
          target: this.currentParsedGoal.target,
          current: 0,
          deadline: this.currentParsedGoal.deadline,
          icon: this.currentParsedGoal.icon
        };
        await window.linsoraStore.addGoal(goalPayload);
        LinsoraUI.closeModal('modalGoalVoiceConfirmation');
        LinsoraUI.showToast(`Meta "${goalPayload.title}" criada com sucesso via Voz! 🎯`, 'success');
      }
    } catch (err) {
      console.error('[LINSORA Voice] Erro ao salvar meta:', err);
      LinsoraUI.closeModal('modalGoalVoiceConfirmation');
      LinsoraUI.showToast('Meta salva localmente!');
    }

    this.currentParsedGoal = null;
  }

  /**
   * Abre o Formulário de Transação preenchido para Edição.
   */
  openFormToEdit() {
    if (!this.currentParsedTx) return;

    LinsoraUI.closeModal('modalVoiceConfirmation');
    if (typeof window.refreshTxAccountOptions === 'function') window.refreshTxAccountOptions(false);

    document.getElementById('txId').value = '';
    const centsStr = Math.round(this.currentParsedTx.amount * 100).toString();
    const formattedAmount = LinsoraUtils.formatCurrencyInput(centsStr);
    document.getElementById('txAmount').value = formattedAmount;

    document.getElementById('txDescription').value = this.currentParsedTx.description;
    document.getElementById('txDate').value = this.currentParsedTx.date;
    
    const catSelect = document.getElementById('txCategory');
    if (catSelect) {
      LinsoraUI.updateCategoryDropdown(this.currentParsedTx.type);
      catSelect.value = this.currentParsedTx.category;
    }

    if (window.setTxFormType) {
      window.setTxFormType(this.currentParsedTx.type);
    }

    LinsoraUI.openModal('modalTransactionForm');
    LinsoraUI.showToast('Formulário preenchido com a voz. Ajuste como preferir e salve!', 'info');
  }

  /**
   * Abre o Formulário de Meta preenchido para Edição.
   */
  openGoalFormToEdit() {
    if (!this.currentParsedGoal) return;

    LinsoraUI.closeModal('modalGoalVoiceConfirmation');

    const idInput = document.getElementById('goalIdInput');
    if (idInput) idInput.value = this.currentParsedGoal.isExistingGoal ? (this.currentParsedGoal.goalId || '') : '';

    document.getElementById('goalTitleInput').value = this.currentParsedGoal.title;
    
    const targetCents = Math.round(this.currentParsedGoal.target * 100).toString();
    document.getElementById('goalTargetInput').value = LinsoraUtils.formatCurrencyInput(targetCents);

    const currentVal = this.currentParsedGoal.isExistingGoal ? (this.currentParsedGoal.newCurrent || 0) : 0;
    const currentCents = Math.round(currentVal * 100).toString();
    document.getElementById('goalCurrentInput').value = LinsoraUtils.formatCurrencyInput(currentCents);
    
    if (this.currentParsedGoal.deadline) {
      document.getElementById('goalDeadlineInput').value = this.currentParsedGoal.deadline;
    }

    if (this.currentParsedGoal.icon && document.getElementById('goalIconInput')) {
      document.getElementById('goalIconInput').value = this.currentParsedGoal.icon;
    }

    LinsoraUI.openModal('modalGoalForm');
    LinsoraUI.showToast('Formulário de meta preenchido com a voz. Ajuste como preferir e salve!', 'info');
  }

  /**
   * Cancela a escuta/confirmação do assistente de voz.
   */
  cancelVoice() {
    // ETAPA 6C: cancela processamento pendente, limpa flags/indicador e impede
    // qualquer processamento posterior desta captura.
    this._clearPendingProcess();
    this.currentParsedTx = null;
    this.currentParsedGoal = null;
    this.lastTranscript = '';
    window.VoiceRecognitionEngine.stopListening();
    const statusEl = document.getElementById('voiceStatusSubtitle');
    const waveEl = document.getElementById('voiceWaveAnimation');
    if (statusEl) statusEl.innerText = 'Ouvindo áudio em tempo real...';
    if (waveEl) waveEl.classList.remove('active');
    if (window.LinsoraCardPicker?.close) window.LinsoraCardPicker.close();
    LinsoraUI.closeModal('modalCardPicker');
    LinsoraUI.closeModal('modalVoiceConfirmation');
    LinsoraUI.closeModal('modalGoalVoiceConfirmation');
    LinsoraUI.closeModal('modalVoiceListening');
  }
}

window.VoiceAssistantUI = new VoiceAssistantUIController();

