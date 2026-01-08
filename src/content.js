/**
 * Zendesk KPI Tracker - Content Script
 *
 * Injects into Zendesk pages and tracks user interactions.
 *
 * IMPORTANT: Zendesk uses dynamic CSS classes that may change.
 * Update the SELECTORS object below if tracking stops working.
 *
 * How to find selectors:
 * 1. Right-click the element in Zendesk
 * 2. Click "Inspect"
 * 3. Copy the class name, data attribute, or aria-label
 * 4. Update the corresponding selector below
 */

// ============================================================================
// SELECTOR CONSTANTS - EDIT THESE IF ZENDESK CHANGES THEIR UI
// ============================================================================

const SELECTORS = {
  // TICKET REPLIES - Submit/Send button selectors
  REPLY_SUBMIT_BUTTONS: [
    // Zendesk Agent Workspace - Submit dropdown menu items only (not the dropdown trigger)
    '[data-test-id^="submit_button-menu"]',   // Submit dropdown menu items (Submit as Pending, etc.)
    // Other Zendesk submit buttons (fallbacks for different UI versions)
    '[data-test-id="submit-button"]',
    '[data-test-id="ticket-submit-button"]',
    '[data-test-id="omni-button-submit"]',
    '[data-test-id="composer-submit-button"]',
    '[data-test-id="pane-footer"] button[type="submit"]',
    // Generic button selectors
    'button[type="submit"]',
    '[aria-label="Submit"]',
    '[aria-label="Submit as"]',
    '[aria-label="Send"]',
    // Agent Workspace
    '.ticket-resolution-footer button[type="submit"]',
    'footer[data-test-id] button[type="submit"]',
  ],

  // Channel switcher to detect Public Reply vs Internal Note
  CHANNEL_SWITCHER: '[data-test-id="omnichannel-channel-switcher-button"]',

  // Aria labels that indicate a PUBLIC reply (not internal note)
  PUBLIC_REPLY_INDICATORS: [
    'Public reply',
    'Email',
    'Web',
    'Chat',
    'Messaging',
  ],

  // Text patterns to match in buttons (case-insensitive)
  REPLY_BUTTON_TEXT: ['submit', 'send', 'submit as'],

  // CHAT - End chat buttons and indicators
  CHAT_END_BUTTONS: [
    '[data-test-id="end-chat-button"]',
    '[data-test-id="chat-end"]',
    '[aria-label="End chat"]',
    '[aria-label="End Chat"]',
    'button[title="End chat"]',
    '[data-action="end-chat"]',
  ],

  CHAT_END_TEXT: ['end chat', 'end conversation', 'close chat'],

  // CALLS - CTI/Talk indicators
  CTI_CALL_END_BUTTONS: [
    '[data-test-id="end-call-button"]',
    '[data-test-id="hangup-button"]',
    '[aria-label="End call"]',
    '[aria-label="Hang up"]',
    '[data-test-id="talk-hangup"]',
  ],

  CTI_CALL_END_TEXT: ['end call', 'hang up', 'hangup'],

  // Inbound call indicators (when call starts)
  CTI_INBOUND_INDICATORS: [
    '[data-test-id="incoming-call"]',
    '[data-call-direction="inbound"]',
    '[aria-label*="incoming"]',
    '[aria-label*="Incoming"]',
  ],

  // Outbound call indicators (dial button)
  CTI_OUTBOUND_TRIGGERS: [
    '[data-test-id="dial-button"]',
    '[data-test-id="make-call"]',
    '[aria-label="Dial"]',
    '[aria-label="Make call"]',
    '[aria-label="Call"]',
  ],
};

// ============================================================================
// DEBUG MODE - Set to true to see all click events in console
// ============================================================================

const DEBUG_MODE = true;

// ============================================================================
// STATE
// ============================================================================

const state = {
  lastCallDirection: null,
  isCallActive: false,
  lastEventTime: {},
  debounceMs: 2000, // Prevent double-counting within 2 seconds
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function log(...args) {
  console.log('[ZKT Content]', ...args);
}

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

/**
 * Check if event should be debounced (prevent double-counting)
 */
function shouldDebounce(eventType) {
  const now = Date.now();
  const lastTime = state.lastEventTime[eventType] || 0;

  if (now - lastTime < state.debounceMs) {
    log(`Debounced ${eventType} (too soon after last event)`);
    return true;
  }

  state.lastEventTime[eventType] = now;
  return false;
}

/**
 * Check if element matches any selector in list
 */
function matchesAnySelector(element, selectors) {
  for (const selector of selectors) {
    try {
      if (element.matches(selector) || element.closest(selector)) {
        return true;
      }
    } catch (e) {
      // Invalid selector, skip
    }
  }
  return false;
}

/**
 * Check if element text matches any pattern
 */
function matchesTextPattern(element, patterns) {
  const text = (element.textContent || '').toLowerCase().trim();
  return patterns.some((pattern) => text.includes(pattern.toLowerCase()));
}

/**
 * Check if the composer is in "Public reply" mode (not internal note)
 * Returns true if it's a public reply, false if it's an internal note
 */
function isPublicReplyMode() {
  // Find the channel switcher button
  const channelSwitcher = document.querySelector(SELECTORS.CHANNEL_SWITCHER);

  if (!channelSwitcher) {
    // If no channel switcher found, assume it's a reply (older Zendesk UI)
    log('No channel switcher found, assuming public reply');
    return true;
  }

  // Check the aria-label to determine the current mode
  const ariaLabel = channelSwitcher.getAttribute('aria-label') || '';
  const dataChannel = channelSwitcher.getAttribute('data-channel') || '';

  if (DEBUG_MODE) {
    log('Channel switcher found:', { ariaLabel, dataChannel });
  }

  // Check if it's internal note mode
  if (ariaLabel.toLowerCase().includes('internal') || dataChannel === 'internal') {
    log('Internal note mode detected - NOT tracking as reply');
    return false;
  }

  // Check if it matches any public reply indicator
  const isPublic = SELECTORS.PUBLIC_REPLY_INDICATORS.some(
    indicator => ariaLabel.toLowerCase().includes(indicator.toLowerCase())
  );

  if (isPublic) {
    log('Public reply mode detected');
    return true;
  }

  // Default: if we can't determine, don't track (safer)
  log('Could not determine reply mode, not tracking');
  return false;
}

// ============================================================================
// STORAGE FUNCTIONS (Direct storage access for reliability)
// ============================================================================

async function trackMetric(metricType) {
  if (shouldDebounce(metricType)) return;

  log(`Tracking: ${metricType}`);

  try {
    // Get current metrics from storage
    const result = await chrome.storage.local.get(['metrics']);
    let metrics = result.metrics || createEmptyMetrics();

    // Check for new day
    if (metrics.date !== getTodayDateString()) {
      // Archive old metrics
      const historyResult = await chrome.storage.local.get(['history']);
      const history = historyResult.history || [];

      if (metrics.date) {
        history.push({
          date: metrics.date,
          reply: metrics.reply || 0,
          chat: metrics.chat || 0,
          inbound: metrics.inbound || 0,
          outbound: metrics.outbound || 0,
        });
        await chrome.storage.local.set({ history: history.slice(-90) });
      }

      metrics = createEmptyMetrics();
    }

    // Increment the metric
    if (metrics[metricType] !== undefined) {
      metrics[metricType]++;
      metrics.lastUpdated = Date.now();
      await chrome.storage.local.set({ metrics });

      log(`Tracked ${metricType}:`, metrics[metricType]);
      showNotification(metricType);
    }
  } catch (error) {
    log('Error tracking metric:', error);
  }
}

// ============================================================================
// NOTIFICATION
// ============================================================================

function showNotification(metricType) {
  const labels = {
    reply: 'Reply Sent',
    chat: 'Chat Completed',
    inbound: 'Inbound Call',
    outbound: 'Outbound Call',
  };

  // Create notification element
  const notification = document.createElement('div');
  notification.id = 'zkt-notification';
  notification.innerHTML = `
    <div style="
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: linear-gradient(135deg, #10b981, #059669);
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      animation: zkt-slide-in 0.3s ease-out;
    ">
      <span style="font-size: 16px;">✓</span>
      <span>${labels[metricType] || metricType} tracked!</span>
    </div>
  `;

  // Add animation styles if not present
  if (!document.getElementById('zkt-styles')) {
    const styles = document.createElement('style');
    styles.id = 'zkt-styles';
    styles.textContent = `
      @keyframes zkt-slide-in {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
    `;
    document.head.appendChild(styles);
  }

  // Remove existing notification
  document.getElementById('zkt-notification')?.remove();

  // Add new notification
  document.body.appendChild(notification);

  // Remove after 2.5 seconds
  setTimeout(() => notification.remove(), 2500);
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

/**
 * Get debug info about an element for logging
 */
function getElementDebugInfo(element) {
  if (!element) return 'null';

  const info = {
    tag: element.tagName?.toLowerCase(),
    id: element.id || null,
    classes: element.className || null,
    type: element.getAttribute('type'),
    'data-test-id': element.getAttribute('data-test-id'),
    'aria-label': element.getAttribute('aria-label'),
    text: (element.textContent || '').trim().substring(0, 50),
  };

  // Remove null values for cleaner output
  Object.keys(info).forEach(key => {
    if (info[key] === null || info[key] === '') delete info[key];
  });

  return info;
}

/**
 * Find the nearest button/interactive element from click target
 */
function findInteractiveParent(element, maxDepth = 5) {
  let current = element;
  let depth = 0;

  while (current && depth < maxDepth) {
    if (current.tagName === 'BUTTON' ||
        current.tagName === 'A' ||
        current.getAttribute('role') === 'button' ||
        current.getAttribute('data-test-id')) {
      return current;
    }
    current = current.parentElement;
    depth++;
  }

  return element;
}

/**
 * Handle click events for tracking
 */
function handleClick(event) {
  const rawTarget = event.target;
  if (!rawTarget || rawTarget.nodeType !== Node.ELEMENT_NODE) return;

  // Find the actual interactive element (user might click on icon inside button)
  const target = findInteractiveParent(rawTarget);

  // DEBUG: Log every click on buttons/interactive elements
  if (DEBUG_MODE) {
    const isButton = target.tagName === 'BUTTON' ||
                     target.getAttribute('role') === 'button' ||
                     target.tagName === 'A';

    if (isButton || target.getAttribute('data-test-id')) {
      console.group('[ZKT DEBUG] Click detected');
      console.log('Raw target:', getElementDebugInfo(rawTarget));
      console.log('Interactive target:', getElementDebugInfo(target));
      console.log('Element:', target);

      // Test each selector category
      console.log('Matches REPLY_SUBMIT_BUTTONS:', matchesAnySelector(target, SELECTORS.REPLY_SUBMIT_BUTTONS));
      console.log('Matches REPLY_BUTTON_TEXT:', target.tagName === 'BUTTON' && matchesTextPattern(target, SELECTORS.REPLY_BUTTON_TEXT));
      console.log('Is Public Reply Mode:', isPublicReplyMode());
      console.log('Matches CHAT_END_BUTTONS:', matchesAnySelector(target, SELECTORS.CHAT_END_BUTTONS));
      console.log('Matches CTI_CALL_END_BUTTONS:', matchesAnySelector(target, SELECTORS.CTI_CALL_END_BUTTONS));
      console.groupEnd();
    }
  }

  // Check for Reply/Submit buttons
  if (matchesAnySelector(target, SELECTORS.REPLY_SUBMIT_BUTTONS)) {
    log('Reply submit button clicked (selector match)');
    // Only track if it's a PUBLIC reply (not internal note)
    if (isPublicReplyMode()) {
      setTimeout(() => trackMetric('reply'), 300);
    } else {
      log('Skipped tracking - internal note detected');
    }
    return;
  }

  // Check button text for replies
  if (target.tagName === 'BUTTON' && matchesTextPattern(target, SELECTORS.REPLY_BUTTON_TEXT)) {
    log('Reply submit button clicked (text match)');
    // Only track if it's a PUBLIC reply (not internal note)
    if (isPublicReplyMode()) {
      setTimeout(() => trackMetric('reply'), 300);
    } else {
      log('Skipped tracking - internal note detected');
    }
    return;
  }

  // Check for Chat End buttons
  if (matchesAnySelector(target, SELECTORS.CHAT_END_BUTTONS)) {
    log('End chat button clicked (selector match)');
    setTimeout(() => trackMetric('chat'), 300);
    return;
  }

  // Check button text for chat end
  if (target.tagName === 'BUTTON' && matchesTextPattern(target, SELECTORS.CHAT_END_TEXT)) {
    log('End chat button clicked (text match)');
    setTimeout(() => trackMetric('chat'), 300);
    return;
  }

  // Check for Call End buttons
  if (matchesAnySelector(target, SELECTORS.CTI_CALL_END_BUTTONS)) {
    log('End call button clicked');
    const metric = state.lastCallDirection === 'outbound' ? 'outbound' : 'inbound';
    setTimeout(() => trackMetric(metric), 300);
    state.isCallActive = false;
    state.lastCallDirection = null;
    return;
  }

  // Check button text for call end
  if (target.tagName === 'BUTTON' && matchesTextPattern(target, SELECTORS.CTI_CALL_END_TEXT)) {
    log('End call button clicked (text match)');
    const metric = state.lastCallDirection === 'outbound' ? 'outbound' : 'inbound';
    setTimeout(() => trackMetric(metric), 300);
    state.isCallActive = false;
    state.lastCallDirection = null;
    return;
  }

  // Check for Outbound Call triggers (dial button)
  if (matchesAnySelector(target, SELECTORS.CTI_OUTBOUND_TRIGGERS)) {
    log('Outbound call initiated');
    state.lastCallDirection = 'outbound';
    state.isCallActive = true;
    return;
  }
}

// ============================================================================
// MUTATION OBSERVER (for DOM changes)
// ============================================================================

function setupMutationObserver() {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== 'childList') continue;

      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        // Check for incoming call indicators
        if (matchesAnySelector(node, SELECTORS.CTI_INBOUND_INDICATORS)) {
          log('Inbound call detected');
          state.lastCallDirection = 'inbound';
          state.isCallActive = true;
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  log('MutationObserver started');
  return observer;
}

// ============================================================================
// MESSAGE HANDLER (for popup communication)
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ status: 'active', url: window.location.href });
    return true;
  }
  return false;
});

// ============================================================================
// DEBUG HELPERS (available in browser console)
// ============================================================================

/**
 * Expose debug helpers on window for console access
 * Usage in browser console:
 *   ZKT.inspect()  - Then click an element to see its selectors
 *   ZKT.test()     - Manually trigger a reply tracking
 *   ZKT.selectors  - View current selectors
 */
window.ZKT = {
  // View current selectors
  selectors: SELECTORS,

  // Test tracking manually
  test: (type = 'reply') => {
    trackMetric(type);
    console.log(`[ZKT] Manually tracked: ${type}`);
  },

  // Start inspect mode - click any element to see its details
  inspect: () => {
    console.log('[ZKT] INSPECT MODE: Click any element to see its selector info...');
    console.log('[ZKT] Click anywhere to exit inspect mode.');

    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();

      const el = e.target;
      console.group('[ZKT INSPECT] Element clicked:');
      console.log('Element:', el);
      console.log('Tag:', el.tagName);
      console.log('ID:', el.id || '(none)');
      console.log('Classes:', el.className || '(none)');
      console.log('data-test-id:', el.getAttribute('data-test-id') || '(none)');
      console.log('aria-label:', el.getAttribute('aria-label') || '(none)');
      console.log('type:', el.getAttribute('type') || '(none)');
      console.log('Text:', (el.textContent || '').trim().substring(0, 100));

      // Suggest selectors
      console.log('\n--- Suggested selectors to add: ---');
      if (el.getAttribute('data-test-id')) {
        console.log(`  '[data-test-id="${el.getAttribute('data-test-id')}"]'`);
      }
      if (el.getAttribute('aria-label')) {
        console.log(`  '[aria-label="${el.getAttribute('aria-label')}"]'`);
      }
      if (el.id) {
        console.log(`  '#${el.id}'`);
      }
      if (el.className && typeof el.className === 'string') {
        const firstClass = el.className.split(' ')[0];
        if (firstClass && !firstClass.includes('_')) {
          console.log(`  '.${firstClass}'`);
        }
      }
      console.groupEnd();

      // Remove handler after one click
      document.removeEventListener('click', handler, true);
      console.log('[ZKT] Inspect mode ended.');
    };

    document.addEventListener('click', handler, true);
  },

  // Show current storage data
  storage: async () => {
    const data = await chrome.storage.local.get(null);
    console.log('[ZKT] Current storage:', data);
    return data;
  },

  // Toggle debug mode
  debug: (enabled) => {
    window.ZKT_DEBUG = enabled;
    console.log(`[ZKT] Debug mode: ${enabled ? 'ON' : 'OFF'}`);
  }
};

// ============================================================================
// INITIALIZATION
// ============================================================================

function init() {
  log('Initializing on:', window.location.href);

  // Add click listener (capture phase to catch all clicks)
  document.addEventListener('click', handleClick, true);

  // Setup mutation observer for DOM changes
  setupMutationObserver();

  log('Initialized successfully');
  log('Debug helpers available: Type ZKT.inspect() in console to identify elements');
}

// Wait for document to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
