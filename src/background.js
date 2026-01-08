/**
 * Zendesk KPI Tracker - Background Service Worker
 *
 * Handles:
 * - Data persistence using Chrome Storage API
 * - Message routing between content script and popup
 * - Daily data reset and history archival
 * - Metric aggregation
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_GOALS = {
  reply: 20,
  chat: 15,
  inbound: 10,
  outbound: 5,
};

// Maximum history entries to keep (days)
const MAX_HISTORY_DAYS = 90;

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
    events: [], // Store individual events for debugging
  };
}

// ============================================================================
// STORAGE FUNCTIONS
// ============================================================================

/**
 * Get current metrics from storage
 */
async function getMetrics() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['metrics'], (result) => {
      resolve(result.metrics || createEmptyMetrics());
    });
  });
}

/**
 * Save metrics to storage
 */
async function saveMetrics(metrics) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ metrics }, resolve);
  });
}

/**
 * Get history from storage
 */
async function getHistory() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['history'], (result) => {
      resolve(result.history || []);
    });
  });
}

/**
 * Save history to storage
 */
async function saveHistory(history) {
  // Limit history size
  const limitedHistory = history.slice(-MAX_HISTORY_DAYS);
  return new Promise((resolve) => {
    chrome.storage.local.set({ history: limitedHistory }, resolve);
  });
}

/**
 * Archive current day's metrics to history
 */
async function archiveToHistory(metrics) {
  const history = await getHistory();

  // Check if this date already exists in history
  const existingIndex = history.findIndex((h) => h.date === metrics.date);

  if (existingIndex >= 0) {
    // Update existing entry
    history[existingIndex] = {
      date: metrics.date,
      reply: metrics.reply,
      chat: metrics.chat,
      inbound: metrics.inbound,
      outbound: metrics.outbound,
    };
  } else {
    // Add new entry
    history.push({
      date: metrics.date,
      reply: metrics.reply,
      chat: metrics.chat,
      inbound: metrics.inbound,
      outbound: metrics.outbound,
    });
  }

  await saveHistory(history);
}

// ============================================================================
// METRIC TRACKING
// ============================================================================

/**
 * Increment a metric counter
 */
async function trackMetric(metricType, eventData = {}) {
  const today = getTodayDateString();
  let metrics = await getMetrics();

  // Check if we need to start a new day
  if (metrics.date !== today) {
    // Archive yesterday's data
    await archiveToHistory(metrics);
    // Create new metrics for today
    metrics = createEmptyMetrics();
  }

  // Validate metric type
  const validMetrics = ['reply', 'chat', 'inbound', 'outbound'];
  if (!validMetrics.includes(metricType)) {
    console.error('[Zendesk KPI Tracker] Invalid metric type:', metricType);
    return { success: false, error: 'Invalid metric type' };
  }

  // Increment the counter
  metrics[metricType] = (metrics[metricType] || 0) + 1;
  metrics.lastUpdated = Date.now();

  // Store event for debugging (keep last 100 events)
  metrics.events = metrics.events || [];
  metrics.events.push({
    type: metricType,
    timestamp: Date.now(),
    url: eventData.url || '',
    manual: eventData.manual || false,
  });
  if (metrics.events.length > 100) {
    metrics.events = metrics.events.slice(-100);
  }

  // Save to storage
  await saveMetrics(metrics);

  console.log(`[Zendesk KPI Tracker] Tracked ${metricType}:`, metrics[metricType]);

  return {
    success: true,
    metrics: {
      reply: metrics.reply,
      chat: metrics.chat,
      inbound: metrics.inbound,
      outbound: metrics.outbound,
    },
  };
}

/**
 * Check for new day and reset if needed
 */
async function checkNewDay() {
  const today = getTodayDateString();
  const metrics = await getMetrics();

  if (metrics.date !== today) {
    // Archive yesterday's data
    await archiveToHistory(metrics);
    // Create new metrics for today
    await saveMetrics(createEmptyMetrics());
    return { newDay: true };
  }

  return { newDay: false };
}

/**
 * Reset today's metrics
 */
async function resetToday() {
  await saveMetrics(createEmptyMetrics());
  return { success: true };
}

// ============================================================================
// MESSAGE HANDLING
// ============================================================================

/**
 * Handle messages from content script and popup
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Zendesk KPI Tracker] Received message:', message.type);

  switch (message.type) {
    case 'TRACK_METRIC':
      trackMetric(message.metric, {
        url: message.url,
        manual: message.manual,
        timestamp: message.timestamp,
      }).then(sendResponse);
      return true; // Keep channel open for async response

    case 'GET_METRICS':
      getMetrics().then((metrics) => {
        sendResponse({ success: true, metrics });
      });
      return true;

    case 'NEW_DAY_CHECK':
      checkNewDay().then(sendResponse);
      return true;

    case 'RESET_TODAY':
      resetToday().then(sendResponse);
      return true;

    case 'GET_HISTORY':
      getHistory().then((history) => {
        sendResponse({ success: true, history });
      });
      return true;

    default:
      sendResponse({ success: false, error: 'Unknown message type' });
      return false;
  }
});

// ============================================================================
// ALARM SETUP (Daily Reset Check)
// ============================================================================

/**
 * Set up daily alarm to check for day change
 */
chrome.alarms.create('dailyReset', {
  periodInMinutes: 60, // Check every hour
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'dailyReset') {
    checkNewDay();
  }
});

// ============================================================================
// INSTALLATION & UPDATE HANDLERS
// ============================================================================

/**
 * Handle extension installation
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[Zendesk KPI Tracker] Extension installed/updated:', details.reason);

  if (details.reason === 'install') {
    // Initialize storage with default values
    const metrics = createEmptyMetrics();
    await saveMetrics(metrics);
    await saveHistory([]);

    // Set default goals
    chrome.storage.local.set({ goals: DEFAULT_GOALS });

    console.log('[Zendesk KPI Tracker] Initialized with default values');
  }

  if (details.reason === 'update') {
    // Perform any necessary migrations
    console.log('[Zendesk KPI Tracker] Extension updated from', details.previousVersion);
  }
});

/**
 * Handle extension startup
 */
chrome.runtime.onStartup.addListener(() => {
  console.log('[Zendesk KPI Tracker] Extension started');
  checkNewDay();
});

// ============================================================================
// CONTEXT MENU (Optional - for quick tracking)
// ============================================================================

/**
 * Create context menu items for quick tracking
 */
chrome.runtime.onInstalled.addListener(() => {
  // Create parent menu
  chrome.contextMenus.create({
    id: 'zkt-parent',
    title: 'Zendesk KPI Tracker',
    contexts: ['page'],
    documentUrlPatterns: ['*://*.zendesk.com/*'],
  });

  // Create sub-menu items
  const menuItems = [
    { id: 'zkt-reply', title: 'Track Reply' },
    { id: 'zkt-chat', title: 'Track Chat' },
    { id: 'zkt-inbound', title: 'Track Inbound Call' },
    { id: 'zkt-outbound', title: 'Track Outbound Call' },
  ];

  menuItems.forEach((item) => {
    chrome.contextMenus.create({
      id: item.id,
      parentId: 'zkt-parent',
      title: item.title,
      contexts: ['page'],
      documentUrlPatterns: ['*://*.zendesk.com/*'],
    });
  });
});

/**
 * Handle context menu clicks
 */
chrome.contextMenus.onClicked.addListener((info, tab) => {
  const metricMap = {
    'zkt-reply': 'reply',
    'zkt-chat': 'chat',
    'zkt-inbound': 'inbound',
    'zkt-outbound': 'outbound',
  };

  const metric = metricMap[info.menuItemId];
  if (metric) {
    trackMetric(metric, { url: tab.url, manual: true });
  }
});

// ============================================================================
// BADGE UPDATE
// ============================================================================

/**
 * Update extension badge with total interactions
 */
async function updateBadge() {
  const metrics = await getMetrics();
  const total = metrics.reply + metrics.chat + metrics.inbound + metrics.outbound;

  if (total > 0) {
    chrome.action.setBadgeText({ text: total.toString() });
    chrome.action.setBadgeBackgroundColor({ color: '#70ad47' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// Listen for storage changes to update badge
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.metrics) {
    updateBadge();
  }
});

// Update badge on startup
updateBadge();

console.log('[Zendesk KPI Tracker] Background service worker initialized');
