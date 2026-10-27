import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCorpus, baseline, fingerprint, readJSON} from './helpers.mjs';

const corpus = loadCorpus();
const original = baseline();
const FIELDS = ['id','artist','title','label','year','list_number','list_group','source_notes','genres','styles','traits','weirdness','intensity','accessibility','research_sources','research_notes','curation_sources','release_type','release_type_sources','release_type_notes'];
const additions = corpus.slice(original.record_count);
const isURL = value => { try { return ['http:','https:'].includes(new URL(value).protocol); } catch { return false; } };

test('the original 250 records are present, first, in order and byte-for-byte unchanged', () => {
  assert.equal(original.record_count, 250);
  assert.deepEqual(corpus.slice(0, 250).map(r => r.id), original.ids_in_order);
  for (const record of corpus.slice(0, 250)) assert.equal(fingerprint(record), original.fingerprints[record.id], record.id + ' changed');
});

test('every id is unique', () => {
  assert.equal(new Set(corpus.map(r => r.id)).size, corpus.length);
});

test('new records continue the wmm- series without gaps', () => {
  additions.forEach((record, i) => assert.equal(record.id, 'wmm-' + String(121 + i).padStart(4, '0')));
});

test('every record has the full schema', () => {
  for (const record of corpus) {
    assert.deepEqual(Object.keys(record).sort(), [...FIELDS].sort(), record.id);
    for (const key of ['genres','styles','traits','research_sources','research_notes','source_notes','curation_sources','release_type_sources','release_type_notes']) assert.ok(Array.isArray(record[key]), record.id + ' ' + key);
    for (const key of ['weirdness','intensity','accessibility']) assert.ok(record[key] === null || (Number.isInteger(record[key]) && record[key] >= 1 && record[key] <= 5), record.id + ' ' + key);
  }
});

test('new records are fully sourced and classified', () => {
  for (const record of additions) {
    const where = record.id + ' (' + record.artist + ' — ' + record.title + ')';
    assert.ok(record.artist && record.title, where);
    assert.ok(Number.isInteger(record.year) && record.year >= 1900 && record.year <= 2026, where + ' year');
    assert.equal(record.list_number, null, where); assert.equal(record.list_group, null, where);
    assert.ok(record.genres.length && record.styles.length && record.traits.length, where + ' classification');
    assert.ok(record.curation_sources.length, where + ' curation');
    for (const source of record.curation_sources) {
      assert.ok(source.publication && source.list_title && isURL(source.url), where + ' curation source');
      assert.ok(source.rank === null || Number.isInteger(source.rank), where + ' rank');
    }
    assert.ok(record.research_sources.length && record.research_sources.every(isURL), where + ' research sources');
    assert.ok(record.release_type_sources.every(isURL), where + ' release type sources');
  }
});

test('new records use the existing trait vocabulary', () => {
  const traits = new Set(Object.keys(readJSON('research/baseline-vocabulary.json').traits));
  for (const record of additions) for (const trait of record.traits) assert.ok(traits.has(trait), record.id + ' uses new trait ' + trait);
});

test('no duplicate artist/title pairs, ignoring case, accents and punctuation', () => {
  const key = r => [r.artist, r.title].map(v => String(v).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^the\s+/, '').replace(/&/g, 'and').replace(/[^a-z0-9]/g, '')).join('|');
  const seen = new Map();
  for (const record of corpus) {
    assert.ok(!seen.has(key(record)), record.id + ' duplicates ' + seen.get(key(record)));
    seen.set(key(record), record.id);
  }
});

test('new records have resolved scores and a known release type', () => {
  const types = new Set(['album', 'live album', 'compilation', 'single', 'EP', 'mini-album']);
  for (const record of additions) {
    for (const key of ['weirdness', 'intensity', 'accessibility']) assert.ok(Number.isInteger(record[key]), record.id + ' ' + key);
    assert.ok(types.has(record.release_type), record.id + ' release type ' + record.release_type);
  }
});

test('the corpus additions are exactly the researched records', () => {
  const researched = readJSON('research/04-enriched-additions.json').records;
  assert.deepEqual(additions.slice(-researched.length), researched);
  assert.equal(additions.filter(r => !researched.some(x => x.id === r.id)).length, additions.length - researched.length);
});
