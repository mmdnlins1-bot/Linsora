const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/auth');

test.describe('17. Contas Recorrentes (área própria)', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();
    await login(page);
    await page.evaluate(() => {
      document.querySelectorAll('.linsora-modal-overlay:not(.hidden)').forEach(m => {
        m.classList.add('hidden');
      });
    });
  });

  async function openBillsArea(page) {
    await page.click('#btnGoToRecurring');
    await expect(page.locator('#tabRecurringBills')).toBeVisible();
  }

  async function fillBillForm(page, { title, amount, category, dueDay, start, end }) {
    if (title !== undefined) await page.fill('#billTitleInput', title);
    if (amount !== undefined) await page.fill('#billAmountInput', amount);
    if (category) await page.selectOption('#billCategoryInput', category);
    if (dueDay !== undefined) await page.fill('#billDueDayInput', dueDay);
    if (start !== undefined) await page.fill('#billStartInput', start);
    if (end !== undefined) await page.fill('#billEndInput', end);
    await page.click('#btnSaveBill');
  }

  test('1/2: acesso pelo Início e retorno', async ({ page }) => {
    await expect(page.locator('#tabDashboard')).toBeVisible();
    await page.click('#btnGoToRecurring');
    await expect(page.locator('#tabRecurringBills')).toBeVisible();
    await expect(page.locator('#tabRecurringBills')).toContainText('Contas Recorrentes');
    await page.click('#btnBackToDashboard');
    await expect(page.locator('#tabDashboard')).toBeVisible();
  });

  test('3: estado vazio com copy final', async ({ page }) => {
    await openBillsArea(page);
    await expect(page.locator('#recurringBillsList')).toContainText('Você ainda não tem contas recorrentes cadastradas.');
    await expect(page.locator('#recurringBillsList')).toContainText('Cadastre contas como energia, água, internet e outras despesas mensais para acompanhar seus próximos compromissos.');
    await expect(page.locator('#recurringBillsList button')).toContainText('Adicionar conta');
  });

  test('4: abrir Nova conta', async ({ page }) => {
    await openBillsArea(page);
    await page.click('#btnAddRecurring');
    await expect(page.locator('#modalBillForm')).toBeVisible();
    await expect(page.locator('#billTitleInput')).toBeVisible();
    await expect(page.locator('#billAmountInput')).toBeVisible();
    await expect(page.locator('#billCategoryInput')).toBeVisible();
    await expect(page.locator('#billDueDayInput')).toBeVisible();
    await expect(page.locator('#billStartInput')).toBeVisible();
    await expect(page.locator('#billEndInput')).toBeVisible();
  });

  test('5/6/8/9/10: validações do formulário', async ({ page }) => {
    await openBillsArea(page);
    await page.click('#btnAddRecurring');

    await page.click('#btnSaveBill');
    await expect(page.locator('#toastContainer')).toContainText('Informe o nome da conta.');
    await expect(page.locator('#modalBillForm')).toBeVisible();

    await page.fill('#billTitleInput', 'Internet');
    await page.click('#btnSaveBill');
    await expect(page.locator('#toastContainer')).toContainText('Informe um valor maior que zero.');

    await page.fill('#billAmountInput', '10000');
    await page.fill('#billDueDayInput', '');
    await page.click('#btnSaveBill');
    await expect(page.locator('#toastContainer')).toContainText('dia de vencimento');

    await page.fill('#billDueDayInput', '10');
    await page.click('#btnSaveBill');
    await expect(page.locator('#toastContainer')).toContainText('data de início');

    await page.fill('#billStartInput', '2026-02-01');
    await page.fill('#billEndInput', '2026-01-01');
    await page.click('#btnSaveBill');
    await expect(page.locator('#toastContainer')).toContainText('anterior à data inicial');
    await expect(page.locator('#modalBillForm')).toBeVisible();
  });

  test('7: categoria obrigatória (nível store)', async ({ page }) => {
    const ok = await page.evaluate(() => window.linsoraStore.addRecurringBill({
      title: 'Sem Categoria', amount: 50, category: '',
      frequency: 'MONTHLY', due_day: 10, start_date: '2026-01-01', end_date: null,
    }));
    expect(ok).toBe(false);
  });

  test('11: criação com sucesso', async ({ page }) => {
    await openBillsArea(page);
    await page.click('#btnAddRecurring');
    await fillBillForm(page, {
      title: 'Internet Fibra', amount: '10000', category: 'Moradia',
      dueDay: '10', start: '2026-01-01',
    });
    await expect(page.locator('#modalBillForm')).toHaveClass(/hidden/);
    await expect(page.locator('#recurringBillsList')).toContainText('Internet Fibra');
    await expect(page.locator('#recurringBillsList')).toContainText('R$ 100,00');
    await expect(page.locator('#recurringBillsList')).toContainText('ATIVA');
    await expect(page.locator('#toastContainer')).toContainText('cadastrada com sucesso');
  });

  test('12: edição preserva histórico (PAID e PENDING intactos)', async ({ page }) => {
    const ids = await page.evaluate(async () => {
      const bill = await window.linsoraStore.addRecurringBill({
        title: 'Luz Edit', amount: 200, category: 'Moradia',
        frequency: 'MONTHLY', due_day: 10, start_date: '2026-01-01', end_date: null,
      });
      window.linsoraStore.ensureRecurringOccurrences('2026-09-01', '2026-10-31');
      const occs = window.linsoraStore.state.occurrences.filter(o => o.recurringBillId === bill.id);
      await window.linsoraStore.setOccurrenceStatus(occs[0].id, { status: 'PAID' });
      return { billId: bill.id, paidId: occs[0].id, pendingId: occs[1].id };
    });

    await openBillsArea(page);
    await page.click(`.btn-edit-bill[data-bill-id="${ids.billId}"]`);
    await expect(page.locator('#modalBillForm')).toBeVisible();
    await expect(page.locator('#billTitleInput')).toHaveValue('Luz Edit');
    await page.fill('#billTitleInput', 'Luz Editada');
    await page.fill('#billAmountInput', '35000');
    await page.click('#btnSaveBill');
    await expect(page.locator('#modalBillForm')).toHaveClass(/hidden/);
    await expect(page.locator('#recurringBillsList')).toContainText('Luz Editada');

    const after = await page.evaluate(([bid, pid, did]) => {
      const paid = window.linsoraStore.state.occurrences.find(o => o.id === pid);
      const pend = window.linsoraStore.state.occurrences.find(o => o.id === did);
      return {
        paidStatus: paid.status, paidAmount: paid.expectedAmount,
        pendStatus: pend.status, pendAmount: pend.expectedAmount,
      };
    }, [ids.billId, ids.paidId, ids.pendingId]);
    expect(after.paidStatus).toBe('PAID');
    expect(after.paidAmount).toBe(200);
    expect(after.pendStatus).toBe('PENDING');
    expect(after.pendAmount).toBe(200);
  });

  test('15/16/17/18/19: desativar, reativar e SKIPPED', async ({ page }) => {
    const ids = await page.evaluate(async () => {
      const bill = await window.linsoraStore.addRecurringBill({
        title: 'TV Toggle', amount: 80, category: 'Lazer',
        frequency: 'MONTHLY', due_day: 10, start_date: '2020-01-01', end_date: null,
      });
      // Janela passada (PENDING vencida) + intermediária + futura (PENDING futura)
      window.linsoraStore.ensureRecurringOccurrences('2020-01-01', '2020-01-31');
      window.linsoraStore.ensureRecurringOccurrences('2021-06-01', '2021-06-30');
      window.linsoraStore.ensureRecurringOccurrences('2099-01-01', '2099-01-31');
      const occs = window.linsoraStore.state.occurrences.filter(o => o.recurringBillId === bill.id);
      await window.linsoraStore.setOccurrenceStatus(occs[0].id, { status: 'PAID' });
      return { billId: bill.id };
    });

    await openBillsArea(page);
    await page.click(`.btn-toggle-bill[data-bill-id="${ids.billId}"]`);
    await expect(page.locator('#recurringBillsList')).toContainText('INATIVA');

    const st = await page.evaluate(([bid]) => {
      const occs = window.linsoraStore.state.occurrences.filter(o => o.recurringBillId === bid);
      return occs.map(o => ({ due: o.dueDate, status: o.status, reason: o.skippedReason || null }));
    }, [ids.billId]);
    const futura = st.find(o => o.due.startsWith('2099-'));
    const vencida = st.find(o => o.due.startsWith('2021-'));
    expect(futura.status).toBe('SKIPPED');
    expect(futura.reason).toBe('Regra desativada');
    expect(vencida.status).toBe('PENDING');

    const paidKept = await page.evaluate(([bid]) => window.linsoraStore.state.occurrences
      .filter(o => o.recurringBillId === bid && o.status === 'PAID').length, [ids.billId]);
    expect(paidKept).toBe(1);

    // 19: reativar não restaura SKIPPED
    await page.click(`.btn-toggle-bill[data-bill-id="${ids.billId}"]`);
    await expect(page.locator('#recurringBillsList')).toContainText('ATIVA');
    const skippedKept = await page.evaluate(([bid]) => window.linsoraStore.state.occurrences
      .filter(o => o.recurringBillId === bid && o.status === 'SKIPPED').length, [ids.billId]);
    expect(skippedKept).toBe(1);
  });

  test('20: exclusão com confirmação e cascade local', async ({ page }) => {
    await page.evaluate(async () => {
      const bill = await window.linsoraStore.addRecurringBill({
        title: 'Revista Del', amount: 30, category: 'Lazer',
        frequency: 'MONTHLY', due_day: 10, start_date: '2026-01-01', end_date: null,
      });
      window.linsoraStore.ensureRecurringOccurrences('2026-09-01', '2026-09-30');
      await window.linsoraStore.saveTransaction({
        type: 'DESPESA', amount: 30, description: 'Revista Paga',
        category: 'Lazer', date: '2026-09-05', account: 'Conta',
        repetition: 'SINGLE', notes: '',
      });
    });

    await openBillsArea(page);
    await page.click('.btn-delete-bill[data-bill-title="Revista Del"]');
    await expect(page.locator('#modalConfirmDelete')).not.toHaveClass(/hidden/);
    await expect(page.locator('#confirmDeleteTitle')).toContainText('Excluir conta recorrente?');
    await expect(page.locator('#confirmDeleteMsg')).toContainText('histórico de ocorrências');
    await page.click('#btnConfirmDeleteConfirm');

    await expect(page.locator('#recurringBillsList')).not.toContainText('Revista Del');
    const gone = await page.evaluate(() => ({
      bills: window.linsoraStore.state.recurringBills.length,
      occs: window.linsoraStore.state.occurrences.length,
      txs: window.linsoraStore.state.transactions.filter(t => t.description === 'Revista Paga').length,
    }));
    expect(gone.bills).toBe(0);
    expect(gone.occs).toBe(0);
    expect(gone.txs).toBe(1);
  });

  test('21/22: ordenação por vencimento e desempate por nome', async ({ page }) => {
    await page.evaluate(async () => {
      for (const [title, due] of [['Zebra', 5], ['Alfa', 5], ['Meio', 20]]) {
        await window.linsoraStore.addRecurringBill({
          title, amount: 10, category: 'Outros',
          frequency: 'MONTHLY', due_day: due, start_date: '2020-01-01', end_date: null,
        });
      }
    });
    await openBillsArea(page);
    const titles = await page.locator('#recurringBillsList .goal-title').allInnerTexts();
    expect(titles.map(t => t.trim())).toEqual(['🧾 Alfa', '🧾 Zebra', '🧾 Meio']);
  });

  test('23: INATIVA não gera novas ocorrências', async ({ page }) => {
    const before = await page.evaluate(async () => {
      const bill = await window.linsoraStore.addRecurringBill({
        title: 'Clube Off', amount: 60, category: 'Lazer',
        frequency: 'MONTHLY', due_day: 10, start_date: '2020-01-01', end_date: null,
      });
      await window.linsoraStore.toggleRecurringBillActive(bill.id);
      return window.linsoraStore.state.occurrences.length;
    });
    const added = await page.evaluate(
      () => window.linsoraStore.ensureRecurringOccurrences('2099-06-01', '2099-06-30')
    );
    const after = await page.evaluate(() => window.linsoraStore.state.occurrences.length);
    expect(added).toBe(0);
    expect(after).toBe(before);
  });

  test('24/25: próximos compromissos no Início, máximo 3', async ({ page }) => {
    await page.evaluate(async () => {
      for (const [title, due] of [['A Um', 5], ['A Dois', 8], ['A Três', 12], ['A Quatro', 20]]) {
        await window.linsoraStore.addRecurringBill({
          title, amount: 10, category: 'Outros',
          frequency: 'MONTHLY', due_day: due, start_date: '2020-01-01', end_date: null,
        });
      }
    });
    await expect(page.locator('#upcomingBillsList .fixed-bill-card')).toHaveCount(3);
    await page.click('#btnGoToRecurring');
    await expect(page.locator('#tabRecurringBills')).toBeVisible();
  });

  test('26: isolamento entre usuários', async ({ page }) => {
    await page.evaluate(async () => {
      await window.linsoraStore.addRecurringBill({
        title: 'Internet A', amount: 100, category: 'Serviços',
        frequency: 'MONTHLY', due_day: 10, start_date: '2026-01-01', end_date: null,
      });
    });
    await expect(page.locator('#upcomingBillsList .fixed-bill-card')).toHaveCount(1);

    await page.click('.bottom-nav .nav-item[data-tab="tabProfile"]');
    await expect(page.locator('#tabProfile')).toBeVisible();
    await page.click('#btnLogout');
    await expect(page.locator('#authScreen')).toBeVisible();

    await page.click('#btnToggleAuthMode');
    await page.fill('#authName', 'Usuário B');
    await page.fill('#authEmail', 'usuarioB@linsora.com.br');
    await page.fill('#authPassword', 'senha456');
    await page.fill('#authConfirmPassword', 'senha456');
    await page.click('#btnSubmitAuth');
    await expect(page.locator('#appMain')).toBeVisible();

    expect(await page.evaluate(
      () => window.linsoraStore.state.recurringBills.length
    )).toBe(0);
    await expect(page.locator('#upcomingBillsList .fixed-bill-card')).toHaveCount(0);
  });
});
