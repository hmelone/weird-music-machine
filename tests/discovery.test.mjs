import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCorpus} from './helpers.mjs';
import {PATHWAYS, PATHWAY_MIN, pathwayMatches, filterRecords, blankLog, sanitizeLog, sanitizeSurvey, surveyVocabulary, recommend, updateRecord, SURVEY_MOODS, SURVEY_ENERGY, surprise, surpriseTuned, tunedMatch, surveyFit} from '../engine.mjs';

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

test('preferences tune Surprise Me only when it is set to pick from them', () => {
  let log = blankLog();
  log.survey = sanitizeSurvey({status: 'saved', looking: ['hypnotic'], energy: 'calm', more: [], less: ['abrasive']}, corpus);
  const draws = (l, n = 300) => { const seen = new Set(); for (let i = 0; i < n; i++) seen.add(surprise(corpus, l, {}, l.preference, () => i / n).id); return [...seen].map(id => corpus.find(r => r.id === id)); };
  assert.equal(surpriseTuned(log), false, 'saving answers alone does not tune anything');
  const anything = draws(log);
  assert.ok(anything.some(r => !tunedMatch(r, log.survey)));
  log = {...log, surpriseMode: 'tuned'};
  assert.equal(surpriseTuned(log), true);
  const tuned = draws(log);
  assert.ok(tuned.length > 1);
  for (const r of tuned) {
    assert.ok(!r.traits.includes('abrasive') && !r.styles.includes('abrasive') && !r.genres.includes('abrasive'), r.id + ' avoided');
    assert.ok(r.intensity >= SURVEY_ENERGY.calm.range[0] && r.intensity <= SURVEY_ENERGY.calm.range[1], r.id + ' energy');
    assert.ok(surveyFit(r, log.survey).matched.length > 0, r.id + ' matches a mood');
  }
  const farout = {...log, preference: 'farout'};
  assert.ok(draws(farout).every(r => r.weirdness === 4), 'the weirdness level still applies');
  assert.equal(surprise(corpus, {...log, survey: {...log.survey, status: 'skipped'}}, {}, 'any', () => 0) !== null, true, 'a cleared survey falls back to anything');
});

test('preferences never change The Machine Says', () => {
  let log = updateRecord(blankLog(), 'wire-002', {rating: 5});
  const before = recommend(corpus, log);
  log = {...log, surpriseMode: 'tuned', survey: sanitizeSurvey({status: 'saved', looking: ['noisy'], energy: 'intense', more: ['shoegaze'], less: [], savedAt: '2026-01-01T00:00:00.000Z'}, corpus)};
  assert.deepEqual(recommend(corpus, log), before);
  assert.deepEqual(recommend(corpus, {...blankLog(), survey: log.survey, surpriseMode: 'tuned'}), recommend(corpus, blankLog()));
});

test('the Surprise Me setting is saved, cleaned and defaults to anything', () => {
  const survey = sanitizeSurvey({status: 'saved', looking: ['noisy'], energy: 'any', more: [], less: []}, corpus);
  assert.equal(sanitizeLog({version: 1, records: {}, events: [], preference: 'any', survey, surpriseMode: 'tuned'}, corpus).surpriseMode, 'tuned');
  assert.equal('surpriseMode' in sanitizeLog({version: 1, records: {}, events: [], preference: 'any', surpriseMode: 'bogus'}, corpus), false);
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
