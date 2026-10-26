"""Snapshot the original 250-record corpus: per-record fingerprints and vocabulary.

Run once, before any additions. The fingerprints let tests prove that the
original records are unchanged after the corpus grows.
"""
import collections, hashlib, json, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
records = json.loads((ROOT / 'weird-music-machine-corpus.json').read_text())

def fingerprint(record):
    canonical = json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(canonical.encode()).hexdigest()

(ROOT / 'research/baseline-250-fingerprints.json').write_text(json.dumps({
    'record_count': len(records),
    'ids_in_order': [r['id'] for r in records],
    'fingerprints': {r['id']: fingerprint(r) for r in records},
}, indent=1) + '\n')

def counts(field):
    c = collections.Counter(v for r in records for v in r[field])
    return dict(sorted(c.items(), key=lambda kv: (-kv[1], kv[0])))

(ROOT / 'research/baseline-vocabulary.json').write_text(json.dumps({
    'genres': counts('genres'),
    'styles': counts('styles'),
    'traits': counts('traits'),
    'release_types': dict(collections.Counter(r['release_type'] for r in records)),
    'score_distribution': {k: dict(sorted(collections.Counter(str(r[k]) for r in records).items())) for k in ('weirdness', 'intensity', 'accessibility')},
}, ensure_ascii=False, indent=1) + '\n')
print(len(records), 'records snapshotted')
