/**
 * ============================================================================
 * LINSORA — UTILITÁRIOS & FORMATADORES BRASILEIROS & MÁSCARA MOEDA (utils.js)
 * Formatação BRL, máscara de moeda pt-BR em tempo real, datas e PDF
 * ============================================================================
 */

const LinsoraUtils = {
  /**
   * Sanitizador estrito contra vulnerabilidades de XSS (Cross-Site Scripting)
   */
  escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/\//g, '&#x2F;');
  },

  /**
   * Formata um valor numérico para a moeda brasileira (R$)
   * Respeita o modo de privacidade (mascaramento por bolinhas •••••)
   */
  formatBRL(amount, hideValues = false) {
    if (hideValues) return 'R$ ••••••';
    const num = parseFloat(amount) || 0;
    return num.toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  },

  /**
   * Máscara Dinâmica de Moeda Brasileira pt-BR enquanto o usuário digita
   * Digitar '1' -> '0,01'
   * Digitar '10' -> '0,10'
   * Digitar '100' -> '1,00'
   * Digitar '15000' -> '150,00'
   * Digitar '15050' -> '150,50'
   * Digitar '100000' -> '1.000,00'
   * Digitar '1000000' -> '10.000,00'
   * Digitar '100000000' -> '1.000.000,00'
   */
  formatCurrencyInput(value) {
    if (!value) return '';
    const digits = String(value).replace(/\D/g, '');
    if (!digits) return '';

    const cents = parseInt(digits, 10);
    const amount = cents / 100;

    return amount.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  },

  /**
   * Converte valor formatado em pt-BR (ex: "1.500,50" ou 1500.5) de volta para float limpo (1500.5)
   */
  parseCurrencyToFloat(value) {
    if (typeof value === 'number') return isNaN(value) ? 0 : value;
    if (!value) return 0;
    const str = String(value).trim();
    if (!str) return 0;

    // Se já for uma string numérica limpa com ponto decimal (ex: "150.5" ou "1500")
    if (/^\d+(\.\d+)?$/.test(str)) {
      return parseFloat(str);
    }

    // Se contiver vírgula ou formato brasileiro (ex: "1.500,50" ou "150,00")
    const digits = str.replace(/\D/g, '');
    if (!digits) return 0;
    return parseInt(digits, 10) / 100;
  },

  /**
   * Vincula máscara de moeda pt-BR a todos os elementos com a classe .currency-mask
   */
  attachCurrencyMasks() {
    document.querySelectorAll('.currency-mask').forEach(input => {
      input.setAttribute('inputmode', 'numeric');
      
      input.oninput = function(e) {
        const cursorStart = this.selectionStart;
        const oldLength = this.value.length;
        
        const formatted = LinsoraUtils.formatCurrencyInput(this.value);
        this.value = formatted;

        // Preservar posição do cursor de digitação
        const newLength = this.value.length;
        let newCursor = cursorStart + (newLength - oldLength);
        if (newCursor < 0) newCursor = 0;
        this.setSelectionRange(newCursor, newCursor);
      };

      input.onblur = function() {
        if (this.value && !this.value.includes(',')) {
          this.value = LinsoraUtils.formatCurrencyInput(this.value);
        }
      };
    });
  },

  /**
   * Formata data ISO (AAAA-MM-DD) para padrão brasileiro (DD/MM/AAAA)
   */
  formatDateBR(dateString) {
    if (!dateString) return '';
    const cleanDate = this.escapeHTML(dateString);
    const parts = cleanDate.split('-');
    if (parts.length < 3) return cleanDate;
    const [year, month, day] = parts;
    return `${day}/${month}/${year}`;
  },

  /**
   * Formata data por extenso (Ex: 05 de Agosto)
   */
  formatDateLong(dateString) {
    if (!dateString) return '';
    const cleanDate = this.escapeHTML(dateString);
    const date = new Date(cleanDate + 'T00:00:00');
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
  },
  /**
   * Traduz termos técnicos internos de Repetição/Recorrência para o Português
   * Evita a exibição de strings como "SINGLE", "single", "MONTHLY", "recurring", etc.
   */
  translateRepetition(rep) {
    if (!rep) return 'Única';
    const str = String(rep).toUpperCase().trim();
    const map = {
      'SINGLE': 'Única',
      'UNICA': 'Única',
      'MONTHLY': 'Mensal',
      'MENSAL': 'Mensal',
      'PARCELED': 'Parcelada',
      'PARCELADO': 'Parcelada',
      'RECURRING': 'Recorrente',
      'RECURRING_MONTHLY': 'Recorrente Mensal',
      'WEEKLY': 'Semanal',
      'DAILY': 'Diário',
      'YEARLY': 'Anual',
      'ANNUAL': 'Anual'
    };
    return map[str] || (str.charAt(0) + str.slice(1).toLowerCase());
  },

  /**
   * Traduz termos técnicos internos de Tipo de Operação para Português
   */
  translateType(type) {
    if (!type) return 'Despesa';
    const str = String(type).toUpperCase().trim();
    if (str === 'RECEITA' || str === 'INCOME') return 'Receita';
    if (str === 'DESPESA' || str === 'EXPENSE') return 'Despesa';
    return str.charAt(0) + str.slice(1).toLowerCase();
  },

  /**
   * Traduz termos técnicos internos de Tipo de Conta Bancária para Português
   */
  translateAccountType(accType) {
    if (!accType) return 'Conta Corrente';
    const str = String(accType).toUpperCase().trim();
    const map = {
      'CORRENTE': 'Conta Corrente',
      'CHECKING': 'Conta Corrente',
      'POUPANCA': 'Poupança',
      'SAVINGS': 'Poupança',
      'INVESTIMENTO': 'Investimentos',
      'INVESTMENT': 'Investimentos',
      'CARTEIRA': 'Carteira Física',
      'CASH': 'Dinheiro',
      'CREDIT': 'Cartão de Crédito',
      'CREDIT_CARD': 'Cartão de Crédito'
    };
    return map[str] || str;
  },

  /**
   * Traduz termos técnicos internos de Status para Português
   */
  translateStatus(status) {
    if (!status) return 'Concluído';
    const str = String(status).toUpperCase().trim();
    const map = {
      'PAID': 'Paga',
      'OPEN': 'Aberta',
      'OVERDUE': 'Vencida',
      'PENDING': 'Pendente',
      'SUCCESS': 'Concluído',
      'SINGLE': 'Única'
    };
    return map[str] || str;
  },

  /**
   * Retorna a cor característica de cada categoria de gasto
   */
  getCategoryColor(category) {
    const map = {
      'Alimentação': '#F59E0B',
      'Moradia': '#3B82F6',
      'Transporte': '#06B6D4',
      'Lazer': '#EC4899',
      'Saúde': '#EF4444',
      'Salário': '#10B981',
      'Investimentos': '#8B5CF6',
      'Outros': '#64748B'
    };
    return map[category] || '#64748B';
  },

  /**
   * Retorna o ícone da categoria
   */
  getCategoryIcon(category) {
    const map = {
      'Alimentação': '🛒',
      'Moradia': '🏠',
      'Transporte': '🚗',
      'Lazer': '🎉',
      'Saúde': '🏥',
      'Salário': '💼',
      'Investimentos': '📈',
      'Outros': '📦'
    };
    return map[category] || '📦';
  },

  /**
   * Lista oficial de categorias predefinidas
   */
  getCategoriesByType(type) {
    if (type === 'RECEITA') {
      return ['Salário', 'Investimentos', 'Freelance', 'Venda', 'Outros'];
    }
    return ['Alimentação', 'Moradia', 'Transporte', 'Lazer', 'Saúde', 'Educação', 'Outros'];
  },

  /**
   * Exibe mensagens Toast de Notificação
   */
  showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icon = type === 'error' ? '❌' : type === 'info' ? 'ℹ️' : '✅';
    toast.innerHTML = `<span>${icon}</span> <span>${this.escapeHTML(message)}</span>`;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  },

  /**
   * Gerador de Relatório Financeiro PDF Profissional Seguro
   */
  generatePDFReport(state) {
    const printArea = document.getElementById('pdfPrintTemplate');
    if (!printArea) return;

    const totalWorth = window.linsoraStore.getTotalNetWorth();
    const income = window.linsoraStore.getMonthIncome();
    const expense = window.linsoraStore.getMonthExpense();

    const safeUserName = this.escapeHTML(state.user.name);

    const txRowsHTML = state.transactions.map(t => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #E2E8F0;">${this.formatDateBR(t.date)}</td>
        <td style="padding: 8px; border-bottom: 1px solid #E2E8F0; font-weight: 600;">${this.escapeHTML(t.description)}</td>
        <td style="padding: 8px; border-bottom: 1px solid #E2E8F0;">${this.escapeHTML(t.category)}</td>
        <td style="padding: 8px; border-bottom: 1px solid #E2E8F0;">${this.escapeHTML(t.account)}</td>
        <td style="padding: 8px; border-bottom: 1px solid #E2E8F0; text-align: right; color: ${t.type === 'RECEITA' ? '#059669' : '#0F172A'}; font-weight: 700;">
          ${t.type === 'RECEITA' ? '+' : '-'} ${this.formatBRL(t.amount)}
        </td>
      </tr>
    `).join('');

    printArea.innerHTML = `
      <div style="font-family: Arial, sans-serif; padding: 40px; color: #0F172A; max-width: 800px; margin: 0 auto; background: #FFF;">
        
        <!-- Header do Relatório -->
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #059669; padding-bottom: 20px; margin-bottom: 30px;">
          <div>
            <h1 style="margin: 0; color: #059669; font-size: 28px; font-weight: 800; letter-spacing: 1px;">LINSORA</h1>
            <p style="margin: 4px 0 0 0; color: #64748B; font-size: 14px;">Relatório de Saúde Financeira Pessoal</p>
          </div>
          <div style="text-align: right;">
            <p style="margin: 0; font-weight: 700;">Emissão: ${new Date().toLocaleDateString('pt-BR')}</p>
            <p style="margin: 4px 0 0 0; color: #64748B; font-size: 13px;">Titular: ${safeUserName}</p>
          </div>
        </div>

        <!-- Resumo Patrimonial -->
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 30px;">
          <div style="background: #F8FAFC; padding: 16px; border-radius: 8px; border: 1px solid #E2E8F0;">
            <span style="font-size: 12px; color: #64748B;">Patrimônio Líquido</span>
            <h3 style="margin: 4px 0 0 0; font-size: 20px; color: #059669;">${this.formatBRL(totalWorth)}</h3>
          </div>
          <div style="background: #F8FAFC; padding: 16px; border-radius: 8px; border: 1px solid #E2E8F0;">
            <span style="font-size: 12px; color: #64748B;">Receitas do Mês</span>
            <h3 style="margin: 4px 0 0 0; font-size: 20px; color: #10B981;">${this.formatBRL(income)}</h3>
          </div>
          <div style="background: #F8FAFC; padding: 16px; border-radius: 8px; border: 1px solid #E2E8F0;">
            <span style="font-size: 12px; color: #64748B;">Despesas do Mês</span>
            <h3 style="margin: 4px 0 0 0; font-size: 20px; color: #EF4444;">${this.formatBRL(expense)}</h3>
          </div>
        </div>

        <!-- Tabela de Movimentações -->
        <h2 style="font-size: 18px; margin-bottom: 16px; border-bottom: 1px solid #CBD5E1; padding-bottom: 8px;">Detalhamento de Transações</h2>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
          <thead>
            <tr style="background: #F1F5F9; text-align: left;">
              <th style="padding: 8px;">Data</th>
              <th style="padding: 8px;">Descrição</th>
              <th style="padding: 8px;">Categoria</th>
              <th style="padding: 8px;">Conta/Cartão</th>
              <th style="padding: 8px; text-align: right;">Valor (R$)</th>
            </tr>
          </thead>
          <tbody>
            ${txRowsHTML}
          </tbody>
        </table>

        <!-- Rodapé do PDF -->
        <div style="margin-top: 40px; text-align: center; border-top: 1px solid #E2E8F0; padding-top: 16px; font-size: 11px; color: #94A3B8;">
          Documento gerado automaticamente pelo LINSORA Finances — Sistema Comercial de Gestão Inteligente.
        </div>

      </div>
    `;

    // Acionar diálogo de impressão/salvamento PDF
    printArea.style.display = 'block';
    window.print();
    setTimeout(() => {
      printArea.style.display = 'none';
    }, 1000);
  }
};

window.LinsoraUtils = LinsoraUtils;
