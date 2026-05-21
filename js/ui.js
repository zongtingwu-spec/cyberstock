// js/ui.js — DOM 渲染 + 動畫

import { drawSparkline, drawCandlestick } from './chart.js';

const fmtNum = (n, d = 2) => {
  if (n == null || !Number.isFinite(n)) return '--';
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
};

const fmtInt = n => {
  if (n == null || !Number.isFinite(n)) return '--';
  return Math.round(n).toLocaleString('en-US');
};

const fmtTW = n => {
  if (n == null || !Number.isFinite(n)) return 'NT$ 0';
  return 'NT$ ' + Math.round(n).toLocaleString('en-US');
};

const fmtPct = (n, d = 2) => {
  if (n == null || !Number.isFinite(n)) return '--%';
  const s = n >= 0 ? '+' : '';
  return `${s}${n.toFixed(d)}%`;
};

const sign = n => n == null ? 'flat' : n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
const arrow = n => n == null ? '·' : n > 0 ? '▲' : n < 0 ? '▼' : '·';

// ============= panel rendering =============

const panelEls = {};

function panel(market) {
  if (!panelEls[market]) {
    panelEls[market] = document.querySelector(`.market-panel[data-market="${market}"]`);
  }
  return panelEls[market];
}

export function renderSingleQuote(market, quote, sessionLabel, isLive) {
  const p = panel(market);
  if (!p) return;

  const set = (field, value) => {
    const el = p.querySelector(`[data-field="${field}"]`);
    if (el && el.textContent !== value) el.textContent = value;
  };

  const setClass = (selector, cls) => {
    const el = p.querySelector(selector);
    if (el) {
      el.classList.remove('up', 'down', 'flat');
      if (cls) el.classList.add(cls);
    }
  };

  const led = p.querySelector('.led');
  const state = p.querySelector('.panel-state');
  if (led) led.setAttribute('data-status', isLive ? 'live' : 'closed');
  if (state) state.textContent = sessionLabel;

  if (!quote || quote.error === 'no_data' || quote.price == null) {
    set('price', '----.--');
    set('changeAbs', '--');
    set('changePct', '--%');
    set('arrow', '·');
    set('open', '--'); set('high', '--'); set('low', '--'); set('prev', '--');
    set('time', '--:--:--');
    setStale(p, true);
    return;
  }

  setStale(p, !!quote._stale);

  const change = quote.price - (quote.prev ?? quote.price);
  const pct = quote.prev ? (change / quote.prev) * 100 : 0;
  const dir = sign(change);

  const priceEl = p.querySelector('.price-big');
  const oldPrice = priceEl?.textContent;
  set('price', fmtNum(quote.price));
  setClass('.price-big', dir);
  if (priceEl && oldPrice !== priceEl.textContent && oldPrice !== '----.--') {
    triggerGlitch(priceEl);
  }

  set('arrow', arrow(change));
  setClass('.arrow', dir);
  set('changeAbs', (change >= 0 ? '+' : '') + fmtNum(change));
  set('changePct', fmtPct(pct));

  const cl = p.querySelector('.change-line');
  if (cl) {
    cl.classList.remove('up', 'down', 'flat');
    cl.classList.add(dir);
  }

  set('open', fmtNum(quote.open));
  set('high', fmtNum(quote.high));
  set('low', fmtNum(quote.low));
  set('prev', fmtNum(quote.prev));
  set('time', quote.time || '--:--:--');
  if (quote.contract) set('contract', quote.contract);
}

export function renderMultiQuotes(market, quotesBySym, sessionLabel, isLive) {
  const p = panel(market);
  if (!p) return;

  const led = p.querySelector('.led');
  const state = p.querySelector('.panel-state');
  if (led) led.setAttribute('data-status', isLive ? 'live' : 'closed');
  if (state) state.textContent = sessionLabel;

  let anyStale = false;
  let latestTime = '';

  for (const row of p.querySelectorAll('.row')) {
    const sym = row.dataset.sym;
    const q = quotesBySym?.get(sym);
    const priceEl = row.querySelector('.row-price');
    const pctEl = row.querySelector('.row-pct');
    if (!q || q.price == null) {
      if (priceEl) priceEl.textContent = '----.--';
      if (pctEl) pctEl.textContent = '--%';
      [priceEl, pctEl].forEach(el => el && el.classList.remove('up', 'down'));
      continue;
    }
    if (q._stale) anyStale = true;
    if (q.time && q.time > latestTime) latestTime = q.time;
    const change = q.price - (q.prev ?? q.price);
    const pct = q.prev ? (change / q.prev) * 100 : 0;
    const dir = sign(change);

    const oldText = priceEl?.textContent;
    if (priceEl) {
      priceEl.textContent = fmtNum(q.price);
      priceEl.classList.remove('up', 'down', 'flat');
      priceEl.classList.add(dir);
      if (oldText && oldText !== priceEl.textContent && oldText !== '----.--') triggerGlitch(priceEl);
    }
    if (pctEl) {
      pctEl.textContent = fmtPct(pct);
      pctEl.classList.remove('up', 'down', 'flat');
      pctEl.classList.add(dir);
    }
  }
  const timeEl = p.querySelector('[data-field="time"]');
  if (timeEl) timeEl.textContent = latestTime || '--:--:--';
  setStale(p, anyStale);
}

function setStale(p, on) {
  const el = p.querySelector('[data-field="stale"]');
  if (el) el.hidden = !on;
}

// ============= 全球觀察指標 =============

export function renderIndicators(quotesBySym) {
  const rows = document.querySelectorAll('.ind-row');
  rows.forEach(row => {
    const sym = row.dataset.sym;
    const q = quotesBySym?.[sym];
    const priceEl = row.querySelector('.ind-price');
    const pctEl = row.querySelector('.ind-pct');
    if (!q || q.price == null) {
      if (priceEl) priceEl.textContent = '--';
      if (pctEl) pctEl.textContent = '--%';
      [priceEl, pctEl].forEach(el => el && el.classList.remove('up', 'down'));
      return;
    }
    const change = q.price - (q.prev ?? q.price);
    const pct = q.prev ? (change / q.prev) * 100 : 0;
    const dir = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';

    // 不同類型顯示精度
    const isCrypto = sym.endsWith('-USD');
    const isYield = sym === '^TNX' || sym === '^VIX';
    const isFx = sym === 'DX-Y.NYB' || sym.endsWith('=X');
    const isUSStock = /^[A-Z]{1,5}$/.test(sym);   // NVDA / AAPL / TSM 等
    let txt;
    if (isCrypto) {
      txt = '$' + q.price.toLocaleString('en-US', { maximumFractionDigits: 0 });
    } else if (isUSStock) {
      txt = '$' + q.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } else if (isYield) {
      txt = q.price.toFixed(2);
    } else if (isFx) {
      txt = q.price.toFixed(2);
    } else {
      // 商品 (黃金、白銀、原油、天然氣)
      txt = q.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    if (priceEl) {
      const oldText = priceEl.textContent;
      priceEl.textContent = txt;
      priceEl.classList.remove('up', 'down', 'flat');
      priceEl.classList.add(dir);
      if (oldText && oldText !== txt && oldText !== '--') triggerGlitch(priceEl);
    }
    if (pctEl) {
      const sign = pct >= 0 ? '+' : '';
      pctEl.textContent = `${sign}${pct.toFixed(2)}%`;
      pctEl.classList.remove('up', 'down', 'flat');
      pctEl.classList.add(dir);
    }
  });
}

export function triggerGlitch(el) {
  if (!el) return;
  el.classList.remove('glitch');
  // force reflow
  void el.offsetWidth;
  el.classList.add('glitch');
  setTimeout(() => el.classList.remove('glitch'), 350);
}

// ============= sparkline =============

export function renderSparkline(market, series, prev) {
  const p = panel(market);
  if (!p) return;
  const canvas = p.querySelector('.sparkline');
  if (canvas) drawSparkline(canvas, series, { prev });
}

// ============= clocks =============

export function renderClocks({ tpe, nyc, utc }) {
  document.getElementById('clock-tpe').textContent = tpe;
  document.getElementById('clock-nyc').textContent = nyc;
  document.getElementById('clock-utc').textContent = utc;
}

// ============= holdings table =============

export function renderHoldings(rows, totalsObj, nameLookup) {
  const tbody = document.getElementById('holdings-tbody');
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="9">尚無持股紀錄 — 點「+ 新增買入」開始</td></tr>`;
  } else {
    tbody.innerHTML = rows.map(r => {
      const dir = sign(r.pnl);
      const name = nameLookup?.(r.symbol) || '';
      return `<tr data-sym="${r.symbol}">
        <td class="sym">${r.symbol}</td>
        <td>${name}</td>
        <td class="num">${r.qty.toLocaleString()}</td>
        <td class="num">${fmtNum(r.avgPrice)}</td>
        <td class="num">${r.currentPrice != null ? fmtNum(r.currentPrice) : '<span style="color:var(--text-dim)">--</span>'}</td>
        <td class="num">${r.marketValue != null ? fmtInt(r.marketValue) : '--'}</td>
        <td class="num ${dir}">${r.pnl != null ? (r.pnl >= 0 ? '+' : '') + fmtInt(r.pnl) : '--'}</td>
        <td class="num ${dir}">${r.pnlPct != null ? fmtPct(r.pnlPct) : '--'}</td>
        <td><button class="del-btn" data-edit-sym="${r.symbol}">編輯</button></td>
      </tr>`;
    }).join('');
  }

  if (totalsObj) {
    const t = totalsObj;
    document.getElementById('total-market').textContent = fmtInt(t.mv);
    document.getElementById('total-cost').textContent = fmtInt(t.cost);
    document.getElementById('total-pnl').textContent = (t.pnl >= 0 ? '+' : '') + fmtInt(t.pnl);
    document.getElementById('total-pnl').className = 'num ' + sign(t.pnl);
    document.getElementById('total-pnl-pct').textContent = fmtPct(t.pnlPct);
    document.getElementById('total-pnl-pct').className = 'num ' + sign(t.pnl);
  } else {
    document.getElementById('total-market').textContent = '0';
    document.getElementById('total-cost').textContent = '0';
    document.getElementById('total-pnl').textContent = '0';
    document.getElementById('total-pnl-pct').textContent = '0.00%';
  }
}

// ============= watchlist (K 線卡片格) =============

const klineCache = {};   // {sym: candles[]}

export function setKlineCache(sym, candles) {
  klineCache[sym] = candles;
}

export function getKlineCache(sym) {
  return klineCache[sym] || [];
}

export function renderWatchlistCards(items, quoteLookup, nameLookup) {
  const container = document.getElementById('watchlist-cards');
  if (!container) return;

  if (!items.length) {
    container.innerHTML = `<div class="empty-row">尚無自選 — 點「+ 加入」新增 4 位數股票代號 (例: 2330)</div>`;
    return;
  }

  // 渲染 + 重畫 K 線 (保留現有 canvas, 不要 innerHTML 整個重建,以免重新 DOM 造成閃爍)
  const existing = new Map();
  for (const card of container.querySelectorAll('.watch-card')) {
    existing.set(card.dataset.sym, card);
  }

  // 移除已不在列表的卡
  for (const [sym, card] of existing) {
    if (!items.includes(sym)) card.remove();
  }

  // 清空 empty hint
  const emptyHint = container.querySelector('.empty-row');
  if (emptyHint) emptyHint.remove();

  // 加入或更新每張卡
  for (const sym of items) {
    let card = existing.get(sym);
    if (!card) {
      card = document.createElement('div');
      card.className = 'watch-card';
      card.dataset.sym = sym;
      card.innerHTML = `
        <div class="watch-card-h">
          <span class="wc-sym">${sym}</span>
          <span class="wc-name">--</span>
          <span class="wc-price">--</span>
          <span class="wc-pct">--%</span>
          <button class="wc-del" data-del-watch="${sym}" title="移除自選">✕</button>
        </div>
        <div class="wc-chart-wrap">
          <canvas class="wc-chart"></canvas>
          <div class="wc-loading">載入 K 線中...</div>
        </div>
        <div class="wc-meta">
          <span class="wc-meta-item">O <b class="wc-o">--</b></span>
          <span class="wc-meta-item">H <b class="wc-h">--</b></span>
          <span class="wc-meta-item">L <b class="wc-l">--</b></span>
          <span class="wc-meta-item">V <b class="wc-v">--</b></span>
        </div>
      `;
      container.appendChild(card);
    }

    const q = quoteLookup?.(sym);
    const name = nameLookup?.(sym) || '';
    const candles = klineCache[sym] || [];
    const last = candles[candles.length - 1];

    // 即時報價優先 (mis.twse 的 q.price 是即時),K 線最後一根作為 OHLC 顯示
    const price = q?.price ?? last?.c ?? null;
    const prev = q?.prev ?? candles[candles.length - 2]?.c ?? null;
    const pct = (price != null && prev != null && prev !== 0) ? ((price - prev) / prev) * 100 : null;
    const dir = sign(pct);

    card.querySelector('.wc-name').textContent = name || '--';
    const priceEl = card.querySelector('.wc-price');
    priceEl.textContent = price != null ? fmtNum(price) : '--';
    priceEl.classList.remove('up', 'down', 'flat');
    priceEl.classList.add(dir);

    const pctEl = card.querySelector('.wc-pct');
    pctEl.textContent = fmtPct(pct);
    pctEl.classList.remove('up', 'down', 'flat');
    pctEl.classList.add(dir);

    if (last) {
      card.querySelector('.wc-o').textContent = fmtNum(last.o);
      card.querySelector('.wc-h').textContent = fmtNum(last.h);
      card.querySelector('.wc-l').textContent = fmtNum(last.l);
      card.querySelector('.wc-v').textContent = last.v ? fmtVol(last.v) : '--';
    }

    // 繪製 K 線
    const canvas = card.querySelector('.wc-chart');
    const loading = card.querySelector('.wc-loading');
    if (candles.length > 0) {
      if (loading) loading.style.display = 'none';
      drawCandlestick(canvas, candles);
    } else {
      if (loading) loading.style.display = '';
    }
  }
}

function fmtVol(v) {
  if (v == null) return '--';
  if (v >= 1e8) return (v / 1e8).toFixed(2) + '億';
  if (v >= 1e4) return (v / 1e4).toFixed(1) + '萬';
  return v.toString();
}

// 舊 API 名稱保留,改成轉派 (避免 main.js 也要改 import)
export function renderWatchlist(items, quoteLookup, nameLookup) {
  return renderWatchlistCards(items, quoteLookup, nameLookup);
}

// ============= margin panel =============

export function renderMargin({ marginState, pledgeState, totals, ratios }) {
  const m = marginState || {};
  const pl = pledgeState || {};

  document.getElementById('m-balance').textContent = fmtTW(m.balance);
  document.getElementById('m-rate').textContent = `${(m.rate || 0).toFixed(2)}%`;
  document.getElementById('m-daily-interest').textContent = fmtTW((m.balance || 0) * (m.rate || 0) / 100 / 365);
  document.getElementById('m-equity').textContent = fmtTW((totals?.mv || 0) - (m.balance || 0));
  document.getElementById('m-warn').textContent = `${m.warnRatio || 130}%`;

  // maintenance ratio
  const mRatio = ratios?.maintenance;
  const mRatioEl = document.getElementById('m-ratio');
  const mStatusEl = document.getElementById('m-status');
  const mBar = document.getElementById('m-ratio-bar');
  if (mRatio == null) {
    mRatioEl.textContent = '--%';
    mRatioEl.className = 'mb-big';
    mStatusEl.textContent = '— —';
    mStatusEl.className = 'status-ok';
    mBar.style.width = '0%';
  } else {
    mRatioEl.textContent = `${mRatio.toFixed(1)}%`;
    const warn = m.warnRatio || 130;
    const status = mRatio >= warn + 30 ? 'safe' : mRatio >= warn ? 'warn' : 'danger';
    mRatioEl.className = `mb-big ${status === 'safe' ? 'safe' : status === 'warn' ? 'warn' : 'danger'}`;
    mStatusEl.textContent = status === 'safe' ? '● 安全' : status === 'warn' ? '● 警戒' : '● 危險';
    mStatusEl.className = status === 'safe' ? 'status-ok' : status === 'warn' ? 'status-warn' : 'status-danger';
    const barWidth = Math.min(100, Math.max(0, (mRatio / 300) * 100));
    mBar.style.width = `${barWidth}%`;
  }

  // pledge
  document.getElementById('p-amount').textContent = fmtTW(pl.amount);
  document.getElementById('p-mv').textContent = fmtTW(totals?.mv || 0);
  const pRatio = ratios?.pledge;
  const pRatioEl = document.getElementById('p-ratio');
  const pStatusEl = document.getElementById('p-status');
  const pBar = document.getElementById('p-ratio-bar');
  if (pRatio == null) {
    pRatioEl.textContent = '--%';
    pRatioEl.className = 'mb-big';
    pStatusEl.textContent = '— —';
    pStatusEl.className = 'status-ok';
    pBar.style.width = '0%';
  } else {
    pRatioEl.textContent = `${pRatio.toFixed(1)}%`;
    const lim = pl.limit || 60;
    const status = pRatio < lim - 15 ? 'safe' : pRatio < lim ? 'warn' : 'danger';
    pRatioEl.className = `mb-big ${status === 'safe' ? 'safe' : status === 'warn' ? 'warn' : 'danger'}`;
    pStatusEl.textContent = status === 'safe' ? '● 安全' : status === 'warn' ? '● 接近上限' : '● 超限';
    pStatusEl.className = status === 'safe' ? 'status-ok' : status === 'warn' ? 'status-warn' : 'status-danger';
    pBar.style.width = `${Math.min(100, pRatio)}%`;
  }
}

// ============= status bar =============

export function renderStatus({ twseStatus, yahooStatus, lastRefresh, refreshSec, proxy }) {
  const twseLed = document.getElementById('led-twse');
  const yahooLed = document.getElementById('led-yahoo');
  if (twseLed) twseLed.setAttribute('data-status', twseStatus || 'idle');
  if (yahooLed) yahooLed.setAttribute('data-status', yahooStatus || 'idle');
  document.getElementById('status-twse').textContent = twseStatus || 'idle';
  document.getElementById('status-yahoo').textContent = yahooStatus || 'idle';
  if (lastRefresh) document.getElementById('status-last').textContent = lastRefresh;
  if (refreshSec) document.getElementById('refresh-display').textContent = `${refreshSec}s`;
  if (proxy) document.getElementById('status-proxy').textContent = proxy;
}

// ============= AI panel =============

const aiState = {
  claude: { busy: false, output: '' },
  openai: { busy: false, output: '' },
  gemini: { busy: false, output: '' },
};

export function aiSetStatus(provider, text) {
  const el = document.getElementById(`${provider}-status`);
  if (el) el.textContent = text;
}

export function aiClearOutput(provider) {
  const out = document.getElementById(`${provider}-output`);
  if (out) out.innerHTML = '<div class="ai-empty">等待問題...</div>';
  aiState[provider].output = '';
}

export function aiClearAll() {
  aiClearOutput('claude');
  aiClearOutput('openai');
  aiClearOutput('gemini');
}

export function aiAppendUser(provider, text) {
  const out = document.getElementById(`${provider}-output`);
  if (!out) return;
  const empty = out.querySelector('.ai-empty');
  if (empty) empty.remove();
  const div = document.createElement('div');
  div.className = 'ai-msg-user';
  div.textContent = text;
  out.appendChild(div);
  // start a new bot bubble
  const bot = document.createElement('div');
  bot.className = 'ai-msg-bot';
  bot.dataset.streaming = '1';
  const cursor = document.createElement('span');
  cursor.className = 'ai-cursor';
  bot.appendChild(cursor);
  out.appendChild(bot);
  out.scrollTop = out.scrollHeight;
}

export function aiAppendChunk(provider, chunk) {
  const out = document.getElementById(`${provider}-output`);
  if (!out) return;
  const bot = out.querySelector('.ai-msg-bot[data-streaming="1"]');
  if (!bot) return;
  const cursor = bot.querySelector('.ai-cursor');
  if (cursor) cursor.remove();
  bot.appendChild(document.createTextNode(chunk));
  const newCursor = document.createElement('span');
  newCursor.className = 'ai-cursor';
  bot.appendChild(newCursor);
  out.scrollTop = out.scrollHeight;
}

export function aiFinish(provider) {
  const out = document.getElementById(`${provider}-output`);
  if (!out) return;
  const bot = out.querySelector('.ai-msg-bot[data-streaming="1"]');
  if (bot) {
    delete bot.dataset.streaming;
    bot.querySelector('.ai-cursor')?.remove();
  }
}

// ============= 三方統整結論 =============

export function conclusionShow() {
  const el = document.getElementById('ai-conclusion');
  if (el) el.hidden = false;
}

export function conclusionHide() {
  const el = document.getElementById('ai-conclusion');
  if (el) el.hidden = true;
  conclusionClear();
}

export function conclusionClear() {
  const out = document.getElementById('conclusion-output');
  if (out) out.innerHTML = '';
}

export function conclusionSetChair(chairName) {
  const el = document.getElementById('conclusion-chair');
  if (el) el.textContent = `主席: ${chairName}`;
}

export function conclusionSetStatus(text) {
  const el = document.getElementById('conclusion-status');
  if (el) el.textContent = text;
}

export function conclusionStart() {
  const out = document.getElementById('conclusion-output');
  if (!out) return;
  out.innerHTML = '';
  const cursor = document.createElement('span');
  cursor.className = 'ai-cursor';
  out.appendChild(cursor);
  conclusionShow();
}

let conclusionBuffer = '';
let conclusionRenderTimer = null;
export function conclusionAppend(chunk) {
  const out = document.getElementById('conclusion-output');
  if (!out) return;
  conclusionBuffer += chunk;
  if (conclusionRenderTimer) return;
  conclusionRenderTimer = setTimeout(() => {
    conclusionRenderTimer = null;
    // 簡易 Markdown 渲染: ## 標題 / **粗體**
    const html = conclusionBuffer
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    out.innerHTML = html + '<span class="ai-cursor"></span>';
    out.scrollTop = out.scrollHeight;
  }, 50);
}

export function conclusionFinish() {
  if (conclusionRenderTimer) { clearTimeout(conclusionRenderTimer); conclusionRenderTimer = null; }
  const out = document.getElementById('conclusion-output');
  if (!out) return;
  const html = conclusionBuffer
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  out.innerHTML = html;
  conclusionBuffer = '';
}

export function conclusionError(msg) {
  if (conclusionRenderTimer) { clearTimeout(conclusionRenderTimer); conclusionRenderTimer = null; }
  conclusionBuffer = '';
  const out = document.getElementById('conclusion-output');
  if (!out) return;
  out.innerHTML = `<div class="ai-err">[統整失敗] ${msg}</div>`;
}

// ============= 對話錯誤 =============

export function aiError(provider, msg) {
  const out = document.getElementById(`${provider}-output`);
  if (!out) return;
  const bot = out.querySelector('.ai-msg-bot[data-streaming="1"]');
  if (bot) {
    bot.querySelector('.ai-cursor')?.remove();
    delete bot.dataset.streaming;
    const err = document.createElement('div');
    err.className = 'ai-err';
    err.textContent = `[error] ${msg}`;
    bot.appendChild(err);
  } else {
    const empty = out.querySelector('.ai-empty');
    if (empty) empty.remove();
    const err = document.createElement('div');
    err.className = 'ai-err';
    err.textContent = `[error] ${msg}`;
    out.appendChild(err);
  }
  out.scrollTop = out.scrollHeight;
}
