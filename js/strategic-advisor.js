/**
 * ============================================================================
 * LINSORA — MÓDULO DE IA E CONSELHEIRO ESTRATÉGICO (strategic-advisor.js)
 * Motor inteligente com contexto total de dados financeiros
 * ============================================================================
 */

class StrategicAdvisorEngine {
  constructor() {
    this.name = 'Conselheiro Linsora';
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

    return {
      monthIncome,
      monthExpense,
      monthFixedExpense,
      freeIncome,
      availableBalanceForMonth,
      currentDailyLimit,
      daysRemaining,
      totalBalance,
      totalLiquidity
    };
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
      action: {
        type: isGoal ? 'EXECUTE_GOAL' : 'EXECUTE_TRANSACTION',
        payload: parsedData,
        buttonText: 'Confirmar Gravação'
      }
    };
  }

  handleViabilityQuestion(parsedData, metrics, rawText, intent) {
    const isGoal = parsedData.action === 'APORTE' || parsedData.type?.includes('Meta') || parsedData.type?.includes('Reserva');
    const amount = parsedData.amount || parsedData.target;
    
    if (isGoal) {
        let rec = amount <= metrics.availableBalanceForMonth ? 'Aporte viável.' : 'Aporte compromete suas despesas livres mensais.';
        if (intent === 'AMBIGUOUS') {
          rec = 'Não ficou claro se é um registro ou simulação. ' + rec + ' Por favor, diga "Registre..." ou "Simule...".';
        }
        return {
          severity: 'info',
          title: intent === 'AMBIGUOUS' ? '🤔 Simulação ou Registro?' : '🔮 Simulação de Aporte/Meta',
          diagnosis: `Você mencionou destinar ${LinsoraUtils.formatBRL(amount)} para ${parsedData.title}.`,
          impact: `Livre no mês: ${LinsoraUtils.formatBRL(metrics.availableBalanceForMonth)}.`,
          recommendation: rec,
          action: null
        };
    }

    if (!amount || amount === 0) {
      return {
        severity: 'info',
        title: '💡 Limite Seguro',
        diagnosis: `Com base nas suas receitas, despesas, reservas e saldo, o seu caixa livre no momento é de ${LinsoraUtils.formatBRL(metrics.availableBalanceForMonth)}.`,
        impact: `Caixa Livre do Mês: ${LinsoraUtils.formatBRL(metrics.availableBalanceForMonth)} | Saldo em Contas: ${LinsoraUtils.formatBRL(metrics.totalBalance)} | Despesas: ${LinsoraUtils.formatBRL(metrics.monthExpense)}`,
        recommendation: `Para não comprometer suas finanças, recomendo que seus gastos fiquem dentro de **${LinsoraUtils.formatBRL(metrics.currentDailyLimit)}** por dia até o próximo mês.`,
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
    } else if (amount > metrics.availableBalanceForMonth) {
      severity = 'warning';
      recommendation = `Você tem saldo nas contas para cobrir, mas esse gasto de ${LinsoraUtils.formatBRL(amount)} ultrapassa a sua renda livre do mês (${LinsoraUtils.formatBRL(metrics.availableBalanceForMonth)}). Você precisará entrar nas suas reservas acumuladas.`;
    } else if (amount <= metrics.currentDailyLimit) {
      severity = 'success';
      recommendation = `Perfeito! O valor cabe perfeitamente no seu limite diário atual de ${LinsoraUtils.formatBRL(metrics.currentDailyLimit)}.`;
    } else {
      severity = 'warning';
      recommendation = `É viável no mês, mas passa do seu teto diário de ${LinsoraUtils.formatBRL(metrics.currentDailyLimit)}. Se gastar isso hoje, vai precisar segurar a onda nos próximos dias.`;
    }
    
    const impactMath = `Caixa Livre do Mês: ${LinsoraUtils.formatBRL(metrics.availableBalanceForMonth)} | Saldo em Contas: ${LinsoraUtils.formatBRL(metrics.totalBalance)} | Receitas do Mês: ${LinsoraUtils.formatBRL(metrics.monthIncome)} | Despesas do Mês: ${LinsoraUtils.formatBRL(metrics.monthExpense)} | Limite Diário: ${LinsoraUtils.formatBRL(metrics.currentDailyLimit)}`;

    if (intent === 'AMBIGUOUS') {
      recommendation = `Para me ajudar, por favor, seja mais direto: diga "Registre ${LinsoraUtils.formatBRL(amount)}${catText}" ou "Posso gastar ${LinsoraUtils.formatBRL(amount)}${catText}?".`;
    }

    return {
      severity,
      title: intent === 'AMBIGUOUS' ? '🤔 Simulação ou Registro?' : '🔮 Simulação de Gasto',
      diagnosis,
      impact: impactMath,
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

    // S8B: campos do conselheiro podem conter dados derivados do usuário
    // (ex: título de meta vindo da fala) — escapar antes de interpolar.
    const safeTitle = LinsoraUtils.escapeHTML(advice.title);
    const safeDiagnosis = LinsoraUtils.escapeHTML(advice.diagnosis);
    const safeImpact = LinsoraUtils.escapeHTML(advice.impact);
    const safeRecommendation = LinsoraUtils.escapeHTML(advice.recommendation);

    resEl.innerHTML = `
      <div class="bot-msg-bubble" style="background: var(--card-bg); padding: 0; border-radius: 4px 18px 18px 18px; max-width: 90%; font-size: 0.95rem; box-shadow: 0 4px 12px rgba(0,0,0,0.06); border: 1px solid var(--border); overflow: hidden;">
        
        <div style="background: ${highlightBg}; padding: 12px 16px; border-bottom: 1px solid var(--border); font-weight: 600; font-size: 1rem; color: ${highlightColor}; display: flex; align-items: center; gap: 8px;">
          ${safeTitle}
        </div>
        
        <div style="padding: 16px;">
          <div style="color: var(--text-color); line-height: 1.5; margin-bottom: 4px;">
            ${safeRecommendation}
          </div>
          
          <details style="margin-top: 12px; cursor: pointer; user-select: none;">
            <summary style="font-size: 0.85rem; font-weight: 600; color: var(--text-muted); padding: 4px 0; outline: none; transition: color 0.2s;">
              Ver detalhes técnicos 📊
            </summary>
            <div style="margin-top: 8px; padding: 12px; background: var(--bg-color); border-radius: 8px; font-size: 0.85rem; color: var(--text-muted); border: 1px solid var(--border); line-height: 1.4;">
              <strong style="color: var(--text-color);">Análise Diagnóstica:</strong><br/>${safeDiagnosis}<br/><br/>
              <strong style="color: var(--text-color);">Visão Consolidada:</strong><br/>${safeImpact}
            </div>
          </details>
          
          ${actionBtnHtml}
        </div>

      </div>
    `;

    chatContainer.appendChild(resEl);
    chatContainer.scrollTop = chatContainer.scrollHeight;
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
