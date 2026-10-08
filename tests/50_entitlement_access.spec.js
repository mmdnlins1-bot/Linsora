const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// 50. Entitlement server-side (P1 pós-expiração).
// NÃO usa Supabase real, produção ou credenciais: valida ESTATICAMENTE a
// migration `supabase_migration_entitlement_access.sql` (estrutura da função,
// grants e policies por tabela/comando) e espelha a tabela de decisão do
// booleano em JS puro com a mesma semântica do SQL (now() fixo).
// A execução real das policies (RLS de verdade) exige Supabase com a
// migration aplicada e está documentada como pendente (ver relatório).

const MIGRATION_PATH = path.join(
  __dirname, '..', 'supabase_migration_entitlement_access.sql'
);

function loadSql() {
  return fs.readFileSync(MIGRATION_PATH, 'utf8');
}

function executableCode(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
}

// Retorna [{ name, table, command, body }] para cada CREATE POLICY.
function parsePolicies(code) {
  const re = /CREATE POLICY "([^"]+)" ON public\.(\w+)\s+FOR (SELECT|INSERT|UPDATE|DELETE|ALL)([\s\S]*?);/g;
  const out = [];
  let m;
  while ((m = re.exec(code)) !== null) {
    out.push({ name: m[1], table: m[2], command: m[3], body: m[4] });
  }
  return out;
}

// Espelho JS da regra SQL de has_active_access (mesma semântica, now fixo).
function hasActiveAccessMirror(row, nowMs) {
  if (!row || typeof row !== 'object') return false;
  const end = row.current_period_end ? new Date(row.current_period_end).getTime() : null;
  const trialEnd = row.trial_ends_at ? new Date(row.trial_ends_at).getTime() : null;
  if (row.status === 'active' && (end === null || Number.isNaN(end) === false && end > nowMs)) {
    if (end === null) return true;
    if (!Number.isNaN(end) && end > nowMs) return true;
  }
  if (
    row.status === 'canceled' &&
    end !== null && !Number.isNaN(end) && end > nowMs
  ) {
    return true;
  }
  if (trialEnd !== null && !Number.isNaN(trialEnd) && trialEnd > nowMs) return true;
  return false;
}

const NOW = new Date('2026-10-07T12:00:00.000Z').getTime();
const FUTURE = '2026-11-01T12:00:00.000Z';
const PAST = '2026-09-01T12:00:00.000Z';

test.describe('50. Entitlement server-side', () => {
  test('função has_active_access com características obrigatórias', async () => {
    const code = executableCode(loadSql());
    expect(code).toContain('CREATE OR REPLACE FUNCTION public.has_active_access()');
    expect(code).toMatch(/RETURNS BOOLEAN/);
    expect(code).toMatch(/LANGUAGE plpgsql STABLE SECURITY DEFINER/);
    expect(code).toContain('SET search_path = public, pg_temp');
    expect(code).toContain('s.user_id = auth.uid()');
    expect(code).toContain('now()');
    expect(code).not.toContain('Date.now');
    // Sem parâmetros e sem identificador arbitrário.
    expect(code).toMatch(/has_active_access\(\)\s*\n?RETURNS BOOLEAN/);
    expect(code).not.toMatch(/has_active_access\([^)]*\w+[^)]*\)\s*\n?RETURNS/);
    // Regra completa no corpo.
    expect(code).toContain(`s.status = 'active'`);
    expect(code).toContain(`s.status = 'canceled'`);
    expect(code).toContain('s.trial_ends_at IS NOT NULL');
    expect(code).toContain('s.current_period_end IS NOT NULL');
  });

  test('menor privilégio: revokes explícitos + grant só a authenticated', async () => {
    const code = executableCode(loadSql());
    expect(code).toMatch(/REVOKE ALL ON FUNCTION public\.has_active_access\(\) FROM PUBLIC;/);
    expect(code).toMatch(/REVOKE ALL ON FUNCTION public\.has_active_access\(\) FROM anon;/);
    expect(code).toMatch(/GRANT EXECUTE ON FUNCTION public\.has_active_access\(\) TO authenticated/);
    expect(code).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.has_active_access\(\) TO anon/);
  });

  test('6 tabelas de dados: SELECT livre + escrita com entitlement', async () => {
    const code = executableCode(loadSql());
    const policies = parsePolicies(code);
    const writeTables = [
      'accounts', 'cards', 'pix_keys', 'goals', 'fixed_bills',
      'transactions',
    ];
    for (const t of writeTables) {
      const sel = policies.filter((p) => p.table === t && p.command === 'SELECT');
      expect(sel.length, `${t} SELECT`).toBe(1);
      expect(sel[0].body).toContain('auth.uid() = user_id');
      expect(sel[0].body).not.toContain('has_active_access');
      for (const cmd of ['INSERT', 'UPDATE', 'DELETE']) {
        const found = policies.filter((p) => p.table === t && p.command === cmd);
        expect(found.length, `${t} ${cmd}`).toBe(1);
        expect(found[0].body).toContain('auth.uid() = user_id');
        expect(found[0].body).toContain('public.has_active_access()');
      }
      expect(policies.filter((p) => p.table === t && p.command === 'ALL').length, `${t} sem FOR ALL`).toBe(0);
    }
    // profiles: SELECT preservado fora da migration; INSERT/UPDATE com entitlement; sem DELETE.
    const profIns = policies.filter((p) => p.table === 'profiles' && p.command === 'INSERT');
    const profUpd = policies.filter((p) => p.table === 'profiles' && p.command === 'UPDATE');
    const profDel = policies.filter((p) => p.table === 'profiles' && p.command === 'DELETE');
    expect(profIns.length).toBe(1);
    expect(profUpd.length).toBe(1);
    expect(profDel.length).toBe(0);
    expect(profIns[0].body).toContain('auth.uid() = id');
    expect(profIns[0].body).toContain('public.has_active_access()');
    expect(profUpd[0].body).toContain('auth.uid() = id');
    expect(profUpd[0].body).toContain('public.has_active_access()');
  });

  test('tabelas inexistentes no banco real não são referenciadas', async () => {
    const code = executableCode(loadSql());
    for (const t of ['recurring_bills', 'recurring_bill_occurrences', 'welcome_emails']) {
      expect(code).not.toContain(`ON public.${t}`);
      expect(code).not.toContain(`TABLE public.${t}`);
      expect(code).not.toContain(`JOIN public.${t}`);
      expect(code).not.toContain(`FROM public.${t}`);
    }
    expect(code).not.toContain('CREATE TABLE');
    expect(code).not.toContain('ALTER TABLE');
    expect(code).not.toContain('transaction_id IS NULL OR EXISTS');
  });

  test('subscriptions, subscription_events intocadas', async () => {
    const code = executableCode(loadSql());
    for (const t of ['subscriptions', 'subscription_events', 'welcome_emails']) {
      expect(code).not.toContain(`ON public.${t}`);
      expect(code).not.toContain(`TABLE public.${t}`);
    }
    expect(code).not.toContain('get_trial_status');
    expect(code).not.toContain('handle_new_trial');
  });

  test('A. trial válido permite tudo (espelho da regra)', async () => {
    const row = { status: 'pending', current_period_end: null, trial_ends_at: FUTURE };
    expect(hasActiveAccessMirror(row, NOW)).toBe(true);
  });

  test('B. trial expirado: leitura é decisão de política SELECT, escrita negada', async () => {
    const row = { status: 'pending', current_period_end: null, trial_ends_at: PAST };
    expect(hasActiveAccessMirror(row, NOW)).toBe(false);
    // SELECT não exige a função (validado no teste de policies).
  });

  test('C. active sem current_period_end permite escrita', async () => {
    expect(hasActiveAccessMirror({ status: 'active', current_period_end: null, trial_ends_at: null }, NOW)).toBe(true);
  });

  test('D. active com fim futuro permite escrita', async () => {
    expect(hasActiveAccessMirror({ status: 'active', current_period_end: FUTURE, trial_ends_at: null }, NOW)).toBe(true);
  });

  test('E. canceled com fim futuro permite escrita', async () => {
    expect(hasActiveAccessMirror({ status: 'canceled', current_period_end: FUTURE, trial_ends_at: null }, NOW)).toBe(true);
  });

  test('F. canceled com fim passado nega escrita', async () => {
    expect(hasActiveAccessMirror({ status: 'canceled', current_period_end: PAST, trial_ends_at: null }, NOW)).toBe(false);
  });

  test('G. refunded/chargeback/past_due/expired sem trial válido negam escrita', async () => {
    for (const status of ['refunded', 'chargeback', 'past_due', 'expired']) {
      expect(hasActiveAccessMirror({ status, current_period_end: FUTURE, trial_ends_at: null }, NOW)).toBe(false);
      expect(hasActiveAccessMirror({ status, current_period_end: PAST, trial_ends_at: PAST }, NOW)).toBe(false);
    }
  });

  test('H. isolamento entre usuários preservado nas policies', async () => {
    const code = executableCode(loadSql());
    const policies = parsePolicies(code);
    for (const p of policies) {
      expect(p.body).toContain('auth.uid()');
    }
  });

  test('I. trial válido + status não pago preserva semântica atual', async () => {
    // pending + trial futuro concede (mesmo comportamento do gate atual).
    expect(hasActiveAccessMirror({ status: 'pending', current_period_end: null, trial_ends_at: FUTURE }, NOW)).toBe(true);
    // pending sem trial não concede (gate atual: blocked).
    expect(hasActiveAccessMirror({ status: 'pending', current_period_end: null, trial_ends_at: null }, NOW)).toBe(false);
  });
});
