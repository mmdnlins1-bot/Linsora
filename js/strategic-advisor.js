/**
 * ============================================================================
 * LINSORA — MÓDULO DE IA E CONSELHEIRO ESTRATÉGICO (strategic-advisor.js)
 * Motor inteligente com contexto total de dados financeiros
 * ============================================================================
 */

class StrategicAdvisorEngine {
  constructor() {
    this.name = 'Conselheiro Linsora';
    // Contexto da conversa de conferência de compromissos ("posso gastar X?"
    // -> "já pagou alguma?" -> confirmação -> recálculo). Mantém a pergunta
    // original até o fluxo terminar; null fora do fluxo.
    this.commitmentFlow = null;
  }

  /**
   * Ponto de entrada principal do Assistente
   */
  processQuery(rawText) {
    if (!rawText || typeof rawText !== 'string') return this.fallbackResponse();
    
    const lowerText = rawText.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const state = window.linsoraStore?.state;
    
    if (!state || !state.user) {
      return {
        severity: 'warning',
        title: '⚠️ Contexto Indisponível',
        diagnosis: 'Não consegui acessar seus dados financeiros.',
        impact: '-',
        recommendation: 'Faça login para utilizar o assistente.'
      };
    }

    // 0. Continuidade de conversa: se há uma conferência de compromissos
    // em andamento, a mensagem pode ser a resposta (número, "nenhuma",
    // "sim"/"não") ou uma pergunta nova (nesse caso o fluxo é encerrado
    // e a mensagem é processada normalmente abaixo).
    if (this.commitmentFlow) {
      const followUp = this.handleCommitmentFollowUp(rawText, lowerText, state);
      if (followUp) return followUp;
      this.commitmentFlow = null;
    }

    // 1. Detectar Intenção (Pergunta/Simulação vs Comando Explícito)
    const intent = this.detectIntent(lowerText);
    
    // 2. Extrair Entidades (via TransactionAIParser)
    // Precisamos ajustar o parseText para que não falhe se a intenção for Pix ou Meta
    let parsedData;
    if (window.TransactionAIParser?.hasGoalIntent(lowerText) || lowerText.includes('reserva')) {
       parsedData = window.TransactionAIParser.parseGoalText(rawText);
    } else {
       parsedData = window.TransactionAIParser?.parseText(rawText);
    }
    
    if (intent === 'QUESTION') {
       parsedData.matchedCategory = false;
       parsedData.category = '';
    }
    
    const amount = parsedData.amount || parsedData.target || 0;
    
    // 3. Cruzar com Dados Reais
    if (window.linsoraStore?.ensureCurrentWindowOccurrences) {
      window.linsoraStore.ensureCurrentWindowOccurrences({ silent: true });
    }
    // Ciclo do Conselheiro: gerar ocorrências até o próximo recebimento
    // ANTES do cálculo (ponto de entrada do fluxo; nunca dentro do cálculo).
    if (window.linsoraStore?.ensureCycleOccurrences) {
      window.linsoraStore.ensureCycleOccurrences();
    }
    const metrics = this.calculateRealMetrics(state);

    if (intent === 'EXPLICIT_COMMAND' && amount > 0) {
      return this.handleExplicitCommand(parsedData, metrics);
    } else if (intent === 'QUESTION' || (intent === 'AMBIGUOUS' && amount > 0)) {
      return this.handleViabilityQuestion(parsedData, metrics, lowerText, intent);
    } else {
      return this.handleGeneralDiagnosis(metrics);
    }
  }

  detectIntent(lowerText) {
    const questionKeywords = ['posso', 'devo', 'vale a pena', 'é viável', 'consigo', 'da pra', 'dá pra', 'o que acha', 'simule', 'simulacao', 'qual', 'quanto', 'sera que'];
    const commandKeywords = ['registre', 'adicione', 'comprei', 'gastei', 'paguei', 'lance', 'anote', 'debite', 'recebi', 'ganhei', 'pix de', 'pix para', 'transferi'];

    const isQuestion = questionKeywords.some(kw => lowerText.includes(kw));
    const isCommand = commandKeywords.some(kw => lowerText.includes(kw));

    if (isQuestion && !isCommand) return 'QUESTION';
    if (isCommand && !isQuestion) return 'EXPLICIT_COMMAND';
    if (isCommand && isQuestion) return 'QUESTION'; // Em caso de dúvida, trate como simulação
    
    return 'AMBIGUOUS';
  }

  calculateRealMetrics(state) {
    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    const currentKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const daysRemaining = Math.max(1, daysInMonth - today.getDate() + 1);

    const txs = state.transactions || [];
    let monthIncome = 0;
    let monthExpense = 0;
    let monthFixedExpense = 0; // Aproximação de fixas

    txs.forEach(t => {
      const tMonthKey = t.date ? String(t.date).slice(0, 7) : '';
      if (tMonthKey === currentKey) {
        if (t.type === 'RECEITA') monthIncome += parseFloat(t.amount);
        if (t.type === 'DESPESA') {
          const amt = parseFloat(t.amount);
          monthExpense += amt;
          if (['Moradia', 'Educação', 'Saúde', 'Transporte'].includes(t.category)) {
            monthFixedExpense += amt;
          }
        }
      }
    });

    // Subtrair metas programadas (se houver lógica para isso)
    const goals = state.goals || [];
    let goalCommitments = 0;
    goals.forEach(g => {
       if (g.type !== 'Reserva de Emergência') {
         goalCommitments += parseFloat(g.suggestedMonthly || 0);
       }
    });

    const totalBalance = state.accounts.reduce((acc, a) => acc + parseFloat(a.balance), 0);
    const baseFunds = monthIncome > 0 ? monthIncome : totalBalance;
    const freeIncome = Math.max(0, baseFunds - monthFixedExpense - goalCommitments);
    const availableBalanceForMonth = Math.max(0, freeIncome - (monthExpense - monthFixedExpense));
    
    const totalLiquidity = Math.max(totalBalance, availableBalanceForMonth);
    
    const currentDailyLimit = daysRemaining > 0 ? (availableBalanceForMonth / daysRemaining) : availableBalanceForMonth;

    // Compromissos futuros (Etapa 1): recorrências PENDING + faturas elegíveis
    // até o fim do mês corrente. Aditivo: não altera nenhuma métrica existente.
    let committedAmount = 0;
    let committedItems = [];
    try {
      const monthEndKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${daysInMonth}`;
      const committed = window.linsoraStore?.getCommittedAmountUntil
        ? window.linsoraStore.getCommittedAmountUntil(monthEndKey)
        : { total: 0, items: [] };
      committedAmount = Number(committed.total) || 0;
      committedItems = Array.isArray(committed.items) ? committed.items : [];
    } catch (e) { /* motor indisponível: segue com zero */ }
    const availableAfterCommitments = Math.max(0, availableBalanceForMonth - committedAmount);

    // Ciclo financeiro do Conselheiro (V1): hoje até o próximo recebimento
    // (ou fim do mês quando não houver recebimento futuro). As métricas
    // mensais acima permanecem intactas para a Visão Consolidada.
    let cycleStartDate = LinsoraUtils.toLocalDateKey(today);
    let cycleEndDate = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${daysInMonth}`;
    let cycleNextReceiptDate = null;
    let cycleUsedFallback = true;
    let cycleCommittedAmount = committedAmount;
    let cycleCommittedItems = committedItems;
    try {
      const c = window.linsoraStore?.getCommitmentsUntilNextReceipt
        ? window.linsoraStore.getCommitmentsUntilNextReceipt()
        : null;
      if (c && c.endDate) {
        cycleStartDate = c.startDate || cycleStartDate;
        cycleEndDate = c.endDate;
        cycleNextReceiptDate = c.nextReceiptDate || null;
        cycleUsedFallback = c.usedFallback !== false;
        cycleCommittedAmount = Number(c.total) || 0;
        cycleCommittedItems = Array.isArray(c.items) ? c.items : [];
      }
    } catch (e) { /* motor indisponível: ciclo espelha o mês */ }
    const cycleDays = Math.max(1, StrategicAdvisorEngine.inclusiveDaysBetween(cycleStartDate, cycleEndDate));
    const cycleAvailableAfterCommitments = Math.max(0, availableBalanceForMonth - cycleCommittedAmount);
    const cycleDailyLimit = cycleAvailableAfterCommitments / cycleDays;

    return {
      monthIncome,
      monthExpense,
      monthFixedExpense,
      freeIncome,
      availableBalanceForMonth,
      currentDailyLimit,
      daysRemaining,
      totalBalance,
      totalLiquidity,
      committedAmount,
      committedItems,
      availableAfterCommitments,
      cycleStartDate,
      cycleEndDate,
      cycleNextReceiptDate,
      cycleUsedFallback,
      cycleDays,
      cycleCommittedAmount,
      cycleCommittedItems,
      cycleAvailableAfterCommitments,
      cycleDailyLimit
    };
  }

  /**
   * Dias inclusivos entre duas chaves YYYY-MM-DD (somente apresentação do
   * ciclo; ex.: 25/09→05/10 = 11 dias). Puro, sem depender do relógio.
   */
  static inclusiveDaysBetween(startKey, endKey) {
    const pa = String(startKey || '').split('-').map(Number);
    const pb = String(endKey || '').split('-').map(Number);
    if (pa.length < 3 || pb.length < 3 || pa.some(isNaN) || pb.some(isNaN)) return 1;
    const diff = Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
    return Math.max(1, diff + 1);
  }

  handleExplicitCommand(parsedData, metrics) {
    const isGoal = parsedData.action === 'APORTE' || parsedData.type?.includes('Meta') || parsedData.type?.includes('Reserva');
    const amt = parsedData.amount || parsedData.target;
    const catOrType = isGoal ? parsedData.title : parsedData.category;
    
    return {
      severity: 'info',
      title: '📋 Resumo do Comando',
      diagnosis: `Entendi que você deseja registrar ${isGoal ? 'um Aporte' : parsedData.type} de ${LinsoraUtils.formatBRL(amt)}.`,
      impact: `Destino/Categoria: ${catOrType}. ${!isGoal && parsedData.type === 'DESPESA' ? 'O saldo será reduzido após a confirmação.' : 'O saldo será movimentado após a confirmação.'}`,
      recommendation: 'Por favor, confirme a operação abaixo para gravar no banco de dados.',
      technicalIndicators: this.buildTechnicalIndicators(metrics),
      action: {
        type: isGoal ? 'EXECUTE_GOAL' : 'EXECUTE_TRANSACTION',
        payload: parsedData,
        buttonText: 'Confirmar Gravação'
      }
    };
  }

  formatCommitmentsSummary(items, totalAmount) {
    if (!Array.isArray(items) || items.length === 0 || !totalAmount) return '';
    const formattedTotal = LinsoraUtils.formatBRL(totalAmount);
    if (items.length === 1) {
      const it = items[0];
      const dueStr = it.dueDate ? `, com vencimento em ${LinsoraUtils.formatDateBR(it.dueDate)}` : '';
      return `um compromisso de ${LinsoraUtils.formatBRL(it.amount)} com ${it.title}${dueStr}`;
    }
    const details = items.slice(0, 2).map(it => {
      const dueStr = it.dueDate ? ` (vence ${LinsoraUtils.formatDateBR(it.dueDate)})` : '';
      return `${it.title} (${LinsoraUtils.formatBRL(it.amount)}${dueStr})`;
    }).join(' e ');
    const remainingCount = items.length - 2;
    const moreText = remainingCount > 0 ? ` e mais ${remainingCount} outro(s)` : '';
    return `${formattedTotal} em compromissos próximos (${details}${moreText})`;
  }

  /**
   * Monta a lista vertical de indicadores da "Visão Consolidada" a partir
   * das métricas já calculadas (sem alterar valores nem lógica financeira).
   * Reutilizada por todas as respostas que possuem métricas, para que cada
   * indicador tenha sua própria estrutura visual em vez de texto corrido.
   */
  buildTechnicalIndicators(metrics) {
    const m = metrics || {};
    return [
      { label: 'Caixa Livre do Mês', value: LinsoraUtils.formatBRL(m.availableBalanceForMonth) },
      { label: 'Saldo em Contas', value: LinsoraUtils.formatBRL(m.totalBalance) },
      { label: 'Receitas do Mês', value: LinsoraUtils.formatBRL(m.monthIncome) },
      { label: 'Despesas do Mês', value: LinsoraUtils.formatBRL(m.monthExpense) },
      { label: 'Compromissos do mês', value: LinsoraUtils.formatBRL(m.committedAmount) },
      { label: 'Limite Diário', value: LinsoraUtils.formatBRL(m.currentDailyLimit) }
    ];
  }

  handleViabilityQuestion(parsedData, metrics, rawText, intent) {
    const advice = this.answerViability(parsedData, metrics, rawText, intent);
    return this.maybeAttachCommitmentCheck(advice, parsedData, metrics, rawText, intent);
  }

  /**
   * Anexa a conferência de compromissos à resposta normal de viabilidade de
   * GASTO (perguntas "posso gastar X?"): mantém a conclusão calculada pela
   * lógica existente e acrescenta a lista numerada + pergunta contextual,
   * abrindo o fluxo de confirmação. Não altera valores nem decisões.
   * Relevância (não perguntar quando desnecessário):
   * - gasto inviável (amount > margem efetiva do ciclo): sem conferência;
   * - gasto distante dos compromissos (margem restante após o gasto maior
   *   que 2x os compromissos PENDING do ciclo): sem conferência.
   */
  maybeAttachCommitmentCheck(advice, parsedData, metrics, rawText, intent) {
    if (!advice || intent !== 'QUESTION' || this.commitmentFlow) return advice;
    const amount = (parsedData && (parsedData.amount || parsedData.target)) || 0;
    if (!amount || amount <= 0) return advice;
    const isGoal = parsedData.action === 'APORTE' || parsedData.type?.includes('Meta') || parsedData.type?.includes('Reserva');
    if (isGoal) return advice;
    const options = this.getPendingRecurringOptions(metrics);
    if (options.length === 0) return advice;
    // Mesma margem efetiva usada por answerViability (ciclo financeiro).
    const effectiveMargin = Number(metrics.cycleAvailableAfterCommitments ?? metrics.availableAfterCommitments ?? metrics.availableBalanceForMonth) || 0;
    // Gasto inviável: responde a inviabilidade, sem perguntar por pagos.
    if (amount > effectiveMargin) return advice;
    // Proximidade: só pergunta quando o restante após o gasto fica próximo
    // dos compromissos PENDING do ciclo (soma das opções apresentadas).
    const pendingTotal = options.reduce((acc, o) => acc + (Number(o.amount) || 0), 0);
    const remainingAfterSpend = effectiveMargin - amount;
    if (remainingAfterSpend > pendingTotal * 2) return advice;
    this.commitmentFlow = {
      stage: 'awaiting_selection',
      originalQuery: typeof rawText === 'string' ? rawText : '',
      originalParsed: { ...(parsedData || {}) },
      amount,
      options,
      selected: []
    };
    return {
      ...advice,
      commitmentOptionsTitle: metrics.cycleUsedFallback !== false
        ? 'Compromissos até o fim do mês'
        : 'Compromissos até o próximo recebimento',
      commitmentOptions: options.map(o => ({
        n: o.n,
        title: o.title,
        amount: LinsoraUtils.formatBRL(o.amount),
        dueDate: o.dueDate ? LinsoraUtils.formatDateBR(o.dueDate) : ''
      })),
      recommendation: `${advice.recommendation} Antes de concluir, me diga: você já pagou alguma dessas contas? Responda com o número (ex.: 1), "1 e 2" ou "nenhuma".`
    };
  }

  /**
   * Opções numeráveis de conferência: somente compromissos do tipo conta
   * recorrente (possuem ocorrência e podem ser marcados como pagos pelo
   * fluxo existente). Faturas de cartão seguem só no cálculo da margem.
   */
  getPendingRecurringOptions(metrics) {
    // Conferência do Conselheiro usa o ciclo (hoje → próximo recebimento);
    // fora do ciclo, espelha o mês (fallback já aplicado nas métricas).
    const items = (metrics && Array.isArray(metrics.cycleCommittedItems))
      ? metrics.cycleCommittedItems
      : ((metrics && Array.isArray(metrics.committedItems)) ? metrics.committedItems : []);
    return items
      .filter(it => it && it.type === 'RECURRING_BILL' && it.originId)
      .map((it, idx) => ({
        n: idx + 1,
        occurrenceId: it.originId,
        title: it.title || 'Conta recorrente',
        amount: Number(it.amount) || 0,
        dueDate: it.dueDate || ''
      }));
  }

  /**
   * Trata mensagens enviadas durante a conferência de compromissos.
   * Retorna a resposta (advice) ou null quando a mensagem é uma pergunta
   * nova — nesse caso o fluxo é encerrado e o processamento normal segue.
   * Nunca altera dados financeiros; só a confirmação explícita o faz.
   */
  handleCommitmentFollowUp(rawText, lowerText, state) {
    const flow = this.commitmentFlow;
    if (!flow) return null;
    const norm = this.normCommitText(rawText);
    if (this.isNewViabilityQuery(lowerText || norm)) return null;

    if (flow.stage === 'awaiting_confirmation') {
      if (this.isAffirmative(norm)) return this.applyCommitmentConfirmation();
      if (this.isNegative(norm)) return this.cancelCommitmentConfirmation();
      return this.repeatConfirmationPrompt();
    }

    const parsed = this.parseCommitmentSelection(norm, flow.options);
    if (parsed.kind === 'none') {
      const core = this.answerOriginalViability(flow);
      this.commitmentFlow = null;
      return {
        ...core,
        recommendation: `Entendido, mantive todos os compromissos como pendentes. ${core.recommendation}`
      };
    }
    if (parsed.kind === 'ambiguous') {
      return this.buildClarificationAdvice(parsed.candidates);
    }
    flow.stage = 'awaiting_confirmation';
    flow.selected = parsed.ids;
    return this.buildSelectionConfirmation();
  }

  normCommitText(text) {
    return String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  /**
   * Detecta pergunta nova de viabilidade (ex.: "posso gastar 200 hoje?"):
   * palavra de pergunta + número. Nesse caso o fluxo anterior é encerrado.
   */
  isNewViabilityQuery(lowerText) {
    if (!lowerText) return false;
    const hasQ = ['posso', 'devo', 'vale a pena', 'consigo', 'da pra', 'simule', 'simulacao', 'qual o limite', 'quanto posso', 'sera que', 'e viavel'].some(k => lowerText.includes(k));
    return hasQ && /\d/.test(lowerText);
  }

  isAffirmative(norm) {
    const t = String(norm || '').trim();
    if (/^(sim|confirmo|confirmar|pode|ok|isso|fechado|bora|vai|confirmado)$/.test(t)) return true;
    return t.includes('pode confirmar') || t.includes('pode marcar') || t.includes('marca como paga') || t.includes('marcar como paga');
  }

  isNegative(norm) {
    const t = String(norm || '').trim();
    if (/^(nao|n|cancelar|cancela|desiste|deixa|melhor nao)$/.test(t)) return true;
    return t.includes('cancela') || t.includes('nao quero') || t.includes('deixa como esta') || t.includes('melhor nao');
  }

  titleMatches(normText, title) {
    const nt = this.normCommitText(title);
    if (!nt) return false;
    if (normText.includes(nt)) return true;
    return nt.split(/\s+/).filter(w => w.length >= 4).some(w => normText.includes(w));
  }

  /**
   * Interpreta a resposta sobre contas pagas. Retorna:
   * {kind:'none'} | {kind:'selected', ids:[occurrenceIds]} |
   * {kind:'ambiguous', candidates:[options]}. Nunca inventa correspondências:
   * sem número válido e sem título inequívoco, pede esclarecimento.
   */
  parseCommitmentSelection(norm, options) {
    const t = String(norm || '').trim();
    const allWords = /\btodas\b|\bas duas\b|\bos dois\b|\bambas\b|\bambos\b|tudo pago|todas pagas/.test(t);
    const digits = [...t.matchAll(/(\d+)/g)].map(m => parseInt(m[1], 10));
    const fromNumbers = digits.filter(n => n >= 1 && n <= options.length);
    const outOfRange = digits.some(n => n < 1 || n > options.length);
    const fromTitles = options.filter(o => this.titleMatches(t, o.title)).map(o => o.n);
    if (allWords) return { kind: 'selected', ids: options.map(o => o.occurrenceId) };
    if (fromNumbers.length > 0) {
      const ids = new Set();
      fromNumbers.forEach(n => ids.add(options[n - 1].occurrenceId));
      fromTitles.forEach(n => ids.add(options[n - 1].occurrenceId));
      return { kind: 'selected', ids: [...ids] };
    }
    if (fromTitles.length === 1) {
      return { kind: 'selected', ids: [options[fromTitles[0] - 1].occurrenceId] };
    }
    if (fromTitles.length > 1) {
      return { kind: 'ambiguous', candidates: options.filter(o => fromTitles.includes(o.n)) };
    }
    if (/nenhuma|nao paguei|ainda nao|todas pendentes|todas em aberto|^nao$|^0$/.test(t)) {
      return { kind: 'none' };
    }
    if (outOfRange) return { kind: 'ambiguous', candidates: options };
    return { kind: 'ambiguous', candidates: options };
  }

  fmtCommitOption(o) {
    return {
      n: o.n,
      title: o.title,
      amount: LinsoraUtils.formatBRL(o.amount),
      dueDate: o.dueDate ? LinsoraUtils.formatDateBR(o.dueDate) : ''
    };
  }

  freshMetrics() {
    if (window.linsoraStore?.ensureCurrentWindowOccurrences) {
      window.linsoraStore.ensureCurrentWindowOccurrences({ silent: true });
    }
    if (window.linsoraStore?.ensureCycleOccurrences) {
      window.linsoraStore.ensureCycleOccurrences();
    }
    return this.calculateRealMetrics(window.linsoraStore.state);
  }

  /**
   * Responde a pergunta original com dados recalculados, sem reanexar
   * a conferência (usa a lógica direta de viabilidade).
   */
  answerOriginalViability(flow) {
    const metrics = this.freshMetrics();
    return this.answerViability(flow.originalParsed, metrics, flow.originalQuery, 'QUESTION');
  }

  buildClarificationAdvice(candidates) {
    const list = (Array.isArray(candidates) && candidates.length > 0 ? candidates : this.commitmentFlow.options);
    return {
      severity: 'info',
      title: '❓ Qual conta você quis dizer?',
      diagnosis: 'Não consegui identificar exatamente qual compromisso já foi pago.',
      commitmentOptions: list.map(o => this.fmtCommitOption(o)),
      technicalIndicators: this.buildTechnicalIndicators(this.freshMetrics()),
      recommendation: 'Me diga o número (ex.: 1), os números (ex.: 1 e 2) ou "nenhuma" se todas continuam pendentes.',
      action: null
    };
  }

  /**
   * Pede confirmação explícita das contas identificadas. Somente leitura:
   * nenhum dado financeiro é alterado aqui (requisito obrigatório).
   */
  buildSelectionConfirmation() {
    const flow = this.commitmentFlow;
    const sel = flow.options.filter(o => (flow.selected || []).includes(o.occurrenceId));
    const fmt = (o) => `${o.title} de ${LinsoraUtils.formatBRL(o.amount)}`;
    let diagnosis;
    if (sel.length === 1) {
      diagnosis = `Você informou que ${fmt(sel[0])} já foi pago.`;
    } else {
      diagnosis = `Você informou que estas contas já foram pagas: ${sel.map(o => `${o.n}. ${fmt(o)}`).join('; ')}.`;
    }
    return {
      severity: 'warning',
      title: '✋ Confirmar pagamento',
      diagnosis,
      commitmentOptions: sel.map(o => this.fmtCommitOption(o)),
      recommendation: sel.length === 1
        ? `Deseja marcar essa conta como paga?`
        : `Deseja marcar as ${sel.length} contas como pagas?`,
      actions: [
        { type: 'CONFIRM_COMMITMENT_PAID', buttonText: 'Confirmar' },
        { type: 'CANCEL_COMMITMENT_PAID', buttonText: 'Cancelar' }
      ],
      action: null
    };
  }

  repeatConfirmationPrompt() {
    if (!this.commitmentFlow || this.commitmentFlow.stage !== 'awaiting_confirmation') {
      return this.expiredConfirmationAdvice();
    }
    return this.buildSelectionConfirmation();
  }

  expiredConfirmationAdvice() {
    return {
      severity: 'info',
      title: 'ℹ️ Confirmação expirada',
      diagnosis: 'Essa confirmação já foi concluída ou expirou.',
      impact: 'Nenhum dado foi alterado.',
      recommendation: 'Se precisar, pergunte novamente (ex.: "Posso gastar 100 hoje?").',
      action: null
    };
  }

  cancelCommitmentConfirmation() {
    const flow = this.commitmentFlow;
    this.commitmentFlow = null;
    if (!flow) return this.expiredConfirmationAdvice();
    const core = this.answerOriginalViability(flow);
    const names = flow.options
      .filter(o => (flow.selected || []).includes(o.occurrenceId))
      .map(o => o.title).join(' e ');
    return {
      ...core,
      recommendation: `Tudo bem, mantive ${names || 'os compromissos'} como pendente(s), sem alterar nada. ${core.recommendation}`
    };
  }

  /**
   * Aplica a confirmação usando o fluxo financeiro existente
   * (setOccurrenceStatus -> PAID), sem criar transações nem duplicar nada:
   * só ocorrências ainda PENDING são marcadas; PAID sai de committedItems
   * pela regra atual do motor. Em seguida recalcula tudo e responde a
   * pergunta original com os dados atualizados.
   */
  applyCommitmentConfirmation() {
    const flow = this.commitmentFlow;
    this.commitmentFlow = null;
    if (!flow || flow.stage !== 'awaiting_confirmation') return this.expiredConfirmationAdvice();
    const store = window.linsoraStore;
    const applied = [];
    (flow.selected || []).forEach(id => {
      const occ = store?.state?.occurrences?.find(o => o.id === id);
      if (!occ || occ.status !== 'PENDING') return;
      const opt = flow.options.find(o => o.occurrenceId === id);
      if (store.setOccurrenceStatus(id, { status: 'PAID' })) {
        applied.push(opt || { title: 'Conta recorrente', amount: 0 });
      }
    });
    const metrics = this.freshMetrics();
    const core = this.answerViability(flow.originalParsed, metrics, flow.originalQuery, 'QUESTION');
    // Apresentação em blocos (somente visual): os mesmos valores já
    // calculados acima, agora na base do ciclo financeiro (hoje → próximo
    // recebimento, ou fim do mês no fallback). Nenhuma fórmula, janela,
    // regra de PAID ou confirmação é alterada aqui.
    const cycleItems = Array.isArray(metrics.cycleCommittedItems) ? metrics.cycleCommittedItems : (metrics.committedItems || []);
    const cycleMargin = Number(metrics.cycleAvailableAfterCommitments ?? metrics.availableAfterCommitments) || 0;
    const cycleDaily = Number(metrics.cycleDailyLimit ?? metrics.currentDailyLimit) || 0;
    const cycleFallback = metrics.cycleUsedFallback !== false;
    const cycleDailyLabel = cycleFallback ? 'Limite diário até o fim do mês' : 'Limite diário até o próximo recebimento';
    const paidEntries = applied.map(a => ({
      title: a.title || 'Conta recorrente',
      amountText: LinsoraUtils.formatBRL(a.amount),
      dueDateText: a.dueDate ? LinsoraUtils.formatDateBR(a.dueDate) : ''
    }));
    const remainingEntries = (cycleItems.filter(i => i.type === 'RECURRING_BILL'))
      .map(i => ({
        title: i.title || 'Conta recorrente',
        amountText: LinsoraUtils.formatBRL(i.amount),
        dueDateText: i.dueDate ? LinsoraUtils.formatDateBR(i.dueDate) : ''
      }));
    const settlementBlocks = [
      { kind: 'spend', label: 'Gasto solicitado', value: LinsoraUtils.formatBRL(flow.amount), valueTone: 'default' },
      ...(applied.length === 0
        ? [{ kind: 'notice', label: 'Pagamento não confirmado', note: 'Não foi possível marcar o pagamento (registro não encontrado ou já pago).', valueTone: 'default' }]
        : [
          ...paidEntries.map(p => ({
            kind: 'paid',
            label: paidEntries.length === 1 ? 'Compromisso pago' : 'Compromissos pagos',
            title: p.title,
            value: `- ${p.amountText}`,
            valueTone: 'expense',
            ...(paidEntries.length === 1
              ? { note: `${p.title} de ${p.amountText} foi marcado como pago.` }
              : {})
          })),
          ...(paidEntries.length === 1
            ? []
            : [{
              kind: 'paid',
              label: 'Confirmação',
              note: `${paidEntries.map(p => `${p.title} de ${p.amountText}`).join('; ')} foram marcados como pagos.`,
              valueTone: 'default'
            }])
        ]),
      { kind: 'balance', label: 'Saldo em contas', value: LinsoraUtils.formatBRL(metrics.totalBalance), valueTone: 'default' },
      {
        kind: 'remaining',
        label: 'Compromissos restantes',
        items: remainingEntries,
        emptyNote: 'nenhum compromisso pendente',
        valueTone: 'pending'
      },
      { kind: 'margin', label: 'Margem após compromissos', value: LinsoraUtils.formatBRL(cycleMargin), valueTone: 'positive' },
      { kind: 'afterSpend', label: 'Margem após o gasto', value: LinsoraUtils.formatBRL(cycleMargin - flow.amount), valueTone: 'positive' },
      { kind: 'daily', label: cycleDailyLabel, value: LinsoraUtils.formatBRL(cycleDaily), valueTone: 'default' }
    ];
    // Conclusão curta (sem repetir os valores dos blocos): o diagnóstico
    // e os detalhes técnicos do core são preservados; só a recomendação
    // legada — que duplicava os números — é substituída.
    let conclusion;
    if (flow.amount > cycleMargin) {
      conclusion = 'Esse gasto comprometeria sua margem do ciclo financeiro atual.';
    } else if (flow.amount > cycleDaily) {
      conclusion = 'É viável no ciclo, mas o gasto fica acima do limite diário planejado.';
    } else {
      conclusion = 'É viável dentro do ciclo financeiro atual.';
    }
    return {
      ...core,
      settlementBlocks,
      recommendation: conclusion
    };
  }

  answerViability(parsedData, metrics, rawText, intent) {
    const isGoal = parsedData.action === 'APORTE' || parsedData.type?.includes('Meta') || parsedData.type?.includes('Reserva');
    const amount = parsedData.amount || parsedData.target;

    // Decisão do Conselheiro usa o ciclo financeiro (hoje → próximo
    // recebimento, ou fim do mês no fallback). As métricas mensais seguem
    // apenas na Visão Consolidada.
    const cycleItems = Array.isArray(metrics.cycleCommittedItems) ? metrics.cycleCommittedItems : (metrics.committedItems || []);
    const cycleAmount = Number(metrics.cycleCommittedAmount ?? metrics.committedAmount) || 0;
    const hasCommitments = cycleAmount > 0 && cycleItems.length > 0;
    const commitSummary = hasCommitments ? this.formatCommitmentsSummary(cycleItems, cycleAmount) : '';
    const effectiveMargin = Number(metrics.cycleAvailableAfterCommitments ?? metrics.availableAfterCommitments ?? metrics.availableBalanceForMonth) || 0;
    const dailyLimit = Number(metrics.cycleDailyLimit ?? metrics.currentDailyLimit) || 0;
    const usedFallback = metrics.cycleUsedFallback !== false;
    const scopeText = usedFallback ? 'até o fim do mês' : 'até o próximo recebimento';
    const dailyLabel = `Limite diário ${scopeText}`;

    if (isGoal) {
        let rec = amount <= effectiveMargin ? 'Aporte viável.' : 'Aporte compromete suas despesas livres mensais.';
        if (hasCommitments && amount > effectiveMargin) {
          rec += ` Há ${commitSummary} já previsto, deixando sua margem em ${LinsoraUtils.formatBRL(effectiveMargin)}.`;
        }
        if (intent === 'AMBIGUOUS') {
          rec = 'Não ficou claro se é um registro ou simulação. ' + rec + ' Por favor, diga "Registre..." ou "Simule...".';
        }
        const goalImpact = hasCommitments
          ? `Livre no mês: ${LinsoraUtils.formatBRL(metrics.availableBalanceForMonth)} | Compromissos do mês: ${LinsoraUtils.formatBRL(metrics.committedAmount)}.`
          : `Livre no mês: ${LinsoraUtils.formatBRL(metrics.availableBalanceForMonth)}.`;
        return {
          severity: 'info',
          title: intent === 'AMBIGUOUS' ? '🤔 Simulação ou Registro?' : '🔮 Simulação de Aporte/Meta',
          diagnosis: `Você mencionou destinar ${LinsoraUtils.formatBRL(amount)} para ${parsedData.title}.`,
          impact: goalImpact,
          recommendation: rec,
          technicalIndicators: this.buildTechnicalIndicators(metrics),
          action: null
        };
    }

    const technicalIndicators = this.buildTechnicalIndicators(metrics);

    if (!amount || amount === 0) {
      const commitNote = hasCommitments ? ` (já reservados ${LinsoraUtils.formatBRL(cycleAmount)} em compromissos)` : '';
      return {
        severity: 'info',
        title: '💡 Limite Seguro',
        diagnosis: `Com base nas suas receitas, despesas, reservas e saldo, o seu caixa livre no momento é de ${LinsoraUtils.formatBRL(metrics.availableBalanceForMonth)}${commitNote}.`,
        impact: `Caixa Livre do Mês: ${LinsoraUtils.formatBRL(metrics.availableBalanceForMonth)} | Saldo em Contas: ${LinsoraUtils.formatBRL(metrics.totalBalance)} | Despesas: ${LinsoraUtils.formatBRL(metrics.monthExpense)}`,
        technicalIndicators,
        recommendation: `Para não comprometer suas finanças, recomendo que seus gastos fiquem dentro de **${LinsoraUtils.formatBRL(dailyLimit)}** por dia ${scopeText}.`,
        action: null
      };
    }

    let diagnosis = '';
    let recommendation = '';
    let severity = 'info';

    // Se ele não achou nenhuma keyword de categoria no NLP, omitimos a categoria da frase.
    const catText = (parsedData.matchedCategory !== false) ? ` com ${parsedData.category}` : '';

    if (intent === 'AMBIGUOUS') {
      diagnosis = `Você mencionou ${LinsoraUtils.formatBRL(amount)}${catText}, mas não entendi se quer registrar ou apenas simular.`;
    } else {
      diagnosis = `Análise de viabilidade: Gasto de ${LinsoraUtils.formatBRL(amount)}${catText}.`;
    }

    if (amount > metrics.totalLiquidity) {
      severity = 'danger';
      recommendation = `Faltam fundos! Esse gasto de ${LinsoraUtils.formatBRL(amount)} é maior do que o seu saldo consolidado e renda livre.`;
    } else if (amount > effectiveMargin) {
      severity = 'warning';
      if (amount > metrics.availableBalanceForMonth) {
        if (hasCommitments) {
          recommendation = `Você tem saldo nas contas para cobrir, mas esse gasto de ${LinsoraUtils.formatBRL(amount)} ultrapassa a sua renda livre do mês (${LinsoraUtils.formatBRL(metrics.availableBalanceForMonth)}). Além disso, há ${commitSummary} já previsto, deixando sua margem em ${LinsoraUtils.formatBRL(effectiveMargin)}. Você precisará entrar nas suas reservas acumuladas.`;
        } else {
          recommendation = `Você tem saldo nas contas para cobrir, mas esse gasto de ${LinsoraUtils.formatBRL(amount)} ultrapassa a sua renda livre do mês (${LinsoraUtils.formatBRL(metrics.availableBalanceForMonth)}). Você precisará entrar nas suas reservas acumuladas.`;
        }
      } else {
        recommendation = `Esse gasto de ${LinsoraUtils.formatBRL(amount)} comprometeria sua margem disponível. Você precisa considerar ${commitSummary}, o que deixa aproximadamente ${LinsoraUtils.formatBRL(effectiveMargin)} disponíveis no ciclo.`;
      }
    } else if (amount <= dailyLimit) {
      severity = 'success';
      if (hasCommitments) {
        recommendation = `Perfeito! O valor de ${LinsoraUtils.formatBRL(amount)} cabe no seu ${dailyLabel.toLowerCase()} de ${LinsoraUtils.formatBRL(dailyLimit)}. Lembre-se de que há ${commitSummary}, restando aproximadamente ${LinsoraUtils.formatBRL(effectiveMargin)} de margem disponível no ciclo.`;
      } else {
        recommendation = `Perfeito! O valor cabe perfeitamente no seu ${dailyLabel.toLowerCase()} de ${LinsoraUtils.formatBRL(dailyLimit)}.`;
      }
    } else {
      severity = 'warning';
      if (hasCommitments) {
        recommendation = `É viável no ciclo considerando seus compromissos, mas fica acima do seu ${dailyLabel.toLowerCase()} de ${LinsoraUtils.formatBRL(dailyLimit)}. Você precisa considerar ${commitSummary}. Sua margem livre restante após esse gasto será de ${LinsoraUtils.formatBRL(effectiveMargin - amount)}.`;
      } else {
        recommendation = `É viável no ciclo, mas fica acima do seu ${dailyLabel.toLowerCase()} de ${LinsoraUtils.formatBRL(dailyLimit)}. Se gastar isso hoje, vai precisar segurar a onda nos próximos dias.`;
      }
    }

    const impactMath = `Caixa Livre do Mês: ${LinsoraUtils.formatBRL(metrics.availableBalanceForMonth)} | Saldo em Contas: ${LinsoraUtils.formatBRL(metrics.totalBalance)} | Receitas do Mês: ${LinsoraUtils.formatBRL(metrics.monthIncome)} | Despesas do Mês: ${LinsoraUtils.formatBRL(metrics.monthExpense)} | Compromissos do mês: ${LinsoraUtils.formatBRL(metrics.committedAmount)} | Limite Diário: ${LinsoraUtils.formatBRL(metrics.currentDailyLimit)}`;

    if (intent === 'AMBIGUOUS') {
      recommendation = `Para me ajudar, por favor, seja mais direto: diga "Registre ${LinsoraUtils.formatBRL(amount)}${catText}" ou "Posso gastar ${LinsoraUtils.formatBRL(amount)}${catText}?".`;
    }

    return {
      severity,
      title: intent === 'AMBIGUOUS' ? '🤔 Simulação ou Registro?' : '🔮 Simulação de Gasto',
      diagnosis,
      impact: impactMath,
      technicalIndicators,
      recommendation,
      action: null
    };
  }

  handleGeneralDiagnosis(metrics) {
    let severity = 'success';
    let msg = 'Seu orçamento está saudável.';
    if (metrics.monthExpense > metrics.monthIncome && metrics.monthIncome > 0) {
      severity = 'danger';
      msg = 'Alerta: Você está gastando mais do que ganha este mês.';
    } else if (metrics.availableBalanceForMonth < (metrics.freeIncome * 0.2) && metrics.freeIncome > 0) {
      severity = 'warning';
      msg = 'Atenção: Seu saldo livre para o mês está acabando rápido.';
    }

    return {
      severity,
      title: '📊 Diagnóstico Orçamentário',
      diagnosis: msg,
      impact: `Limite diário disponível para os próximos ${metrics.daysRemaining} dias: ${LinsoraUtils.formatBRL(metrics.currentDailyLimit)}.`,
      technicalIndicators: this.buildTechnicalIndicators(metrics),
      recommendation: 'Use linguagem natural para perguntar: "Posso gastar 50 em pizza hoje?" ou comande "Registre 50 de pizza".'
    };
  }

  fallbackResponse() {
    return {
      severity: 'info',
      title: '🤖 Conselheiro Pronto',
      diagnosis: 'Estou monitorando todas as suas contas, cartões e metas reais.',
      impact: 'Faço cálculos instantâneos de limite diário e mensal.',
      recommendation: 'Pergunte: "É viável comprar um tênis de 300?" ou mande "Pix de 50 para João".'
    };
  }

  // ==============================
  // UI & RENDERIZAÇÃO
  // ==============================

  renderHomeFeed() {
    const feedContainer = document.getElementById('strategicFeedContainer');
    if (!feedContainer) return;

    const state = window.linsoraStore?.state;
    if (!state || !state.user) return;

    const metrics = this.calculateRealMetrics(state);
    const advice = this.handleGeneralDiagnosis(metrics);

    feedContainer.innerHTML = `
      <div class="smart-insights-card actionable-insight-card severity-${advice.severity}">
        <div class="insight-header">
          <div class="insight-badge">🧠 Conselheiro IA</div>
          <button type="button" class="linsora-btn small primary" id="btnOpenAdvisorFromFeed">Consultar</button>
        </div>
        <div class="insight-content">
          <h4>${advice.title}</h4>
          <p>${advice.diagnosis}</p>
          <p><strong>Impacto:</strong> ${advice.impact}</p>
          <p class="rec-text">⚡ ${advice.recommendation}</p>
        </div>
      </div>
    `;

    const btn = document.getElementById('btnOpenAdvisorFromFeed');
    if (btn) {
      btn.addEventListener('click', () => {
        this.openAdvisorModal();
      });
    }
  }

  openAdvisorModal(initialQuery = null) {
    if (window.LinsoraUI) window.LinsoraUI.openModal('modalStrategicAdvisor');

    const chatContainer = document.getElementById('advisorChatHistory');
    const inputEl = document.getElementById('advisorQueryInput');
    const btnSubmit = document.getElementById('btnSubmitAdvisorQuery');

    if (btnSubmit && !btnSubmit.dataset.bound) {
      btnSubmit.dataset.bound = 'true';
      btnSubmit.addEventListener('click', () => this.submitAdvisorQuery());
      if (inputEl) {
        inputEl.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') this.submitAdvisorQuery();
        });
      }
      // Mobile/PWA: teclados virtuais (ex.: Gboard) nem sempre emitem
      // 'keypress'; o botão "Ir/Enviar" dispara o submit do form. Sem este
      // listener o envio era silenciosamente ignorado no mobile. O primeiro
      // envio limpa o input de forma síncrona, então um Enter físico (que
      // dispara keypress + submit) não duplica a pergunta.
      const advisorForm = document.getElementById('advisorForm');
      if (advisorForm && !advisorForm.dataset.bound) {
        advisorForm.dataset.bound = 'true';
        advisorForm.addEventListener('submit', (e) => {
          if (e) e.preventDefault();
          this.submitAdvisorQuery();
        });
      }
    }

    if (initialQuery && inputEl) {
      inputEl.value = initialQuery;
      this.submitAdvisorQuery(initialQuery);
    } else if (chatContainer && chatContainer.children.length === 0) {
      const defaultAdvice = this.fallbackResponse();
      this.appendAdvisorResponse(defaultAdvice);
    }
  }

  submitAdvisorQuery(text = null) {
    const inputEl = document.getElementById('advisorQueryInput');
    const query = text || (inputEl ? inputEl.value : '');
    if (!query || !query.trim()) return;

    if (inputEl) inputEl.value = '';
    this.appendUserMessage(query);

    setTimeout(() => {
      const advice = this.processQuery(query);
      this.appendAdvisorResponse(advice);
    }, 500);
  }

  appendUserMessage(text) {
    const chatContainer = document.getElementById('advisorChatHistory');
    if (!chatContainer) return;

    const msgEl = document.createElement('div');
    msgEl.className = 'advisor-user-msg';
    msgEl.style.display = 'flex';
    msgEl.style.justifyContent = 'flex-end';
    msgEl.style.marginBottom = '1.2rem';
    
    // S8B: texto do usuário sempre como TEXTO (nunca HTML).
    const bubble = document.createElement('div');
    bubble.className = 'user-msg-bubble';
    bubble.setAttribute('style', 'background: var(--primary); color: #fff; padding: 12px 18px; border-radius: 18px 18px 4px 18px; max-width: 85%; font-size: 0.95rem; box-shadow: 0 4px 10px rgba(130,10,209,0.2); line-height: 1.4;');
    bubble.textContent = text;

    msgEl.appendChild(bubble);
    chatContainer.appendChild(msgEl);
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  /**
   * Renderiza o resultado do fluxo de compromissos em blocos empilhados
   * (somente apresentação; reutiliza as classes `.settlement-*` do CSS e
   * os tokens de cor já existentes no sistema). Todo conteúdo dinâmico é
   * escapado (padrão S8B). Sem blocos, retorna string vazia.
   */
  renderSettlementBlocks(blocks) {
    if (!Array.isArray(blocks) || blocks.length === 0) return '';
    const esc = (v) => LinsoraUtils.escapeHTML(v ?? '');
    const toneClass = (tone) => tone === 'expense' || tone === 'positive' || tone === 'pending'
      ? `settlement-value ${tone}` : 'settlement-value';
    const html = blocks.map((b) => {
      if (!b || typeof b !== 'object') return '';
      const label = `<span class="settlement-label">${esc(b.label)}</span>`;
      const title = b.title ? `<span class="settlement-title">${esc(b.title)}</span>` : '';
      const value = b.value ? `<strong class="${toneClass(b.valueTone)}">${esc(b.value)}</strong>` : '';
      const note = b.note ? `<span class="settlement-note">${esc(b.note)}</span>` : '';
      let rows = '';
      if (Array.isArray(b.items)) {
        rows = b.items.length === 0
          ? `<span class="settlement-note">${esc(b.emptyNote || 'nenhum compromisso pendente')}</span>`
          : b.items.map((it) => `
            <div class="settlement-row">
              <span class="settlement-title">${esc(it.title)}</span>
              <strong class="${toneClass(b.valueTone)}">${esc(it.amountText)}</strong>
              ${it.dueDateText ? `<span class="settlement-sub">Vencimento: ${esc(it.dueDateText)}</span>` : ''}
            </div>`).join('');
      }
      return `<div class="settlement-block">${label}${title}${value}${rows}${note}</div>`;
    }).join('');
    return `<div class="settlement-blocks">${html}</div>`;
  }

  appendAdvisorResponse(advice) {
    const chatContainer = document.getElementById('advisorChatHistory');
    if (!chatContainer) return;

    const resEl = document.createElement('div');
    resEl.className = `advisor-bot-msg severity-${advice.severity}`;
    resEl.style.display = 'flex';
    resEl.style.justifyContent = 'flex-start';
    resEl.style.marginBottom = '1.2rem';

    // Determina a cor de destaque (borda ou fundo de header) com base na severidade
    let highlightColor = 'var(--primary)';
    let highlightBg = 'rgba(130, 10, 209, 0.05)';
    if (advice.severity === 'danger') {
       highlightColor = '#EF4444';
       highlightBg = 'rgba(239, 68, 68, 0.05)';
    } else if (advice.severity === 'warning') {
       highlightColor = '#F59E0B';
       highlightBg = 'rgba(245, 158, 11, 0.05)';
    } else if (advice.severity === 'success') {
       highlightColor = '#10B981';
       highlightBg = 'rgba(16, 185, 129, 0.05)';
    }

    let actionBtnHtml = '';
    let bindFlowActions = null;
    const self = this;
    if (advice.action) {
      const btnId = 'btnAct_' + Date.now();
      // S8B: texto do botão também é dado dinâmico — escapar.
      const btnText = LinsoraUtils.escapeHTML(advice.action.buttonText || 'Confirmar');
      
      actionBtnHtml = `
        <button class="linsora-btn primary" id="${btnId}" style="margin-top: 14px; width: 100%; border-radius: 10px; font-weight: 600; padding: 12px;">
          ${btnText}
        </button>
      `;
      
      setTimeout(() => {
        const btn = document.getElementById(btnId);
        if (btn) {
          btn.addEventListener('click', () => {
            try {
               btn.disabled = true;
               btn.innerText = 'Processando...';
               this.executeAction(advice.action);
               this.appendAdvisorResponse({
                  severity: 'success',
                  title: '✅ Sucesso!',
                  diagnosis: 'Sua ação foi processada e gravada.',
                  impact: 'As mudanças já foram refletidas no seu painel financeiro.',
                  recommendation: 'Posso ajudar em mais alguma coisa?'
               });
            } catch (err) {
               this.appendAdvisorResponse({
                  severity: 'danger',
                  title: '❌ Falha ao Salvar',
                  diagnosis: 'Houve um erro no processamento: ' + err.message,
                  impact: 'Nenhum dado foi alterado.',
                  recommendation: 'Por favor, tente novamente.'
               });
            }
          });
        }
      }, 50);
    }

    // Botões de confirmação do fluxo de compromissos (Confirmar/Cancelar):
    // cada um resolve para a resposta específica do fluxo (sem o genérico
    // "Sucesso!" acima). Ligação direta e síncrona aos nós criados abaixo
    // (sem setTimeout/id): determinística em desktop e mobile.
    // Desabilitados após o clique (sem duplo disparo).
    if (Array.isArray(advice.actions) && advice.actions.length > 0) {
      const flowActions = advice.actions;
      actionBtnHtml += flowActions.map((a, idx) => {
        const btnText = LinsoraUtils.escapeHTML(a.buttonText || 'Confirmar');
        const primary = idx === 0;
        return `
          <button class="linsora-btn ${primary ? 'primary' : 'outline'}" data-flow-action="${LinsoraUtils.escapeHTML(a.type || '')}" style="margin-top: 10px; width: 100%; border-radius: 10px; font-weight: 600; padding: 12px;">
            ${btnText}
          </button>
        `;
      }).join('');

      bindFlowActions = () => {
        resEl.querySelectorAll('[data-flow-action]').forEach((btn) => {
          btn.addEventListener('click', () => {
            try {
              // Trava todos os botões do fluxo contra duplo clique.
              const container = btn.parentElement;
              if (container) {
                container.querySelectorAll('[data-flow-action]').forEach(b => { b.disabled = true; });
              } else {
                btn.disabled = true;
              }
              btn.innerText = 'Processando...';
              const flowType = btn.getAttribute('data-flow-action');
              const res = (flowType === 'CONFIRM_COMMITMENT_PAID')
                ? self.applyCommitmentConfirmation()
                : self.cancelCommitmentConfirmation();
              if (res) self.appendAdvisorResponse(res);
            } catch (err) {
              self.appendAdvisorResponse({
                severity: 'danger',
                title: '❌ Falha ao processar',
                diagnosis: 'Houve um erro: ' + err.message,
                impact: 'Nenhum dado foi alterado.',
                recommendation: 'Por favor, tente novamente.'
              });
            }
          });
        });
      };
    }

    // S8B: campos do conselheiro podem conter dados derivados do usuário
    // (ex: título de meta vindo da fala) — escapar antes de interpolar.
    const safeTitle = LinsoraUtils.escapeHTML(advice.title);
    const safeDiagnosis = LinsoraUtils.escapeHTML(advice.diagnosis);
    const safeImpact = LinsoraUtils.escapeHTML(advice.impact);
    const safeRecommendation = LinsoraUtils.escapeHTML(advice.recommendation);
    const settlementHtml = this.renderSettlementBlocks(advice.settlementBlocks);

    resEl.innerHTML = `
      <div class="bot-msg-bubble" style="background: var(--card-bg); padding: 0; border-radius: 4px 18px 18px 18px; max-width: 90%; font-size: 0.95rem; box-shadow: 0 4px 12px rgba(0,0,0,0.06); border: 1px solid var(--border); overflow: hidden;">
        
        <div style="background: ${highlightBg}; padding: 12px 16px; border-bottom: 1px solid var(--border); font-weight: 600; font-size: 1rem; color: ${highlightColor}; display: flex; align-items: center; gap: 8px;">
          ${safeTitle}
        </div>
        
        <div style="padding: 16px;">
          ${settlementHtml}

          <div style="color: var(--text-color); line-height: 1.5; margin-bottom: 4px;">
            ${safeRecommendation}
          </div>

          ${Array.isArray(advice.commitmentOptions) && advice.commitmentOptions.length > 0 ? `
            <div class="commitment-options-list" style="margin-top: 12px; display: flex; flex-direction: column; gap: 10px;">
              <strong style="font-size: 0.9rem; color: var(--text-color);">${LinsoraUtils.escapeHTML(advice.commitmentOptionsTitle || 'Compromissos próximos')}</strong>
              ${advice.commitmentOptions.map(opt => `
                <div class="commitment-option-item" style="display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; background: var(--bg-color); border: 1px solid var(--border); border-radius: 8px;">
                  <span style="font-size: 0.9rem; font-weight: 700; color: var(--text-color);">${LinsoraUtils.escapeHTML(String(opt.n))}. ${LinsoraUtils.escapeHTML(opt.title)}</span>
                  <strong style="font-size: 0.95rem; color: var(--text-color);">${LinsoraUtils.escapeHTML(opt.amount)}</strong>
                  ${opt.dueDate ? `<span style="font-size: 0.8rem; color: var(--text-muted);">Vencimento: ${LinsoraUtils.escapeHTML(opt.dueDate)}</span>` : ''}
                </div>
              `).join('')}
            </div>
          ` : ''}
          
          <details style="margin-top: 12px; cursor: pointer; user-select: none;">
            <summary style="font-size: 0.85rem; font-weight: 600; color: var(--text-muted); padding: 4px 0; outline: none; transition: color 0.2s;">
              Ver detalhes técnicos 📊
            </summary>
            <div style="margin-top: 8px; padding: 12px; background: var(--bg-color); border-radius: 8px; font-size: 0.85rem; color: var(--text-muted); border: 1px solid var(--border); line-height: 1.4;">
              <strong style="color: var(--text-color);">Análise Diagnóstica:</strong><br/>${safeDiagnosis}<br/><br/>
              <strong style="color: var(--text-color);">Visão Consolidada:</strong>
              ${Array.isArray(advice.technicalIndicators) && advice.technicalIndicators.length > 0 ? `
                <div class="technical-metrics-list" style="margin-top: 10px; display: flex; flex-direction: column; gap: 10px;">
                  ${advice.technicalIndicators.map(ind => `
                    <div class="tech-metric-item" style="display: flex; flex-direction: column; gap: 2px;">
                      <span style="font-size: 0.8rem; color: var(--text-muted); font-weight: 500;">${LinsoraUtils.escapeHTML(ind.label)}</span>
                      <strong style="font-size: 0.95rem; color: var(--text-color);">${LinsoraUtils.escapeHTML(ind.value)}</strong>
                    </div>
                  `).join('')}
                </div>
              ` : `<br/>${safeImpact}`}
            </div>
          </details>
          
          ${actionBtnHtml}
        </div>

      </div>
    `;

    chatContainer.appendChild(resEl);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    if (typeof bindFlowActions === 'function') bindFlowActions();
  }

  executeAction(action) {
    if (!action || !action.payload) return;
    const p = action.payload;

    if (action.type === 'EXECUTE_TRANSACTION' || action.type === 'PROPOSE_TRANSACTION') {
       if (window.linsoraStore) {
         window.linsoraStore.saveTransaction({
            type: p.type,
            amount: p.amount,
            category: p.category,
            description: p.description,
            date: p.date,
            status: 'CONCLUIDO',
            account: 'Conta Principal'
         });
       }
    } else if (action.type === 'EXECUTE_GOAL' || action.type === 'PROPOSE_GOAL') {
       if (window.linsoraStore && p.isExistingGoal && p.goalId) {
          window.linsoraStore.updateGoalProgress(p.goalId, p.amount);
       } else if (window.linsoraStore) {
          window.linsoraStore.addGoal({
             title: p.title,
             target: p.target,
             deadline: p.deadline,
             icon: p.icon,
             category: p.type
          });
       }
    }
  }
}

window.LinsoraStrategicAdvisor = new StrategicAdvisorEngine();

// Injetar bind do feed no init
document.addEventListener('DOMContentLoaded', () => {
   setTimeout(() => {
     if (window.LinsoraStrategicAdvisor) {
        window.LinsoraStrategicAdvisor.renderHomeFeed();
     }
   }, 2000);
});
