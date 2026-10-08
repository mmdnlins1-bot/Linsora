const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// 51. handle_new_user idempotente (P2): retry/duplicata nunca aborta o signup.
// Somente leitura do SQL local + simulação em memória da semântica
// ON CONFLICT (id) DO NOTHING. Sem banco, sem credenciais, sem segredos.

function repoRoot() {
  return path.resolve(__dirname, '..');
}

function readSource(rel) {
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8');
}

// Extrai o corpo da função handle_new_user (entre CREATE e LANGUAGE).
function handleNewUserBody(src) {
  const start = src.indexOf('CREATE OR REPLACE FUNCTION public.handle_new_user()');
  expect(start).toBeGreaterThanOrEqual(0);
  const endMarker = '$$ LANGUAGE plpgsql SECURITY DEFINER;';
  const end = src.indexOf(endMarker, start);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end + endMarker.length);
}

/**
 * Simulação fiel da semântica exigida do trigger:
 * - INSERT cria quando ausente;
 * - reexecução para o mesmo id NÃO lança duplicate key;
 * - NÃO cria segunda linha;
 * - NÃO sobrescreve a linha existente (DO NOTHING, não DO UPDATE).
 */
function makeProfileStore() {
  const rows = new Map();
  function triggerInsert(id, fullName, email, avatarUrl) {
    if (rows.has(id)) return { inserted: false, row: rows.get(id) };
    const row = { id, full_name: fullName, email, avatar_url: avatarUrl };
    rows.set(id, row);
    return { inserted: true, row };
  }
  return { rows, triggerInsert };
}

test.describe('51. handle_new_user idempotente', () => {
  test('A. usuario novo: profile criado com os valores atuais do trigger', async () => {
    const body = handleNewUserBody(readSource('supabase_schema_rls.sql'));
    expect(body).toContain('INSERT INTO public.profiles (id, full_name, email, avatar_url)');
    expect(body).toContain('NEW.id');
    expect(body).toContain("COALESCE(NEW.raw_user_meta_data->>'full_name'");
    expect(body).toContain('NEW.email');
    expect(body).toContain("COALESCE(NEW.raw_user_meta_data->>'avatar_url'");

    const store = makeProfileStore();
    const out = store.triggerInsert('user-novo-1', 'Ana', 'ana@exemplo.com', 'https://exemplo.com/a.jpg');
    expect(out.inserted).toBe(true);
    expect(store.rows.size).toBe(1);
    expect(store.rows.get('user-novo-1')).toEqual({
      id: 'user-novo-1', full_name: 'Ana', email: 'ana@exemplo.com', avatar_url: 'https://exemplo.com/a.jpg',
    });
  });

  test('B. retry/duplicata: sem erro de duplicate key e sem segunda linha', async () => {
    const body = handleNewUserBody(readSource('supabase_schema_rls.sql'));
    // Cláusula apoiada na PRIMARY KEY real de public.profiles(id).
    expect(body).toMatch(/ON CONFLICT\s*\(\s*id\s*\)\s*DO NOTHING/);
    // Resiliência a falha transitória: nunca aborta o fluxo do trigger.
    expect(body).toMatch(/EXCEPTION[\s\S]*WHEN OTHERS THEN[\s\S]*RETURN NEW/);

    const store = makeProfileStore();
    store.triggerInsert('user-retry-1', 'Beto', 'beto@exemplo.com', 'https://exemplo.com/b.jpg');
    let threw = false;
    let second = null;
    try {
      second = store.triggerInsert('user-retry-1', 'Beto', 'beto@exemplo.com', 'https://exemplo.com/b.jpg');
    } catch (e) {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(second.inserted).toBe(false);
    expect(store.rows.size).toBe(1);
  });

  test('C. profile existente nao e sobrescrito', async () => {
    const body = handleNewUserBody(readSource('supabase_schema_rls.sql'));
    // DO NOTHING (nunca DO UPDATE): dados existentes preservados.
    expect(body).not.toMatch(/ON CONFLICT[\s\S]*DO UPDATE/);
    expect(body).not.toMatch(/UPDATE\s+public\.profiles/);

    const store = makeProfileStore();
    store.triggerInsert('user-existente-1', 'Nome Original', 'orig@exemplo.com', 'https://exemplo.com/orig.jpg');
    store.triggerInsert('user-existente-1', 'Nome Novo', 'novo@exemplo.com', 'https://exemplo.com/novo.jpg');
    expect(store.rows.get('user-existente-1')).toEqual({
      id: 'user-existente-1', full_name: 'Nome Original', email: 'orig@exemplo.com', avatar_url: 'https://exemplo.com/orig.jpg',
    });
  });

  test('D. handle_new_trial nao foi alterado', async () => {
    const trial = readSource('supabase_migration_trial_24h.sql');
    expect(trial).toContain('CREATE OR REPLACE FUNCTION public.handle_new_trial()');
    expect(trial).toContain('ON CONFLICT (user_id) DO UPDATE SET');
    expect(trial).toContain('trial_started_at = COALESCE(public.subscriptions.trial_started_at');
    // O profile trigger continua sem tocar em trial/subscriptions.
    const body = handleNewUserBody(readSource('supabase_schema_rls.sql'));
    expect(body).not.toMatch(/subscriptions/);
    expect(body).not.toMatch(/trial_started_at|trial_ends_at/);
  });

  test('E. trigger de signup preservado', async () => {
    const src = readSource('supabase_schema_rls.sql');
    expect(src).toContain('DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;');
    expect(src).toMatch(/CREATE TRIGGER on_auth_user_created[\s\S]*AFTER INSERT ON auth\.users[\s\S]*FOR EACH ROW EXECUTE FUNCTION public\.handle_new_user\(\)/);
  });

  test('F. SECURITY DEFINER e search_path preservados, sem acesso publico', async () => {
    const body = handleNewUserBody(readSource('supabase_schema_rls.sql'));
    expect(body).toContain('SECURITY DEFINER');
    expect(body).toMatch(/SET search_path = public, pg_temp/);
    expect(body).not.toMatch(/GRANT.*TO\s+(anon|public|authenticated)/i);
  });
});
