/**
 * ============================================================================
 * LINSORA — EXTRATO DO CARTÃO (card-statement.js) — Bloco D2-B
 * Modal de extrato individual do cartão selecionado. Somente leitura:
 * usa store.getCardTransactions (vínculo cardId + fallback account +
 * isolamento por usuário). Reutiliza o visual .transaction-card e o
 * detalhe existente (openTxDetails). Sem regra financeira nova.
 * ============================================================================
 */

(function () {
  const MODAL_ID = 'modalCardStatement';
  const LIST_ID = 'cardStatementList';
  const TITLE_ID = 'cardStatementTitle';
  const TOTAL_ID = 'cardStatementTotal';
  const CYCLE_LABEL_ID = 'cardStatementCycleLabel';
  const PERIOD_ID = 'cardStatementPeriod';
  const PREV_ID = 'btnCardStatementPrev';
  const NEXT_ID = 'btnCardStatementNext';

  // Etapa 2: fatura selecionada = ano/mês do mês de fechamento.
  let currentCardId = null;
  let cycleYear = null;
  let cycleMonth = null;

  const MONTHS_PT = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];

  function esc(v) {
    if (window.LinsoraUtils?.escapeHTML) return window.LinsoraUtils.escapeHTML(v ?? '');
    return String(v ?? '');
  }

  function fmtBRL(v) {
    if (window.LinsoraUtils?.formatBRL) return window.LinsoraUtils.formatBRL(v);
    return `R$ ${Number(v || 0).toFixed(2)}`;
  }

  function fmtDate(d) {
    if (window.LinsoraUtils?.formatDateBR) return window.LinsoraUtils.formatDateBR(d);
    return String(d || '');
  }

  function iconFor(category) {
    if (window.LinsoraUtils?.getCategoryIcon) return window.LinsoraUtils.getCategoryIcon(category);
    return '💸';
  }

  function close() {
    const list = document.getElementById(LIST_ID);
    if (list) list.innerHTML = '';
    if (window.LinsoraUI?.closeModal) window.LinsoraUI.closeModal(MODAL_ID);
    else document.getElementById(MODAL_ID)?.classList.add('hidden');
  }

  function cycleLabel(y, m) {
    return `Fatura de ${MONTHS_PT[m] || ''}/${y}`;
  }

  function invoiceCycle(closingDay, y, m) {
    if (window.LinsoraUtils?.getInvoiceCycle) return window.LinsoraUtils.getInvoiceCycle(closingDay, y, m);
    return null;
  }

  function todayKey() {
    if (window.LinsoraUtils?.toLocalDateKey) return window.LinsoraUtils.toLocalDateKey();
    const d = new Date();
    const p = (v) => String(v).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  // Seleciona o ciclo que contém a data atual (mês corrente ou, se hoje já
  // passou do fechamento, o mês seguinte). Sem limite de navegação: anterior
  // e próxima apenas deslocam (ano, mês).
  function selectCycleContainingToday(card) {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const today = todayKey();
    const candidates = [{ y, m }, { y: m === 11 ? y + 1 : y, m: m === 11 ? 0 : m + 1 }];
    for (const c of candidates) {
      const cyc = invoiceCycle(card.closingDay, c.y, c.m);
      if (cyc && today >= cyc.start && today <= cyc.end) {
        cycleYear = c.y;
        cycleMonth = c.m;
        return;
      }
    }
    cycleYear = y;
    cycleMonth = m;
  }

  function shiftCycle(delta) {
    if (cycleYear === null || cycleMonth === null) return;
    let m = cycleMonth + delta;
    let y = cycleYear;
    while (m < 0) { m += 12; y -= 1; }
    while (m > 11) { m -= 12; y += 1; }
    cycleYear = y;
    cycleMonth = m;
    render();
  }

  function invoiceTxs(store, card, cyc) {
    if (!cyc) return [];
    if (store?.getCardTransactionsForInvoice) {
      return store.getCardTransactionsForInvoice(card.id, cyc.start, cyc.end) || [];
    }
    // Fallback defensivo (store sem a função da Etapa 2): mesma identidade +
    // filtro de ciclo local.
    const base = store?.getCardTransactions ? store.getCardTransactions(card.id) : [];
    return base
      .filter((t) => {
        const key = String(t.date || '').slice(0, 10);
        return /^\d{4}-\d{2}-\d{2}/.test(key) && key >= cyc.start && key <= cyc.end;
      })
      .sort((a, b) => (String(a.date).slice(0, 10) < String(b.date).slice(0, 10) ? 1 : -1));
  }

  function render() {
    const store = window.linsoraStore;
    const card = (store?.state?.cards || []).find((c) => c.id === currentCardId);
    if (!card) return;
    const cyc = invoiceCycle(card.closingDay, cycleYear, cycleMonth);
    const txs = invoiceTxs(store, card, cyc);
    const hideValues = store ? store.isHideValues : false;

    const titleEl = document.getElementById(TITLE_ID);
    if (titleEl) titleEl.textContent = `Extrato — ${card.name || 'Cartão'}`;

    const labelEl = document.getElementById(CYCLE_LABEL_ID);
    if (labelEl) labelEl.textContent = cycleLabel(cycleYear, cycleMonth);

    const periodEl = document.getElementById(PERIOD_ID);
    if (periodEl) periodEl.textContent = cyc ? `${fmtDate(cyc.start)} a ${fmtDate(cyc.end)}` : '—';

    const totalEl = document.getElementById(TOTAL_ID);
    if (totalEl) {
      const total = txs.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
      totalEl.textContent = `${txs.length === 1 ? '1 lançamento' : `${txs.length} lançamentos`} • Total da fatura: ${fmtBRL(total)}`;
    }

    const list = document.getElementById(LIST_ID);
    if (list) {
      if (!txs.length) {
        list.innerHTML = `
          <div class="empty-state-card">
            <div class="empty-icon">🧾</div>
            <p>Nenhum lançamento neste cartão</p>
            <span class="empty-sub">As compras feitas com ${esc(card.name)} aparecerão aqui.</span>
          </div>
        `;
      } else {
        list.innerHTML = txs.map((tx) => `
          <div class="transaction-card expense-card" role="button" tabindex="0" onclick="LinsoraUI.openTxDetails('${tx.id}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();LinsoraUI.openTxDetails('${tx.id}')}">
            <div class="tx-left">
              <div class="tx-icon-wrapper expense-glow">${iconFor(tx.category)}</div>
              <div class="tx-info">
                <span class="tx-title">${esc(tx.description)}</span>
                <span class="tx-meta">${esc(tx.category)} • ${esc(tx.account)} • ${fmtDate(tx.date)}</span>
              </div>
            </div>
            <div class="tx-right">
              <span class="tx-amount expense">- ${fmtBRL(tx.amount, hideValues)}</span>
              <span class="badge-status-chip danger">${esc(tx.status) || 'Concluído'}</span>
            </div>
          </div>
        `).join('');
      }
    }
  }

  /**
   * Abre o extrato SOMENTE do cartão informado (nunca cards[0] implícito:
   * o chamador passa o selectedCardId explícito), na fatura que contém hoje.
   */
  function open(cardId) {
    const store = window.linsoraStore;
    const card = (store?.state?.cards || []).find((c) => c.id === cardId);
    if (!card) {
      if (window.LinsoraUI?.showToast) window.LinsoraUI.showToast('Selecione um cartão para ver o extrato.', 'info');
      return;
    }
    currentCardId = card.id;
    selectCycleContainingToday(card);
    render();

    if (window.LinsoraUI?.openModal) window.LinsoraUI.openModal(MODAL_ID);
    else document.getElementById(MODAL_ID)?.classList.remove('hidden');
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btnCardStatementClose')?.addEventListener('click', close);
    document.getElementById('btnCardStatementOk')?.addEventListener('click', close);
    document.getElementById(PREV_ID)?.addEventListener('click', () => shiftCycle(-1));
    document.getElementById(NEXT_ID)?.addEventListener('click', () => shiftCycle(1));
    document.getElementById('btnCardStatementOk')?.addEventListener('click', close);
    document.getElementById(MODAL_ID)?.addEventListener('click', (e) => {
      if (e.target && e.target.id === MODAL_ID) close();
    });
  });

  window.LinsoraCardStatement = { open, close };
})();
