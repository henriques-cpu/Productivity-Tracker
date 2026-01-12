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

    // Call original fetch
    const promise = originalFetch.apply(this, args);

    // Intercept response for ticket/comment operations
    if (method === 'POST' && (
      url.includes('/api/graphql') ||
      url.includes('/api/v2/tickets') ||
      url.includes('/api/lotus/tickets') ||
      url.includes('/api/v2/any_channel/tickets') ||
      url.includes('/api/v2/channels/voice/tickets')
    )) {
      promise.then(async (response) => {
        // Only process successful responses
        if (!response.ok) {
          console.log('[ZKT Injected] Request failed, not tracking:', response.status);
          return response;
        }

        // Clone response so we can read it without consuming the original
        const clonedResponse = response.clone();

        try {
          const responseData = await clonedResponse.json();
          console.log('[ZKT Injected] Response data:', responseData);

          // Send response to content script for analysis
          window.postMessage({
            type: 'ZKT_API_RESPONSE',
            data: {
              url,
              method,
              status: response.status,
              response: responseData,
              requestBody: config?.body
            }
          }, '*');
        } catch (e) {
          console.log('[ZKT Injected] Error parsing response:', e);
        }

        return response;
      }).catch(err => {
        console.log('[ZKT Injected] Fetch error:', err);
        throw err;
      });
    }

    return promise;
  };

  console.log('[ZKT Injected] Fetch interception installed');

  // ============================================================================
  // INTERCEPT XMLHttpRequest (for REST APIs)
  // ============================================================================

  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this._zkt_method = method;
    this._zkt_url = url;
    return originalXHROpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function(body) {
    const method = this._zkt_method;
    const url = this._zkt_url;

    // Store request body
    this._zkt_body = body;

    console.log('[ZKT Injected] XHR intercepted:', url, method);

    // Listen for response
    if (method === 'POST' && (
      url.includes('/api/v2/tickets') ||
      url.includes('/api/lotus/tickets') ||
      url.includes('/api/v2/any_channel/tickets') ||
      url.includes('/api/v2/channels/voice/tickets')
    )) {
      this.addEventListener('load', function() {
        if (this.status >= 200 && this.status < 300) {
          try {
            const responseData = JSON.parse(this.responseText);
            console.log('[ZKT Injected] XHR Response data:', responseData);

            // Send response to content script
            window.postMessage({
              type: 'ZKT_API_RESPONSE',
              data: {
                url,
                method,
                status: this.status,
                response: responseData,
                requestBody: this._zkt_body
              }
            }, '*');
          } catch (e) {
            console.log('[ZKT Injected] Error parsing XHR response:', e);
          }
        }
      });
    }

    return originalXHRSend.apply(this, arguments);
  };

  console.log('[ZKT Injected] XHR interception installed');

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
