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
   * Data local atual no formato YYYY-MM-DD (sem UTC, sem deslocamento de dia).
   * Aceita um Date opcional para testes determinísticos.
   * Ex.: 01/09/2026 00:30 no Brasil produz '2026-09-01', nunca '2026-08-31'.
   */
  toLocalDateKey(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  /**
   * Prende um dia do mês ao tamanho real do mês (calendário local).
   * Ex.: due_day 31 em fevereiro/2026 -> 28; em abril -> 30.
   */
  clampDayOfMonth(year, monthIndex0, day) {
    const monthLen = new Date(year, monthIndex0 + 1, 0).getDate();
    return Math.min(Math.max(1, parseInt(day, 10) || 1), monthLen);
  },

  /**
   * Gera um UUID v4 (RFC 4122) compatível com colunas UUID do Supabase.
   * Usa crypto.randomUUID quando disponível; senão crypto.getRandomValues;
   * por último, fallback com Math.random (sem formato proprietário).
   */
  generateUUID() {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
    } catch (e) { /* usa os fallbacks abaixo */ }
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        const b = crypto.getRandomValues(new Uint8Array(16));
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
      }
    } catch (e) { /* usa o fallback abaixo */ }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.floor(Math.random() * 16);
      const v = c === 'x' ? r : ((r & 0x3) | 0x8);
      return v.toString(16);
    });
  },

  /**
   * Verifica se o valor é um UUID válido (aceito pelas colunas UUID do Supabase).
   */
  isUUID(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
  },

  /**
   * Gera ocorrências mensais de uma regra recorrente dentro de uma janela
   * [windowStartKey, windowEndKey] (chaves YYYY-MM-DD, comparação por string,
   * sem UTC). Pura e determinística. Aceita campos snake_case (remoto) e
   * camelCase (local). V1: somente frequency MONTHLY, regras ativas.
   */
  generateMonthlyOccurrences(rule, windowStartKey, windowEndKey) {
    if (!rule || rule.active === false) return [];
    if ((rule.frequency || 'MONTHLY') !== 'MONTHLY') return [];
    const dueDay = parseInt(rule.due_day ?? rule.dueDay, 10);
    if (!dueDay || dueDay < 1 || dueDay > 31) return [];
    const uid = rule.user_id ?? rule.userId;
    const billId = rule.id;
    if (!uid || !billId) return [];
    const amount = Number(rule.amount) || 0;
    if (amount <= 0) return [];
    const start = String(rule.start_date ?? rule.startDate ?? '');
    if (!/^\d{4}-\d{2}-\d{2}/.test(start)) return [];
    const endRaw = rule.end_date ?? rule.endDate ?? null;
    const end = endRaw ? String(endRaw).slice(0, 10) : null;
    if (!windowStartKey || !windowEndKey || windowEndKey < windowStartKey) return [];

    const out = [];
    let [y, m] = windowStartKey.split('-').map(Number);
    m = m - 1;
    const [ey, em0] = windowEndKey.split('-').map(Number);
    const endM = em0 - 1;
    let guard = 0;
    while ((y < ey || (y === ey && m <= endM)) && guard++ < 1200) {
      const d = this.clampDayOfMonth(y, m, dueDay);
      const due = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (due >= windowStartKey && due <= windowEndKey && due >= start.slice(0, 10) && (!end || due <= end)) {
        out.push({
          recurring_bill_id: billId,
          user_id: uid,
          due_date: due,
          expected_amount: amount,
        });
      }
      m += 1;
      if (m > 11) { m = 0; y += 1; }
    }
    return out;
  },

  /**
   * Próximo vencimento relevante de uma regra recorrente (puro, sem persistir).
   * Ordem: menor due_date PENDING >= hoje; senão a PENDING vencida mais
   * recente; senão (regra ativa) o próximo vencimento derivado da regra;
   * regra inativa sem PENDING retorna null (nada é inventado).
   * Retorna { dueDate, overdue, source } ou null.
   */
  nextBillDue(bill, occurrences = [], todayKey) {
    if (!bill) return null;
    const today = todayKey || this.toLocalDateKey();
    const list = (Array.isArray(occurrences) ? occurrences : [])
      .filter((o) => o && o.recurringBillId === bill.id && o.status === 'PENDING' && o.dueDate);
    const future = list
      .filter((o) => o.dueDate >= today)
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0];
    if (future) {
      return { dueDate: future.dueDate, overdue: false, source: 'occurrence' };
    }
    const overdue = list
      .filter((o) => o.dueDate < today)
      .sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1))[0];
    if (overdue) {
      return { dueDate: overdue.dueDate, overdue: true, source: 'occurrence' };
    }
    if (bill.active === false) return null;
    const dueDay = parseInt(bill.dueDay ?? bill.due_day, 10);
    if (!dueDay || dueDay < 1 || dueDay > 31) return null;
    const [ty, tm0] = today.split('-').map(Number);
    for (let step = 0; step < 36; step++) {
      const total = (tm0 - 1) + step;
      const y = ty + Math.floor(total / 12);
      const m = ((total % 12) + 12) % 12;
      const d = this.clampDayOfMonth(y, m, dueDay);
      const due = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (due < today) continue;
      const start = String(bill.startDate ?? bill.start_date ?? '').slice(0, 10);
      const endRaw = bill.endDate ?? bill.end_date ?? null;
      const end = endRaw ? String(endRaw).slice(0, 10) : null;
      if (start && due < start) continue;
      if (end && due > end) return null;
      return { dueDate: due, overdue: false, source: 'derived' };
    }
    return null;
  },

  /**
   * Data de vencimento de fatura elegível numa janela [start, end].
   * Retorna o MAIOR vencimento mensal dentro da janela; se não houver,
   * retorna o vencimento do mês anterior como carry de atraso, mas somente
   * quando a janela alcança passado/presente (start <= hoje). Janelas
   * estritamente futuras não herdam dívida passada. null = sem compromisso.
   */
  resolveInvoiceDueDate(dueDay, windowStartKey, windowEndKey, todayKey) {
    const dd = parseInt(dueDay, 10);
    if (!dd || dd < 1 || dd > 31) return null;
    if (!windowStartKey || !windowEndKey || windowEndKey < windowStartKey) return null;
    const today = todayKey || this.toLocalDateKey();
    const clampDue = (y, m) => {
      const d = this.clampDayOfMonth(y, m, dd);
      return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    };
    const [sy, sm0] = windowStartKey.split('-').map(Number);
    const [ey, em0] = windowEndKey.split('-').map(Number);
    let y = sy;
    let m = sm0 - 1;
    let latestInWin = null;
    let latestPast = null;
    let guard = 0;
    while ((y < ey || (y === ey && m <= em0 - 1)) && guard++ < 1200) {
      const due = clampDue(y, m);
      if (due >= windowStartKey && due <= windowEndKey) {
        latestInWin = due;
      } else if (due < windowStartKey && due <= windowEndKey && (!latestPast || due > latestPast)) {
        latestPast = due;
      }
      m += 1;
      if (m > 11) { m = 0; y += 1; }
    }
    if (latestInWin) return latestInWin;
    if (latestPast && windowStartKey <= today) return latestPast;
    if (windowStartKey <= today) {
      let py = sy;
      let pm = sm0 - 2;
      if (pm < 0) { pm = 11; py = sy - 1; }
      return clampDue(py, pm);
    }
    return null;
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
      'Transferência': '💸',
      'Pix': '💸',
      'Serviços': '⚙️',
      'Compras': '🛍️',
      'Educação': '🎓',
      'Outros': '📦'
    };
    return map[category] || '📦';
  },

  /**
   * Lista oficial de categorias predefinidas
   */
  getCategoriesByType(type) {
    if (type === 'RECEITA') {
      return ['Salário', 'Investimentos', 'Transferência', 'Freelance', 'Venda', 'Outros'];
    }
    return ['Alimentação', 'Moradia', 'Transporte', 'Lazer', 'Saúde', 'Transferência', 'Educação', 'Outros'];
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
  },

  /**
   * Redimensiona e comprime imagem selecionada via Canvas
   */
  processAndCompressImage(file, maxWidth = 300, maxHeight = 300, quality = 0.8) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;

            if (width > height) {
              if (width > maxWidth) {
                height = Math.round((height * maxWidth) / width);
                width = maxWidth;
              }
            } else {
              if (height > maxHeight) {
                width = Math.round((width * maxHeight) / height);
                height = maxHeight;
              }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Failed to get 2d context');
            
            ctx.drawImage(img, 0, 0, width, height);

            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            if (!dataUrl || dataUrl === 'data:,') throw new Error('Canvas failed');
            resolve(dataUrl);
          } catch (e) {
            console.warn('Canvas toDataURL failed (Headless?), fallback to original', e);
            resolve(event.target.result);
          }
        };
        img.onerror = (err) => {
          console.warn('img.onerror triggered (Headless?), fallback to original', err);
          resolve(event.target.result);
        };
        img.src = event.target.result;
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  },

  /**
   * Converte Data URI / Base64 para Blob para upload via HTTP / Storage
   */
  dataURItoBlob(dataURI) {
    const byteString = atob(dataURI.split(',')[1]);
    const mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], { type: mimeString });
  }
};

window.LinsoraUtils = LinsoraUtils;
