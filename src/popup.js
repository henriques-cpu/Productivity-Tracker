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
let ticketTimerInterval = null;

// Default reminder settings
const DEFAULT_REMINDER_SETTINGS = {
  enabled: true,
  intervals: [5, 10, 15],
};

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
    replyChat: 0,
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
            replyChat: metrics.replyChat || 0,
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
    showFeedback(metricType, '+1');
    console.log('[ZKT] Metric tracked:', metricType, '=', currentMetrics[metricType]);
  }
}

async function decrementMetric(metricType) {
  console.log('[ZKT] Decrementing metric:', metricType);

  const data = await loadFromStorage();
  currentMetrics = data.metrics;

  // Decrement the metric (but don't go below 0)
  if (currentMetrics[metricType] !== undefined && currentMetrics[metricType] > 0) {
    currentMetrics[metricType]--;
    await saveMetrics(currentMetrics);

    // Update UI immediately
    updateScorecards(currentMetrics);
    updateChart(currentMetrics);

    // Show feedback
    showFeedback(metricType, '-1');
    console.log('[ZKT] Metric decremented:', metricType, '=', currentMetrics[metricType]);
  } else if (currentMetrics[metricType] === 0) {
    // Show feedback that we can't go below 0
    showFeedback(metricType, '0');
    console.log('[ZKT] Cannot decrement below 0:', metricType);
  }
}

function showFeedback(metricType, change) {
  // Brief visual feedback on the button
  const isAdd = change.startsWith('+');
  const btn = document.querySelector(`.${isAdd ? 'add' : 'subtract'}-btn[data-metric="${metricType}"]`);
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
  const channels = ['Email', 'SMS', 'Chat'];

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
          'rgba(80, 70, 229, 0.8)',
          'rgba(5, 150, 105, 0.8)',
          'rgba(217, 119, 6, 0.8)',
          'rgba(123, 31, 162, 0.8)',
        ],
        borderColor: ['#5046e5', '#059669', '#d97706', '#7b1fa2'],
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

  const headers = ['Date', 'Replies (Total)', 'Email', 'SMS', 'Chat', 'Chats Completed', 'Inbound Calls', 'Outbound Calls', 'Total'];
  const rows = allData.map((day) => {
    const total = (day.reply || 0) + (day.chat || 0) + (day.inbound || 0) + (day.outbound || 0);
    return [
      day.date,
      day.reply || 0,
      day.replyEmail || 0,
      day.replySMS || 0,
      day.replyChat || 0,
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
      replyChat: acc.replyChat + (day.replyChat || 0),
      chat: acc.chat + (day.chat || 0),
      inbound: acc.inbound + (day.inbound || 0),
      outbound: acc.outbound + (day.outbound || 0),
    }),
    { reply: 0, replyEmail: 0, replySMS: 0, replyChat: 0, chat: 0, inbound: 0, outbound: 0 }
  );

  rows.push([]);
  rows.push(['TOTAL', totals.reply, totals.replyEmail, totals.replySMS, totals.replyChat, totals.chat, totals.inbound, totals.outbound,
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
// TRACKING TOGGLE
// ============================================================================

async function loadTrackingState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['trackingEnabled'], (result) => {
      // Default to true (tracking enabled)
      resolve(result.trackingEnabled !== false);
    });
  });
}

async function saveTrackingState(enabled) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ trackingEnabled: enabled }, resolve);
  });
}

async function updateTrackingUI(enabled) {
  const toggle = document.getElementById('trackingToggle');
  const label = document.getElementById('trackingLabel');

  if (toggle) {
    toggle.checked = enabled;
  }

  if (label) {
    label.textContent = enabled ? 'Tracking ON' : 'Tracking OFF';
    label.className = enabled ? 'toggle-label tracking-on' : 'toggle-label tracking-off';
  }
}

async function handleTrackingToggle() {
  const toggle = document.getElementById('trackingToggle');
  const enabled = toggle?.checked || false;

  await saveTrackingState(enabled);
  updateTrackingUI(enabled);

  console.log('[ZKT] Tracking', enabled ? 'enabled' : 'disabled');
}

// ============================================================================
// TICKET TIMER
// ============================================================================

/**
 * Format duration in milliseconds to MM:SS or HH:MM:SS
 */
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

/**
 * Update the ticket timer display
 */
function updateTicketTimerDisplay(activeTicket) {
  const timerDisplay = document.getElementById('ticketTimerDisplay');
  const ticketIdDisplay = document.getElementById('currentTicketId');
  const ticketSubjectDisplay = document.getElementById('currentTicketSubject');
  const timerSection = document.getElementById('ticketTimerSection');

  if (!activeTicket) {
    if (ticketIdDisplay) ticketIdDisplay.textContent = 'No ticket open';
    if (timerDisplay) timerDisplay.textContent = '--:--';
    if (ticketSubjectDisplay) ticketSubjectDisplay.textContent = '';
    if (timerSection) timerSection.classList.remove('active');
    return;
  }

  const elapsed = Date.now() - activeTicket.startTime;

  if (ticketIdDisplay) ticketIdDisplay.textContent = `#${activeTicket.ticketId}`;
  if (timerDisplay) timerDisplay.textContent = formatDuration(elapsed);
  if (ticketSubjectDisplay) ticketSubjectDisplay.textContent = activeTicket.subject || '';
  if (timerSection) timerSection.classList.add('active');

  // Update reminder badges to show which have fired
  updateReminderBadges(elapsed);
}

/**
 * Update reminder badges based on elapsed time
 */
function updateReminderBadges(elapsed) {
  const elapsedMinutes = elapsed / (1000 * 60);
  const badges = document.querySelectorAll('.reminder-badge');

  badges.forEach((badge) => {
    const minutes = parseInt(badge.dataset.minutes, 10);
    if (elapsedMinutes >= minutes) {
      badge.classList.add('passed');
    } else {
      badge.classList.remove('passed');
    }
  });
}

/**
 * Start the ticket timer update interval
 */
function startTicketTimerUpdates() {
  // Clear any existing interval
  if (ticketTimerInterval) {
    clearInterval(ticketTimerInterval);
  }

  // Update immediately
  loadActiveTicketAndUpdate();

  // Then update every second
  ticketTimerInterval = setInterval(loadActiveTicketAndUpdate, 1000);
}

/**
 * Load active ticket from storage and update display
 */
async function loadActiveTicketAndUpdate() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['activeTicket'], (result) => {
      updateTicketTimerDisplay(result.activeTicket);
      resolve();
    });
  });
}

/**
 * Load reminder settings from storage
 */
async function loadReminderSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['reminderSettings'], (result) => {
      resolve(result.reminderSettings || DEFAULT_REMINDER_SETTINGS);
    });
  });
}

/**
 * Update reminder settings UI
 */
async function updateReminderSettingsUI() {
  const settings = await loadReminderSettings();

  // Update enabled toggle
  const enabledToggle = document.getElementById('reminderEnabledToggle');
  if (enabledToggle) {
    enabledToggle.checked = settings.enabled;
  }

  // Update interval checkboxes
  const allIntervals = [5, 10, 15, 20, 30];
  allIntervals.forEach((minutes) => {
    const checkbox = document.getElementById(`reminder${minutes}`);
    if (checkbox) {
      checkbox.checked = settings.intervals.includes(minutes);
    }
  });

  // Update badges in main UI
  updateReminderBadgesFromSettings(settings);
}

/**
 * Update the reminder badges shown in the timer section
 */
function updateReminderBadgesFromSettings(settings) {
  const badgesContainer = document.getElementById('reminderBadges');
  if (!badgesContainer) return;

  badgesContainer.innerHTML = '';

  if (!settings.enabled || settings.intervals.length === 0) {
    badgesContainer.innerHTML = '<span class="reminder-disabled">Disabled</span>';
    return;
  }

  settings.intervals.sort((a, b) => a - b).forEach((minutes) => {
    const badge = document.createElement('span');
    badge.className = 'reminder-badge';
    badge.dataset.minutes = minutes;
    badge.textContent = `${minutes}m`;
    badgesContainer.appendChild(badge);
  });
}

/**
 * Save reminder settings
 */
async function handleSaveReminderSettings() {
  const enabled = document.getElementById('reminderEnabledToggle')?.checked ?? true;

  const intervals = [];
  const allIntervals = [5, 10, 15, 20, 30];
  allIntervals.forEach((minutes) => {
    const checkbox = document.getElementById(`reminder${minutes}`);
    if (checkbox?.checked) {
      intervals.push(minutes);
    }
  });

  const settings = { enabled, intervals };

  // Save to storage
  await new Promise((resolve) => {
    chrome.storage.local.set({ reminderSettings: settings }, resolve);
  });

  // Notify background script to update alarms
  chrome.runtime.sendMessage({
    type: 'SAVE_REMINDER_SETTINGS',
    settings,
  });

  // Update UI
  updateReminderBadgesFromSettings(settings);
  closeReminderSettings();

  console.log('[ZKT] Reminder settings saved:', settings);
}

/**
 * Open reminder settings modal
 */
function openReminderSettings() {
  updateReminderSettingsUI();
  document.getElementById('reminderModal')?.classList.add('active');
}

/**
 * Close reminder settings modal
 */
function closeReminderSettings() {
  document.getElementById('reminderModal')?.classList.remove('active');
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
  // Add buttons (increment)
  document.querySelectorAll('.add-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const metric = btn.dataset.metric;
      if (metric) {
        trackMetric(metric);
      }
    });
  });

  // Subtract buttons (decrement)
  document.querySelectorAll('.subtract-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const metric = btn.dataset.metric;
      if (metric) {
        decrementMetric(metric);
      }
    });
  });

  // Export button
  document.getElementById('exportBtn')?.addEventListener('click', exportToCSV);

  // Reset button
  document.getElementById('resetBtn')?.addEventListener('click', resetToday);

  // Dashboard button
  document.getElementById('openDashboardBtn')?.addEventListener('click', openDashboard);

  // Tracking toggle
  document.getElementById('trackingToggle')?.addEventListener('change', handleTrackingToggle);

  // Settings
  document.getElementById('settingsBtn')?.addEventListener('click', openSettings);
  document.getElementById('closeSettings')?.addEventListener('click', closeSettings);
  document.getElementById('saveSettings')?.addEventListener('click', handleSaveSettings);

  // Close modal on backdrop click
  document.getElementById('settingsModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'settingsModal') closeSettings();
  });

  // Reminder settings modal
  document.getElementById('reminderSettingsBtn')?.addEventListener('click', openReminderSettings);
  document.getElementById('closeReminderSettings')?.addEventListener('click', closeReminderSettings);
  document.getElementById('saveReminderSettings')?.addEventListener('click', handleSaveReminderSettings);

  // Close reminder modal on backdrop click
  document.getElementById('reminderModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'reminderModal') closeReminderSettings();
  });

  // Listen for storage changes from content script
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.metrics) {
      currentMetrics = changes.metrics.newValue;
      updateScorecards(currentMetrics);
      updateChart(currentMetrics);
    }

    // Update ticket timer when active ticket changes
    if (namespace === 'local' && changes.activeTicket) {
      updateTicketTimerDisplay(changes.activeTicket.newValue);
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

    // Load tracking state
    const trackingEnabled = await loadTrackingState();
    updateTrackingUI(trackingEnabled);

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

    // Initialize ticket timer
    startTicketTimerUpdates();
    updateReminderSettingsUI();

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
