// Integration tests for the Cloudflare Worker in src/index.js, run inside the Workers runtime.
// `SELF` is the Worker as configured by wrangler.jsonc; calling `worker.fetch` directly lets a test
// override variables (ads flag, publisher ID, slot, LOCAL_DEV) per case.
import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index.js';

const ORIGIN = 'https://shortlineledger.com';
let ipCounter = 0;
// Every test gets its own client IP so the rate limiter's shared counter never leaks between tests.
function req(path, init = {}) {
  const headers = new Headers(init.headers || {});
  if (!headers.has('cf-connecting-ip')) headers.set('cf-connecting-ip', `203.0.113.${++ipCounter % 250}`);
  return new Request(path.startsWith('http') ? path : ORIGIN + path, { ...init, headers });
}
const withVars = (vars) => ({ ...env, ...vars });

describe('static app delivery', () => {
  it('serves the app at the root with revalidating cache headers', async () => {
    const res = await SELF.fetch(req('/'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/text\/html/);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
    const html = await res.text();
    expect(html).toContain('<title>Monopoly Banker</title>');
    expect(html).toContain('serviceWorker.register');
  });

  it('serves the service worker with no-cache so browsers always check for a newer one', async () => {
    const res = await SELF.fetch(req('/sw.js'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(await res.text()).toContain("addEventListener('fetch'");
  });

  it('serves the manifest with the manifest media type', async () => {
    const res = await SELF.fetch(req('/manifest.webmanifest'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/manifest+json');
    const manifest = await res.json();
    expect(manifest.name).toBe('Monopoly Banker');
    expect(manifest.display).toBe('standalone');
  });

  it('serves ads.txt naming the publisher', async () => {
    const res = await SELF.fetch(req('/ads.txt'));
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/^google\.com, pub-\d+, DIRECT, f08c47fec0942fa0/);
  });

  it('falls back to the app for unknown paths such as old bookmarks', async () => {
    const res = await SELF.fetch(req('/login'));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>Monopoly Banker</title>');
  });
});

describe('redirects', () => {
  it('sends plain http to https on production hosts', async () => {
    const res = await SELF.fetch(req('http://shortlineledger.com/'), { redirect: 'manual' });
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://shortlineledger.com/');
  });

  it('sends www to the bare domain keeping path and query', async () => {
    const res = await SELF.fetch(req('https://www.shortlineledger.com/settings?x=1'), { redirect: 'manual' });
    expect(res.status).toBe(301);
    expect(res.headers.get('Location')).toBe('https://shortlineledger.com/settings?x=1');
  });

  it('does not redirect http when LOCAL_DEV is set (wrangler dev rewrites the host)', async () => {
    const res = await worker.fetch(req('http://shortlineledger.com/'), withVars({ LOCAL_DEV: 'true' }));
    expect(res.status).toBe(200);
  });

  it('leaves unknown hosts alone', async () => {
    const res = await worker.fetch(req('http://127.0.0.1:8787/'), env);
    expect(res.status).toBe(200);
  });
});

describe('AdSense injection', () => {
  const CLIENT = 'ca-pub-3792530599153007';

  it('injects the script and account meta when ads are on and no slot is set', async () => {
    const html = await (await worker.fetch(req('/'), withVars({ ADS_ENABLED: 'true', ADSENSE_CLIENT: CLIENT, ADSENSE_SLOT: '' }))).text();
    expect(html).toContain('<meta name="ads-enabled" content="true">');
    expect(html).toContain(`<meta name="google-adsense-account" content="${CLIENT}">`);
    expect(html).toContain(`<meta name="adsense-client" content="${CLIENT}">`);
    expect(html).toContain(`adsbygoogle.js?client=${CLIENT}`);
    expect(html).not.toContain('<meta name="adsense-slot"'); // the page's own script mentions the tag name; only the injected meta counts
  });

  it('adds the slot meta when a numeric slot is configured', async () => {
    const html = await (await worker.fetch(req('/'), withVars({ ADS_ENABLED: 'true', ADSENSE_CLIENT: CLIENT, ADSENSE_SLOT: '1234567890' }))).text();
    expect(html).toContain('<meta name="adsense-slot" content="1234567890">');
  });

  it('injects nothing when the flag is off', async () => {
    const res = await worker.fetch(req('/'), withVars({ ADS_ENABLED: 'false', ADSENSE_CLIENT: CLIENT }));
    const html = await res.text();
    expect(html).toContain('<meta name="ads-enabled" content="false">');
    expect(html).not.toContain('googlesyndication');
    expect(html).not.toContain('google-adsense-account');
    expect(res.headers.get('ETag') || '').not.toContain('-ads-');
  });

  it('rejects a malformed publisher ID instead of injecting it', async () => {
    const html = await (await worker.fetch(req('/'), withVars({ ADS_ENABLED: 'true', ADSENSE_CLIENT: '<script>alert(1)</script>' }))).text();
    expect(html).not.toContain('alert(1)');
    expect(html).not.toContain('googlesyndication');
    expect(html).toContain('<meta name="ads-enabled" content="false">');
  });

  it('ignores a non-numeric slot', async () => {
    const html = await (await worker.fetch(req('/'), withVars({ ADS_ENABLED: 'true', ADSENSE_CLIENT: CLIENT, ADSENSE_SLOT: '"><script>' }))).text();
    expect(html).not.toContain('<meta name="adsense-slot"'); // the page's own script mentions the tag name; only the injected meta counts
  });

  it('varies the HTML ETag with the ads configuration and never answers a document with 304', async () => {
    const on = await worker.fetch(req('/'), withVars({ ADS_ENABLED: 'true', ADSENSE_CLIENT: CLIENT, ADSENSE_SLOT: '' }));
    const onSlot = await worker.fetch(req('/'), withVars({ ADS_ENABLED: 'true', ADSENSE_CLIENT: CLIENT, ADSENSE_SLOT: '1234567890' }));
    const off = await worker.fetch(req('/'), withVars({ ADS_ENABLED: 'false' }));
    const [eOn, eSlot, eOff] = [on, onSlot, off].map((r) => r.headers.get('ETag'));
    expect(eOn).toContain('-ads-');
    expect(eSlot).toContain('-ads-');
    expect(eOn).not.toBe(eSlot);
    expect(eOff).toBeTruthy();
    expect(eOn).not.toBe(eOff);
    expect(on.headers.get('Last-Modified')).toBeNull();

    // A client holding the un-injected copy must get a full 200, not a 304 that would keep the stale page.
    const stale = await worker.fetch(req('/', { headers: { 'If-None-Match': eOff } }), withVars({ ADS_ENABLED: 'true', ADSENSE_CLIENT: CLIENT }));
    expect(stale.status).toBe(200);
  });

  it('still lets non-document assets answer conditional requests with 304', async () => {
    const first = await SELF.fetch(req('/icon.svg'));
    const etag = first.headers.get('ETag');
    expect(etag).toBeTruthy();
    const second = await SELF.fetch(req('/icon.svg', { headers: { 'If-None-Match': etag } }));
    expect(second.status).toBe(304);
  });
});

describe('rate limiting', () => {
  it('has the RATE_LIMITER binding configured', () => {
    expect(env.RATE_LIMITER).toBeDefined();
  });

  it('returns 429 with Retry-After once one client exceeds 60 requests in the window', async () => {
    const ip = '198.51.100.7';
    const statuses = [];
    for (let i = 0; i < 75; i++) {
      const res = await SELF.fetch(req('/ads.txt', { headers: { 'cf-connecting-ip': ip } }));
      statuses.push(res.status);
      if (res.status === 429) {
        expect(res.headers.get('Retry-After')).toBe('10');
        expect(await res.text()).toMatch(/Too many requests/);
      }
    }
    expect(statuses.filter((s) => s === 200).length).toBeGreaterThanOrEqual(55);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    expect(statuses.slice(-5).every((s) => s === 429)).toBe(true);
  });

  it('keeps other clients unaffected by one client being limited', async () => {
    const res = await SELF.fetch(req('/ads.txt', { headers: { 'cf-connecting-ip': '198.51.100.8' } }));
    expect(res.status).toBe(200);
  });
});
