/**
 * Zendesk KPI Tracker - Popup Dashboard Script
 *
 * Handles:
 * - Loading and displaying metrics from storage
 * - Manual metric tracking buttons
 * - Chart rendering with Chart.js
 * - CSV export functionality
 * - Settings management
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

const METRIC_LABELS = {
  reply: 'Replies Sent',
  chat: 'Chats Completed',
  inbound: 'Inbound Calls',
  outbound: 'Outbound Calls',
};

const CHART_COLORS = {
  reply: '#5b9bd5',
  chat: '#70ad47',
  inbound: '#ed7d31',
  outbound: '#7030a0',
};

let chart = null;
let currentMetrics = null;
let goals = { ...DEFAULT_GOALS };

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get today's date as YYYY-MM-DD string
 */
function getTodayDateString() {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

/**
 * Format date for display
 */
function formatDisplayDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Calculate percentage (capped at 100%)
 */
function calculateProgress(current, goal) {
  if (goal === 0) return 0;
  return Math.min((current / goal) * 100, 100);
}

// ============================================================================
// STORAGE FUNCTIONS
// ============================================================================

/**
 * Load metrics from Chrome storage
 */
async function loadMetrics() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['metrics', 'goals', 'history'], (result) => {
      resolve({
        metrics: result.metrics || createEmptyMetrics(),
        goals: result.goals || DEFAULT_GOALS,
        history: result.history || [],
      });
    });
  });
}

/**
 * Create empty metrics object for today
 */
function createEmptyMetrics() {
  return {
    date: getTodayDateString(),
    reply: 0,
    chat: 0,
    inbound: 0,
    outbound: 0,
    lastUpdated: Date.now(),
  };
}

/**
 * Save goals to storage
 */
async function saveGoals(newGoals) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ goals: newGoals }, resolve);
  });
}

// ============================================================================
// UI UPDATE FUNCTIONS
// ============================================================================

/**
 * Update the date display in header
 */
function updateDateDisplay() {
  const dateEl = document.getElementById('currentDate');
  const today = new Date();
  dateEl.textContent = today.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Update connection status indicator
 */
async function updateConnectionStatus() {
  const statusIndicator = document.getElementById('statusIndicator');
  const statusText = statusIndicator.querySelector('.status-text');

  try {
    // Check if we're connected to a Zendesk tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab && tab.url && tab.url.includes('zendesk.com')) {
      // Try to ping the content script
      chrome.tabs.sendMessage(tab.id, { type: 'PING' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          statusIndicator.className = 'status-indicator disconnected';
          statusText.textContent = 'Not tracking (refresh page)';
        } else {
          statusIndicator.className = 'status-indicator connected';
          statusText.textContent = 'Tracking active';
        }
      });
    } else {
      statusIndicator.className = 'status-indicator disconnected';
      statusText.textContent = 'Open Zendesk to track';
    }
  } catch (error) {
    statusIndicator.className = 'status-indicator disconnected';
    statusText.textContent = 'Connection error';
  }
}

/**
 * Update all scorecard displays
 */
function updateScorecards(metrics) {
  // Replies
  updateScorecard('replies', metrics.reply, goals.reply);
  // Chats
  updateScorecard('chats', metrics.chat, goals.chat);
  // Inbound
  updateScorecard('inbound', metrics.inbound, goals.inbound);
  // Outbound
  updateScorecard('outbound', metrics.outbound, goals.outbound);
}

/**
 * Update a single scorecard
 */
function updateScorecard(type, count, goal) {
  const countEl = document.getElementById(`${type}Count`);
  const goalEl = document.getElementById(`${type}Goal`);
  const progressEl = document.getElementById(`${type}Progress`);

  // Update count with animation
  const oldCount = parseInt(countEl.textContent) || 0;
  if (count !== oldCount) {
    countEl.classList.remove('updated');
    void countEl.offsetWidth; // Trigger reflow
    countEl.classList.add('updated');
  }
  countEl.textContent = count;

  // Update goal
  goalEl.textContent = goal;

  // Update progress bar
  const progress = calculateProgress(count, goal);
  progressEl.style.width = `${progress}%`;
}

/**
 * Update goal inputs in settings
 */
function updateGoalInputs() {
  document.getElementById('goalReplies').value = goals.reply;
  document.getElementById('goalChats').value = goals.chat;
  document.getElementById('goalInbound').value = goals.inbound;
  document.getElementById('goalOutbound').value = goals.outbound;
}

// ============================================================================
// CHART FUNCTIONS
// ============================================================================

/**
 * Initialize or update the performance chart
 */
function updateChart(metrics) {
  const ctx = document.getElementById('performanceChart').getContext('2d');

  const data = {
    labels: ['Replies', 'Chats', 'Inbound', 'Outbound'],
    datasets: [
      {
        label: 'Today',
        data: [metrics.reply, metrics.chat, metrics.inbound, metrics.outbound],
        backgroundColor: [
          'rgba(91, 155, 213, 0.8)',
          'rgba(112, 173, 71, 0.8)',
          'rgba(237, 125, 49, 0.8)',
          'rgba(112, 48, 160, 0.8)',
        ],
        borderColor: [
          '#5b9bd5',
          '#70ad47',
          '#ed7d31',
          '#7030a0',
        ],
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
            font: {
              size: 11,
            },
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
          grid: {
            display: false,
          },
          ticks: {
            color: '#a0a0a0',
            font: {
              size: 10,
            },
          },
        },
        y: {
          beginAtZero: true,
          grid: {
            color: 'rgba(255, 255, 255, 0.05)',
          },
          ticks: {
            color: '#a0a0a0',
            font: {
              size: 10,
            },
            stepSize: 5,
          },
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
// MANUAL TRACKING
// ============================================================================

/**
 * Handle manual metric increment
 */
function handleManualTrack(metricType) {
  chrome.runtime.sendMessage({
    type: 'TRACK_METRIC',
    metric: metricType,
    timestamp: Date.now(),
    manual: true,
  }, (response) => {
    if (response && response.success) {
      // Reload metrics to update display
      refreshData();
    }
  });
}

// ============================================================================
// CSV EXPORT
// ============================================================================

/**
 * Export metrics to CSV file
 */
async function exportToCSV() {
  const data = await loadMetrics();
  const { metrics, history } = data;

  // Combine current metrics with history
  const allData = [...history];

  // Add today's data if not already in history
  const todayExists = history.some((h) => h.date === metrics.date);
  if (!todayExists) {
    allData.push(metrics);
  }

  // Sort by date
  allData.sort((a, b) => new Date(a.date) - new Date(b.date));

  // Create CSV content
  const headers = ['Date', 'Replies Sent', 'Chats Completed', 'Inbound Calls', 'Outbound Calls', 'Total Interactions'];
  const rows = allData.map((day) => {
    const total = (day.reply || 0) + (day.chat || 0) + (day.inbound || 0) + (day.outbound || 0);
    return [
      day.date,
      day.reply || 0,
      day.chat || 0,
      day.inbound || 0,
      day.outbound || 0,
      total,
    ];
  });

  // Add summary row
  const totals = allData.reduce(
    (acc, day) => {
      acc.reply += day.reply || 0;
      acc.chat += day.chat || 0;
      acc.inbound += day.inbound || 0;
      acc.outbound += day.outbound || 0;
      return acc;
    },
    { reply: 0, chat: 0, inbound: 0, outbound: 0 }
  );

  rows.push([]);
  rows.push([
    'TOTAL',
    totals.reply,
    totals.chat,
    totals.inbound,
    totals.outbound,
    totals.reply + totals.chat + totals.inbound + totals.outbound,
  ]);

  // Convert to CSV string
  const csvContent = [
    headers.join(','),
    ...rows.map((row) => row.join(',')),
  ].join('\n');

  // Create and download file
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `zendesk-kpi-${getTodayDateString()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ============================================================================
// RESET FUNCTIONALITY
// ============================================================================

/**
 * Reset today's metrics
 */
async function resetToday() {
  if (!confirm('Are you sure you want to reset today\'s metrics? This cannot be undone.')) {
    return;
  }

  chrome.runtime.sendMessage({ type: 'RESET_TODAY' }, (response) => {
    if (response && response.success) {
      refreshData();
    }
  });
}

// ============================================================================
// SETTINGS MODAL
// ============================================================================

/**
 * Open settings modal
 */
function openSettings() {
  document.getElementById('settingsModal').classList.add('active');
  updateGoalInputs();
}

/**
 * Close settings modal
 */
function closeSettings() {
  document.getElementById('settingsModal').classList.remove('active');
}

/**
 * Save settings from modal
 */
async function handleSaveSettings() {
  const newGoals = {
    reply: parseInt(document.getElementById('goalReplies').value) || DEFAULT_GOALS.reply,
    chat: parseInt(document.getElementById('goalChats').value) || DEFAULT_GOALS.chat,
    inbound: parseInt(document.getElementById('goalInbound').value) || DEFAULT_GOALS.inbound,
    outbound: parseInt(document.getElementById('goalOutbound').value) || DEFAULT_GOALS.outbound,
  };

  await saveGoals(newGoals);
  goals = newGoals;

  // Update displays
  updateScorecards(currentMetrics);
  updateChart(currentMetrics);

  closeSettings();
}

// ============================================================================
// DATA REFRESH
// ============================================================================

/**
 * Refresh all data from storage
 */
async function refreshData() {
  const data = await loadMetrics();
  currentMetrics = data.metrics;
  goals = data.goals;

  // Check if we need to reset for a new day
  if (currentMetrics.date !== getTodayDateString()) {
    // Archive yesterday's data and create new metrics
    chrome.runtime.sendMessage({ type: 'NEW_DAY_CHECK' }, async () => {
      const newData = await loadMetrics();
      currentMetrics = newData.metrics;
      updateUI();
    });
  } else {
    updateUI();
  }
}

/**
 * Update all UI components
 */
function updateUI() {
  updateDateDisplay();
  updateConnectionStatus();
  updateScorecards(currentMetrics);
  updateChart(currentMetrics);
  updateGoalInputs();
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

/**
 * Set up all event listeners
 */
function setupEventListeners() {
  // Manual tracking buttons
  document.querySelectorAll('.manual-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const metric = btn.dataset.metric;
      handleManualTrack(metric);
    });
  });

  // Export button
  document.getElementById('exportBtn').addEventListener('click', exportToCSV);

  // Reset button
  document.getElementById('resetBtn').addEventListener('click', resetToday);

  // Settings button
  document.getElementById('settingsBtn').addEventListener('click', openSettings);

  // Close settings button
  document.getElementById('closeSettings').addEventListener('click', closeSettings);

  // Save settings button
  document.getElementById('saveSettings').addEventListener('click', handleSaveSettings);

  // Close modal on outside click
  document.getElementById('settingsModal').addEventListener('click', (e) => {
    if (e.target.id === 'settingsModal') {
      closeSettings();
    }
  });

  // Listen for storage changes (real-time updates)
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

/**
 * Initialize the popup
 */
async function init() {
  console.log('[Zendesk KPI Tracker] Popup initialized');

  // Set up event listeners
  setupEventListeners();

  // Load and display data
  await refreshData();

  // Update connection status periodically
  setInterval(updateConnectionStatus, 5000);
}

// Start the popup
document.addEventListener('DOMContentLoaded', init);
