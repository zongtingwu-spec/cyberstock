// js/ai.js — Claude + OpenAI 雙 AI 串接 (SSE streaming)

import { load, save, KEYS } from './storage.js';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const SYSTEM_PROMPT_BASE = `你是「賽博龐克風格的台股投資助手」。使用者透過一個本機 cyberpunk 即時股市儀表板向你提問。

回答原則:
- 一律使用繁體中文 (zh-TW),語氣簡潔、不囉嗦
- 數字以千分位呈現,百分比保留兩位小數
- 重要結論放最前面,理由放後面
- 涉及買賣建議時,務必加註「此為觀察分享,不構成投資建議」
- 若使用者的問題模糊,要先反問釐清
- 善用以下提供的即時資料,引用具體數字回答

請避免:
- 籠統的市場新聞解讀
- 過長的免責聲明
- 過度技術指標堆疊
`;

// ============= context builder =============

export function buildContextSnapshot({ marketsState, portfolio, marginState, pledgeState, totals }) {
  const ts = new Date().toISOString();
  return {
    timestamp: ts,
    markets: serializeMarkets(marketsState),
    portfolio: serializePortfolio(portfolio, totals),
    margin: serializeMargin(marginState, totals),
    pledge: serializePledge(pledgeState, totals),
  };
}

function serializeMarkets(m) {
  if (!m) return null;
  const fmt = q => q ? {
    name: q.name, price: q.price, prev: q.prev,
    change: q.price != null && q.prev != null ? +(q.price - q.prev).toFixed(2) : null,
    changePct: q.price != null && q.prev != null && q.prev !== 0
      ? +(((q.price - q.prev) / q.prev) * 100).toFixed(2) : null,
    time: q.time, source: q.source,
  } : null;
  return {
    twMain: fmt(m.twMain),
    twNight: fmt(m.twNight),
    usMain: m.usMain ? Object.fromEntries(Object.entries(m.usMain).map(([k, v]) => [k, fmt(v)])) : null,
    usNight: m.usNight ? Object.fromEntries(Object.entries(m.usNight).map(([k, v]) => [k, fmt(v)])) : null,
  };
}

function serializePortfolio(rows, totals) {
  if (!rows?.length) return { positions: [], totals: null };
  return {
    positions: rows.map(p => ({
      symbol: p.symbol,
      qty: p.qty,
      avgPrice: +Number(p.avgPrice).toFixed(2),
      currentPrice: p.currentPrice != null ? +Number(p.currentPrice).toFixed(2) : null,
      marketValue: p.marketValue != null ? Math.round(p.marketValue) : null,
      pnl: p.pnl != null ? Math.round(p.pnl) : null,
      pnlPct: p.pnlPct != null ? +Number(p.pnlPct).toFixed(2) : null,
      marginUsed: Math.round(p.totalMarginUsed || 0),
    })),
    totals: totals ? {
      cost: Math.round(totals.cost),
      marketValue: Math.round(totals.mv),
      pnl: Math.round(totals.pnl),
      pnlPct: +Number(totals.pnlPct).toFixed(2),
      marginUsed: Math.round(totals.marginUsed),
    } : null,
  };
}

function serializeMargin(m, totals) {
  if (!m) return null;
  return {
    balance: m.balance || 0,
    annualRatePct: m.rate || 0,
    warnRatio: m.warnRatio || 130,
    estimatedMaintenanceRatio: totals?.mv && m.balance ? +((totals.mv / m.balance) * 100).toFixed(2) : null,
  };
}

function serializePledge(p, totals) {
  if (!p) return null;
  return {
    amount: p.amount || 0,
    limit: p.limit || 60,
    estimatedRatio: totals?.mv ? +(((p.amount || 0) / totals.mv) * 100).toFixed(2) : null,
  };
}

export function ctxToMarkdown(ctx) {
  if (!ctx) return '';
  return `## 目前狀態快照 (${ctx.timestamp})

### 市場行情
\`\`\`json
${JSON.stringify(ctx.markets, null, 2)}
\`\`\`

### 持股組合
\`\`\`json
${JSON.stringify(ctx.portfolio, null, 2)}
\`\`\`

### 融資狀態
\`\`\`json
${JSON.stringify(ctx.margin, null, 2)}
\`\`\`

### 質押狀態
\`\`\`json
${JSON.stringify(ctx.pledge, null, 2)}
\`\`\`
`;
}

// ============= conversation history =============

const history = {
  claude: [],   // [{role: 'user'|'assistant', content: string}]
  openai: [],
  gemini: [],   // [{role: 'user'|'model', parts: [{text: string}]}]
};

export function clearHistory() {
  history.claude = [];
  history.openai = [];
  history.gemini = [];
}

export function getHistory() {
  return { claude: [...history.claude], openai: [...history.openai], gemini: [...history.gemini] };
}

// ============= Claude =============

export async function askClaude({ question, contextMarkdown, onChunk, onError, onDone, signal }) {
  const settings = load(KEYS.SETTINGS);
  const key = settings.claudeKey;
  const model = settings.claudeModel || 'claude-opus-4-7';
  if (!key) { onError?.('未設定 Claude API Key'); return; }

  const sysText = SYSTEM_PROMPT_BASE + (contextMarkdown ? `\n\n${contextMarkdown}` : '');
  history.claude.push({ role: 'user', content: question });

  let res;
  try {
    res = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        system: sysText,
        messages: history.claude,
        stream: true,
      }),
      signal,
    });
  } catch (e) {
    onError?.(`網路錯誤: ${e.message}`);
    history.claude.pop();
    return;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    onError?.(`HTTP ${res.status}: ${body.slice(0, 800)}`);
    history.claude.pop();
    return;
  }

  let assistantText = '';
  try {
    await parseSSE(res.body, line => {
      // Anthropic SSE lines: "event: <name>\ndata: {...}"
      // We get every line; handle data: lines
      if (!line.startsWith('data:')) return;
      const payload = line.slice(5).trim();
      if (!payload) return;
      try {
        const ev = JSON.parse(payload);
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          assistantText += ev.delta.text;
          onChunk?.(ev.delta.text);
        } else if (ev.type === 'message_stop') {
          // done
        } else if (ev.type === 'error') {
          onError?.(ev.error?.message || 'unknown stream error');
        }
      } catch (e) { /* ignore parse errors of non-JSON lines */ }
    });
    if (assistantText) {
      history.claude.push({ role: 'assistant', content: assistantText });
    } else {
      history.claude.pop();
    }
    onDone?.(assistantText);
  } catch (e) {
    onError?.(`串流中斷: ${e.message}`);
    history.claude.pop();
  }
}

// ============= OpenAI =============

export async function askOpenAI({ question, contextMarkdown, onChunk, onError, onDone, signal }) {
  const settings = load(KEYS.SETTINGS);
  const key = settings.openaiKey;
  const model = settings.openaiModel || 'gpt-4o';
  if (!key) { onError?.('未設定 OpenAI API Key'); return; }

  const sysText = SYSTEM_PROMPT_BASE + (contextMarkdown ? `\n\n${contextMarkdown}` : '');
  history.openai.push({ role: 'user', content: question });

  // o-series models don't accept streaming with same shape; treat them special
  const isOSeries = /^o\d/i.test(model);

  let res;
  try {
    res = await fetch(OPENAI_ENDPOINT, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: sysText },
          ...history.openai,
        ],
        stream: !isOSeries,
        ...(isOSeries ? {} : { temperature: 0.6, max_tokens: 2048 }),
      }),
      signal,
    });
  } catch (e) {
    onError?.(`網路錯誤: ${e.message}`);
    history.openai.pop();
    return;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    onError?.(`HTTP ${res.status}: ${body.slice(0, 800)}`);
    history.openai.pop();
    return;
  }

  let assistantText = '';
  try {
    if (isOSeries) {
      const data = await res.json();
      assistantText = data?.choices?.[0]?.message?.content || '';
      if (assistantText) onChunk?.(assistantText);
    } else {
      await parseSSE(res.body, line => {
        if (!line.startsWith('data:')) return;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') return;
        try {
          const ev = JSON.parse(payload);
          const delta = ev.choices?.[0]?.delta?.content;
          if (delta) {
            assistantText += delta;
            onChunk?.(delta);
          }
        } catch (e) { /* ignore */ }
      });
    }
    if (assistantText) history.openai.push({ role: 'assistant', content: assistantText });
    else history.openai.pop();
    onDone?.(assistantText);
  } catch (e) {
    onError?.(`串流中斷: ${e.message}`);
    history.openai.pop();
  }
}

// ============= Gemini (Google) =============

export async function askGemini({ question, contextMarkdown, onChunk, onError, onDone, signal }) {
  const settings = load(KEYS.SETTINGS);
  const key = settings.geminiKey;
  const model = settings.geminiModel || 'gemini-2.0-flash';
  if (!key) { onError?.('未設定 Gemini API Key'); return; }

  const sysText = SYSTEM_PROMPT_BASE + (contextMarkdown ? `\n\n${contextMarkdown}` : '');
  history.gemini.push({ role: 'user', parts: [{ text: question }] });

  const url = `${GEMINI_BASE}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sysText }] },
        contents: history.gemini,
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 2048,
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ],
      }),
      signal,
    });
  } catch (e) {
    onError?.(`網路錯誤: ${e.message}`);
    history.gemini.pop();
    return;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    onError?.(`HTTP ${res.status}: ${body.slice(0, 800)}`);
    history.gemini.pop();
    return;
  }

  let assistantText = '';
  try {
    await parseSSE(res.body, line => {
      if (!line.startsWith('data:')) return;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') return;
      try {
        const ev = JSON.parse(payload);
        const parts = ev.candidates?.[0]?.content?.parts || [];
        for (const p of parts) {
          if (p.text) {
            assistantText += p.text;
            onChunk?.(p.text);
          }
        }
        // 錯誤 / safety block
        const blockReason = ev.candidates?.[0]?.finishReason;
        if (blockReason && blockReason !== 'STOP' && blockReason !== 'MAX_TOKENS') {
          onError?.(`回應被中斷: ${blockReason}`);
        }
      } catch (e) { /* ignore */ }
    });
    if (assistantText) {
      history.gemini.push({ role: 'model', parts: [{ text: assistantText }] });
    } else {
      history.gemini.pop();
    }
    onDone?.(assistantText);
  } catch (e) {
    onError?.(`串流中斷: ${e.message}`);
    history.gemini.pop();
  }
}

// ============= 三方統整 (consensus synthesis) =============

/**
 * 取三個 AI 的回應, 由其中一個擔任「主席」彙整出共識結論
 * 優先順序: Claude > OpenAI > Gemini (Claude 推理較佳, 適合主持)
 * 強制使用獨立的 history 不污染主對話歷史
 */
const SYNTHESIS_SYSTEM = `你是「三方 AI 投資討論的主席」,現在要彙整 Claude、OpenAI、Gemini 三方對使用者問題的回答。

請用繁體中文,依以下結構回應:

## 🤝 三方共識
(三方都同意 / 結論相似的觀點)

## ⚖️ 觀點差異
(三方意見不同處,分別指出哪一方持哪種看法、差異點在哪)

## 🎯 主席結論
(綜合三方,給出你建議使用者採取的最終結論;明確、可行、不模糊)

## 📊 信心程度
(用 ⭐ 1–5 顆呈現你對這個結論的信心,並一句話說明為什麼)

語氣務實簡潔,別重複三方原文太多;聚焦在「使用者可以拿這個結論做什麼」。
仍要加註「本結論不構成投資建議」。`;

export async function synthesize({
  question, contextMarkdown,
  claudeResp, openaiResp, geminiResp,
  onChunk, onError, onDone, signal,
}) {
  const settings = load(KEYS.SETTINGS);
  const responses = [
    { name: 'CLAUDE', text: claudeResp, key: settings.claudeKey },
    { name: 'OPENAI', text: openaiResp, key: settings.openaiKey },
    { name: 'GEMINI', text: geminiResp, key: settings.geminiKey },
  ].filter(r => r.text && r.text.trim().length > 0);

  if (responses.length < 1) {
    onError?.('沒有任何 AI 回應可以統整');
    return;
  }

  const panel = responses.map(r => `### ${r.name} 的回答\n${r.text}`).join('\n\n');
  const userMsg = `使用者原始問題:\n${question}\n\n以下是三方 AI 的回答:\n\n${panel}`;

  // 挑主席: 優先 Claude > OpenAI > Gemini (但若該 AI 本身沒參與或沒 key, 跳到下一個)
  const participated = new Set(responses.map(r => r.name));
  let chair = null;
  if (settings.claudeKey && participated.has('CLAUDE')) chair = 'claude';
  else if (settings.openaiKey && participated.has('OPENAI')) chair = 'openai';
  else if (settings.geminiKey && participated.has('GEMINI')) chair = 'gemini';
  // 退路: 任何一個有 key 的 AI 即可
  else if (settings.claudeKey) chair = 'claude';
  else if (settings.openaiKey) chair = 'openai';
  else if (settings.geminiKey) chair = 'gemini';

  if (!chair) { onError?.('沒有可用的主席 AI'); return; }

  // 用獨立 system prompt,不污染主對話歷史 → 直接 fetch
  const sysFull = SYNTHESIS_SYSTEM + (contextMarkdown ? `\n\n${contextMarkdown}` : '');

  if (chair === 'claude') {
    return synthesizeViaClaude({ userMsg, sysFull, settings, onChunk, onError, onDone, signal });
  } else if (chair === 'openai') {
    return synthesizeViaOpenAI({ userMsg, sysFull, settings, onChunk, onError, onDone, signal });
  } else {
    return synthesizeViaGemini({ userMsg, sysFull, settings, onChunk, onError, onDone, signal });
  }
}

async function synthesizeViaClaude({ userMsg, sysFull, settings, onChunk, onError, onDone, signal }) {
  const res = await fetch(ANTHROPIC_ENDPOINT, {
    method: 'POST',
    headers: {
      'x-api-key': settings.claudeKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: settings.claudeModel || 'claude-opus-4-7',
      max_tokens: 2048,
      system: sysFull,
      messages: [{ role: 'user', content: userMsg }],
      stream: true,
    }),
    signal,
  }).catch(e => ({ ok: false, _err: e.message }));
  if (!res.ok) { onError?.(`Claude 統整失敗: ${res._err || `HTTP ${res.status}`}`); return; }
  let txt = '';
  await parseSSE(res.body, line => {
    if (!line.startsWith('data:')) return;
    const p = line.slice(5).trim();
    if (!p) return;
    try {
      const ev = JSON.parse(p);
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
        txt += ev.delta.text;
        onChunk?.(ev.delta.text);
      }
    } catch (e) {}
  });
  onDone?.(txt, 'claude');
}

async function synthesizeViaOpenAI({ userMsg, sysFull, settings, onChunk, onError, onDone, signal }) {
  const model = settings.openaiModel || 'gpt-4o';
  const isOSeries = /^o\d/i.test(model);
  const res = await fetch(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${settings.openaiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: sysFull },
        { role: 'user', content: userMsg },
      ],
      stream: !isOSeries,
      ...(isOSeries ? {} : { temperature: 0.5, max_tokens: 2048 }),
    }),
    signal,
  }).catch(e => ({ ok: false, _err: e.message }));
  if (!res.ok) { onError?.(`OpenAI 統整失敗: ${res._err || `HTTP ${res.status}`}`); return; }
  let txt = '';
  if (isOSeries) {
    const d = await res.json();
    txt = d?.choices?.[0]?.message?.content || '';
    if (txt) onChunk?.(txt);
  } else {
    await parseSSE(res.body, line => {
      if (!line.startsWith('data:')) return;
      const p = line.slice(5).trim();
      if (!p || p === '[DONE]') return;
      try {
        const ev = JSON.parse(p);
        const d = ev.choices?.[0]?.delta?.content;
        if (d) { txt += d; onChunk?.(d); }
      } catch (e) {}
    });
  }
  onDone?.(txt, 'openai');
}

async function synthesizeViaGemini({ userMsg, sysFull, settings, onChunk, onError, onDone, signal }) {
  const model = settings.geminiModel || 'gemini-2.0-flash';
  const url = `${GEMINI_BASE}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(settings.geminiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sysFull }] },
      contents: [{ role: 'user', parts: [{ text: userMsg }] }],
      generationConfig: { temperature: 0.5, maxOutputTokens: 2048 },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
    }),
    signal,
  }).catch(e => ({ ok: false, _err: e.message }));
  if (!res.ok) { onError?.(`Gemini 統整失敗: ${res._err || `HTTP ${res.status}`}`); return; }
  let txt = '';
  await parseSSE(res.body, line => {
    if (!line.startsWith('data:')) return;
    const p = line.slice(5).trim();
    if (!p || p === '[DONE]') return;
    try {
      const ev = JSON.parse(p);
      const parts = ev.candidates?.[0]?.content?.parts || [];
      for (const pt of parts) if (pt.text) { txt += pt.text; onChunk?.(pt.text); }
    } catch (e) {}
  });
  onDone?.(txt, 'gemini');
}

// ============= SSE parser =============

async function parseSSE(body, onLine) {
  if (!body) throw new Error('no response body');
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
      if (line) onLine(line);
    }
  }
  if (buf) onLine(buf);
}
