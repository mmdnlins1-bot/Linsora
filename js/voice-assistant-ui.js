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
  }

  /**
   * Abre o modal de escuta para Transações.
   */
  async startVoiceCapture() {
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
          setTimeout(() => {
            this.processCapturedVoice(transcriptText);
          }, 600);
        }
      },
      onError: (errorMsg) => {
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
    window.VoiceRecognitionEngine.stopListening();
    LinsoraUI.closeModal('modalVoiceListening');

    const lowerText = (rawText || '').toLowerCase();
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
      badgeEl.innerHTML = isIncome ? '💰 Receita' : '💸 Despesa';
    }

    if (amountEl) {
      amountEl.className = `voice-conf-amount-val ${isIncome ? 'income' : 'expense'}`;
      amountEl.innerText = (isIncome ? '+ ' : '- ') + LinsoraUtils.formatBRL(parsed.amount);
    }

    if (categoryEl) {
      const icon = LinsoraUtils.getCategoryIcon(parsed.category);
      categoryEl.innerHTML = `<span class="cat-chip-icon">${icon}</span> ${parsed.category}`;
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
        badgeEl.innerHTML = `➕ APORTE EM META EXISTENTE`;
        badgeEl.style.background = 'rgba(16, 185, 129, 0.2)';
        badgeEl.style.color = 'var(--accent-green-neon)';
      } else {
        badgeEl.innerHTML = `${parsed.icon} ${parsed.type}`;
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

    const accounts = (window.linsoraStore && window.linsoraStore.state && window.linsoraStore.state.accounts) || [];
    const defaultAccount = accounts.length > 0 ? accounts[0].name : 'Carteira Principal';

    const txPayload = {
      type: this.currentParsedTx.type,
      amount: this.currentParsedTx.amount,
      description: this.currentParsedTx.description,
      category: this.currentParsedTx.category,
      date: this.currentParsedTx.date,
      account: defaultAccount,
      repetition: 'SINGLE',
      notes: `Voz: "${this.currentParsedTx.rawText}"`
    };

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
    this.currentParsedTx = null;
    this.currentParsedGoal = null;
    window.VoiceRecognitionEngine.stopListening();
    LinsoraUI.closeModal('modalVoiceConfirmation');
    LinsoraUI.closeModal('modalGoalVoiceConfirmation');
    LinsoraUI.closeModal('modalVoiceListening');
  }
}

window.VoiceAssistantUI = new VoiceAssistantUIController();

