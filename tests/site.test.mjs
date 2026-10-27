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
    assert.ok(c.records.length >= 7 && c.records.every(v => v === String(corpus.length)), JSON.stringify(c.records));
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

  await t.test('the edition ledger and filter show how the collection grew', async () => {
    const {page} = await open(browser, url);
    const ledger = await page.$$eval('.edition-ledger dd', els => els.map(e => e.textContent.trim()));
    assert.deepEqual(ledger, ['130', '+' + (corpus.length - 130), String(corpus.length)]);
    await page.click('[data-edition-browse="added"]');
    assert.equal((await counts(page)).results, (corpus.length - 130) + ' records / ' + corpus.length);
    assert.equal(await page.inputValue('#filter-edition'), 'added');
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

  await t.test('a malformed corpus still fails the integrity check', async () => {
    const {page} = await open(browser, url, [...corpus, corpus[0]]);
    assert.equal((await counts(page)).failed, true);
    await page.close();
  });
});
