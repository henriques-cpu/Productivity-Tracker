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
    'SMS',
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

// NOTE: Fetch and XHR interception is now handled in inject.js (runs in page context)
// Content scripts run in an isolated world and cannot intercept page-level fetch/XHR calls
// The inject.js script intercepts responses (more reliable than requests) and forwards
// them via postMessage to this content script for analysis.

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
 * Returns object with isPublic flag and channel type
 * @returns {{isPublic: boolean, channel?: string}} Reply mode info
 */
function isPublicReplyMode() {
  // Find the channel switcher button
  const channelSwitcher = document.querySelector(SELECTORS.CHANNEL_SWITCHER);

  if (!channelSwitcher) {
    // If no channel switcher found, assume it's a reply (older Zendesk UI)
    log('No channel switcher found, assuming public reply');
    return { isPublic: true, channel: null };
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
    return { isPublic: false };
  }

  // Detect specific channel type from aria-label (only track: email, sms, chat)
  const ariaLabelLower = ariaLabel.toLowerCase();
  let channel = null;

  if (ariaLabelLower.includes('email')) {
    channel = 'email';
  } else if (ariaLabelLower.includes('sms')) {
    channel = 'sms';
  } else if (ariaLabelLower.includes('chat')) {
    channel = 'chat';
  }

  // Check if it matches any public reply indicator
  const isPublic = SELECTORS.PUBLIC_REPLY_INDICATORS.some(
    indicator => ariaLabelLower.includes(indicator.toLowerCase())
  );

  if (isPublic) {
    log(`Public reply mode detected - Channel: ${channel || 'untracked'}`);
    return { isPublic: true, channel };
  }

  // Default: if we can't determine, don't track (safer)
  log('Could not determine reply mode, not tracking');
  return { isPublic: false };
}

// ============================================================================
// STORAGE FUNCTIONS (Direct storage access for reliability)
// ============================================================================

async function trackMetric(metricType, channel = null) {
  if (shouldDebounce(metricType)) return;

  // Check if tracking is enabled
  const trackingState = await chrome.storage.local.get(['trackingEnabled']);
  const isTrackingEnabled = trackingState.trackingEnabled !== false; // Default to true

  if (!isTrackingEnabled) {
    log(`Tracking is disabled - skipping ${metricType}`);
    return;
  }

  log(`Tracking: ${metricType}${channel ? ` (${channel})` : ''}`);

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
          replyEmail: metrics.replyEmail || 0,
          replySMS: metrics.replySMS || 0,
          replyChat: metrics.replyChat || 0,
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

      // If tracking a reply with channel info, also increment channel-specific counter
      if (metricType === 'reply' && channel) {
        const channelKey = `reply${channel.charAt(0).toUpperCase() + channel.slice(1)}`;
        if (metrics[channelKey] !== undefined) {
          metrics[channelKey]++;
          log(`Tracked ${channelKey}:`, metrics[channelKey]);
        }
      }

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
      background: linear-gradient(135deg, #7b1fa2, #9c27b0);
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

        // DOM OBSERVATION: Check for newly added comments/replies (FALLBACK detection)
        // This provides visual confirmation that a reply was actually submitted
        detectNewReplyInDOM(node);
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

/**
 * Detect newly added reply/comment elements in DOM (fallback detection method)
 * This runs when the mutation observer detects new DOM nodes
 */
function detectNewReplyInDOM(node) {
  // Check if this node or any child is a comment/event element
  // Common selectors for Zendesk Agent Workspace comments:
  // - [data-test-id*="comment"]
  // - [data-test-id*="event"]
  // - [data-garden-id*="typography.paragraph"] (comment text)
  // - Elements with class containing "event" or "comment"

  const isCommentElement = node.matches?.(
    '[data-test-id*="comment"], ' +
    '[data-test-id*="event"], ' +
    '[data-test-id*="ticket-event"], ' +
    '[class*="Comment"], ' +
    '[class*="Event"]'
  );

  // Also check children
  const hasCommentChild = node.querySelector?.(
    '[data-test-id*="comment"], ' +
    '[data-test-id*="event"], ' +
    '[data-test-id*="ticket-event"]'
  );

  if (isCommentElement || hasCommentChild) {
    const commentNode = isCommentElement ? node : hasCommentChild;

    // Check if this is an internal note (has "Internal" badge)
    const hasInternalBadge = commentNode.textContent?.includes('Internal') ||
                             commentNode.querySelector?.('[data-test-id*="internal"]') ||
                             commentNode.querySelector?.('[aria-label*="Internal"]');

    // Check if this is an agent comment (not customer message)
    // Look for agent avatar indicators or "Henrique" (agent name from screenshot)
    const isAgentComment = commentNode.querySelector?.(
      '[data-test-id*="agent"], ' +
      '[data-test-id*="author"], ' +
      '[class*="Agent"]'
    );

    // Only track if it's an agent comment and NOT internal
    if (isAgentComment && !hasInternalBadge) {
      // Use a small delay to avoid double-counting with API detection
      setTimeout(() => {
        log('DOM: New public reply element detected (fallback confirmation)');
        // Don't track here - API response detection should handle it
        // This is just for logging/debugging
      }, 100);
    } else if (hasInternalBadge) {
      log('DOM: Internal note detected - not tracking');
    }
  }
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
// API RESPONSE ANALYSIS
// ============================================================================

/**
 * Analyze API response to detect public reply submissions
 * This is the PRIMARY detection method - analyzing actual server responses
 * is more reliable than analyzing requests.
 */
function analyzeApiResponse(url, response, requestBody) {
  // GraphQL API responses
  if (url.includes('/api/graphql')) {
    return analyzeGraphQLResponse(response, requestBody);
  }

  // REST API responses
  if (url.includes('/api/v2/tickets') ||
      url.includes('/api/lotus/tickets') ||
      url.includes('/api/v2/any_channel/tickets') ||
      url.includes('/api/v2/channels/voice/tickets')) {
    return analyzeRestApiResponse(response, requestBody);
  }

  return false;
}

/**
 * Analyze GraphQL API response
 */
function analyzeGraphQLResponse(response, requestBody) {
  // Parse request to understand what was sent
  let operationName = '';
  let requestVariables = {};

  try {
    const request = JSON.parse(requestBody);
    operationName = request.operationName || '';
    requestVariables = request.variables || {};
  } catch (e) {
    log('Could not parse GraphQL request body');
  }

  // SPECIAL CASE: BFFConvoLogQuery returns conversation events after submission
  // This is Zendesk Agent Workspace's way of showing the conversation log
  if (operationName === 'BFFConvoLogQuery') {
    return analyzeBFFConvoLogResponse(response);
  }

  // Check if operation is a reply/comment operation
  const replyOperations = [
    'sendmessage', 'createmessage', 'addcomment', 'createcomment',
    'submitticket', 'updateticket', 'sendreply', 'createreply'
  ];

  const isReplyOperation = replyOperations.some(op =>
    operationName.toLowerCase().includes(op)
  );

  if (!isReplyOperation) {
    return false;
  }

  log('Reply operation detected in response:', operationName);

  // Check response data for public flag
  // GraphQL responses typically have: { data: { operationName: { ... } } }
  const data = response?.data;
  if (!data) {
    log('No data in GraphQL response');
    return false;
  }

  // Look through response data for comment/message objects
  const findPublicFlag = (obj) => {
    if (!obj || typeof obj !== 'object') return null;

    // Check common field names
    if (obj.public !== undefined) return obj.public;
    if (obj.isPublic !== undefined) return obj.isPublic;
    if (obj.isInternal !== undefined) return !obj.isInternal;

    // Check nested objects
    for (const value of Object.values(obj)) {
      const result = findPublicFlag(value);
      if (result !== null) return result;
    }

    return null;
  };

  const isPublic = findPublicFlag(data);

  // If we found a public flag in response, use it
  if (isPublic !== null) {
    log(`Reply public flag from response: ${isPublic}`);
    return isPublic === true;
  }

  // Fallback: check request variables
  const message = requestVariables?.message ||
                  requestVariables?.comment ||
                  requestVariables?.input?.message ||
                  requestVariables?.input?.comment;

  if (message) {
    if (message.isPublic !== undefined) return message.isPublic === true;
    if (message.public !== undefined) return message.public === true;
    if (message.isInternal !== undefined) return message.isInternal === false;
  }

  // If we can't determine from response or request, check UI state
  log('Could not determine public flag from response or request, checking UI');
  return isPublicReplyMode();
}

/**
 * Analyze BFFConvoLogQuery response (Zendesk Agent Workspace conversation log)
 * This query returns conversation events, including newly added messages
 */
function analyzeBFFConvoLogResponse(response) {
  const ticket = response?.data?.ticket;
  if (!ticket) {
    return false;
  }

  const conversationEvents = ticket.conversationEvents;
  if (!conversationEvents || !conversationEvents.edges || conversationEvents.edges.length === 0) {
    return false;
  }

  // Get the most recent event (first in the array, since they're sorted by timestamp descending)
  const mostRecentEdge = conversationEvents.edges[0];
  const event = mostRecentEdge?.node;

  if (!event) {
    return false;
  }

  // Check timestamp - only track if message is very recent (within last 10 seconds)
  // This prevents tracking old messages when refreshing or navigating
  const eventTimestamp = new Date(event.timestamp).getTime();
  const now = Date.now();
  const ageInSeconds = (now - eventTimestamp) / 1000;

  log('BFFConvoLogQuery: Checking most recent event:', {
    id: event.id,
    typename: event.__typename,
    actor: event.actor?.name,
    actorRole: event.actor?.role,
    ageInSeconds: ageInSeconds.toFixed(1)
  });

  // Only process very recent events (within 10 seconds)
  if (ageInSeconds > 10) {
    log('BFFConvoLogQuery: Event too old, not tracking');
    return false;
  }

  // Check if this is a public message from an agent
  const isPublicMessage = event.__typename === 'PublicMessage';
  const isInternalNote = event.__typename === 'InternalNote';
  const isAgentMessage = event.actor?.role === 'AGENT';

  // Only track if:
  // 1. It's a PublicMessage (not InternalNote)
  // 2. It's from an Agent (not a Customer)
  // 3. Event is recent (checked above)
  if (isPublicMessage && isAgentMessage) {
    log('✓ BFFConvoLogQuery: Public message from agent detected');
    return true;
  }

  if (isInternalNote) {
    log('✗ BFFConvoLogQuery: Internal note detected');
    return false;
  }

  log('BFFConvoLogQuery: Not a trackable message');
  return false;
}

/**
 * Analyze REST API response
 */
function analyzeRestApiResponse(response, requestBody) {
  // REST API endpoint: /api/v2/tickets/{id}/comments
  // Check if URL contains /comments or /comment

  // Parse request body
  let requestData = {};
  try {
    requestData = JSON.parse(requestBody);
  } catch (e) {
    log('Could not parse REST request body');
  }

  // Response typically contains: { comment: { id, type, public, body, ... } }
  const comment = response?.comment || response?.ticket?.latest_comment;

  if (comment) {
    log('Comment found in REST response:', comment);

    // Check public flag in response (most reliable)
    if (comment.public !== undefined) {
      log(`Comment public flag: ${comment.public}`);
      return comment.public === true;
    }

    // Check type field (some endpoints use this)
    if (comment.type) {
      const isPublic = comment.type === 'Comment' || comment.type === 'public';
      log(`Comment type: ${comment.type} (public: ${isPublic})`);
      return isPublic;
    }
  }

  // Fallback: check request body
  const reqComment = requestData?.comment;
  if (reqComment?.public !== undefined) {
    log(`Using request public flag: ${reqComment.public}`);
    return reqComment.public === true;
  }

  // Last resort: check UI state
  log('Could not determine public flag from REST response, checking UI');
  return isPublicReplyMode();
}

// ============================================================================
// LISTEN FOR MESSAGES FROM INJECTED SCRIPT
// ============================================================================

window.addEventListener('message', (event) => {
  // Only accept messages from same window
  if (event.source !== window) return;

  // Handle API responses (PRIMARY detection method - most reliable!)
  if (event.data.type === 'ZKT_API_RESPONSE') {
    const { url, response, requestBody } = event.data.data;
    log('API Response intercepted:', { url, response });

    // Analyze response to detect public reply submissions
    const replyDetected = analyzeApiResponse(url, response, requestBody);
    if (replyDetected) {
      log('✓ Public reply confirmed via response - tracking');
      // Get channel information from the UI
      const replyMode = isPublicReplyMode();
      trackMetric('reply', replyMode.channel);
    }
  }

  // Handle GraphQL requests from fetch (FALLBACK - less reliable)
  if (event.data.type === 'ZKT_GRAPHQL_REQUEST') {
    const { operationName, variables } = event.data.data;

    log('GraphQL request from page:', { operationName, variables });

    checkAndTrackReply(operationName, variables);
  }

  // Handle WebSocket messages (FALLBACK - less reliable)
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
        // "submit" = submission (track this!)

        if (status.includes('commitPath') || status.includes('endPath') || status.includes('submit')) {
          // CRITICAL FIX: Check if reply mode is public before tracking
          const replyMode = isPublicReplyMode();

          if (replyMode.isPublic) {
            log(`✓ Public ticket submission via WebSocket (${replyMode.channel}) - tracking`);
            trackMetric('reply', replyMode.channel);
          } else {
            log('✗ Internal note via WebSocket - not tracking');
          }
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
      // Get channel information from the UI
      const replyMode = isPublicReplyMode();
      trackMetric('reply', replyMode.channel);
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
