const { test, expect } = require('@playwright/test');

// 56. UUIDs na origem + sync remoto íntegro (comportamento REAL do código).
// Fake Supabase que impõe PK UUID como o PostgREST (rejeita id inválido).
// Sem backend real, sem credenciais.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_REAL = '22222222-3333-4444-8555-666666666666';
const fs = require('fs');
const path = require('path');

function boot() {
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
  for (const rel of ['../js/supabase-client.js', '../js/store.js', '../js/utils.js']) {
    try { delete require.cache[require.resolve(rel)]; } catch (e) { /* primeira carga */ }
  }
  require('../js/supabase-client.js');
  require('../js/store.js');
  require('../js/utils.js');
  global.LinsoraUtils = global.window.LinsoraUtils;
  const repo = new global.window.supabaseRepo.constructor();
  global.window.supabaseRepo = repo;
  repo.config = { url: 'https://supabase-ficticia-uuid.supabase.co', key: 'anon-ficticia', isConnected: true };
  return { repo, store: global.window.linsoraStore };
}

function emptyState(uid) {
  return {
    user: { id: uid, name: 'U', email: 'u@exemplo.com' },
    accounts: [], cards: [], pixKeys: [], goals: [], fixedBills: [],
    recurringBills: [], occurrences: [], transactions: [],
  };
}

// Fake que se comporta como o PostgREST real quanto a PK UUID.
function fakeBackend() {
  const db = { accounts: new Map(), transactions: new Map(), cards: new Map(), goals: new Map(), pix_keys: new Map() };
  const sent = [];
  const tableOf = { accounts: 'accounts', transactions: 'transactions', cards: 'cards', goals: 'goals', pix_keys: 'pix_keys' };
  return {
    db, sent,
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithPassword: async ({ email }) => ({ data: { user: { id: UUID_REAL, email } }, error: null }),
    },
    from: (table) => ({
      select: () => ({
        eq: () => {
          const run = async () => ({ data: [...((db[tableOf[table]] || new Map()).values())], error: null });
          const p = run();
          p.order = () => p;
          return p;
        },
      }),
      upsert: async (rows) => {
        const bad = (Array.isArray(rows) ? rows : [rows]).filter((r) => !UUID_RE.test(String(r && r.id || '')));
        if (bad.length > 0) return { error: { message: 'invalid input syntax for type uuid' } };
        for (const r of (Array.isArray(rows) ? rows : [rows])) {
          sent.push({ table, id: r.id });
          if (db[tableOf[table]]) db[tableOf[table]].set(r.id, r);
        }
        return { error: null };
      },
    }),
  };
}

test.describe('56. UUIDs na origem e sync íntegro', () => {
  test('1. fábricas geram UUID válido (tx, conta, pix, cartão, meta, pagamento)', async () => {
    const { store } = boot();
    store.state = emptyState(UUID_REAL);
    await store.saveTransaction({ type: 'RECEITA', description: 'Salário', amount: 5000, category: 'Salário', date: '2026-10-01', account: 'Conta' });
    await store.addAccount({ name: 'Banco', type: 'CORRENTE', balance: 0 });
    await store.addPixKey('EMAIL', 'a@exemplo.com', 'Nubank');
    await store.addCard({ name: 'Cartão', brand: 'Visa', limitTotal: 1000, closingDay: 10, dueDay: 20 });
    await store.addGoal({ title: 'Reserva', target: 1000 });
    const ids = [
      store.state.transactions[0].id,
      store.state.accounts[0].id,
      store.state.pixKeys[0].id,
      store.state.cards[0].id,
      store.state.goals[0].id,
    ];
    for (const id of ids) expect(UUID_RE.test(id)).toBe(true);
  });

  test('2. IDs consecutivos são distintos', async () => {
    const { store } = boot();
    store.state = emptyState(UUID_REAL);
    const seen = new Set();
    for (let i = 0; i < 5; i += 1) {
      await store.saveTransaction({ type: 'DESPESA', description: `D${i}`, amount: 1, category: 'X', date: '2026-10-01', account: 'C' });
      seen.add(store.state.transactions[0].id);
    }
    expect(seen.size).toBe(5);
  });

  test('3/5. legado nunca é enviado; vira legacyPending sem falhar o sync', async () => {
    const { repo } = boot();
    const fake = fakeBackend();
    repo.supabase = fake;
    const data = emptyState(UUID_REAL);
    data.transactions.push({ id: 'tx_123456', userId: UUID_REAL, type: 'RECEITA', description: 'Legada', amount: 100, category: 'X', date: '2026-10-01', account: 'C', status: 'CONCLUIDO' });
    data.accounts.push({ id: 'acc_999', userId: UUID_REAL, name: 'Velha', type: 'CORRENTE', balance: 10 });
    const res = await repo.syncToSupabaseRemote(data, UUID_REAL);
    const financial = fake.sent.filter((s) => s.table !== 'profiles');
    expect(financial).toHaveLength(0);
    expect(res.success).toBe(true);
    expect(res.errors).toHaveLength(0);
    expect(res.legacyPending.join(' | ')).toContain('migração pendente');
  });

  test('regressão: UUID novo + 2 legados → synced:true, pendência separada, toast de sucesso', async () => {
    const { repo, store } = boot();
    const fake = fakeBackend();
    repo.supabase = fake;
    store.state = emptyState(UUID_REAL);
    store.state.transactions.push(
      { id: 'tx_legada_1', userId: UUID_REAL, type: 'DESPESA', description: 'Antiga 1', amount: 5, category: 'X', date: '2026-09-01', account: 'C', status: 'CONCLUIDO' },
      { id: 'tx_legada_2', userId: UUID_REAL, type: 'DESPESA', description: 'Antiga 2', amount: 7, category: 'X', date: '2026-09-02', account: 'C', status: 'CONCLUIDO' }
    );
    const res = await store.saveTransaction({ type: 'RECEITA', description: 'Salário', amount: 7500, category: 'Salário', date: '2026-10-08', account: 'Banco' });
    expect(res.saved).toBe(true);
    expect(res.synced).toBe(true);
    expect(res.syncErrors).toHaveLength(0);
    expect(res.legacyPending.join(' | ')).toContain('migração pendente');
    // O registro novo chegou; legados, jamais.
    const txRows = fake.sent.filter((s) => s.table === 'transactions');
    expect(txRows).toHaveLength(1);
    expect(UUID_RE.test(txRows[0].id)).toBe(true);
    // Decisão da UI (mesma condição de app.js): sucesso, sem toast de falha.
    const backendOn = true;
    const showPending = res.synced === false && backendOn;
    expect(showPending).toBe(false);
  });

  test('regressão: conta e cartão seguem o mesmo contrato', async () => {
    const { repo, store } = boot();
    const fake = fakeBackend();
    repo.supabase = fake;
    store.state = emptyState(UUID_REAL);
    store.state.accounts.push({ id: 'acc_legada', userId: UUID_REAL, name: 'Velha', type: 'CORRENTE', balance: 1 });
    const accRes = await store.addAccount({ name: 'Banco Novo', type: 'CORRENTE', balance: 100 });
    expect(accRes.synced).toBe(true);
    expect(accRes.legacyPending.join(' | ')).toContain('accounts');
    const cardRes = await store.addCard({ name: 'Cartão Novo', brand: 'Visa', limitTotal: 1000, closingDay: 10, dueDay: 20 });
    expect(cardRes.synced).toBe(true);
    expect(cardRes.syncErrors).toHaveLength(0);
  });

  test('erro real: upsert rejeitado → synced:false e toast de falha', async () => {
    const { repo, store } = boot();
    repo.supabase = {
      auth: fakeBackend().auth,
      from: () => ({
        select: () => {
          const p = (async () => ({ data: [], error: null }))();
          p.order = () => p;
          return p;
        },
        upsert: async () => ({ error: { message: 'negado-pelo-servidor-ficticio' } }),
      }),
    };
    store.state = emptyState(UUID_REAL);
    const res = await store.saveTransaction({ type: 'RECEITA', description: 'Salário', amount: 100, category: 'X', date: '2026-10-01', account: 'C' });
    expect(res.saved).toBe(true);
    expect(res.synced).toBe(false);
    expect(res.syncErrors.join(' | ')).toContain('negado-pelo-servidor-ficticio');
    const showPending = res.synced === false && true;
    expect(showPending).toBe(true);
  });

  test('4. registro novo com UUID chega ao Supabase com id válido', async () => {
    const { repo, store } = boot();
    const fake = fakeBackend();
    repo.supabase = fake;
    store.state = emptyState(UUID_REAL);
    await store.saveTransaction({ type: 'RECEITA', description: 'Salário', amount: 7500, category: 'Salário', date: '2026-10-08', account: 'Banco' });
    const txRows = fake.sent.filter((s) => s.table === 'transactions');
    expect(txRows).toHaveLength(1);
    expect(UUID_RE.test(txRows[0].id)).toBe(true);
    expect(fake.db.transactions.has(txRows[0].id)).toBe(true);
  });

  test('6. falha remota retorna pendência, não "sucesso"', async () => {
    const { repo, store } = boot();
    repo.supabase = {
      auth: fakeBackend().auth,
      from: () => ({
        select: () => ({
          eq: () => {
            const p = (async () => ({ data: [], error: null }))();
            p.order = () => p;
            return p;
          },
        }),
        upsert: async () => { throw new Error('rede-ficticia'); },
      }),
    };
    store.state = emptyState(UUID_REAL);
    const res = await store.saveTransaction({ type: 'RECEITA', description: 'Salário', amount: 100, category: 'X', date: '2026-10-01', account: 'C' });
    expect(res.saved).toBe(true);
    expect(res.synced).toBe(false);
    expect(res.syncErrors.length).toBeGreaterThan(0);
  });

  test('7. modo local sem backend continua funcionando', async () => {
    const { repo, store } = boot();
    repo.config = { url: '', key: '', isConnected: false };
    repo.supabase = null;
    store.state = emptyState('usr_teste_12345678');
    const res = await store.saveTransaction({ type: 'RECEITA', description: 'Local', amount: 50, category: 'X', date: '2026-10-01', account: 'C' });
    expect(res.saved).toBe(true);
    expect(res.synced).toBe(true);
    expect(store.state.transactions).toHaveLength(1);
  });

  test('8. login Supabase continua funcionando (auth intacta)', async () => {
    const { repo } = boot();
    repo.supabase = fakeBackend();
    const res = await repo.signInWithEmail('alguem@exemplo.com', 'senha123');
    expect(res.success).toBe(true);
    expect(res.user.id).toBe(UUID_REAL);
  });

  test('regressão: salário criado → sync → novo contexto carrega o mesmo dado', async () => {
    // Contexto 1 (navegador): cria e sincroniza.
    const ctx1 = boot();
    ctx1.repo.supabase = fakeBackend();
    const sharedFake = ctx1.repo.supabase;
    ctx1.store.state = emptyState(UUID_REAL);
    await ctx1.store.saveTransaction({ type: 'RECEITA', description: 'Salário', amount: 7500, category: 'Salário', date: '2026-10-08', account: 'Banco' });
    expect(sharedFake.db.transactions.size).toBe(1);
    // Contexto 2 (PWA): mesma conta, backend compartilhado, cache zerado.
    const ctx2 = boot();
    ctx2.repo.supabase = sharedFake;
    await ctx2.store.loadUserData({ id: UUID_REAL, email: 'u@exemplo.com', name: 'U' });
    expect(ctx2.store.state.loadError ?? null).toBeNull();
    const found = ctx2.store.state.transactions.filter((t) => t.description === 'Salário');
    expect(found).toHaveLength(1);
    expect(Number(found[0].amount)).toBe(7500);
  });

  test('10. RLS/migrations e trial não modificados por esta tarefa', async () => {
    const root = path.resolve(__dirname, '..');
    const schema = fs.readFileSync(path.join(root, 'supabase_schema_rls.sql'), 'utf8');
    expect(schema).not.toContain('generateUUID');
    const trial = fs.readFileSync(path.join(root, 'supabase_migration_trial_24h.sql'), 'utf8');
    expect(trial).toContain('handle_new_trial');
    expect(trial).not.toContain('generateUUID');
  });
});
