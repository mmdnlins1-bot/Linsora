/**
 * ============================================================================
 * LINSORA — SELETOR DE CARTÃO (card-picker.js) — Bloco C
 * Modal pequeno e reutilizável para compra com cartão genérico/ambíguo.
 * Usado pelo Voice Assistant e pelo Conselheiro. Somente apresentação +
 * seleção por cardId; nenhuma regra financeira vive aqui (limite é
 * calculado pelo store via getCardAvailableLimit/getEligibleCards).
 * ============================================================================
 */

(function () {
  const MODAL_ID = 'modalCardPicker';
  const LIST_ID = 'cardPickerList';
  const AMOUNT_ID = 'cardPickerAmount';

  let pending = null;

  function esc(v) {
    if (window.LinsoraUtils?.escapeHTML) return window.LinsoraUtils.escapeHTML(v ?? '');
    return String(v ?? '');
  }

  function fmtBRL(v) {
    if (window.LinsoraUtils?.formatBRL) return window.LinsoraUtils.formatBRL(v);
    return `R$ ${Number(v || 0).toFixed(2)}`;
  }

  function close() {
    pending = null;
    const list = document.getElementById(LIST_ID);
    if (list) list.innerHTML = '';
    if (window.LinsoraUI?.closeModal) window.LinsoraUI.closeModal(MODAL_ID);
    else document.getElementById(MODAL_ID)?.classList.add('hidden');
  }

  /**
   * Abre o modal de seleção.
   * @param {Object} opts { amount:number, cards:Array, eligibleIds:Array<string>|null,
   *   onSelect:function(cardId), onCancel:function() }
   * Quando eligibleIds é null, usa getEligibleCards(amount) do store.
   */
  function open(opts = {}) {
    const amount = Number(opts.amount);
    const store = window.linsoraStore;
    const cards = Array.isArray(opts.cards) ? opts.cards : (store?.state?.cards || []);
    let eligibleSet = null;
    if (Array.isArray(opts.eligibleIds)) {
      eligibleSet = new Set(opts.eligibleIds);
    } else if (store?.getEligibleCards && amount > 0) {
      eligibleSet = new Set(store.getEligibleCards(amount).map((c) => c.id));
    }

    pending = { amount, onSelect: opts.onSelect || null, onCancel: opts.onCancel || null };

    const amountEl = document.getElementById(AMOUNT_ID);
    if (amountEl) amountEl.textContent = Number.isFinite(amount) && amount > 0 ? fmtBRL(amount) : '—';

    const list = document.getElementById(LIST_ID);
    if (list) {
      list.innerHTML = '';
      if (!cards.length) {
        const empty = document.createElement('p');
        empty.className = 'card-picker-empty';
        empty.textContent = 'Nenhum cartão cadastrado.';
        list.appendChild(empty);
      }
      cards.forEach((card) => {
        const available = store?.getCardAvailableLimit
          ? store.getCardAvailableLimit(card)
          : Math.max(0, (Number(card.limitTotal) || 0) - (Number(card.limitUsed) || 0));
        const eligible = eligibleSet ? eligibleSet.has(card.id) : available >= amount;
        const item = document.createElement('div');
        item.className = 'card-picker-item' + (eligible ? '' : ' disabled');
        item.setAttribute('data-card-id', card.id);

        // Bloco D2-A: apresentação "Disponível / R$ X / [Nome]".
        // O nome do cartão é o elemento de ação (sem texto genérico
        // "Selecionar"). Regras de elegibilidade intactas: inelegível não
        // recebe botão e exibe o motivo. Formatação via formatBRL.
        const availLabel = document.createElement('span');
        availLabel.className = 'card-picker-avail-label';
        availLabel.textContent = 'Disponível';
        item.appendChild(availLabel);

        const avail = document.createElement('strong');
        avail.className = 'card-picker-avail';
        avail.textContent = fmtBRL(available);
        item.appendChild(avail);

        if (eligible) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'linsora-btn primary block card-picker-select';
          btn.setAttribute('data-card-id', card.id);
          btn.setAttribute('aria-label', `Usar cartão ${card.name || 'Cartão'}`);
          btn.textContent = card.name || 'Cartão';
          btn.addEventListener('click', () => {
            const cb = pending?.onSelect;
            const id = card.id;
            close();
            if (typeof cb === 'function') cb(id);
          });
          item.appendChild(btn);
        } else {
          const name = document.createElement('span');
          name.className = 'card-picker-name disabled';
          name.textContent = card.name || 'Cartão';
          item.appendChild(name);

          const warn = document.createElement('span');
          warn.className = 'card-picker-no-limit';
          warn.textContent = 'Sem limite suficiente';
          item.appendChild(warn);
        }
        list.appendChild(item);
      });
    }

    if (window.LinsoraUI?.openModal) window.LinsoraUI.openModal(MODAL_ID);
    else document.getElementById(MODAL_ID)?.classList.remove('hidden');
  }

  function cancel() {
    const cb = pending?.onCancel;
    close();
    if (typeof cb === 'function') cb();
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btnCardPickerCancel')?.addEventListener('click', cancel);
    document.getElementById('btnCardPickerClose')?.addEventListener('click', cancel);
    document.getElementById(MODAL_ID)?.addEventListener('click', (e) => {
      if (e.target && e.target.id === MODAL_ID) cancel();
    });
  });

  window.LinsoraCardPicker = { open, close, cancel };
})();
