// Game-rule and state tests for public/index.html.
// The real page is loaded into jsdom and driven through the `window.__monopolyBanker` test hook, so these
// tests exercise the same functions the UI calls. No network access: the Google Fonts stylesheet is not fetched.
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it } from 'vitest';

const HTML = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

const STORAGE_KEY = 'monopoly-banker-v1';

// Boot the page. `storage` (an object or a raw string) is placed in localStorage before the page script runs,
// exactly as a returning device would have it; otherwise a fresh game is started with the given players.
function boot({ names = ['Ann', 'Ben', 'Cal', 'Dee'], cash = 1500, potRule = true, storage } = {}) {
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://banker.test/',
    beforeParse(w) {
      if (storage !== undefined) w.localStorage.setItem(STORAGE_KEY, typeof storage === 'string' ? storage : JSON.stringify(storage));
    },
  });
  const { window } = dom;
  if (storage === undefined) {
    window.__monopolyBanker.newGame(names, cash, { potRule, potSeed: 0 });
    window.__monopolyBanker.closeSheet();
    window.__monopolyBanker.render();
  }
  return { B: window.__monopolyBanker, window, document: window.document };
}
const snapshot = (B) => ({ state: JSON.parse(JSON.stringify(B.getState())), history: [] });
const S = (B) => B.getState();
const P = (B, i) => S(B).players[i];
const prop = (B, id) => S(B).props[id];

// Hand a full color set (optionally with buildings) to a player without spending cash.
function give(B, pid, ids, level = 0) {
  for (const id of ids) Object.assign(prop(B, id), { owner: pid, level, mortgaged: false });
}
const BROWN = ['med', 'bal'];
const LIGHTBLUE = ['ori', 'ver', 'con'];
const DARKBLUE = ['park', 'bw'];
const RAILROADS = ['rr1', 'rr2', 'rr3', 'rr4'];

describe('board data (standard US edition)', () => {
  let B;
  beforeEach(() => ({ B } = boot()));

  it('has 28 purchasable properties totalling $5,690', () => {
    expect(B.PROPS).toHaveLength(28);
    expect(B.PROPS.reduce((sum, p) => sum + p.price, 0)).toBe(5690);
    expect(B.PROPS.filter((p) => p.type === 'street')).toHaveLength(22);
    expect(B.PROPS.filter((p) => p.type === 'rr')).toHaveLength(4);
    expect(B.PROPS.filter((p) => p.type === 'util')).toHaveLength(2);
  });

  it('matches the printed title deeds for a sample of properties', () => {
    const by = Object.fromEntries(B.PROPS.map((p) => [p.id, p]));
    expect(by.med).toMatchObject({ price: 60, rent: [2, 10, 30, 90, 160, 250], house: 50 });
    expect(by.ver).toMatchObject({ price: 100, rent: [6, 30, 90, 270, 400, 550], house: 50 });
    expect(by.ny).toMatchObject({ price: 200, rent: [16, 80, 220, 600, 800, 1000], house: 100 });
    expect(by.ill).toMatchObject({ price: 240, rent: [20, 100, 300, 750, 925, 1100], house: 150 });
    expect(by.pa).toMatchObject({ price: 320, rent: [28, 150, 450, 1000, 1200, 1400], house: 200 });
    expect(by.bw).toMatchObject({ price: 400, rent: [50, 200, 600, 1400, 1700, 2000], house: 200 });
    expect(by.rr1.price).toBe(200);
    expect(by.ele.price).toBe(150);
  });

  it('prices houses by color group: 50/50, 100/100, 150/150, 200/200', () => {
    const cost = (g) => new Set(B.PROPS.filter((p) => p.group === g).map((p) => p.house));
    expect([...cost('brown')]).toEqual([50]);
    expect([...cost('lightblue')]).toEqual([50]);
    expect([...cost('pink')]).toEqual([100]);
    expect([...cost('orange')]).toEqual([100]);
    expect([...cost('red')]).toEqual([150]);
    expect([...cost('yellow')]).toEqual([150]);
    expect([...cost('green')]).toEqual([200]);
    expect([...cost('darkblue')]).toEqual([200]);
  });

  it('mortgages at half price and lifts at mortgage plus 10%, rounded up', () => {
    const by = Object.fromEntries(B.PROPS.map((p) => [p.id, p]));
    expect(B.mortgageValue(by.bw)).toBe(200);
    expect(B.unmortgageCost(by.bw)).toBe(220);
    expect(B.mortgageValue(by.park)).toBe(175);
    expect(B.unmortgageCost(by.park)).toBe(193); // 192.5 rounds up
    expect(B.unmortgageCost(by.ele)).toBe(83); // 82.5 rounds up
  });
});

describe('new game and settings', () => {
  it('starts everyone with the chosen cash and standard defaults', () => {
    const { B } = boot({ names: ['Ann', 'Ben'], cash: 2000 });
    expect(S(B).players.map((p) => p.cash)).toEqual([2000, 2000]);
    expect(S(B).settings).toMatchObject({ goSalary: 200, incomeTax: 200, luxuryTax: 75, jailFine: 50, potRule: true, potSeed: 0, enforceSupply: true, evenBuild: true });
    expect(S(B).pot).toBe(0);
    expect(S(B).turn).toBe('p1');
  });

  it('seeds Free Parking from the bank when the house rule is on', () => {
    const { B } = boot();
    S(B).settings.potSeed = 50;
    S(B).pot = 0;
    B.doCollectPot('p1'); // nothing to collect
    expect(S(B).pot).toBe(0);
    S(B).pot = 120;
    B.doCollectPot('p2');
    expect(P(B, 1).cash).toBe(1620);
    expect(S(B).pot).toBe(50); // refilled by the bank after the payout
  });

  it('migrates saved games from before the luxury tax fix ($100 -> $75)', () => {
    const { B } = boot();
    const saved = snapshot(B);
    saved.state.settings.luxuryTax = 100;
    delete saved.state.settingsV;
    const { B: B2 } = boot({ storage: saved });
    expect(S(B2).settings.luxuryTax).toBe(75);
    expect(S(B2).settingsV).toBe(2);
  });

  it('leaves a deliberately customised luxury tax alone during migration', () => {
    const { B } = boot();
    const saved = snapshot(B);
    saved.state.settings.luxuryTax = 150;
    delete saved.state.settingsV;
    const { B: B2 } = boot({ storage: saved });
    expect(S(B2).settings.luxuryTax).toBe(150);
  });
});

describe('rent', () => {
  let B;
  beforeEach(() => ({ B } = boot()));

  it('charges base rent on a lone unimproved lot and double for a full set', () => {
    prop(B, 'med').owner = 'p1';
    expect(B.rentInfo('med', 0).amount).toBe(2);
    give(B, 'p1', BROWN);
    expect(B.rentInfo('med', 0).amount).toBe(4);
    expect(B.rentInfo('bal', 0).amount).toBe(8);
  });

  it('uses the house and hotel columns once built', () => {
    give(B, 'p1', DARKBLUE, 0);
    prop(B, 'bw').level = 3;
    expect(B.rentInfo('bw', 0).amount).toBe(1400);
    prop(B, 'bw').level = 5;
    expect(B.rentInfo('bw', 0).amount).toBe(2000);
  });

  it('collects nothing on a mortgaged property', () => {
    give(B, 'p1', BROWN);
    prop(B, 'bal').mortgaged = true;
    expect(B.rentInfo('bal', 0).amount).toBe(0);
    expect(B.rentInfo('med', 0).amount).toBe(4); // the sibling still doubles: ownership of the set is intact
  });

  it('scales railroad rent 25/50/100/200 by railroads owned', () => {
    const expected = [25, 50, 100, 200];
    RAILROADS.forEach((id, i) => {
      prop(B, id).owner = 'p1';
      expect(B.rentInfo('rr1', 0).amount).toBe(expected[i]);
    });
  });

  it('charges 4x the dice for one utility and 10x for both', () => {
    prop(B, 'ele').owner = 'p1';
    expect(B.rentInfo('ele', 7)).toMatchObject({ amount: 28, needsDice: true });
    prop(B, 'wat').owner = 'p1';
    expect(B.rentInfo('ele', 7).amount).toBe(70);
    expect(B.rentInfo('ele', 0).amount).toBe(0); // no roll entered yet
  });

  it('moves cash from payer to owner and closes the sheet', () => {
    give(B, 'p2', ['ny', 'stj', 'ten']);
    B.openSheet('player', { pid: 'p1' });
    B.openSheet('rent', { pid: 'p1' });
    expect(B.doPayRent('p1', 'ny', 0)).toBeUndefined();
    expect(P(B, 0).cash).toBe(1468); // 16 doubled for the full orange set
    expect(P(B, 1).cash).toBe(1532);
    expect(B.ui.sheet).toBeNull();
    expect(S(B).log[0].msg).toMatch(/paid \$32 rent to Ben for New York Avenue/);
  });

  it('refuses rent the payer cannot cover unless debt is allowed', () => {
    give(B, 'p2', DARKBLUE, 5);
    P(B, 0).cash = 100;
    B.doPayRent('p1', 'bw', 0);
    expect(P(B, 0).cash).toBe(100);
    expect(P(B, 1).cash).toBe(1500);
    S(B).settings.allowDebt = true;
    B.doPayRent('p1', 'bw', 0);
    expect(P(B, 0).cash).toBe(-1900);
  });
});

describe('building', () => {
  let B;
  beforeEach(() => ({ B } = boot()));

  it('requires the whole color set before the first house', () => {
    prop(B, 'ori').owner = 'p1';
    expect(B.buildCheck('ori', 1)).toMatch(/must own every Light Blue property/);
    give(B, 'p1', LIGHTBLUE);
    expect(B.buildCheck('ori', 1)).toBeNull();
  });

  it('enforces even building and selling', () => {
    give(B, 'p1', LIGHTBLUE);
    B.doSetLevel('ori', 1);
    expect(B.buildCheck('ori', 2)).toMatch(/Build evenly/);
    B.doSetLevel('ver', 1);
    B.doSetLevel('con', 1);
    expect(B.buildCheck('ori', 2)).toBeNull();
    B.doSetLevel('ori', 2);
    expect(B.buildCheck('ver', 0)).toMatch(/Sell evenly/);
    S(B).settings.evenBuild = false;
    expect(B.buildCheck('ver', 0)).toBeNull();
  });

  it('charges the house price per step and refunds half when selling', () => {
    give(B, 'p1', BROWN);
    B.doSetLevel('med', 1);
    expect(P(B, 0).cash).toBe(1450);
    B.doSetLevel('med', 0);
    expect(P(B, 0).cash).toBe(1475);
  });

  it('prices a hotel as one more house step and returns four houses to the bank', () => {
    give(B, 'p1', LIGHTBLUE, 4);
    const before = B.supply();
    expect(before.housesLeft).toBe(32 - 12);
    B.doSetLevel('ver', 5);
    expect(P(B, 0).cash).toBe(1450); // $50 for the hotel on Vermont Avenue
    expect(prop(B, 'ver').level).toBe(5);
    expect(B.supply()).toEqual({ housesLeft: 32 - 8, hotelsLeft: 11 });
    B.doSetLevel('ver', 4); // selling the hotel back gives half its price and needs four houses from the bank
    expect(P(B, 0).cash).toBe(1475);
    expect(B.supply()).toEqual({ housesLeft: 32 - 12, hotelsLeft: 12 });
  });

  it('blocks building while any lot in the set is mortgaged', () => {
    give(B, 'p1', BROWN);
    prop(B, 'bal').mortgaged = true;
    expect(B.buildCheck('med', 1)).toMatch(/mortgaged/);
  });

  it('respects the bank supply of 32 houses and 12 hotels, and the toggle that lifts it', () => {
    // 22 streets: all owned by p1, so supply is the only constraint left.
    for (const p of B.PROPS.filter((q) => q.type === 'street')) Object.assign(prop(B, p.id), { owner: 'p1', level: 0 });
    P(B, 0).cash = 1e9;
    S(B).settings.evenBuild = false;
    const streets = B.PROPS.filter((q) => q.type === 'street').map((q) => q.id);
    for (const id of streets.slice(0, 8)) prop(B, id).level = 4; // 32 houses in play
    expect(B.supply().housesLeft).toBe(0);
    expect(B.buildCheck(streets[8], 1)).toMatch(/out of houses/);
    for (const id of streets.slice(0, 12)) prop(B, id).level = 5; // 12 hotels in play
    expect(B.buildCheck(streets[12], 5)).toMatch(/out of hotels/);
    S(B).settings.enforceSupply = false;
    expect(B.buildCheck(streets[12], 5)).toBeNull();
  });

  it('will not let a player build with cash they do not have', () => {
    give(B, 'p1', DARKBLUE);
    P(B, 0).cash = 150;
    expect(B.buildCheck('bw', 1)).toMatch(/needs \$200/);
  });
});

describe('mortgages and transfers', () => {
  let B;
  beforeEach(() => ({ B } = boot()));

  it('pays out the mortgage value and charges 10% interest to lift it', () => {
    give(B, 'p1', DARKBLUE);
    B.doMortgage('bw');
    expect(P(B, 0).cash).toBe(1700);
    expect(prop(B, 'bw').mortgaged).toBe(true);
    B.doUnmortgage('bw');
    expect(P(B, 0).cash).toBe(1480);
    expect(prop(B, 'bw').mortgaged).toBe(false);
  });

  it('refuses to mortgage while the set has buildings', () => {
    give(B, 'p1', BROWN, 1);
    expect(B.mortgageCheck('med')).toMatch(/Sell all buildings/);
  });

  it('transfers a property for cash and charges the new owner interest on a mortgaged deed', () => {
    prop(B, 'rr1').owner = 'p1';
    prop(B, 'rr1').mortgaged = true;
    B.openSheet('trade', { id: 'rr1' });
    B.doTransfer('rr1', 'p2', 120, 'new', true);
    expect(prop(B, 'rr1').owner).toBe('p2');
    expect(P(B, 0).cash).toBe(1620);
    expect(P(B, 1).cash).toBe(1500 - 120 - 10); // 10% of the $100 mortgage
    expect(B.ui.sheet).toBeNull();
  });

  it('refuses to transfer a lot that still has buildings', () => {
    give(B, 'p1', BROWN, 2);
    B.doTransfer('med', 'p2', 0, 'new', false);
    expect(prop(B, 'med').owner).toBe('p1');
  });

  it('buys from the bank at list or auction price and closes the sheet', () => {
    B.openSheet('prop', { id: 'bw' });
    B.doBuy('p3', 'bw', 260);
    expect(prop(B, 'bw').owner).toBe('p3');
    expect(P(B, 2).cash).toBe(1240);
    expect(S(B).log[0].msg).toMatch(/bought Boardwalk for \$260 \(list price \$400\)/);
    expect(B.ui.sheet).toBeNull();
  });
});

describe('bank, taxes and Free Parking', () => {
  let B;
  beforeEach(() => ({ B } = boot()));

  it('pays GO salary from the bank', () => {
    B.doGo('p1');
    expect(P(B, 0).cash).toBe(1700);
  });

  it('routes taxes to the pot when asked, otherwise to the bank', () => {
    B.doPayBank('p1', 75, true, 'Luxury Tax');
    expect(P(B, 0).cash).toBe(1425);
    expect(S(B).pot).toBe(75);
    B.doPayBank('p1', 50, false, 'Jail fine');
    expect(S(B).pot).toBe(75);
    expect(P(B, 0).cash).toBe(1375);
  });

  it('bases the 10% income tax on cash plus property and building value', () => {
    give(B, 'p1', BROWN, 1); // $120 of lots + $100 of houses
    prop(B, 'rr1').owner = 'p1';
    prop(B, 'rr1').mortgaged = true; // counts at mortgage value, $100
    expect(B.netWorth('p1')).toBe(1500 + 120 + 100 + 100);
  });

  it('collects from and pays every other player at once', () => {
    B.doCollect('p1', 'all', 10, 'Birthday');
    expect(P(B, 0).cash).toBe(1530);
    expect(P(B, 1).cash).toBe(1490);
    B.doPayPlayer('p1', 'all', 50);
    expect(P(B, 0).cash).toBe(1380);
    expect(P(B, 3).cash).toBe(1540);
  });
});

describe('bankruptcy', () => {
  let B;
  beforeEach(() => ({ B } = boot()));

  it('hands everything to a player creditor, selling buildings to the bank for them', () => {
    give(B, 'p1', BROWN, 2); // two houses each, $200 of buildings -> $100 when sold
    prop(B, 'rr1').owner = 'p1';
    prop(B, 'rr1').mortgaged = true;
    P(B, 0).cash = 40;
    B.doBankrupt('p1', 'p2');
    expect(P(B, 0)).toMatchObject({ cash: 0, bankrupt: true });
    expect(prop(B, 'med')).toMatchObject({ owner: 'p2', level: 0 });
    expect(prop(B, 'rr1')).toMatchObject({ owner: 'p2', mortgaged: true });
    expect(P(B, 1).cash).toBe(1500 + 40 + 100 - 10); // cash + building sale - 10% interest on the mortgaged railroad
    expect(S(B).turn).toBe('p2');
  });

  it('returns everything to the bank when the bank is the creditor', () => {
    give(B, 'p1', BROWN, 3);
    prop(B, 'ele').owner = 'p1';
    prop(B, 'ele').mortgaged = true;
    B.doBankrupt('p1', 'bank');
    expect(prop(B, 'med')).toEqual({ owner: null, level: 0, mortgaged: false });
    expect(prop(B, 'ele')).toEqual({ owner: null, level: 0, mortgaged: false });
    expect(B.supply()).toEqual({ housesLeft: 32, hotelsLeft: 12 });
  });

  it('skips bankrupt players in turn order', () => {
    B.doBankrupt('p2', 'bank');
    S(B).turn = 'p1';
    B.nextTurn();
    expect(S(B).turn).toBe('p3');
  });
});

describe('undo, rollback and persistence', () => {
  let B, window;
  beforeEach(() => ({ B, window } = boot()));

  it('undoes the last committed action', () => {
    B.doGo('p1');
    B.doPayBank('p1', 75, true, 'Luxury Tax');
    expect(P(B, 0).cash).toBe(1625);
    B.undo();
    expect(P(B, 0).cash).toBe(1700);
    expect(S(B).pot).toBe(0);
    B.undo();
    expect(P(B, 0).cash).toBe(1500);
    expect(B.getHistory()).toHaveLength(0);
  });

  it('rolls back and logs nothing when an action fails validation', () => {
    const logBefore = S(B).log.length;
    P(B, 0).cash = 10;
    B.doPayBank('p1', 75, false, 'Luxury Tax'); // cannot afford
    expect(P(B, 0).cash).toBe(10);
    expect(S(B).log.length).toBe(logBefore);
    expect(window.document.querySelector('.toast').textContent).toMatch(/only has \$10/);
  });

  it('persists to localStorage and reloads the same game', () => {
    B.doGo('p2');
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const { B: B2 } = boot({ storage: raw });
    expect(P(B2, 1).cash).toBe(1700);
    expect(S(B2).log[0].msg).toMatch(/passed GO/);
  });

  it('survives corrupt saved data by opening the new-game screen', () => {
    const { B: B2, document } = boot({ storage: '{not json' });
    expect(S(B2)).toBeNull();
    expect(B2.ui.sheet).toMatchObject({ kind: 'setup' });
    expect(document.querySelector('.sheet-head h2').textContent).toBe('New game');
  });
});

describe('rendering safety', () => {
  it('escapes player names everywhere they are rendered', () => {
    const { B, document } = boot({ names: ['<img src=x onerror="window.pwned=1">', 'Ben'] });
    expect(document.querySelectorAll('img')).toHaveLength(0);
    expect(document.querySelector('.player h3').textContent).toBe('<img src=x onerror="window.pwned=1">');
    B.openSheet('player', { pid: 'p1' });
    expect(document.querySelectorAll('.sheet img')).toHaveLength(0);
  });

  it('shows the Free Parking payout tiles with nothing preselected', () => {
    const { B, document } = boot();
    S(B).pot = 120;
    B.openSheet('pot');
    expect(document.querySelectorAll('.ptile')).toHaveLength(4);
    expect(document.querySelectorAll('.ptile.sel')).toHaveLength(0);
    expect(document.querySelector('[data-act="potGive"]').disabled).toBe(true);
  });

  it('hides the ad banner unless the Worker provided a client and slot', () => {
    const { document } = boot();
    expect(document.getElementById('adBar').hidden).toBe(true);
    expect(document.body.classList.contains('has-ads')).toBe(false);
  });
});
