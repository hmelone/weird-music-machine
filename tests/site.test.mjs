// End-to-end check of the real page in Chromium. Skipped when Playwright is not installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {root, loadCorpus, enlargedCorpus} from './helpers.mjs';

let chromium = null;
for (const base of [import.meta.url, 'file:///opt/node-tools/']) { try { ({chromium} = createRequire(base)('playwright')); break; } catch {} }
const types = {'.html': 'text/html', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css'};

async function serve() {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname.replace(/^\/$/, '/index.html'));
    try { const body = await readFile(fileURLToPath(new URL('.' + path, root))); res.writeHead(200, {'content-type': types[path.slice(path.lastIndexOf('.'))] || 'application/octet-stream'}); res.end(body); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {server, url: 'http://127.0.0.1:' + server.address().port + '/'};
}

async function open(browser, url, corpus) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (corpus) await page.route('**/weird-music-machine-corpus.json', route => route.fulfill({contentType: 'application/json', body: JSON.stringify(corpus)}));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('#results-count')?.textContent !== 'Loading the collection…');
  return {page, errors};
}

const counts = page => page.evaluate(() => ({
  records: [...document.querySelectorAll('[data-count="records"]')].map(n => n.textContent),
  additions: document.querySelector('[data-count="additions"]').textContent,
  publications: [...document.querySelectorAll('#filter-publication option')].slice(1).map(o => o.value),
  results: document.querySelector('#results-count').textContent,
  progress: document.querySelector('#progress').textContent,
  grid: document.querySelectorAll('#record-grid .record-card').length,
  failed: document.querySelector('#record-grid').textContent.includes('The signal dropped'),
  meta: document.querySelector('meta[name="description"]').content,
}));

test('site in the browser', {skip: !chromium && 'Playwright not installed'}, async t => {
  const {server, url} = await serve();
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); server.close(); });
  const corpus = loadCorpus();
  const publications = new Set(corpus.flatMap(r => r.curation_sources.map(s => s.publication)));

  await t.test('loads the real corpus and shows counts from it', async () => {
    const {page, errors} = await open(browser, url);
    const c = await counts(page);
    assert.equal(c.failed, false); assert.deepEqual(errors, []);
    assert.ok(c.records.length >= 6 && c.records.every(v => v === String(corpus.length)), JSON.stringify(c.records));
    assert.equal(c.additions, String(corpus.filter(r => !r.list_group).length));
    assert.equal(c.results, corpus.length + ' records / ' + corpus.length);
    assert.equal(c.progress, '0 / ' + corpus.length + ' HEARD');
    assert.ok(c.meta.startsWith(corpus.length + ' releases'));
    assert.deepEqual(new Set(c.publications), publications);
    assert.equal(c.grid, 24);
    await page.close();
  });

  await t.test('static fallback counts in index.html match the corpus', async () => {
    const html = await readFile(new URL('index.html', root), 'utf8');
    for (const match of html.matchAll(/data-count="records">(\d+)</g)) assert.equal(match[1], String(corpus.length));
    assert.match(html, new RegExp('data-count="additions">' + corpus.filter(r => !r.list_group).length + '<'));
  });

  await t.test('a corpus larger than 250 loads, filters and keeps existing ratings', async () => {
    const big = enlargedCorpus(corpus.slice(0, 250), 75);
    const {page, errors} = await open(browser, url, big);
    let c = await counts(page);
    assert.equal(c.failed, false); assert.deepEqual(errors, []);
    assert.equal(c.results, big.length + ' records / ' + big.length);
    await page.click('[data-rate="wire-001"][data-value="5"]');
    await page.selectOption('#sort', 'list');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#results-count')?.textContent !== 'Loading the collection…');
    c = await counts(page);
    assert.equal(c.progress, '1 / ' + big.length + ' HEARD');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('weird-music-machine:v1')));
    assert.equal(stored.records['wire-001'].rating, 5);
    await page.fill('#search', 'Synthetic test record 75');
    assert.equal((await counts(page)).results, '1 record / ' + big.length);
    await page.click('[data-tab="recommendations"] >> nth=0');
    assert.match((await counts(page)).results, /eligible recommendation/);
    await page.close();
  });

  await t.test('weirdness selector offers five equal options with Any selected by default', async () => {
    const {page} = await open(browser, url);
    const bands = await page.$$eval('[data-band]', els => els.map(e => [e.dataset.band, e.getAttribute('role'), e.getAttribute('aria-checked'), e.tabIndex]));
    assert.deepEqual(bands.map(b => b[0]), ['any', 'familiar', 'strange', 'farout', 'unhinged']);
    assert.ok(bands.every(b => b[1] === 'radio'));
    assert.deepEqual(bands.map(b => b[2]), ['true', 'false', 'false', 'false', 'false']);
    await page.focus('[data-band="any"]'); await page.keyboard.press('End');
    assert.equal(await page.getAttribute('[data-band="unhinged"]', 'aria-checked'), 'true');
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.getAttribute('[data-band="any"]', 'aria-checked'), 'true');
    await page.close();
  });

  await t.test('a pathway filters the archive and can be cleared', async () => {
    const {page} = await open(browser, url);
    await page.click('[data-thread-tab="scenes"]');
    await page.click('[data-pathway="motorik-forever"]');
    assert.match(await page.textContent('#pathway-banner'), /Motorik Forever/);
    assert.match((await counts(page)).results, /^15 records/);
    await page.click('#clear-pathway');
    assert.equal(await page.isHidden('#pathway-banner'), true);
    assert.equal((await counts(page)).results, corpus.length + ' records / ' + corpus.length);
    await page.close();
  });

  await t.test('the survey is optional, saved locally, exported, and resettable', async () => {
    const {page} = await open(browser, url);
    assert.equal(await page.isVisible('#survey-strip [data-survey="open"]'), true);
    await page.click('#survey-strip [data-survey="open"]');
    await page.check('#survey-form input[name="looking"][value="hypnotic"]');
    await page.check('#survey-form input[name="strangeness"][value="farout"]');
    await page.check('#survey-form input[name="energy"][value="calm"]');
    await page.click('#survey-form .survey-save');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('weird-music-machine:v1')));
    assert.equal(stored.survey.status, 'saved'); assert.deepEqual(stored.survey.looking, ['hypnotic']);
    assert.equal(stored.preference, 'farout');
    assert.equal(await page.getAttribute('[data-band="farout"]', 'aria-checked'), 'true');
    assert.match(await page.textContent('#survey-strip'), /Hypnotic/);
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-log')]);
    const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.deepEqual(exported.survey.looking, ['hypnotic']);
    await page.click('#survey-strip [data-survey="reset"]');
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('weird-music-machine:v1')));
    assert.equal(after.survey.status, 'skipped');
    await page.close();
  });

  await t.test('skipping the survey hides the first-visit prompt for good', async () => {
    const {page} = await open(browser, url);
    await page.click('#survey-strip [data-survey="skip"]');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#results-count')?.textContent !== 'Loading the collection…');
    assert.equal(await page.isVisible('#survey-strip [data-survey="skip"]'), false);
    await page.close();
  });

  await t.test('the edition filter browses what was added after the original collection', async () => {
    const {page} = await open(browser, url);
    await page.selectOption('#filter-edition', 'added');
    assert.equal((await counts(page)).results, (corpus.length - 130) + ' records / ' + corpus.length);
    assert.equal(await page.$('.edition-ledger'), null, 'the collection box is gone from the masthead');
    await page.close();
  });

  await t.test('record notes explain why a record is here, with source overlap', async () => {
    const {page} = await open(browser, url);
    await page.fill('#search', 'Your Queen Is a Reptile');
    assert.match(await page.textContent('.record-card .card-group'), /3 SOURCES/);
    await page.click('[data-details="wmm-0084"] >> nth=0');
    const block = await page.textContent('#dialog-body .provenance');
    assert.match(block, /3 curated sources across 2 publications/);
    assert.match(block, /Albums of the Year 2018/); assert.match(block, /No\. 7/); assert.match(block, /Unranked list/);
    assert.equal(await page.$$eval('#dialog-body .provenance-list li', els => els.length), 3);
    await page.close();
  });

  await t.test('personal notes save, survive reload, export, and keep existing log data', async () => {
    const page = await browser.newPage();
    const existing = {version: 1, records: {'wire-001': {status: 'heard', rating: 5, heardAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'}, 'wire-002': {status: 'want to hear', rating: null, heardAt: null, updatedAt: '2026-01-02T00:00:00.000Z'}}, events: [{id: 'wire-001', at: '2026-01-01T00:00:00.000Z', kind: 'rating', status: 'heard', rating: 5}], preference: 'strange'};
    await page.addInitScript(log => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('weird-music-machine:v1', JSON.stringify(log)); sessionStorage.setItem('seeded', '1'); } }, existing);
    await page.goto(url);
    await page.waitForFunction(() => document.querySelectorAll('.record-card').length > 0);
    await page.click('[data-details="wire-001"] >> nth=0');
    await page.fill('#note-input', 'Gets beautiful around track 3.');
    await page.click('[data-save-note="wire-001"]');
    await page.click('[data-rate="wire-001"][data-value="4"] >> nth=-1');
    assert.equal(await page.inputValue('#note-input'), 'Gets beautiful around track 3.');
    await page.reload(); await page.waitForFunction(() => document.querySelectorAll('.record-card').length > 0);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('weird-music-machine:v1')));
    assert.equal(stored.records['wire-001'].note, 'Gets beautiful around track 3.');
    assert.equal(stored.records['wire-001'].rating, 4);
    assert.deepEqual(stored.records['wire-002'], existing.records['wire-002']);
    assert.equal(stored.preference, 'strange');
    assert.match(await page.textContent('[data-record="wire-001"] .card-note'), /track 3/);
    await page.click('[data-tab="history"] >> nth=0'); await page.click('[data-history="notes"]');
    assert.match(await page.textContent('#history-view'), /Gets beautiful around track 3/);
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-log')]);
    const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.equal(exported.records['wire-001'].note, 'Gets beautiful around track 3.');
    await page.close();
  });

  await t.test('importing a log merges notes and preferences without losing local data', async () => {
    const page = await browser.newPage();
    const local = {version: 1, records: {'wire-001': {status: 'heard', rating: 5, heardAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', note: 'local note', noteUpdatedAt: '2026-01-01T00:00:00.000Z'}}, events: [], preference: 'any'};
    await page.addInitScript(log => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('weird-music-machine:v1', JSON.stringify(log)); sessionStorage.setItem('seeded', '1'); } }, local);
    await page.goto(url); await page.waitForFunction(() => document.querySelectorAll('.record-card').length > 0);
    const file = {version: 1, records: {'wire-001': {status: 'heard', rating: 3, heardAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z'}, 'wmm-0164': {status: 'want to hear', rating: null, heardAt: null, updatedAt: '2026-02-01T00:00:00.000Z', note: 'Too jangly for me.'}}, events: [], preference: 'farout', survey: {status: 'saved', looking: ['noisy'], strangeness: 'farout', energy: 'intense', more: ['shoegaze'], less: [], savedAt: '2026-02-01T00:00:00.000Z'}};
    await page.setInputFiles('#import-file', {name: 'log.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file))});
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('weird-music-machine:v1')).records['wmm-0164']);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('weird-music-machine:v1')));
    assert.equal(stored.records['wire-001'].rating, 3, 'imported rating applies');
    assert.equal(stored.records['wire-001'].note, 'local note', 'a local note survives an import without one');
    assert.equal(stored.records['wmm-0164'].note, 'Too jangly for me.');
    assert.deepEqual(stored.survey.looking, ['noisy']);
    await page.close();
  });

  await t.test('the recommendation methodology is one collapsed disclosure beside the picks', async () => {
    const {page} = await open(browser, url);
    assert.equal(await page.isHidden('#how-recs'), true, 'hidden in the archive view');
    await page.click('[data-tab="recommendations"] >> nth=0');
    assert.equal(await page.isVisible('#how-recs'), true);
    assert.equal(await page.evaluate(() => document.querySelector('#how-recs').open), false, 'collapsed by default');
    await page.click('[data-tab="collection"] >> nth=0');
    await page.click('[data-open-method]');
    assert.equal(await page.evaluate(() => document.querySelector('#how-recs').open), true);
    const text = await page.textContent('#how-recs');
    for (const phrase of ['45%', 'twice as much', '0.3 ÷ (1 +', 'never recommended', 'deterministic', 'Surprise Me']) assert.ok(text.includes(phrase), phrase);
    assert.equal(await page.$$eval('details.method', els => els.length), 1, 'no duplicate methodology');
    await page.close();
  });

  await t.test('the UX pass: grouped filters, phone collapse and discovery order', async () => {
    const {page} = await open(browser, url);
    assert.equal(await page.evaluate(() => document.querySelector('#more-filters').open), false, 'advanced filters start tucked away');
    assert.equal(await page.isVisible('#filter-weirdness'), false);
    await page.click('#more-filters summary'); await page.selectOption('#filter-weirdness', '5');
    assert.equal((await page.textContent('#filter-count')).trim(), '· 1 ON');
    assert.equal((await page.textContent('#more-filter-count')).trim(), '· 1 on');
    const order = await page.$$eval('.discovery, .thread-directory', els => els.map(e => e.className));
    assert.deepEqual(order, ['discovery', 'thread-directory'], 'tune in comes before the pathways');
    assert.equal(await page.$$eval('[data-record^="wire-"] .card-source', els => els.length), 0, 'single-source originals skip the repeated source line');
    await page.close();
    const phone = await browser.newPage({viewport: {width: 390, height: 844}});
    await phone.goto(url); await phone.waitForFunction(() => document.querySelectorAll('.record-card').length > 0);
    assert.equal(await phone.evaluate(() => document.querySelector('#filter-details').open), false, 'filters start closed on phones');
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, 'no horizontal scroll');
    await phone.close();
  });

  await t.test('a malformed corpus still fails the integrity check', async () => {
    const {page} = await open(browser, url, [...corpus, corpus[0]]);
    assert.equal((await counts(page)).failed, true);
    await page.close();
  });
});
