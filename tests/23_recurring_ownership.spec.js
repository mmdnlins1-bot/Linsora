const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.use({ timezoneId: 'America/Sao_Paulo' });

// 23. Titularidade com consentimento: placeholder guest NUNCA migra sozinho.
// Somente com reivindicação consentida (recibo LINSORA_GUEST_CLAIMS) as linhas
// passam ao usuário. UUID/usr_<hash> concreto de outro usuário, jamais.
// Roda nos projetos chromium (desktop) e mobile-chrome (mobile) via config.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIXED_NOW = new Date('2026-09-25T12:00:00-03:00');
const AUTH_UUID = '123e4567-e89b-42d3-a456-426614174000';
const FOREIGN_UUID = '123e4567-e89b-42d3-a456-426614174999';

test.describe('23. Titularidade com consentimento', () => {

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

  async function seedGuest(page) {
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
        bills: window.linsoraStore.state.recurringBills.map((b) => ({ title: b.title, id: b.id, userId: b.userId })),
        occs: window.linsoraStore.state.occurrences.map((o) => ({ dueDate: o.dueDate, status: o.status, userId: o.userId })),
        committed: window.linsoraStore.getCommittedAmountUntil('2026-09-30').total,
        receipt: window.supabaseRepo.getGuestClaimReceipt(id),
      };
    }, [uuid, claimFlag]);
  }

  test('Sem consentimento: nada migra; isolamento intacto', async ({ page }) => {
    await seedGuest(page);
    const st = await claimLogin(page, AUTH_UUID, false);
    expect(st.bills).toEqual([]);
    expect(st.occs).toEqual([]);
    expect(st.committed).toBe(0);
    expect(st.receipt).toBe(null);
  });

  test('ensure sozinho nunca adota placeholder em memória', async ({ page }) => {
    const out = await page.evaluate((authId) => {
      window.linsoraStore.state.user.id = authId;
      window.linsoraStore.state.recurringBills.push({
        id: 'rb_guest', userId: 'usr_guest', title: 'Guest', amount: 100,
        category: 'Moradia', frequency: 'MONTHLY', dueDay: 28,
        startDate: '2026-01-01', endDate: null, active: true,
      });
      window.linsoraStore.ensureCycleOccurrences();
      const bill = window.linsoraStore.state.recurringBills.find((b) => b.title === 'Guest');
      return {
        owner: bill.userId,
        committed: window.linsoraStore.getCommittedAmountUntil('2026-09-30').total,
      };
    }, AUTH_UUID);
    expect(out.owner).toBe('usr_guest');
    expect(out.committed).toBe(0);
  });

  test('Com consentimento: titularidade, UUIDs e R$2.300', async ({ page }) => {
    await seedGuest(page);
    const st = await claimLogin(page, AUTH_UUID, true);
    expect(st.bills.map((b) => b.title).sort()).toEqual(['Aluguel', 'Energia']);
    expect(st.bills.every((b) => b.userId === AUTH_UUID)).toBe(true);
    expect(st.bills.every((b) => UUID_RE.test(b.id))).toBe(true);
    expect(st.occs.every((o) => o.userId === AUTH_UUID)).toBe(true);
    expect(st.committed).toBe(2300);
    expect(st.receipt?.result).toBe('imported');
    expect(st.receipt?.bills?.length).toBe(2);
  });

  test('Recibo torna reaplicação idempotente sem nova pergunta', async ({ page }) => {
    await seedGuest(page);
    await claimLogin(page, AUTH_UUID, true);
    const again = await claimLogin(page, AUTH_UUID, false);
    expect(again.bills.map((b) => b.title).sort()).toEqual(['Aluguel', 'Energia']);
    expect(again.occs.filter((o) => o.dueDate === '2026-09-28').length).toBe(1);
    expect(again.occs.filter((o) => o.dueDate === '2026-09-30').length).toBe(1);
    expect(again.committed).toBe(2300);
  });

  test('Recusa ("Começar do zero") registra recibo e nada transfere', async ({ page }) => {
    await seedGuest(page);
    await page.evaluate((id) => {
      window.supabaseRepo.recordGuestClaimDeclined(id, { bills: ['rb_energia', 'rb_aluguel'], occs: [], guestKeys: [] });
    }, AUTH_UUID);
    const st = await claimLogin(page, AUTH_UUID, true);
    expect(st.bills).toEqual([]);
    expect(st.committed).toBe(0);
    expect(st.receipt?.result).toBe('declined');
  });

  test('UUID concreto de outro usuário nunca é importado, nem com flag', async ({ page }) => {
    await page.evaluate((foreignId) => {
      const otherBlob = {
        user: { id: foreignId, name: 'Outro', email: 'outro@linsora.com.br' },
        accounts: [], transactions: [], goals: [], cards: [], pixKeys: [], fixedBills: [],
        recurringBills: [
          { id: 'rb_alheia', userId: foreignId, title: 'Conta Alheia', amount: 999, category: 'Moradia', frequency: 'MONTHLY', dueDay: 28, startDate: '2026-01-01', endDate: null, active: true },
        ],
        occurrences: [],
      };
      localStorage.setItem(`LINSORA_DB_CACHE_${foreignId}`, JSON.stringify(otherBlob));
    }, FOREIGN_UUID);
    const st = await claimLogin(page, AUTH_UUID, true);
    expect(st.bills.some((b) => b.title === 'Conta Alheia')).toBe(false);
    expect(st.committed).toBe(0);
  });
});
