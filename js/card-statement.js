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

  /**
   * Abre o extrato SOMENTE do cartão informado (nunca cards[0] implícito:
   * o chamador passa o selectedCardId explícito).
   */
  function open(cardId) {
    const store = window.linsoraStore;
    const card = (store?.state?.cards || []).find((c) => c.id === cardId);
    if (!card) {
      if (window.LinsoraUI?.showToast) window.LinsoraUI.showToast('Selecione um cartão para ver o extrato.', 'info');
      return;
    }
    const txs = store?.getCardTransactions ? store.getCardTransactions(card.id) : [];
    const hideValues = store ? store.isHideValues : false;

    const titleEl = document.getElementById(TITLE_ID);
    if (titleEl) titleEl.textContent = `Extrato — ${card.name || 'Cartão'}`;

    const totalEl = document.getElementById(TOTAL_ID);
    if (totalEl) {
      const total = txs.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
      totalEl.textContent = `${txs.length === 1 ? '1 lançamento' : `${txs.length} lançamentos`} • Total ${fmtBRL(total)}`;
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

    if (window.LinsoraUI?.openModal) window.LinsoraUI.openModal(MODAL_ID);
    else document.getElementById(MODAL_ID)?.classList.remove('hidden');
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btnCardStatementClose')?.addEventListener('click', close);
    document.getElementById('btnCardStatementOk')?.addEventListener('click', close);
    document.getElementById(MODAL_ID)?.addEventListener('click', (e) => {
      if (e.target && e.target.id === MODAL_ID) close();
    });
  });

  window.LinsoraCardStatement = { open, close };
})();
