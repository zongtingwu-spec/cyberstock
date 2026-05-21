// js/storage.js — localStorage 統一介面

const PREFIX = 'cyberstock_';

export const KEYS = {
  HOLDINGS: 'holdings',
  WATCHLIST: 'watchlist',
  MARGIN: 'margin',
  PLEDGE: 'pledge',
  SETTINGS: 'settings',
  LAST_QUOTE: 'lastquote',
};

export const DEFAULTS = {
  holdings: [],            // [{id, symbol, qty, price, date, feeRate, marginRatio}, ...]
  watchlist: [],           // [symbol, ...]
  margin: { balance: 0, rate: 6.5, warnRatio: 130 },
  pledge: { amount: 0, limit: 60 },
  settings: {
    refreshSec: 10,
    soundOn: true,
    aiIncludeCtx: true,
    aiSynthesize: true,
    megaTabPref: 'auto',     // 'auto' | 'tw' | 'us'
    claudeKey: '',
    claudeModel: 'claude-opus-4-7',
    openaiKey: '',
    openaiModel: 'gpt-4o',
    geminiKey: '',
    geminiModel: 'gemini-2.0-flash',
  },
  lastquote: {},           // {symbol: {price, prev, time, name}}
};

export function load(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw == null) return structuredClone(DEFAULTS[key] ?? null);
    const parsed = JSON.parse(raw);
    // shallow-merge with defaults for object types so new fields show up
    const def = DEFAULTS[key];
    if (def && typeof def === 'object' && !Array.isArray(def)) {
      return { ...structuredClone(def), ...parsed };
    }
    return parsed;
  } catch (e) {
    console.warn('[storage] load failed for', key, e);
    return structuredClone(DEFAULTS[key] ?? null);
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch (e) {
    console.error('[storage] save failed for', key, e);
  }
}

export function update(key, patch) {
  const cur = load(key);
  const next = (cur && typeof cur === 'object' && !Array.isArray(cur))
    ? { ...cur, ...patch }
    : patch;
  save(key, next);
  return next;
}

export function clear(key) {
  localStorage.removeItem(PREFIX + key);
}

// generate a simple id for new records
export function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
