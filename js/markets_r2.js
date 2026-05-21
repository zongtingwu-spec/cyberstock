// js/markets.js — 行情抓取 (TWSE + Yahoo) + CORS proxy + 時段判斷

const PUBLIC_PROXIES = [
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  url => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`,
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://corsproxy.org/?${encodeURIComponent(url)}`,
];

const FETCH_TIMEOUT_MS = 8000;

/** 取使用者自訂的 proxy URL (Cloudflare Worker) — 從 localStorage 讀 */
function getCustomProxy() {
  try {
    const s = JSON.parse(localStorage.getItem('cyberstock_settings') || '{}');
    const url = (s.customProxyUrl || '').trim();
    if (!url) return null;
    // 確保是有效 URL
    new URL(url);
    return url.replace(/\/+$/, '');   // 去尾 slash
  } catch (e) {
    return null;
  }
}

/** 拼出當前 proxy list: 有自訂的優先, 公共的當備援 */
function getProxies() {
  const custom = getCustomProxy();
  if (custom) {
    return [
      url => `${custom}/?url=${encodeURIComponent(url)}`,
      ...PUBLIC_PROXIES,
    ];
  }
  return PUBLIC_PROXIES;
}

// ============= util =============

/**
 * fetchWithProxy: 先試直接呼叫 (若該端點 CORS 友好),再依序嘗試 proxy
 * @param {boolean} tryDirect 是否先嘗試直連 (對有 CORS 的端點如 cnyes)
 */
async function fetchWithProxy(url, parser, { tryDirect = false } = {}) {
  const errors = [];
  const proxies = getProxies();
  const attempts = tryDirect
    ? [u => u, ...proxies]
    : proxies;
  for (const wrap of attempts) {
    const target = wrap(url);
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(target, {
        signal: ctrl.signal,
        cache: 'no-store',
        headers: { 'Accept': 'application/json,text/plain,*/*' },
      });
      clearTimeout(t);
      if (!res.ok) { errors.push(`HTTP ${res.status} via ${target.slice(0, 40)}`); continue; }
      const text = await res.text();
      const data = parser ? parser(text) : text;
      return { data, via: target.split('?')[0] };
    } catch (e) {
      errors.push(e.message || String(e));
    }
  }
  throw new Error(`all proxies failed: ${errors.join(' | ')}`);
}

// ============= TWSE realtime (mis.twse.com.tw) =============

/**
 * channels: array of channel strings like ['tse_t00.tw', 'tse_2330.tw', 'otc_TX202506.tw']
 * returns Map<channel, quote-object>
 */
export async function fetchTWSE(channels) {
  if (!channels?.length) return new Map();
  const ts = Date.now();
  const exch = channels.join('|');
  const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(exch)}&json=1&delay=0&_=${ts}`;
  const { data, via } = await fetchWithProxy(url, t => JSON.parse(t));

  const out = new Map();
  for (const ch of channels) out.set(ch, { symbol: ch, error: 'no_data', source: 'twse', via });

  if (Array.isArray(data?.msgArray)) {
    for (const row of data.msgArray) {
      // 正確還原原始 channel: TWSE 回傳的 row.ch 是不含 ex 前綴的 (例 't00.tw'),
      // 但 row.key 有完整含日期後綴的 channel (例 'tse_t00.tw_20260520')
      let ch = null;
      if (row.key && /_\d{8}$/.test(row.key)) {
        ch = row.key.replace(/_\d{8}$/, '');
      } else if (row.ex && row.c) {
        ch = `${row.ex}_${row.c}.tw`;
      } else if (row.ch) {
        ch = row.ch.includes('_') ? row.ch.replace(/_\d{8}$/, '') : `tse_${row.ch}`;
      }
      if (!ch) continue;  // empty row, skip
      const price = num(row.z);                     // 最新成交
      const prev = num(row.y);                      // 昨收
      const open = num(row.o);
      const high = num(row.h);
      const low = num(row.l);
      const name = row.n || row.nf || '';
      const time = row['%'] || row.t || '';
      const ts2 = row.tlong ? Number(row.tlong) : null;
      out.set(ch, {
        symbol: row.c || ch,
        channel: ch,
        name,
        price: price ?? null,
        prev: prev ?? null,
        open: open ?? null,
        high: high ?? null,
        low: low ?? null,
        time,
        ts: ts2,
        source: 'twse',
        via,
        error: price == null ? 'no_trade_yet' : null,
        raw: row,
      });
    }
  }
  return out;
}

// ============= 鉅亨網 cnyes 期貨 realtime =============

/**
 * 抓台指期 / 小台 / 微台等 TAIFEX 期貨即時報價 (含夜盤)
 * symbols: ['TWF:TXF:FUTURES', 'TWF:MXF:FUTURES', 'TWF:TMF:FUTURES']
 * 回傳 Map<symbol, unified quote>
 */
export async function fetchCnyesFutures(symbols = ['TWF:TXF:FUTURES']) {
  const ts = Date.now();
  const url = `https://ws.api.cnyes.com/ws/api/v1/quote/quotes/${encodeURIComponent(symbols.join(','))}?column=B&_=${ts}`;
  const { data, via } = await fetchWithProxy(url, t => JSON.parse(t), { tryDirect: true });
  const out = new Map();
  const rows = Array.isArray(data?.data?.items) ? data.data.items
             : Array.isArray(data?.data) ? data.data
             : Array.isArray(data?.items) ? data.items
             : [];
  for (const sym of symbols) out.set(sym, { symbol: sym, error: 'no_data', source: 'cnyes', via });
  for (const row of rows) {
    const sym = row['0'] || row.symbol;
    if (!sym) continue;
    const ts = row['200007'] ? Number(row['200007']) * 1000 : null;
    out.set(sym, {
      symbol: sym,
      name: row['200009'] || sym,
      price: numField(row['6']),
      prev: numField(row['11']) != null && numField(row['6']) != null
            ? numField(row['6']) - numField(row['11'])    // 用 change 反推 prev
            : numField(row['13']),
      open: numField(row['19']),
      high: numField(row['12']),
      low: numField(row['21']) ?? numField(row['200035']),
      change: numField(row['11']),
      changePct: numField(row['56']),
      volume: numField(row['200067']),
      ts,
      time: ts ? new Date(ts).toLocaleTimeString('zh-TW', { hour12: false, timeZone: 'Asia/Taipei' }) : null,
      source: 'cnyes',
      via,
      raw: row,
    });
  }
  return out;
}

function numField(x) {
  if (x == null || x === '' || x === '-') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

/**
 * 抓 cnyes 台股 K 線 (直連, 不走 proxy — 快且省配額)
 * @param {string} code  4位數股票代號 (例 '2330')
 * @param {string} interval  '5m'/'15m'/'60m'/'1d'/'1wk'
 */
export async function fetchCnyesStockKline(code, interval = '1d') {
  const cnyesRes = { '5m': '5', '15m': '15', '60m': '60', '1d': 'D', '1wk': 'W' }[interval] || 'D';
  const to = Math.floor(Date.now() / 1000);
  const ranges = {
    '5m': 5 * 86400, '15m': 30 * 86400, '60m': 90 * 86400,
    '1d': 180 * 86400, '1wk': 2 * 365 * 86400,
  };
  const from = to - (ranges[interval] || 180 * 86400);

  for (const ex of ['TWS', 'TWO']) {
    const sym = `${ex}:${code}:STOCK`;
    const url = `https://ws.api.cnyes.com/ws/api/v1/charting/history?resolution=${cnyesRes}&symbol=${encodeURIComponent(sym)}&from=${from}&to=${to}`;
    try {
      const { data } = await fetchWithProxy(url, t => JSON.parse(t), { tryDirect: true });
      const inner = data?.data || data || {};
      const closes = inner.c || [];
      const opens = inner.o || [];
      const highs = inner.h || [];
      const lows = inner.l || [];
      const vols = inner.v || [];
      const times = inner.t || [];
      if (closes.length === 0) continue;

      const candles = [];
      for (let i = 0; i < closes.length; i++) {
        const o = Number(opens[i]), h = Number(highs[i]), l = Number(lows[i]), c = Number(closes[i]);
        const t = Number(times[i]) * 1000;
        const v = Number(vols[i]) || 0;
        if (Number.isFinite(o) && Number.isFinite(h) && Number.isFinite(l) && Number.isFinite(c)) {
          candles.push({ t, o, h, l, c, v });
        }
      }
      candles.sort((a, b) => a.t - b.t);
      if (candles.length > 0) {
        return { symbol: code, name: '', candles, source: 'cnyes', exchange: ex };
      }
    } catch (e) { /* try next exchange */ }
  }
  return { symbol: code, candles: [], error: 'cnyes_no_data' };
}

// 抓 cnyes 期貨分時走勢 (sparkline 用) — 只抓目前所在交易時段的資料
export async function fetchCnyesIntraday(symbol = 'TWF:TXF:FUTURES') {
  const to = Math.floor(Date.now() / 1000);
  const from = txCurrentSessionStart();
  const url = `https://ws.api.cnyes.com/ws/api/v1/charting/history?resolution=1&symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}`;
  try {
    const { data } = await fetchWithProxy(url, t => JSON.parse(t), { tryDirect: true });
    // cnyes 回傳格式: { data: { t: [...], o, h, l, c, v } } 或扁平 { t, o, h, l, c, v }
    // **重要**: cnyes 回傳是「時間倒序」(最新在前),要反向才能正確畫線
    const inner = data?.data || data || {};
    const closes = inner.c || [];
    const times = inner.t || [];
    // 配對 + 過濾 + 排序 (時間升序)
    const pairs = [];
    for (let i = 0; i < closes.length; i++) {
      const v = Number(closes[i]);
      const t = Number(times[i] ?? 0);
      if (Number.isFinite(v) && (t === 0 || t >= from)) pairs.push({ t, v });
    }
    pairs.sort((a, b) => a.t - b.t);
    return pairs.map(p => p.v);
  } catch (e) {
    return [];
  }
}

/** 計算目前 TX 期貨所在交易時段的開始時間 (Unix seconds) */
function txCurrentSessionStart() {
  // 用 TPE 時區拆解現在時間
  const tpe = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const m = {};
  for (const p of tpe) m[p.type] = p.value;
  const year = Number(m.year), month = Number(m.month), day = Number(m.day);
  const hour = Number(m.hour === '24' ? '00' : m.hour);
  const minute = Number(m.minute);
  const hm = hour * 60 + minute;

  // 構造一個 TPE 時區的當天 15:00 的 Date object
  const startHour = (hm >= 15 * 60)            // 平日 15:00 之後 → 今天 15:00 是夜盤起點
                  ? { h: 15, addDay: 0 }
                  : (hm < 5 * 60)              // 凌晨 0–5 → 昨天 15:00
                  ? { h: 15, addDay: -1 }
                  : (hm >= 8 * 60 + 45 && hm <= 13 * 60 + 45) // 日盤 08:45–13:45
                  ? { h: 8, addDay: 0, m: 45 }
                  : { h: 15, addDay: -1 };     // gap (5:00-8:45, 13:45-15:00) 顯示上一個 session
  const d = new Date(Date.UTC(year, month - 1, day + (startHour.addDay || 0), (startHour.h ?? 0) - 8, startHour.m || 0, 0));
  return Math.floor(d.getTime() / 1000);
}

// ============= Yahoo Finance v8 chart =============

/**
 * symbols: array like ['^GSPC', 'ES=F', '^TWII']
 * returns Map<symbol, quote>
 */
export async function fetchYahoo(symbols) {
  if (!symbols?.length) return new Map();
  const results = await Promise.allSettled(symbols.map(s => fetchYahooOne(s)));
  const out = new Map();
  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    const r = results[i];
    if (r.status === 'fulfilled') out.set(sym, r.value);
    else out.set(sym, { symbol: sym, error: r.reason?.message || 'fetch_failed', source: 'yahoo' });
  }
  return out;
}

async function fetchYahooOne(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`;
  const { data, via } = await fetchWithProxy(url, t => JSON.parse(t));
  const res = data?.chart?.result?.[0];
  if (!res) throw new Error('no chart result');
  const meta = res.meta || {};
  const closes = res.indicators?.quote?.[0]?.close || [];
  const timestamps = res.timestamp || [];
  const validCloses = closes.map((v, i) => ({ v, t: timestamps[i] })).filter(p => p.v != null);
  const price = meta.regularMarketPrice ?? validCloses[validCloses.length - 1]?.v ?? null;
  const prev = meta.previousClose ?? meta.chartPreviousClose ?? null;

  return {
    symbol,
    name: meta.shortName || meta.longName || symbol,
    price,
    prev,
    open: meta.regularMarketOpen ?? validCloses[0]?.v ?? null,
    high: meta.regularMarketDayHigh ?? null,
    low: meta.regularMarketDayLow ?? null,
    time: meta.regularMarketTime ? fmtTime(new Date(meta.regularMarketTime * 1000)) : null,
    ts: meta.regularMarketTime ? meta.regularMarketTime * 1000 : null,
    source: 'yahoo',
    via,
    series: validCloses.map(p => p.v),
    error: price == null ? 'no_price' : null,
  };
}

// ============= Yahoo 多時段 K 線 (含 OHLC) =============

/**
 * 抓任一 Yahoo symbol 的完整 K 線資料 (OHLC 陣列)
 * @param {string} symbol  Yahoo 代碼 (例: '2330.TW', '^GSPC', 'NVDA')
 * @param {string} interval  1m/5m/15m/30m/1h/1d/1wk/1mo
 * @param {string} range   1d/5d/1mo/3mo/6mo/1y/2y/5y/max
 */
export async function fetchYahooKline(symbol, interval = '1d', range = '3mo') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  const { data, via } = await fetchWithProxy(url, t => JSON.parse(t));
  const r = data?.chart?.result?.[0];
  if (!r) throw new Error('no chart result');
  const meta = r.meta || {};
  const ts = r.timestamp || [];
  const q = r.indicators?.quote?.[0] || {};
  const candles = [];
  for (let i = 0; i < ts.length; i++) {
    const o = num(q.open?.[i]);
    const h = num(q.high?.[i]);
    const l = num(q.low?.[i]);
    const c = num(q.close?.[i]);
    const v = num(q.volume?.[i]);
    if (o == null || h == null || l == null || c == null) continue;
    candles.push({ t: ts[i] * 1000, o, h, l, c, v: v || 0 });
  }
  return {
    symbol,
    name: meta.shortName || meta.longName || symbol,
    price: meta.regularMarketPrice ?? null,
    prev: meta.previousClose ?? meta.chartPreviousClose ?? null,
    candles,
    interval,
    range,
    via,
  };
}

/**
 * 台股 K 線抓取: 先試 cnyes 直連 (快且不耗 proxy), 失敗再 Yahoo via proxy
 * @param {string} code  4-digit 代號
 * @param {string} interval  '5m'/'15m'/'60m'/'1d'/'1wk'
 * @param {string} range  Yahoo 用的範圍 (cnyes 不需要)
 */
export async function fetchTwStockKline(code, interval = '1d', range = '3mo') {
  // Primary: cnyes 直連 (有 CORS, 速度快, 不吃 proxy 配額)
  try {
    const r = await fetchCnyesStockKline(code, interval);
    if (r.candles && r.candles.length > 0) return r;
  } catch (e) { /* fall through to Yahoo */ }

  // Fallback: Yahoo .TW / .TWO via proxy
  try {
    const r = await fetchYahooKline(`${code}.TW`, interval, range);
    if (r.candles.length > 0) return r;
  } catch (e) { /* try OTC */ }
  try {
    const r = await fetchYahooKline(`${code}.TWO`, interval, range);
    return r;
  } catch (e) {
    return { symbol: code, candles: [], error: e.message };
  }
}

// ============= 台指期合約代號 =============

/**
 * Compute current front-month TX contract symbol.
 * Format used by TWSE mis service: 'otc_TX{YYYYMM}.tw'
 * Active contract = current month; if past 3rd Wednesday → next month
 */
export function txContractChannel(now = new Date()) {
  const tpe = tpeDate(now);
  const year = tpe.year;
  const month = tpe.month;
  const day = tpe.day;
  const thirdWed = thirdWednesday(year, month);
  let useYear = year, useMonth = month;
  if (day > thirdWed) {
    useMonth += 1;
    if (useMonth > 12) { useMonth = 1; useYear += 1; }
  }
  const mm = String(useMonth).padStart(2, '0');
  const channel = `otc_TX${useYear}${mm}.tw`;
  const label = `TX${useYear}${mm}`;
  return { channel, label, year: useYear, month: useMonth };
}

function thirdWednesday(year, month) {
  // month 1-12
  const first = new Date(year, month - 1, 1);
  const firstWedOffset = (3 - first.getDay() + 7) % 7;  // days until first Wednesday
  return 1 + firstWedOffset + 14;
}

// ============= 市場時段判斷 =============

function tpeDate(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, weekday: 'short',
  }).formatToParts(d);
  const m = {};
  for (const p of parts) m[p.type] = p.value;
  return {
    year: Number(m.year),
    month: Number(m.month),
    day: Number(m.day),
    hour: Number(m.hour === '24' ? '00' : m.hour),
    minute: Number(m.minute),
    second: Number(m.second),
    weekday: m.weekday, // Mon/Tue/...
    hm: Number(m.hour === '24' ? '00' : m.hour) * 60 + Number(m.minute),
  };
}

function nycDate(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, weekday: 'short',
  }).formatToParts(d);
  const m = {};
  for (const p of parts) m[p.type] = p.value;
  return {
    year: Number(m.year), month: Number(m.month), day: Number(m.day),
    hour: Number(m.hour === '24' ? '00' : m.hour),
    minute: Number(m.minute), second: Number(m.second),
    weekday: m.weekday,
    hm: Number(m.hour === '24' ? '00' : m.hour) * 60 + Number(m.minute),
  };
}

const WEEKDAY_SET = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);

export function tpeSession(d = new Date()) {
  const t = tpeDate(d);
  const isWeekday = WEEKDAY_SET.has(t.weekday);
  const main = isWeekday && t.hm >= 9 * 60 && t.hm <= 13 * 60 + 30;
  // 期貨日盤
  const futDay = isWeekday && t.hm >= 8 * 60 + 45 && t.hm <= 13 * 60 + 45;
  // 期貨夜盤: 15:00 當日 ~ 05:00 次日 (週五夜盤跨到週六凌晨 5 點, 即 fri 15:00–sat 05:00)
  const inEvening = isWeekday && t.hm >= 15 * 60;     // 平日 15:00 之後
  const inMorning = ['Tue', 'Wed', 'Thu', 'Fri', 'Sat'].includes(t.weekday) && t.hm < 5 * 60;
  const futNight = inEvening || inMorning;
  return { main, futDay, futNight, hm: t.hm, weekday: t.weekday };
}

export function usSession(d = new Date()) {
  const n = nycDate(d);
  const isWeekday = WEEKDAY_SET.has(n.weekday);
  // RTH 09:30 – 16:00 ET
  const rth = isWeekday && n.hm >= 9 * 60 + 30 && n.hm < 16 * 60;
  // futures: nearly 23h, closed Sat 17:00 ET – Sun 18:00 ET
  const futOpen = !(n.weekday === 'Sat' && n.hm >= 17 * 60) &&
                  !(n.weekday === 'Sun' && n.hm < 18 * 60);
  // pre/post market for easier labeling
  const pre = isWeekday && n.hm >= 4 * 60 && n.hm < 9 * 60 + 30;
  const post = isWeekday && n.hm >= 16 * 60 && n.hm < 20 * 60;
  return { rth, futOpen, pre, post, hm: n.hm, weekday: n.weekday };
}

export function clocks(d = new Date()) {
  return {
    tpe: fmtClockZone(d, 'Asia/Taipei'),
    nyc: fmtClockZone(d, 'America/New_York'),
    utc: fmtClockZone(d, 'UTC'),
  };
}

function fmtClockZone(d, zone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(d);
}

// ============= helpers =============

function num(x) {
  if (x == null || x === '' || x === '-' || x === '--') return null;
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}

function fmtTime(d) {
  return d.toTimeString().slice(0, 8);
}

export function pctChange(price, prev) {
  if (price == null || prev == null || prev === 0) return null;
  return ((price - prev) / prev) * 100;
}

export function absChange(price, prev) {
  if (price == null || prev == null) return null;
  return price - prev;
}
