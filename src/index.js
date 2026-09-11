// Monopoly Banker — public Cloudflare Worker in front of the static app in ./public.
//
// It serves the assets, flips the page's ads meta tag when the ADS_ENABLED variable is "true", and sets the
// cache headers that let the service worker (public/sw.js) keep the app available offline while still picking
// up new deploys. There is no login: the app is public, and each device keeps its own game in the browser.

const CANONICAL_HOST = 'shortlineledger.com';
const REDIRECT_HOSTS = new Set(['www.shortlineledger.com']);
// Hosts served by Cloudflare's edge, where plain http should bounce to https. Local `wrangler dev` hosts never match.
const PROD_HOST = /(^|\.)(shortlineledger\.com|workers\.dev)$/i;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Rate limit by client IP (see "ratelimits" in wrangler.jsonc). Fails open if the limiter itself errors.
    // Note: Cloudflare's limiter is per location and eventually consistent, so it curbs sustained abuse rather than
    // guaranteeing an exact cap on instantaneous floods.
    if (env.RATE_LIMITER) {
      const ip = request.headers.get('cf-connecting-ip') || 'unknown';
      let allowed = true;
      try { allowed = (await env.RATE_LIMITER.limit({ key: ip })).success; }
      catch (e) { allowed = true; console.error('rate limiter unavailable, allowing request:', e && e.message); }
      if (!allowed) {
        return new Response('Too many requests from this device. Wait a few seconds and try again.', {
          status: 429,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '10', 'Cache-Control': 'no-store' },
        });
      }
    }

    // www → bare domain, and plain http → https, keeping the path and query.
    // One origin means one saved game and one offline cache per device, and service workers need HTTPS.
    // `wrangler dev` rewrites the request host to the first route's zone, so it looks like production; LOCAL_DEV (set in
    // .claude/launch.json) keeps local http from bouncing to the live site.
    const localDev = String(env.LOCAL_DEV ?? '').toLowerCase() === 'true';
    if (REDIRECT_HOSTS.has(url.hostname) || (url.protocol === 'http:' && PROD_HOST.test(url.hostname) && !localDev)) {
      if (REDIRECT_HOSTS.has(url.hostname)) url.hostname = CANONICAL_HOST;
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 301);
    }

    // Google AdSense, gated by ADS_ENABLED. The publisher ID (ADSENSE_CLIENT) and optional display-unit slot
    // (ADSENSE_SLOT) are Worker variables; the page itself never carries Google code while the flag is off.
    const adsOn = String(env.ADS_ENABLED ?? '').trim().toLowerCase() === 'true';
    const client = String(env.ADSENSE_CLIENT ?? '').trim();
    const slot = String(env.ADSENSE_SLOT ?? '').trim();
    const adsActive = adsOn && /^ca-pub-\d+$/.test(client);
    const slotOk = /^\d+$/.test(slot);

    // HTML documents get rewritten below, so their validator must not be the untouched asset's. Otherwise a
    // browser or the service worker holding the un-injected copy would get 304s forever and never see the ads
    // configuration change. Paths without a file extension are the HTML ones (/, and SPA fallbacks like /login).
    const isDocument = !/\.[a-z0-9]+$/i.test(url.pathname);
    let req = request;
    if (adsActive && isDocument) {
      const headers = new Headers(request.headers);
      headers.delete('If-None-Match');
      headers.delete('If-Modified-Since');
      req = new Request(request, { headers });
    }

    let res = await env.ASSETS.fetch(req);
    const type = res.headers.get('Content-Type') || '';
    let adsTag = '';
    if (adsActive && type.includes('text/html')) {
      res = new HTMLRewriter()
        .on('meta[name="ads-enabled"]', { element(el) { el.setAttribute('content', 'true'); } })
        .on('head', {
          element(el) {
            el.append(`<meta name="google-adsense-account" content="${client}">`, { html: true });
            el.append(`<meta name="adsense-client" content="${client}">`, { html: true });
            if (slotOk) el.append(`<meta name="adsense-slot" content="${slot}">`, { html: true });
            el.append(`<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}" crossorigin="anonymous"></script>`, { html: true });
          },
        })
        .transform(res);
      adsTag = fnv1a(`${client}|${slotOk ? slot : ''}`);
    }

    const out = new Response(res.body, res);
    if (adsTag) {
      const etag = (res.headers.get('ETag') || '').replace(/^W\//, '').replace(/"/g, '');
      out.headers.set('ETag', `"${etag || 'html'}-ads-${adsTag}"`);
      out.headers.delete('Last-Modified');
    }
    if (url.pathname === '/sw.js') {
      out.headers.set('Cache-Control', 'no-cache'); // browsers must always check for a newer worker
    } else if (type.includes('text/html')) {
      out.headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
    } else if (url.pathname === '/manifest.webmanifest') {
      out.headers.set('Content-Type', 'application/manifest+json');
      out.headers.set('Cache-Control', 'public, max-age=3600');
    }
    return out;
  },
};

// Short stable hash (FNV-1a, 32-bit) used to vary the HTML ETag with the ads configuration.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
