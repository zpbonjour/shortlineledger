# Monopoly Banker

A banker for a physical Monopoly game: one web page tracks every player's cash, who owns each deed, mortgages,
houses and hotels (with the bank's 32/12 supply), the Free Parking pot, rent, bankruptcies and an undo history.
It is public (no accounts), installable as a Home Screen app, and works offline once loaded. Each device keeps
its own game in `localStorage`. A small Cloudflare Worker serves it, redirects hostnames, injects Google AdSense
when enabled, and rate-limits abuse.

Live: https://shortlineledger.com (www redirects to the bare domain). REVIEW.md is the testing and review guide.

## Commands

| Task | Command |
|---|---|
| Run every test (must be green before any deploy) | `npm test` |
| Only the game-rule tests (jsdom) / only the Worker tests (Miniflare) | `npm run test:app` / `npm run test:worker` |
| Local dev server on :8787 | `npm run dev` |
| Validate config and bundle without deploying | `npm run check` |
| Deploy (only when the user asks) | `npm run deploy` |

When driving the Browser pane, start servers from `.claude/launch.json`: `monopoly-banker` (:8787) and
`monopoly-banker-ads` (:8788, simulates a configured ad unit). Both pass `--var LOCAL_DEV:true`; see Gotchas.

## Layout

- `public/index.html` — the entire app: CSS, markup and one JavaScript IIFE, in sections marked `/* ---------- Name ---------- */`
  (Board data, State, Helpers, Commit / undo, Game actions, Rendering, Money movement effects, Sheets, Events,
  Toast, Offline, Ads, Boot, Test hook). No build step, no framework, no bundler.
- `public/sw.js` — service worker. Serves the shell from cache and refreshes it in the background; posts
  `app-updated` so the page can offer a reload. Bump `VERSION` when a deploy must force a fresh precache.
- `public/manifest.webmanifest`, `public/icon*.png`, `public/icon.svg`, `public/apple-touch-icon.png` — install metadata.
  `public/icon-square.svg` is the source for the PNGs (rendered with macOS `qlmanage -t -s 512`, resized with `sips`).
- `public/ads.txt` — AdSense publisher declaration.
- `src/index.js` — the Worker, in request order: rate limit, redirects, asset fetch, AdSense injection, cache headers.
- `wrangler.jsonc` — Worker config, kept comment-free on purpose; this is its documentation. `routes` attaches the
  two custom domains (Cloudflare provisions DNS and certificates). `workers_dev` is `false`, so the custom domain
  is the only address. `assets` serves `./public` with `run_worker_first` (every request passes through the
  Worker) and `single-page-application` fallback (unknown paths get the app). `vars`: `ADS_ENABLED` master
  switch, `ADSENSE_CLIENT` public publisher ID, `ADSENSE_SLOT` numeric Display ad unit or `""`. `ratelimits`
  defines `RATE_LIMITER` at 60 requests per 10 seconds per key. Nothing in the file is secret.
- `test/app.test.js`, `test/worker.test.js`, `vitest.config.js` — see REVIEW.md.

## Conventions the code follows (reviewers: check these)

- **Single file, plain JavaScript.** The app must keep working when opened as one HTML file. Do not split it
  into modules, add a build step, or pull in a framework. The only external resources are the Google Fonts
  stylesheet and, when enabled, the AdSense script the Worker injects.
- **Every state change goes through `commit(message, fn)`.** `fn` validates first and returns an error string to
  abort (state rolls back and the message is shown as an error toast); otherwise it mutates `state`. Each commit
  pushes an undo snapshot, prepends a log entry, saves, re-renders, and queues the money animation.
- **Cash moves only through `moveCash(from, to, amount)`**, where each side is `'bank'`, `'pot'` or a player id.
  That is what the animation queue and the log rely on.
- **Rendering is string templates into `innerHTML`.** Every user-controlled string (player names, notes) goes
  through `esc()`, including inside attributes. Numbers render through `money()`.
- **Money is integer dollars.** Percentages use integer division (`interestOn` is the model); never `x * 0.1`,
  which mis-rounds (70 × 0.1 = 7.000000000000001).
- **Sheets** (the modal stack) open with `openSheet`, go back with `back`, and close entirely with `closeSheet`.
  A successful money action closes the whole stack (`commit(...) && closeSheet()`) so the effect plays over the
  board. Building, selling, mortgaging and lifting mortgages keep their sheet open; effects are skipped while a
  sheet is open. Re-rendering a sheet must preserve its scroll position.
- **Saved games are sacred.** The `localStorage` key `monopoly-banker-v1` and the state shape may only change
  with a migration in `load()`: bump `SETTINGS_VERSION`, and only rewrite values that still equal the old default.
- **Copy** is plain and specific. Controls say what happens; error toasts say what to do next.
- **Comments explain why**, stay accurate, and never contain personal details. Reviewers may run the
  comment-analyzer on them.
- **No secrets in the repo.** The only ad credential is the public AdSense publisher ID, which every served page
  already exposes.

## Rules the app encodes (standard US edition)

Rent doubles on an unimproved lot when one player owns the whole color set; mortgaged lots collect nothing;
railroads pay 25/50/100/200 by count owned; utilities pay 4× or 10× the dice; houses cost the deed's house price
per step and sell back for half; a hotel is one more step after four houses and returns those four houses to the
bank; building needs the full set, no mortgaged lot in the set, even building, and bank supply (32 houses, 12
hotels, toggleable); mortgage pays half the price, lifting costs that plus 10% rounded up; a mortgaged deed that
changes hands charges the new owner 10% (toggleable); bankruptcy to a player transfers everything with buildings
sold to the bank for the creditor, bankruptcy to the bank returns everything unmortgaged. House rules live in
Settings: taxes to Free Parking, bank seeds the pot, allow negative cash. The full table is in REVIEW.md.

## Gotchas

- `wrangler dev` rewrites the request host to the first route's zone (`shortlineledger.com`), so the Worker's
  http→https redirect would loop locally. `LOCAL_DEV=true` disables that redirect; the launch configs and tests
  set it. Two dev servers at once need separate `--persist-to` directories or workerd fails with a SQLite lock.
- `compatibility_date` must not exceed what `@cloudflare/vitest-pool-workers` bundles; the test run prints the
  newest supported date if it does. Wrangler itself may support a newer one.
- Rewritten HTML must not carry the untouched asset's `ETag`. The Worker strips conditional headers on document
  requests and appends `-ads-<hash>` to the ETag when it injects ads; otherwise caches keep the old variant. In
  production Cloudflare's edge may drop the ETag entirely, in which case the service worker compares bodies.
- The service worker shows the cached page first. A change appears on the second load or via the "newer
  version" toast. When checking in a browser, reload twice.
- Cloudflare's rate limiter is per location and eventually consistent; instantaneous floods can pass. Tests
  assert its behavior in Miniflare only.
- A Home Screen install has its own storage, separate from the browser's saved game.
- `workers_dev` is `false`: the app is served only at the custom domain. Games saved on the earlier workers.dev
  address live in that origin's storage and are not reachable from shortlineledger.com.

## Do not

- Add a login, secret, or account system; the app is intentionally public.
- Deploy from a review, or with `npm test` failing.
- Rename the storage key or reshape saved state without a migration.
- Reformat the whole of `public/index.html`; keep diffs local so reviews stay readable.
