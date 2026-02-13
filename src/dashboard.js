// ===== Zendesk KPI Dashboard =====
// Power BI-Inspired Analytics Dashboard

// Global State
let currentData = {
  metrics: { date: '', reply: 0, chat: 0, inbound: 0, outbound: 0, replyEmail: 0, replySMS: 0, replyChat: 0 },
  history: [],
  goals: { reply: 20 },
  ticketTimeCache: { date: '', tickets: {} },
  ticketHistory: []
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
    if (changes.companies || changes.activeCompanyId) {
      loadData();
    }
  });
}

// ===== Data Loading =====
async function loadData() {
  try {
    // Migrate to multi-company structure if needed
    await StorageUtils.migrateToMultiCompany();

    // Get active company data
    const company = await StorageUtils.getActiveCompany();

    if (!company) {
      console.error('No active company found');
      return;
    }

    // Update company badge
    const companyIndicator = document.getElementById('companyIndicator');
    const companyName = document.getElementById('companyName');

    if (companyIndicator) {
      companyIndicator.style.backgroundColor = company.data.color;
    }
    if (companyName) {
      companyName.textContent = company.data.name;
    }

    // Load company data
    currentData.metrics = company.data.metrics || { date: getTodayDate(), reply: 0, chat: 0, inbound: 0, outbound: 0, replyEmail: 0, replySMS: 0, replyChat: 0 };
    currentData.history = company.data.history || [];
    currentData.goals = company.data.goals || { reply: 20 };
    currentData.ticketTimeCache = company.data.ticketTimeCache || { date: getTodayDate(), tickets: {} };
    currentData.ticketHistory = company.data.ticketHistory || [];

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
  updateMetricCardNoGoal('chat', metrics.chat, yesterday.chat);
  updateMetricCardNoGoal('inbound', metrics.inbound, yesterday.inbound);
  updateMetricCardNoGoal('outbound', metrics.outbound, yesterday.outbound);

  // Summary Statistics
  updateSummaryStats();

  // Total Replies Summary
  renderRepliesSummary();

  // Ticket Time Statistics
  renderTicketTimeStats();

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

function updateMetricCardNoGoal(metric, value, yesterdayValue) {
  const capitalMetric = metric.charAt(0).toUpperCase() + metric.slice(1);
  const change = value - yesterdayValue;
  const changeText = change >= 0 ? `+${change}` : `${change}`;
  const changeClass = change >= 0 ? 'positive' : 'negative';

  document.getElementById(`today${capitalMetric}`).textContent = value;

  const changeEl = document.getElementById(`change${capitalMetric}`);
  changeEl.textContent = `${changeText} from yesterday`;
  changeEl.className = `card-change ${changeClass}`;
}

function updateSummaryStats() {
  const rangeData = getRangeData(currentRange);
  const total = rangeData.reduce((sum, day) => sum + day.reply, 0);
  const avg = rangeData.length > 0 ? (total / rangeData.length).toFixed(1) : 0;
  const bestDay = findBestDay(rangeData);
  const goalRate = calculateGoalAchievementRate(rangeData);

  document.getElementById('rangeDays').textContent = currentRange;
  document.getElementById('totalActivities').textContent = total;
  document.getElementById('dailyAverage').textContent = avg;
  document.getElementById('bestDayValue').textContent = bestDay.total;
  document.getElementById('bestDayDate').textContent = bestDay.date;
  document.getElementById('goalAchievement').textContent = `${goalRate}%`;
}

// ===== Total Replies Summary =====
function renderRepliesSummary() {
  const { metrics } = currentData;

  // Total replies today (sum of all channels, or use total reply count)
  const totalReplies = metrics.reply || 0;
  const emailReplies = metrics.replyEmail || 0;
  const smsReplies = metrics.replySMS || 0;
  const chatReplies = metrics.replyChat || 0;

  document.getElementById('totalRepliesToday').textContent = totalReplies;
  document.getElementById('replyEmailCount').textContent = emailReplies;
  document.getElementById('replySMSCount').textContent = smsReplies;
  document.getElementById('replyChatCount').textContent = chatReplies;
}

// ===== Ticket Time Statistics =====
function renderTicketTimeStats() {
  const { ticketTimeCache, ticketHistory } = currentData;
  const today = getTodayDate();

  // Get today's ticket data from cache
  const todayTickets = (ticketTimeCache.date === today) ? ticketTimeCache.tickets : {};

  // Calculate statistics
  const ticketIds = Object.keys(todayTickets);
  const ticketCount = ticketIds.length;

  // Total time across all tickets today
  const totalTimeMs = Object.values(todayTickets).reduce((sum, time) => sum + time, 0);

  // Average time per ticket
  const avgTimeMs = ticketCount > 0 ? totalTimeMs / ticketCount : 0;

  // Longest ticket time
  const longestTimeMs = ticketCount > 0 ? Math.max(...Object.values(todayTickets)) : 0;

  // Update the stat cards
  document.getElementById('totalTicketTimeToday').textContent = formatDuration(totalTimeMs);
  document.getElementById('ticketsWorkedToday').textContent = ticketCount;
  document.getElementById('avgTimePerTicket').textContent = formatDuration(avgTimeMs);
  document.getElementById('longestTicketTime').textContent = formatDuration(longestTimeMs);

  // Render the ticket time list
  renderTicketTimeList(todayTickets, ticketHistory);
}

function renderTicketTimeList(todayTickets, ticketHistory) {
  const listContainer = document.getElementById('ticketTimeList');
  if (!listContainer) return;

  const ticketIds = Object.keys(todayTickets);

  if (ticketIds.length === 0) {
    listContainer.innerHTML = '<div class="ticket-time-empty">No ticket data for today</div>';
    return;
  }

  // Get ticket subjects from history if available
  const today = getTodayDate();
  const todayHistory = ticketHistory.filter(t => t.date === today);

  // Create a map of ticket IDs to their most recent subject
  const subjectMap = {};
  todayHistory.forEach(entry => {
    subjectMap[entry.ticketId] = entry.subject;
  });

  // Sort tickets by time spent (descending)
  const sortedTickets = ticketIds
    .map(id => ({ id, time: todayTickets[id], subject: subjectMap[id] || 'Unknown' }))
    .sort((a, b) => b.time - a.time);

  // Render the list
  listContainer.innerHTML = sortedTickets.map(ticket => `
    <div class="ticket-time-item">
      <div class="ticket-time-info">
        <span class="ticket-time-id">#${ticket.id}</span>
        <span class="ticket-time-subject">${escapeHtml(ticket.subject)}</span>
      </div>
      <span class="ticket-time-duration">${formatDuration(ticket.time)}</span>
    </div>
  `).join('');
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
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

    const datasets = [
      {
        label: labels[metric],
        data: data,
        borderColor: COLORS[metric],
        backgroundColor: COLORS[metric] + '33',
        tension: 0.4,
        fill: true,
        borderWidth: 3
      }
    ];

    // Only add goal line for replies
    if (metric === 'reply' && goal) {
      datasets.push({
        label: 'Goal',
        data: Array(chartLabels.length).fill(goal),
        borderColor: '#ffffff',
        borderDash: [5, 5],
        borderWidth: 2,
        fill: false,
        pointRadius: 0
      });
    }

    charts[`${metric}TrendChart`] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: chartLabels,
        datasets: datasets
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
    const { goals } = currentData;
    return day.reply >= goals.reply;
  }).length;
  document.getElementById('goalSuccessDesc').textContent = `${daysMetGoal} of ${rangeData.length} days met reply goal`;

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
          data: [goals.reply, null, null, null],
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
  const replyCompletion = (metrics.reply / goals.reply) * 100;

  destroyChart('goalCompletionChart');

  charts.goalCompletionChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Completed', 'Remaining'],
      datasets: [{
        data: [Math.min(replyCompletion, 100), Math.max(100 - replyCompletion, 0)],
        backgroundColor: [COLORS.reply, '#3d3d3d'],
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
              if (context.dataIndex === 0) {
                return `${replyCompletion.toFixed(1)}% of goal (${metrics.reply}/${goals.reply})`;
              } else {
                return `${(100 - replyCompletion).toFixed(1)}% remaining`;
              }
            }
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
      // Parse date string as local time to avoid UTC timezone shift
      const [y, m] = d.date.split('-').map(Number);
      return y === year && (m - 1) === month;
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
    // Parse date string as local time to avoid UTC timezone shift
    const [year, month, d] = day.date.split('-').map(Number);
    const dayOfWeek = new Date(year, month - 1, d).getDay();
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

function calculateGoalAchievementRate(data) {
  if (data.length === 0) return 0;

  const { goals } = currentData;
  let totalDays = data.length;
  let metGoals = 0;

  data.forEach(day => {
    if (day.reply >= goals.reply) metGoals++;
  });

  return totalDays > 0 ? Math.round((metGoals / totalDays) * 100) : 0;
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
  document.getElementById('settingsModal').classList.add('active');
}

function closeSettings() {
  document.getElementById('settingsModal').classList.remove('active');
}

async function saveSettings() {
  const newGoals = {
    reply: parseInt(document.getElementById('goalReplyInput').value)
  };

  try {
    await StorageUtils.saveActiveGoals(newGoals);
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
  // Parse date string as local time to avoid UTC timezone shift
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function average(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((sum, val) => sum + val, 0) / arr.length;
}

function isSameDay(date1, date2) {
  return date1.toISOString().split('T')[0] === date2.toISOString().split('T')[0];
}
