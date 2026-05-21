// js/memo.js — 備忘錄 (auto-save + Markdown 預覽 + 從結論引入 + 匯出)

const STORAGE_KEY = 'cyberstock_memo_v1';
let saveTimer = null;
let isPreview = false;

function $(id) { return document.getElementById(id); }

function loadMemo() {
  try {
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch (e) { return ''; }
}

function saveMemo(text) {
  try {
    localStorage.setItem(STORAGE_KEY, text);
    const el = $('memo-saved');
    if (el) {
      el.textContent = `已儲存 · ${new Date().toLocaleTimeString('zh-TW', { hour12: false })}`;
      el.classList.add('saved');
    }
  } catch (e) {
    console.warn('[memo] save fail:', e.message);
  }
}

function scheduleSave(text) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveMemo(text), 500);
  const el = $('memo-saved');
  if (el) {
    el.textContent = '編輯中...';
    el.classList.remove('saved');
  }
}

/** 把目前 AI 結論一鍵搬入備忘錄 */
function importConclusion() {
  const out = $('conclusion-output');
  const text = out?.textContent?.trim();
  if (!text) {
    alert('目前沒有結論可引入。\n先問 AI 一個問題,等三方統整完成後再來。');
    return;
  }
  const chair = $('conclusion-chair')?.textContent?.replace('主席: ', '').trim() || 'AI';
  const ts = new Date().toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  });
  const header = `\n\n## 🤝 ${ts} (主席: ${chair})\n\n`;
  const textarea = $('memo-input');
  if (!textarea) return;
  const before = textarea.value || '';
  textarea.value = (before.trim() ? before.trimEnd() + '\n' : '') + header + text + '\n\n---';
  saveMemo(textarea.value);
  textarea.scrollTop = textarea.scrollHeight;
  // 切到預覽模式好看
  if (!isPreview) togglePreview();
  return true;
}

/** Markdown 渲染 (簡易, 不引入第三方 lib) */
function renderMarkdown(md) {
  if (!md) return '<em style="color:var(--text-dim)">尚無內容</em>';
  // escape HTML
  let html = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // code blocks (```)
  html = html.replace(/```([\s\S]*?)```/g, (_, code) =>
    `<pre style="background:rgba(0,255,255,0.05);padding:10px;border-radius:3px;overflow-x:auto;color:var(--neon-cyan);">${code}</pre>`);
  // inline code (`)
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  // headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  // bold/italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // hr
  html = html.replace(/^---$/gm, '<hr>');
  // blockquote
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
  // lists - unordered
  html = html.replace(/^(?:- |\* )(.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.+<\/li>(?:\n|$))+/g, m => `<ul>${m}</ul>`);
  // lists - ordered
  html = html.replace(/^\d+\. (.+)$/gm, '<oli>$1</oli>');
  html = html.replace(/(<oli>.+<\/oli>(?:\n|$))+/g, m => `<ol>${m.replace(/oli>/g, 'li>')}</ol>`);
  // paragraphs (double newline)
  html = html.split(/\n\n+/).map(p => {
    if (/^<(h\d|ul|ol|pre|blockquote|hr)/.test(p.trim())) return p;
    return p.trim() ? `<p>${p.replace(/\n/g, '<br>')}</p>` : '';
  }).join('\n');

  return html;
}

function togglePreview() {
  isPreview = !isPreview;
  const textarea = $('memo-input');
  const preview = $('memo-preview');
  const btn = $('btn-memo-markdown');
  if (isPreview) {
    preview.innerHTML = renderMarkdown(textarea.value);
    textarea.hidden = true;
    preview.hidden = false;
    if (btn) btn.textContent = '✎ 編輯';
  } else {
    textarea.hidden = false;
    preview.hidden = true;
    if (btn) btn.textContent = '👁 預覽';
    textarea.focus();
  }
}

function exportMemo() {
  const text = $('memo-input')?.value || '';
  if (!text.trim()) {
    alert('備忘錄是空的, 沒東西可匯出。');
    return;
  }
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const blob = new Blob(['﻿' + text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cyberstock_memo_${ts}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function clearMemo() {
  if (!confirm('確定要清空整個備忘錄?此動作無法復原。')) return;
  $('memo-input').value = '';
  saveMemo('');
}

export function initMemo() {
  const textarea = $('memo-input');
  if (!textarea) return;
  textarea.value = loadMemo();
  if (textarea.value) {
    const el = $('memo-saved');
    if (el) { el.textContent = '已載入'; el.classList.add('saved'); }
  }
  textarea.addEventListener('input', () => scheduleSave(textarea.value));
  // Tab 鍵打 4 空白而非跳 focus
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const s = textarea.selectionStart, en = textarea.selectionEnd;
      textarea.value = textarea.value.slice(0, s) + '  ' + textarea.value.slice(en);
      textarea.selectionStart = textarea.selectionEnd = s + 2;
      scheduleSave(textarea.value);
    }
  });

  $('btn-memo-import')?.addEventListener('click', importConclusion);
  $('btn-memo-markdown')?.addEventListener('click', togglePreview);
  $('btn-memo-export')?.addEventListener('click', exportMemo);
  $('btn-memo-clear')?.addEventListener('click', clearMemo);

  // beforeunload 強制存一次
  window.addEventListener('beforeunload', () => saveMemo(textarea.value));
}
