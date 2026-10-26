import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

export const root = new URL('../', import.meta.url);
export const readJSON = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
export const loadCorpus = () => readJSON('weird-music-machine-corpus.json');
export const baseline = () => readJSON('research/baseline-250-fingerprints.json');

// Same canonical form as tools/baseline.py: sorted keys, no whitespace, unescaped unicode.
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export const fingerprint = record => createHash('sha256').update(canonical(record)).digest('hex');

// Makes a corpus larger than 250 by cloning existing records under new wmm- IDs.
export function enlargedCorpus(corpus, extra = 60) {
  const additions = Array.from({length: extra}, (_, i) => ({...structuredClone(corpus[130 + (i % 120)]), id: 'wmm-' + String(121 + i).padStart(4, '0'), title: 'Synthetic test record ' + (i + 1)}));
  return [...corpus, ...additions];
}
