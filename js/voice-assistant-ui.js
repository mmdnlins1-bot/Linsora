/**
 * ============================================================================
 * LINSORA — CONTROLADOR DE INTERFACE DO ASSISTENTE DE VOZ (voice-assistant-ui.js)
 * Modais de escuta, card de confirmação, edição e salvamento no Supabase
 * ============================================================================
 */

class VoiceAssistantUIController {
  constructor() {
    this.currentParsedTx = null;
    this.lastTranscript = '';
  }

  /**
   * Abre o modal de escuta e inicia o reconhecimento de voz.
   */
  async startVoiceCapture() {
    this.lastTranscript = '';
    this.currentParsedTx = null;

    // Reset UI do Modal de Escuta
    const transcriptEl = document.getElementById('voiceTranscriptText');
    const statusEl = document.getElementById('voiceStatusSubtitle');
    const waveEl = document.getElementById('voiceWaveAnimation');

    if (transcriptEl) transcriptEl.innerText = 'Fale agora, ex: "Gastei 45 reais no mercado hoje"...';
    if (statusEl) statusEl.innerText = 'Ouvindo áudio em tempo real...';
    if (waveEl) waveEl.classList.add('active');

    LinsoraUI.openModal('modalVoiceListening');

    const started = await window.VoiceRecognitionEngine.startListening({
      onStart: () => {
        if (statusEl) statusEl.innerText = 'Microfone ativado. Fale o lançamento...';
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
      // Se não for suportado, permite entrada via campo de texto alternativo no modal
      if (statusEl) statusEl.innerText = 'Voz não suportada neste navegador. Digite abaixo:';
    }
  }

  /**
   * Para a escuta manualmente e processa o texto capturado até o momento.
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
   * Envia o texto para a IA Parser e exibe o Card de Confirmação.
   * @param {string} rawText 
   */
  processCapturedVoice(rawText) {
    window.VoiceRecognitionEngine.stopListening();
    LinsoraUI.closeModal('modalVoiceListening');

    const categories = (window.linsoraStore && window.linsoraStore.state && window.linsoraStore.state.categories) || [];
    const parsed = window.TransactionAIParser.parseText(rawText, categories);

    this.currentParsedTx = parsed;
    this.openConfirmationCard(parsed);
  }

  /**
   * Exibe o Card de Confirmação com as informações interpretadas.
   * @param {Object} parsed 
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

    if (descEl) {
      descEl.innerText = parsed.description;
    }

    if (dateEl) {
      dateEl.innerText = LinsoraUtils.formatDateBR(parsed.date);
    }

    if (rawEl) {
      rawEl.innerText = `"${parsed.rawText}"`;
    }

    LinsoraUI.openModal('modalVoiceConfirmation');
  }

  /**
   * Confirma e Salva a Transação diretamente no Supabase / Store.
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

    await window.linsoraStore.saveTransaction(txPayload);

    LinsoraUI.closeModal('modalVoiceConfirmation');
    LinsoraUI.showToast(`Lançamento (${txPayload.type === 'RECEITA' ? 'Receita' : 'Despesa'}) salvo com sucesso via Voz! 🎙️`);
    this.currentParsedTx = null;
  }

  /**
   * Abre o Formulário de Transação preenchido para Edição.
   */
  openFormToEdit() {
    if (!this.currentParsedTx) return;

    LinsoraUI.closeModal('modalVoiceConfirmation');

    // Preenche o formulário tradicional txForm
    document.getElementById('txId').value = '';
    
    // Converte valor float em string formatada do input de moeda (ex: 50.00 -> "5000")
    const centsStr = Math.round(this.currentParsedTx.amount * 100).toString();
    const formattedAmount = LinsoraUtils.formatCurrencyInput(centsStr);
    document.getElementById('txAmount').value = formattedAmount;

    document.getElementById('txDescription').value = this.currentParsedTx.description;
    document.getElementById('txDate').value = this.currentParsedTx.date;
    
    // Selecionar categoria
    const catSelect = document.getElementById('txCategory');
    if (catSelect) {
      LinsoraUI.updateCategoryDropdown(this.currentParsedTx.type);
      catSelect.value = this.currentParsedTx.category;
    }

    // Define o tipo
    if (window.setTxFormType) {
      window.setTxFormType(this.currentParsedTx.type);
    }

    LinsoraUI.openModal('modalTransactionForm');
    LinsoraUI.showToast('Formulário preenchido com a voz. Ajuste como preferir e salve!', 'info');
  }

  /**
   * Cancela a confirmação do assistente de voz.
   */
  cancelVoice() {
    this.currentParsedTx = null;
    window.VoiceRecognitionEngine.stopListening();
    LinsoraUI.closeModal('modalVoiceConfirmation');
    LinsoraUI.closeModal('modalVoiceListening');
  }
}

window.VoiceAssistantUI = new VoiceAssistantUIController();
