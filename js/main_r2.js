// js/main.js — 進入點 + orchestrator

import { load, save, KEYS } from './storage_r2.js';
import {
  fetchTWSE, fetchYahoo, fetchCnyesFutures, fetchCnyesIntraday, fetchTwStockKline, txContractChannel,
  tpeSession, usSession, clocks, pctChange, absChange,
} from './markets_r2.js';
import {
  listHoldings, addHolding, deleteHolding, updateHolding,
  aggregate, withQuotes, totals,
  listWatchlist, addToWatchlist, removeFromWatchlist,
  downloadCsv,
  parseCsvText, detectColumns, rowToHolding, importHoldings,
} from './portfolio_r2.js';
import {
  getMarginSettings, setMarginSettings,
  getPledgeSettings, setPledgeSettings,
  maintenanceRatio, pledgeRatio,
} from './margin_r2.js';
import {
  buildContextSnapshot, ctxToMarkdown, clearHistory,
  askClaude, askOpenAI, askGemini, synthesize,
} from './ai_r2.js';
import * as audio from './audio_r2.js';
import {
  renderSingleQuote, renderMultiQuotes, renderSparkline, renderIndicators,
  renderHoldings, renderWatchlist, renderWatchlistCards,
  setKlineCache, getKlineCache, getKlineMeta, persistKlineCache, hydrateKlineCache,
  renderMargin,
  renderClocks, renderStatus,
  aiSetStatus, aiClearAll, aiAppendUser, aiAppendChunk, aiFinish, aiError,
  conclusionShow, conclusionHide, conclusionClear, conclusionSetChair, conclusionSetStatus,
  conclusionStart, conclusionAppend, conclusionFinish, conclusionError,
  triggerGlitch,
} from './ui_r2.js';
import { initIndicatorTooltips } from './tooltips_r2.js';
import { initMemo } from './memo_r2.js';

// ============= state =============

const TW_LEADERS = ['2330', '2454', '3711', '2317', '2382', '3231', '2891', '2412', '2603'];

const state = {
  markets: {
    twMain: null,        // unified quote
    twNight: null,
    usMain: {},          // {^GSPC: ..., ^IXIC: ..., ^DJI: ...}
    usNight: {},
    indicators: {},      // 全球觀察指標: GC=F, SI=F, CL=F, NG=F, BTC-USD, ETH-USD, DX-Y.NYB, ^VIX
  },
  watchInterval: '1d',   // 自選股 K 線時段
  watchRange: '3mo',
  quoteByCode: new Map(),    // stock code -> quote (for holdings/watch)
  nameByCode: new Map(),     // stock code -> 中文名
  txInfo: null,
  twseStatus: 'idle',
  yahooStatus: 'idle',
  lastRefresh: null,
  refreshSec: 10,
  refreshTimer: null,
  inFlight: false,
  prevPctTracker: {},        // for alert thresholds
};

// ============= settings =============

function loadSettings() {
  const s = load(KEYS.SETTINGS);
  // 自動遷移已廢棄的 Gemini 模型
  const DEPRECATED_GEMINI = ['gemini-2.0-flash', 'gemini-2.0-flash-exp', 'gemini-1.5-pro', 'gemini-1.5-flash'];
  if (DEPRECATED_GEMINI.includes(s.geminiModel)) {
    s.geminiModel = 'gemini-2.5-flash';
    save(KEYS.SETTINGS, s);
    console.log('[migrate] gemini model 已從廢棄版本升級到 gemini-2.5-flash');
  }
  state.refreshSec = s.refreshSec || 10;
  audio.setEnabled(s.soundOn);
  document.getElementById('refresh-slider').value = state.refreshSec;
  document.getElementById('refresh-display').textContent = `${state.refreshSec}s`;
  document.getElementById('ai-include-ctx').checked = !!s.aiIncludeCtx;
  document.getElementById('ai-synthesize').checked = s.aiSynthesize !== false;  // 預設 true
  document.getElementById('ai-websearch').checked = !!s.aiWebSearch;
  document.getElementById('claude-model-label').textContent = s.claudeModel || 'claude-opus-4-7';
  document.getElementById('openai-model-label').textContent = s.openaiModel || 'gpt-4o';
  document.getElementById('gemini-model-label').textContent = s.geminiModel || 'gemini-2.0-flash';
  updateSoundButton();
  return s;
}

function updateSoundButton() {
  const btn = document.getElementById('btn-sound');
  btn.textContent = audio.isEnabled() ? '🔊' : '🔇';
  btn.title = audio.isEnabled() ? '音效開啟 (點擊關閉)' : '音效關閉 (點擊開啟)';
}

// ============= core refresh =============

async function refresh() {
  if (state.inFlight) return;
  state.inFlight = true;
  state.twseStatus = 'loading';
  state.yahooStatus = 'loading';
  updateStatusBar();

  const tx = txContractChannel();
  state.txInfo = tx;

  const holdings = listHoldings();
  const watch = listWatchlist();
  // 台股龍頭固定觀察 (不管持股/自選都抓)
  const TW_LEADERS = ['2330', '2454', '3711', '2317', '2382', '3231', '2891', '2412', '2603'];
  const codes = unique([...holdings.map(h => h.symbol), ...watch, ...TW_LEADERS]);

  // TWSE: TAIEX, TX 期貨近月, 持股 + 自選 + 台股龍頭
  const twseChannels = [
    'tse_t00.tw',
    tx.channel,                                       // 期貨夜盤
    ...codes.flatMap(c => [`tse_${c}.tw`, `otc_${c}.tw`]),
  ];

  const yahooSymbols = [
    '^GSPC', '^IXIC', '^DJI',
    'ES=F', 'NQ=F', 'YM=F',
    '^TWII',
    // 全球觀察指標
    'GC=F', 'SI=F',           // 黃金、白銀
    'CL=F', 'NG=F',           // 原油 WTI、天然氣
    'BTC-USD', 'ETH-USD',     // 比特幣、以太幣
    'DX-Y.NYB', '^VIX',       // 美元指數、VIX
    // 美股巨頭
    'NVDA', 'AVGO', 'TSM',    // AI/半導體
    'MSFT', 'GOOGL', 'AMZN',  // 雲端
    'AAPL', 'META', 'TSLA',   // 消費/平台
  ];
  const INDICATOR_SYMS = [
    'GC=F', 'SI=F', 'CL=F', 'NG=F',
    'BTC-USD', 'ETH-USD', 'DX-Y.NYB', '^VIX',
    'NVDA', 'AVGO', 'TSM',
    'MSFT', 'GOOGL', 'AMZN',
    'AAPL', 'META', 'TSLA',
  ];
  const cnyesSymbols = ['TWF:TXF:FUTURES'];   // 大台指 (含夜盤即時)

  const [twseR, yahooR, cnyesR] = await Promise.allSettled([
    fetchTWSE(twseChannels),
    fetchYahoo(yahooSymbols),
    fetchCnyesFutures(cnyesSymbols),
  ]);

  // ============= process TWSE =============
  if (twseR.status === 'fulfilled') {
    state.twseStatus = 'ok';
    const map = twseR.value;

    // TAIEX
    const taiex = map.get('tse_t00.tw');
    if (taiex && taiex.price != null) {
      state.markets.twMain = { ...taiex, name: taiex.name || '加權指數' };
    } else if (state.markets.twMain) {
      // keep last but mark stale
      state.markets.twMain = { ...state.markets.twMain, _stale: true };
    }

    // TX 期貨 (mis.twse 不支援期貨, 留待 cnyes 處理)

    // 個股
    for (const code of codes) {
      const tse = map.get(`tse_${code}.tw`);
      const otc = map.get(`otc_${code}.tw`);
      const q = (tse && tse.price != null) ? tse : (otc && otc.price != null ? otc : null);
      if (q) {
        state.quoteByCode.set(code, q);
        if (q.name) state.nameByCode.set(code, q.name);
      }
    }
  } else {
    state.twseStatus = 'error';
    console.warn('[refresh] TWSE failed:', twseR.reason);
    // mark all TW quotes as stale
    if (state.markets.twMain) state.markets.twMain = { ...state.markets.twMain, _stale: true };
    if (state.markets.twNight) state.markets.twNight = { ...state.markets.twNight, _stale: true };
  }

  // ============= process Yahoo =============
  if (yahooR.status === 'fulfilled') {
    state.yahooStatus = 'ok';
    const map = yahooR.value;
    for (const s of ['^GSPC', '^IXIC', '^DJI']) {
      const q = map.get(s);
      if (q && q.price != null) state.markets.usMain[s] = q;
      else if (state.markets.usMain[s]) state.markets.usMain[s] = { ...state.markets.usMain[s], _stale: true };
    }
    for (const s of ['ES=F', 'NQ=F', 'YM=F']) {
      const q = map.get(s);
      if (q && q.price != null) state.markets.usNight[s] = q;
      else if (state.markets.usNight[s]) state.markets.usNight[s] = { ...state.markets.usNight[s], _stale: true };
    }

    // ^TWII sparkline 附加給 TW.MAIN
    const twii = map.get('^TWII');
    if (twii && twii.price != null) {
      if (state.markets.twMain) {
        state.markets.twMain = { ...state.markets.twMain, series: twii.series };
      }
    }

    // 全球觀察指標
    for (const s of INDICATOR_SYMS) {
      const q = map.get(s);
      if (q && q.price != null) state.markets.indicators[s] = q;
      else if (state.markets.indicators[s]) state.markets.indicators[s] = { ...state.markets.indicators[s], _stale: true };
    }
  } else {
    state.yahooStatus = 'error';
    console.warn('[refresh] Yahoo failed:', yahooR.reason);
    for (const k of Object.keys(state.markets.usMain)) state.markets.usMain[k] = { ...state.markets.usMain[k], _stale: true };
    for (const k of Object.keys(state.markets.usNight)) state.markets.usNight[k] = { ...state.markets.usNight[k], _stale: true };
    for (const k of Object.keys(state.markets.indicators)) state.markets.indicators[k] = { ...state.markets.indicators[k], _stale: true };
  }

  // ============= process cnyes (台指期含夜盤) =============
  if (cnyesR.status === 'fulfilled') {
    const map = cnyesR.value;
    const txQ = map.get('TWF:TXF:FUTURES');
    if (txQ && txQ.price != null) {
      state.markets.twNight = {
        ...txQ,
        contract: tx.label,
        name: txQ.name || '台指近月',
      };
    } else if (state.markets.twNight) {
      state.markets.twNight = { ...state.markets.twNight, _stale: true };
    }
  } else {
    console.warn('[refresh] cnyes failed:', cnyesR.reason);
    if (state.markets.twNight) state.markets.twNight = { ...state.markets.twNight, _stale: true };
  }
  if (!state.markets.twNight) {
    state.markets.twNight = { contract: tx.label, error: 'no_data', name: '台指近月' };
  }

  // 補抓 TX 分時 (sparkline) — 不阻塞主流程
  fetchCnyesIntraday('TWF:TXF:FUTURES').then(series => {
    if (series.length && state.markets.twNight) {
      state.markets.twNight.series = series;
      // 即時重繪 sparkline
      if (state.markets.twNight.price != null) renderAll();
    }
  }).catch(() => {});

  // ============= save lastquote cache =============
  try {
    const cache = {};
    if (state.markets.twMain) cache['TWII'] = pick(state.markets.twMain);
    if (state.markets.twNight) cache['TX'] = pick(state.markets.twNight);
    for (const k of Object.keys(state.markets.usMain)) cache[k] = pick(state.markets.usMain[k]);
    for (const k of Object.keys(state.markets.usNight)) cache[k] = pick(state.markets.usNight[k]);
    for (const [code, q] of state.quoteByCode) cache[code] = pick(q);
    save(KEYS.LAST_QUOTE, cache);
  } catch (e) { console.warn('cache save fail', e); }

  // ============= render =============
  state.lastRefresh = new Date().toTimeString().slice(0, 8);
  renderAll();
  detectAlerts();

  state.inFlight = false;
}

function pick(q) {
  if (!q) return null;
  return { price: q.price, prev: q.prev, time: q.time, name: q.name, contract: q.contract };
}

// ============= alerts =============

function detectAlerts() {
  const items = [
    ['twMain', state.markets.twMain],
    ['twNight', state.markets.twNight],
    ['us:^GSPC', state.markets.usMain?.['^GSPC']],
    ['us:^IXIC', state.markets.usMain?.['^IXIC']],
    ['us:^DJI', state.markets.usMain?.['^DJI']],
    ['us:ES=F', state.markets.usNight?.['ES=F']],
    ['us:NQ=F', state.markets.usNight?.['NQ=F']],
    ['us:YM=F', state.markets.usNight?.['YM=F']],
  ];
  for (const [k, q] of items) {
    if (!q || q.price == null || q.prev == null) continue;
    const pct = ((q.price - q.prev) / q.prev) * 100;
    const old = state.prevPctTracker[k];
    state.prevPctTracker[k] = pct;
    // 觸發條件: 變動超過 1%, 且距上次播報間隔已超過 60s
    if (Math.abs(pct) >= 1.0) {
      const now = Date.now();
      const lastTriggered = state.prevPctTracker[k + '_t'] || 0;
      if (now - lastTriggered > 60000) {
        state.prevPctTracker[k + '_t'] = now;
        if (pct > 0) audio.alertUp();
        else audio.alertDown();
      }
    }
  }
}

// ============= rendering orchestration =============

function renderAll() {
  // 市場時段
  const tpe = tpeSession();
  const us = usSession();

  // TAIEX panel
  const taiexLabel = tpe.main ? 'OPEN (盤中)' : '收盤';
  renderSingleQuote('tw-main', state.markets.twMain, taiexLabel, tpe.main);
  if (state.markets.twMain?.series) {
    renderSparkline('tw-main', state.markets.twMain.series, state.markets.twMain.prev);
  }

  // TX 夜盤 panel
  const txLabel = tpe.futNight ? 'OPEN (夜盤)' : tpe.futDay ? 'OPEN (日盤)' : '收盤';
  const txOpen = tpe.futNight || tpe.futDay;
  renderSingleQuote('tw-night', state.markets.twNight, txLabel, txOpen);
  if (state.markets.twNight?.series) {
    renderSparkline('tw-night', state.markets.twNight.series, state.markets.twNight.prev);
  }

  // US main
  const usLabel = us.rth ? 'OPEN (RTH)' : us.pre ? '盤前' : us.post ? '盤後' : '收盤';
  renderMultiQuotes('us-main', new Map(Object.entries(state.markets.usMain || {})), usLabel, us.rth);
  // sparkline 用 S&P 500 為主指標
  if (state.markets.usMain?.['^GSPC']?.series) {
    renderSparkline('us-main', state.markets.usMain['^GSPC'].series, state.markets.usMain['^GSPC'].prev);
  }

  // US night (futures)
  const usNightLabel = us.futOpen ? 'OPEN (期貨)' : '休市';
  renderMultiQuotes('us-night', new Map(Object.entries(state.markets.usNight || {})), usNightLabel, us.futOpen);
  // sparkline 用 ES (S&P 期貨) 為主指標
  if (state.markets.usNight?.['ES=F']?.series) {
    renderSparkline('us-night', state.markets.usNight['ES=F'].series, state.markets.usNight['ES=F'].prev);
  }

  // 龍頭股指標: 合併台股龍頭 (TWSE) + 美股巨頭 + 全球觀察 (Yahoo)
  const indicatorQuotes = { ...(state.markets.indicators || {}) };
  for (const code of TW_LEADERS) {
    const q = state.quoteByCode.get(code);
    if (q) indicatorQuotes[code] = q;
  }
  renderIndicators(indicatorQuotes);

  // Portfolio
  const positions = aggregate();
  const positionsWithQuotes = withQuotes(positions, sym => state.quoteByCode.get(sym)?.price ?? null);
  const t = totals(positionsWithQuotes);
  renderHoldings(positionsWithQuotes, t, code => state.nameByCode.get(code));

  // Watchlist (K 線卡片格)
  renderWatchlistCards(
    listWatchlist(),
    sym => state.quoteByCode.get(sym),
    code => state.nameByCode.get(code),
  );

  // Margin / Pledge
  const margin = getMarginSettings();
  const pledge = getPledgeSettings();
  const ratios = {
    maintenance: maintenanceRatio({ marketValue: t.mv, marginBalance: margin.balance }),
    pledge: pledgeRatio({ pledgeAmount: pledge.amount, marketValue: t.mv }),
  };
  renderMargin({ marginState: margin, pledgeState: pledge, totals: t, ratios });

  updateStatusBar();
}

function updateStatusBar() {
  renderStatus({
    twseStatus: state.twseStatus,
    yahooStatus: state.yahooStatus,
    lastRefresh: state.lastRefresh,
    refreshSec: state.refreshSec,
  });
}

// ============= clocks loop =============

function startClockTick() {
  let lastMinute = -1;
  const tick = () => {
    const d = new Date();
    renderClocks(clocks(d));
    if (d.getMinutes() !== lastMinute) {
      lastMinute = d.getMinutes();
      applyMegaTab();   // 每分鐘檢查一次自動切換
    }
  };
  tick();
  setInterval(tick, 1000);
}

// ============= MegaCaps Tab (TW / US 切換) =============

/** 依時間決定自動模式下要顯示哪個 tab */
function autoTab(now = new Date()) {
  const tpeHour = parseInt(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei', hour: '2-digit', hour12: false,
  }).format(now), 10);
  // 06:00–14:00 (台股盤前到收盤後一小時) → 台股
  // 其他時段 (期貨夜盤 + 美股) → 美股
  return (tpeHour >= 6 && tpeHour < 14) ? 'tw' : 'us';
}

function applyMegaTab() {
  const s = load(KEYS.SETTINGS);
  const pref = s.megaTabPref || 'auto';
  const active = (pref === 'auto') ? autoTab() : pref;

  // 切換 pane 顯示
  document.querySelectorAll('[data-pane]').forEach(p => {
    p.hidden = p.dataset.pane !== active;
  });
  // tab 視覺狀態 (pref 才會 active,跟 active pane 不一定相同)
  document.querySelectorAll('.mega-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === pref);
  });
  // 顯示提示
  const hint = document.getElementById('mega-auto-hint');
  if (hint) {
    const tagName = active === 'tw' ? '台股' : '美股';
    hint.textContent = (pref === 'auto')
      ? `自動 → ${tagName}`
      : `手動 → ${tagName}`;
  }
}

// ============= 自選股 K 線 =============

const INTERVAL_TO_RANGE = {
  '5m': '5d',
  '15m': '1mo',
  '60m': '3mo',
  '1d': '6mo',
  '1wk': '2y',
};

/** 不同 interval 的「新鮮期」: 在此期間內不重抓 */
const KLINE_FRESH_MS = {
  '5m': 60_000,        // 5 分 K: 1 分鐘新鮮
  '15m': 3 * 60_000,
  '60m': 10 * 60_000,
  '1d': 30 * 60_000,   // 日 K: 30 分鐘新鮮 (反正一天才更新一次)
  '1wk': 6 * 3600_000, // 週 K: 6 小時新鮮
};

/** 抓所有自選股 + 持股的 K 線 (非阻塞, 帶 cache 跳過邏輯) */
async function fetchAllWatchKlines(force = false) {
  const watch = listWatchlist();
  const holdingCodes = unique(listHoldings().map(h => h.symbol));
  const codes = unique([...watch, ...holdingCodes]);
  if (!codes.length) return;
  const interval = state.watchInterval;
  const range = INTERVAL_TO_RANGE[interval] || '3mo';
  const freshMs = KLINE_FRESH_MS[interval] || 30 * 60_000;

  // 過濾:已 cache 且仍新鮮的不重抓
  const toFetch = codes.filter(code => {
    if (force) return true;
    const meta = getKlineMeta(code);
    if (!meta) return true;                          // 沒抓過
    if (meta.interval !== interval) return true;     // 切到不同時段
    if (Date.now() - meta.fetchedAt > freshMs) return true;  // 過期
    return false;                                    // 還新鮮,跳過
  });

  if (toFetch.length === 0) {
    // 全部 cache hit, 直接重繪 (用 cache 資料就好)
    renderWatchlistCards(
      listWatchlist(),
      sym => state.quoteByCode.get(sym),
      code => state.nameByCode.get(code),
    );
    renderAll();
    return;
  }

  const tasks = toFetch.map(async code => {
    try {
      const r = await fetchTwStockKline(code, interval, range);
      if (r.candles && r.candles.length > 0) {
        setKlineCache(code, r.candles, interval);
        if (!state.nameByCode.has(code) && r.name) {
          state.nameByCode.set(code, r.name.split(/[\.\s]/)[0]);
        }
      }
    } catch (e) {
      console.warn('[kline]', code, e.message);
    }
  });
  await Promise.allSettled(tasks);

  // 持久化 cache 到 localStorage (reload 後可秒開)
  persistKlineCache();

  // 重繪
  renderWatchlistCards(
    listWatchlist(),
    sym => state.quoteByCode.get(sym),
    code => state.nameByCode.get(code),
  );
  renderAll();
}

function setupWatchIntervalTabs() {
  document.querySelectorAll('.watch-int-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const interval = btn.dataset.int;
      if (interval === state.watchInterval) return;
      state.watchInterval = interval;
      state.watchRange = INTERVAL_TO_RANGE[interval];
      document.querySelectorAll('.watch-int-tab').forEach(t => t.classList.toggle('active', t === btn));
      audio.blip();
      fetchAllWatchKlines(true);   // force: cache 是不同 interval 的
    });
  });
}

/** 套用 AI 啟用/停用樣式 (header toggle 變灰、column 變 disabled) */
function applyAiEnabledStyles() {
  const s = load(KEYS.SETTINGS);
  for (const provider of ['claude', 'openai', 'gemini']) {
    const enabled = s[`${provider}Enabled`] !== false;   // 預設 true
    const col = document.querySelector(`.ai-col[data-provider="${provider}"]`);
    if (col) col.classList.toggle('disabled', !enabled);
    const input = document.querySelector(`[data-ai-enable="${provider}"]`);
    if (input) input.checked = enabled;
  }
}

function setupMegaTabs() {
  document.querySelectorAll('.mega-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const pref = btn.dataset.tab;
      save(KEYS.SETTINGS, { ...load(KEYS.SETTINGS), megaTabPref: pref });
      applyMegaTab();
      audio.blip();
    });
  });
  applyMegaTab();
}

// ============= refresh timer =============

function startRefreshLoop() {
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  refresh();
  state.refreshTimer = setInterval(refresh, state.refreshSec * 1000);
}

// ============= event wiring =============

function unique(arr) { return Array.from(new Set(arr)); }

function setupEvents() {
  // refresh slider
  const slider = document.getElementById('refresh-slider');
  slider.addEventListener('input', () => {
    state.refreshSec = Number(slider.value);
    document.getElementById('refresh-display').textContent = `${state.refreshSec}s`;
  });
  slider.addEventListener('change', () => {
    save(KEYS.SETTINGS, { ...load(KEYS.SETTINGS), refreshSec: state.refreshSec });
    startRefreshLoop();
  });

  // manual refresh
  document.getElementById('btn-refresh').addEventListener('click', () => {
    audio.blip();
    refresh();
  });

  // sound toggle
  document.getElementById('btn-sound').addEventListener('click', () => {
    const cur = audio.isEnabled();
    audio.setEnabled(!cur);
    save(KEYS.SETTINGS, { ...load(KEYS.SETTINGS), soundOn: !cur });
    updateSoundButton();
    if (!cur) audio.blip();
  });

  // fullscreen
  document.getElementById('btn-fullscreen').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  });

  // settings (api keys) — share modal with topbar gear
  document.getElementById('btn-settings').addEventListener('click', () => openAiKeysModal());

  // === holdings ===
  document.getElementById('btn-add-holding').addEventListener('click', () => {
    const dlg = document.getElementById('modal-add-holding');
    dlg.querySelector('input[name="date"]').value = new Date().toISOString().slice(0, 10);
    dlg.showModal();
  });
  document.getElementById('btn-export-csv').addEventListener('click', () => downloadCsv());

  // ── CSV import ──────────────────────────────────────────────
  const csvFileInput = document.getElementById('csv-file-input');
  const csvModal     = document.getElementById('modal-csv-import');
  const csvHint      = document.getElementById('csv-import-hint');
  const csvWarn      = document.getElementById('csv-import-warn');
  const csvCount     = document.getElementById('csv-import-count');
  const csvColMap    = document.getElementById('csv-col-map');
  const csvColGrid   = document.getElementById('csv-col-grid');
  const csvPreviewHead = document.getElementById('csv-preview-head');
  const csvPreviewBody = document.getElementById('csv-preview-body');

  let _csvParsed   = null;   // { headers, rows }
  let _csvColMap   = null;   // { symbol, qty, price, date, feeRate, marginRatio }
  let _csvValidRows = [];    // validated holding objects ready for import

  document.getElementById('btn-import-csv').addEventListener('click', () => {
    csvFileInput.value = '';
    csvFileInput.click();
  });

  csvFileInput.addEventListener('change', async () => {
    const file = csvFileInput.files[0];
    if (!file) return;
    const text = await file.text();
    openCsvImportModal(text);
  });

  function openCsvImportModal(text) {
    const parsed = parseCsvText(text);
    _csvParsed = parsed;

    if (!parsed.headers.length) {
      alert('無法解析 CSV — 請確認檔案格式');
      return;
    }

    const autoMap = detectColumns(parsed.headers);
    _csvColMap = { ...autoMap };

    // Show/hide column mapping UI only when some fields not detected
    const missing = ['symbol','qty','price'].filter(k => autoMap[k] < 0);
    if (missing.length > 0) {
      csvColMap.hidden = false;
      buildColMapUI(parsed.headers, autoMap);
    } else {
      csvColMap.hidden = true;
    }

    refreshCsvPreview();
    csvModal.showModal();
  }

  function buildColMapUI(headers, autoMap) {
    const fields = [
      { key: 'symbol',      label: '代號 *' },
      { key: 'qty',         label: '股數 *' },
      { key: 'price',       label: '買入價 *' },
      { key: 'date',        label: '日期' },
      { key: 'feeRate',     label: '手續費率%' },
      { key: 'marginRatio', label: '融資成數%' },
    ];
    csvColGrid.innerHTML = fields.map(f => {
      const opts = ['<option value="-1">— 略過 —</option>',
        ...headers.map((h, i) => `<option value="${i}" ${autoMap[f.key] === i ? 'selected' : ''}>${h}</option>`)
      ].join('');
      return `<label>${f.label}<select data-field="${f.key}">${opts}</select></label>`;
    }).join('');

    csvColGrid.querySelectorAll('select').forEach(sel => {
      sel.addEventListener('change', () => {
        _csvColMap[sel.dataset.field] = Number(sel.value);
        refreshCsvPreview();
      });
    });
  }

  function refreshCsvPreview() {
    if (!_csvParsed) return;
    const { headers, rows } = _csvParsed;

    // Table header
    csvPreviewHead.innerHTML = '<th>#</th><th>狀態</th>' +
      headers.map(h => `<th>${h}</th>`).join('') +
      '<th>代號</th><th>股數</th><th>均價</th><th>日期</th>';

    // Validate rows
    _csvValidRows = [];
    const maxRows = 200;
    const previewHtml = rows.slice(0, maxRows).map((row, i) => {
      const res = rowToHolding(row, _csvColMap);
      const rowClass = res.ok ? 'csv-ok' : 'csv-skip';
      if (res.ok) _csvValidRows.push(res.data);
      const cells = row.map(c => `<td>${c}</td>`).join('');
      const extra = res.ok
        ? `<td>${res.data.symbol}</td><td>${res.data.qty}</td><td>${res.data.price}</td><td>${res.data.date}</td>`
        : `<td colspan="4" style="color:var(--up-red)">${res.error}</td>`;
      return `<tr class="${rowClass}"><td>${i+1}</td><td>${res.ok ? '✓' : '✗'}</td>${cells}${extra}</tr>`;
    }).join('');

    csvPreviewBody.innerHTML = previewHtml;
    csvCount.textContent = _csvValidRows.length;

    if (rows.length > maxRows) {
      csvWarn.textContent = `⚠ 只預覽前 ${maxRows} 行，檔案共 ${rows.length} 行，全部將被匯入。`;
      csvWarn.hidden = false;
    } else {
      csvWarn.hidden = true;
    }

    const hint = `共 ${rows.length} 行，可匯入 ${_csvValidRows.length} 筆，跳過 ${rows.length - _csvValidRows.length} 筆無效行。`;
    csvHint.textContent = hint;
  }

  document.getElementById('btn-csv-cancel').addEventListener('click', () => {
    csvModal.close();
  });

  document.getElementById('btn-csv-confirm').addEventListener('click', () => {
    if (!_csvValidRows.length) { alert('沒有可匯入的資料'); return; }
    // Re-validate all rows (including beyond preview limit)
    let allValid = _csvValidRows;
    if (_csvParsed.rows.length > 200) {
      allValid = _csvParsed.rows
        .map(r => rowToHolding(r, _csvColMap))
        .filter(r => r.ok)
        .map(r => r.data);
    }
    importHoldings(allValid);
    csvModal.close();
    audio.blip();
    refresh();
    fetchAllWatchKlines();
    // status notification
    const msg = `✅ 已匯入 ${allValid.length} 筆持股紀錄`;
    csvHint.textContent = msg;
    console.info('[csv-import]', msg, allValid);
  });
  // ── end CSV import ──────────────────────────────────────────

  document.getElementById('modal-add-holding').addEventListener('close', (e) => {
    const form = e.target.querySelector('form');
    if (e.target.returnValue === 'ok' && form && form.symbol.value) {
      const fd = new FormData(form);
      addHolding({
        symbol: fd.get('symbol'),
        qty: fd.get('qty'),
        price: fd.get('price'),
        date: fd.get('date'),
        feeRate: fd.get('feeRate'),
        marginRatio: fd.get('marginRatio'),
      });
      form.reset();
      audio.blip();
      refresh();
    }
  });

  // edit (delete) holdings — open edit list dialog
  document.getElementById('holdings-tbody').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-edit-sym]');
    if (btn) openEditHoldingModal(btn.dataset.editSym);
  });

  document.getElementById('modal-edit-holding')?.addEventListener('close', () => {
    refresh();
  });

  // === watchlist ===
  document.getElementById('btn-add-watch').addEventListener('click', () => {
    document.getElementById('modal-add-watch').showModal();
  });
  document.getElementById('modal-add-watch').addEventListener('close', (e) => {
    const form = e.target.querySelector('form');
    if (e.target.returnValue === 'ok' && form && form.symbol.value) {
      addToWatchlist(form.symbol.value);
      form.reset();
      audio.blip();
      refresh();
      fetchAllWatchKlines();   // 立刻抓 K 線
    }
  });
  document.getElementById('watchlist-cards').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del-watch]');
    if (del) {
      removeFromWatchlist(del.dataset.delWatch);
      renderAll();
      audio.blip();
    }
  });

  // === margin settings ===
  document.getElementById('btn-margin-settings').addEventListener('click', () => {
    const m = getMarginSettings();
    const p = getPledgeSettings();
    const f = document.getElementById('modal-margin').querySelector('form');
    f.marginBalance.value = m.balance || 0;
    f.marginRate.value = m.rate ?? 6.5;
    f.warnRatio.value = m.warnRatio ?? 130;
    f.pledgeAmount.value = p.amount || 0;
    f.pledgeLimit.value = p.limit ?? 60;
    document.getElementById('modal-margin').showModal();
  });
  document.getElementById('modal-margin').addEventListener('close', (e) => {
    const form = e.target.querySelector('form');
    if (e.target.returnValue === 'ok' && form) {
      const fd = new FormData(form);
      setMarginSettings({
        balance: Number(fd.get('marginBalance')) || 0,
        rate: Number(fd.get('marginRate')) || 0,
        warnRatio: Number(fd.get('warnRatio')) || 130,
      });
      setPledgeSettings({
        amount: Number(fd.get('pledgeAmount')) || 0,
        limit: Number(fd.get('pledgeLimit')) || 60,
      });
      audio.blip();
      renderAll();
    }
  });

  // === AI keys ===
  document.getElementById('btn-ai-keys').addEventListener('click', openAiKeysModal);
  document.getElementById('modal-ai-keys').addEventListener('close', (e) => {
    const form = e.target.querySelector('form');
    if (e.target.returnValue === 'ok' && form) {
      const fd = new FormData(form);
      const patch = {
        customProxyUrl: (fd.get('customProxyUrl') || '').trim(),
        claudeKey: fd.get('claudeKey') || load(KEYS.SETTINGS).claudeKey,
        claudeModel: fd.get('claudeModel'),
        openaiKey: fd.get('openaiKey') || load(KEYS.SETTINGS).openaiKey,
        openaiModel: fd.get('openaiModel'),
        geminiKey: fd.get('geminiKey') || load(KEYS.SETTINGS).geminiKey,
        geminiModel: fd.get('geminiModel'),
      };
      save(KEYS.SETTINGS, { ...load(KEYS.SETTINGS), ...patch });
      document.getElementById('claude-model-label').textContent = patch.claudeModel;
      document.getElementById('openai-model-label').textContent = patch.openaiModel;
      document.getElementById('gemini-model-label').textContent = patch.geminiModel;
      // 換 proxy → 刪除 K 線 cache 立刻強制重抓 (用新 proxy)
      if (patch.customProxyUrl !== load(KEYS.SETTINGS).customProxyUrl) {
        try { localStorage.removeItem('cyberstock_klineCache_v2'); } catch (e) {}
        fetchAllWatchKlines(true);
      }
      audio.blip();
    }
  });

  // dialog close buttons
  document.querySelectorAll('dialog [data-close]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const d = e.target.closest('dialog');
      if (d) d.close('default');
    });
  });

  // === AI send ===
  document.getElementById('btn-ai-send').addEventListener('click', sendQuestion);
  document.getElementById('ai-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendQuestion();
    }
  });
  document.getElementById('btn-ai-clear').addEventListener('click', () => {
    clearHistory();
    aiClearAll();
    aiSetStatus('claude', '— 待命 —');
    aiSetStatus('openai', '— 待命 —');
    aiSetStatus('gemini', '— 待命 —');
    conclusionHide();
  });

  // ai context toggle
  document.getElementById('ai-include-ctx').addEventListener('change', (e) => {
    save(KEYS.SETTINGS, { ...load(KEYS.SETTINGS), aiIncludeCtx: e.target.checked });
  });

  // synthesis toggle
  document.getElementById('ai-synthesize').addEventListener('change', (e) => {
    save(KEYS.SETTINGS, { ...load(KEYS.SETTINGS), aiSynthesize: e.target.checked });
  });

  // per-AI enabled toggles
  document.querySelectorAll('[data-ai-enable]').forEach(input => {
    input.addEventListener('change', (e) => {
      const provider = e.target.dataset.aiEnable;
      const key = `${provider}Enabled`;
      save(KEYS.SETTINGS, { ...load(KEYS.SETTINGS), [key]: e.target.checked });
      applyAiEnabledStyles();
      audio.blip();
    });
  });

  // web search toggle
  document.getElementById('ai-websearch').addEventListener('change', (e) => {
    save(KEYS.SETTINGS, { ...load(KEYS.SETTINGS), aiWebSearch: e.target.checked });
    if (e.target.checked) {
      console.log('[ai] 即時搜尋已開啟 — Gemini 用 Google grounding, Claude 用 web_search beta, OpenAI 自動切到 search-preview');
    }
  });
}

function openAiKeysModal() {
  const s = load(KEYS.SETTINGS);
  const f = document.getElementById('modal-ai-keys').querySelector('form');
  f.customProxyUrl.value = s.customProxyUrl || '';
  f.claudeKey.value = s.claudeKey || '';
  f.claudeModel.value = s.claudeModel || 'claude-opus-4-7';
  f.openaiKey.value = s.openaiKey || '';
  f.openaiModel.value = s.openaiModel || 'gpt-4o';
  f.geminiKey.value = s.geminiKey || '';
  f.geminiModel.value = s.geminiModel || 'gemini-2.5-flash';
  document.getElementById('modal-ai-keys').showModal();
}

function openEditHoldingModal(symbol) {
  const lots = listHoldings().filter(h => h.symbol === symbol);
  const container = document.getElementById('edit-holding-list');
  if (!lots.length) {
    container.innerHTML = `<div class="empty-row">${symbol} 無紀錄</div>`;
  } else {
    container.innerHTML = lots.map(h => `
      <div class="edit-row">
        <span class="e-sym">${h.symbol}</span>
        <span>${h.qty} 股</span>
        <span>@ ${h.price}</span>
        <span>融資 ${h.marginRatio || 0}%</span>
        <span class="e-date">${h.date}</span>
        <button class="del-btn" data-del-holding="${h.id}">✕ 刪除</button>
      </div>
    `).join('');
  }
  container.onclick = (e) => {
    const btn = e.target.closest('[data-del-holding]');
    if (!btn) return;
    if (confirm('確定刪除這筆紀錄?')) {
      deleteHolding(btn.dataset.delHolding);
      audio.blip();
      openEditHoldingModal(symbol);  // refresh list
    }
  };
  document.getElementById('modal-edit-holding').showModal();
}

// ============= AI send orchestration =============

async function sendQuestion() {
  const input = document.getElementById('ai-input');
  const q = input.value.trim();
  if (!q) return;
  const settings = load(KEYS.SETTINGS);
  // 同時看 key 和 enabled (預設 enabled 為 true)
  const isUseable = p => !!settings[`${p}Key`] && settings[`${p}Enabled`] !== false;
  if (!isUseable('claude') && !isUseable('openai') && !isUseable('gemini')) {
    alert('沒有可用的 AI。請設定至少一個 API Key,並啟用該 AI (column header 的開關)。');
    return;
  }
  const includeCtx = document.getElementById('ai-include-ctx').checked;

  // build context snapshot
  let ctxMarkdown = '';
  if (includeCtx) {
    const positions = aggregate();
    const positionsWithQuotes = withQuotes(positions, sym => state.quoteByCode.get(sym)?.price ?? null);
    const t = totals(positionsWithQuotes);
    const snap = buildContextSnapshot({
      marketsState: state.markets,
      portfolio: positionsWithQuotes,
      marginState: getMarginSettings(),
      pledgeState: getPledgeSettings(),
      totals: t,
    });
    ctxMarkdown = ctxToMarkdown(snap);
  }

  // append to each panel that's both keyed AND enabled
  for (const prov of ['claude', 'openai', 'gemini']) {
    const hasKey = !!settings[`${prov}Key`];
    const enabled = settings[`${prov}Enabled`] !== false;
    if (hasKey && enabled) {
      aiAppendUser(prov, q);
      aiSetStatus(prov, 'thinking...');
    } else if (!enabled) {
      aiSetStatus(prov, '— 已停用 —');
    } else {
      aiError(prov, '未設定 API Key');
    }
  }

  input.value = '';
  input.disabled = true;
  const btn = document.getElementById('btn-ai-send');
  btn.disabled = true;
  btn.textContent = '處理中...';

  // 統整模式開關
  const synthMode = document.getElementById('ai-synthesize')?.checked;
  if (synthMode) {
    conclusionHide();   // 清掉上一次的結論
  }

  // 各家回答收集到變數
  const responses = { claude: '', openai: '', gemini: '' };

  const tasks = [];
  if (isUseable('claude')) {
    tasks.push(askClaude({
      question: q, contextMarkdown: ctxMarkdown,
      onChunk: chunk => { responses.claude += chunk; aiAppendChunk('claude', chunk); },
      onError: msg => { aiError('claude', msg); aiSetStatus('claude', 'error'); },
      onDone: txt => { aiFinish('claude'); aiSetStatus('claude', '完成'); if (txt) responses.claude = txt; },
    }));
  }
  if (isUseable('openai')) {
    tasks.push(askOpenAI({
      question: q, contextMarkdown: ctxMarkdown,
      onChunk: chunk => { responses.openai += chunk; aiAppendChunk('openai', chunk); },
      onError: msg => { aiError('openai', msg); aiSetStatus('openai', 'error'); },
      onDone: txt => { aiFinish('openai'); aiSetStatus('openai', '完成'); if (txt) responses.openai = txt; },
    }));
  }
  if (isUseable('gemini')) {
    tasks.push(askGemini({
      question: q, contextMarkdown: ctxMarkdown,
      onChunk: chunk => { responses.gemini += chunk; aiAppendChunk('gemini', chunk); },
      onError: msg => { aiError('gemini', msg); aiSetStatus('gemini', 'error'); },
      onDone: txt => { aiFinish('gemini'); aiSetStatus('gemini', '完成'); if (txt) responses.gemini = txt; },
    }));
  }

  await Promise.allSettled(tasks);

  // ============= 統整階段 =============
  const validCount = ['claude', 'openai', 'gemini'].filter(p => responses[p] && responses[p].trim().length > 20).length;
  if (synthMode && validCount >= 2) {
    btn.textContent = '主席統整中...';
    conclusionStart();
    conclusionSetStatus('彙整中... 主席分析三方意見');
    conclusionSetChair('—');

    let chairName = '—';
    await synthesize({
      question: q,
      contextMarkdown: ctxMarkdown,
      claudeResp: responses.claude,
      openaiResp: responses.openai,
      geminiResp: responses.gemini,
      onChunk: chunk => conclusionAppend(chunk),
      onError: msg => conclusionError(msg),
      onDone: (txt, chair) => {
        chairName = chair === 'claude' ? 'Claude' : chair === 'openai' ? 'OpenAI' : chair === 'gemini' ? 'Gemini' : '—';
        conclusionSetChair(chairName);
        conclusionSetStatus(`完成 · 由 ${chairName} 主持`);
        conclusionFinish();
        audio.blip();
      },
    });
  } else if (synthMode && validCount < 2) {
    // 不足 2 個有效回答 → 不統整,輕量提示
    console.log('[synth] 跳過統整 (有效回答 < 2)');
  }

  input.disabled = false;
  btn.disabled = false;
  btn.textContent = '送出 ▶';
  input.focus();
}

// ============= init =============

function init() {
  loadSettings();
  setupEvents();
  setupMegaTabs();
  setupWatchIntervalTabs();
  initIndicatorTooltips();
  initMemo();
  applyAiEnabledStyles();
  // 從 localStorage 還原 K 線 cache, 首次 render 就有資料可畫
  const hydrated = hydrateKlineCache();
  if (hydrated > 0) console.log(`[kline] hydrated ${hydrated} symbols from cache`);
  startClockTick();
  renderAll();        // 用 cached K 線立刻畫出畫面
  startRefreshLoop();
  fetchAllWatchKlines();   // 背景更新 (fresh 的會自動跳過)
  // 每 5 分鐘檢查一次 (日 K 一天才更新一次,5 分夠用)
  setInterval(fetchAllWatchKlines, 5 * 60_000);
  // 換頁前再存一次 cache
  window.addEventListener('beforeunload', persistKlineCache);
  console.log('%c◤ CYBER STOCK MONITOR ◢ initialized.', 'color:#00ffff;font-weight:700');
  console.log('%c資料僅供參考,非投資建議 — 報價有延遲', 'color:#ff00ff');
}

document.addEventListener('DOMContentLoaded', init);
