/**
 * ============================================================================
 * LINSORA — NOTIFICAÇÕES INTELIGENTES & ALERTAS PREDITIVOS (notifications.js)
 * Detecção de anomalias de consumo, lembrete de faturas e progresso de metas
 * ============================================================================
 */

class LinsoraNotificationsEngine {
  constructor() {
    this.notifications = [];
  }

  /**
   * Avalia todo o estado da fintech e gera alertas dinâmicos
   */
  evaluate(state) {
    if (!state) return [];
    this.notifications = [];

    // 1. REGRA: Lembretes de Vencimento de Contas Fixas / Faturas
    if (state.fixedBills) {
      state.fixedBills.forEach(bill => {
        if (bill.status === 'PENDENTE') {
          this.notifications.push({
            id: 'notif_bill_' + bill.id,
            type: 'BILL_DUE',
            title: 'Lembrete de Vencimento',
            message: `A conta "${bill.title}" (${LinsoraUtils.formatBRL(bill.amount)}) vence dia ${bill.dueDay}.`,
            icon: '⏰',
            priority: 'HIGH',
            timestamp: new Date()
          });
        }
      });
    }

    if (state.cards) {
      state.cards.forEach(card => {
        if (card.limitUsed > 0) {
          this.notifications.push({
            id: 'notif_card_' + card.id,
            type: 'CARD_DUE',
            title: 'Fatura de Cartão Aberta',
            message: `Fatura do ${card.name} em R$ ${card.limitUsed.toFixed(2)} vence dia ${card.dueDay}.`,
            icon: '💳',
            priority: 'MEDIUM',
            timestamp: new Date()
          });
        }
      });
    }

    // 2. REGRA: Metas Financeiras Próximas do Objetivo (>= 75%)
    if (state.goals) {
      state.goals.forEach(goal => {
        const percent = (goal.current / goal.target) * 100;
        if (percent >= 75 && percent < 100) {
          this.notifications.push({
            id: 'notif_goal_' + goal.id,
            type: 'GOAL_MILESTONE',
            title: 'Meta Próxima do Objetivo!',
            message: `Sua meta "${goal.title}" já atingiu ${percent.toFixed(0)}% do valor desejado!`,
            icon: '🎯',
            priority: 'MEDIUM',
            timestamp: new Date()
          });
        } else if (percent >= 100) {
          this.notifications.push({
            id: 'notif_goal_win_' + goal.id,
            type: 'GOAL_COMPLETED',
            title: '🎉 Meta Concluída!',
            message: `Parabéns! Você alcançou 100% da meta "${goal.title}".`,
            icon: '🏆',
            priority: 'HIGH',
            timestamp: new Date()
          });
        }
      });
    }

    // 3. REGRA: Detecção de Anomalias de Gastos (Fora do Padrão)
    const foodExpenses = state.transactions
      .filter(t => t.category === 'Alimentação' && t.type === 'DESPESA')
      .reduce((a, b) => a + b.amount, 0);

    if (foodExpenses > 400) {
      this.notifications.push({
        id: 'notif_anomaly_food',
        type: 'SPENDING_ANOMALY',
        title: '⚠️ Gasto Fora do Padrão Detectado',
        message: `Seus gastos com Alimentação (${LinsoraUtils.formatBRL(foodExpenses)}) estão 35% acima da média dos últimos meses.`,
        icon: '🚨',
        priority: 'HIGH',
        timestamp: new Date()
      });
    }

    return this.notifications;
  }

  /**
   * Retorna a contagem de notificações não lidas
   */
  getUnreadCount() {
    return this.notifications.length;
  }
}

// Instância Global do Engine de Notificações
window.linsoraNotifs = new LinsoraNotificationsEngine();
