const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// 39. Webhook Hotmart V2 — teste isolado da v1 (recepção sem processamento).
// Não usa navegador nem servidor: invoca o handler com req/res simulados.
// Não altera nenhum teste existente (27 a 38 intactos).

const handler = require('../api/hotmart-webhook');

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

test.describe('39. Webhook Hotmart (v1 recepcao)', () => {
  test('1. POST com JSON valido retorna 200 {ok:true}', async () => {
    const { req, res } = makeReqRes({
      headers: { 'x-hotmart-hottok': 'qualquer-valor' },
      body: { id: 'evt-1', event: 'PURCHASE_APPROVED', data: {} },
    });
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ ok: true });
  });

  test('2. POST com body string JSON valido retorna 200', async () => {
    const { req, res } = makeReqRes({
      body: JSON.stringify({ id: 'evt-2', event: 'PURCHASE_APPROVED' }),
    });
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ ok: true });
  });

  test('3. GET retorna 405', async () => {
    const { req, res } = makeReqRes({ method: 'GET' });
    await handler(req, res);
    expect(res.statusCode).toBe(405);
    expect(res.payload.ok).toBe(false);
    expect(res.headersSent.Allow).toBe('POST');
  });

  test('4. PUT e DELETE retornam 405', async () => {
    for (const method of ['PUT', 'DELETE', 'PATCH']) {
      const { req, res } = makeReqRes({ method });
      await handler(req, res);
      expect(res.statusCode, method).toBe(405);
    }
  });

  test('5. POST com JSON invalido retorna 400', async () => {
    const { req, res } = makeReqRes({ body: '{json-invalido' });
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.payload.ok).toBe(false);
  });

  test('6. POST sem body retorna 400', async () => {
    const { req, res } = makeReqRes({ body: undefined });
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  test('7. POST com body null ou vazio retorna 400', async () => {
    for (const body of [null, '', '   ']) {
      const { req, res } = makeReqRes({ body });
      await handler(req, res);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  test('8. Hottok enviado nunca aparece no log', async () => {
    const secret = 'SEGREDO-TESTE-XYZ-123';
    const { req, res } = makeReqRes({
      headers: { 'x-hotmart-hottok': secret },
      body: { id: 'evt-3', event: 'PURCHASE_APPROVED' },
    });
    const logs = await captureLogs(() => handler(req, res));
    expect(res.statusCode).toBe(200);
    expect(logs).not.toContain(secret);
  });

  test('9. nenhum segredo no codigo do endpoint', async () => {
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
    expect(src).toContain('HOTMART_HOTTOK');
  });
});
