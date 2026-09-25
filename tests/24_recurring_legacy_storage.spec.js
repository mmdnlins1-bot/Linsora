const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.use({ timezoneId: 'America/Sao_Paulo' });

// 24. Claim consentido de recorrências guest (cenários 1–6).
// Guest com Energia/Aluguel placeholder + destino ocupado. Sem aceite nada
// migra; com aceite, só recurringBills/occurrences placeholder, com recibo.
// Roda nos projetos chromium (desktop) e mobile-chrome (mobile) via config.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIXED_NOW = new Date('2026-09-25T12:00:00-03:00');
const AUTH_UUID = '123e4567-e89b-42d3-a456-426614174000';
const FOREIGN_UUID = '123e4567-e89b-42d3-a456-426614174999';

test.describe('24. Claim consentido de recorrências guest', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.clock.install({ time: FIXED_NOW });
    await page.reload();
    await login(page);
    await expect(page.locator('#tabDashboard')).toBeVisible();
  });

  async function seedScenario(page) {
    await page.evaluate(([authId, foreignId]) => {
      const guestBlob = {
        user: { id: 'usr_guest', name: 'Visitante', email: 'visitante@linsora.com.br' },
        accounts: [{ id: 'acc_guest', userId: 'usr_guest', name: 'Conta Guest', balance: 111 }],
        transactions: [{ id: 'tx_guest', userId: 'usr_guest', type: 'DESPESA', description: 'Lanche guest', amount: 50, category: 'Alimentação', date: '2026-09-10', account: 'Conta Guest', status: 'CONCLUIDO' }],
        goals: [{ id: 'goal_guest', userId: 'usr_guest', title: 'Meta Guest', target: 100 }],
        cards: [], pixKeys: [], fixedBills: [],
        recurringBills: [
          { id: 'rb_energia', userId: 'usr_guest', title: 'Energia', amount: 300, category: 'Moradia', frequency: 'MONTHLY', dueDay: 28, startDate: '2026-01-01', endDate: null, active: true },
          { id: 'rb_aluguel', userId: 'usr_guest', title: 'Aluguel', amount: 2000, category: 'Moradia', frequency: 'MONTHLY', dueDay: 30, startDate: '2026-01-01', endDate: null, active: true },
        ],
        occurrences: [
          { id: 'rbocc_energia_28', recurringBillId: 'rb_energia', userId: 'usr_guest', dueDate: '2026-09-28', expectedAmount: 300, status: 'PENDING', paidAmount: null, paidAt: null, transactionId: null },
        ],
      };
      const destBlob = {
        user: { id: authId, name: 'Auth', email: 'auth@linsora.com.br' },
        accounts: [{ id: 'acc_auth', userId: authId, name: 'Conta Auth', balance: 0 }],
        transactions: [{ id: 'tx_auth', userId: authId, type: 'RECEITA', description: 'Salario', amount: 10000, category: 'Salário', date: '2026-09-05', account: 'Conta Auth', status: 'CONCLUIDO' }],
        goals: [], cards: [], pixKeys: [], fixedBills: [],
        recurringBills: [], occurrences: [],
      };
      const otherBlob = {
        user: { id: foreignId, name: 'Outro', email: 'outro@linsora.com.br' },
        accounts: [], transactions: [], goals: [], cards: [], pixKeys: [], fixedBills: [],
        recurringBills: [
          { id: 'rb_alheia', userId: foreignId, title: 'Conta Alheia', amount: 999, category: 'Moradia', frequency: 'MONTHLY', dueDay: 28, startDate: '2026-01-01', endDate: null, active: true },
        ],
        occurrences: [],
      };
      localStorage.setItem('LINSORA_DB_CACHE_usr_guest', JSON.stringify(guestBlob));
      localStorage.setItem(`LINSORA_DB_CACHE_${authId}`, JSON.stringify(destBlob));
      localStorage.setItem(`LINSORA_DB_CACHE_${foreignId}`, JSON.stringify(otherBlob));
    }, [AUTH_UUID, FOREIGN_UUID]);
  }

  async function claimLogin(page, uuid, claimFlag) {
    return page.evaluate(async ([id, flag]) => {
      const db = await window.supabaseRepo.getDbData(
        id, { id, email: 'auth@linsora.com.br', name: 'Auth' }, { claimGuestRecurring: flag }
      );
      window.linsoraStore.state = db;
      window.linsoraStore.ensureCycleOccurrences();
      window.linsoraStore.persistState();
      return {
        bills: window.linsoraStore.state.recurringBills.map((b) => b.title),
        committed: window.linsoraStore.getCommittedAmountUntil('2026-09-30'),
        txDescs: window.linsoraStore.state.transactions.map((t) => t.description),
        receipt: window.supabaseRepo.getGuestClaimReceipt(id),
      };
    }, [uuid, claimFlag]);
  }

  test('Cenário 1 (Importar): R$2.300, 2 opções, confirmação, só Energia vira PAID', async ({ page }) => {
    await seedScenario(page);
    const st = await claimLogin(page, AUTH_UUID, true);
    expect(st.bills.sort()).toEqual(['Aluguel', 'Energia']);
    expect(st.committed.total).toBe(2300);
    expect(st.receipt?.result).toBe('imported');

    const advice = await page.evaluate(() => {
      const a = window.LinsoraStrategicAdvisor.processQuery('Posso gastar 5000 reais hoje?');
      return {
        options: a.commitmentOptions || [],
        titles: (a.commitmentOptions || []).map((o) => o.title).sort(),
        rec: a.recommendation,
      };
    });
    expect(advice.titles).toEqual(['Aluguel', 'Energia']);
    expect(advice.rec).toContain('já pagou');

    const nEnergia = advice.options.find((o) => o.title === 'Energia').n;
    await page.evaluate((n) => { window.LinsoraStrategicAdvisor.processQuery(String(n)); }, nEnergia);
    const after = await page.evaluate(() => {
      window.LinsoraStrategicAdvisor.processQuery('sim, pode confirmar');
      const byBill = {};
      window.linsoraStore.state.recurringBills.forEach((b) => { byBill[b.id] = b.title; });
      return {
        statuses: window.linsoraStore.state.occurrences
          .map((o) => `${byBill[o.recurringBillId]}:${o.dueDate}:${o.status}`).sort(),
        committed: window.linsoraStore.getCommittedAmountUntil('2026-09-30').total,
      };
    });
    expect(after.statuses).toContain('Energia:2026-09-28:PAID');
    expect(after.statuses).toContain('Aluguel:2026-09-30:PENDING');
    expect(after.committed).toBe(2000);
  });

  test('Cenário 2 (Começar do zero): nada migra, comprometido 0', async ({ page }) => {
    await seedScenario(page);
    await page.evaluate((id) => {
      window.supabaseRepo.recordGuestClaimDeclined(id, { bills: [], occs: [], guestKeys: [] });
    }, AUTH_UUID);
    const st = await claimLogin(page, AUTH_UUID, true);
    expect(st.bills).toEqual([]);
    expect(st.committed.total).toBe(0);
    expect(st.receipt?.result).toBe('declined');
  });

  test('Cenário 3: só recorrências migram; financeiro do destino intacto', async ({ page }) => {
    await seedScenario(page);
    const st = await claimLogin(page, AUTH_UUID, true);
    expect(st.txDescs).toEqual(['Salario']);
    expect(st.bills.sort()).toEqual(['Aluguel', 'Energia']);
    const accs = await page.evaluate(() => window.linsoraStore.state.accounts.map((a) => a.name));
    expect(accs).toEqual(['Conta Auth']);
  });

  test('Cenário 4: conta de outro UUID nunca é importada', async ({ page }) => {
    await seedScenario(page);
    const st = await claimLogin(page, AUTH_UUID, true);
    expect(st.bills.some((t) => t === 'Conta Alheia')).toBe(false);
  });

  test('Cenário 5: dupla execução + reload não duplicam; recibo idempotente', async ({ page }) => {
    await seedScenario(page);
    await claimLogin(page, AUTH_UUID, true);
    const again = await claimLogin(page, AUTH_UUID, true);
    expect(again.bills.sort()).toEqual(['Aluguel', 'Energia']);
    expect(again.committed.total).toBe(2300);

    await page.reload();
    await page.waitForFunction(() => typeof window.supabaseRepo?.getDbData === 'function', { timeout: 10000 });
    const st = await page.evaluate(async (id) => {
      const db = await window.supabaseRepo.getDbData(id, { id, email: 'auth@linsora.com.br', name: 'Auth' });
      window.linsoraStore.state = db;
      window.linsoraStore.ensureCycleOccurrences();
      return {
        bills: window.linsoraStore.state.recurringBills.map((b) => b.title).sort(),
        committed: window.linsoraStore.getCommittedAmountUntil('2026-09-30').total,
        receipt: window.supabaseRepo.getGuestClaimReceipt(id),
      };
    }, AUTH_UUID);
    expect(st.bills).toEqual(['Aluguel', 'Energia']);
    expect(st.committed).toBe(2300);
    expect(st.receipt?.result).toBe('imported');
  });

  test('Cenário 6a (UI): registro real exibe o prompt e Importar transfere', async ({ page }) => {
    await page.evaluate(() => {
      const guestBlob = {
        user: { id: 'usr_guest', name: 'Visitante', email: 'visitante@linsora.com.br' },
        accounts: [], transactions: [], goals: [], cards: [], pixKeys: [], fixedBills: [],
        recurringBills: [
          { id: 'rb_energia', userId: 'usr_guest', title: 'Energia', amount: 300, category: 'Moradia', frequency: 'MONTHLY', dueDay: 28, startDate: '2026-01-01', endDate: null, active: true },
          { id: 'rb_aluguel', userId: 'usr_guest', title: 'Aluguel', amount: 2000, category: 'Moradia', frequency: 'MONTHLY', dueDay: 30, startDate: '2026-01-01', endDate: null, active: true },
        ],
        occurrences: [],
      };
      localStorage.setItem('LINSORA_DB_CACHE_usr_guest', JSON.stringify(guestBlob));
    });
    // Sair do modo teste e registrar conta nova pelo formulário real.
    await page.click('.bottom-nav .nav-item[data-tab="tabProfile"]');
    await expect(page.locator('#tabProfile')).toBeVisible();
    await page.click('#btnLogout');
    await expect(page.locator('#authScreen')).toBeVisible();
    await page.click('#btnToggleAuthMode');
    await page.fill('#authName', 'Novo Claim');
    await page.fill('#authEmail', 'claim@linsora.com.br');
    await page.fill('#authPassword', 'senha123');
    await page.fill('#authConfirmPassword', 'senha123');
    await page.click('#btnSubmitAuth');

    await expect(page.locator('#modalConfirmDelete:not(.hidden)')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#confirmDeleteTitle')).toHaveText('Importar compromissos?');
    await expect(page.locator('#confirmDeleteMsg')).toContainText('Deseja importar esses compromissos para sua conta?');
    await expect(page.locator('#btnConfirmDeleteCancel')).toHaveText('Começar do zero');
    await page.click('#btnConfirmDeleteConfirm');

    await expect(page.locator('#appMain')).toBeVisible({ timeout: 8000 });
    const st = await page.evaluate(() => ({
      bills: window.linsoraStore.state.recurringBills.map((b) => b.title).sort(),
      committed: window.linsoraStore.getCommittedAmountUntil('2026-09-30').total,
    }));
    expect(st.bills).toEqual(['Aluguel', 'Energia']);
    expect(st.committed).toBe(2300);
  });

  test('Cenário 6b (UI): Começar do zero não transfere e registra recibo', async ({ page }) => {
    await page.evaluate(() => {
      const guestBlob = {
        user: { id: 'usr_guest', name: 'Visitante', email: 'visitante@linsora.com.br' },
        accounts: [], transactions: [], goals: [], cards: [], pixKeys: [], fixedBills: [],
        recurringBills: [
          { id: 'rb_energia', userId: 'usr_guest', title: 'Energia', amount: 300, category: 'Moradia', frequency: 'MONTHLY', dueDay: 28, startDate: '2026-01-01', endDate: null, active: true },
        ],
        occurrences: [],
      };
      localStorage.setItem('LINSORA_DB_CACHE_usr_guest', JSON.stringify(guestBlob));
    });
    await page.click('.bottom-nav .nav-item[data-tab="tabProfile"]');
    await expect(page.locator('#tabProfile')).toBeVisible();
    await page.click('#btnLogout');
    await expect(page.locator('#authScreen')).toBeVisible();
    await page.click('#btnToggleAuthMode');
    await page.fill('#authName', 'Zero Claim');
    await page.fill('#authEmail', 'zero@linsora.com.br');
    await page.fill('#authPassword', 'senha123');
    await page.fill('#authConfirmPassword', 'senha123');
    await page.click('#btnSubmitAuth');

    await expect(page.locator('#modalConfirmDelete:not(.hidden)')).toBeVisible({ timeout: 8000 });
    await page.click('#btnConfirmDeleteCancel');

    await expect(page.locator('#appMain')).toBeVisible({ timeout: 8000 });
    const st = await page.evaluate(() => ({
      bills: window.linsoraStore.state.recurringBills.length,
      committed: window.linsoraStore.getCommittedAmountUntil('2026-09-30').total,
      uid: window.linsoraStore.state.user.id,
    }));
    expect(st.bills).toBe(0);
    expect(st.committed).toBe(0);
    const receipt = await page.evaluate((id) => window.supabaseRepo.getGuestClaimReceipt(id), st.uid);
    expect(receipt?.result).toBe('declined');
  });
});
