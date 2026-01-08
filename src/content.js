/**
 * Zendesk KPI Tracker - Content Script
 *
 * This script injects into Zendesk pages and tracks user interactions
 * using DOM observation and event listeners.
 *
 * IMPORTANT: Zendesk uses dynamic CSS classes that may change.
 * Update the SELECTORS object below if tracking stops working.
 *
 * How to find selectors:
 * 1. Right-click the element in Zendesk
 * 2. Click "Inspect"
 * 3. Copy the class name or data attribute
 * 4. Update the corresponding selector below
 */

// ============================================================================
// SELECTOR CONSTANTS - EDIT THESE IF ZENDESK CHANGES THEIR UI
// ============================================================================

const SELECTORS = {
  // TICKET REPLIES - Submit/Send button selectors
  // Try multiple selectors as Zendesk may use different elements
  REPLY_SUBMIT_BUTTONS: [
    '[data-test-id="submit-button"]',
    '[data-test-id="ticket-submit-button"]',
    'button[data-garden-id="buttons.button"][type="submit"]',
    '.composer button[type="submit"]',
    '[aria-label="Submit"]',
    '[aria-label="Send"]',
    'button:contains("Submit")',
    'footer button[data-garden-id*="button"]',
    '[data-test-id="omni-button-submit"]',
    '.ticket-resolution-footer button',
    // Workspace/Agent Workspace selectors
    '[data-test-id="pane-footer"] button[type="submit"]',
    '[data-test-id="composer-submit-button"]',
    'button[data-test-id*="submit"]',
  ],

  // CHAT INTERACTIONS - End chat button and chat ended indicators
  CHAT_END_BUTTONS: [
    '[data-test-id="end-chat-button"]',
    '[aria-label="End chat"]',
    '[aria-label="End Chat"]',
    'button[title="End chat"]',
    '.chat-end-btn',
    '[data-test-id="chat-end"]',
    // Zendesk Chat widget selectors
    '.zd-chat-end',
    '[data-action="end-chat"]',
  ],

  CHAT_ENDED_INDICATORS: [
    '[data-test-id="chat-ended"]',
    '.chat-ended-message',
    '.chat-status-ended',
    '[data-chat-status="ended"]',
    // Text content patterns (checked separately)
  ],

  CHAT_ENDED_TEXT_PATTERNS: [
    'Chat ended',
    'Chat has ended',
    'Conversation ended',
    'Session ended',
  ],

  // CALL TRACKING - CTI bar selectors
  CTI_CALL_ENDED_INDICATORS: [
    '[data-test-id="call-ended"]',
    '[data-test-id="cti-call-ended"]',
    '.cti-call-ended',
    '[data-call-status="ended"]',
    '[aria-label="Call ended"]',
    // Talk/CTI specific selectors
    '.talk-call-ended',
    '[data-test-id="talk-status-idle"]',
    '.cti-status-idle',
  ],

  CTI_INBOUND_INDICATORS: [
    '[data-test-id="incoming-call"]',
    '[data-call-direction="inbound"]',
    '[data-test-id="cti-incoming"]',
    '.cti-incoming-call',
    '[aria-label*="incoming"]',
    '[aria-label*="Incoming"]',
    '.talk-incoming',
  ],

  CTI_OUTBOUND_INDICATORS: [
    '[data-test-id="outgoing-call"]',
    '[data-call-direction="outbound"]',
    '[data-test-id="cti-outgoing"]',
    '.cti-outgoing-call',
    '[aria-label*="outgoing"]',
    '[aria-label*="Outgoing"]',
    '.talk-outgoing',
    // Dial pad interaction
    '[data-test-id="dial-button"]',
    '[aria-label="Dial"]',
  ],

  CTI_ACTIVE_CALL_INDICATORS: [
    '[data-test-id="active-call"]',
    '[data-call-status="active"]',
    '.cti-call-active',
    '.talk-call-active',
    '[data-test-id="cti-connected"]',
  ],

  // CONTAINER ELEMENTS - For MutationObserver targets
  MAIN_CONTENT_CONTAINERS: [
    '#main',
    '[role="main"]',
    '.main-pane',
    '#ember-application',
    '.workspace',
    '[data-test-id="workspace"]',
    'body', // Fallback
  ],
};

// ============================================================================
// STATE TRACKING
// ============================================================================

const state = {
  lastCallDirection: null, // 'inbound' or 'outbound'
  isCallActive: false,
  processedEvents: new Set(), // Prevent duplicate counting
  observers: [],
  debugMode: true, // Set to false in production
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Log debug messages (only when debugMode is enabled)
 */
function debugLog(...args) {
  if (state.debugMode) {
    console.log('[Zendesk KPI Tracker]', ...args);
  }
}

/**
 * Generate a unique event ID to prevent duplicate counting
 */
function generateEventId(type) {
  return `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Check if an event was already processed (within last 2 seconds)
 */
function isDuplicateEvent(type) {
  const now = Date.now();
  const recentKey = `${type}-recent`;

  // Clean old entries
  state.processedEvents.forEach((value) => {
    if (value < now - 2000) {
      state.processedEvents.delete(value);
    }
  });

  const lastEventTime = Array.from(state.processedEvents)
    .filter(key => key.toString().startsWith(type))
    .pop();

  if (lastEventTime && now - lastEventTime < 2000) {
    debugLog(`Duplicate event prevented: ${type}`);
    return true;
  }

  state.processedEvents.add(`${type}-${now}`);
  return false;
}

/**
 * Find first matching element from a list of selectors
 */
function findElement(selectors) {
  for (const selector of selectors) {
    try {
      const element = document.querySelector(selector);
      if (element) {
        debugLog(`Found element with selector: ${selector}`);
        return element;
      }
    } catch (e) {
      // Invalid selector, skip
    }
  }
  return null;
}

/**
 * Find all matching elements from a list of selectors
 */
function findAllElements(selectors) {
  const elements = new Set();
  for (const selector of selectors) {
    try {
      const found = document.querySelectorAll(selector);
      found.forEach(el => elements.add(el));
    } catch (e) {
      // Invalid selector, skip
    }
  }
  return Array.from(elements);
}

/**
 * Check if any element contains specific text patterns
 */
function checkForTextPatterns(patterns) {
  for (const pattern of patterns) {
    const xpath = `//*[contains(text(), '${pattern}')]`;
    const result = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    if (result.singleNodeValue) {
      debugLog(`Found text pattern: ${pattern}`);
      return true;
    }
  }
  return false;
}

// ============================================================================
// METRIC TRACKING FUNCTIONS
// ============================================================================

/**
 * Send metric update to background script
 */
function trackMetric(metricType) {
  if (isDuplicateEvent(metricType)) {
    return;
  }

  debugLog(`Tracking metric: ${metricType}`);

  chrome.runtime.sendMessage({
    type: 'TRACK_METRIC',
    metric: metricType,
    timestamp: Date.now(),
    url: window.location.href,
  }, (response) => {
    if (chrome.runtime.lastError) {
      debugLog('Error sending metric:', chrome.runtime.lastError);
    } else {
      debugLog('Metric tracked successfully:', response);
      showTrackingNotification(metricType);
    }
  });
}

/**
 * Show a brief notification when a metric is tracked
 */
function showTrackingNotification(metricType) {
  const labels = {
    reply: 'Reply Sent',
    chat: 'Chat Completed',
    inbound: 'Inbound Call',
    outbound: 'Outbound Call',
  };

  const notification = document.createElement('div');
  notification.className = 'zkt-notification';
  notification.innerHTML = `
    <div class="zkt-notification-content">
      <span class="zkt-notification-icon">✓</span>
      <span class="zkt-notification-text">${labels[metricType] || metricType} tracked!</span>
    </div>
  `;

  // Add styles if not already present
  if (!document.getElementById('zkt-notification-styles')) {
    const styles = document.createElement('style');
    styles.id = 'zkt-notification-styles';
    styles.textContent = `
      .zkt-notification {
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        z-index: 999999;
        animation: zkt-slide-in 0.3s ease-out, zkt-fade-out 0.3s ease-in 2s forwards;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
      }
      .zkt-notification-content {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .zkt-notification-icon {
        font-size: 16px;
        font-weight: bold;
      }
      @keyframes zkt-slide-in {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes zkt-fade-out {
        from { opacity: 1; }
        to { opacity: 0; }
      }
    `;
    document.head.appendChild(styles);
  }

  document.body.appendChild(notification);

  // Remove after animation
  setTimeout(() => {
    notification.remove();
  }, 2500);
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

/**
 * Set up click listeners for reply/submit buttons
 */
function setupReplyTracking() {
  document.addEventListener('click', (event) => {
    const target = event.target;

    // Check if clicked element or its parents match submit button selectors
    for (const selector of SELECTORS.REPLY_SUBMIT_BUTTONS) {
      try {
        if (target.matches(selector) || target.closest(selector)) {
          debugLog('Reply submit button clicked!');
          // Small delay to ensure the action completes
          setTimeout(() => trackMetric('reply'), 500);
          return;
        }
      } catch (e) {
        // Invalid selector, skip
      }
    }

    // Fallback: Check for button text content
    const buttonText = target.textContent?.trim().toLowerCase();
    if (target.tagName === 'BUTTON' &&
        (buttonText === 'submit' || buttonText === 'send' || buttonText === 'submit as')) {
      debugLog('Reply button clicked (text match)!');
      setTimeout(() => trackMetric('reply'), 500);
    }
  }, true);
}

/**
 * Set up click listeners for chat end buttons
 */
function setupChatTracking() {
  document.addEventListener('click', (event) => {
    const target = event.target;

    for (const selector of SELECTORS.CHAT_END_BUTTONS) {
      try {
        if (target.matches(selector) || target.closest(selector)) {
          debugLog('End chat button clicked!');
          setTimeout(() => trackMetric('chat'), 500);
          return;
        }
      } catch (e) {
        // Invalid selector, skip
      }
    }

    // Fallback: Check button text
    const buttonText = target.textContent?.trim().toLowerCase();
    if (target.tagName === 'BUTTON' &&
        (buttonText === 'end chat' || buttonText === 'end conversation')) {
      debugLog('End chat button clicked (text match)!');
      setTimeout(() => trackMetric('chat'), 500);
    }
  }, true);
}

/**
 * Set up click listeners for call tracking
 */
function setupCallTracking() {
  // Track when dial button is clicked (outbound)
  document.addEventListener('click', (event) => {
    const target = event.target;

    for (const selector of SELECTORS.CTI_OUTBOUND_INDICATORS) {
      try {
        if (target.matches(selector) || target.closest(selector)) {
          debugLog('Outbound call initiated!');
          state.lastCallDirection = 'outbound';
          state.isCallActive = true;
          return;
        }
      } catch (e) {
        // Invalid selector
      }
    }
  }, true);
}

// ============================================================================
// MUTATION OBSERVERS
// ============================================================================

/**
 * Set up MutationObserver to watch for DOM changes
 */
function setupMutationObservers() {
  // Find the main container to observe
  let targetNode = null;
  for (const selector of SELECTORS.MAIN_CONTENT_CONTAINERS) {
    targetNode = document.querySelector(selector);
    if (targetNode) break;
  }

  if (!targetNode) {
    targetNode = document.body;
  }

  debugLog('Setting up MutationObserver on:', targetNode);

  const config = {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'data-test-id', 'data-call-status', 'data-chat-status'],
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      // Check for chat ended indicators
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            checkForChatEnded(node);
            checkForCallStateChange(node);
            checkForIncomingCall(node);
          }
        });
      }

      // Check for attribute changes (call status, etc.)
      if (mutation.type === 'attributes') {
        checkForCallStateChange(mutation.target);
      }
    }
  });

  observer.observe(targetNode, config);
  state.observers.push(observer);
}

/**
 * Check if a node indicates chat has ended
 */
function checkForChatEnded(node) {
  // Check element selectors
  for (const selector of SELECTORS.CHAT_ENDED_INDICATORS) {
    try {
      if (node.matches && (node.matches(selector) || node.querySelector(selector))) {
        debugLog('Chat ended indicator found via selector!');
        trackMetric('chat');
        return;
      }
    } catch (e) {
      // Invalid selector
    }
  }

  // Check text content
  const textContent = node.textContent?.trim();
  for (const pattern of SELECTORS.CHAT_ENDED_TEXT_PATTERNS) {
    if (textContent && textContent.includes(pattern)) {
      debugLog(`Chat ended indicator found via text: "${pattern}"`);
      trackMetric('chat');
      return;
    }
  }
}

/**
 * Check for incoming call indicators
 */
function checkForIncomingCall(node) {
  for (const selector of SELECTORS.CTI_INBOUND_INDICATORS) {
    try {
      if (node.matches && (node.matches(selector) || node.querySelector(selector))) {
        debugLog('Incoming call detected!');
        state.lastCallDirection = 'inbound';
        state.isCallActive = true;
        return;
      }
    } catch (e) {
      // Invalid selector
    }
  }
}

/**
 * Check for call state changes (call ended)
 */
function checkForCallStateChange(node) {
  // Check if call became active
  for (const selector of SELECTORS.CTI_ACTIVE_CALL_INDICATORS) {
    try {
      if (node.matches && (node.matches(selector) || node.querySelector(selector))) {
        debugLog('Call is now active');
        state.isCallActive = true;
        return;
      }
    } catch (e) {
      // Invalid selector
    }
  }

  // Check if call ended
  for (const selector of SELECTORS.CTI_CALL_ENDED_INDICATORS) {
    try {
      if (node.matches && (node.matches(selector) || node.querySelector(selector))) {
        if (state.isCallActive) {
          debugLog(`Call ended! Direction was: ${state.lastCallDirection}`);

          if (state.lastCallDirection === 'inbound') {
            trackMetric('inbound');
          } else if (state.lastCallDirection === 'outbound') {
            trackMetric('outbound');
          } else {
            // Default to inbound if direction unknown
            debugLog('Call direction unknown, defaulting to inbound');
            trackMetric('inbound');
          }

          state.isCallActive = false;
          state.lastCallDirection = null;
        }
        return;
      }
    } catch (e) {
      // Invalid selector
    }
  }
}

// ============================================================================
// PERIODIC CHECK (FALLBACK)
// ============================================================================

/**
 * Periodically check for state changes that mutations might miss
 */
function setupPeriodicCheck() {
  setInterval(() => {
    // Check for chat ended text patterns
    if (checkForTextPatterns(SELECTORS.CHAT_ENDED_TEXT_PATTERNS)) {
      // This is handled by MutationObserver normally
    }

    // Check for call ended indicators
    const callEndedElement = findElement(SELECTORS.CTI_CALL_ENDED_INDICATORS);
    if (callEndedElement && state.isCallActive) {
      debugLog('Call ended detected via periodic check');
      if (state.lastCallDirection === 'inbound') {
        trackMetric('inbound');
      } else {
        trackMetric('outbound');
      }
      state.isCallActive = false;
      state.lastCallDirection = null;
    }

    // Check for active calls
    const activeCallElement = findElement(SELECTORS.CTI_ACTIVE_CALL_INDICATORS);
    if (activeCallElement && !state.isCallActive) {
      debugLog('Active call detected via periodic check');
      state.isCallActive = true;

      // Try to determine direction
      if (findElement(SELECTORS.CTI_INBOUND_INDICATORS)) {
        state.lastCallDirection = 'inbound';
      } else if (findElement(SELECTORS.CTI_OUTBOUND_INDICATORS)) {
        state.lastCallDirection = 'outbound';
      }
    }
  }, 1000);
}

// ============================================================================
// MESSAGE LISTENER
// ============================================================================

/**
 * Listen for messages from popup or background
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ status: 'active', url: window.location.href });
    return true;
  }

  if (message.type === 'GET_DEBUG_INFO') {
    sendResponse({
      selectors: SELECTORS,
      state: {
        isCallActive: state.isCallActive,
        lastCallDirection: state.lastCallDirection,
        observerCount: state.observers.length,
      },
    });
    return true;
  }
});

// ============================================================================
// INITIALIZATION
// ============================================================================

function init() {
  debugLog('Initializing Zendesk KPI Tracker...');
  debugLog('Current URL:', window.location.href);

  // Set up event listeners
  setupReplyTracking();
  setupChatTracking();
  setupCallTracking();

  // Set up MutationObservers
  setupMutationObservers();

  // Set up periodic fallback check
  setupPeriodicCheck();

  debugLog('Zendesk KPI Tracker initialized successfully!');
  debugLog('Selectors loaded:', Object.keys(SELECTORS).length);
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
