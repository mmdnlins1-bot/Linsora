const { test, expect } = require('@playwright/test');

test.use({ timezoneId: 'America/Sao_Paulo' });

// 25. Claim na sessão restaurada (boot com sessão válida).
// Regressão do diagnóstico: DOMContentLoaded -> checkActiveSession ->
// loadUserData pulava resolveGuestRecurringConsent. Agora o boot restaurado
// oferece o MESMO consentimento explícito do login/registro, sem adoção
// automática de usr_guest e sem tocar em sw.js.
// Roda nos projetos chromium (desktop) e mobile-chrome (mobile) via config.

const FIXED_NOW = new Date('2026-09-25T12:00:00-03:00');
const AUTH_UUID = '123e4567-e89b-42d3-a456-426614174000';
const AUTH_B_UUID = '223e4567-e89b-42d3-a456-426614174111';
const FOREIGN_UUID = '123e4567-e89b-42d3-a456-426614174999';
const FOREIGN_HASH_ID = 'usr_abcdef12_testuser';

test.describe('25. Claim na sessao restaurada', () => {

  async function seedRestoredSession(page, authId, { withGuest = true, withForeign = false, foreignOwner = FOREIGN_UUID, destHasData = true } = {}) {
    await page.evaluate(([id, opts]) => {
      const guestBlob = {
        user: { id: 'usr_guest', name: 'Visitante', email: 'visitante@linsora.com.br' },
        accounts: [], transactions: [], goals: [], cards: [], pixKeys: [], fixedBills: [],
        recurringBills: opts.withGuest ? [
          { id: 'rb_energia', userId: 'usr_guest', title: 'Energia', amount: 300, category: 'Moradia', frequency: 'MONTHLY', dueDay: 28, startDate: '2026-01-01', endDate: null, active: true },
          { id: 'rb_aluguel', userId: 'usr_guest', title: 'Aluguel', amount: 2000, category: 'Moradia', frequency: 'MONTHLY', dueDay: 30, startDate: '2026-01-01', endDate: null, active: true },
        ] : [],
        occurrences: [],
      };
      const destBlob = {
        user: { id, name: 'Auth', email: 'auth@linsora.com.br' },
        accounts: opts.destHasData
          ? [{ id: 'acc_auth', userId: id, name: 'Conta Auth', balance: 0 }]
          : [],
        transactions: opts.destHasData
          ? [{ id: 'tx_auth', userId: id, type: 'RECEITA', description: 'Salario', amount: 10000, category: 'Salário', date: '2026-09-05', account: 'Conta Auth', status: 'CONCLUIDO' }]
          : [],
        goals: [], cards: [], pixKeys: [], fixedBills: [],
        recurringBills: [], occurrences: [],
      };
      localStorage.setItem('LINSORA_DB_CACHE_usr_guest', JSON.stringify(guestBlob));
      // Espelha também em LINSORA_DB_CACHE_guest: o init do boot lê essa chave
      // e o notify persiste o estado nela contido em usr_guest; sem o espelho,
      // o seed seria sobrescrito pelo estado vazio antes do claim (quirk
      // pré-existente de chave dupla, fora do escopo desta correção).
      localStorage.setItem('LINSORA_DB_CACHE_guest', JSON.stringify(guestBlob));
      localStorage.setItem(`LINSORA_DB_CACHE_${id}`, JSON.stringify(destBlob));
      if (opts.withForeign) {
        const otherBlob = {
          user: { id: opts.foreignOwner, name: 'Outro', email: 'outro@linsora.com.br' },
          accounts: [], transactions: [], goals: [], cards: [], pixKeys: [], fixedBills: [],
          recurringBills: [
            { id: 'rb_alheia', userId: opts.foreignOwner, title: 'Conta Alheia', amount: 999, category: 'Moradia', frequency: 'MONTHLY', dueDay: 28, startDate: '2026-01-01', endDate: null, active: true },
          ],
          occurrences: [],
        };
        localStorage.setItem(`LINSORA_DB_CACHE_${opts.foreignOwner}`, JSON.stringify(otherBlob));
      }
      localStorage.setItem('LINSORA_SEEN_ONBOARDING', 'true');
      localStorage.setItem('LINSORA_ACTIVE_LOCAL_SESSION', JSON.stringify({
        id, name: 'Auth', email: 'auth@linsora.com.br',
        avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&auto=format&fit=crop&q=80',
      }));
    }, [authId, { withGuest, withForeign, foreignOwner, destHasData }]);
  }

  async function bootWithSeededSession(page, authId, seedOpts) {
    await page.goto('/');
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.clock.install({ time: FIXED_NOW });
    await seedRestoredSession(page, authId, seedOpts);
    await page.reload();
    await page.waitForFunction(() => typeof window.grantAppAccess === 'function', { timeout: 10000 });
  }

  async function waitBootUser(page, authId) {
    await page.waitForFunction((id) => Boolean(
      window.linsoraStore && window.linsoraStore.state && window.linsoraStore.state.user && window.linsoraStore.state.user.id === id
    ), authId, { timeout: 10000 });
  }

  test('A — sessao restaurada exibe claim; Importar transfere R$2.300 e 2 opcoes', async ({ page }) => {
    await bootWithSeededSession(page, AUTH_UUID, { withGuest: true, destHasData: true });
    await waitBootUser(page, AUTH_UUID);

    await expect(page.locator('#modalConfirmDelete:not(.hidden)')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#confirmDeleteTitle')).toHaveText('Importar compromissos?');
    await page.click('#btnConfirmDeleteConfirm');

    await expect(page.locator('#appMain')).toBeVisible({ timeout: 8000 });
    const st = await page.evaluate(() => ({
      bills: window.linsoraStore.state.recurringBills.map((b) => ({ title: b.title, userId: b.userId })),
      committed: window.linsoraStore.getCommittedAmountUntil('2026-09-30').total,
      receipt: window.supabaseRepo.getGuestClaimReceipt(window.linsoraStore.state.user.id),
    }));
    expect(st.bills.map((b) => b.title).sort()).toEqual(['Aluguel', 'Energia']);
    expect(st.bills.every((b) => b.userId === AUTH_UUID)).toBe(true);
    expect(st.committed).toBe(2300);
    expect(st.receipt?.result).toBe('imported');

    const advice = await page.evaluate(() => {
      // Zona de proximidade: margem 7700, gasto 5000 -> restante 2700 <= 2x2300.
      const a = window.LinsoraStrategicAdvisor.processQuery('Posso gastar 5000 reais hoje?');
      return { titles: (a.commitmentOptions || []).map((o) => o.title).sort(), rec: a.recommendation };
    });
    expect(advice.titles).toEqual(['Aluguel', 'Energia']);
    expect(advice.rec).toContain('já pagou');
  });

  test('B — sessao restaurada + Comecar do zero: nada migra e nao pergunta de novo', async ({ page }) => {
    await bootWithSeededSession(page, AUTH_UUID, { withGuest: true, destHasData: true });
    await waitBootUser(page, AUTH_UUID);

    await expect(page.locator('#modalConfirmDelete:not(.hidden)')).toBeVisible({ timeout: 10000 });
    await page.click('#btnConfirmDeleteCancel');

    await expect(page.locator('#appMain')).toBeVisible({ timeout: 8000 });
    const st = await page.evaluate(() => ({
      bills: window.linsoraStore.state.recurringBills.length,
      committed: window.linsoraStore.getCommittedAmountUntil('2026-09-30').total,
      receipt: window.supabaseRepo.getGuestClaimReceipt(window.linsoraStore.state.user.id),
    }));
    expect(st.bills).toBe(0);
    expect(st.committed).toBe(0);
    expect(st.receipt?.result).toBe('declined');

    const cons = await page.evaluate(() => {
      const a = window.LinsoraStrategicAdvisor.processQuery('Posso gastar 2000 reais hoje?');
      return (a.commitmentOptions || []).length;
    });
    expect(cons).toBe(0);

    await page.reload();
    await waitBootUser(page, AUTH_UUID);
    await expect(page.locator('#appMain')).toBeVisible({ timeout: 8000 });
    await page.waitForTimeout(1500);
    await expect(page.locator('#modalConfirmDelete')).toHaveClass(/hidden/);
    const again = await page.evaluate(() => ({
      bills: window.linsoraStore.state.recurringBills.length,
      receipt: window.supabaseRepo.getGuestClaimReceipt(window.linsoraStore.state.user.id),
    }));
    expect(again.bills).toBe(0);
    expect(again.receipt?.result).toBe('declined');
  });

  test('C — apos Importar: reload sem modal e sem duplicacao', async ({ page }) => {
    await bootWithSeededSession(page, AUTH_UUID, { withGuest: true, destHasData: true });
    await waitBootUser(page, AUTH_UUID);
    await expect(page.locator('#modalConfirmDelete:not(.hidden)')).toBeVisible({ timeout: 10000 });
    await page.click('#btnConfirmDeleteConfirm');
    await expect(page.locator('#appMain')).toBeVisible({ timeout: 8000 });

    await page.reload();
    await waitBootUser(page, AUTH_UUID);
    await expect(page.locator('#appMain')).toBeVisible({ timeout: 8000 });
    await page.waitForTimeout(1500);
    await expect(page.locator('#modalConfirmDelete')).toHaveClass(/hidden/);

    const st = await page.evaluate(() => {
      const byBill = {};
      window.linsoraStore.state.recurringBills.forEach((b) => { byBill[b.id] = b.title; });
      return {
        bills: window.linsoraStore.state.recurringBills.map((b) => b.title).sort(),
        owners: window.linsoraStore.state.recurringBills.map((b) => b.userId),
        d28: window.linsoraStore.state.occurrences.filter((o) => o.dueDate === '2026-09-28').length,
        d30: window.linsoraStore.state.occurrences.filter((o) => o.dueDate === '2026-09-30').length,
        committed: window.linsoraStore.getCommittedAmountUntil('2026-09-30').total,
        receipt: window.supabaseRepo.getGuestClaimReceipt(window.linsoraStore.state.user.id),
      };
    });
    expect(st.bills).toEqual(['Aluguel', 'Energia']);
    expect(st.owners.every((id) => id === AUTH_UUID)).toBe(true);
    expect(st.d28).toBe(1);
    expect(st.d30).toBe(1);
    expect(st.committed).toBe(2300);
    expect(st.receipt?.result).toBe('imported');
  });

  test('D — isolamento: sem consentimento B continua com 0 (nenhuma adocao automatica)', async ({ page }) => {
    await bootWithSeededSession(page, AUTH_B_UUID, { withGuest: true, destHasData: true });
    await waitBootUser(page, AUTH_B_UUID);

    // Antes de responder ao modal, a conta restaurada ainda não adotou guest.
    const before = await page.evaluate(() => ({
      bills: window.linsoraStore.state.recurringBills.length,
      committed: window.linsoraStore.getCommittedAmountUntil('2026-09-30').total,
    }));
    expect(before.bills).toBe(0);
    expect(before.committed).toBe(0);

    await expect(page.locator('#modalConfirmDelete:not(.hidden)')).toBeVisible({ timeout: 10000 });
    await page.click('#btnConfirmDeleteCancel');

    const st = await page.evaluate(() => ({
      bills: window.linsoraStore.state.recurringBills.length,
      committed: window.linsoraStore.getCommittedAmountUntil('2026-09-30').total,
    }));
    expect(st.bills).toBe(0);
    expect(st.committed).toBe(0);
  });

  test('E — UUID ou usr_<hash> concreto de outro usuario nunca e candidato', async ({ page }) => {
    for (const owner of [FOREIGN_UUID, FOREIGN_HASH_ID]) {
      await bootWithSeededSession(page, AUTH_UUID, { withGuest: false, withForeign: true, foreignOwner: owner, destHasData: true });
      await waitBootUser(page, AUTH_UUID);
      await expect(page.locator('#appMain')).toBeVisible({ timeout: 8000 });
      await page.waitForTimeout(1500);
      await expect(page.locator('#modalConfirmDelete')).toHaveClass(/hidden/);
      const st = await page.evaluate(([id, fOwner]) => ({
        cands: window.supabaseRepo.findGuestRecurringCandidates(id),
        bills: window.linsoraStore.state.recurringBills.map((b) => b.title),
      }), [AUTH_UUID, owner]);
      expect(st.cands.bills).toEqual([]);
      expect(st.cands.occs).toEqual([]);
      expect(st.bills.some((t) => t === 'Conta Alheia')).toBe(false);
    }
  });
});
