const { test, expect } = require('@playwright/test');

// 55. Integridade de sessão + erro de carga (comportamento REAL do código).
// Harness Node com globals stubbed (window/localStorage/document) carrega
// js/supabase-client.js, js/store.js e js/utils.js de verdade; Supabase é
// um fake injetado. Sem backend real, sem credenciais.

const FAKE_URL = 'https://supabase-ficticia-sessao.supabase.co';
const FAKE_KEY = 'anon-ficticia-para-testes';
const UUID_REAL = '11111111-2222-4333-8444-555555555555';
const FRIENDLY = 'Não foi possível conectar ao Linsora agora.';

function bootFreshRepo() {
  const store = new Map();
  global.window = { addEventListener: () => {} };
  global.localStorage = {
    getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
    setItem: (k, v) => store.set(String(k), String(v)),
    removeItem: (k) => store.delete(String(k)),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
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
  return { repo, store: global.window.linsoraStore };
}

function fakeSupabase({ session = null, rows = {}, failTables = [] } = {}) {
  const calls = { selects: [], upserts: 0 };
  const exec = async (table) => {
    calls.selects.push(table);
    if (failTables.includes(table) || failTables.includes('*')) {
      throw new Error('rede-ficticia-supabase');
    }
    return { data: rows[table] || [], error: null };
  };
  const makeQuery = (table) => {
    const p = exec(table);
    p.order = () => p;
    return p;
  };
  return {
    calls,
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      signInWithPassword: async ({ email }) => ({
        data: { user: { id: UUID_REAL, email } }, error: null,
      }),
    },
    from: (table) => ({
      select: () => ({ eq: () => makeQuery(table) }),
      upsert: async () => { calls.upserts += 1; return { error: null }; },
    }),
  };
}

function connectedConfig(repo) {
  repo.config = { url: FAKE_URL, key: FAKE_KEY, isConnected: true };
}

function seedCache(userId, txCount) {
  const txs = [];
  for (let i = 0; i < txCount; i += 1) {
    txs.push({ id: `tx-local-${i}`, userId, type: 'DESPESA', amount: 10, description: `T${i}`, category: 'X', date: '2026-10-01', account: 'C', status: 'CONCLUIDO' });
  }
  global.localStorage.setItem(`LINSORA_DB_CACHE_${userId}`, JSON.stringify({
    user: { id: userId, name: 'U', email: 'u@exemplo.com' },
    accounts: [], cards: [], pixKeys: [], goals: [], fixedBills: [],
    recurringBills: [], occurrences: [], transactions: txs,
  }));
}

test.describe('55. Integridade de sessão e erro de carga', () => {
  test('1. backend configurado + client ok: login usa Supabase, sem usr_*', async () => {
    const { repo } = bootFreshRepo();
    connectedConfig(repo);
    repo.supabase = fakeSupabase({ rows: {} });
    const res = await repo.signInWithEmail('alguem@exemplo.com', 'senha123');
    expect(res.success).toBe(true);
    expect(res.user.id).toBe(UUID_REAL);
    expect(repo.currentUserId).toBe(UUID_REAL);
    expect(global.localStorage.getItem('LINSORA_REGISTERED_USERS')).toBeNull();
  });

  test('2. backend configurado + client ausente: sem usr_*, erro explícito', async () => {
    const { repo } = bootFreshRepo();
    connectedConfig(repo);
    repo.supabase = null;
    const before = repo.currentUserId;
    const res = await repo.signInWithEmail('alguem@exemplo.com', 'senha123');
    expect(res.success).toBe(false);
    expect(res.message).toContain(FRIENDLY);
    expect(repo.currentUserId).toBe(before);
    expect(global.localStorage.getItem('LINSORA_REGISTERED_USERS')).toBeNull();
    expect(global.localStorage.getItem(`LINSORA_DB_CACHE_usr_4d0a8b2c_tZXhlbG8`) ?? null).toBeNull();
  });

  test('3. backend configurado + cadastro sem client: sem usuário local', async () => {
    const { repo } = bootFreshRepo();
    connectedConfig(repo);
    repo.supabase = null;
    const res = await repo.signUpWithEmail('Novo', 'novo@exemplo.com', 'senha123');
    expect(res.success).toBe(false);
    expect(res.message).toContain(FRIENDLY);
    expect(global.localStorage.getItem('LINSORA_REGISTERED_USERS')).toBeNull();
  });

  test('4. modo local explícito (sem backend): fluxo local preservado', async () => {
    const { repo } = bootFreshRepo();
    repo.config = { url: '', key: '', isConnected: false };
    repo.supabase = null;
    const res = await repo.signUpWithEmail('Local', 'local@exemplo.com', 'senha123');
    expect(res.success).toBe(true);
    expect(res.user.id.startsWith('usr_')).toBe(true);
    const login = await repo.signInWithEmail('local@exemplo.com', 'senha123');
    expect(login.success).toBe(true);
    expect(login.user.id).toBe(res.user.id);
  });

  test('5. sessão local usr_* obsoleta + backend: não mascara, volta ao login', async () => {
    const { repo } = bootFreshRepo();
    connectedConfig(repo);
    repo.supabase = fakeSupabase({ session: null });
    global.localStorage.setItem('LINSORA_ACTIVE_LOCAL_SESSION', JSON.stringify({ id: 'usr_obsoleto_12345678', email: 'velho@exemplo.com' }));
    const res = await repo.checkActiveSession();
    expect(res.success).toBe(false);
    expect(repo.currentUserId).not.toBe('usr_obsoleto_12345678');
  });

  test('5b. sessão Supabase válida tem prioridade sobre a local', async () => {
    const { repo } = bootFreshRepo();
    connectedConfig(repo);
    repo.supabase = fakeSupabase({
      session: { user: { id: UUID_REAL, email: 'novo@exemplo.com', user_metadata: {} } },
      rows: {},
    });
    global.localStorage.setItem('LINSORA_ACTIVE_LOCAL_SESSION', JSON.stringify({ id: 'usr_obsoleto_12345678', email: 'velho@exemplo.com' }));
    const res = await repo.checkActiveSession();
    expect(res.success).toBe(true);
    expect(res.user.id).toBe(UUID_REAL);
  });

  test('6. erro remoto: loadError explícito, cache preservado', async () => {
    const { repo } = bootFreshRepo();
    connectedConfig(repo);
    repo.supabase = fakeSupabase({ failTables: ['*'] });
    seedCache(UUID_REAL, 1);
    const data = await repo.getDbData(UUID_REAL, { id: UUID_REAL, email: 'u@exemplo.com' });
    expect(data.loadError).toBeTruthy();
    expect(data.loadError.message).toContain('Não foi possível carregar');
    expect(data.transactions).toHaveLength(1);
    const raw = JSON.parse(global.localStorage.getItem(`LINSORA_DB_CACHE_${UUID_REAL}`));
    expect(raw.transactions).toHaveLength(1);
  });

  test('7. remoto ok sem registros: vazio normal, sem loadError', async () => {
    const { repo } = bootFreshRepo();
    connectedConfig(repo);
    repo.supabase = fakeSupabase({ rows: {} });
    const data = await repo.getDbData(UUID_REAL, { id: UUID_REAL, email: 'u@exemplo.com' });
    expect(data.loadError).toBeNull();
    expect(data.transactions).toEqual([]);
  });

  test('9. retry após falha limpa loadError e carrega', async () => {
    const { repo, store } = bootFreshRepo();
    connectedConfig(repo);
    repo.supabase = fakeSupabase({ failTables: ['*'] });
    await store.loadUserData({ id: UUID_REAL, email: 'u@exemplo.com', name: 'U' });
    expect(store.state.loadError).toBeTruthy();
    repo.supabase = fakeSupabase({
      session: { user: { id: UUID_REAL, email: 'u@exemplo.com', user_metadata: {} } },
      rows: { transactions: [{ id: 'tx-remota-1', user_id: UUID_REAL }] },
    });
    const ok = await store.retryLoadData();
    expect(ok).toBe(true);
    expect(store.state.loadError).toBeNull();
    expect(store.state.transactions.map((t) => t.id)).toContain('tx-remota-1');
  });
});
