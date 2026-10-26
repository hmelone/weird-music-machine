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

  await t.test('a malformed corpus still fails the integrity check', async () => {
    const {page} = await open(browser, url, [...corpus, corpus[0]]);
    assert.equal((await counts(page)).failed, true);
    await page.close();
  });
});
