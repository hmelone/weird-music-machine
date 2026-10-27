"""Stage 7: append the researched additions to the active corpus.

The original 250 records are checked against their stage-1 fingerprints and
written back unchanged, in the same order and byte-for-byte (the file's own
format: 2-space indent, unescaped Unicode, trailing newline). Re-running
replaces earlier copies of the additions; it never touches the original 250.
usage: python3 tools/merge_additions.py
"""
import hashlib, json, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
CORPUS = ROOT / 'weird-music-machine-corpus.json'
baseline = json.loads((ROOT / 'research/baseline-250-fingerprints.json').read_text())
additions = json.loads((ROOT / 'research/04-enriched-additions.json').read_text())['records']

def fingerprint(record):
    return hashlib.sha256(json.dumps(record, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

corpus = json.loads(CORPUS.read_text())
original = corpus[:baseline['record_count']]
assert [r['id'] for r in original] == baseline['ids_in_order'], 'original order or IDs changed'
for r in original:
    assert fingerprint(r) == baseline['fingerprints'][r['id']], r['id'] + ' differs from its baseline'

original_ids = set(baseline['ids_in_order'])
for r in additions:
    assert r['id'] not in original_ids, r['id'] + ' collides with an existing ID'
assert len({r['id'] for r in additions}) == len(additions), 'duplicate addition IDs'

merged = original + additions
CORPUS.write_text(json.dumps(merged, indent=2, ensure_ascii=False) + '\n')
print(f'{len(original)} original + {len(additions)} additions = {len(merged)} records')
