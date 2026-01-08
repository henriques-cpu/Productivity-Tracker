/**
 * Zendesk KPI Tracker - Background Service Worker
 *
 * Handles message routing, context menus, and badge updates.
 * Note: Main data persistence is handled directly by popup.js and content.js
 * using chrome.storage.local for reliability.
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

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function getTodayDateString() {
  return new Date().toISOString().split('T')[0];
}

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

// ============================================================================
// STORAGE FUNCTIONS
// ============================================================================

async function getMetrics() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['metrics'], (result) => {
      let metrics = result.metrics || createEmptyMetrics();

      // Check for new day
      if (metrics.date !== getTodayDateString()) {
        // Archive and reset
        archiveMetrics(metrics);
        metrics = createEmptyMetrics();
        chrome.storage.local.set({ metrics });
      }

      resolve(metrics);
    });
  });
}

async function saveMetrics(metrics) {
  metrics.lastUpdated = Date.now();
  return new Promise((resolve) => {
    chrome.storage.local.set({ metrics }, () => {
      updateBadge(metrics);
      resolve();
    });
  });
}

async function archiveMetrics(oldMetrics) {
  if (!oldMetrics.date) return;

  return new Promise((resolve) => {
    chrome.storage.local.get(['history'], (result) => {
      const history = result.history || [];

      // Don't duplicate
      if (!history.some((h) => h.date === oldMetrics.date)) {
        history.push({
          date: oldMetrics.date,
          reply: oldMetrics.reply || 0,
          chat: oldMetrics.chat || 0,
          inbound: oldMetrics.inbound || 0,
          outbound: oldMetrics.outbound || 0,
        });
      }

      // Keep last 90 days
      chrome.storage.local.set({ history: history.slice(-90) }, resolve);
    });
  });
}

// ============================================================================
// METRIC TRACKING
// ============================================================================

async function trackMetric(metricType) {
  const metrics = await getMetrics();

  if (metrics[metricType] !== undefined) {
    metrics[metricType]++;
    await saveMetrics(metrics);
    console.log(`[ZKT Background] Tracked ${metricType}:`, metrics[metricType]);
    return { success: true, metrics };
  }

  return { success: false, error: 'Invalid metric type' };
}

// ============================================================================
// BADGE UPDATE
// ============================================================================

function updateBadge(metrics) {
  if (!metrics) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }

  const total = (metrics.reply || 0) + (metrics.chat || 0) +
                (metrics.inbound || 0) + (metrics.outbound || 0);

  if (total > 0) {
    chrome.action.setBadgeText({ text: total.toString() });
    chrome.action.setBadgeBackgroundColor({ color: '#70ad47' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// ============================================================================
// MESSAGE HANDLING
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[ZKT Background] Message received:', message.type);

  (async () => {
    try {
      switch (message.type) {
        case 'TRACK_METRIC': {
          const result = await trackMetric(message.metric);
          sendResponse(result);
          break;
        }

        case 'GET_METRICS': {
          const metrics = await getMetrics();
          sendResponse({ success: true, metrics });
          break;
        }

        case 'RESET_TODAY': {
          const newMetrics = createEmptyMetrics();
          await saveMetrics(newMetrics);
          sendResponse({ success: true, metrics: newMetrics });
          break;
        }

        case 'NEW_DAY_CHECK': {
          const metrics = await getMetrics();
          sendResponse({ success: true, metrics });
          break;
        }

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('[ZKT Background] Error:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true; // Keep channel open for async response
});

// ============================================================================
// CONTEXT MENU
// ============================================================================

function setupContextMenu() {
  // Remove existing menus first
  chrome.contextMenus.removeAll(() => {
    // Create parent menu
    chrome.contextMenus.create({
      id: 'zkt-parent',
      title: 'Track Metric',
      contexts: ['page'],
      documentUrlPatterns: ['*://*.zendesk.com/*'],
    });

    // Create sub-menu items
    const items = [
      { id: 'zkt-reply', title: '+ Reply Sent' },
      { id: 'zkt-chat', title: '+ Chat Completed' },
      { id: 'zkt-inbound', title: '+ Inbound Call' },
      { id: 'zkt-outbound', title: '+ Outbound Call' },
    ];

    items.forEach((item) => {
      chrome.contextMenus.create({
        id: item.id,
        parentId: 'zkt-parent',
        title: item.title,
        contexts: ['page'],
        documentUrlPatterns: ['*://*.zendesk.com/*'],
      });
    });

    console.log('[ZKT Background] Context menu created');
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const metricMap = {
    'zkt-reply': 'reply',
    'zkt-chat': 'chat',
    'zkt-inbound': 'inbound',
    'zkt-outbound': 'outbound',
  };

  const metric = metricMap[info.menuItemId];
  if (metric) {
    trackMetric(metric);
  }
});

// ============================================================================
// INSTALLATION HANDLERS
// ============================================================================

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[ZKT Background] Installed:', details.reason);

  // Initialize storage on first install
  if (details.reason === 'install') {
    chrome.storage.local.set({
      metrics: createEmptyMetrics(),
      goals: DEFAULT_GOALS,
      history: [],
    });
  }

  // Setup context menu
  setupContextMenu();
});

// ============================================================================
// STARTUP
// ============================================================================

chrome.runtime.onStartup.addListener(async () => {
  console.log('[ZKT Background] Startup');

  // Check for new day and update badge
  const metrics = await getMetrics();
  updateBadge(metrics);

  // Ensure context menu exists
  setupContextMenu();
});

// Listen for storage changes to update badge
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.metrics) {
    updateBadge(changes.metrics.newValue);
  }
});

// Initialize badge on load
getMetrics().then(updateBadge);

console.log('[ZKT Background] Service worker loaded');
