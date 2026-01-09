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
    '[data-test-id^="submit_button-menu-"]:not([data-test-id="submit_button-menu-button"])',   // Submit dropdown menu items (Submit as Pending, etc.)
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

// ============================================================================
// NETWORK INTERCEPTION - Track actual reply submissions
// ============================================================================

/**
 * Check if API request is a reply submission and if it's public
 */
function isPublicReplyRequest(url, method, payload) {
  if (method !== 'POST') {
    return null; // Not a POST request
  }

  // Parse payload to check if it's a reply/comment
  try {
    let data = payload;

    // If payload is a string, try to parse it
    if (typeof payload === 'string') {
      data = JSON.parse(payload);
    }

    // Handle GraphQL API (modern Zendesk)
    if (url.includes('/api/graphql')) {
      const operationName = data?.operationName || '';
      const variables = data?.variables || {};

      if (DEBUG_MODE) {
        log('GraphQL request detected:', { operationName, variables });
      }

      // Check if this is a comment/reply mutation
      // Common GraphQL mutation names for comments/replies
      const replyOperations = [
        'sendmessage',
        'createmessage',
        'addcomment',
        'createcomment',
        'submitticket',
        'updateticket',
        'sendreply',
        'createreply',
      ];

      const isReplyOperation = replyOperations.some(op =>
        operationName.toLowerCase().includes(op)
      );

      if (!isReplyOperation) {
        return null; // Not a reply operation
      }

      if (DEBUG_MODE) {
        log('Reply operation detected:', { operationName, variables });
      }

      // Check if the comment/message is public
      // GraphQL variables can have different structures
      const message = variables?.message || variables?.comment || variables?.input?.message || variables?.input?.comment;

      if (message) {
        // Check for isPublic, public, or isInternal fields
        if (message.isPublic !== undefined) {
          return message.isPublic === true;
        }
        if (message.public !== undefined) {
          return message.public === true;
        }
        if (message.isInternal !== undefined) {
          return message.isInternal === false; // isInternal: false means it's public
        }
      }

      // Check top-level variables
      if (variables.isPublic !== undefined) {
        return variables.isPublic === true;
      }
      if (variables.public !== undefined) {
        return variables.public === true;
      }
      if (variables.isInternal !== undefined) {
        return variables.isInternal === false;
      }

      // Default to true if we can't determine (safer to track)
      if (DEBUG_MODE) {
        log('Could not determine public/private from GraphQL, defaulting to public', variables);
      }
      return true;
    }

    // Handle REST API (legacy Zendesk)
    const replyEndpoints = [
      '/api/v2/tickets/',
      '/api/v2/channels/voice/tickets/',
      'api/lotus/tickets/',
      'api/v2/any_channel/tickets/',
    ];

    const isReplyEndpoint = replyEndpoints.some(endpoint => url.includes(endpoint)) &&
                            (url.includes('/comments') || url.includes('/comment'));

    if (isReplyEndpoint) {
      if (DEBUG_MODE) {
        log('REST reply API call detected:', { url, payload });
      }

      // Check various payload structures Zendesk uses
      const comment = data?.comment || data?.ticket?.comment || data;

      // If public field exists, use it directly
      if (comment?.public !== undefined) {
        return comment.public === true;
      }

      return true; // Default to tracking
    }

    return null; // Not a reply request
  } catch (e) {
    if (DEBUG_MODE) {
      log('Error parsing reply payload:', e);
    }
    return null; // Don't track if we can't parse
  }
}

/**
 * Intercept fetch() calls
 */
function interceptFetch() {
  const originalFetch = window.fetch;

  if (!originalFetch) {
    log('ERROR: window.fetch is not available!');
    return;
  }

  window.fetch = function(...args) {
    const [resource, config] = args;
    const url = typeof resource === 'string' ? resource : resource.url;
    const method = config?.method || 'GET';
    const body = config?.body;

    if (DEBUG_MODE) {
      log('Fetch intercepted:', { url, method });
    }

    // Check if this is a public reply submission
    const isPublic = isPublicReplyRequest(url, method.toUpperCase(), body);

    // Call original fetch
    const promise = originalFetch.apply(this, args);

    // Track successful public replies
    if (isPublic) {
      promise.then(response => {
        if (response.ok) {
          log('Public reply sent via fetch');
          trackMetric('reply');
        }
      }).catch(() => {
        // Ignore errors (reply failed, don't track)
      });
    }

    return promise;
  };

  log('Fetch interception installed successfully');
}

/**
 * Intercept XMLHttpRequest calls
 */
function interceptXHR() {
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._method = method;
    this._url = url;
    return originalOpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function(body) {
    const method = this._method;
    const url = this._url;

    // Check if this is a public reply submission
    const isPublic = isPublicReplyRequest(url, method, body);

    if (isPublic) {
      // Listen for successful completion
      this.addEventListener('load', function() {
        if (this.status >= 200 && this.status < 300) {
          log('Public reply sent via XHR');
          trackMetric('reply');
        }
      });
    }

    return originalSend.apply(this, arguments);
  };
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

  // NOTE: Reply tracking is now done via network interception, not button clicks

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
// INJECT SCRIPT INTO PAGE CONTEXT
// ============================================================================

/**
 * Inject fetch/XHR interception into the page's main world
 * This is necessary because content scripts run in an isolated world
 */
function injectInterceptionScript() {
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('inject.js');
  script.onload = function() {
    this.remove(); // Clean up after loading
  };

  // Inject before any other scripts
  (document.head || document.documentElement).appendChild(script);

  log('Interception script injected into page context');
}

// Inject immediately
injectInterceptionScript();

// ============================================================================
// LISTEN FOR MESSAGES FROM INJECTED SCRIPT
// ============================================================================

window.addEventListener('message', (event) => {
  // Only accept messages from same window
  if (event.source !== window) return;

  // Handle GraphQL requests from fetch
  if (event.data.type === 'ZKT_GRAPHQL_REQUEST') {
    const { operationName, variables } = event.data.data;

    log('GraphQL request from page:', { operationName, variables });

    checkAndTrackReply(operationName, variables);
  }

  // Handle WebSocket messages
  if (event.data.type === 'ZKT_WEBSOCKET_MESSAGE') {
    const { payload } = event.data.data;

    // Check for Zendesk custom WebSocket protocol (not GraphQL)
    if (payload && payload.type) {
      const msgType = payload.type;
      const status = payload.status || '';
      const value = payload.value || {};

      // Log for debugging
      if (DEBUG_MODE && msgType !== 'PING' && msgType !== 'PONG') {
        log('WebSocket message:', { type: msgType, status });
      }

      // Check if this is a ticket update/submission message
      // Look for messages with specific status patterns
      if (msgType === 'call' && status.includes('/tickets/')) {
        log('Ticket interaction detected:', { type: msgType, status, value });

        // Check for completion/submission indicators in the status
        // "beginPath" = start of edit (don't track)
        // "commitPath" = submission (track this!)
        // "endPath" = end of operation (possibly track)

        if (status.includes('commitPath') || status.includes('endPath') || status.includes('submit')) {
          log('Ticket submission detected - tracking reply');
          trackMetric('reply');
        } else if (status.includes('beginPath')) {
          log('Ticket edit started (not submission) - not tracking');
        } else {
          log('Unknown ticket operation:', status);
        }
      }
    }

    // Also check for standard GraphQL format (fallback)
    if (payload && payload.operationName) {
      checkAndTrackReply(payload.operationName, payload.variables);
    }
  }
});

/**
 * Check if operation is a reply and track if public
 */
function checkAndTrackReply(operationName, variables) {
  // Check if this is a reply operation
  const replyOperations = [
    'sendmessage',
    'createmessage',
    'addcomment',
    'createcomment',
    'submitticket',
    'updateticket',
    'sendreply',
    'createreply',
  ];

  const isReplyOperation = replyOperations.some(op =>
    operationName.toLowerCase().includes(op)
  );

  if (isReplyOperation) {
    log('Reply operation detected:', { operationName, variables });

    // Check if public
    const message = variables?.message || variables?.comment || variables?.input?.message || variables?.input?.comment;
    let isPublic = true; // Default to public

    if (message) {
      if (message.isPublic !== undefined) {
        isPublic = message.isPublic === true;
      } else if (message.public !== undefined) {
        isPublic = message.public === true;
      } else if (message.isInternal !== undefined) {
        isPublic = message.isInternal === false;
      }
    }

    if (isPublic) {
      log('Public reply detected - tracking');
      trackMetric('reply');
    } else {
      log('Internal note detected - not tracking');
    }
  }
}

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
