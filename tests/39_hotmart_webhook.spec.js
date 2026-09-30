const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// 39. Webhook Hotmart V2 — teste isolado (recepção autenticada, sem processamento).
// Não usa navegador nem servidor: invoca o handler com req/res simulados.
// Valores de Hottok aqui são FICTÍCIOS, usados só para exercer a comparação.
// Não altera nenhum teste existente (27 a 38 intactos).

const handler = require('../api/hotmart-webhook');

const ENV_KEY = 'HOTMART_HOTTOK';
const FAKE_SECRET = 'hottok-ficticio-de-teste-abc123';
const WRONG_SECRET = 'hottok-ficticio-errado-xyz789';
const HAD_ENV = Object.prototype.hasOwnProperty.call(process.env, ENV_KEY);
const ORIGINAL_ENV = process.env[ENV_KEY];

function makeReqRes({ method = 'POST', headers = {}, body = undefined } = {}) {
  const req = { method, headers, body };
  const res = {
    statusCode: null,
    payload: null,
    headersSent: {},
    setHeader(k, v) { this.headersSent[k] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.payload = o; return this; },
  };
  return { req, res };
}

function withSecret() {
  process.env[ENV_KEY] = FAKE_SECRET;
}

function withoutSecret() {
  delete process.env[ENV_KEY];
}

async function captureLogs(fn) {
  const out = [];
  const orig = console.log;
  console.log = (...args) => out.push(args.map(String).join(' '));
  try {
    await fn();
  } finally {
    console.log = orig;
  }
  return out.join('\n');
}

test.describe('39. Webhook Hotmart (recepcao autenticada)', () => {
  test.afterEach(() => {
    if (HAD_ENV) process.env[ENV_KEY] = ORIGINAL_ENV;
    else delete process.env[ENV_KEY];
  });

  test('1. segredo ausente no ambiente retorna 500', async () => {
    withoutSecret();
    const { req, res } = makeReqRes({
      headers: { 'x-hotmart-hottok': FAKE_SECRET },
      body: { id: 'evt-1', event: 'PURCHASE_APPROVED' },
    });
    await handler(req, res);
    expect(res.statusCode).toBe(500);
    expect(res.payload).toEqual({ ok: false, error: 'hottok_not_configured' });
  });

  test('2. header ausente retorna 401', async () => {
    withSecret();
    const { req, res } = makeReqRes({
      body: { id: 'evt-2', event: 'PURCHASE_APPROVED' },
    });
    await handler(req, res);
    expect(res.statusCode).toBe(401);
    expect(res.payload).toEqual({ ok: false, error: 'missing_hottok' });
  });

  test('3. Hottok incorreto retorna 401', async () => {
    withSecret();
    const { req, res } = makeReqRes({
      headers: { 'x-hotmart-hottok': WRONG_SECRET },
      body: { id: 'evt-3', event: 'PURCHASE_APPROVED' },
    });
    await handler(req, res);
    expect(res.statusCode).toBe(401);
    expect(res.payload).toEqual({ ok: false, error: 'invalid_hottok' });
  });

  test('4. Hottok correto com JSON valido retorna 200 {ok:true}', async () => {
    withSecret();
    const { req, res } = makeReqRes({
      headers: { 'x-hotmart-hottok': FAKE_SECRET },
      body: { id: 'evt-4', event: 'PURCHASE_APPROVED', data: {} },
    });
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ ok: true });
  });

  test('5. Hottok correto com body string JSON valido retorna 200', async () => {
    withSecret();
    const { req, res } = makeReqRes({
      headers: { 'x-hotmart-hottok': FAKE_SECRET },
      body: JSON.stringify({ id: 'evt-5', event: 'PURCHASE_APPROVED' }),
    });
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ ok: true });
  });

  test('6. Hottok correto com JSON invalido retorna 400', async () => {
    withSecret();
    const { req, res } = makeReqRes({
      headers: { 'x-hotmart-hottok': FAKE_SECRET },
      body: '{json-invalido',
    });
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.payload.ok).toBe(false);
  });

  test('7. Hottok correto sem body retorna 400', async () => {
    withSecret();
    for (const body of [undefined, null, '', '   ']) {
      const { req, res } = makeReqRes({
        headers: { 'x-hotmart-hottok': FAKE_SECRET },
        body,
      });
      await handler(req, res);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  test('8. GET retorna 405', async () => {
    withSecret();
    const { req, res } = makeReqRes({ method: 'GET' });
    await handler(req, res);
    expect(res.statusCode).toBe(405);
    expect(res.payload.ok).toBe(false);
    expect(res.headersSent.Allow).toBe('POST');
  });

  test('9. PUT e DELETE retornam 405', async () => {
    withSecret();
    for (const method of ['PUT', 'DELETE', 'PATCH']) {
      const { req, res } = makeReqRes({ method });
      await handler(req, res);
      expect(res.statusCode, method).toBe(405);
    }
  });

  test('10. Hottok (header e env) nunca aparece no log', async () => {
    withSecret();
    const { req, res } = makeReqRes({
      headers: { 'x-hotmart-hottok': FAKE_SECRET },
      body: { id: 'evt-6', event: 'PURCHASE_APPROVED' },
    });
    const logs = await captureLogs(() => handler(req, res));
    expect(res.statusCode).toBe(200);
    expect(logs).not.toContain(FAKE_SECRET);
    expect(logs).not.toContain(WRONG_SECRET);
  });

  test('11. nenhum segredo no codigo do endpoint', async () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'api', 'hotmart-webhook.js'),
      'utf8'
    );
    // A palavra service_role pode aparecer em comentarios (documentacao);
    // o que NAO pode existir e segredo em codigo executavel. Remove comentarios
    // antes de verificar.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '$1');
    expect(code.toLowerCase()).not.toContain('service_role');
    expect(code).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(code).not.toMatch(/sk_(live|test)_/);
    expect(code).not.toMatch(/hottok\s*[:=]\s*['"][^'"]+['"]/i);
    expect(code).not.toMatch(/process\.env\.HOTMART_HOTTOK\s*\|\|/);
    // O segredo vem exclusivamente da env, lida por requisicao.
    expect(code).toContain('process.env.HOTMART_HOTTOK');
    expect(src).toContain('timingSafeEqual');
  });
});
