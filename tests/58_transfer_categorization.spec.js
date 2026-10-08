const { test, expect } = require('@playwright/test');

// 58. Categorização de Transferência e Pix (comportamento REAL do código).
// Parser + store carregados de verdade com stubs mínimos. Sem backend real.

function bootParser() {
  global.window = global.window || {};
  global.window.TransactionAIParser = undefined;
  try { delete require.cache[require.resolve('../js/ai-transaction-parser.js')]; } catch (e) { /* primeira carga */ }
  try { delete require.cache[require.resolve('../js/utils.js')]; } catch (e) { /* primeira carga */ }
  require('../js/utils.js');
  global.LinsoraUtils = global.window.LinsoraUtils;
  require('../js/ai-transaction-parser.js');
  return global.window.TransactionAIParser;
}

function bootStore() {
  global.window = { addEventListener: () => {} };
  const mem = new Map();
  global.localStorage = {
    getItem: (k) => (mem.has(String(k)) ? mem.get(String(k)) : null),
    setItem: (k, v) => mem.set(String(k), String(v)),
    removeItem: (k) => mem.delete(String(k)),
    clear: () => mem.clear(),
    key: (i) => [...mem.keys()][i] ?? null,
    get length() { return mem.size; },
  };
  global.document = { querySelectorAll: () => [] };
  for (const rel of ['../js/supabase-client.js', '../js/store.js', '../js/utils.js', '../js/ai-transaction-parser.js']) {
    try { delete require.cache[require.resolve(rel)]; } catch (e) { /* primeira carga */ }
  }
  require('../js/supabase-client.js');
  require('../js/store.js');
  require('../js/utils.js');
  require('../js/ai-transaction-parser.js');
  global.LinsoraUtils = global.window.LinsoraUtils;
  const repo = new global.window.supabaseRepo.constructor();
  global.window.supabaseRepo = repo;
  repo.config = { url: '', key: '', isConnected: false };
  repo.supabase = null;
  return { repo, store: global.window.linsoraStore };
}

function emptyState(uid) {
  return {
    user: { id: uid, name: 'U', email: 'u@exemplo.com' },
    accounts: [{ id: 'acc-1', userId: uid, name: 'Banco', type: 'CORRENTE', balance: 1000 }],
    cards: [], pixKeys: [], goals: [], fixedBills: [],
    recurringBills: [], occurrences: [], transactions: [],
  };
}

test.describe('58. Transferência e Pix', () => {
  test('1-4. transferência explícita → Transferência', async () => {
    const parser = bootParser();
    for (const text of [
      'transferi 50 reais para João',
      'transferência de 50 para João',
      'mandei 50 reais para João',
      'enviei 50 para Maria',
      'transferi 100 para Maria',
    ]) {
      const r = parser.parseText(text);
      expect(r.category, text).toBe('Transferência');
      expect(r.type, text).toBe('DESPESA');
    }
  });

  test('5-7. pix para pessoa → Transferência', async () => {
    const parser = bootParser();
    for (const text of [
      'Pix de 50 reais para João',
      'fiz um Pix de 50 para João',
      'mandei um Pix de 50 para Maria',
      'Pix para Maria',
    ]) {
      const r = parser.parseText(text);
      expect(r.category, text).toBe('Transferência');
    }
  });

  test('8-10. pix em estabelecimento NÃO vira Transferência', async () => {
    const parser = bootParser();
    expect(parser.parseText('Pix de 50 no supermercado').category).toBe('Alimentação');
    expect(parser.parseText('paguei 100 no posto via Pix').category).toBe('Transporte');
    expect(parser.parseText('Pix na farmácia').category).toBe('Saúde');
  });

  test('CUIDADO: "para comprar comida" não vira Transferência', async () => {
    const parser = bootParser();
    expect(parser.parseText('gastei 50 reais para comprar comida').category).toBe('Alimentação');
  });

  test('11. executePixTransfer cria Transferência', async () => {
    const { store } = bootStore();
    store.state = emptyState('usr_teste_pix');
    await store.executePixTransfer('João', 50, 'Banco');
    expect(store.state.transactions).toHaveLength(1);
    expect(store.state.transactions[0].category).toBe('Transferência');
    expect(store.state.transactions[0].description).toContain('João');
  });

  test('12-13. compra normal e cartão inalterados', async () => {
    const parser = bootParser();
    expect(parser.parseText('comprei arroz no mercado').category).toBe('Alimentação');
    const card = parser.detectCardUsage('paguei a fatura do nubank');
    expect(card.isCardPayment).toBe(true);
  });

  test('14-15. fatura continua Outros; fallback Outros preservado', async () => {
    const { store } = bootStore();
    store.state = emptyState('usr_teste_fatura');
    store.state.cards.push({ id: 'card-1', userId: 'usr_teste_fatura', name: 'Nubank', limitTotal: 1000, limitUsed: 200 });
    await store.payCardInvoice('card-1');
    expect(store.state.transactions[0].category).toBe('Outros');
    const parser = bootParser();
    expect(parser.parseText('gastei com algo completamente estranho xyz').category).toBe('Outros');
  });

  test('16-18. sync usa mesma categoria; UUID e userId intactos', async () => {
    const { repo, store } = bootStore();
    const sent = [];
    repo.config = { url: 'https://x.supabase.co', key: 'k', isConnected: true };
    repo.supabase = {
      auth: { getSession: async () => ({ data: { session: null }, error: null }) },
      from: () => ({
        select: () => { const p = (async () => ({ data: [], error: null }))(); p.order = () => p; return p; },
        upsert: async (rows) => { sent.push(...rows); return { error: null }; },
      }),
    };
    const UID = '33333333-4444-4555-8666-777777777777';
    store.state = emptyState(UID);
    await store.saveTransaction({ type: 'DESPESA', description: 'Pix para João', amount: 50, category: 'Transferência', date: '2026-10-08', account: 'Banco' });
    const tx = sent.find((r) => r.description === 'Pix para João');
    expect(tx).toBeTruthy();
    expect(tx.category).toBe('Transferência');
    expect(tx.user_id).toBe(UID);
    expect(/^[0-9a-f-]{36}$/i.test(tx.id)).toBe(true);
  });
});
