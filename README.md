# Monopoly Banker

A phone-friendly banker for a physical Monopoly game, for when nobody wants to count paper money and the box
has run out of houses. One player runs it on a phone or tablet; it tracks:

- every player's cash, with pass GO, taxes, fines, card payments, and payments between players;
- who owns each deed, with purchases at list or auction price and trades with cash;
- mortgages, with the 10% interest to lift them;
- houses and hotels, enforcing the full-set, even-build and bank-supply rules (32 houses, 12 hotels);
- rent, calculated from the deed, buildings, full sets, railroads owned, or the dice for utilities;
- the Free Parking pot, with optional house rules (taxes go to the pot, the bank seeds it);
- bankruptcy to the bank or to another player;
- a log of every transaction, with undo.

It runs at **https://shortlineledger.com**. Open it once with a connection and it keeps working offline; on a
phone, add it to the Home Screen to use it like an app. Each device keeps its own game.

## Running it yourself

```bash
npm install
npm run dev        # http://localhost:8787
npm test           # 60 tests: game rules in jsdom, Worker in the Workers runtime
npm run deploy     # to your own Cloudflare account, after `npx wrangler login`
```

The app is a single file, `public/index.html`, served by a small Cloudflare Worker (`src/index.js`) that
handles redirects, cache headers, an optional Google AdSense banner and basic rate limiting.
`wrangler.jsonc` holds the deployment settings: Worker name, custom-domain routes, the ad variables and the rate
limit. To deploy your own copy, change `name`, replace or remove `routes`, and set `ADS_ENABLED` to `"false"`
unless you swap in your own AdSense publisher ID.

For contributors and reviewing agents: `CLAUDE.md` describes the conventions, `REVIEW.md` the test plan.

## Rules

Standard US edition rules are built in, with the house rules people actually play in Settings. The one that
surprises most tables: a hotel costs the deed's house price once more after four houses, and those four houses go
back to the bank. Details are in `REVIEW.md`.

## Trademark

Monopoly is a trademark of Hasbro. This is an unofficial companion for tracking a game you already own. It is not
affiliated with or endorsed by Hasbro and contains no board artwork or logos.
