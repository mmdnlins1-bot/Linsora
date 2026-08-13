/**
 * ============================================================================
 * LINSORA — ASSISTENTE PESSOAL INTELIGENTE & CONSELHEIRO ESTRATÉGICO
 * (js/strategic-advisor.js)
 * Motor de Análise Crítica, Feed de Contexto Dinâmico na Home e System Prompt
 * ============================================================================
 */

const LINSORA_SYSTEM_PROMPT = `
Você é o LINSORA AI — Conselheiro Estratégico e Assistente Pessoal de Finanças de alta performance.
Sua missão é atuar como um mentor financeiro extremamente crítico, analítico, direto e pragmático. Você NÃO é um chatbot passivo e NÃO usa linguagem bajuladora, genérica ou excessivamente polida.

DIRETRIZES RIGOROSAS DE COMPORTAMENTO:
1. ANÁLISE RIGOROSA E BASEADA EM DADOS:
   - Analise os números reais do usuário: Receita Mensal, Despesas Totais, Saldo, Taxa de Poupança (%) e Maiores Categorias de Gasto.
   - Aponte sem rodeios se o comprometimento de renda estiver acima de 70% ou se a taxa de poupança for inferior a 20%.

2. CRÍTICA CONSTRUTIVA E CONTRAPONTO:
   - Quando o usuário perguntar se pode realizar uma compra discricionária, confronte o valor com as metas ativas e a reserva de emergência antes de dar um veredito.
   - Exemplo: "Você quer gastar R$ 300 em um jantar, mas sua categoria Restaurantes já consumiu R$ 850 este mês (35% das suas despesas) e sua reserva cobre apenas 1,2 meses. Isso atrasará sua meta em 45 dias. Recomendação: limite a R$ 100 ou adie."

3. ESTRUTURA CRÍTICA DAS RESPOSTAS:
   - 🔴/🟡/🟢 DIAGNÓSTICO DIRETO: 1 frase assertiva com a postura financeira.
   - 📊 IMPACTO ORÇAMENTÁRIO: Números concretos, percentuais de comprometimento e gargalos.
   - 🎯 RECOMENDAÇÃO ACIONÁVEL: Decisão prática e clara a tomar imediatamente.

4. TOM DE VOZ:
   - Profissional, firme, analítico e orientador. Sem cumprimentos prolixos ("Espero que esteja bem") ou justificativas vagas.
`;

class StrategicAdvisorEngine {
  constructor() {
    this.systemPrompt = LINSORA_SYSTEM_PROMPT;
    this.chatHistory = [];
  }

  /**
   * Calcula as métricas financeiras chave a partir do estado atual da linsoraStore.
   */
  calculateFinancialMetrics() {
    const state = (window.linsoraStore && window.linsoraStore.state) || {};
    const transactions = state.transactions || [];
    const goals = state.goals || [];
    const accounts = state.accounts || [];

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const currentDay = now.getDate();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

    // Filtrar transações do mês atual
    const monthTx = transactions.filter(t => {
      const d = new Date(t.date || t.created_at);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });

    let monthIncome = 0;
    let monthExpense = 0;
    const categoryTotals = {};

    monthTx.forEach(t => {
      const amt = Number(t.amount) || 0;
      if (t.type === 'RECEITA') {
        monthIncome += amt;
      } else {
        monthExpense += amt;
        const cat = t.category || 'Outros';
        categoryTotals[cat] = (categoryTotals[cat] || 0) + amt;
      }
    });

    // Calcular Saldo Total de Contas
    const netWorth = accounts.reduce((acc, a) => acc + (Number(a.balance) || 0), 0);

    // Identificar Maior Categoria de Gasto
    let topCategory = { name: 'Sem gastos', amount: 0, percent: 0 };
    let maxCatAmount = 0;
    Object.keys(categoryTotals).forEach(cat => {
      if (categoryTotals[cat] > maxCatAmount) {
        maxCatAmount = categoryTotals[cat];
        topCategory = {
          name: cat,
          amount: maxCatAmount,
          percent: monthExpense > 0 ? Math.round((maxCatAmount / monthExpense) * 100) : 0
        };
      }
    });

    // Métricas Percentuais
    const netMonthBalance = monthIncome - monthExpense;
    const commitmentRate = monthIncome > 0 ? Math.round((monthExpense / monthIncome) * 100) : (monthExpense > 0 ? 100 : 0);
    const savingsRate = monthIncome > 0 ? Math.round((netMonthBalance / monthIncome) * 100) : 0;
    const dailyBurnRate = currentDay > 0 ? (monthExpense / currentDay) : 0;
    const idealDailyBurn = monthIncome > 0 ? ((monthIncome * 0.70) / daysInMonth) : 0;

    // Determinar Postura Financeira
    let posture = 'EQUILIBRADO'; // CRITICO, ALERTA, EQUILIBRADO, PROSPERO
    let postureColor = 'cyan';
    let postureTitle = 'Postura Financeira Estável';

    if (monthIncome > 0 && monthExpense > monthIncome) {
      posture = 'CRITICO';
      postureColor = 'danger';
      postureTitle = 'Déficit Orçamentário Crítico';
    } else if (commitmentRate > 80) {
      posture = 'ALERTA';
      postureColor = 'warning';
      postureTitle = 'Comprometimento Elevado de Renda';
    } else if (savingsRate >= 25) {
      posture = 'PROSPERO';
      postureColor = 'success';
      postureTitle = 'Excelente Capacidade de Poupança';
    }

    return {
      monthIncome,
      monthExpense,
      netMonthBalance,
      netWorth,
      commitmentRate,
      savingsRate,
      dailyBurnRate,
      idealDailyBurn,
      topCategory,
      posture,
      postureColor,
      postureTitle,
      goalsCount: goals.length,
      currentDay,
      daysInMonth
    };
  }

  /**
   * Gera os dados do Feed de Contexto Dinâmico para renderizar na Home.
   */
  generateDynamicFeedData() {
    const metrics = this.calculateFinancialMetrics();

    let headline = '';
    let critique = '';
    let actionText = '';
    let severity = 'info';

    if (metrics.monthIncome === 0 && metrics.monthExpense === 0) {
      headline = 'Nenhuma movimentação registrada este mês.';
      critique = 'O Conselheiro LINSORA precisa de dados reais para analisar seus riscos. Registre suas receitas e despesas ou use a voz.';
      actionText = 'Registrar primeiro lançamento por voz ou formulário.';
      severity = 'info';
    } else if (metrics.posture === 'CRITICO') {
      severity = 'danger';
      headline = `Suas despesas excedem sua receita em ${LinsoraUtils.formatBRL(Math.abs(metrics.netMonthBalance))}.`;
      critique = `Seu comprometimento é de ${metrics.commitmentRate}%. A categoria "${metrics.topCategory.name}" consome ${metrics.topCategory.percent}% de tudo que você gastou.`;
      actionText = `Corte gastos não essenciais em ${metrics.topCategory.name} imediatamente para fechar o mês sem dívidas.`;
    } else if (metrics.posture === 'ALERTA') {
      severity = 'warning';
      headline = `Você já comprometeu ${metrics.commitmentRate}% da sua receita deste mês.`;
      critique = `Seu ritmo diário de consumo está em ${LinsoraUtils.formatBRL(metrics.dailyBurnRate)}/dia (o ideal seria até ${LinsoraUtils.formatBRL(metrics.idealDailyBurn)}/dia).`;
      actionText = `Reduza despesas variáveis no restante do mês para garantir uma margem mínima de segurança de 15%.`;
    } else if (metrics.posture === 'PROSPERO') {
      severity = 'success';
      headline = `Sua taxa de poupança está em ótimos ${metrics.savingsRate}%!`;
      critique = `Você mantém um superávit mensal de ${LinsoraUtils.formatBRL(metrics.netMonthBalance)}. É o momento ideal para acelerar suas metas financeiras.`;
      actionText = `Aloque parte deste saldo positivo para suas metas ativas ou reserva de emergência.`;
    } else {
      severity = 'info';
      headline = `Seu orçamento está equilibrado com ${metrics.commitmentRate}% de comprometimento.`;
      critique = `Sua principal categoria de despesa é "${metrics.topCategory.name}" (${metrics.topCategory.percent}% do total gastador).`;
      actionText = `Mantenha a disciplina nos próximos ${metrics.daysInMonth - metrics.currentDay} dias para fechar no positivo.`;
    }

    return {
      metrics,
      severity,
      headline,
      critique,
      actionText
    };
  }

  /**
   * Processa uma consulta direta do usuário (texto ou voz) e gera um conselho crítico e analítico.
   * @param {string} userQuery 
   */
  processQuery(userQuery) {
    const metrics = this.calculateFinancialMetrics();
    const query = (userQuery || '').trim().toLowerCase();

    let response = {
      severity: 'info',
      title: 'Análise Estratégica LINSORA',
      diagnosis: '',
      impact: '',
      recommendation: ''
    };

    // 1. Pergunta sobre viabilidade de gasto em linguagem natural (ex: "posso gastar R$ 150 hoje?")
    const spendKeywords = ['posso', 'consigo', 'dá para', 'da pra', 'cabe', 'devo', 'quanto posso', 'gastar', 'comprar', 'pagar', 'jantar'];
    const isSpendQuery = spendKeywords.some(kw => query.includes(kw));

    const spendMatch = query.match(/(?:posso|consigo|dá para|da pra|cabe|devo)?\s*(?:gastar|comprar|pagar|jantar|fazer)?\s*(?:com|em|um|uma)?\s*R?\$?\s*(\d+(?:[\.,]\d+)?)/i)
      || query.match(/R?\$?\s*(\d+(?:[\.,]\d+)?)/i);

    if (isSpendQuery) {
      const askedAmount = spendMatch ? parseFloat(spendMatch[1].replace(',', '.')) : 0;

      const todayDate = new Date();
      const currentDay = todayDate.getDate();
      const currentMonth = todayDate.getMonth();
      const currentYear = todayDate.getFullYear();

      const storeState = window.linsoraStore?.state || {};
      const transactions = storeState.transactions || [];
      const accounts = storeState.accounts || [];
      const fixedBills = storeState.fixedBills || [];
      const cards = storeState.cards || [];

      // Determinar próximo salário (detectado do perfil, transações ou padrão dia 5)
      let salaryDay = storeState.user?.salaryDay || 5;
      if (!storeState.user?.salaryDay && transactions.length > 0) {
        const salaryTx = transactions.find(t => t.type === 'RECEITA' && (
          (t.category && t.category.toLowerCase().includes('salário')) ||
          (t.description && /salário|salario|holerite|pro-labore/i.test(t.description))
        ));
        if (salaryTx && salaryTx.date) {
          const txDay = new Date(salaryTx.date).getDate();
          if (txDay >= 1 && txDay <= 31) salaryDay = txDay;
        }
      }

      let nextSalaryDate = new Date(currentYear, currentMonth, salaryDay);
      if (currentDay >= salaryDay) {
        nextSalaryDate = new Date(currentYear, currentMonth + 1, salaryDay);
      }
      const daysRemaining = Math.max(1, Math.ceil((nextSalaryDate - todayDate) / (1000 * 60 * 60 * 24)));

      const nextSalaryDay = nextSalaryDate.getDate();
      const isNextMonth = nextSalaryDate.getMonth() !== currentMonth;
      const nextSalaryMonthStr = isNextMonth ? 'do mês que vem' : 'deste mês';

      let accountBalance = accounts.reduce((acc, a) => acc + (Number(a.balance) || 0), 0);
      if (accountBalance <= 0 && metrics.monthIncome > 0) {
        accountBalance = Math.max(0, metrics.monthIncome - metrics.monthExpense);
      }

      // Soma de contas fixas pendentes
      const pendingBillsTotal = fixedBills
        .filter(b => !b.paid && !b.isPaid)
        .reduce((sum, b) => sum + (Number(b.amount) || 0), 0);

      // Soma de faturas de cartão pendentes
      const cardBillsTotal = cards.reduce((sum, c) => sum + (Number(c.currentInvoice) || 0), 0);

      const totalPendingCommitments = pendingBillsTotal + cardBillsTotal;
      const safeBalance = Math.max(0, accountBalance - totalPendingCommitments);

      const dailySafeLimit = safeBalance > 0 ? Math.round(safeBalance / daysRemaining) : 0;
      const weeklySafeLimit = Math.round(dailySafeLimit * 7);

      if (askedAmount > 0) {
        const remainingAfterAsked = safeBalance - askedAmount;

        if (askedAmount <= safeBalance && remainingAfterAsked >= 0) {
          response.severity = 'success';
          response.title = '🟢 Gasto Autorizado: Dentro do Saldo Seguro';
          response.diagnosis = `Hoje é dia ${currentDay}, seu próximo salário será no dia ${nextSalaryDay} ${nextSalaryMonthStr}. Faltam ${daysRemaining} dias.`;
          response.impact = `Com ${LinsoraUtils.formatBRL(accountBalance)} e considerando todas as contas cadastradas até lá, seu saldo seguro para uso é ${LinsoraUtils.formatBRL(safeBalance)}. Ou seja, cerca de ${LinsoraUtils.formatBRL(dailySafeLimit)} por dia ou ${LinsoraUtils.formatBRL(weeklySafeLimit)} por semana, sem comprometer as finanças.`;
          response.recommendation = `Se gastar ${LinsoraUtils.formatBRL(askedAmount)} hoje, você ainda assim permanecerá dentro do saldo projetado até o próximo salário, mantendo as despesas previstas em dia.`;
        } else {
          response.severity = 'danger';
          response.title = '🔴 ALERTA DE RISCO: Gasto Não Recomendado';
          response.diagnosis = `Hoje é dia ${currentDay}, seu próximo salário será no dia ${nextSalaryDay} ${nextSalaryMonthStr}. Faltam ${daysRemaining} dias.`;
          response.impact = `Com ${LinsoraUtils.formatBRL(accountBalance)} em conta e considerando ${LinsoraUtils.formatBRL(totalPendingCommitments)} em contas pendentes até lá, seu saldo seguro para uso é ${LinsoraUtils.formatBRL(safeBalance)} (cerca de ${LinsoraUtils.formatBRL(dailySafeLimit)} por dia). Gastar ${LinsoraUtils.formatBRL(askedAmount)} comprometeria o pagamento das suas despesas previstas.`;
          response.recommendation = `A compra de ${LinsoraUtils.formatBRL(askedAmount)} não é recomendada no momento. O valor máximo seguro recomendado para gastar hoje é de até ${LinsoraUtils.formatBRL(Math.max(0, dailySafeLimit))} (ou no máximo ${LinsoraUtils.formatBRL(safeBalance)} até o próximo salário).`;
        }

        return response;
      } else {
        response.severity = 'info';
        response.title = '💡 Saldo Seguro para Gastos Diários e Semanais';
        response.diagnosis = `Hoje é dia ${currentDay}, seu próximo salário será no dia ${nextSalaryDay} ${nextSalaryMonthStr}. Faltam ${daysRemaining} dias.`;
        response.impact = `Com ${LinsoraUtils.formatBRL(accountBalance)} em conta e ${LinsoraUtils.formatBRL(totalPendingCommitments)} em contas cadastradas até lá, seu saldo seguro para uso é ${LinsoraUtils.formatBRL(safeBalance)}.`;
        response.recommendation = `Seu teto seguro de gastos é de cerca de ${LinsoraUtils.formatBRL(dailySafeLimit)} por dia ou ${LinsoraUtils.formatBRL(weeklySafeLimit)} por semana para não comprometer as contas previstas.`;
        return response;
      }
    }

    // 2. Consulta de Gargalo ou Maior Despesa
    if (query.includes('gargalo') || query.includes('maior gasto') || query.includes('maior despesa') || query.includes('onde estou gastando')) {
      if (metrics.topCategory.amount > 0) {
        response.severity = 'warning';
        response.title = '🔍 Análise do Maior Gargalo de Despesas';
        response.diagnosis = `Sua maior categoria de despesa no mês é "${metrics.topCategory.name}".`;
        response.impact = `Ela representa ${metrics.topCategory.percent}% do total de despesas (${LinsoraUtils.formatBRL(metrics.topCategory.amount)} de um total de ${LinsoraUtils.formatBRL(metrics.monthExpense)}).`;
        response.recommendation = `Estabeleça um teto de gastos para ${metrics.topCategory.name} no próximo mês. Uma redução de 20% nesta categoria vai liberar ${LinsoraUtils.formatBRL(metrics.topCategory.amount * 0.2)} para seus investimentos.`;
      } else {
        response.severity = 'info';
        response.title = '🔍 Análise do Orçamento';
        response.diagnosis = 'Ainda não há despesas registradas no mês atual para determinar o gargalo principal.';
        response.impact = 'Sem dados de despesas, sua taxa de poupança está em 100%.';
        response.recommendation = 'Assim que registrar suas contas diárias, o Conselheiro identificará automaticamente onde seu dinheiro está vazando.';
      }
      return response;
    }

    // 3. Consulta Geral de Orçamento / Diagnóstico Global
    const feedData = this.generateDynamicFeedData();
    response.severity = feedData.severity;
    response.title = `📊 Diagnóstico Orçamentário (${metrics.postureTitle})`;
    response.diagnosis = feedData.headline;
    response.impact = `${feedData.critique} Média diária de gastos atual: ${LinsoraUtils.formatBRL(metrics.dailyBurnRate)}. Meta diária recomendada: ${LinsoraUtils.formatBRL(metrics.idealDailyBurn)}.`;
    response.recommendation = feedData.actionText;

    return response;
  }

  /**
   * Síntese de Voz (Text-to-Speech) para ler o conselho em voz alta.
   * @param {string} text
   */
  speakText(text) {
    if (!('speechSynthesis' in window) || !window.speechSynthesis) return;

    try {
      window.speechSynthesis.cancel();

      const cleanText = text
        .replace(/[*_~#`]/g, '')
        .replace(/(📌|📊|🎯|🔴|🟡|🟢|⚡|🚀|⚠️|🚨)/g, '')
        .trim();

      if (!cleanText) return;

      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = 'pt-BR';
      utterance.rate = 1.0;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;

      const voices = window.speechSynthesis.getVoices() || [];
      const ptVoice = voices.find(v => v.lang && v.lang.toLowerCase().startsWith('pt'));
      if (ptVoice) utterance.voice = ptVoice;

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('Erro ao reproduzir voz sintética:', e);
    }
  }

  /**
   * Renderiza o Feed de Contexto Dinâmico no container da Home.
   */
  renderHomeFeed() {
    const feedContainer = document.getElementById('strategicFeedContainer');
    if (!feedContainer) return;

    const data = this.generateDynamicFeedData();
    const m = data.metrics;

    const statusBadgeClass = data.severity === 'danger' ? 'danger' : (data.severity === 'warning' ? 'warning' : (data.severity === 'success' ? 'success' : 'info'));
    const statusIcon = data.severity === 'danger' ? '🚨' : (data.severity === 'warning' ? '⚠️' : (data.severity === 'success' ? '🚀' : '💡'));

    feedContainer.innerHTML = `
      <div class="strategic-feed-card severity-${data.severity}">
        <div class="agent-live-tag">
          <span class="agent-tag-badge">🧠 CONSELHEIRO ESTRATÉGICO • AGENTE IA</span>
          <span class="pulse-dot"></span>
        </div>

        <div class="feed-header-row">
          <div class="feed-badge ${statusBadgeClass}">
            <span class="badge-icon">${statusIcon}</span>
            <span class="badge-text">${m.postureTitle}</span>
          </div>
          <button type="button" class="feed-advisor-btn highlighted" id="btnOpenAdvisorFromFeed">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="16" height="16"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            <span>Consultar Conselheiro</span>
          </button>
        </div>

        <div class="feed-headline">
          <h4>${data.headline}</h4>
        </div>

        <div class="feed-critique-box">
          <p>${data.critique}</p>
        </div>

        <div class="feed-metrics-pills">
          <div class="metric-pill">
            <span class="pill-label">Comprometimento</span>
            <span class="pill-value ${m.commitmentRate > 80 ? 'danger' : 'neutral'}">${m.commitmentRate}%</span>
          </div>
          <div class="metric-pill">
            <span class="pill-label">Taxa de Poupança</span>
            <span class="pill-value ${m.savingsRate >= 20 ? 'success' : 'warning'}">${m.savingsRate}%</span>
          </div>
          <div class="metric-pill">
            <span class="pill-label">Maior Gargalo</span>
            <span class="pill-value highlight">${m.topCategory.name} (${m.topCategory.percent}%)</span>
          </div>
        </div>

        <div class="feed-recommendation-footer">
          <span class="rec-tag">⚡ Ação Recomendada:</span>
          <span class="rec-text">${data.actionText}</span>
        </div>
      </div>
    `;

    // Conectar botão de abertura do conselheiro
    const btnAdvisor = document.getElementById('btnOpenAdvisorFromFeed');
    if (btnAdvisor) {
      btnAdvisor.addEventListener('click', () => {
        this.openAdvisorModal();
      });
    }
  }

  /**
   * Abre o Modal/Drawer do Conselheiro Estratégico.
   * @param {string} [initialQuery] 
   * @param {Object} [options]
   */
  openAdvisorModal(initialQuery = null, options = {}) {
    LinsoraUI.openModal('modalStrategicAdvisor');

    const chatContainer = document.getElementById('advisorChatHistory');
    const inputEl = document.getElementById('advisorQueryInput');

    if (initialQuery && inputEl) {
      inputEl.value = initialQuery;
      this.submitAdvisorQuery(initialQuery, options);
    } else if (chatContainer && chatContainer.children.length === 0) {
      const defaultAdvice = this.processQuery('diagnostico geral');
      this.appendAdvisorResponse(defaultAdvice, options);
    }
  }

  /**
   * Submete uma consulta e renderiza o cartão de resposta no modal.
   * @param {string} text 
   * @param {Object} [options]
   */
  submitAdvisorQuery(text, options = {}) {
    const query = text || (document.getElementById('advisorQueryInput') && document.getElementById('advisorQueryInput').value);
    if (!query || !query.trim()) return;

    const inputEl = document.getElementById('advisorQueryInput');
    if (inputEl) inputEl.value = '';

    this.appendUserMessage(query);

    setTimeout(() => {
      const advice = this.processQuery(query);
      this.appendAdvisorResponse(advice, options);
    }, 400);
  }

  appendUserMessage(text) {
    const chatContainer = document.getElementById('advisorChatHistory');
    if (!chatContainer) return;

    const msgEl = document.createElement('div');
    msgEl.className = 'advisor-user-msg';
    msgEl.innerHTML = `
      <div class="user-msg-bubble">${LinsoraUtils.escapeHTML(text)}</div>
    `;
    chatContainer.appendChild(msgEl);
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  appendAdvisorResponse(advice, options = {}) {
    const chatContainer = document.getElementById('advisorChatHistory');
    if (!chatContainer) return;

    const resEl = document.createElement('div');
    resEl.className = `advisor-res-card severity-${advice.severity}`;
    resEl.innerHTML = `
      <div class="advisor-card-header">
        <div class="advisor-card-title">${advice.title}</div>
      </div>
      <div class="advisor-card-section">
        <strong>📌 Diagnóstico</strong>
        <p>${advice.diagnosis}</p>
      </div>
      <div class="advisor-card-section">
        <strong>📊 Impacto no Orçamento</strong>
        <p>${advice.impact}</p>
      </div>
      <div class="advisor-card-section rec">
        <strong>🎯 Recomendação Prática</strong>
        <p>${advice.recommendation}</p>
      </div>
    `;

    chatContainer.appendChild(resEl);
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }
}

// Instância Global
window.LinsoraStrategicAdvisor = new StrategicAdvisorEngine();
