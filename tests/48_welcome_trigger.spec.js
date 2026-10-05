const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// 48. Trigger pós-confirmação → /api/send-welcome → Resend.
// Testes de unidade do handler server-side com fetch mockado:
// nenhum usuário real, nenhum e-mail real, nenhum segredo real.

const handler = require('../api/send-welcome');

const UID = '22222222-3333-4444-8555-666666666666';
const ENV = {
  LINSORA_SUPABASE_URL: 'https://supabase-ficticia-welcome.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-ficticia-para-testes',
  WELCOME_HOOK_SECRET: 'hook-secret-ficticio-32bytes-xyz',
  RESEND_API_KEY: 're_ficticia_para_testes',
  WELCOME_FROM_EMAIL: 'Linsora <ola@exemplo.com.br>',
  WELCOME_APP_URL: 'https://app-exemplo.com/',
};

function repoRoot() {
  return path.resolve(__dirname, '..');
}

function readSource(rel) {
  return fs.readFileSync(path.join(repoRoot(), rel), 'utf8');
}

function mockRes() {
  const r = {
    statusCode: null,
    payload: null,
    setHeader() { return this; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.payload = o; return this; },
  };
  return r;
}

function confirmedUser(overrides) {
  return Object.assign({
    id: UID,
    email: 'boas.vindas@exemplo.com',
    email_confirmed_at: '2026-10-05T10:00:00.000Z',
    user_metadata: { full_name: 'Ana Souza' },
  }, overrides || {});
}

/**
 * Fake fiel da semântica que o endpoint exige do banco:
 * - INSERT com ignore-duplicates;
 * - PATCH de claim ATÔMICO (filtros aplicados de uma vez; JS é
 *   single-thread, logo concorrentes simultâneos são serializados
 *   como no Postgres para esta operação);
 * - PATCH de finalização condicionado a status=sending.
 */
function makeFake(options) {
  const opts = options || {};
  const user = 'user' in opts ? opts.user : confirmedUser();
  const resendOk = opts.resendOk !== false;
  const db = new Map();
  const stats = { resend: 0, idempotencyKeys: [] };

  function rowOf(id) {
    return db.get(String(id)) || null;
  }

  async function fetchImpl(url, reqOpts) {
    const o = reqOpts || {};
    const method = String(o.method || 'GET').toUpperCase();
    const body = o.body ? JSON.parse(o.body) : undefined;

    if (url.indexOf('/auth/v1/admin/users/') !== -1) {
      const id = decodeURIComponent(url.split('/').pop().split('?')[0]);
      if (!user || String(user.id) !== String(id)) {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(user)) };
    }

    if (url.indexOf('/rest/v1/welcome_emails') !== -1) {
      const q = url.split('?')[1] || '';
      const params = new URLSearchParams(q);
      const eqId = params.get('user_id') ? String(params.get('user_id')).replace(/^eq\./, '') : null;
      if (method === 'POST') {
        const ignore = (o.headers && o.headers.Prefer || '').indexOf('ignore-duplicates') !== -1;
        if (!db.has(body.user_id) || !ignore) {
          if (!db.has(body.user_id)) {
            db.set(body.user_id, {
              user_id: body.user_id, status: 'pending', attempts: 0,
              claimed_at: null, sent_at: null, last_error: null,
            });
          }
        }
        return { ok: true, status: 201, json: async () => [] };
      }
      if (method === 'GET') {
        const row = eqId ? rowOf(eqId) : null;
        return { ok: true, status: 200, json: async () => (row ? [JSON.parse(JSON.stringify(row))] : []) };
      }
      if (method === 'PATCH') {
        const row = eqId ? rowOf(eqId) : null;
        if (!row) {
          return { ok: true, status: 200, json: async () => [] };
        }
        // Filtro status=in.(...) quando presente.
        const statusIn = params.get('status');
        if (statusIn && statusIn.indexOf('in.(') === 0) {
          const allowed = statusIn.slice(4, -1).split(',');
          if (allowed.indexOf(row.status) === -1) {
            return { ok: true, status: 200, json: async () => [] };
          }
          // Filtro de lease: or=(claimed_at.is.null,claimed_at.lt.CUTOFF)
          const orClause = params.get('or') || '';
          if (orClause.indexOf('claimed_at') !== -1) {
            const m = orClause.match(/claimed_at\.lt\.([^,)]+)/);
            const cutoff = m ? decodeURIComponent(m[1]) : null;
            const free = !row.claimed_at || (cutoff && row.claimed_at < cutoff);
            if (!free) {
              return { ok: true, status: 200, json: async () => [] };
            }
          }
        }
        // Filtro status=eq.X quando presente (finalização só do dono).
        const statusEq = params.get('status');
        if (statusEq && statusEq.indexOf('eq.') === 0) {
          if (row.status !== statusEq.slice(3)) {
            return { ok: true, status: 200, json: async () => [] };
          }
        }
        Object.assign(row, body);
        const ret = (o.headers && o.headers.Prefer || '').indexOf('return=representation') !== -1;
        return { ok: true, status: 200, json: async () => (ret ? [JSON.parse(JSON.stringify(row))] : []) };
      }
    }

    if (url === 'https://api.resend.com/emails') {
      stats.resend += 1;
      stats.idempotencyKeys.push((o.headers || {})['Idempotency-Key']);
      if (!resendOk) {
        return { ok: false, status: 500, json: async () => ({ error: 'ficticio' }) };
      }
      return { ok: true, status: 200, json: async () => ({ id: 'em-ficticio-1' }) };
    }

    throw new Error('fetch inesperado em teste: ' + url);
  }

  return {
    db, stats, fetchImpl,
    hookHeaders: { 'x-welcome-secret': ENV.WELCOME_HOOK_SECRET },
    hookBody: () => ({ user_id: UID, email: 'boas.vindas@exemplo.com' }),
  };
}

async function post(fake, headers, body) {
  const res = mockRes();
  await handler(
    { method: 'POST', headers: headers || {}, body: body === undefined ? null : body },
    res,
    { env: ENV, fetchImpl: fake.fetchImpl }
  );
  return res;
}

/** Remove comentários SQL (bloco /*...*\/ e linhas --) para afirmar sobre CÓDIGO, não documentação. */
function stripSqlComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => line.trim().indexOf('--') !== 0)
    .join('\n');
}

test.describe('48. Trigger pós-confirmação → welcome', () => {
  test('1. webhook sem segredo e sem token → rejeitado', async () => {
    const fake = makeFake();
    const res = await post(fake, {}, { user_id: UID, email: 'boas.vindas@exemplo.com' });
    expect(res.statusCode).toBe(401);
    expect(fake.stats.resend).toBe(0);
  });

  test('2. segredo incorreto → rejeitado', async () => {
    const fake = makeFake();
    const res = await post(fake, { 'x-welcome-secret': 'segredo-errado' }, { user_id: UID, email: 'x@exemplo.com' });
    expect(res.statusCode).toBe(401);
    expect(fake.stats.resend).toBe(0);
  });

  test('3. método diferente de POST → rejeitado', async () => {
    const fake = makeFake();
    const res = mockRes();
    await handler({ method: 'GET', headers: {}, body: null }, res, { env: ENV, fetchImpl: fake.fetchImpl });
    expect(res.statusCode).toBe(405);
    expect(fake.stats.resend).toBe(0);
  });

  test('4. user_id inexistente → rejeitado', async () => {
    const fake = makeFake({ user: null });
    const res = await post(fake, fake.hookHeaders, { user_id: UID, email: 'fantasma@exemplo.com' });
    expect(res.statusCode).toBe(404);
    expect(res.payload.error).toBe('user-not-found');
    expect(fake.stats.resend).toBe(0);
  });

  test('5. usuário não confirmado → rejeitado, sem envio', async () => {
    const fake = makeFake({ user: confirmedUser({ email_confirmed_at: null }) });
    const res = await post(fake, fake.hookHeaders, fake.hookBody());
    expect(res.statusCode).toBe(403);
    expect(res.payload.error).toBe('email-not-confirmed');
    expect(fake.stats.resend).toBe(0);
  });

  test('6. usuário confirmado → elegível e envia na primeira execução', async () => {
    const fake = makeFake();
    const res = await post(fake, fake.hookHeaders, fake.hookBody());
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ ok: true, sent: true });
    expect(fake.stats.resend).toBe(1);
    expect(fake.db.get(UID).status).toBe('sent');
    expect(fake.db.get(UID).sent_at).not.toBeNull();
  });

  test('7. primeira execução envia; 8. posterior após sent não reenvia', async () => {
    const fake = makeFake();
    const first = await post(fake, fake.hookHeaders, fake.hookBody());
    expect(first.payload).toEqual({ ok: true, sent: true });
    const second = await post(fake, fake.hookHeaders, fake.hookBody());
    expect(second.statusCode).toBe(200);
    expect(second.payload).toEqual({ ok: true, already: true });
    expect(fake.stats.resend).toBe(1);
  });

  test('9. duas chamadas simultâneas → somente uma processa', async () => {
    const fake = makeFake();
    const [a, b] = await Promise.all([
      post(fake, fake.hookHeaders, fake.hookBody()),
      post(fake, fake.hookHeaders, fake.hookBody()),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    const sentCount = [a, b].filter((r) => r.payload && r.payload.sent === true).length;
    expect(sentCount).toBe(1);
    expect(codes).toEqual([200, 409]);
    expect(fake.stats.resend).toBe(1);
    expect(fake.db.get(UID).status).toBe('sent');
  });

  test('10. falha do Resend → 502 e NÃO marca sent; 11. retry posterior reenvia', async () => {
    const fake = makeFake({ resendOk: false });
    const fail = await post(fake, fake.hookHeaders, fake.hookBody());
    expect(fail.statusCode).toBe(502);
    expect(fail.payload.error).toBe('welcome-send-failed');
    expect(fake.db.get(UID).status).toBe('failed');
    expect(fake.db.get(UID).sent_at).toBeNull();
    // Provedor recupera: retry permitido e conclui.
    let okCount = 0;
    const orig = fake.fetchImpl;
    fake.fetchImpl = async (url, opts) => {
      if (url === 'https://api.resend.com/emails') {
        okCount += 1;
        return { ok: true, status: 200, json: async () => ({ id: 'em-ficticio-2' }) };
      }
      return orig(url, opts);
    };
    const retry = await post(fake, fake.hookHeaders, fake.hookBody());
    expect(retry.statusCode).toBe(200);
    expect(retry.payload).toEqual({ ok: true, sent: true });
    expect(okCount).toBe(1);
    expect(fake.db.get(UID).status).toBe('sent');
  });

  test('12. Idempotency-Key determinística linsora-welcome-<user_id>', async () => {
    const fake = makeFake();
    await post(fake, fake.hookHeaders, fake.hookBody());
    expect(fake.stats.idempotencyKeys).toEqual(['linsora-welcome-' + UID]);
  });

  test('13/14. nenhuma chave Resend/service_role no frontend', async () => {
    for (const rel of ['index.html', 'js/app.js', 'js/supabase-client.js', 'js/landing.js']) {
      const src = readSource(rel);
      const code = src.split('\n').filter((line) => {
        const t = line.trim();
        if (/^<!--/.test(t) || /^\*/.test(t) || /^\/\//.test(t)) return false;
        if (/NUNCA|Somente URL pública/i.test(line)) return false;
        return true;
      }).join('\n');
      expect(code).not.toMatch(/RESEND_API_KEY/);
      expect(code).not.toMatch(/SUPABASE_SERVICE_ROLE/);
      expect(code).not.toMatch(/eyJhbGciOi/);
      expect(code).not.toMatch(/service_role/i);
    }
  });

  test('15. trial permanece intocado', async () => {
    // Afirma sobre o código executável (comentários de escopo removidos):
    // nenhum identificador do trial pode aparecer em instrução SQL.
    const welcome = stripSqlComments(readSource('supabase_migration_welcome_email.sql'));
    expect(welcome).not.toMatch(/handle_new_trial/);
    expect(welcome).not.toMatch(/get_trial_status/);
    expect(welcome).not.toMatch(/trial_started_at|trial_ends_at/);
    expect(welcome).not.toMatch(/checkTrialAccess|checkSubscriptionAccess/);
    expect(welcome).not.toMatch(/subscriptions/);
    expect(readSource('supabase_migration_welcome_email.sql')).toContain('OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL');
    expect(welcome).toContain('AFTER UPDATE OF email_confirmed_at ON auth.users');
    const trial = readSource('supabase_migration_trial_24h.sql');
    expect(trial).toContain('handle_new_trial');
    expect(trial).toContain('get_trial_status');
  });

  test('16. recovery permanece intocado', async () => {
    const recovery = readSource('reset-password.html');
    expect(recovery).toContain('PASSWORD_RECOVERY');
    expect(recovery).toContain('detectSessionInUrl: true');
    const welcome = stripSqlComments(readSource('supabase_migration_welcome_email.sql'));
    expect(welcome).not.toMatch(/recovery|reset-password|updateUser/i);
  });
});
