import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCorpus} from './helpers.mjs';
import {PATHWAYS, PATHWAY_MIN, pathwayMatches, filterRecords, blankLog, sanitizeLog, sanitizeSurvey, surveyVocabulary, recommend, updateRecord, SURVEY_MOODS, SURVEY_WEIGHT} from '../engine.mjs';

const corpus = loadCorpus();
const vocab = surveyVocabulary(corpus);

test('every pathway uses only metadata that exists in the corpus', () => {
  for (const p of PATHWAYS) for (const rule of p.rules) {
    for (const group of [rule.any, ...(rule.all || [])].filter(Boolean)) for (const [field, values] of Object.entries(group)) {
      assert.ok(['genres', 'styles', 'traits'].includes(field), p.id + ' field ' + field);
      for (const v of values) assert.ok(corpus.some(r => r[field].includes(v)), p.id + ' uses unknown ' + field + ' term ' + v);
    }
    for (const field of Object.keys(rule.ranges || {})) assert.ok(['weirdness', 'intensity', 'accessibility'].includes(field), p.id + ' range ' + field);
  }
});

test('the thirteen requested pathways exist and each has enough matches', () => {
  assert.deepEqual(PATHWAYS.map(p => p.label), ['Psychedelic Journey', 'Hazy & Beautiful', 'Something Hypnotic', 'Calm Weirdness', 'Pretty but Strange', 'Ambient & Spacious', 'Shoegaze & Textural', 'Noisy & Angular', 'Make It Noisy', 'Electronic & Beat-Driven', 'Weird Hip-Hop', 'Post-Punk / Post-Hardcore', 'Motorik Forever']);
  for (const p of PATHWAYS) assert.ok(corpus.filter(r => pathwayMatches(r, p)).length >= PATHWAY_MIN, p.label + ' is thin');
});

test('pathway rules are applied exactly as written', () => {
  const calm = PATHWAYS.find(p => p.id === 'calm-weirdness');
  for (const r of filterRecords(corpus, blankLog(), {pathway: calm.id})) assert.ok(r.weirdness >= 4 && r.intensity <= 2, r.id);
  const hiphop = filterRecords(corpus, blankLog(), {pathway: 'weird-hip-hop'});
  assert.ok(hiphop.every(r => r.genres.includes('hip hop') && r.weirdness >= 3));
  assert.ok(!filterRecords(corpus, blankLog(), {pathway: 'calm-weirdness'}).some(r => r.id === 'wire-121'), 'unresolved scores never match a range');
});

test('survey answers are cleaned against the real vocabulary', () => {
  const clean = sanitizeSurvey({status: 'saved', looking: ['hypnotic', 'made-up'], strangeness: 'farout', energy: 'loud', more: ['krautrock', 'vaporwave-ish'], less: ['abrasive']}, corpus);
  assert.deepEqual(clean.looking, ['hypnotic']); assert.equal(clean.strangeness, 'farout'); assert.equal(clean.energy, 'any');
  assert.deepEqual(clean.more, ['krautrock']); assert.deepEqual(clean.less, ['abrasive']);
  assert.equal(sanitizeSurvey({status: 'nonsense'}, corpus), null);
  for (const mood of Object.values(SURVEY_MOODS)) for (const t of mood.terms) assert.ok(vocab.has(t), 'mood term not in corpus: ' + t);
});

test('a saved survey guides recommendations until ratings take over', () => {
  let log = blankLog();
  log.survey = sanitizeSurvey({status: 'saved', looking: ['hypnotic'], energy: 'calm', more: [], less: ['abrasive']}, corpus);
  const guided = recommend(corpus, log);
  assert.equal(guided.mode, 'guided');
  assert.ok(guided.items.length > 0);
  for (const item of guided.items) { assert.equal(item.survey.avoided.length, 0); assert.ok(item.survey.matched.length > 0); }
  log = updateRecord(log, 'wmm-0171', {rating: 5});
  const one = recommend(corpus, log);
  assert.equal(one.mode, 'personalized');
  const maxOne = Math.max(...one.items.map(i => i.surveyContribution));
  assert.ok(maxOne <= SURVEY_WEIGHT / 2 + 1e-9);
  for (const [id, rating] of [['wmm-0167', 5], ['wmm-0162', 4], ['wmm-0168', 4], ['wmm-0161', 5]]) log = updateRecord(log, id, {rating});
  const five = recommend(corpus, log);
  assert.ok(Math.max(...five.items.map(i => i.surveyContribution)) < maxOne, 'survey weight shrinks as ratings accumulate');
});

test('without a survey, recommendations behave exactly as before', () => {
  assert.equal(recommend(corpus, blankLog()).mode, 'discovery');
  const log = updateRecord(blankLog(), 'wire-030', {rating: 1});
  assert.equal(recommend(corpus, log).mode, 'avoidance');
  assert.ok(recommend(corpus, updateRecord(log, 'wire-002', {rating: 5})).items.every(i => i.surveyContribution === 0));
});

test('old saved logs without survey or notes still load unchanged', () => {
  const old = {version: 1, records: {'wire-001': {status: 'heard', rating: 4, heardAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'}}, events: [], preference: 'strange'};
  const loaded = sanitizeLog(old, corpus);
  assert.deepEqual(loaded.records, old.records);
  assert.equal(loaded.preference, 'strange');
  assert.equal('survey' in loaded, false);
});

test('"Added in this edition" is everything after the original Wire collection', () => {
  const added = filterRecords(corpus, blankLog(), {edition: 'added'}), original = filterRecords(corpus, blankLog(), {edition: 'original'});
  assert.equal(original.length, 130); assert.equal(added.length, corpus.length - 130);
  assert.ok(original.every(r => r.id.startsWith('wire-')) && added.every(r => r.id.startsWith('wmm-')));
});

test('personal notes are stored on the log entry without touching ratings or history', async () => {
  const {setNote, noteFor, NOTE_MAX} = await import('../engine.mjs');
  let log = updateRecord(blankLog(), 'wire-001', {rating: 4}, '2026-01-01T00:00:00.000Z');
  const before = JSON.stringify({records: log.records, events: log.events});
  log = setNote(log, 'wire-001', '  Gets beautiful around track 3.  ', '2026-02-01T00:00:00.000Z');
  assert.equal(noteFor(log, 'wire-001'), 'Gets beautiful around track 3.');
  assert.equal(log.records['wire-001'].rating, 4); assert.equal(log.records['wire-001'].status, 'heard'); assert.equal(log.events.length, 1);
  log = setNote(log, 'wmm-0200', 'Come back to this');
  assert.equal(log.records['wmm-0200'].status, 'unheard');
  const restored = sanitizeLog(JSON.parse(JSON.stringify(log)), corpus);
  assert.equal(noteFor(restored, 'wire-001'), 'Gets beautiful around track 3.');
  assert.equal(noteFor(restored, 'wmm-0200'), 'Come back to this');
  assert.equal(setNote(log, 'wire-002', 'x'.repeat(NOTE_MAX + 50)).records['wire-002'].note.length, NOTE_MAX);
  log = setNote(log, 'wire-001', '');
  assert.equal(noteFor(log, 'wire-001'), ''); assert.equal('note' in log.records['wire-001'], false);
  assert.equal(JSON.stringify({records: {'wire-001': {...log.records['wire-001']}}, events: log.events}), before, 'deleting a note restores the entry exactly');
  const status = updateRecord(setNote(blankLog(), 'wire-003', 'keep me'), 'wire-003', {status: 'want to hear'});
  assert.equal(noteFor(status, 'wire-003'), 'keep me', 'status changes keep the note');
});
