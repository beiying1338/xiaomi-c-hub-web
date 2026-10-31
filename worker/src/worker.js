// Cloudflare Worker: serves the static UI (Workers Static Assets) and
// proxies /api/* to your home bridge (e.g. behind a Cloudflare Tunnel).
// Configure the upstream with:  wrangler secret put BRIDGE_URL

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      const base = (env.BRIDGE_URL || '').replace(/\/+$/, '');
      if (!base) {
        return json({ error: 'BRIDGE_URL not configured — run: wrangler secret put BRIDGE_URL' }, 500);
      }
      const target = base + url.pathname + url.search;
      const init = { method: request.method, headers: request.headers, redirect: 'follow' };
      if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body;
      let upstream;
      try {
        upstream = await fetch(target, init);
      } catch (e) {
        return json({ error: 'bridge unreachable: ' + String(e) }, 502);
      }
      const resp = new Response(upstream.body, upstream);
      resp.headers.set('content-type', upstream.headers.get('content-type') || 'application/json');
      return resp;
    }

    // everything else: static assets from ../public
    return env.ASSETS.fetch(request);
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
