/**
 * Zendesk KPI Tracker - Injected Script (runs in page context)
 *
 * This script runs in the page's main world (not the isolated content script world)
 * so it can intercept the fetch and XHR calls made by Zendesk's own code and
 * forward the ticket API responses to content.js for analysis.
 */

(function() {
  console.log('[ZKT Injected] Starting fetch/XHR interception in page context');

  // ============================================================================
  // INTERCEPT FETCH
  // ============================================================================

  const originalFetch = window.fetch;

  window.fetch = function(...args) {
    const [resource, config] = args;
    const url = typeof resource === 'string' ? resource : resource.url;
    const method = config?.method || 'GET';

    // Call original fetch
    const promise = originalFetch.apply(this, args);

    // Intercept response for ticket/comment operations
    // PUT is used by Zendesk to update tickets (including adding comments/replies)
    if ((method === 'POST' || method === 'PUT') && (
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

    // Listen for response
    // PUT is used by Zendesk to update tickets (including adding comments/replies)
    if ((method === 'POST' || method === 'PUT') && (
      url.includes('/api/v2/tickets') ||
      url.includes('/api/lotus/tickets') ||
      url.includes('/api/v2/any_channel/tickets') ||
      url.includes('/api/v2/channels/voice/tickets')
    )) {
      this.addEventListener('load', function() {
        if (this.status >= 200 && this.status < 300) {
          try {
            const responseData = JSON.parse(this.responseText);

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
})();
