// js/tooltips.js — 全球指標 hover tooltip,解釋對股價影響

const TIPS = {
  'GC=F': {
    name: '黃金 (Gold Futures)',
    impact: '<em>避險資產之王</em>。股市恐慌 / 通膨預期升溫 / Fed 鴿派時上漲;與美元呈反向關係。',
    relate: '台股相關: 一般股市與黃金<em>偏負相關</em> — 黃金大漲常意味全球風險情緒下降,股市易回檔。台廠相關: <em>光洋科 (1785)</em>、<em>金益鼎 (8390)</em>。',
    threshold: '<span class="up-hint">突破 $3,000+</span> 通常代表市場高度避險;<span class="down-hint">跌破 $2,500</span> 代表風險偏好回升。',
  },
  'SI=F': {
    name: '白銀 (Silver Futures)',
    impact: '<em>避險 + 工業雙重屬性</em>。比黃金波動大 2–3 倍。太陽能、電動車電池、半導體封裝都用白銀。',
    relate: '台股相關: <em>太陽能類股 (元晶 6443、中美晶 5483)</em>、<em>半導體封裝 (日月光 3711)</em>。白銀漲 → 工業需求復甦訊號。',
    threshold: '銀金比 (Gold/Silver Ratio) > 80 視為白銀低估;< 60 視為白銀高估。',
  },
  'CL=F': {
    name: '原油 WTI (Crude Oil)',
    impact: '<em>通膨最直接的引信</em>。油價上漲 → CPI 上揚 → Fed 升息壓力 → 估值股 / 科技股 / 高息股<span class="down-hint">承壓</span>。',
    relate: '台股相關: <span class="up-hint">利多</span> <em>台塑 (1301)、長榮 (2603)、陽明 (2609)</em> (運價跟漲);<span class="down-hint">利空</span> <em>航空 (長榮航 2618、華航 2610)</em>、塑膠下游 (台塑四寶成本上升)。',
    threshold: '<span class="up-hint">$100+</span> 通膨警戒;<span class="down-hint">$60-</span> 全球需求疲軟訊號 (台積電/出口股需注意)。',
  },
  'NG=F': {
    name: '天然氣 (Natural Gas)',
    impact: '北美 / 歐洲冬季供暖、夏季用電高峰會推升。氮肥、電力公司、化工成本關鍵變數。',
    relate: '台股相關: <em>中石化 (1314)、信昌化 (4725)</em> 化肥成本;<em>聯華氣體 (1229)</em>;LNG 載運 <em>裕民 (2606)</em>。',
    threshold: '受季節性影響大,看「同期年比」比看絕對值更實用。',
  },
  'BTC-USD': {
    name: '比特幣 (Bitcoin)',
    impact: '<em>全球風險偏好溫度計</em>。BTC 強勢時 Nasdaq 通常跟漲;BTC 崩盤常領先 Nasdaq 1–3 天。流動性 / Fed 利率敏感度極高。',
    relate: '台股相關: <em>礦機 IC (智原 3035、創意 3443、世芯-KY 3661)</em>;<em>金融科技 (中信金 2891 旗下 NowChain)</em>;<em>FinTech 概念股</em>。',
    threshold: 'BTC 漲穿 ATH → 風險資產輪動到 Nasdaq → 台股科技股跟漲機率高。',
  },
  'ETH-USD': {
    name: '以太幣 (Ethereum)',
    impact: '對 NFT / DeFi / 智能合約 / Layer 2 更敏感。ETH/BTC 比率上揚 → 山寨季 (Altseason) 訊號。',
    relate: '台股相關: <em>區塊鏈服務 (鈊象 3293 母公司)、NFT 平台、Web3 概念股</em>。但連動性比 BTC 弱。',
    threshold: 'ETH/BTC 比 < 0.05 視為以太極度低估;> 0.08 山寨幣熱度高峰。',
  },
  'DX-Y.NYB': {
    name: '美元指數 DXY (US Dollar Index)',
    impact: '<em>影響台股最大的變數之一</em>。<span class="up-hint">強美元</span> → 新興市場資金外流 → 台幣貶值 → 外資<span class="down-hint">賣超台股</span>。同時壓抑黃金 / 原油 / BTC。',
    relate: '台股相關: <em>電子出口 (台積電 2330、廣達 2382)</em> 受惠台幣貶 (匯兌收益);但外資賣壓會抵消。原物料進口 (鋼鐵、塑化) <em>受傷</em>。',
    threshold: '<span class="up-hint">DXY 105+</span> 通常代表 Fed 偏鷹、新興市場壓力大;<span class="down-hint">< 100</span> 利於台股反彈。',
  },
  '^VIX': {
    name: 'VIX 恐慌指數',
    impact: '<em>S&P 500 隱含波動度</em> — 市場「保險費」。VIX 急飆 = 投資人付高價買保險 = 短期回檔訊號。<span class="up-hint">與股市強烈反向</span>。',
    relate: '台股相關: VIX 是台股最敏感的領先指標之一。VIX 飆 → 隔日台股開低機率 > 70%。<em>富邦 VIX (00677U)</em> 直接連動。',
    threshold: '<span class="down-hint">VIX < 15</span> 市場過度樂觀 (反向信號);<span class="up-hint">VIX > 25</span> 恐慌啟動;<span class="up-hint">> 40</span> 市場崩盤級。',
  },
  '^TNX': {
    name: '美國 10 年期公債殖利率',
    impact: '<em>所有資產的折現率</em>。殖利率上漲 → 股票折現後現值下降 → 高估值股 (科技股) <span class="down-hint">承壓</span>。',
    relate: '台股相關: <em>金融股 (兆豐金 2886、第一金 2892)</em> 利差擴大受惠;<em>高息傳產 (中華電 2412)</em> 因相對吸引力下降受傷。',
    threshold: '<span class="up-hint">> 4.5%</span> 估值殺手警報;<span class="down-hint">< 3.5%</span> 寬鬆預期。',
  },

  // ============= 美股巨頭 =============

  'NVDA': {
    name: '輝達 NVIDIA (NVDA)',
    impact: '<em>AI 浪潮的領頭羊</em>。AI 資本支出風向球 — NVDA 財報好/差直接決定全球 AI 概念股估值。GPU 是 AI 訓練的關鍵硬體,Hopper / Blackwell 系列訂單即未來。',
    relate: '台股相關: <em>台積電 (2330)</em> 最大 GPU 代工客戶、<em>緯創 (3231)</em> + <em>廣達 (2382)</em> AI 伺服器代工、<em>奇鋐 (3017)</em> + <em>雙鴻 (3324)</em> 散熱、<em>技嘉 (2376)</em> 顯卡、<em>欣興 (3037)</em> ABF 載板。',
    threshold: 'NVDA 單日 <span class="up-hint">±5%</span> 通常引發台積電隔日跟漲/跌 <span class="up-hint">1-3%</span>。財報前後是台廠最敏感時段。',
  },
  'AVGO': {
    name: '博通 Broadcom (AVGO)',
    impact: '<em>客製化 AI ASIC 大廠</em> — Google TPU 由 Broadcom 設計、台積電生產。網通晶片龍頭 (路由器/交換器)、無線晶片 (Wi-Fi 7) 也是主力。AI 第二曲線。',
    relate: '台股相關: <em>台積電 (2330)</em> 代工 ASIC、<em>景碩 (3189)</em> + <em>欣興 (3037)</em> ABF 載板、<em>智邦 (2345)</em> 網通設備供應。',
    threshold: 'AI 客製化 ASIC 訂單規模、博通 AI 營收占比 (目前 ~25%) 是觀察重點。',
  },
  'TSM': {
    name: '台積電 ADR (TSM)',
    impact: '<em>直接對應台積電 (2330)</em>。ADR 收盤後台股隔日開盤通常反映 <span class="up-hint">±2%</span>。是台股投資人「夜間預告」的核心指標。',
    relate: '台股相關: <em>台積電 2330 本尊</em>。ADR vs TWS 通常溢價 5-15%。所有半導體供應鏈 (聯發科 2454、聯電 2303、世界 5347、ASML 設備等) 都看 TSM 脈動。',
    threshold: 'ADR 溢價率 <span class="up-hint">> 20%</span> 視為過熱、<span class="down-hint">< 0%</span> 視為折價買點。',
  },
  'MSFT': {
    name: '微軟 Microsoft (MSFT)',
    impact: 'Office + <em>Azure 雲端</em> + <em>Copilot/AI</em> 三引擎。Azure 增速看 AI 需求、與 OpenAI 戰略夥伴關係決定 Copilot 競爭力。AI 雲端最大買家之一。',
    relate: '台股相關: Azure 資本支出帶動 <em>奇鋐 (3017)</em> + <em>雙鴻 (3324)</em> 散熱、<em>廣達 (2382)</em> + <em>緯創 (3231)</em> 伺服器、<em>金像電 (2368)</em> 高階 PCB。',
    threshold: 'Azure 同比 <span class="down-hint">< 25%</span> 視為動能放緩警訊。財報重點看雲端營收 + AI 貢獻。',
  },
  'GOOGL': {
    name: 'Alphabet / Google (GOOGL)',
    impact: '<em>搜尋廣告</em> + <em>YouTube</em> + <em>Google Cloud (GCP)</em> + <em>Gemini AI</em>。自研 TPU 對抗 NVDA GPU,差異化路線。',
    relate: '台股相關: Google TPU 由 <em>台積電 (2330)</em> 生產;GCP 資本支出帶動雲端供應鏈 (奇鋐、廣達);<em>Pixel 手機</em> 部分供應鏈 (玉晶光、大立光)。',
    threshold: '搜尋市佔受 ChatGPT / Perplexity 挑戰是長期威脅。<em>廣告營收成長率</em> 是核心觀察指標。',
  },
  'AMZN': {
    name: '亞馬遜 Amazon (AMZN)',
    impact: '<em>電商</em> + <em>AWS 雲端</em> 雙引擎,AWS 是主要利潤來源 (毛利率 30%+ vs 電商 5%)。Anthropic 戰略投資加速 AI 算力需求。',
    relate: '台股相關: AWS 資本支出帶動 <em>廣達 (2382)、緯創 (3231)、英業達 (2356)</em> AI 伺服器訂單;<em>奇鋐 (3017)</em> + <em>雙鴻 (3324)</em> 散熱。',
    threshold: 'AWS YoY 成長率 <span class="down-hint">< 15%</span> 警訊;<em>北美零售毛利率</em> 改善是另一觀察點。',
  },
  'AAPL': {
    name: '蘋果 Apple (AAPL)',
    impact: '<em>消費電子龍頭</em>。iPhone 銷量 + 服務營收是主軸。Apple Intelligence (端側 AI) 是新增動能。EPS 預期下修通常直接傳導到台廠。',
    relate: '台股相關: <em>鴻海 (2317)</em> 組裝、<em>台積電 (2330)</em> A/M 系列晶片代工、<em>大立光 (3008)</em> + <em>玉晶光 (3406)</em> 鏡頭、<em>和碩 (4938)</em>、<em>可成 (2474)</em> 機殼。<span class="up-hint">30+ 家蘋概股</span>。',
    threshold: '蘋果財報前後是台廠營收高點/低點。<em>iPhone 銷量年比</em> + <em>服務營收占比</em> 是核心。中國市占率變化是風險。',
  },
  'META': {
    name: 'Meta (META)',
    impact: '<em>社交廣告</em> (FB + IG) + <em>AI 投資</em> + <em>Reality Labs (VR/AR)</em>。AI 廣告精準度提升驅動營收,Llama 開源策略影響整個 AI 生態。',
    relate: '台股相關: <em>Reality Labs VR 硬體</em> 由台廠供應 (<em>鴻海、和碩、玉晶光、大立光</em>);AI 資料中心擴張帶動伺服器供應鏈。',
    threshold: '<em>Reality Labs 虧損占比</em> (季度 ~$40 億) 持續是壓力來源。<em>廣告收入成長率 + ROAS</em> 是核心。',
  },
  'TSLA': {
    name: '特斯拉 Tesla (TSLA)',
    impact: '<em>電動車 + 儲能 + 自駕 (FSD) + AI</em>。波動極大,Musk 言行直接影響股價。Robotaxi / Optimus 機器人是長期想像空間。',
    relate: '台股相關: <em>動力電池 (台達電 2308 充電樁)</em>、車用 IC (<em>聯發科 2454</em>)、ABF 載板 (<em>欣興 3037</em>)、<em>和大 (1536)</em> 減速器、<em>貿聯-KY (3665)</em> 線束。',
    threshold: '<em>季度交車量</em>、<em>毛利率變化</em> (目標 > 20%) 是關鍵。FSD 進展、中國市場銷量是 wildcard。',
  },

  // ============= 台股龍頭 =============

  '2330': {
    name: '台積電 TSMC (2330)',
    impact: '<em>台股之王</em>。權重 30%+,單檔決定大盤方向。AI 晶片代工龍頭 (NVDA / AVGO / GOOGL / AAPL 都是客戶)。N3/N2/A14 製程進度 = AI 紅利能否延續的關鍵。',
    relate: '同步觀察: <em>TSM ADR</em> (隔夜訊號)、<em>NVDA</em> (核心客戶)、<em>SOX 半導體指數</em>。供應鏈: <em>家登 (3680)</em>、<em>世界 (5347)</em>、<em>台勝科 (3532)</em> 矽晶圓。',
    threshold: '單日 <span class="up-hint">±3%</span> 通常拖動大盤 ±1.5%。法說會、月營收、ADR 隔夜表現是三大觀察點。外資佔比 ~70%,DXY 走勢影響大。',
  },
  '2454': {
    name: '聯發科 MediaTek (2454)',
    impact: '<em>手機晶片二哥</em> (僅次於高通 QCOM)、<em>WiFi 7</em> / 邊緣 AI / 車用 IC 三大成長引擎。中國手機品牌 (小米、OPPO、vivo) 出貨量直接影響。',
    relate: '對照: <em>QCOM</em> (高通)、<em>NVDA</em> (邊緣 AI 競爭)。客戶端: 蘋概鏈外的中國手機鏈。<em>瑞昱 (2379)</em> 是 WiFi/網通 corr。',
    threshold: '手機晶片庫存週期是大波段訊號。<em>毛利率 > 47%</em> 視為產品組合改善。法說會展望往往帶動隔日 ±5%。',
  },
  '3711': {
    name: '日月光投控 ASE Tech (3711)',
    impact: '<em>全球封測龍頭</em> (CoWoS 先進封裝)。AI 晶片要 NVDA + TSMC + 日月光 三方協作。CoWoS 產能擴張幅度 = AI 供給瓶頸指標。',
    relate: '對照: <em>NVDA</em>、<em>TSM</em>、<em>AMD</em>。同業: <em>京元電子 (2449)</em> 測試代工。先進封裝鏈: <em>家登 (3680)</em>、<em>辛耘 (3583)</em>。',
    threshold: '<em>CoWoS 月產能擴張公告</em>、<em>季度先進封裝營收占比</em> (> 25%) 是核心。封測產業 PMI 同步指標。',
  },
  '2317': {
    name: '鴻海 Hon Hai / Foxconn (2317)',
    impact: '<em>蘋概王 + AI 伺服器王</em>。iPhone 組裝 ~70% 市占。AI 伺服器 (NVDA HGX) 組裝市占 ~40%+。GPU 機櫃整體解決方案 (GB200 / GB300) 是新動能。',
    relate: '對照: <em>AAPL</em> (iPhone 銷量)、<em>NVDA</em> (AI 伺服器訂單)。同業: <em>廣達 (2382)</em>、<em>緯創 (3231)</em>。',
    threshold: '<em>月營收年增率</em> 是傳產股最重要指標。<em>AI 伺服器營收占比</em> 每季持續觀察 (目前 ~10% → 目標 25%)。',
  },
  '2382': {
    name: '廣達 Quanta (2382)',
    impact: '<em>NVDA AI 伺服器主力代工</em> (微軟 / Meta / Google 雲端訂單核心)。NB 代工 + AI 伺服器雙引擎,AI 是主要動能來源 (毛利率 / 估值雙升)。',
    relate: '對照: <em>NVDA、MSFT、META、AMZN</em> (雲端資本支出客戶)。同業: <em>緯創 (3231)、英業達 (2356)、緯穎 (6669)</em>。',
    threshold: '<em>毛利率 > 8%</em> 視為 AI 伺服器占比提升訊號 (傳統 NB ~5%)。法說會 AI 營收指引是核心觀察。',
  },
  '3231': {
    name: '緯創 Wistron (3231)',
    impact: '<em>NVDA AI 伺服器代工另一巨頭</em>。GPU baseboard 大廠 (NVDA 直接合作)。子公司緯穎 (6669) 雲端伺服器、緯軟 (4953) AI 軟體服務。',
    relate: '對照: <em>NVDA、META、MSFT</em> 雲端資本支出。同業: <em>廣達 (2382)、鴻海 (2317)</em>。',
    threshold: '<em>GB200 / GB300 baseboard 出貨進度</em>、<em>NVDA Blackwell 量產順暢度</em> 是關鍵。',
  },
  '2891': {
    name: '中信金 CTBC Financial (2891)',
    impact: '<em>金融龍頭 + 民營銀行龍頭</em>。利差、信用卡、財富管理三引擎。受 Fed / 台灣央行利率政策直接影響。海外曝險高 (日本、東南亞)。',
    relate: '對照: <em>^TNX (10Y 殖利率)</em>、<em>DXY 美元指數</em>。同業: <em>富邦金 (2881)、國泰金 (2882)、兆豐金 (2886)</em>。',
    threshold: '<em>每月 EPS 公告</em> 是金融股核心訊號。<em>10Y 殖利率上揚</em> = 利差擴大 = 利多。<em>DXY 急升</em> = 海外曝險匯損疑慮。',
  },
  '2412': {
    name: '中華電 Chunghwa Telecom (2412)',
    impact: '<em>定存概念股 / 防禦股代表</em>。穩定配息 (殖利率 ~4%)。5G + 雲端 + 資安為新動能。利率走勢直接決定相對吸引力。',
    relate: '對照: <em>^TNX (美 10Y 殖利率)</em>、<em>台灣 10Y 公債殖利率</em>。同業: <em>台灣大 (3045)、遠傳 (4904)</em>。',
    threshold: '<em>10Y 殖利率 < 1.5%</em> 利於高息傳產;<em>> 2%</em> 對 2412 估值不利。<em>除息日</em> 前後常有 ±3% 波動。',
  },
  '2603': {
    name: '長榮 Evergreen Marine (2603)',
    impact: '<em>貨櫃航運龍頭</em>。SCFI 運價 + 油價 + 中美貿易量是三大變數。具高度週期性 (大賺/大賠交替)。地緣政治 (紅海、巴拿馬運河) 衝擊大。',
    relate: '對照: <em>CL=F (油價)</em>、<em>SCFI 上海貨櫃運價指數</em>、<em>BDI 散裝乾貨指數</em>。同業: <em>陽明 (2609)、萬海 (2615)</em>。',
    threshold: '<em>SCFI 週報</em> 是核心領先指標。<em>SCFI > 2000</em> 視為運價強;<em>< 1000</em> 視為產業低谷。油價急漲 = 短期利空 (成本上升)。',
  },
};

let tipEl = null;
let hoveredRow = null;
let hideTimer = null;

function ensureEl() {
  if (!tipEl) tipEl = document.getElementById('ind-tooltip');
  return tipEl;
}

function buildContent(sym) {
  const tip = TIPS[sym];
  if (!tip) return '';
  return `
    <div class="tip-h">
      <span class="tip-tag">[ INDICATOR ]</span>
      <span class="tip-name">${tip.name}</span>
    </div>
    <div class="tip-body">
      <div class="tip-section">
        <div class="tip-section-title">📊 對股價影響</div>
        <div class="tip-section-body">${tip.impact}</div>
      </div>
      <div class="tip-section">
        <div class="tip-section-title">🔗 台股關聯</div>
        <div class="tip-section-body">${tip.relate}</div>
      </div>
      <div class="tip-section">
        <div class="tip-section-title">⚠️ 關鍵閾值</div>
        <div class="tip-section-body">${tip.threshold}</div>
      </div>
    </div>
  `;
}

function position(el, row) {
  const r = row.getBoundingClientRect();
  const tipW = 460;
  const tipH = el.offsetHeight || 280;
  const margin = 12;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // 優先放在 row 右側
  let left = r.right + margin;
  let top = r.top - 20;

  // 右側放不下 → 放左側
  if (left + tipW > vw - margin) {
    left = r.left - tipW - margin;
  }
  // 左側也放不下 → 對齊 row 下方
  if (left < margin) {
    left = Math.max(margin, Math.min(r.left, vw - tipW - margin));
    top = r.bottom + margin;
  }
  // 垂直超出 → 往上推
  if (top + tipH > vh - margin) top = vh - tipH - margin;
  if (top < margin) top = margin;

  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function show(row) {
  const sym = row.dataset.sym;
  if (!TIPS[sym]) return;
  const el = ensureEl();
  if (!el) return;
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  el.innerHTML = buildContent(sym);
  el.hidden = false;
  el.classList.remove('show');
  // 立即定位(此時 el 已 layout,可量到尺寸)
  position(el, row);
  // 下一個 tick 加 show class 觸發 CSS 動畫
  setTimeout(() => el.classList.add('show'), 0);
  hoveredRow = row;
}

function hide() {
  const el = ensureEl();
  if (!el) return;
  el.classList.remove('show');
  hideTimer = setTimeout(() => {
    el.hidden = true;
    hoveredRow = null;
  }, 150);
}

export function initIndicatorTooltips() {
  const rows = document.querySelectorAll('.ind-row');
  rows.forEach(row => {
    row.addEventListener('mouseenter', () => show(row));
    row.addEventListener('mouseleave', hide);
    // 也支援 focus / touch (點一下顯示)
    row.addEventListener('click', () => {
      if (hoveredRow === row && tipEl && !tipEl.hidden) hide();
      else show(row);
    });
  });
  // ESC 關閉
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') hide();
  });
  // 捲動時關閉 (避免 tooltip 漂走)
  window.addEventListener('scroll', () => { if (hoveredRow) hide(); }, true);
}
