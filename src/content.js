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
  recentReplyEventIds: new Map(),
  lastReplyTrackedAt: 0,
  // Ticket time tracking
  currentTicketId: null,
  ticketStartTime: null,
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

// ============================================================================
// COMPANY-SCOPED STORAGE HELPERS
// ============================================================================

function getCurrentZendeskSubdomain() {
  const host = window.location.hostname || '';
  const match = host.match(/^([^.]+)\.zendesk\.com$/i);
  return match ? match[1].toLowerCase() : null;
}

async function getTrackingCompany() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['companies', 'activeCompanyId'], (result) => {
      const companies = result.companies || {};
      const activeId = result.activeCompanyId;

      // Prefer mapped company based on current Zendesk subdomain
      const currentSubdomain = getCurrentZendeskSubdomain();
      if (currentSubdomain) {
        const mappedEntry = Object.entries(companies).find(([, company]) =>
          (company?.zendeskSubdomain || '').toLowerCase() === currentSubdomain
        );

        if (mappedEntry) {
          const [id, data] = mappedEntry;
          resolve({ id, data });
          return;
        }
      }

      if (activeId && companies[activeId]) {
        resolve({ id: activeId, data: companies[activeId] });
      } else {
        resolve(null);
      }
    });
  });
}

async function updateCompanyDataById(companyId, updates) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['companies'], (result) => {
      const companies = result.companies || {};

      if (companyId && companies[companyId]) {
        companies[companyId] = { ...companies[companyId], ...updates };
        chrome.storage.local.set({ companies }, () => resolve(true));
      } else {
        resolve(false);
      }
    });
  });
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

function isDuplicateReplyEvent(eventId) {
  if (!eventId) return false;

  const now = Date.now();
  const ttlMs = 5 * 60 * 1000; // 5 minutes

  for (const [id, ts] of state.recentReplyEventIds.entries()) {
    if (now - ts > ttlMs) {
      state.recentReplyEventIds.delete(id);
    }
  }

  if (state.recentReplyEventIds.has(eventId)) {
    log(`Duplicate reply event ignored: ${eventId}`);
    return true;
  }

  state.recentReplyEventIds.set(eventId, now);
  return false;
}

function trackReplyWithDedup(channel, eventId) {
  if (eventId && isDuplicateReplyEvent(eventId)) {
    return;
  }

  // Universal time-based dedup: only one reply tracked per 5-second window.
  const msSinceLastReply = Date.now() - (state.lastReplyTrackedAt || 0);
  if (msSinceLastReply < 5000) {
    log(`Suppressed duplicate reply tracking ${msSinceLastReply}ms after last tracked reply`);
    return;
  }

  state.lastReplyTrackedAt = Date.now();
  trackMetric('reply', channel);
}

// NOTE: Fetch and XHR interception is handled in inject.js (runs in page context).
// Content scripts run in an isolated world and cannot intercept page-level fetch/XHR calls.
// inject.js intercepts responses and forwards them via postMessage for analysis here.

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

  // Detect specific channel type from data-channel attribute (primary) or aria-label (fallback)
  const ariaLabelLower = ariaLabel.toLowerCase();
  let channel = null;

  // Priority 1: Use data-channel attribute (more reliable after Zendesk UI updates)
  if (dataChannel) {
    const dataChannelLower = dataChannel.toLowerCase();
    if (dataChannelLower === 'sms') {
      channel = 'sms';
    } else if (dataChannelLower === 'web' || dataChannelLower === 'email') {
      channel = 'email';
    } else if (dataChannelLower === 'native_messaging' || dataChannelLower === 'chat') {
      channel = 'chat';
    }
  }

  // Priority 2: Fallback to aria-label if data-channel didn't match
  if (!channel) {
    if (ariaLabelLower.includes('email')) {
      channel = 'email';
    } else if (ariaLabelLower.includes('sms')) {
      channel = 'sms';
    } else if (ariaLabelLower.includes('chat') || ariaLabelLower.includes('messaging')) {
      channel = 'chat';
    }
  }

  // Check if it's a known internal note mode (already handled above)
  // Otherwise, check if it matches any public reply indicator
  const isPublic = SELECTORS.PUBLIC_REPLY_INDICATORS.some(
    indicator => ariaLabelLower.includes(indicator.toLowerCase())
  );

  if (isPublic) {
    log(`Public reply mode detected - Channel: ${channel || 'untracked'}`);
    return { isPublic: true, channel };
  }

  // If channel switcher exists but aria-label doesn't match known indicators,
  // treat as public if it's not explicitly internal (already checked above).
  // This handles localized/translated Zendesk UIs and UI version differences.
  log(`Channel switcher label not recognized ("${ariaLabel}"), assuming public reply`);
  return { isPublic: true, channel };
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
    // Get active company
    const company = await getTrackingCompany();

    if (!company) {
      log('No active company found, skipping tracking');
      return;
    }

    let metrics = company.data.metrics || createEmptyMetrics();

    // Check for new day
    if (metrics.date !== getTodayDateString()) {
      // Archive old metrics
      const history = company.data.history || [];

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
        await updateCompanyDataById(company.id, { history: history.slice(-90) });
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
      await updateCompanyDataById(company.id, { metrics });

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
    injectStyles();
  }

  // Remove existing notification
  document.getElementById('zkt-notification')?.remove();

  // Add new notification
  document.body.appendChild(notification);

  // Remove after 2.5 seconds
  setTimeout(() => notification.remove(), 2500);
}

// ============================================================================
// STYLES
// ============================================================================

function injectStyles() {
  if (document.getElementById('zkt-styles')) return;
  const styles = document.createElement('style');
  styles.id = 'zkt-styles';
  styles.textContent = `
    @keyframes zkt-slide-in {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes zkt-popup-in {
      from { transform: translateY(-20px) scale(0.95); opacity: 0; }
      to { transform: translateY(0) scale(1); opacity: 1; }
    }
    #zkt-time-popup {
      position: fixed;
      top: 80px;
      right: 20px;
      z-index: 999998;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      animation: zkt-popup-in 0.3s ease-out;
      user-select: none;
    }
    #zkt-time-popup .zkt-popup-card {
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #e0e0e0;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.08);
      overflow: hidden;
      min-width: 240px;
      max-width: 320px;
      cursor: move;
    }
    #zkt-time-popup .zkt-popup-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: rgba(255,255,255,0.05);
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    #zkt-time-popup .zkt-popup-header-left {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #9c27b0;
    }
    #zkt-time-popup .zkt-pulse-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #4caf50;
      animation: zkt-pulse 1.5s ease-in-out infinite;
    }
    @keyframes zkt-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    #zkt-time-popup .zkt-popup-close {
      background: none;
      border: none;
      color: #888;
      cursor: pointer;
      font-size: 14px;
      padding: 2px 4px;
      border-radius: 4px;
      line-height: 1;
    }
    #zkt-time-popup .zkt-popup-close:hover {
      color: #fff;
      background: rgba(255,255,255,0.1);
    }
    #zkt-time-popup .zkt-popup-body {
      padding: 12px;
    }
    #zkt-time-popup .zkt-ticket-id {
      font-size: 12px;
      color: #9c27b0;
      font-weight: 600;
      margin-bottom: 2px;
    }
    #zkt-time-popup .zkt-ticket-subject {
      font-size: 12px;
      color: #aaa;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 10px;
    }
    #zkt-time-popup .zkt-timer-display {
      font-size: 32px;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: #fff;
      text-align: center;
      letter-spacing: 1px;
    }
    #zkt-time-popup .zkt-timer-label {
      font-size: 10px;
      color: #888;
      text-align: center;
      margin-top: 2px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    #zkt-time-popup.zkt-minimized .zkt-popup-card {
      min-width: auto;
    }
    #zkt-time-popup.zkt-minimized .zkt-popup-body {
      display: none;
    }
    #zkt-time-popup.zkt-minimized .zkt-popup-header {
      border-bottom: none;
    }
    #zkt-time-popup .zkt-popup-minimize {
      background: none;
      border: none;
      color: #888;
      cursor: pointer;
      font-size: 14px;
      padding: 2px 4px;
      border-radius: 4px;
      line-height: 1;
    }
    #zkt-time-popup .zkt-popup-minimize:hover {
      color: #fff;
      background: rgba(255,255,255,0.1);
    }
    #zkt-time-popup .zkt-mini-timer {
      display: none;
      font-size: 12px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: #fff;
      margin-left: 6px;
    }
    #zkt-time-popup.zkt-minimized .zkt-mini-timer {
      display: inline;
    }
  `;
  document.head.appendChild(styles);
}

// ============================================================================
// FLOATING TIME TRACKING POPUP
// ============================================================================

let timePopupInterval = null;
let timePopupDragState = null;

function formatElapsedTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n) => n.toString().padStart(2, '0');

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

function showTimePopup(ticketId, subject, startTime, accumulatedTime) {
  injectStyles();

  // Remove existing popup
  hideTimePopup();

  const popup = document.createElement('div');
  popup.id = 'zkt-time-popup';
  popup.innerHTML = `
    <div class="zkt-popup-card">
      <div class="zkt-popup-header">
        <div class="zkt-popup-header-left">
          <div class="zkt-pulse-dot"></div>
          <span>Tracking</span>
          <span class="zkt-mini-timer" id="zkt-mini-timer">00:00</span>
        </div>
        <div style="display:flex;gap:2px;">
          <button class="zkt-popup-minimize" id="zkt-popup-minimize" title="Minimize">−</button>
          <button class="zkt-popup-close" id="zkt-popup-close" title="Hide popup">×</button>
        </div>
      </div>
      <div class="zkt-popup-body">
        <div class="zkt-ticket-id">#${ticketId}</div>
        <div class="zkt-ticket-subject" title="${subject}">${subject}</div>
        <div class="zkt-timer-display" id="zkt-timer-display">00:00</div>
        <div class="zkt-timer-label">time on ticket</div>
      </div>
    </div>
  `;

  document.body.appendChild(popup);

  // Close button
  document.getElementById('zkt-popup-close').addEventListener('click', (e) => {
    e.stopPropagation();
    popup.style.animation = 'none';
    popup.style.opacity = '0';
    popup.style.transform = 'translateY(-20px)';
    popup.style.transition = 'opacity 0.2s, transform 0.2s';
    setTimeout(() => popup.remove(), 200);
  });

  // Minimize button
  document.getElementById('zkt-popup-minimize').addEventListener('click', (e) => {
    e.stopPropagation();
    const isMinimized = popup.classList.toggle('zkt-minimized');
    e.target.textContent = isMinimized ? '+' : '−';
    e.target.title = isMinimized ? 'Expand' : 'Minimize';
  });

  // Dragging
  const card = popup.querySelector('.zkt-popup-card');
  const header = popup.querySelector('.zkt-popup-header');

  header.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON') return;
    e.preventDefault();
    const rect = popup.getBoundingClientRect();
    timePopupDragState = {
      startX: e.clientX,
      startY: e.clientY,
      startLeft: rect.left,
      startTop: rect.top,
    };
    popup.style.transition = 'none';
  });

  document.addEventListener('mousemove', handlePopupDrag);
  document.addEventListener('mouseup', handlePopupDragEnd);

  // Update timer immediately and every second
  updateTimePopup(startTime, accumulatedTime);
  timePopupInterval = setInterval(() => {
    updateTimePopup(startTime, accumulatedTime);
  }, 1000);
}

function handlePopupDrag(e) {
  if (!timePopupDragState) return;
  const popup = document.getElementById('zkt-time-popup');
  if (!popup) return;

  const dx = e.clientX - timePopupDragState.startX;
  const dy = e.clientY - timePopupDragState.startY;

  popup.style.right = 'auto';
  popup.style.bottom = 'auto';
  popup.style.left = (timePopupDragState.startLeft + dx) + 'px';
  popup.style.top = (timePopupDragState.startTop + dy) + 'px';
}

function handlePopupDragEnd() {
  timePopupDragState = null;
}

function updateTimePopup(startTime, accumulatedTime) {
  const timerEl = document.getElementById('zkt-timer-display');
  const miniTimerEl = document.getElementById('zkt-mini-timer');
  if (!timerEl) return;

  const sessionTime = Date.now() - startTime;
  const totalTime = accumulatedTime + sessionTime;
  const formatted = formatElapsedTime(totalTime);

  timerEl.textContent = formatted;
  if (miniTimerEl) miniTimerEl.textContent = formatted;
}

function hideTimePopup() {
  if (timePopupInterval) {
    clearInterval(timePopupInterval);
    timePopupInterval = null;
  }
  document.getElementById('zkt-time-popup')?.remove();
  document.removeEventListener('mousemove', handlePopupDrag);
  document.removeEventListener('mouseup', handlePopupDragEnd);
  timePopupDragState = null;
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

function extractReplyEventId(url, response) {
  if (response?.comment?.id) return `rest-comment-${response.comment.id}`;
  if (response?.ticket?.latest_comment?.id) return `rest-comment-${response.ticket.latest_comment.id}`;

  const convoEventId = response?.data?.ticket?.conversationEvents?.edges?.[0]?.node?.id;
  if (convoEventId) return `gql-event-${convoEventId}`;

  return null;
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
  return isPublicReplyMode().isPublic;
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
  return isPublicReplyMode().isPublic;
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
      const eventId = extractReplyEventId(url, response);
      // API response already confirmed this is a public reply - trust it.
      // Only use the UI to detect the channel type (email, sms, chat).
      const replyMode = isPublicReplyMode();
      const channel = replyMode.channel || null;
      log('✓ Public reply confirmed via API response - tracking');
      log('Channel detection result:', { channel, uiPublic: replyMode.isPublic });
      trackReplyWithDedup(channel, eventId);
    }
  }

});

// ============================================================================
// TICKET TIME TRACKING
// ============================================================================

/**
 * Extract ticket ID from URL
 * Zendesk URLs typically look like: /agent/tickets/12345
 */
function extractTicketIdFromUrl(url) {
  const match = url.match(/\/tickets\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Get current ticket ID from the page
 */
function getCurrentTicketId() {
  // First try URL
  const urlTicketId = extractTicketIdFromUrl(window.location.href);
  if (urlTicketId) return urlTicketId;

  // Fallback: try to find ticket ID in DOM
  const ticketIdElement = document.querySelector('[data-test-id="ticket-pane-header-id"]');
  if (ticketIdElement) {
    const text = ticketIdElement.textContent.replace('#', '').trim();
    if (/^\d+$/.test(text)) return text;
  }

  return null;
}

/**
 * Get ticket subject/title from the page
 */
function getTicketSubject() {
  // Try various selectors for ticket subject
  const selectors = [
    '[data-test-id="ticket-pane-subject"]',
    '[data-test-id="omni-header-subject"]',
    '.ticket-subject',
    'h1[data-garden-id="typography.h1"]',
  ];

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && el.textContent) {
      return el.textContent.trim().substring(0, 100);
    }
  }

  return 'Unknown Ticket';
}

/**
 * Get or initialize the daily ticket time cache
 * Cache structure: { date: "YYYY-MM-DD", tickets: { "12345": accumulatedMs, ... } }
 */
async function getTicketTimeCache() {
  const today = getTodayDateString();
  const company = await getTrackingCompany();

  if (!company) {
    return { date: today, tickets: {} };
  }

  let cache = company.data.ticketTimeCache;

  // If no cache or cache is from a different day, create new one
  if (!cache || cache.date !== today) {
    cache = { date: today, tickets: {} };
    await updateCompanyDataById(company.id, { ticketTimeCache: cache });
    log('Created new daily ticket time cache');
  }

  return cache;
}

/**
 * Save accumulated time for a ticket to the daily cache
 */
async function saveTicketAccumulatedTime(ticketId, accumulatedMs) {
  const cache = await getTicketTimeCache();
  cache.tickets[ticketId] = accumulatedMs;

  const company = await getTrackingCompany();
  if (company) {
    await updateCompanyDataById(company.id, { ticketTimeCache: cache });
    log(`Saved accumulated time for ticket #${ticketId}: ${Math.round(accumulatedMs / 1000)}s`);
  }
}

/**
 * Get accumulated time for a ticket from the daily cache
 */
async function getTicketAccumulatedTime(ticketId) {
  const cache = await getTicketTimeCache();
  return cache.tickets[ticketId] || 0;
}

/**
 * Start tracking time on a ticket
 */
async function startTicketTimer(ticketId) {
  if (!ticketId || ticketId === state.currentTicketId) return;

  // Check if tracking is enabled
  const trackingState = await chrome.storage.local.get(['trackingEnabled']);
  const isTrackingEnabled = trackingState.trackingEnabled !== false; // Default to true

  if (!isTrackingEnabled) {
    log(`Tracking is disabled - skipping ticket timer for #${ticketId}`);
    return;
  }

  // End any existing ticket timer first
  if (state.currentTicketId) {
    await endTicketTimer();
  }

  state.currentTicketId = ticketId;
  state.ticketStartTime = Date.now();

  // Get previously accumulated time for this ticket today
  const accumulatedTime = await getTicketAccumulatedTime(ticketId);

  const subject = getTicketSubject();

  log(`Started tracking ticket #${ticketId}: ${subject} (previously accumulated: ${Math.round(accumulatedTime / 1000)}s)`);

  // Store active ticket in storage with accumulated time
  const activeTicket = {
    ticketId,
    subject,
    startTime: state.ticketStartTime,
    accumulatedTime, // Time already spent on this ticket today
  };

  await chrome.storage.local.set({ activeTicket });

  // Show floating time popup on the page
  showTimePopup(ticketId, subject, state.ticketStartTime, accumulatedTime);

  // Notify background script to start reminder alarms (accounting for accumulated time)
  chrome.runtime.sendMessage({
    type: 'TICKET_OPENED',
    data: activeTicket,
  });
}

/**
 * End tracking time on current ticket
 */
async function endTicketTimer() {
  if (!state.currentTicketId || !state.ticketStartTime) return;

  const endTime = Date.now();
  const sessionDuration = endTime - state.ticketStartTime;
  const ticketId = state.currentTicketId;

  // Get current accumulated time and add this session's duration
  const previousAccumulated = await getTicketAccumulatedTime(ticketId);
  const totalAccumulated = previousAccumulated + sessionDuration;

  // Save the new accumulated time to the daily cache
  await saveTicketAccumulatedTime(ticketId, totalAccumulated);

  log(`Ended tracking ticket #${ticketId}, session: ${Math.round(sessionDuration / 1000)}s, total today: ${Math.round(totalAccumulated / 1000)}s`);

  // Store completed ticket session in history
  const company = await getTrackingCompany();

  if (company) {
    const history = company.data.ticketHistory || [];

    history.push({
      ticketId,
      subject: getTicketSubject(),
      startTime: state.ticketStartTime,
      endTime,
      duration: sessionDuration,
      totalAccumulated,
      date: getTodayDateString(),
    });

    // Keep last 500 ticket sessions
    await updateCompanyDataById(company.id, {
      ticketHistory: history.slice(-500)
    });
  }

  // Hide floating time popup
  hideTimePopup();

  // Clear active ticket (global state)
  await chrome.storage.local.set({ activeTicket: null });

  // Notify background script to clear alarms
  chrome.runtime.sendMessage({
    type: 'TICKET_CLOSED',
    data: { ticketId, totalAccumulated },
  });

  state.currentTicketId = null;
  state.ticketStartTime = null;
}

/**
 * Check if current page is a ticket and update tracking
 */
function checkAndUpdateTicketTracking() {
  const ticketId = getCurrentTicketId();

  if (ticketId && ticketId !== state.currentTicketId) {
    // New ticket detected
    startTicketTimer(ticketId);
  } else if (!ticketId && state.currentTicketId) {
    // Left ticket page
    endTicketTimer();
  }
}

/**
 * Setup URL change detection for SPA navigation
 */
function setupUrlChangeDetection() {
  // Initial check
  checkAndUpdateTicketTracking();

  // Listen for URL changes (Zendesk is a SPA)
  let lastUrl = window.location.href;

  // Use MutationObserver on document to detect URL changes
  const urlObserver = new MutationObserver(() => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      log('URL changed:', lastUrl);
      checkAndUpdateTicketTracking();
    }
  });

  urlObserver.observe(document.body, { childList: true, subtree: true });

  // Also listen for popstate (back/forward navigation)
  window.addEventListener('popstate', () => {
    setTimeout(checkAndUpdateTicketTracking, 100);
  });

  // Listen for tracking state changes - stop ticket timer when tracking is disabled
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.trackingEnabled) {
      const isEnabled = changes.trackingEnabled.newValue !== false;
      if (!isEnabled && state.currentTicketId) {
        log('Tracking disabled - stopping ticket timer');
        hideTimePopup();
        endTicketTimer();
      } else if (isEnabled) {
        // Tracking re-enabled - check if we should start tracking current ticket
        log('Tracking re-enabled - checking for active ticket');
        checkAndUpdateTicketTracking();
      }
    }
  });

  // Periodic check as fallback (every 2 seconds)
  setInterval(checkAndUpdateTicketTracking, 2000);

  log('Ticket time tracking initialized');
}

// ============================================================================
// INITIALIZATION
// ============================================================================

async function init() {
  log('Initializing on:', window.location.href);

  // Add click listener (capture phase to catch all clicks)
  document.addEventListener('click', handleClick, true);

  // Setup mutation observer for DOM changes
  setupMutationObserver();

  // Setup ticket time tracking
  setupUrlChangeDetection();

  // Restore floating time popup if a ticket was already being tracked
  try {
    const { activeTicket } = await chrome.storage.local.get(['activeTicket']);
    if (activeTicket && activeTicket.ticketId) {
      const currentTicketId = getCurrentTicketId();
      if (currentTicketId === activeTicket.ticketId) {
        showTimePopup(
          activeTicket.ticketId,
          activeTicket.subject || 'Unknown Ticket',
          activeTicket.startTime,
          activeTicket.accumulatedTime || 0
        );
      }
    }
  } catch (e) {
    log('Could not restore time popup:', e);
  }

  log('Initialized successfully');
  log('Debug helpers available: Type ZKT.inspect() in console to identify elements');
}

// Wait for document to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
