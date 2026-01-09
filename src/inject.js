/**
 * Zendesk KPI Tracker - Injected Script (runs in page context)
 *
 * This script runs in the page's main world (not the isolated content script world)
 * so it can intercept fetch calls made by Zendesk's code.
 */

(function() {
  console.log('[ZKT Injected] Starting fetch/XHR interception in page context');

  // Intercept fetch
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

  console.log('[ZKT Injected] Fetch interception installed successfully');
})();
