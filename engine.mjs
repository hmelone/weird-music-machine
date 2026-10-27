export const STORAGE_KEY = 'weird-music-machine:v1';
export const WEIGHTS = Object.freeze({styles: .45, traits: .28, genres: .15, weirdness: .06, intensity: .04, accessibility: .02});
export const RATING_WEIGHTS = Object.freeze({1: -3, 2: -1.25, 3: 0, 4: 1.5, 5: 3});
export const BANDS = Object.freeze({any: [1, 5], familiar: [1, 2], strange: [3, 3], farout: [4, 4], unhinged: [5, 5]});
export const BAND_LABELS = Object.freeze({any: 'Any weirdness', familiar: 'Familiar · 1–2', strange: 'Strange · 3', farout: 'Far Out · 4', unhinged: 'Completely Unhinged · 5'});
export const normalize = value => String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const defaultEntry = () => ({status: 'unheard', rating: null, heardAt: null, updatedAt: null});
export const blankLog = () => ({version: 1, records: {}, events: [], preference: 'any'});
export const entryFor = (log, id) => log.records[id] || defaultEntry();
export const unresolved = record => record.id === 'wire-121' || !['weirdness', 'intensity', 'accessibility'].every(k => Number.isInteger(record[k]));
export const manualReview = record => (record.research_notes || []).some(n => /manual review/i.test(n));

export function sanitizeLog(value, dataset) {
  const clean = blankLog();
  if (!value || value.version !== 1 || typeof value.records !== 'object' || value.records === null || Array.isArray(value.records)) throw new Error('This is not a Weird Music Machine listening log.');
  const known = new Set(dataset.map(r => r.id));
  const date = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null;
  for (const [id, candidate] of Object.entries(value.records)) {
    if (!known.has(id) || !candidate || !['unheard', 'want to hear', 'heard'].includes(candidate.status)) continue;
    clean.records[id] = {status: candidate.status, rating: candidate.status === 'heard' && Number.isInteger(candidate.rating) && candidate.rating >= 1 && candidate.rating <= 5 ? candidate.rating : null, heardAt: date(candidate.heardAt), updatedAt: date(candidate.updatedAt)};
    const note = typeof candidate.note === 'string' ? candidate.note.trim().slice(0, NOTE_MAX) : '';
    if (note) Object.assign(clean.records[id], {note, noteUpdatedAt: date(candidate.noteUpdatedAt)});
  }
  clean.preference = Object.hasOwn(BANDS, value.preference) ? value.preference : 'any';
  const survey = sanitizeSurvey(value.survey, dataset);
  if (survey) clean.survey = survey;
  clean.events = (Array.isArray(value.events) ? value.events : []).filter(e => e && known.has(e.id) && date(e.at) && ['status', 'rating'].includes(e.kind)).slice(-2000).map(e => ({id: e.id, at: e.at, kind: e.kind, status: ['unheard', 'want to hear', 'heard'].includes(e.status) ? e.status : 'unheard', rating: Number.isInteger(e.rating) && e.rating >= 1 && e.rating <= 5 ? e.rating : null}));
  return clean;
}

export function loadLog(storage, dataset) {
  try { const raw = storage.getItem(STORAGE_KEY); return {log: raw ? sanitizeLog(JSON.parse(raw), dataset) : blankLog(), error: null}; }
  catch { return {log: blankLog(), error: 'Your saved log could not be read. Export or check this browser’s storage before replacing it.'}; }
}
export function saveLog(storage, log) {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(log)); return true; } catch { return false; }
}

export function updateRecord(log, id, patch, at = new Date().toISOString()) {
  const prior = entryFor(log, id), next = {...prior};
  let kind = 'status';
  if (Object.hasOwn(patch, 'rating')) {
    if (patch.rating !== null && (!Number.isInteger(patch.rating) || patch.rating < 1 || patch.rating > 5)) throw new Error('Rating must be between 1 and 5.');
    next.rating = patch.rating;
    if (patch.rating !== null) next.status = 'heard';
    kind = 'rating';
  } else if (Object.hasOwn(patch, 'status')) {
    if (!['unheard', 'want to hear', 'heard'].includes(patch.status)) throw new Error('Unknown listening status.');
    next.status = patch.status;
    if (next.status !== 'heard') next.rating = null;
  }
  if (next.status === 'heard' && (prior.status !== 'heard' || !next.heardAt)) next.heardAt = at;
  if (next.status === prior.status && next.rating === prior.rating) return log;
  next.updatedAt = at;
  return {...log, records: {...log.records, [id]: next}, events: [...log.events, {id, at, kind, status: next.status, rating: next.rating}].slice(-2000)};
}

// Personal notes live on the record's log entry; they never change status, rating or activity history.
export const NOTE_MAX = 500;
export function setNote(log, id, text, at = new Date().toISOString()) {
  const prior = log.records[id], note = String(text ?? '').trim().slice(0, NOTE_MAX);
  if ((prior?.note || '') === note) return log;
  const next = {...(prior || defaultEntry())};
  if (note) Object.assign(next, {note, noteUpdatedAt: at}); else { delete next.note; delete next.noteUpdatedAt; }
  return {...log, records: {...log.records, [id]: next}};
}
export const noteFor = (log, id) => log.records[id]?.note || '';

export function withinBand(record, preference = 'any') {
  if (preference === 'any') return true;
  const [min, max] = BANDS[preference] || BANDS.any;
  return Number.isInteger(record.weirdness) && record.weirdness >= min && record.weirdness <= max;
}

export const catalogOrder = (a, b) => (a.list_number ?? (130 + Number(a.id.slice(4)))) - (b.list_number ?? (130 + Number(b.id.slice(4)))) || a.id.localeCompare(b.id);

export function filterRecords(dataset, log, filters = {}) {
  const query = normalize(filters.query).trim();
  return dataset.filter(record => {
    const state = entryFor(log, record.id);
    if (query && !normalize([record.artist, record.title, record.label, record.id, ...record.genres, ...record.styles, ...record.traits].join(' ')).includes(query)) return false;
    for (const field of ['genre', 'style', 'trait']) if (filters[field] && !record[field + 's'].includes(filters[field])) return false;
    if (filters.group && record.list_group !== filters.group) return false;
    if (filters.edition === 'original' && !isOriginal(record)) return false;
    if (filters.edition === 'added' && isOriginal(record)) return false;
    if (filters.pathway && !pathwayMatches(record, PATHWAYS.find(p => p.id === filters.pathway))) return false;
    if (filters.release_type && record.release_type !== filters.release_type) return false;
    if (filters.publication && !(record.curation_sources || []).some(source => source.publication === filters.publication)) return false;
    if (filters.status && state.status !== filters.status) return false;
    if (filters.decade === 'unknown' && Number.isInteger(record.year)) return false;
    if (filters.decade && filters.decade !== 'unknown' && (!Number.isInteger(record.year) || Math.floor(record.year / 10) * 10 !== Number(filters.decade))) return false;
    for (const field of ['weirdness', 'intensity', 'accessibility']) {
      if (filters[field] === 'unknown' && record[field] !== null) return false;
      if (filters[field] && filters[field] !== 'unknown' && record[field] !== Number(filters[field])) return false;
    }
    return true;
  });
}

// The original collection is The Wire's list (original 100 + 30 runners-up), identified by list_group.
export const isOriginal = record => !!record.list_group;

// Discovery pathways: transparent combinations of existing metadata. A record joins a pathway when it
// satisfies any one of the pathway's rules. A rule can ask for at least `min` terms from `any`, at least
// one term from each group in `all`, and scores inside `ranges` (records with unresolved scores never pass a range).
export const PATHWAY_GROUPS = Object.freeze([['moods', 'Moods'], ['textures', 'Textures'], ['scenes', 'Scenes']]);
export const PATHWAYS = Object.freeze([
  {id: 'psychedelic-journey', label: 'Psychedelic Journey', group: 'moods', rules: [{any: {traits: ['psychedelic'], styles: ['psychedelic rock', 'psychedelic folk', 'psychedelic pop', 'neo-psychedelia', 'space rock']}, ranges: {weirdness: [3, 5]}}]},
  {id: 'hazy-beautiful', label: 'Hazy & Beautiful', group: 'moods', rules: [{any: {styles: ['dream pop', 'shoegaze', 'slowcore', 'noise pop']}, ranges: {intensity: [1, 3]}}, {all: [{traits: ['atmospheric']}, {traits: ['melodic']}], ranges: {intensity: [1, 3]}}]},
  {id: 'something-hypnotic', label: 'Something Hypnotic', group: 'moods', rules: [{any: {traits: ['hypnotic', 'repetitive'], styles: ['minimalism', 'drone', 'krautrock']}, min: 2}]},
  {id: 'calm-weirdness', label: 'Calm Weirdness', group: 'moods', rules: [{ranges: {weirdness: [4, 5], intensity: [1, 2]}}]},
  {id: 'pretty-but-strange', label: 'Pretty but Strange', group: 'moods', rules: [{all: [{traits: ['melodic']}], ranges: {weirdness: [3, 5], intensity: [1, 3], accessibility: [3, 5]}}]},
  {id: 'ambient-spacious', label: 'Ambient & Spacious', group: 'textures', rules: [{any: {styles: ['ambient', 'drone', 'environmental music', 'tribal ambient', 'fourth world', 'field recording composition']}, ranges: {intensity: [1, 2]}}]},
  {id: 'shoegaze-textural', label: 'Shoegaze & Textural', group: 'textures', rules: [{any: {styles: ['shoegaze', 'dream pop', 'noise pop', 'post-rock']}}]},
  {id: 'noisy-angular', label: 'Noisy & Angular', group: 'textures', rules: [{all: [{styles: ['noise rock', 'post-punk', 'math rock', 'no wave', 'art punk', 'post-hardcore']}, {traits: ['abrasive', 'dissonant', 'noisy', 'raw', 'chaotic']}]}]},
  {id: 'make-it-noisy', label: 'Make It Noisy', group: 'textures', rules: [{any: {traits: ['noisy', 'abrasive'], genres: ['noise']}, ranges: {intensity: [4, 5]}}]},
  {id: 'electronic-beat', label: 'Electronic & Beat-Driven', group: 'scenes', rules: [{all: [{genres: ['electronic']}, {traits: ['danceable', 'rhythmic', 'percussive']}]}]},
  {id: 'weird-hip-hop', label: 'Weird Hip-Hop', group: 'scenes', rules: [{all: [{genres: ['hip hop']}], ranges: {weirdness: [3, 5]}}]},
  {id: 'post-punk-hardcore', label: 'Post-Punk / Post-Hardcore', group: 'scenes', rules: [{any: {styles: ['post-punk', 'post-hardcore', 'art punk', 'no wave']}}]},
  {id: 'motorik-forever', label: 'Motorik Forever', group: 'scenes', note: 'The corpus has no "motorik" tag; this uses krautrock records that are also repetitive, rhythmic or hypnotic.', rules: [{all: [{styles: ['krautrock']}, {traits: ['repetitive', 'rhythmic', 'hypnotic']}]}]},
]);
// Below this many matches a pathway is labelled thin rather than padded with weak matches.
export const PATHWAY_MIN = 12;
const termsIn = (record, spec = {}) => Object.entries(spec).flatMap(([field, values]) => values.filter(v => (record[field] || []).includes(v)));
function ruleMatches(record, rule) {
  if (rule.any && termsIn(record, rule.any).length < (rule.min || 1)) return false;
  if (rule.all && !rule.all.every(group => termsIn(record, group).length)) return false;
  for (const [field, [min, max]] of Object.entries(rule.ranges || {})) if (!Number.isInteger(record[field]) || record[field] < min || record[field] > max) return false;
  return true;
}
export const pathwayMatches = (record, pathway) => !!pathway && pathway.rules.some(rule => ruleMatches(record, rule));
export const pathwayTerms = (record, pathway) => [...new Set(pathway.rules.flatMap(rule => [...termsIn(record, rule.any), ...(rule.all || []).flatMap(g => termsIn(record, g))]))];

// Preference survey: optional, local, and always outweighed by ratings as they accumulate.
// Each answer maps only onto metadata that exists in the corpus.
export const SURVEY_MOODS = Object.freeze({
  psychedelic: {label: 'Psychedelic', terms: ['psychedelic', 'psychedelic rock', 'psychedelic folk', 'psychedelic pop', 'neo-psychedelia', 'space rock']},
  dreamy: {label: 'Dreamy', terms: ['dream pop', 'shoegaze', 'slowcore', 'noise pop', 'atmospheric']},
  hypnotic: {label: 'Hypnotic', terms: ['hypnotic', 'repetitive', 'minimalism', 'drone', 'krautrock']},
  noisy: {label: 'Noisy', terms: ['noisy', 'abrasive', 'noise', 'noise rock']},
  ambient: {label: 'Ambient', terms: ['ambient', 'drone', 'environmental music', 'tribal ambient', 'fourth world', 'meditative']},
  electronic: {label: 'Electronic', terms: ['electronic']},
  'hip-hop': {label: 'Hip-hop', terms: ['hip hop']},
  guitar: {label: 'Guitar-heavy', terms: ['noise rock', 'shoegaze', 'post-punk', 'psychedelic rock', 'garage rock', 'math rock', 'american primitive guitar', 'slowcore', 'post-hardcore', 'guitar noise', 'desert blues']},
  surprise: {label: 'Surprise me', terms: []},
});
export const SURVEY_ENERGY = Object.freeze({calm: {label: 'Calm', range: [1, 2]}, middle: {label: 'Somewhere in the middle', range: [2, 4]}, intense: {label: 'Intense', range: [4, 5]}, any: {label: 'No preference', range: null}});
export const SURVEY_WEIGHT = .3;
export const surveyVocabulary = dataset => new Set(dataset.flatMap(r => [...r.genres, ...r.styles, ...r.traits]));
export function sanitizeSurvey(value, dataset) {
  if (!value || typeof value !== 'object' || !['saved', 'skipped'].includes(value.status)) return null;
  const vocab = surveyVocabulary(dataset);
  const list = (items, allowed) => [...new Set(Array.isArray(items) ? items.filter(x => typeof x === 'string' && allowed(x)) : [])].slice(0, 40);
  return {
    status: value.status,
    looking: list(value.looking, x => Object.hasOwn(SURVEY_MOODS, x)),
    strangeness: Object.hasOwn(BANDS, value.strangeness) ? value.strangeness : 'any',
    energy: Object.hasOwn(SURVEY_ENERGY, value.energy) ? value.energy : 'any',
    more: list(value.more, x => vocab.has(x)),
    less: list(value.less, x => vocab.has(x)),
    savedAt: typeof value.savedAt === 'string' && Number.isFinite(Date.parse(value.savedAt)) ? value.savedAt : null,
  };
}
export const activeSurvey = log => log.survey?.status === 'saved' ? log.survey : null;
export function surveyFit(record, survey) {
  const tags = new Set([...record.genres, ...record.styles, ...record.traits]);
  const wanted = new Set([...survey.looking.flatMap(m => SURVEY_MOODS[m].terms), ...survey.more]);
  const matched = [...wanted].filter(t => tags.has(t));
  const avoided = survey.less.filter(t => tags.has(t));
  const range = SURVEY_ENERGY[survey.energy]?.range;
  const inEnergy = !range || (Number.isInteger(record.intensity) && record.intensity >= range[0] && record.intensity <= range[1]);
  let score = wanted.size ? Math.min(1, matched.length / 3) : 0;
  if (!inEnergy) score *= .5;
  return {score: avoided.length ? -1 : score, matched, avoided, inEnergy, open: !wanted.size};
}

export function sortRecords(records, log, order = 'list') {
  const collator = new Intl.Collator('en', {sensitivity: 'base'});
  const ascNumber = (a, b, field, reverse = false) => {
    if (!Number.isFinite(a[field])) return Number.isFinite(b[field]) ? 1 : 0;
    if (!Number.isFinite(b[field])) return -1;
    return reverse ? b[field] - a[field] : a[field] - b[field];
  };
  return [...records].sort((a, b) => {
    let diff = 0;
    if (order === 'artist' || order === 'title') diff = collator.compare(a[order], b[order]);
    else if (order === 'year-asc' || order === 'year-desc') diff = ascNumber(a, b, 'year', order.endsWith('desc'));
    else if (/^(weirdness|intensity|accessibility)-(asc|desc)$/.test(order)) { const [key, direction] = order.split('-'); diff = ascNumber(a, b, key, direction === 'desc'); }
    else if (order === 'rating') diff = (entryFor(log, b.id).rating || 0) - (entryFor(log, a.id).rating || 0);
    else if (order === 'recent') diff = (Date.parse(entryFor(log, b.id).heardAt) || 0) - (Date.parse(entryFor(log, a.id).heardAt) || 0);
    return diff || catalogOrder(a, b);
  });
}

export function sharedMetadata(a, b) {
  return Object.fromEntries(['styles', 'traits', 'genres'].map(k => [k, a[k].filter(value => b[k].includes(value))]));
}
export function pairSimilarity(a, b) {
  const shared = sharedMetadata(a, b);
  let score = 0;
  for (const field of ['styles', 'traits', 'genres']) {
    const unionSize = new Set([...a[field], ...b[field]]).size;
    score += WEIGHTS[field] * (unionSize ? shared[field].length / unionSize : 0);
  }
  for (const field of ['weirdness', 'intensity', 'accessibility']) if (Number.isInteger(a[field]) && Number.isInteger(b[field])) score += WEIGHTS[field] * (1 - Math.abs(a[field] - b[field]) / 4);
  return {score, shared};
}

const overlapExists = shared => Object.values(shared).some(values => values.length);
export function recommend(dataset, log, filters = {}, preference = log.preference) {
  const eligible = filterRecords(dataset, log, filters).filter(r => entryFor(log, r.id).status !== 'heard' && !unresolved(r) && withinBand(r, preference));
  const anchors = dataset.filter(r => !unresolved(r) && entryFor(log, r.id).status === 'heard' && RATING_WEIGHTS[entryFor(log, r.id).rating]);
  const positives = anchors.filter(r => entryFor(log, r.id).rating >= 4);
  const negatives = anchors.filter(r => entryFor(log, r.id).rating <= 2);
  const survey = activeSurvey(log);
  const mode = positives.length ? 'personalized' : survey ? 'guided' : negatives.length ? 'avoidance' : 'discovery';
  const denominator = anchors.reduce((sum, r) => sum + Math.abs(RATING_WEIGHTS[entryFor(log, r.id).rating]), 0) || 1;
  const ranked = eligible.map(record => {
    const evidence = anchors.map(anchor => {
      const rating = entryFor(log, anchor.id).rating;
      const similarity = pairSimilarity(record, anchor);
      const strong = similarity.score >= .35 && overlapExists(similarity.shared);
      const contribution = rating <= 2 && !strong ? 0 : RATING_WEIGHTS[rating] * similarity.score;
      return {anchor, rating, shared: similarity.shared, similarity: similarity.score, contribution};
    });
    const ratingScore = evidence.reduce((sum, e) => sum + e.contribution, 0) / denominator;
    // Survey answers are a starting point: their weight shrinks as rated records accumulate.
    const fit = survey ? surveyFit(record, survey) : null;
    const surveyContribution = fit ? SURVEY_WEIGHT * fit.score / (1 + anchors.length) : 0;
    return {record, score: ratingScore + surveyContribution, ratingScore, survey: fit, surveyContribution, evidence: evidence.filter(e => e.rating >= 4 && overlapExists(e.shared)).sort((a, b) => b.contribution - a.contribution || catalogOrder(a.anchor, b.anchor)), negativeEvidence: evidence.filter(e => e.contribution < 0)};
  });
  if (mode === 'guided') {
    // No positive ratings yet: rank by saved preferences, dropping records with avoided sounds.
    const kept = ranked.filter(item => !item.survey.avoided.length && (item.survey.open ? item.survey.inEnergy : item.survey.score > 0));
    const open = kept.every(item => item.survey.open);
    return {mode, items: open ? discoveryRotation(kept) : kept.sort((a, b) => b.score - a.score || catalogOrder(a.record, b.record)), anchorCount: anchors.length};
  }
  if (mode === 'discovery') return {mode, items: discoveryRotation(ranked), anchorCount: 0};
  const supported = mode === 'personalized' ? ranked.filter(r => r.evidence.length && r.score > 0) : ranked;
  return {mode, items: supported.sort((a, b) => b.score - a.score || catalogOrder(a.record, b.record)), anchorCount: anchors.length};
}

// Fixed round-robin: varied broad genres without claiming personal evidence.
function discoveryRotation(items) {
  const pools = new Map();
  for (const item of [...items].sort((a, b) => catalogOrder(a.record, b.record))) {
    const key = item.record.genres[0] || 'other';
    if (!pools.has(key)) pools.set(key, []);
    pools.get(key).push(item);
  }
  const ordered = [];
  while (ordered.length < items.length) for (const pool of pools.values()) if (pool.length) ordered.push(pool.shift());
  return ordered;
}

export function explanation(item, mode) {
  if (mode === 'guided') return [item.survey?.matched.length ? 'Matches your saved preferences: ' + item.survey.matched.slice(0, 4).join(', ') + '.' : 'A varied pick within your saved energy and strangeness preferences.', 'Rate records 4 or 5 stars and your ratings will take over from the survey.'];
  if (mode === 'discovery') return ['A discovery pick from a varied, fixed rotation. Rate a heard record 4 or 5 stars to start making connections.'];
  if (mode === 'avoidance') {
    const negative = item.negativeEvidence[0];
    return [negative ? 'A lower-ranked discovery pick. It shares metadata with ' + negative.anchor.artist + ' — ' + negative.anchor.title + ', which you rated ' + negative.rating + ' stars, so the machine has reduced its recommendation score.' : 'A discovery pick with no strong metadata match to the records you rated 1 or 2 stars.'];
  }
  return item.evidence.slice(0, 2).map(e => {
    const parts = [];
    if (e.shared.styles.length) parts.push('shared styles: ' + e.shared.styles.slice(0, 3).join(', '));
    if (e.shared.traits.length) parts.push('shared traits: ' + e.shared.traits.slice(0, 4).join(', '));
    if (e.shared.genres.length) parts.push('shared genres: ' + e.shared.genres.join(', '));
    return 'You rated ' + e.anchor.artist + ' — ' + e.anchor.title + ' ' + e.rating + ' stars; ' + parts.join('; ') + '.';
  }).concat(item.surveyContribution > 0 && item.survey?.matched.length ? ['Your saved preferences nudged it up a little: ' + item.survey.matched.slice(0, 3).join(', ') + '.'] : []);
}

export function surprise(dataset, log, filters = {}, preference = log.preference, random = Math.random) {
  const candidates = filterRecords(dataset, log, filters).filter(r => entryFor(log, r.id).status !== 'heard' && withinBand(r, preference));
  return candidates.length ? candidates[Math.min(candidates.length - 1, Math.max(0, Math.floor(random() * candidates.length)))] : null;
}

export function tasteProfile(dataset, log) {
  const rated = dataset.filter(r => entryFor(log, r.id).status === 'heard' && entryFor(log, r.id).rating);
  const liked = rated.filter(r => entryFor(log, r.id).rating >= 4);
  const result = {ready: rated.length >= 5, ratedCount: rated.length, likedCount: liked.length};
  for (const category of ['genres', 'styles', 'traits']) {
    const terms = new Map();
    for (const r of rated) for (const term of r[category]) {
      const rating = entryFor(log, r.id).rating, current = terms.get(term) || {term, total: 0, count: 0, high: 0};
      current.total += rating; current.count++; if (rating >= 4) current.high++;
      terms.set(term, current);
    }
    result[category] = [...terms.values()].map(v => ({...v, average: v.total / v.count, strength: (v.total + 6) / (v.count + 2)})).filter(v => v.high && v.average >= 3.5).sort((a, b) => b.strength - a.strength || b.count - a.count || a.term.localeCompare(b.term)).slice(0, 5);
  }
  for (const dimension of ['weirdness', 'intensity']) {
    const values = liked.filter(r => Number.isInteger(r[dimension])).flatMap(r => Array.from({length: entryFor(log, r.id).rating === 5 ? 2 : 1}, () => r[dimension])).sort((a, b) => a - b);
    result[dimension] = values.length ? [values[Math.floor((values.length - 1) * .25)], values[Math.ceil((values.length - 1) * .75)]] : null;
  }
  return result;
}
