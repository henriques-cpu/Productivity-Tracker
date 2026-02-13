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

// Default ticket time reminder settings (in minutes)
const DEFAULT_REMINDER_SETTINGS = {
  enabled: true,
  intervals: [5, 10, 15], // Remind at 5, 10, and 15 minutes
};

// Alarm name prefix for ticket reminders
const TICKET_ALARM_PREFIX = 'ticket-reminder-';

// ============================================================================
// STORAGE UTILITIES (for service worker context)
// ============================================================================

async function getActiveCompany() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['companies', 'activeCompanyId'], (result) => {
      const activeId = result.activeCompanyId;
      const companies = result.companies || {};

      if (activeId && companies[activeId]) {
        resolve({ id: activeId, data: companies[activeId] });
      } else {
        resolve(null);
      }
    });
  });
}

async function updateActiveCompanyMetrics(metrics) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['companies', 'activeCompanyId'], (result) => {
      const companies = result.companies || {};
      const activeId = result.activeCompanyId;

      if (activeId && companies[activeId]) {
        companies[activeId].metrics = { ...metrics, lastUpdated: Date.now() };
        chrome.storage.local.set({ companies }, () => resolve(true));
      } else {
        resolve(false);
      }
    });
  });
}

async function updateActiveCompanyHistory(history) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['companies', 'activeCompanyId'], (result) => {
      const companies = result.companies || {};
      const activeId = result.activeCompanyId;

      if (activeId && companies[activeId]) {
        companies[activeId].history = history;
        chrome.storage.local.set({ companies }, () => resolve(true));
      } else {
        resolve(false);
      }
    });
  });
}

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
  const company = await getActiveCompany();

  if (!company) {
    return createEmptyMetrics();
  }

  let metrics = company.data.metrics || createEmptyMetrics();

  // Check for new day
  if (metrics.date !== getTodayDateString()) {
    // Archive and reset
    await archiveMetrics(metrics, company.id);
    metrics = createEmptyMetrics();
    await updateActiveCompanyMetrics(metrics);
  }

  return metrics;
}

async function saveMetrics(metrics) {
  metrics.lastUpdated = Date.now();
  await updateActiveCompanyMetrics(metrics);
  updateBadge(metrics);
}

async function archiveMetrics(oldMetrics, companyId) {
  if (!oldMetrics.date) return;

  return new Promise((resolve) => {
    chrome.storage.local.get(['companies'], (result) => {
      const companies = result.companies || {};

      if (!companies[companyId]) {
        resolve();
        return;
      }

      const history = companies[companyId].history || [];

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

      // Keep last 90 days and update
      companies[companyId].history = history.slice(-90);

      chrome.storage.local.set({ companies }, resolve);
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
    chrome.action.setBadgeBackgroundColor({ color: '#059669' });
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

        case 'TICKET_OPENED': {
          const { ticketId, startTime, accumulatedTime } = message.data;
          console.log(`[ZKT Background] Ticket #${ticketId} opened (accumulated: ${Math.round((accumulatedTime || 0) / 1000)}s)`);
          await createTicketReminders(ticketId, startTime, accumulatedTime || 0);
          sendResponse({ success: true });
          break;
        }

        case 'TICKET_CLOSED': {
          const { ticketId } = message.data;
          console.log(`[ZKT Background] Ticket #${ticketId} closed`);
          await clearTicketReminders(ticketId);
          sendResponse({ success: true });
          break;
        }

        case 'GET_REMINDER_SETTINGS': {
          const settings = await getReminderSettings();
          sendResponse({ success: true, settings });
          break;
        }

        case 'SAVE_REMINDER_SETTINGS': {
          await chrome.storage.local.set({ reminderSettings: message.settings });
          // Refresh alarms if there's an active ticket
          const result = await chrome.storage.local.get(['activeTicket']);
          if (result.activeTicket) {
            await createTicketReminders(
              result.activeTicket.ticketId,
              result.activeTicket.startTime,
              result.activeTicket.accumulatedTime || 0
            );
          }
          sendResponse({ success: true });
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
// TICKET TIME REMINDER SYSTEM
// ============================================================================

/**
 * Get reminder settings from storage
 */
async function getReminderSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['reminderSettings'], (result) => {
      resolve(result.reminderSettings || DEFAULT_REMINDER_SETTINGS);
    });
  });
}

/**
 * Create reminder alarms for a ticket
 * @param {string} ticketId - The ticket ID
 * @param {number} startTime - When the current session started
 * @param {number} accumulatedTime - Time already accumulated on this ticket today (ms)
 */
async function createTicketReminders(ticketId, startTime, accumulatedTime = 0) {
  const settings = await getReminderSettings();

  if (!settings.enabled) {
    console.log('[ZKT Background] Reminders disabled, not creating alarms');
    return;
  }

  // Clear any existing alarms for this ticket
  await clearTicketReminders(ticketId);

  const now = Date.now();
  const currentSessionMinutes = (now - startTime) / (1000 * 60);
  const accumulatedMinutes = accumulatedTime / (1000 * 60);
  const totalElapsedMinutes = accumulatedMinutes + currentSessionMinutes;

  console.log(`[ZKT Background] Creating reminders for ticket #${ticketId}: accumulated=${accumulatedMinutes.toFixed(1)}m, session=${currentSessionMinutes.toFixed(1)}m, total=${totalElapsedMinutes.toFixed(1)}m`);

  // Create alarms for each interval that hasn't passed yet (based on total time)
  for (const minutes of settings.intervals) {
    if (minutes > totalElapsedMinutes) {
      const alarmName = `${TICKET_ALARM_PREFIX}${ticketId}-${minutes}`;
      // Delay is based on how much more time is needed to reach the interval
      const delayMinutes = minutes - totalElapsedMinutes;

      chrome.alarms.create(alarmName, {
        delayInMinutes: delayMinutes,
      });

      console.log(`[ZKT Background] Created alarm "${alarmName}" for ${delayMinutes.toFixed(1)} minutes from now (total will be ${minutes}m)`);
    } else {
      console.log(`[ZKT Background] Skipping ${minutes}m reminder - already passed (total: ${totalElapsedMinutes.toFixed(1)}m)`);
    }
  }
}

/**
 * Clear all reminder alarms for a ticket
 */
async function clearTicketReminders(ticketId) {
  const alarms = await chrome.alarms.getAll();

  for (const alarm of alarms) {
    if (alarm.name.startsWith(`${TICKET_ALARM_PREFIX}${ticketId}`)) {
      await chrome.alarms.clear(alarm.name);
      console.log(`[ZKT Background] Cleared alarm "${alarm.name}"`);
    }
  }
}

/**
 * Clear all ticket reminder alarms
 */
async function clearAllTicketReminders() {
  const alarms = await chrome.alarms.getAll();

  for (const alarm of alarms) {
    if (alarm.name.startsWith(TICKET_ALARM_PREFIX)) {
      await chrome.alarms.clear(alarm.name);
    }
  }

  console.log('[ZKT Background] Cleared all ticket reminder alarms');
}

/**
 * Handle alarm trigger - show notification
 */
async function handleTicketReminderAlarm(alarmName) {
  // Extract ticket ID and minutes from alarm name
  // Format: ticket-reminder-{ticketId}-{minutes}
  const match = alarmName.match(/^ticket-reminder-(\d+)-(\d+)$/);
  if (!match) return;

  const ticketId = match[1];
  const minutes = match[2];

  // Get active ticket info
  const result = await chrome.storage.local.get(['activeTicket']);
  const activeTicket = result.activeTicket;

  if (!activeTicket || activeTicket.ticketId !== ticketId) {
    console.log('[ZKT Background] Ticket no longer active, skipping notification');
    return;
  }

  // Show notification
  const subject = activeTicket.subject || `Ticket #${ticketId}`;

  // Create notification
  chrome.notifications.create(`ticket-time-${ticketId}-${minutes}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: `${minutes} Minutes on Ticket`,
    message: `You've been working on "${subject}" for ${minutes} minutes.`,
    priority: 2,
    requireInteraction: false,
  });

  console.log(`[ZKT Background] Showed ${minutes}-minute reminder for ticket #${ticketId}`);
}

// Listen for alarms
chrome.alarms.onAlarm.addListener((alarm) => {
  console.log('[ZKT Background] Alarm triggered:', alarm.name);

  if (alarm.name.startsWith(TICKET_ALARM_PREFIX)) {
    handleTicketReminderAlarm(alarm.name);
  }
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

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[ZKT Background] Installed:', details.reason);

  // Initialize storage on first install
  if (details.reason === 'install') {
    const companyId = 'company_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

    chrome.storage.local.set({
      companies: {
        [companyId]: {
          name: 'Default Company',
          color: '#5046e5',
          metrics: createEmptyMetrics(),
          goals: DEFAULT_GOALS,
          history: [],
          ticketTimeCache: { date: getTodayDateString(), tickets: {} },
          ticketHistory: []
        }
      },
      activeCompanyId: companyId,
      reminderSettings: DEFAULT_REMINDER_SETTINGS,
      trackingEnabled: true
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
