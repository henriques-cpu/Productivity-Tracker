/**
 * Zendesk KPI Tracker - Background Service Worker
 *
 * Handles ticket time reminders, context menus, and badge updates.
 * Note: Main data persistence is handled directly by popup.js and content.js
 * using chrome.storage.local for reliability.
 */

importScripts('metrics.js');

const {
  METRICS,
  DEFAULT_GOALS,
  getTodayDateString,
  createEmptyMetrics,
  normalizeMetrics,
  normalizeHistory,
  metricsTotal,
} = Metrics;

// ============================================================================
// CONSTANTS
// ============================================================================

// Default ticket time reminder settings (in minutes)
const DEFAULT_REMINDER_SETTINGS = {
  enabled: true,
  intervals: [5, 10, 15], // Remind at 5, 10, and 15 minutes
};

// Alarm name prefix for ticket reminders
const TICKET_ALARM_PREFIX = 'ticket-reminder-';

// Context menu item ids are this prefix plus the metric key
const CONTEXT_MENU_PREFIX = 'zkt-track-';

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

async function updateActiveCompany(updates) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['companies', 'activeCompanyId'], (result) => {
      const companies = result.companies || {};
      const activeId = result.activeCompanyId;

      if (activeId && companies[activeId]) {
        companies[activeId] = { ...companies[activeId], ...updates };
        chrome.storage.local.set({ companies }, () => resolve(true));
      } else {
        resolve(false);
      }
    });
  });
}

// ============================================================================
// METRICS
// ============================================================================

/**
 * Read the active company's metrics, rolling over to a fresh record (and
 * archiving the old one) when the stored counts are from a previous day.
 */
async function getMetrics() {
  const company = await getActiveCompany();

  if (!company) {
    return createEmptyMetrics();
  }

  const metrics = normalizeMetrics(company.data.metrics || createEmptyMetrics());

  if (metrics.date === getTodayDateString()) {
    return metrics;
  }

  const history = normalizeHistory(company.data.history);

  if (!history.some((entry) => entry.date === metrics.date)) {
    const { lastUpdated, ...archived } = metrics;
    history.push(archived);
  }

  const newMetrics = createEmptyMetrics();
  await updateActiveCompany({ metrics: newMetrics, history: history.slice(-90) });

  return newMetrics;
}

async function trackMetric(metricType) {
  const metrics = await getMetrics();

  if (metrics[metricType] === undefined) {
    console.warn('[ZKT Background] Unknown metric type:', metricType);
    return;
  }

  metrics[metricType]++;
  metrics.lastUpdated = Date.now();

  await updateActiveCompany({ metrics });
  updateBadge(metrics);

  console.log(`[ZKT Background] Tracked ${metricType}:`, metrics[metricType]);
}

// ============================================================================
// BADGE UPDATE
// ============================================================================

function updateBadge(metrics) {
  if (!metrics) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }

  const total = metricsTotal(metrics);

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

// Only the ticket-timer messages reach the service worker. Metric tracking is
// done directly against chrome.storage by popup.js and content.js.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[ZKT Background] Message received:', message.type);

  (async () => {
    try {
      switch (message.type) {
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

    // One sub-menu item per tracked metric
    METRICS.forEach((metric) => {
      chrome.contextMenus.create({
        id: `${CONTEXT_MENU_PREFIX}${metric.key}`,
        parentId: 'zkt-parent',
        title: `+ ${metric.short}`,
        contexts: ['page'],
        documentUrlPatterns: ['*://*.zendesk.com/*'],
      });
    });

    console.log('[ZKT Background] Context menu created');
  });
}

chrome.contextMenus.onClicked.addListener((info) => {
  if (typeof info.menuItemId === 'string' && info.menuItemId.startsWith(CONTEXT_MENU_PREFIX)) {
    trackMetric(info.menuItemId.slice(CONTEXT_MENU_PREFIX.length));
  }
});

// ============================================================================
// INSTALLATION HANDLERS
// ============================================================================

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[ZKT Background] Installed:', details.reason);

  // Initialize storage on first install
  if (details.reason === 'install') {
    const companyId = `company_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

    chrome.storage.local.set({
      companies: {
        [companyId]: {
          name: 'Default Company',
          color: '#5046e5',
          zendeskSubdomain: null,
          metrics: createEmptyMetrics(),
          goals: { ...DEFAULT_GOALS },
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

// Listen for storage changes to update badge. Metrics are nested inside the
// `companies` record, so that - and the active company - is what to watch.
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && (changes.companies || changes.activeCompanyId)) {
    getMetrics().then(updateBadge);
  }
});

// Initialize badge on load
getMetrics().then(updateBadge);

console.log('[ZKT Background] Service worker loaded');
