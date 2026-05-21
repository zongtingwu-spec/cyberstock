/**
 * Cloudflare Worker — CORS proxy for CYBER_STOCK_MONITOR
 *
 * Free tier: 100,000 requests / day
 * Use: https://YOUR-WORKER.workers.dev/?url=<encoded-target-url>
 *
 * Deploy:
 *   1. https://dash.cloudflare.com → Workers & Pages → Create
 *   2. Pick "Hello World" template, name it 'stock-proxy', click Deploy
 *   3. Click "Edit code", replace everything with this file, click "Deploy"
 *   4. Copy the URL (https://stock-proxy.<your-subdomain>.workers.dev) into
 *      the dashboard's ⚙ API Keys modal → 自訂 CORS Proxy 欄位
 */

const ALLOWED_HOSTS = [
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
  'mis.twse.com.tw',
  'www.twse.com.tw',
  'openapi.twse.com.tw',
  'ws.api.cnyes.com',
  'openapi.taifex.com.tw',
  'mis.taifex.com.tw',
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const u = new URL(request.url);
    const target = u.searchParams.get('url');
    if (!target) {
      return json({ error: 'missing ?url=' }, 400);
    }

    let t;
    try { t = new URL(target); }
    catch { return json({ error: 'invalid url' }, 400); }

    const okHost = ALLOWED_HOSTS.some(h =>
      t.hostname === h || t.hostname.endsWith('.' + h));
    if (!okHost) return json({ error: 'host not allowed: ' + t.hostname }, 403);

    try {
      const upstream = await fetch(target, {
        method: request.method,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; CyberStock/1.0)',
          'Accept': 'application/json, text/plain, */*',
        },
        body: ['GET', 'HEAD'].includes(request.method)
          ? undefined : await request.arrayBuffer(),
      });
      const body = await upstream.arrayBuffer();
      return new Response(body, {
        status: upstream.status,
        headers: {
          'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
          ...CORS,
        },
      });
    } catch (e) {
      return json({ error: 'fetch failed', message: e.message }, 502);
    }
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
