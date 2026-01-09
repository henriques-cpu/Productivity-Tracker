/**
 * Zendesk KPI Tracker - Injected Script (runs in page context)
 *
 * This script runs in the page's main world (not the isolated content script world)
 * so it can intercept fetch calls and WebSocket connections made by Zendesk's code.
 */

(function() {
  console.log('[ZKT Injected] Starting fetch/XHR and WebSocket interception in page context');

  // ============================================================================
  // INTERCEPT FETCH
  // ============================================================================

  const originalFetch = window.fetch;

  window.fetch = function(...args) {
    const [resource, config] = args;
    const url = typeof resource === 'string' ? resource : resource.url;
    const method = config?.method || 'GET';

    console.log('[ZKT Injected] Fetch intercepted:', url, method);

    // Send message to content script about GraphQL requests
    if (method === 'POST' && url.includes('/api/graphql')) {
      const body = config?.body;
      try {
        const data = JSON.parse(body);
        window.postMessage({
          type: 'ZKT_GRAPHQL_REQUEST',
          data: {
            url,
            method,
            operationName: data.operationName,
            variables: data.variables
          }
        }, '*');
      } catch (e) {
        // Ignore parse errors
        console.log('[ZKT Injected] Error parsing GraphQL body:', e);
      }
    }

    return originalFetch.apply(this, args);
  };

  console.log('[ZKT Injected] Fetch interception installed');

  // ============================================================================
  // INTERCEPT WEBSOCKET
  // ============================================================================

  const OriginalWebSocket = window.WebSocket;

  window.WebSocket = function(url, protocols) {
    console.log('[ZKT Injected] WebSocket connection:', url);

    const ws = new OriginalWebSocket(url, protocols);

    // Intercept sent messages
    const originalSend = ws.send;
    ws.send = function(data) {
      console.log('[ZKT Injected] WebSocket message sent:', data);

      // Try to parse as JSON and look for GraphQL operations
      try {
        const parsed = JSON.parse(data);
        console.log('[ZKT Injected] WebSocket message parsed:', parsed);

        // Forward ALL parsed messages to content script for inspection
        window.postMessage({
          type: 'ZKT_WEBSOCKET_MESSAGE',
          data: {
            operationName: parsed.operationName,
            variables: parsed.variables,
            query: parsed.query,
            mutation: parsed.mutation,
            payload: parsed
          }
        }, '*');
      } catch (e) {
        // Not JSON or parsing error
        console.log('[ZKT Injected] WebSocket message not JSON:', e);
      }

      return originalSend.apply(this, arguments);
    };

    return ws;
  };

  // Copy static properties
  window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
  window.WebSocket.OPEN = OriginalWebSocket.OPEN;
  window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
  window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;

  console.log('[ZKT Injected] WebSocket interception installed');
  console.log('[ZKT Injected] All interception successfully installed');
})();
