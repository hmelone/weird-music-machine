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
  }
  clean.preference = Object.hasOwn(BANDS, value.preference) ? value.preference : 'any';
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
  const mode = positives.length ? 'personalized' : negatives.length ? 'avoidance' : 'discovery';
  const denominator = anchors.reduce((sum, r) => sum + Math.abs(RATING_WEIGHTS[entryFor(log, r.id).rating]), 0) || 1;
  const ranked = eligible.map(record => {
    const evidence = anchors.map(anchor => {
      const rating = entryFor(log, anchor.id).rating;
      const similarity = pairSimilarity(record, anchor);
      const strong = similarity.score >= .35 && overlapExists(similarity.shared);
      const contribution = rating <= 2 && !strong ? 0 : RATING_WEIGHTS[rating] * similarity.score;
      return {anchor, rating, shared: similarity.shared, similarity: similarity.score, contribution};
    });
    return {record, score: evidence.reduce((sum, e) => sum + e.contribution, 0) / denominator, evidence: evidence.filter(e => e.rating >= 4 && overlapExists(e.shared)).sort((a, b) => b.contribution - a.contribution || catalogOrder(a.anchor, b.anchor)), negativeEvidence: evidence.filter(e => e.contribution < 0)};
  });
  if (mode === 'discovery') {
    // Fixed round-robin: varied broad genres without claiming personal evidence.
    const pools = new Map();
    for (const item of ranked.sort((a, b) => catalogOrder(a.record, b.record))) {
      const key = item.record.genres[0] || 'other';
      if (!pools.has(key)) pools.set(key, []);
      pools.get(key).push(item);
    }
    const ordered = [];
    while (ordered.length < ranked.length) for (const pool of pools.values()) if (pool.length) ordered.push(pool.shift());
    return {mode, items: ordered, anchorCount: 0};
  }
  const supported = mode === 'personalized' ? ranked.filter(r => r.evidence.length && r.score > 0) : ranked;
  return {mode, items: supported.sort((a, b) => b.score - a.score || catalogOrder(a.record, b.record)), anchorCount: anchors.length};
}

export function explanation(item, mode) {
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
  });
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
