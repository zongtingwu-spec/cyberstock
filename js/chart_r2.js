// js/chart.js — Canvas 2D sparkline + 蠟燭圖 (霓虹科技風)

/**
 * 繪製日 / 週 / 時 K 線圖
 * @param {HTMLCanvasElement} canvas
 * @param {Array<{t, o, h, l, c}>} candles
 * @param {Object} opts { showVolume, gridLines, infoBar }
 */
export function drawCandlestick(canvas, candles, opts = {}) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || canvas.width;
  const cssH = canvas.clientHeight || canvas.height;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);

  if (!candles || candles.length < 2) {
    ctx.fillStyle = '#4a526e';
    ctx.font = '13px "Share Tech Mono", monospace';
    ctx.fillText('-- 等待 K 線資料 --', 10, cssH / 2);
    return;
  }

  const showVolume = opts.showVolume !== false;
  const volH = showVolume ? Math.min(28, cssH * 0.2) : 0;
  const padTop = 6, padBottom = 4, padLeft = 4, padRight = 4;
  const chartH = cssH - volH - padTop - padBottom - (showVolume ? 4 : 0);
  const chartW = cssW - padLeft - padRight;

  // 計算 y 範圍
  let pMin = Infinity, pMax = -Infinity, vMax = 0;
  for (const c of candles) {
    if (c.l < pMin) pMin = c.l;
    if (c.h > pMax) pMax = c.h;
    if (c.v > vMax) vMax = c.v;
  }
  const pPad = (pMax - pMin) * 0.05 || 1;
  pMin -= pPad; pMax += pPad;
  const pRange = pMax - pMin || 1;

  const n = candles.length;
  const slotW = chartW / n;
  const bodyW = Math.max(2, Math.min(slotW * 0.7, 14));

  const xOf = i => padLeft + slotW * (i + 0.5);
  const yOf = p => padTop + chartH - ((p - pMin) / pRange) * chartH;

  // 網格 (橫線 3 條)
  ctx.strokeStyle = 'rgba(0, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const y = padTop + (chartH / 3) * i;
    ctx.beginPath(); ctx.moveTo(padLeft, y); ctx.lineTo(padLeft + chartW, y); ctx.stroke();
  }

  // 蠟燭
  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const x = xOf(i);
    const up = c.c >= c.o;
    // 台灣慣例: 漲紅、跌綠
    const color = up ? '#ff2d55' : '#00ff41';
    const glow = up ? 'rgba(255, 45, 85, 0.6)' : 'rgba(0, 255, 65, 0.6)';

    // 上下影線
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.shadowBlur = 4;
    ctx.shadowColor = glow;
    ctx.beginPath();
    ctx.moveTo(x, yOf(c.h));
    ctx.lineTo(x, yOf(c.l));
    ctx.stroke();
    ctx.shadowBlur = 0;

    // body
    const yOpen = yOf(c.o);
    const yClose = yOf(c.c);
    const bodyY = Math.min(yOpen, yClose);
    const bodyH = Math.max(1, Math.abs(yClose - yOpen));
    ctx.fillStyle = color;
    ctx.shadowBlur = 3;
    ctx.shadowColor = glow;
    ctx.fillRect(x - bodyW / 2, bodyY, bodyW, bodyH);
    ctx.shadowBlur = 0;
  }

  // 成交量
  if (showVolume && vMax > 0) {
    const volTop = padTop + chartH + 4;
    for (let i = 0; i < n; i++) {
      const c = candles[i];
      const up = c.c >= c.o;
      ctx.fillStyle = up ? 'rgba(255, 45, 85, 0.55)' : 'rgba(0, 255, 65, 0.55)';
      const h = (c.v / vMax) * (volH - 2);
      const x = xOf(i);
      ctx.fillRect(x - bodyW / 2, volTop + (volH - 2 - h), bodyW, h);
    }
  }

  // 價格刻度標籤 (右側)
  ctx.fillStyle = 'rgba(154, 163, 199, 0.7)';
  ctx.font = '10px "Share Tech Mono", monospace';
  ctx.textAlign = 'right';
  ctx.fillText(pMax.toFixed(2), padLeft + chartW - 2, padTop + 10);
  ctx.fillText(pMin.toFixed(2), padLeft + chartW - 2, padTop + chartH - 2);

  // 最新價格虛線
  const last = candles[candles.length - 1];
  if (last) {
    const yLast = yOf(last.c);
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.4)';
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(padLeft, yLast);
    ctx.lineTo(padLeft + chartW, yLast);
    ctx.stroke();
    ctx.setLineDash([]);
    // 最新價標籤
    ctx.fillStyle = last.c >= last.o ? '#ff2d55' : '#00ff41';
    ctx.textAlign = 'left';
    ctx.font = 'bold 11px "Share Tech Mono", monospace';
    ctx.fillText(last.c.toFixed(2), padLeft + 4, yLast - 4);
  }
}

// ============= 原本的 sparkline =============

export function drawSparkline(canvas, points, opts = {}) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  if (!points || points.length < 2) {
    ctx.fillStyle = '#4a526e';
    ctx.font = '13px "Share Tech Mono", monospace';
    ctx.fillText('-- no data --', 8, h / 2 + 4);
    return;
  }

  const prev = opts.prev ?? points[0];
  const min = Math.min(...points, prev);
  const max = Math.max(...points, prev);
  const range = max - min || 1;
  const pad = 4;

  const xOf = i => pad + (i / (points.length - 1)) * (w - pad * 2);
  const yOf = v => h - pad - ((v - min) / range) * (h - pad * 2);

  // baseline (prev close)
  const baseY = yOf(prev);
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, baseY);
  ctx.lineTo(w - pad, baseY);
  ctx.stroke();
  ctx.setLineDash([]);

  // fill area gradient
  const last = points[points.length - 1];
  const up = last >= prev;
  const lineColor = up ? '#ff2d55' : '#00ff41';
  const glow = up ? 'rgba(255, 45, 85, 0.35)' : 'rgba(0, 255, 65, 0.35)';

  // build path
  ctx.beginPath();
  ctx.moveTo(xOf(0), yOf(points[0]));
  for (let i = 1; i < points.length; i++) ctx.lineTo(xOf(i), yOf(points[i]));

  // area fill
  const areaGrad = ctx.createLinearGradient(0, 0, 0, h);
  areaGrad.addColorStop(0, glow);
  areaGrad.addColorStop(1, 'transparent');
  ctx.lineTo(xOf(points.length - 1), h - pad);
  ctx.lineTo(xOf(0), h - pad);
  ctx.closePath();
  ctx.fillStyle = areaGrad;
  ctx.fill();

  // line
  ctx.beginPath();
  ctx.moveTo(xOf(0), yOf(points[0]));
  for (let i = 1; i < points.length; i++) ctx.lineTo(xOf(i), yOf(points[i]));
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  ctx.shadowBlur = 8;
  ctx.shadowColor = lineColor;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // last point dot
  const lx = xOf(points.length - 1);
  const ly = yOf(last);
  ctx.beginPath();
  ctx.arc(lx, ly, 4, 0, Math.PI * 2);
  ctx.fillStyle = lineColor;
  ctx.shadowBlur = 8;
  ctx.shadowColor = lineColor;
  ctx.fill();
  ctx.shadowBlur = 0;
}
