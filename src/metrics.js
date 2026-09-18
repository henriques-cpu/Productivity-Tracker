/**
 * Zendesk KPI Tracker - Shared Metric Schema
 *
 * Every context (content script, popup, dashboard, service worker) loads this
 * file so the list of tracked metrics and the shape of a stored record are
 * defined in exactly one place.
 */

(function (global) {
  'use strict';

  /**
   * The metrics the tracker records. Order drives the UI: scorecards, chart
   * series, comparison table rows and CSV columns are all generated from it.
   */
  const METRICS = [
    {
      key: 'reply',
      label: 'Replies Sent',
      short: 'Reply',
      plural: 'Replies',
      color: '#5046e5',
      defaultGoal: 20,
    },
    {
      key: 'chat',
      label: 'Chats Handled',
      short: 'Chat',
      plural: 'Chats',
      color: '#059669',
      defaultGoal: 15,
    },
    {
      key: 'call',
      label: 'Calls',
      short: 'Call',
      plural: 'Calls',
      color: '#d97706',
      defaultGoal: 10,
    },
  ];

  const METRIC_KEYS = METRICS.map((metric) => metric.key);

  const DEFAULT_GOALS = METRICS.reduce((goals, metric) => {
    goals[metric.key] = metric.defaultGoal;
    return goals;
  }, {});

  /**
   * Zendesk `via.channel` values that mean "this conversation is a chat".
   *
   * `native_messaging` is Agent Workspace messaging (the modern web widget,
   * social and in-app conversations), `chat` is legacy Zendesk Chat, and
   * `messaging` shows up on some Sunshine Conversations payloads.
   */
  const CHAT_CHANNELS = ['chat', 'native_messaging', 'messaging'];

  function getTodayDateString() {
    return new Date().toISOString().split('T')[0];
  }

  function createEmptyMetrics() {
    const metrics = { date: getTodayDateString(), lastUpdated: Date.now() };
    METRIC_KEYS.forEach((key) => {
      metrics[key] = 0;
    });
    return metrics;
  }

  function toCount(value) {
    const count = Number(value);
    return Number.isFinite(count) ? count : 0;
  }

  /**
   * Bring a stored metrics or history record up to the current schema.
   *
   * Legacy records split calls into `inbound`/`outbound` and replies into
   * `replyEmail`/`replySMS`/`replyChat`. Inbound and outbound are folded into
   * `call`; the per-channel reply counters are dropped because they were never
   * populated reliably and their total already lives in `reply`.
   */
  function normalizeMetrics(record) {
    const source = record || {};
    const normalized = { date: source.date || getTodayDateString() };

    METRIC_KEYS.forEach((key) => {
      normalized[key] = toCount(source[key]);
    });

    normalized.call += toCount(source.inbound) + toCount(source.outbound);

    if (source.lastUpdated) {
      normalized.lastUpdated = source.lastUpdated;
    }

    return normalized;
  }

  function normalizeHistory(history) {
    return (Array.isArray(history) ? history : []).map(normalizeMetrics);
  }

  /**
   * Bring stored goals up to the current schema. A legacy pair of inbound and
   * outbound goals becomes a single combined call goal.
   */
  function normalizeGoals(goals) {
    const source = goals || {};
    const normalized = {};

    METRIC_KEYS.forEach((key) => {
      const goal = Number(source[key]);
      normalized[key] = Number.isFinite(goal) ? goal : DEFAULT_GOALS[key];
    });

    if (source.call === undefined && (source.inbound !== undefined || source.outbound !== undefined)) {
      normalized.call = toCount(source.inbound) + toCount(source.outbound);
    }

    return normalized;
  }

  function metricsTotal(record) {
    return METRIC_KEYS.reduce((total, key) => total + toCount(record && record[key]), 0);
  }

  /**
   * True when a Zendesk channel identifies a chat/messaging conversation.
   */
  function isChatChannel(channel) {
    return typeof channel === 'string' && CHAT_CHANNELS.includes(channel.toLowerCase());
  }

  global.Metrics = {
    METRICS,
    METRIC_KEYS,
    DEFAULT_GOALS,
    CHAT_CHANNELS,
    getTodayDateString,
    createEmptyMetrics,
    normalizeMetrics,
    normalizeHistory,
    normalizeGoals,
    metricsTotal,
    isChatChannel,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
