/**
 * Storage Utilities for Multi-Company Support
 *
 * Handles data migration and provides helpers for company-scoped data access.
 * Requires metrics.js to be loaded first.
 */

// Company colors for visual differentiation
const COMPANY_COLORS = [
  '#5046e5', // Purple
  '#059669', // Green
  '#d97706', // Orange
  '#7b1fa2', // Violet
  '#0891b2', // Cyan
  '#dc2626', // Red
  '#2563eb', // Blue
  '#ca8a04', // Yellow
];

let colorIndex = 0;

/**
 * Get the next company color
 */
function getNextCompanyColor() {
  const color = COMPANY_COLORS[colorIndex % COMPANY_COLORS.length];
  colorIndex++;
  return color;
}

/**
 * Generate a unique company ID
 */
function generateCompanyId() {
  return `company_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Create an empty company data structure
 */
function createEmptyCompany(name, color) {
  const today = Metrics.getTodayDateString();

  return {
    name: name || 'New Company',
    color: color || getNextCompanyColor(),
    zendeskSubdomain: null,
    metrics: Metrics.createEmptyMetrics(),
    history: [],
    goals: { ...Metrics.DEFAULT_GOALS },
    chatTickets: { date: today, ticketIds: [] },
    ticketTimeCache: { date: today, tickets: {} },
    ticketHistory: []
  };
}

/**
 * Migrate legacy data to multi-company structure
 */
async function migrateToMultiCompany() {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, (result) => {
      // Check if already migrated
      if (result.companies && result.activeCompanyId) {
        console.log('[Storage Utils] Data already migrated to multi-company structure');
        resolve({ migrated: false, reason: 'already_migrated' });
        return;
      }

      console.log('[Storage Utils] Migrating to multi-company structure...');

      // Create default company from existing data
      const defaultCompanyId = generateCompanyId();
      const defaultCompany = {
        ...createEmptyCompany('Default Company', COMPANY_COLORS[0]),
        metrics: Metrics.normalizeMetrics(result.metrics),
        history: Metrics.normalizeHistory(result.history),
        goals: Metrics.normalizeGoals(result.goals),
        ticketTimeCache: result.ticketTimeCache || { date: Metrics.getTodayDateString(), tickets: {} },
        ticketHistory: result.ticketHistory || []
      };

      const newData = {
        companies: {
          [defaultCompanyId]: defaultCompany
        },
        activeCompanyId: defaultCompanyId,
        reminderSettings: result.reminderSettings || { enabled: true, intervals: [5, 10, 15] },
        trackingEnabled: result.trackingEnabled !== false
      };

      // Remove old top-level keys
      chrome.storage.local.remove(['metrics', 'history', 'goals', 'ticketTimeCache', 'ticketHistory'], () => {
        // Save new structure
        chrome.storage.local.set(newData, () => {
          console.log('[Storage Utils] Migration completed successfully');
          resolve({ migrated: true, defaultCompanyId });
        });
      });
    });
  });
}

/**
 * Rewrite every company's stored metrics, history and goals in the current
 * schema, folding the old inbound/outbound counters into `call` and dropping
 * the per-channel reply counters. Safe to run on every load: once the stored
 * data already matches the schema, nothing is written.
 */
async function migrateMetricsSchema() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['companies'], (result) => {
      const companies = result.companies || {};
      let changed = false;

      for (const [id, company] of Object.entries(companies)) {
        const migrated = {
          ...company,
          metrics: Metrics.normalizeMetrics(company.metrics),
          history: Metrics.normalizeHistory(company.history),
          goals: Metrics.normalizeGoals(company.goals),
        };

        if (JSON.stringify(migrated) !== JSON.stringify(company)) {
          companies[id] = migrated;
          changed = true;
        }
      }

      if (!changed) {
        resolve(false);
        return;
      }

      chrome.storage.local.set({ companies }, () => {
        console.log('[Storage Utils] Migrated stored metrics to the current schema');
        resolve(true);
      });
    });
  });
}

/**
 * Get all companies
 */
async function getAllCompanies() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['companies'], (result) => {
      resolve(result.companies || {});
    });
  });
}

/**
 * Get active company ID
 */
async function getActiveCompanyId() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['activeCompanyId'], (result) => {
      resolve(result.activeCompanyId || null);
    });
  });
}

/**
 * Get active company data
 */
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

/**
 * Set active company
 */
async function setActiveCompany(companyId) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['companies'], (result) => {
      const companies = result.companies || {};

      if (companies[companyId]) {
        chrome.storage.local.set({ activeCompanyId: companyId }, () => {
          console.log('[Storage Utils] Active company set to:', companyId);
          resolve(true);
        });
      } else {
        console.error('[Storage Utils] Company not found:', companyId);
        resolve(false);
      }
    });
  });
}

/**
 * Create a new company
 */
async function createCompany(name, color) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['companies'], (result) => {
      const companies = result.companies || {};
      const newId = generateCompanyId();
      const newCompany = createEmptyCompany(name, color);

      companies[newId] = newCompany;

      chrome.storage.local.set({ companies }, () => {
        console.log('[Storage Utils] Created new company:', name, newId);
        resolve({ id: newId, data: newCompany });
      });
    });
  });
}

/**
 * Update company data
 */
async function updateCompany(companyId, updates) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['companies'], (result) => {
      const companies = result.companies || {};

      if (companies[companyId]) {
        companies[companyId] = { ...companies[companyId], ...updates };

        chrome.storage.local.set({ companies }, () => {
          console.log('[Storage Utils] Updated company:', companyId);
          resolve(true);
        });
      } else {
        console.error('[Storage Utils] Company not found:', companyId);
        resolve(false);
      }
    });
  });
}

/**
 * Delete a company
 */
async function deleteCompany(companyId) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['companies', 'activeCompanyId'], (result) => {
      const companies = result.companies || {};
      const activeId = result.activeCompanyId;

      if (!companies[companyId]) {
        console.error('[Storage Utils] Company not found:', companyId);
        resolve(false);
        return;
      }

      // Don't allow deleting the only company
      const companyIds = Object.keys(companies);
      if (companyIds.length === 1) {
        console.error('[Storage Utils] Cannot delete the only company');
        resolve(false);
        return;
      }

      delete companies[companyId];

      const updates = { companies };

      // If deleting active company, switch to another one
      if (activeId === companyId) {
        const newActiveId = Object.keys(companies)[0];
        updates.activeCompanyId = newActiveId;
        console.log('[Storage Utils] Switching active company to:', newActiveId);
      }

      chrome.storage.local.set(updates, () => {
        console.log('[Storage Utils] Deleted company:', companyId);
        resolve(true);
      });
    });
  });
}

/**
 * Save metrics for active company
 */
async function saveActiveMetrics(metrics) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['companies', 'activeCompanyId'], (result) => {
      const companies = result.companies || {};
      const activeId = result.activeCompanyId;

      if (activeId && companies[activeId]) {
        companies[activeId].metrics = { ...metrics, lastUpdated: Date.now() };
        chrome.storage.local.set({ companies }, () => resolve(true));
      } else {
        resolve(false);
      }
    });
  });
}

/**
 * Save goals for active company
 */
async function saveActiveGoals(goals) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['companies', 'activeCompanyId'], (result) => {
      const companies = result.companies || {};
      const activeId = result.activeCompanyId;

      if (activeId && companies[activeId]) {
        companies[activeId].goals = goals;
        chrome.storage.local.set({ companies }, () => resolve(true));
      } else {
        resolve(false);
      }
    });
  });
}

// Make functions available globally
if (typeof window !== 'undefined') {
  window.StorageUtils = {
    migrateToMultiCompany,
    getAllCompanies,
    getActiveCompanyId,
    getActiveCompany,
    setActiveCompany,
    createCompany,
    updateCompany,
    deleteCompany,
    migrateMetricsSchema,
    saveActiveMetrics,
    saveActiveGoals,
    createEmptyCompany,
    generateCompanyId,
    getNextCompanyColor
  };
}
