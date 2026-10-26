import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCorpus, enlargedCorpus} from './helpers.mjs';
import {catalogOrder, sortRecords, sanitizeLog, updateRecord, blankLog, recommend, surprise, tasteProfile, filterRecords, entryFor} from '../engine.mjs';

const corpus = loadCorpus();
const big = enlargedCorpus(corpus, 125);

test('catalog order places wire records, then wmm records numerically, beyond 250', () => {
  const ids = sortRecords([...big].reverse(), blankLog(), 'list').map(r => r.id);
  assert.equal(ids[0], 'wire-001'); assert.equal(ids[129], 'wire-130');
  assert.equal(ids[130], 'wmm-0001'); assert.equal(ids[249], 'wmm-0120'); assert.equal(ids[250], 'wmm-0121');
  assert.equal(ids.at(-1), 'wmm-' + String(120 + 125).padStart(4, '0'));
  assert.ok(catalogOrder({id: 'wmm-0999', list_number: null}, {id: 'wmm-1000', list_number: null}) < 0);
});

test('existing ratings survive a larger corpus and new records start unheard', () => {
  let log = blankLog();
  log = updateRecord(log, 'wire-001', {rating: 5}, '2026-01-01T00:00:00.000Z');
  log = updateRecord(log, 'wmm-0120', {status: 'want to hear'}, '2026-01-02T00:00:00.000Z');
  const restored = sanitizeLog(JSON.parse(JSON.stringify(log)), big);
  assert.deepEqual(restored.records, log.records);
  assert.equal(restored.events.length, 2);
  assert.equal(entryFor(restored, 'wmm-0121').status, 'unheard');
});

test('recommendations, surprise and profile work across more than 250 records', () => {
  let log = blankLog();
  for (const [id, rating] of [['wire-002', 5], ['wire-010', 4], ['wmm-0001', 5], ['wmm-0050', 2], ['wire-030', 1]]) log = updateRecord(log, id, {rating});
  const result = recommend(big, log);
  assert.equal(result.mode, 'personalized');
  assert.ok(result.items.length > 0);
  assert.ok(result.items.every(item => entryFor(log, item.record.id).status !== 'heard'));
  assert.equal(recommend(big, blankLog()).items.length, big.filter(r => r.id !== 'wire-121' && [r.weirdness, r.intensity, r.accessibility].every(Number.isInteger)).length);
  assert.ok(surprise(big, log, {}, 'any', () => 0.999));
  assert.equal(tasteProfile(big, log).ready, true);
  assert.equal(filterRecords(big, log, {}).length, big.length);
});

test('recommendations over the real corpus are deterministic', () => {
  let log = blankLog();
  log = updateRecord(log, 'wire-002', {rating: 5});
  const a = recommend(corpus, log).items.map(i => i.record.id), b = recommend(corpus, log).items.map(i => i.record.id);
  assert.deepEqual(a, b);
});
