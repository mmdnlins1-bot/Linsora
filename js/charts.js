/**
 * ============================================================================
 * LINSORA — ENGINE DE GRÁFICOS INTERATIVOS & FLUXO DE CAIXA (charts.js)
 * Tooltips ricos, alternância Entradas/Saídas/Saldo e Donut + Lista Legível
 * ============================================================================
 */

class LinsoraChartEngineService {
  constructor() {
    this.cashflowInstance = null;
    this.categoryInstance = null;
  }

  /**
   * Renderiza o gráfico de Fluxo de Caixa (Entradas, Saídas ou Saldo)
   */
  renderCashflowChart(canvasId, transactions = [], period = 'monthly', metric = 'all') {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (this.cashflowInstance) {
      this.cashflowInstance.destroy();
    }

    const chartData = this.aggregateCashflowData(transactions, period);
    const datasets = [];

    if (metric === 'all' || metric === 'incomes') {
      datasets.push({
        label: 'Entradas (R$)',
        data: chartData.incomes,
        borderColor: '#10B981',
        backgroundColor: 'rgba(16, 185, 129, 0.15)',
        fill: true,
        tension: 0.35,
        borderWidth: 3,
        pointRadius: 4,
        pointBackgroundColor: '#10B981'
      });
    }

    if (metric === 'all' || metric === 'expenses') {
      datasets.push({
        label: 'Saídas (R$)',
        data: chartData.expenses,
        borderColor: '#EF4444',
        backgroundColor: 'rgba(239, 68, 68, 0.15)',
        fill: true,
        tension: 0.35,
        borderWidth: 3,
        pointRadius: 4,
        pointBackgroundColor: '#EF4444'
      });
    }

    if (metric === 'balance') {
      const balanceData = chartData.incomes.map((inc, i) => inc - chartData.expenses[i]);
      datasets.push({
        label: 'Saldo Líquido (R$)',
        data: balanceData,
        borderColor: '#06B6D4',
        backgroundColor: 'rgba(6, 182, 212, 0.15)',
        fill: true,
        tension: 0.35,
        borderWidth: 3,
        pointRadius: 4,
        pointBackgroundColor: '#06B6D4'
      });
    }

    if (window.Chart) {
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      const textColor = isLight ? '#475569' : '#94A3B8';
      const gridColor = isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.05)';
      const tooltipBg = isLight ? '#FFFFFF' : '#0F172A';
      const tooltipTitle = isLight ? '#0F172A' : '#F8FAFC';
      const tooltipBorder = isLight ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.1)';

      this.cashflowInstance = new Chart(ctx, {
        type: 'line',
        data: {
          labels: chartData.labels,
          datasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              labels: { color: textColor, font: { family: 'Plus Jakarta Sans', size: 12, weight: '600' } }
            },
            tooltip: {
              backgroundColor: tooltipBg,
              titleColor: tooltipTitle,
              bodyColor: textColor,
              borderColor: tooltipBorder,
              borderWidth: 1,
              padding: 12,
              displayColors: true,
              callbacks: {
                label: (ctx) => ` ${ctx.dataset.label}: ${LinsoraUtils.formatBRL(ctx.raw, window.linsoraStore.isHideValues)}`
              }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: textColor, font: { family: 'Plus Jakarta Sans', size: 11 } }
            },
            y: {
              grid: { color: gridColor },
              ticks: {
                color: textColor,
                font: { family: 'Plus Jakarta Sans', size: 11 },
                callback: (val) => window.linsoraStore.isHideValues ? 'R$ •••' : `R$ ${val}`
              }
            }
          }
        }
      });
    }
  }

  aggregateCashflowData(transactions = [], period = 'monthly') {
    if (!transactions || transactions.length === 0) {
      return {
        labels: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun'],
        incomes: [0, 0, 0, 0, 0, 0],
        expenses: [0, 0, 0, 0, 0, 0]
      };
    }

    if (period === 'daily') {
      const daysMap = {};
      const today = new Date();
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const iso = d.toISOString().split('T')[0];
        const label = `${d.getDate()}/${d.getMonth() + 1}`;
        daysMap[iso] = { label, income: 0, expense: 0 };
      }

      transactions.forEach(t => {
        if (daysMap[t.date]) {
          if (t.type === 'RECEITA') daysMap[t.date].income += t.amount;
          else daysMap[t.date].expense += t.amount;
        }
      });

      const keys = Object.keys(daysMap);
      return {
        labels: keys.map(k => daysMap[k].label),
        incomes: keys.map(k => daysMap[k].income),
        expenses: keys.map(k => daysMap[k].expense)
      };
    } else if (period === 'weekly') {
      const weeks = ['Semana 1', 'Semana 2', 'Semana 3', 'Semana 4'];
      const incomes = [0, 0, 0, 0];
      const expenses = [0, 0, 0, 0];

      transactions.forEach(t => {
        const day = parseInt(t.date.split('-')[2]) || 1;
        const weekIdx = Math.min(3, Math.floor((day - 1) / 7));
        if (t.type === 'RECEITA') incomes[weekIdx] += t.amount;
        else expenses[weekIdx] += t.amount;
      });

      return { labels: weeks, incomes, expenses };
    } else {
      const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
      const incomes = new Array(12).fill(0);
      const expenses = new Array(12).fill(0);

      transactions.forEach(t => {
        const m = parseInt(t.date.split('-')[1]) - 1;
        if (m >= 0 && m < 12) {
          if (t.type === 'RECEITA') incomes[m] += t.amount;
          else expenses[m] += t.amount;
        }
      });

      return { labels: months.slice(0, 6), incomes: incomes.slice(0, 6), expenses: expenses.slice(0, 6) };
    }
  }

  /**
   * Renderiza o Gráfico de Rosca por Categorias de Gasto e Lista Detalhada
   */
  renderCategoryDonutChart(canvasId, transactions = [], legendGridId) {
    const canvas = document.getElementById(canvasId);
    const legendGrid = document.getElementById(legendGridId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (this.categoryInstance) {
      this.categoryInstance.destroy();
    }

    const expenses = (transactions || []).filter(t => t.type === 'DESPESA');
    
    if (expenses.length === 0) {
      if (legendGrid) {
        legendGrid.innerHTML = `<p style="grid-column: 1/-1; text-align: center; color: var(--text-muted); font-size: 12px; padding: 20px;">Nenhuma despesa cadastrada no mês.</p>`;
      }
      return;
    }

    const categoryTotals = {};
    let totalExpenseSum = 0;

    expenses.forEach(t => {
      categoryTotals[t.category] = (categoryTotals[t.category] || 0) + t.amount;
      totalExpenseSum += t.amount;
    });

    const labels = Object.keys(categoryTotals);
    const dataVals = Object.values(categoryTotals);
    const colors = labels.map(c => LinsoraUtils.getCategoryColor(c));

    if (window.Chart) {
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      const tooltipBg = isLight ? '#FFFFFF' : '#0F172A';
      const tooltipTitle = isLight ? '#0F172A' : '#F8FAFC';
      const tooltipBody = isLight ? '#475569' : '#94A3B8';
      const tooltipBorder = isLight ? 'rgba(0, 0, 0, 0.12)' : 'rgba(255, 255, 255, 0.1)';
      const donutBorder = isLight ? '#FFFFFF' : '#131C2E';

      this.categoryInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels,
          datasets: [{
            data: dataVals,
            backgroundColor: colors,
            borderWidth: 2,
            borderColor: donutBorder
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: tooltipBg,
              titleColor: tooltipTitle,
              bodyColor: tooltipBody,
              borderColor: tooltipBorder,
              borderWidth: 1,
              padding: 10,
              callbacks: {
                label: (ctx) => {
                  const pct = totalExpenseSum > 0 ? ((ctx.raw / totalExpenseSum) * 100).toFixed(1) : 0;
                  return ` ${ctx.label}: ${LinsoraUtils.formatBRL(ctx.raw, window.linsoraStore.isHideValues)} (${pct}%)`;
                }
              }
            }
          },
          cutout: '70%'
        }
      });
    }

    if (legendGrid) {
      const hideValues = window.linsoraStore.isHideValues;
      legendGrid.innerHTML = labels.map((cat, idx) => {
        const val = categoryTotals[cat];
        const pct = totalExpenseSum > 0 ? ((val / totalExpenseSum) * 100).toFixed(0) : 0;
        const color = colors[idx];
        const icon = LinsoraUtils.getCategoryIcon(cat);

        return `
          <div class="category-list-row">
            <div class="cat-left">
              <span class="cat-dot" style="background-color: ${color};"></span>
              <span class="cat-icon">${icon}</span>
              <span class="cat-name">${LinsoraUtils.escapeHTML(cat)}</span>
            </div>
            <div class="cat-right">
              <span class="cat-pct-chip">${pct}%</span>
              <strong class="cat-val-text">${LinsoraUtils.formatBRL(val, hideValues)}</strong>
            </div>
          </div>
        `;
      }).join('');
    }
  }
}

window.LinsoraChartEngine = new LinsoraChartEngineService();
