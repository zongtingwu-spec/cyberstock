# ◤ CYBER_STOCK_MONITOR ◢

賽博龐克風即時股市儀表板 + 持股管理 + 雙 AI 助手 (純前端、本機執行)

## 特色

- **四市場即時行情**: 台股大盤 (TAIEX) / 台指期夜盤 (TX) / 美股大盤 (S&P / NASDAQ / DOW) / 美股期貨 (ES / NQ / YM)
- **持股 / 成本管理**: 加權均價、未實現損益、可匯出 CSV
- **融資 / 質押追蹤**: 維持率、每日利息、警戒線
- **雙 AI 助手**: Claude + OpenAI 並列回覆,可交叉比對;自動附帶市場 + 持股 + 融資狀態給 AI
- **自選股清單**: 個股即時報價
- **賽博龐克視覺**: 霓虹掃描線、glitch、Tron 網格、紅漲綠跌
- **大漲跌音效警示**: Web Audio 合成
- **全螢幕模式**
- **無後端,純前端**: 所有資料存在瀏覽器 localStorage

## 啟動方式

### Windows 一鍵啟動

雙擊 `start.bat`

它會啟動本機 HTTP server (port 8000) 並自動開啟瀏覽器。

### 手動啟動 (任何 OS)

```bash
cd 股票
python -m http.server 8000
```

然後瀏覽器開 `http://localhost:8000`

> ⚠️ 不能用 `file://` 雙擊 `index.html` 直接開啟 — 因為 CORS proxy 服務限制 origin,必須是 `localhost` 或 `*.github.io`。

## 第一次使用

1. 啟動後會看到四個市場面板,如果在台股 / 美股交易時段,數字會每 10 秒跳動一次
2. 點「**+ 新增買入**」加入持股紀錄:
   - 例: 代號 `2330`, 1000 股, 580 元, 融資成數 0 (現股)
3. 點「**+ 加入**」加入自選股
4. 點「**⚙ 設定**」設定融資餘額 / 利率 / 質押金額
5. 點「**⚙ API Keys**」設定 AI:
   - Claude (Anthropic) API Key: 從 [console.anthropic.com](https://console.anthropic.com) 取得
   - OpenAI API Key: 從 [platform.openai.com](https://platform.openai.com) 取得
   - 兩個都填或只填一個都可以
6. 在 AI 對話框輸入問題,例如:
   - 「我現在持股狀況如何?」
   - 「2330 該不該加碼?」
   - 「以我的融資狀況, 如果台積電跌 10% 會怎樣?」
7. Claude 和 OpenAI 會並列回覆,可以交叉比對兩個 AI 的看法

## 資料來源 (免費 / 無金鑰)

| 市場 | 來源 | 延遲 |
|------|------|------|
| 台股 (大盤 + 個股) | `mis.twse.com.tw` | ~5–10 秒 |
| 台指期 | `mis.twse.com.tw` | ~5–10 秒 |
| 美股 (指數 + 期貨) | Yahoo Finance v8 chart API | ~15 分鐘 (免費端點) |

透過 `corsproxy.io` (主) 和 `api.allorigins.win` (備) 兩個 CORS proxy 中轉。

## 操作快捷鍵

- `Ctrl + Enter` (AI 輸入欄): 送出問題
- 右上 `⛶`: 全螢幕
- 底部 `🔊`: 開關音效
- 底部 slider: 調整刷新間隔 (5–60 秒)
- 底部 `⟳`: 手動刷新

## 重要免責聲明

- ⚠️ **本工具僅供個人參考,所有資料、計算、AI 回應皆不構成投資建議**
- 報價有延遲,實際交易請以券商即時報價為準
- 融資 / 質押計算為簡化估算,實際以券商對帳單為準
- API Key 存在瀏覽器本機 localStorage — 請勿在公用電腦使用
- 台指期夜盤公開資料源限制,實際延遲可能 5–10 秒以上

## 故障排除

**Q: 數字一直是 ----.-- 不會跳動**
- 看底部狀態列 `TWSE: error` / `YAHOO: error` → 通常是 CORS proxy 服務暫時掛點,過幾分鐘就會恢復
- F12 開啟 Console,看具體錯誤訊息
- 確認你是用 `localhost:8000` 不是 `file://` 開的

**Q: AI 回應失敗**
- 確認 API Key 正確 (從各家平台複製)
- 確認帳號有額度 / 沒過期
- F12 Console 看 HTTP 錯誤碼:
  - 401 → API Key 錯誤
  - 429 → 速率限制 (請稍候)
  - CORS 錯誤 → Anthropic / OpenAI 都支援瀏覽器直連,如果還是不行可能是瀏覽器擴充阻擋

**Q: 看不到霓虹效果 / 字型怪怪的**
- 第一次需要連線下載 Google Fonts (Orbitron, Share Tech Mono, VT323),離線會用備用字型

**Q: 想要重設所有資料**
- F12 → Application → Local Storage → 刪除所有 `cyberstock_*` 項目

## 檔案結構

```
股票/
├── index.html             主結構
├── css/style.css          賽博龐克主題
├── js/
│   ├── main.js            進入點 + 刷新迴圈
│   ├── markets.js         行情抓取 (TWSE + Yahoo)
│   ├── portfolio.js       持股管理
│   ├── margin.js          融資 / 質押計算
│   ├── ai.js              Claude + OpenAI 串接
│   ├── ui.js              DOM 渲染 + 動畫
│   ├── chart.js           sparkline canvas
│   ├── audio.js           Web Audio 警示音
│   └── storage.js         localStorage 介面
├── start.bat              Windows 一鍵啟動
└── README.md              說明
```

## 開發 / 修改

純 HTML + CSS + Vanilla JS,沒有 build step。直接編輯檔案,重新整理瀏覽器就生效。

ES6 modules,所以必須跑在 HTTP server 上 (不能 `file://`)。

---

◤ HACK THE STOCK MARKET ◢
