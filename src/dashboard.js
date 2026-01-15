// ===== Zendesk KPI Dashboard =====
// Power BI-Inspired Analytics Dashboard

// Global State
let currentData = {
  metrics: { date: '', reply: 0, chat: 0, inbound: 0, outbound: 0 },
  history: [],
  goals: { reply: 20, chat: 15, inbound: 10, outbound: 5 }
};
let currentRange = 7;
let charts = {};

// Color Palette
const COLORS = {
  reply: '#5046e5',
  chat: '#059669',
  inbound: '#d97706',
  outbound: '#7b1fa2',
  grid: '#3d3d3d',
  text: '#b3b3b3'
};

// ===== Initialization =====
document.addEventListener('DOMContentLoaded', () => {
  initializeEventListeners();
  loadData();
  setupChartDefaults();
});

// ===== Event Listeners =====
function initializeEventListeners() {
  // Tab Navigation
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Date Range Selector
  document.querySelectorAll('.range-btn').forEach(btn => {
    btn.addEventListener('click', () => changeDateRange(parseInt(btn.dataset.range)));
  });

  // Header Actions
  document.getElementById('refreshBtn').addEventListener('click', refreshData);
  document.getElementById('exportBtn').addEventListener('click', exportData);
  document.getElementById('settingsBtn').addEventListener('click', openSettings);

  // Settings Modal
  document.getElementById('closeSettingsBtn').addEventListener('click', closeSettings);
  document.getElementById('cancelSettingsBtn').addEventListener('click', closeSettings);
  document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);

  // Calendar Navigation
  document.getElementById('prevMonthBtn')?.addEventListener('click', () => navigateMonth(-1));
  document.getElementById('nextMonthBtn')?.addEventListener('click', () => navigateMonth(1));

  // Listen for storage changes (real-time updates)
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.metrics || changes.history || changes.goals) {
      loadData();
    }
  });
}

// ===== Data Loading =====
async function loadData() {
  try {
    const result = await chrome.storage.local.get(['metrics', 'history', 'goals']);

    currentData.metrics = result.metrics || { date: getTodayDate(), reply: 0, chat: 0, inbound: 0, outbound: 0 };
    currentData.history = result.history || [];
    currentData.goals = result.goals || { reply: 20, chat: 15, inbound: 10, outbound: 5 };

    updateLastUpdated();
    renderDashboard();
  } catch (error) {
    console.error('Error loading data:', error);
  }
}

function refreshData() {
  const btn = document.getElementById('refreshBtn');
  btn.style.transform = 'rotate(360deg)';
  setTimeout(() => {
    btn.style.transform = '';
  }, 500);
  loadData();
}

function updateLastUpdated() {
  const now = new Date();
  const timeString = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  document.getElementById('lastUpdated').textContent = `Last updated: ${timeString}`;
}

// ===== Dashboard Rendering =====
function renderDashboard() {
  renderOverviewTab();
  renderTrendsTab();
  renderAnalyticsTab();
  renderCalendarTab();
}

// ===== Overview Tab =====
function renderOverviewTab() {
  const { metrics, goals } = currentData;
  const yesterday = getYesterdayData();

  // Today's Performance Cards
  updateMetricCard('reply', metrics.reply, goals.reply, yesterday.reply);
  updateMetricCard('chat', metrics.chat, goals.chat, yesterday.chat);
  updateMetricCard('inbound', metrics.inbound, goals.inbound, yesterday.inbound);
  updateMetricCard('outbound', metrics.outbound, goals.outbound, yesterday.outbound);

  // Summary Statistics
  updateSummaryStats();

  // Charts
  createTodayVsGoalChart();
  createDistributionChart();
  createGoalCompletionChart();
}

function updateMetricCard(metric, value, goal, yesterdayValue) {
  const capitalMetric = metric.charAt(0).toUpperCase() + metric.slice(1);
  const progress = (value / goal) * 100;
  const change = value - yesterdayValue;
  const changeText = change >= 0 ? `+${change}` : `${change}`;
  const changeClass = change >= 0 ? 'positive' : 'negative';

  document.getElementById(`today${capitalMetric}`).textContent = value;
  document.getElementById(`goal${capitalMetric}`).textContent = goal;
  document.getElementById(`progress${capitalMetric}`).style.width = `${Math.min(progress, 100)}%`;

  const changeEl = document.getElementById(`change${capitalMetric}`);
  changeEl.textContent = `${changeText} from yesterday`;
  changeEl.className = `card-change ${changeClass}`;
}

function updateSummaryStats() {
  const rangeData = getRangeData(currentRange);
  const total = rangeData.reduce((sum, day) => sum + day.reply + day.chat + day.inbound + day.outbound, 0);
  const avg = rangeData.length > 0 ? (total / rangeData.length).toFixed(1) : 0;
  const bestDay = findBestDay(rangeData);
  const streak = calculateStreak();
  const goalRate = calculateGoalAchievementRate(rangeData);

  document.getElementById('rangeDays').textContent = currentRange;
  document.getElementById('totalActivities').textContent = total;
  document.getElementById('dailyAverage').textContent = avg;
  document.getElementById('bestDayValue').textContent = bestDay.total;
  document.getElementById('bestDayDate').textContent = bestDay.date;
  document.getElementById('currentStreak').textContent = streak;
  document.getElementById('goalAchievement').textContent = `${goalRate}%`;
}

// ===== Trends Tab =====
function renderTrendsTab() {
  createTrendsLineChart();
  createIndividualTrendCharts();
  createWeeklyComparisonChart();
}

function createTrendsLineChart() {
  const ctx = document.getElementById('trendsLineChart');
  if (!ctx) return;

  const rangeData = getRangeData(currentRange);
  const labels = rangeData.map(d => formatDate(d.date));

  destroyChart('trendsLineChart');

  charts.trendsLineChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Replies',
          data: rangeData.map(d => d.reply),
          borderColor: COLORS.reply,
          backgroundColor: COLORS.reply + '33',
          tension: 0.4,
          fill: true
        },
        {
          label: 'Chats',
          data: rangeData.map(d => d.chat),
          borderColor: COLORS.chat,
          backgroundColor: COLORS.chat + '33',
          tension: 0.4,
          fill: true
        },
        {
          label: 'Inbound Calls',
          data: rangeData.map(d => d.inbound),
          borderColor: COLORS.inbound,
          backgroundColor: COLORS.inbound + '33',
          tension: 0.4,
          fill: true
        },
        {
          label: 'Outbound Calls',
          data: rangeData.map(d => d.outbound),
          borderColor: COLORS.outbound,
          backgroundColor: COLORS.outbound + '33',
          tension: 0.4,
          fill: true
        }
      ]
    },
    options: getLineChartOptions('Performance Over Time')
  });
}

function createIndividualTrendCharts() {
  const metrics = ['reply', 'chat', 'inbound', 'outbound'];
  const labels = { reply: 'Replies', chat: 'Chats', inbound: 'Inbound Calls', outbound: 'Outbound Calls' };

  metrics.forEach(metric => {
    const ctx = document.getElementById(`${metric}TrendChart`);
    if (!ctx) return;

    const rangeData = getRangeData(currentRange);
    const chartLabels = rangeData.map(d => formatDate(d.date));
    const data = rangeData.map(d => d[metric]);
    const goal = currentData.goals[metric];

    destroyChart(`${metric}TrendChart`);

    charts[`${metric}TrendChart`] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: chartLabels,
        datasets: [
          {
            label: labels[metric],
            data: data,
            borderColor: COLORS[metric],
            backgroundColor: COLORS[metric] + '33',
            tension: 0.4,
            fill: true,
            borderWidth: 3
          },
          {
            label: 'Goal',
            data: Array(chartLabels.length).fill(goal),
            borderColor: '#ffffff',
            borderDash: [5, 5],
            borderWidth: 2,
            fill: false,
            pointRadius: 0
          }
        ]
      },
      options: getLineChartOptions(labels[metric])
    });
  });
}

function createWeeklyComparisonChart() {
  const ctx = document.getElementById('weeklyComparisonChart');
  if (!ctx) return;

  const weeklyData = getWeeklyAverages();

  destroyChart('weeklyComparisonChart');

  charts.weeklyComparisonChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: weeklyData.labels,
      datasets: [
        {
          label: 'Replies',
          data: weeklyData.reply,
          backgroundColor: COLORS.reply
        },
        {
          label: 'Chats',
          data: weeklyData.chat,
          backgroundColor: COLORS.chat
        },
        {
          label: 'Inbound Calls',
          data: weeklyData.inbound,
          backgroundColor: COLORS.inbound
        },
        {
          label: 'Outbound Calls',
          data: weeklyData.outbound,
          backgroundColor: COLORS.outbound
        }
      ]
    },
    options: getBarChartOptions('Weekly Average Comparison')
  });
}

// ===== Analytics Tab =====
function renderAnalyticsTab() {
  renderInsights();
  renderComparisonTable();
  createStackedAreaChart();
}

function renderInsights() {
  const rangeData = getRangeData(currentRange);
  const bestDay = findBestDay(rangeData);
  const goalRate = calculateGoalAchievementRate(rangeData);
  const trend = calculateTrend(rangeData);
  const topMetric = findTopMetric(rangeData);

  // Most Productive Day
  document.getElementById('mostProductiveDay').textContent = formatDate(bestDay.date);
  document.getElementById('mostProductiveDayDesc').textContent = `${bestDay.total} total activities`;

  // Goal Success Rate
  document.getElementById('goalSuccessRate').textContent = `${goalRate}%`;
  const daysMetGoal = rangeData.filter(day => {
    const { reply, chat, inbound, outbound } = day;
    const { goals } = currentData;
    return reply >= goals.reply || chat >= goals.chat || inbound >= goals.inbound || outbound >= goals.outbound;
  }).length;
  document.getElementById('goalSuccessDesc').textContent = `${daysMetGoal} of ${rangeData.length} days met at least one goal`;

  // Performance Trend
  document.getElementById('performanceTrend').textContent = trend.direction;
  document.getElementById('performanceTrendDesc').textContent = trend.description;

  // Top Metric
  document.getElementById('topMetric').textContent = topMetric.name;
  document.getElementById('topMetricDesc').textContent = `${topMetric.total} total in ${currentRange} days (${topMetric.percentage}%)`;
}

function renderComparisonTable() {
  const metrics = ['Reply', 'Chat', 'Inbound', 'Outbound'];
  const today = currentData.metrics;
  const yesterday = getYesterdayData();
  const avg7Day = calculateAverage(getRangeData(7));
  const avg30Day = calculateAverage(getRangeData(30));

  metrics.forEach(metric => {
    const key = metric.toLowerCase();
    const todayVal = today[key] || 0;
    const yesterdayVal = yesterday[key] || 0;
    const change = todayVal - yesterdayVal;
    const changePercent = yesterdayVal > 0 ? ((change / yesterdayVal) * 100).toFixed(1) : 0;
    const arrow = change > 0 ? '↑' : change < 0 ? '↓' : '→';
    const changeClass = change > 0 ? 'change-up' : change < 0 ? 'change-down' : '';

    document.getElementById(`cmpToday${metric}`).textContent = todayVal;
    document.getElementById(`cmpYesterday${metric}`).textContent = yesterdayVal;
    document.getElementById(`cmp7Day${metric}`).textContent = avg7Day[key].toFixed(1);
    document.getElementById(`cmp30Day${metric}`).textContent = avg30Day[key].toFixed(1);

    const changeEl = document.getElementById(`cmpChange${metric}`);
    changeEl.innerHTML = `<span class="change-indicator ${changeClass}">${arrow} ${Math.abs(changePercent)}%</span>`;
  });
}

function createStackedAreaChart() {
  const ctx = document.getElementById('stackedAreaChart');
  if (!ctx) return;

  const rangeData = getRangeData(currentRange);
  const labels = rangeData.map(d => formatDate(d.date));

  destroyChart('stackedAreaChart');

  charts.stackedAreaChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Replies',
          data: rangeData.map(d => d.reply),
          backgroundColor: COLORS.reply + '99',
          borderColor: COLORS.reply,
          fill: true
        },
        {
          label: 'Chats',
          data: rangeData.map(d => d.chat),
          backgroundColor: COLORS.chat + '99',
          borderColor: COLORS.chat,
          fill: true
        },
        {
          label: 'Inbound Calls',
          data: rangeData.map(d => d.inbound),
          backgroundColor: COLORS.inbound + '99',
          borderColor: COLORS.inbound,
          fill: true
        },
        {
          label: 'Outbound Calls',
          data: rangeData.map(d => d.outbound),
          backgroundColor: COLORS.outbound + '99',
          borderColor: COLORS.outbound,
          fill: true
        }
      ]
    },
    options: {
      ...getLineChartOptions('Activity Breakdown Over Time'),
      scales: {
        y: {
          stacked: true,
          grid: { color: COLORS.grid },
          ticks: { color: COLORS.text }
        },
        x: {
          grid: { color: COLORS.grid },
          ticks: { color: COLORS.text }
        }
      }
    }
  });
}

// ===== Calendar Tab =====
function renderCalendarTab() {
  generateCalendarHeatmap();
  createDayOfWeekChart();
}

function generateCalendarHeatmap(monthOffset = 0) {
  const container = document.getElementById('calendarHeatmap');
  if (!container) return;

  const today = new Date();
  const targetDate = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const year = targetDate.getFullYear();
  const month = targetDate.getMonth();

  // Update month label
  const monthLabel = targetDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  document.getElementById('calendarMonthLabel').textContent = monthLabel;

  // Get first and last day of month
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startDayOfWeek = firstDay.getDay();

  // Clear existing calendar
  container.innerHTML = '';

  // Add empty cells for days before month starts
  for (let i = 0; i < startDayOfWeek; i++) {
    const emptyCell = document.createElement('div');
    emptyCell.className = 'calendar-day empty';
    container.appendChild(emptyCell);
  }

  // Get data for the month
  const monthData = getMonthData(year, month);
  const maxValue = Math.max(...monthData.map(d => d.total), 1);

  // Add calendar days
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayData = monthData.find(d => d.date === dateStr) || { total: 0 };
    const level = getHeatmapLevel(dayData.total, maxValue);

    const dayCell = document.createElement('div');
    dayCell.className = 'calendar-day';
    dayCell.dataset.level = level;
    dayCell.dataset.date = dateStr;
    dayCell.innerHTML = `
      <div class="day-label">${day}</div>
      <div class="day-count">${dayData.total}</div>
    `;

    dayCell.title = `${dateStr}: ${dayData.total} activities`;
    container.appendChild(dayCell);
  }
}

function navigateMonth(direction) {
  const currentLabel = document.getElementById('calendarMonthLabel').textContent;
  const currentDate = new Date(currentLabel);
  const newMonth = currentDate.getMonth() + direction;
  const monthOffset = newMonth - new Date().getMonth();
  generateCalendarHeatmap(monthOffset);
}

function createDayOfWeekChart() {
  const ctx = document.getElementById('dayOfWeekChart');
  if (!ctx) return;

  const dayData = getDayOfWeekAverages();

  destroyChart('dayOfWeekChart');

  charts.dayOfWeekChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      datasets: [
        {
          label: 'Replies',
          data: dayData.reply,
          backgroundColor: COLORS.reply
        },
        {
          label: 'Chats',
          data: dayData.chat,
          backgroundColor: COLORS.chat
        },
        {
          label: 'Inbound Calls',
          data: dayData.inbound,
          backgroundColor: COLORS.inbound
        },
        {
          label: 'Outbound Calls',
          data: dayData.outbound,
          backgroundColor: COLORS.outbound
        }
      ]
    },
    options: getBarChartOptions('Average Activity by Day of Week')
  });
}

// ===== Chart Creation Helpers =====
function createTodayVsGoalChart() {
  const ctx = document.getElementById('todayChart');
  if (!ctx) return;

  const { metrics, goals } = currentData;

  destroyChart('todayChart');

  charts.todayChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Replies', 'Chats', 'Inbound', 'Outbound'],
      datasets: [
        {
          label: 'Today',
          data: [metrics.reply, metrics.chat, metrics.inbound, metrics.outbound],
          backgroundColor: [COLORS.reply, COLORS.chat, COLORS.inbound, COLORS.outbound]
        },
        {
          label: 'Goal',
          data: [goals.reply, goals.chat, goals.inbound, goals.outbound],
          backgroundColor: 'transparent',
          borderColor: '#ffffff',
          borderWidth: 2,
          borderDash: [5, 5]
        }
      ]
    },
    options: getBarChartOptions('Today vs Goals')
  });
}

function createDistributionChart() {
  const ctx = document.getElementById('distributionChart');
  if (!ctx) return;

  const { metrics } = currentData;
  const total = metrics.reply + metrics.chat + metrics.inbound + metrics.outbound;

  destroyChart('distributionChart');

  charts.distributionChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Replies', 'Chats', 'Inbound', 'Outbound'],
      datasets: [{
        data: [metrics.reply, metrics.chat, metrics.inbound, metrics.outbound],
        backgroundColor: [COLORS.reply, COLORS.chat, COLORS.inbound, COLORS.outbound],
        borderWidth: 2,
        borderColor: '#2d2d2d'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: COLORS.text, padding: 15, font: { size: 12 } }
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              const value = context.parsed;
              const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
              return `${context.label}: ${value} (${percentage}%)`;
            }
          }
        }
      }
    }
  });
}

function createGoalCompletionChart() {
  const ctx = document.getElementById('goalCompletionChart');
  if (!ctx) return;

  const { metrics, goals } = currentData;
  const completions = [
    (metrics.reply / goals.reply) * 100,
    (metrics.chat / goals.chat) * 100,
    (metrics.inbound / goals.inbound) * 100,
    (metrics.outbound / goals.outbound) * 100
  ];

  destroyChart('goalCompletionChart');

  charts.goalCompletionChart = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: ['Replies', 'Chats', 'Inbound', 'Outbound'],
      datasets: [{
        label: 'Goal Completion %',
        data: completions,
        backgroundColor: COLORS.reply + '33',
        borderColor: COLORS.reply,
        borderWidth: 2,
        pointBackgroundColor: COLORS.reply,
        pointBorderColor: '#fff',
        pointHoverBackgroundColor: '#fff',
        pointHoverBorderColor: COLORS.reply
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      scales: {
        r: {
          beginAtZero: true,
          max: 150,
          ticks: {
            stepSize: 25,
            color: COLORS.text,
            backdropColor: 'transparent'
          },
          grid: { color: COLORS.grid },
          pointLabels: { color: COLORS.text, font: { size: 12 } }
        }
      },
      plugins: {
        legend: {
          labels: { color: COLORS.text, font: { size: 12 } }
        },
        tooltip: {
          callbacks: {
            label: (context) => `${context.parsed.r.toFixed(1)}% complete`
          }
        }
      }
    }
  });
}

// ===== Chart Configuration =====
function setupChartDefaults() {
  Chart.defaults.color = COLORS.text;
  Chart.defaults.borderColor = COLORS.grid;
  Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
}

function getLineChartOptions(title) {
  return {
    responsive: true,
    maintainAspectRatio: true,
    interaction: {
      mode: 'index',
      intersect: false
    },
    plugins: {
      legend: {
        labels: { color: COLORS.text, padding: 15, font: { size: 12 } }
      },
      title: {
        display: false
      },
      tooltip: {
        backgroundColor: '#1b1b1b',
        borderColor: '#3d3d3d',
        borderWidth: 1,
        padding: 12,
        titleColor: '#ffffff',
        bodyColor: '#b3b3b3'
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        grid: { color: COLORS.grid },
        ticks: { color: COLORS.text }
      },
      x: {
        grid: { color: COLORS.grid },
        ticks: { color: COLORS.text }
      }
    }
  };
}

function getBarChartOptions(title) {
  return {
    responsive: true,
    maintainAspectRatio: true,
    plugins: {
      legend: {
        labels: { color: COLORS.text, padding: 15, font: { size: 12 } }
      },
      tooltip: {
        backgroundColor: '#1b1b1b',
        borderColor: '#3d3d3d',
        borderWidth: 1,
        padding: 12
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        grid: { color: COLORS.grid },
        ticks: { color: COLORS.text }
      },
      x: {
        grid: { display: false },
        ticks: { color: COLORS.text }
      }
    }
  };
}

function destroyChart(chartId) {
  if (charts[chartId]) {
    charts[chartId].destroy();
    delete charts[chartId];
  }
}

// ===== Data Utilities =====
function getRangeData(days) {
  const allData = [...currentData.history];

  // Include today's data if it's not in history yet
  if (currentData.metrics.date === getTodayDate()) {
    allData.push(currentData.metrics);
  }

  return allData.slice(-days).sort((a, b) => new Date(a.date) - new Date(b.date));
}

function getYesterdayData() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  const data = currentData.history.find(d => d.date === yesterdayStr);
  return data || { reply: 0, chat: 0, inbound: 0, outbound: 0 };
}

function getMonthData(year, month) {
  const allData = [...currentData.history];
  if (currentData.metrics.date === getTodayDate()) {
    allData.push(currentData.metrics);
  }

  return allData
    .filter(d => {
      const date = new Date(d.date);
      return date.getFullYear() === year && date.getMonth() === month;
    })
    .map(d => ({
      date: d.date,
      total: d.reply + d.chat + d.inbound + d.outbound
    }));
}

function getWeeklyAverages() {
  const rangeData = getRangeData(currentRange);
  const weeksCount = Math.ceil(rangeData.length / 7);
  const weeks = [];

  for (let i = 0; i < weeksCount; i++) {
    const weekData = rangeData.slice(i * 7, (i + 1) * 7);
    if (weekData.length > 0) {
      weeks.push({
        label: `Week ${i + 1}`,
        reply: average(weekData.map(d => d.reply)),
        chat: average(weekData.map(d => d.chat)),
        inbound: average(weekData.map(d => d.inbound)),
        outbound: average(weekData.map(d => d.outbound))
      });
    }
  }

  return {
    labels: weeks.map(w => w.label),
    reply: weeks.map(w => w.reply),
    chat: weeks.map(w => w.chat),
    inbound: weeks.map(w => w.inbound),
    outbound: weeks.map(w => w.outbound)
  };
}

function getDayOfWeekAverages() {
  const rangeData = getRangeData(90); // Use 90 days for better day-of-week analysis
  const dayTotals = Array(7).fill(0).map(() => ({ reply: [], chat: [], inbound: [], outbound: [] }));

  rangeData.forEach(day => {
    const dayOfWeek = new Date(day.date).getDay();
    dayTotals[dayOfWeek].reply.push(day.reply);
    dayTotals[dayOfWeek].chat.push(day.chat);
    dayTotals[dayOfWeek].inbound.push(day.inbound);
    dayTotals[dayOfWeek].outbound.push(day.outbound);
  });

  return {
    reply: dayTotals.map(d => average(d.reply)),
    chat: dayTotals.map(d => average(d.chat)),
    inbound: dayTotals.map(d => average(d.inbound)),
    outbound: dayTotals.map(d => average(d.outbound))
  };
}

function calculateAverage(data) {
  if (data.length === 0) {
    return { reply: 0, chat: 0, inbound: 0, outbound: 0 };
  }

  return {
    reply: average(data.map(d => d.reply)),
    chat: average(data.map(d => d.chat)),
    inbound: average(data.map(d => d.inbound)),
    outbound: average(data.map(d => d.outbound))
  };
}

function findBestDay(data) {
  if (data.length === 0) {
    return { date: '--', total: 0 };
  }

  const withTotals = data.map(d => ({
    date: d.date,
    total: d.reply + d.chat + d.inbound + d.outbound
  }));

  return withTotals.reduce((best, current) => current.total > best.total ? current : best);
}

function calculateStreak() {
  const sortedData = [...currentData.history].sort((a, b) => new Date(b.date) - new Date(a.date));

  // Include today if it has any activity
  if (currentData.metrics.date === getTodayDate()) {
    const todayTotal = currentData.metrics.reply + currentData.metrics.chat +
                       currentData.metrics.inbound + currentData.metrics.outbound;
    if (todayTotal > 0) {
      sortedData.unshift(currentData.metrics);
    }
  }

  let streak = 0;
  let expectedDate = new Date();

  for (const day of sortedData) {
    const dayDate = new Date(day.date);
    const total = day.reply + day.chat + day.inbound + day.outbound;

    if (total > 0 && isSameDay(dayDate, expectedDate)) {
      streak++;
      expectedDate.setDate(expectedDate.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

function calculateGoalAchievementRate(data) {
  if (data.length === 0) return 0;

  const { goals } = currentData;
  let totalGoals = 0;
  let metGoals = 0;

  data.forEach(day => {
    if (day.reply >= goals.reply) metGoals++;
    if (day.chat >= goals.chat) metGoals++;
    if (day.inbound >= goals.inbound) metGoals++;
    if (day.outbound >= goals.outbound) metGoals++;
    totalGoals += 4;
  });

  return totalGoals > 0 ? Math.round((metGoals / totalGoals) * 100) : 0;
}

function calculateTrend(data) {
  if (data.length < 2) {
    return { direction: 'Stable', description: 'Not enough data to determine trend' };
  }

  const halfPoint = Math.floor(data.length / 2);
  const firstHalf = data.slice(0, halfPoint);
  const secondHalf = data.slice(halfPoint);

  const firstAvg = average(firstHalf.map(d => d.reply + d.chat + d.inbound + d.outbound));
  const secondAvg = average(secondHalf.map(d => d.reply + d.chat + d.inbound + d.outbound));

  const change = ((secondAvg - firstAvg) / firstAvg) * 100;

  if (change > 10) {
    return { direction: '📈 Improving', description: `Up ${change.toFixed(1)}% in recent period` };
  } else if (change < -10) {
    return { direction: '📉 Declining', description: `Down ${Math.abs(change).toFixed(1)}% in recent period` };
  } else {
    return { direction: '➡️ Stable', description: 'Performance is consistent' };
  }
}

function findTopMetric(data) {
  const totals = {
    Replies: data.reduce((sum, d) => sum + d.reply, 0),
    Chats: data.reduce((sum, d) => sum + d.chat, 0),
    'Inbound Calls': data.reduce((sum, d) => sum + d.inbound, 0),
    'Outbound Calls': data.reduce((sum, d) => sum + d.outbound, 0)
  };

  const grandTotal = Object.values(totals).reduce((sum, val) => sum + val, 0);
  const topMetric = Object.entries(totals).reduce((top, [name, total]) =>
    total > top.total ? { name, total } : top
  , { name: 'None', total: 0 });

  const percentage = grandTotal > 0 ? ((topMetric.total / grandTotal) * 100).toFixed(1) : 0;

  return { ...topMetric, percentage };
}

function getHeatmapLevel(value, maxValue) {
  if (value === 0) return 0;
  const percentage = (value / maxValue) * 100;
  if (percentage <= 25) return 1;
  if (percentage <= 50) return 2;
  if (percentage <= 75) return 3;
  return 4;
}

// ===== UI Interactions =====
function switchTab(tabName) {
  // Update nav tabs
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });

  // Update tab content
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === `${tabName}-tab`);
  });
}

function changeDateRange(days) {
  currentRange = days;

  // Update button states
  document.querySelectorAll('.range-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.range) === days);
  });

  // Re-render affected components
  renderDashboard();
}

// ===== Settings =====
function openSettings() {
  const { goals } = currentData;
  document.getElementById('goalReplyInput').value = goals.reply;
  document.getElementById('goalChatInput').value = goals.chat;
  document.getElementById('goalInboundInput').value = goals.inbound;
  document.getElementById('goalOutboundInput').value = goals.outbound;
  document.getElementById('settingsModal').classList.add('active');
}

function closeSettings() {
  document.getElementById('settingsModal').classList.remove('active');
}

async function saveSettings() {
  const newGoals = {
    reply: parseInt(document.getElementById('goalReplyInput').value),
    chat: parseInt(document.getElementById('goalChatInput').value),
    inbound: parseInt(document.getElementById('goalInboundInput').value),
    outbound: parseInt(document.getElementById('goalOutboundInput').value)
  };

  try {
    await chrome.storage.local.set({ goals: newGoals });
    currentData.goals = newGoals;
    closeSettings();
    renderDashboard();
  } catch (error) {
    console.error('Error saving settings:', error);
    alert('Failed to save settings');
  }
}

// ===== Export =====
function exportData() {
  const allData = [...currentData.history];
  if (currentData.metrics.date === getTodayDate()) {
    allData.push(currentData.metrics);
  }

  let csv = 'Date,Replies,Chats,Inbound Calls,Outbound Calls,Total\n';

  allData.sort((a, b) => new Date(a.date) - new Date(b.date)).forEach(day => {
    const total = day.reply + day.chat + day.inbound + day.outbound;
    csv += `${day.date},${day.reply},${day.chat},${day.inbound},${day.outbound},${total}\n`;
  });

  // Add summary
  const totals = {
    reply: allData.reduce((sum, d) => sum + d.reply, 0),
    chat: allData.reduce((sum, d) => sum + d.chat, 0),
    inbound: allData.reduce((sum, d) => sum + d.inbound, 0),
    outbound: allData.reduce((sum, d) => sum + d.outbound, 0)
  };
  const grandTotal = totals.reply + totals.chat + totals.inbound + totals.outbound;
  csv += `\nTOTAL,${totals.reply},${totals.chat},${totals.inbound},${totals.outbound},${grandTotal}`;

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `zendesk-kpi-data-${getTodayDate()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ===== Utility Functions =====
function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function average(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((sum, val) => sum + val, 0) / arr.length;
}

function isSameDay(date1, date2) {
  return date1.toISOString().split('T')[0] === date2.toISOString().split('T')[0];
}
