// js/margin.js — 融資 / 質押計算

import { load, save, update, KEYS } from './storage.js';

export function getMarginSettings() {
  return load(KEYS.MARGIN);
}

export function setMarginSettings(patch) {
  return update(KEYS.MARGIN, patch);
}

export function getPledgeSettings() {
  return load(KEYS.PLEDGE);
}

export function setPledgeSettings(patch) {
  return update(KEYS.PLEDGE, patch);
}

/**
 * 維持率 = (持股總市值) / 融資餘額 × 100%
 * 註: 此為簡化版,實際券商計算還會扣保證金、加計融券等
 */
export function maintenanceRatio({ marketValue, marginBalance }) {
  if (!marginBalance || marginBalance <= 0) return null;
  if (marketValue == null) return null;
  return (marketValue / marginBalance) * 100;
}

/**
 * 質押率 = 質押金額 / 持股總市值 × 100%
 */
export function pledgeRatio({ pledgeAmount, marketValue }) {
  if (!marketValue || marketValue <= 0) return null;
  return ((pledgeAmount || 0) / marketValue) * 100;
}

/**
 * 每日融資利息 = 融資餘額 × 年利率 / 365
 */
export function dailyInterest({ marginBalance, annualRatePct }) {
  if (!marginBalance) return 0;
  return marginBalance * ((annualRatePct || 0) / 100) / 365;
}

/**
 * 自備款 = 持股市值 - 融資餘額
 */
export function equity({ marketValue, marginBalance }) {
  if (marketValue == null) return null;
  return marketValue - (marginBalance || 0);
}

/**
 * 狀態判定
 * margin: ratio >= warn+30 = safe, >= warn = caution, < warn = danger
 */
export function marginStatus(ratio, warn) {
  if (ratio == null) return 'unknown';
  if (ratio >= warn + 30) return 'safe';
  if (ratio >= warn) return 'warn';
  return 'danger';
}

export function pledgeStatus(ratio, limit) {
  if (ratio == null) return 'unknown';
  if (ratio < limit - 15) return 'safe';
  if (ratio < limit) return 'warn';
  return 'danger';
}
