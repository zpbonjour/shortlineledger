# Review and test guide

This file lets a Claude Code agent test the whole app and review changes with the `pr-review-toolkit` plugin's
`/pr-review-toolkit:review-pr` command (agents: code-reviewer, comment-analyzer, pr-test-analyzer,
silent-failure-hunter, type-design-analyzer, code-simplifier). Read CLAUDE.md first; it holds the conventions the
code-reviewer agent checks against.

## 1. Setup

```bash
npm install
```

Node 20 or newer. Wrangler is a dev dependency, so `npx wrangler …` works without a global install. Tests need no
Cloudflare account; the Worker tests read their bindings from the committed `wrangler.jsonc`. If
`/pr-review-toolkit:review-pr` is not available in the session:

```bash
claude plugin install pr-review-toolkit@claude-plugins-official
```

## 2. Run the suite before reading any code

```bash
npm test
```

Expected: 2 files, 60 tests, green in a few seconds, and the process exits on its own.

| Project | File | Runs in | Covers |
|---|---|---|---|
| `app` | `test/app.test.js` | Node + jsdom loading the real `public/index.html` | Board data, rent, building, mortgages, transfers, taxes, Free Parking, bankruptcy, undo and rollback, persistence and migration, escaping, sheet behavior |
| `worker` | `test/worker.test.js` | Workers runtime (Miniflare) with the bindings from `wrangler.jsonc` | Asset delivery and cache headers, manifest and ads.txt, SPA fallback, http→https and www redirects, `LOCAL_DEV`, AdSense injection and its input validation, ETag variance and 304 handling, rate limiting |

Run one side with `npm run test:app` or `npm run test:worker`. `npm run check` validates the Worker bundle and
config without deploying.

**A failing test blocks the change.** If a test fails because the behavior was intentionally changed, the test
and CLAUDE.md must change in the same PR.

## 3. Running `/review-pr` on this repository

Full pass, all agents at once:

```
/pr-review-toolkit:review-pr all parallel
```

How each aspect applies here:

- **code** (code-reviewer): checks the diff against CLAUDE.md. The rules that matter most: single-file app,
  `commit`/`moveCash` for all state and cash changes, `esc()` on every interpolated user string, integer money
  math, sheet-closing behavior, and migrations for saved state.
- **tests** (pr-test-analyzer): behavioral coverage lives in `test/`. Any rule or Worker behavior touched by a
  change needs a test in the matching file. Section 7 shows the helpers to use.
- **comments** (comment-analyzer): the source files carry explanatory comments; `wrangler.jsonc` is deliberately
  comment-free and is documented in CLAUDE.md instead. Check comments against the code they describe; timings,
  limits and header names drift easily.
- **errors** (silent-failure-hunter): section 5 lists the fallbacks that are deliberate. Anything else that
  swallows an error is a finding.
- **types** (type-design-analyzer): not applicable. The project is plain JavaScript with no type definitions.
  Report "not applicable" rather than proposing a type system.
- **simplify** (code-simplifier): allowed only within the single-file constraint. Do not split the app into
  modules, add a build step, or reformat unrelated code.

Scope: the command reviews `git diff` by default. For a whole-app audit, name the files:
`/pr-review-toolkit:review-pr code errors public/index.html src/index.js public/sw.js`.

Report findings in the command's format (Critical, Important, Suggestions, Strengths) with `file:line` anchors.
Severity guide for this app: wrong money or rule outcome, lost saved game, XSS, or a Worker serving the wrong
variant is **Critical**; a confusing flow at the table, a stale comment that misleads, or a missing test for
changed logic is **Important**; everything else is a Suggestion.

## 4. Manual verification in a browser

Use this when a change touches layout, animation, the service worker, or ads, which the tests cannot see.

Start a server from `.claude/launch.json` (both pass `LOCAL_DEV` so plain http is not redirected):

- `monopoly-banker` on http://localhost:8787 — ads flag on, no ad unit, so no banner.
- `monopoly-banker-ads` on http://localhost:8788 — simulates a configured ad unit; the bottom banner renders.

Do not run both from one `.wrangler/state` directory; the second config already uses `--persist-to .wrangler/state-ads`.

The page exposes `window.__monopolyBanker` (see the Test hook section at the end of `public/index.html`). Useful
checks from the browser console or a JavaScript tool:

```js
const B = window.__monopolyBanker;
B.getState().players.map(p => [p.name, p.cash]);          // balances
B.getState().pot;                                         // Free Parking
B.supply();                                               // { housesLeft, hotelsLeft }
B.ui.sheet;                                               // null when no sheet is open
document.querySelectorAll('.fx-pill, .fx-delta').length;  // money animation elements in flight
(await caches.keys());                                    // ['mb-shell-<version>', 'mb-fonts-v1'] once the SW installed
(await navigator.serviceWorker.getRegistration())?.active?.state;
```

Checklist:

1. **Setup** — open the page with empty storage: the New game sheet appears with four editable names, starting
   cash, and the House rules toggles; the close button is absent until a game exists.
2. **Payment flow** — tap a player, Pay rent, pick a property tile, pay. The sheet must close first, then the
   pill flies from payer to recipient with −/+ labels (about 1s flight). The toast offers Undo; tapping it shows
   a confirmation with the action's text.
3. **Building** — Build & mortgage sheet: step a house up and down on a long list; the list must not jump to the
   top. Hotel appears only when all lots in the set have four houses. The stats bar's houses/hotels count changes.
4. **Free Parking** — tap the Free Parking stat: one tile per player, none selected, payout disabled until a tap.
5. **Properties tab** — street rows tinted with their color; railroads and utilities on a plain surface with an icon.
6. **Undo** — header Undo button asks for confirmation before reverting.
7. **Offline** — load once, stop the dev server, reload: the page must come back with the game intact. Restart the
   server, edit `public/index.html` trivially, reload twice: the "newer version" toast appears on the first reload.
8. **Ads** — on :8788 the banner shows an `ins.adsbygoogle` with client and slot, `body.has-ads` is set, and
   `--adbar-h` matches the banner height. On :8787 the banner stays hidden and the head contains the AdSense
   script and `google-adsense-account` meta.
9. **Responsive** — at 375px wide the action grid is two columns and stat labels wrap; at 768px and up controls
   and type are larger. No horizontal page scroll at any width.
10. **Dark mode** — toggle the color scheme: every surface, text, tint and the banner follow the tokens.

## 5. Deliberate fallbacks (not defects)

The silent-failure-hunter should evaluate these against their stated intent rather than flag them outright.

| Where | Behavior | Why it is intentional |
|---|---|---|
| `src/index.js` rate limiter `catch` | Allows the request and logs `console.error` | A limiter outage must not take a public, low-value site offline. Logged so `wrangler tail` shows it. |
| `src/index.js` AdSense injection | Injects nothing when `ADSENSE_CLIENT` or `ADSENSE_SLOT` fails validation; `ads-enabled` stays `false` | Fail closed against a misconfigured or hostile variable. Covered by tests. A log line would be a reasonable suggestion. |
| `public/sw.js` install `catch` | Skips a shell file that fails to fetch | Installing while offline must not break the worker; the file is fetched on the next visit. |
| `public/sw.js` `shell()` and `cacheFirst()` `catch` | Return the offline page (503) or an empty 504 | The whole point of the worker is to degrade gracefully offline. |
| `public/index.html` `load()`/`save()` `try/catch` | Corrupt or unavailable storage yields a fresh game; save failures are ignored | Private browsing and quota errors must not crash the banker mid-game. Tested ("survives corrupt saved data"). |
| `public/index.html` `commit()` `catch` | Rolls state back and shows the error text as a toast | This is a visible failure, not a silent one. |
| `public/index.html` `renderSheet()` `catch` | Logs and closes the sheet | Defensive against an impossible sheet state; the user sees the sheet close. |
| `public/index.html` `playMoneyFx` early returns | No animation when a sheet is open or Web Animations are missing | Cosmetic layer only; money already moved. |

## 6. Rules reference

Each row names the function that implements it and the test that pins it.

| Rule (standard US edition) | Implementation | Test |
|---|---|---|
| 28 deeds totalling $5,690; printed prices, rents, house costs | `PROPS` | "board data" |
| Unimproved lot rents double when one player owns the set | `rentInfo` | "charges base rent … double for a full set" |
| Mortgaged lot collects nothing; siblings still double | `rentInfo` | "collects nothing on a mortgaged property" |
| Railroads 25/50/100/200 by count; utilities 4× / 10× dice | `rentInfo` | "scales railroad rent", "charges 4x the dice" |
| Build only with the full set and no mortgaged lot in it | `buildCheck` | "requires the whole color set", "blocks building while any lot … mortgaged" |
| Even building and selling (max one level apart) | `buildCheck` | "enforces even building and selling" |
| Houses cost the deed price per step; sell for half | `doSetLevel` | "charges the house price per step" |
| Hotel = one more step after four houses; returns four houses to the bank | `doSetLevel`, `supply` | "prices a hotel as one more house step" |
| Bank supply 32 houses / 12 hotels (toggle) | `supply`, `buildCheck` | "respects the bank supply" |
| Mortgage pays half price; lifting costs that plus 10% rounded up | `mortgageValue`, `interestOn`, `unmortgageCost` | "mortgages at half price", "pays out the mortgage value" |
| No mortgage while the set has buildings; no transfer with buildings | `mortgageCheck`, `doTransfer` | "refuses to mortgage", "refuses to transfer" |
| Mortgaged deed changing hands charges new owner 10% (toggle) | `doTransfer`, `doBankrupt` | "transfers a property for cash" |
| Bankruptcy to a player: cash, deeds, and building sale proceeds go to the creditor | `doBankrupt` | "hands everything to a player creditor" |
| Bankruptcy to the bank: deeds return unmortgaged and empty | `doBankrupt` | "returns everything to the bank" |
| Income tax 10% base = cash + deeds (mortgage value if mortgaged) + buildings | `netWorth` | "bases the 10% income tax" |
| GO salary, luxury tax $75, jail fine $50 defaults | `defaultSettings` | "starts everyone with the chosen cash" |
| No overdraft unless "allow negative cash" | `canPay` | "refuses rent the payer cannot cover" |
| House rules: taxes to Free Parking, bank seeds the pot | `doPayBank`, `doCollectPot` | "routes taxes to the pot", "seeds Free Parking" |
| Saved games from before the luxury-tax fix migrate $100 → $75 | `load()` | "migrates saved games" |

## 7. Adding tests

`test/app.test.js` helpers: `boot({ names, cash, potRule, storage })` loads the page (pass `storage` to simulate a
returning device); `S(B)` is the state; `P(B, i)` a player; `prop(B, id)` a deed; `give(B, pid, ids, level)`
hands a set to a player; `snapshot(B)` copies state for migration tests. Call the same `do…` functions the UI
calls and assert on state, `B.ui.sheet`, the log, or the DOM.

`test/worker.test.js` helpers: `req(path, init)` builds a request with a unique client IP per test so the rate
limiter never bleeds across tests (pass your own `cf-connecting-ip` to share one); `withVars({...})` overrides
Worker variables per call via `worker.fetch(request, env)`; `SELF.fetch` uses the variables from `wrangler.jsonc`.

## 8. Security checklist

- Every user string rendered via `innerHTML` passes through `esc()`, in text and attribute positions. The
  "escapes player names" test uses an `<img onerror>` payload.
- The Worker injects only a publisher ID matching `^ca-pub-\d+$` and a slot matching `^\d+$`.
- The Worker varies the document ETag with the ads configuration and strips conditional request headers on
  documents, so no cache can pin a stale variant.
- There is no CSP. Adding one must allow inline script and style (single-file app), Google Fonts, and the
  AdSense hosts; weigh that before proposing it.
- Threat model is a public tool with no accounts: abuse and cost (rate limit), XSS through names (escaping), and
  wrong ad configuration (validation). There is no server-side data to leak.

## 9. Deploy verification and rollback (humans only; reviewers do not deploy)

```bash
npm test && npm run check && npm run deploy
```

Then:

```bash
curl -sI https://shortlineledger.com/ | grep -iE '^(HTTP|cache-control)'
curl -sI https://www.shortlineledger.com/ | grep -iE '^(HTTP|location)'
curl -sI http://shortlineledger.com/ | grep -iE '^(HTTP|location)'
curl -sI https://shortlineledger.com/sw.js | grep -iE '^(HTTP|cache-control)'
curl -s https://shortlineledger.com/ | grep -c adsbygoogle.js
```

Roll back with `npx wrangler rollback`; list versions with `npx wrangler versions list`; watch live requests
with `npx wrangler tail monopoly-banker`. Devices pick up a deploy on their second load or through the in-app
"newer version" prompt.

## 10. Known limitations (do not report as bugs)

- One game per device; no multi-device sync.
- No Chance or Community Chest card engine, no jail or dice tracking; the banker records money and deeds only.
- Auctions are handled by editing the purchase price.
- Cloudflare's rate limiter is per location and eventually consistent.
- Documents never answer 304 while ads are enabled (by design, see section 8).
- The service worker shows the previous version once after a deploy.
- Home Screen installs keep storage separate from the browser.
- The site is public by design; there is no login.
