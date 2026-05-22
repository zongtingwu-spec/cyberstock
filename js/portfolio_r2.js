// js/portfolio.js — 持股 / 成本 / 損益

import { load, save, genId, KEYS } from './storage_r2.js';

export function listHoldings() {
  return load(KEYS.HOLDINGS) || [];
}

export function addHolding({ symbol, qty, price, date, feeRate = 0.1425, marginRatio = 0 }) {
  const all = listHoldings();
  const rec = {
    id: genId(),
    symbol: String(symbol).toUpperCase().trim(),
    qty: Number(qty),
    price: Number(price),
    date: date || new Date().toISOString().slice(0, 10),
    feeRate: Number(feeRate) || 0,
    marginRatio: Number(marginRatio) || 0,    // 0 = 現股, 60 = 一般融資
    createdAt: Date.now(),
  };
  all.push(rec);
  save(KEYS.HOLDINGS, all);
  return rec;
}

export function deleteHolding(id) {
  const all = listHoldings().filter(r => r.id !== id);
  save(KEYS.HOLDINGS, all);
}

export function updateHolding(id, patch) {
  const all = listHoldings();
  const idx = all.findIndex(r => r.id === id);
  if (idx < 0) return null;
  all[idx] = { ...all[idx], ...patch };
  save(KEYS.HOLDINGS, all);
  return all[idx];
}

/**
 * 聚合: 同代號多筆買入合併,計算加權均價
 * 回傳 [{symbol, qty, avgPrice, totalCost, totalFee, totalMarginUsed, lots: [...]}]
 */
export function aggregate(holdings = listHoldings()) {
  const byS = new Map();
  for (const h of holdings) {
    const gross = h.qty * h.price;
    const fee = gross * (h.feeRate / 100);
    const marginUsed = gross * (h.marginRatio / 100);
    const equityCost = gross - marginUsed + fee;     // 含手續費的自備款 = 成本

    const cur = byS.get(h.symbol) || {
      symbol: h.symbol,
      qty: 0,
      totalGross: 0,
      totalFee: 0,
      totalCost: 0,
      totalMarginUsed: 0,
      lots: [],
    };
    cur.qty += h.qty;
    cur.totalGross += gross;
    cur.totalFee += fee;
    cur.totalCost += equityCost;
    cur.totalMarginUsed += marginUsed;
    cur.lots.push(h);
    byS.set(h.symbol, cur);
  }
  // compute avgPrice = totalGross / qty (買入加權均價)
  return Array.from(byS.values()).map(a => ({
    ...a,
    avgPrice: a.qty > 0 ? a.totalGross / a.qty : 0,
  }));
}

/**
 * 結合即時報價計算未實現損益
 * positions: 從 aggregate() 來的
 * quotes: Map<symbol, {price}>  (symbol 已正規化,例 '2330' 或 'tse_2330.tw' 的最後一段)
 * 回傳 [{symbol, qty, avgPrice, currentPrice, marketValue, pnl, pnlPct, ...}]
 */
export function withQuotes(positions, quoteLookup) {
  return positions.map(p => {
    const currentPrice = quoteLookup(p.symbol);
    const marketValue = currentPrice != null ? p.qty * currentPrice : null;
    const pnl = marketValue != null ? marketValue - p.totalCost - p.totalMarginUsed : null;
    // 損益% 用「自備款 (equity cost)」基準 — 含融資槓桿放大效果
    const pnlPct = (pnl != null && p.totalCost > 0) ? (pnl / p.totalCost) * 100 : null;
    return {
      ...p,
      currentPrice,
      marketValue,
      pnl,
      pnlPct,
    };
  });
}

export function totals(rows) {
  let cost = 0, mv = 0, pnl = 0, marginUsed = 0;
  let allHavePrice = true;
  for (const r of rows) {
    cost += r.totalCost || 0;
    marginUsed += r.totalMarginUsed || 0;
    if (r.marketValue != null) { mv += r.marketValue; }
    else { allHavePrice = false; }
    if (r.pnl != null) { pnl += r.pnl; }
  }
  const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
  return { cost, mv, pnl, pnlPct, marginUsed, allHavePrice };
}

export function exportCsv(holdings = listHoldings()) {
  const header = '代號,股數,買入價,買入日期,手續費率,融資成數,建立時間';
  const lines = holdings.map(h => [
    h.symbol, h.qty, h.price, h.date, h.feeRate, h.marginRatio,
    new Date(h.createdAt).toISOString(),
  ].join(','));
  return [header, ...lines].join('\n');
}

export function downloadCsv() {
  const csv = exportCsv();
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cyberstock_holdings_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ============ CSV IMPORT ============

/**
 * Parse a CSV text into rows.
 * Returns { headers: string[], rows: string[][] }
 */
export function parseCsvText(text) {
  // Normalise line endings
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const nonEmpty = lines.filter(l => l.trim());
  if (!nonEmpty.length) return { headers: [], rows: [] };

  const splitLine = (line) => {
    const result = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i+1] === '"') { cur += '"'; i++; }
        else { inQ = !inQ; }
      } else if (ch === ',' && !inQ) {
        result.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    result.push(cur.trim());
    return result;
  };

  // Strip BOM
  const headerLine = nonEmpty[0].replace(/^﻿/, '');
  const headers = splitLine(headerLine);
  const rows = nonEmpty.slice(1).map(splitLine);
  return { headers, rows };
}

/**
 * Auto-detect column mapping from headers.
 * Returns { symbol, qty, price, date, feeRate, marginRatio } — each value is a column index (or -1)
 */
export function detectColumns(headers) {
  const norm = headers.map(h => h.toLowerCase().replace(/[\s_\-]/g, ''));
  const find = (...keys) => {
    for (const k of keys) {
      const idx = norm.findIndex(h => h.includes(k));
      if (idx >= 0) return idx;
    }
    return -1;
  };
  return {
    symbol:      find('代號','symbol','股票','ticker','code','股票代號'),
    qty:         find('股數','qty','quantity','shares','數量','成交股數','volume'),
    price:       find('買入價','price','均價','成交價','avgprice','buyprice','單價'),
    date:        find('買入日期','date','成交日','交易日','日期','tradedate'),
    feeRate:     find('手續費率','feerate','fee'),
    marginRatio: find('融資成數','marginratio','margin'),
  };
}

/**
 * Convert a mapped row into a holding object.
 * colMap: { symbol, qty, price, date, feeRate, marginRatio } — column indices
 * rawRow: string[]
 * Returns { ok, data, error }
 */
export function rowToHolding(rawRow, colMap) {
  const g = (idx) => idx >= 0 ? (rawRow[idx] || '').replace(/,/g, '').trim() : '';

  const symbolRaw = g(colMap.symbol);
  const qtyRaw    = g(colMap.qty);
  const priceRaw  = g(colMap.price);

  if (!symbolRaw) return { ok: false, error: '缺代號' };
  if (!qtyRaw || isNaN(Number(qtyRaw))) return { ok: false, error: '股數無效' };
  if (!priceRaw || isNaN(Number(priceRaw))) return { ok: false, error: '價格無效' };

  const qty   = Number(qtyRaw);
  const price = Number(priceRaw);
  if (qty <= 0 || price <= 0) return { ok: false, error: '股數/價格必須 > 0' };

  let date = g(colMap.date);
  // Try to normalise date formats: 20250101 / 2025/01/01 / 2025-01-01
  if (date) {
    if (/^\d{8}$/.test(date)) {
      date = date.slice(0,4) + '-' + date.slice(4,6) + '-' + date.slice(6,8);
    } else {
      date = date.replace(/\//g, '-');
    }
    // Validate
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = '';
  }

  const feeRateRaw    = g(colMap.feeRate);
  const marginRatioRaw = g(colMap.marginRatio);

  return {
    ok: true,
    data: {
      symbol:      symbolRaw.toUpperCase(),
      qty,
      price,
      date:        date || new Date().toISOString().slice(0, 10),
      feeRate:     feeRateRaw ? Number(feeRateRaw) : 0.1425,
      marginRatio: marginRatioRaw ? Number(marginRatioRaw) : 0,
    }
  };
}

/**
 * Batch-import an array of valid holding objects.
 * Appends to existing holdings. Returns array of added records.
 */
export function importHoldings(validRows) {
  return validRows.map(row => addHolding(row));
}

// 自選股
export function listWatchlist() {
  return load(KEYS.WATCHLIST) || [];
}

export function addToWatchlist(symbol) {
  const s = String(symbol).toUpperCase().trim();
  const all = listWatchlist();
  if (!all.includes(s)) {
    all.push(s);
    save(KEYS.WATCHLIST, all);
  }
  return all;
}

export function removeFromWatchlist(symbol) {
  const all = listWatchlist().filter(s => s !== symbol);
  save(KEYS.WATCHLIST, all);
  return all;
}
