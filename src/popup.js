/**
 * Zendesk KPI Tracker - Popup Dashboard Script
 *
 * Handles the dashboard UI, manual tracking, charts, and CSV export.
 */

// ============================================================================
// CONSTANTS & STATE
// ============================================================================

const DEFAULT_GOALS = {
  reply: 20,
  chat: 15,
  inbound: 10,
  outbound: 5,
};

let chart = null;
let currentMetrics = null;
let goals = { ...DEFAULT_GOALS };

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function getTodayDateString() {
  return new Date().toISOString().split('T')[0];
}

function calculateProgress(current, goal) {
  if (goal === 0) return 0;
  return Math.min((current / goal) * 100, 100);
}

function createEmptyMetrics() {
  return {
    date: getTodayDateString(),
    reply: 0, // Keep for backwards compatibility and total count
    replyEmail: 0,
    replySMS: 0,
    replyWeb: 0,
    replyMessaging: 0,
    replyChat: 0,
    replyOther: 0,
    chat: 0,
    inbound: 0,
    outbound: 0,
    lastUpdated: Date.now(),
  };
}

// ============================================================================
// STORAGE FUNCTIONS (Direct access - more reliable than messaging)
// ============================================================================

async function loadFromStorage() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['metrics', 'goals', 'history'], (result) => {
      const metrics = result.metrics || createEmptyMetrics();
      const storedGoals = result.goals || DEFAULT_GOALS;
      const history = result.history || [];

      // Check if it's a new day
      if (metrics.date !== getTodayDateString()) {
        // Archive old metrics and create new ones
        if (metrics.date) {
          history.push({
            date: metrics.date,
            reply: metrics.reply || 0,
            replyEmail: metrics.replyEmail || 0,
            replySMS: metrics.replySMS || 0,
            replyWeb: metrics.replyWeb || 0,
            replyMessaging: metrics.replyMessaging || 0,
            replyChat: metrics.replyChat || 0,
            replyOther: metrics.replyOther || 0,
            chat: metrics.chat || 0,
            inbound: metrics.inbound || 0,
            outbound: metrics.outbound || 0,
          });
        }
        const newMetrics = createEmptyMetrics();
        chrome.storage.local.set({ metrics: newMetrics, history: history.slice(-90) });
        resolve({ metrics: newMetrics, goals: storedGoals, history });
      } else {
        resolve({ metrics, goals: storedGoals, history });
      }
    });
  });
}

async function saveMetrics(metrics) {
  return new Promise((resolve) => {
    metrics.lastUpdated = Date.now();
    chrome.storage.local.set({ metrics }, resolve);
  });
}

async function saveGoals(newGoals) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ goals: newGoals }, resolve);
  });
}

// ============================================================================
// MANUAL TRACKING (Direct storage update - no background dependency)
// ============================================================================

async function trackMetric(metricType) {
  console.log('[ZKT] Tracking metric:', metricType);

  const data = await loadFromStorage();
  currentMetrics = data.metrics;

  // Increment the metric
  if (currentMetrics[metricType] !== undefined) {
    currentMetrics[metricType]++;
    await saveMetrics(currentMetrics);

    // Update UI immediately
    updateScorecards(currentMetrics);
    updateChart(currentMetrics);

    // Show feedback
    showFeedback(`+1 ${metricType}`);
    console.log('[ZKT] Metric tracked:', metricType, '=', currentMetrics[metricType]);
  }
}

function showFeedback(message) {
  // Brief visual feedback on the button
  const btn = document.querySelector(`[data-metric="${message.split(' ')[1]}"]`);
  if (btn) {
    btn.style.transform = 'scale(0.95)';
    setTimeout(() => {
      btn.style.transform = '';
    }, 150);
  }
}

// ============================================================================
// UI UPDATE FUNCTIONS
// ============================================================================

function updateDateDisplay() {
  const dateEl = document.getElementById('currentDate');
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
}

async function updateConnectionStatus() {
  const statusIndicator = document.getElementById('statusIndicator');
  const statusText = statusIndicator?.querySelector('.status-text');

  if (!statusIndicator || !statusText) return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab?.url?.includes('zendesk.com')) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'PING' });
        statusIndicator.className = 'status-indicator connected';
        statusText.textContent = 'Tracking active';
      } catch {
        statusIndicator.className = 'status-indicator disconnected';
        statusText.textContent = 'Refresh Zendesk page';
      }
    } else {
      statusIndicator.className = 'status-indicator disconnected';
      statusText.textContent = 'Open Zendesk to auto-track';
    }
  } catch (error) {
    statusIndicator.className = 'status-indicator disconnected';
    statusText.textContent = 'Manual mode only';
  }
}

function updateScorecards(metrics) {
  if (!metrics) return;

  updateScorecard('replies', metrics.reply || 0, goals.reply);
  updateScorecard('chats', metrics.chat || 0, goals.chat);
  updateScorecard('inbound', metrics.inbound || 0, goals.inbound);
  updateScorecard('outbound', metrics.outbound || 0, goals.outbound);

  // Update reply channel breakdown
  updateChannelBreakdown(metrics);
}

function updateChannelBreakdown(metrics) {
  const channels = ['Email', 'SMS', 'Web', 'Messaging', 'Chat', 'Other'];

  channels.forEach(channel => {
    const key = `reply${channel}`;
    const el = document.getElementById(`${key}Count`);
    if (el) {
      el.textContent = metrics[key] || 0;
    }
  });
}

function updateScorecard(type, count, goal) {
  const countEl = document.getElementById(`${type}Count`);
  const goalEl = document.getElementById(`${type}Goal`);
  const progressEl = document.getElementById(`${type}Progress`);

  if (countEl) {
    const oldCount = parseInt(countEl.textContent) || 0;
    if (count !== oldCount) {
      countEl.classList.remove('updated');
      void countEl.offsetWidth;
      countEl.classList.add('updated');
    }
    countEl.textContent = count;
  }

  if (goalEl) goalEl.textContent = goal;
  if (progressEl) progressEl.style.width = `${calculateProgress(count, goal)}%`;
}

function updateGoalInputs() {
  const inputs = {
    goalReplies: goals.reply,
    goalChats: goals.chat,
    goalInbound: goals.inbound,
    goalOutbound: goals.outbound,
  };

  Object.entries(inputs).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  });
}

// ============================================================================
// CHART FUNCTIONS
// ============================================================================

function updateChart(metrics) {
  if (!metrics) return;

  const canvas = document.getElementById('performanceChart');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');

  const data = {
    labels: ['Replies', 'Chats', 'Inbound', 'Outbound'],
    datasets: [
      {
        label: 'Today',
        data: [metrics.reply || 0, metrics.chat || 0, metrics.inbound || 0, metrics.outbound || 0],
        backgroundColor: [
          'rgba(91, 155, 213, 0.8)',
          'rgba(112, 173, 71, 0.8)',
          'rgba(237, 125, 49, 0.8)',
          'rgba(112, 48, 160, 0.8)',
        ],
        borderColor: ['#5b9bd5', '#70ad47', '#ed7d31', '#7030a0'],
        borderWidth: 1,
        borderRadius: 4,
        barPercentage: 0.6,
      },
      {
        label: 'Goal',
        data: [goals.reply, goals.chat, goals.inbound, goals.outbound],
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        borderColor: 'rgba(255, 255, 255, 0.3)',
        borderWidth: 1,
        borderDash: [5, 5],
        borderRadius: 4,
        barPercentage: 0.6,
      },
    ],
  };

  const config = {
    type: 'bar',
    data: data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: '#a0a0a0',
            font: { size: 11 },
            padding: 10,
            usePointStyle: true,
            pointStyle: 'rectRounded',
          },
        },
        tooltip: {
          backgroundColor: '#2d2d2d',
          titleColor: '#ffffff',
          bodyColor: '#a0a0a0',
          borderColor: '#404040',
          borderWidth: 1,
          cornerRadius: 8,
          padding: 10,
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#a0a0a0', font: { size: 10 } },
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#a0a0a0', font: { size: 10 }, stepSize: 5 },
        },
      },
    },
  };

  if (chart) {
    chart.data = data;
    chart.update('none');
  } else {
    chart = new Chart(ctx, config);
  }
}

// ============================================================================
// CSV EXPORT
// ============================================================================

async function exportToCSV() {
  const data = await loadFromStorage();
  const { metrics, history } = data;

  const allData = [...history];
  if (!history.some((h) => h.date === metrics.date)) {
    allData.push(metrics);
  }
  allData.sort((a, b) => new Date(a.date) - new Date(b.date));

  const headers = ['Date', 'Replies (Total)', 'Email', 'SMS', 'Web', 'Messaging', 'Chat', 'Other', 'Chats Completed', 'Inbound Calls', 'Outbound Calls', 'Total'];
  const rows = allData.map((day) => {
    const total = (day.reply || 0) + (day.chat || 0) + (day.inbound || 0) + (day.outbound || 0);
    return [
      day.date,
      day.reply || 0,
      day.replyEmail || 0,
      day.replySMS || 0,
      day.replyWeb || 0,
      day.replyMessaging || 0,
      day.replyChat || 0,
      day.replyOther || 0,
      day.chat || 0,
      day.inbound || 0,
      day.outbound || 0,
      total
    ];
  });

  const totals = allData.reduce(
    (acc, day) => ({
      reply: acc.reply + (day.reply || 0),
      replyEmail: acc.replyEmail + (day.replyEmail || 0),
      replySMS: acc.replySMS + (day.replySMS || 0),
      replyWeb: acc.replyWeb + (day.replyWeb || 0),
      replyMessaging: acc.replyMessaging + (day.replyMessaging || 0),
      replyChat: acc.replyChat + (day.replyChat || 0),
      replyOther: acc.replyOther + (day.replyOther || 0),
      chat: acc.chat + (day.chat || 0),
      inbound: acc.inbound + (day.inbound || 0),
      outbound: acc.outbound + (day.outbound || 0),
    }),
    { reply: 0, replyEmail: 0, replySMS: 0, replyWeb: 0, replyMessaging: 0, replyChat: 0, replyOther: 0, chat: 0, inbound: 0, outbound: 0 }
  );

  rows.push([]);
  rows.push(['TOTAL', totals.reply, totals.replyEmail, totals.replySMS, totals.replyWeb, totals.replyMessaging, totals.replyChat, totals.replyOther, totals.chat, totals.inbound, totals.outbound,
    totals.reply + totals.chat + totals.inbound + totals.outbound]);

  const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `zendesk-kpi-${getTodayDateString()}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ============================================================================
// RESET FUNCTIONALITY
// ============================================================================

async function resetToday() {
  if (!confirm('Reset all of today\'s metrics to zero?')) return;

  currentMetrics = createEmptyMetrics();
  await saveMetrics(currentMetrics);
  updateScorecards(currentMetrics);
  updateChart(currentMetrics);
}

// ============================================================================
// DASHBOARD
// ============================================================================

function openDashboard() {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
}

// ============================================================================
// SETTINGS MODAL
// ============================================================================

function openSettings() {
  document.getElementById('settingsModal')?.classList.add('active');
  updateGoalInputs();
}

function closeSettings() {
  document.getElementById('settingsModal')?.classList.remove('active');
}

async function handleSaveSettings() {
  goals = {
    reply: parseInt(document.getElementById('goalReplies')?.value) || DEFAULT_GOALS.reply,
    chat: parseInt(document.getElementById('goalChats')?.value) || DEFAULT_GOALS.chat,
    inbound: parseInt(document.getElementById('goalInbound')?.value) || DEFAULT_GOALS.inbound,
    outbound: parseInt(document.getElementById('goalOutbound')?.value) || DEFAULT_GOALS.outbound,
  };

  await saveGoals(goals);
  updateScorecards(currentMetrics);
  updateChart(currentMetrics);
  closeSettings();
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

function setupEventListeners() {
  // Manual tracking buttons
  document.querySelectorAll('.manual-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const metric = btn.dataset.metric;
      if (metric) {
        trackMetric(metric);
      }
    });
  });

  // Export button
  document.getElementById('exportBtn')?.addEventListener('click', exportToCSV);

  // Reset button
  document.getElementById('resetBtn')?.addEventListener('click', resetToday);

  // Dashboard button
  document.getElementById('openDashboardBtn')?.addEventListener('click', openDashboard);

  // Settings
  document.getElementById('settingsBtn')?.addEventListener('click', openSettings);
  document.getElementById('closeSettings')?.addEventListener('click', closeSettings);
  document.getElementById('saveSettings')?.addEventListener('click', handleSaveSettings);

  // Close modal on backdrop click
  document.getElementById('settingsModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'settingsModal') closeSettings();
  });

  // Listen for storage changes from content script
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.metrics) {
      currentMetrics = changes.metrics.newValue;
      updateScorecards(currentMetrics);
      updateChart(currentMetrics);
    }
  });
}

// ============================================================================
// INITIALIZATION
// ============================================================================

async function init() {
  console.log('[ZKT] Initializing popup...');

  try {
    // Load data from storage
    const data = await loadFromStorage();
    currentMetrics = data.metrics;
    goals = data.goals;

    console.log('[ZKT] Loaded metrics:', currentMetrics);
    console.log('[ZKT] Loaded goals:', goals);

    // Setup UI
    setupEventListeners();
    updateDateDisplay();
    updateScorecards(currentMetrics);
    updateGoalInputs();

    // Initialize chart after a brief delay to ensure canvas is ready
    setTimeout(() => {
      updateChart(currentMetrics);
    }, 100);

    // Check connection status
    updateConnectionStatus();

    console.log('[ZKT] Popup initialized successfully');
  } catch (error) {
    console.error('[ZKT] Initialization error:', error);
  }
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
