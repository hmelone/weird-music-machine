"""Stage 4: check every candidate against the existing corpus (and against other candidates).

Tiers, strictest first:
  exact            same artist and title after normalising case, accents, punctuation, "The", "&"
  edition          same after also removing bracketed text and edition words (remaster, deluxe, OST, ...)
  fuzzy            same artist, titles at least 0.85 similar, or one title contains the other: treated as a duplicate
  artist_in_corpus not a duplicate; the artist already has a different record in the corpus

Writes research/02-dedupe-report.json.
usage: python3 tools/dedupe_candidates.py
"""
import difflib, json, pathlib, re, unicodedata

ROOT = pathlib.Path(__file__).resolve().parent.parent
corpus = json.loads((ROOT / 'weird-music-machine-corpus.json').read_text())[:250]
pool = json.loads((ROOT / 'research/01-candidate-pool.json').read_text())['candidates']

EDITION = r'\b(remaster(ed)?|deluxe|expanded|edition|anniversary|reissue|ost|original (motion picture )?soundtrack|soundtrack|vol(ume)?|lp|ep|mono|stereo|bonus tracks?)\b'

def ascii_lower(text):
    return unicodedata.normalize('NFKD', text or '').encode('ascii', 'ignore').decode().lower()

def norm(text):
    text = re.sub(r'^the\s+', '', ascii_lower(text).strip()).replace('&', 'and')
    return re.sub(r'[^a-z0-9]', '', text)

def norm_edition(text):
    text = re.sub(r'[\(\[].*?[\)\]]', ' ', ascii_lower(text))
    return norm(re.sub(EDITION, ' ', text))

def artist_names(artist):
    """'Kevin Ayers & The Whole World' also matches 'Kevin Ayers'."""
    full = norm(artist)
    parts = [norm(p) for p in re.split(r'\s+(?:&|and|with|feat\.?|featuring|/|x)\s+|,\s*', ascii_lower(artist)) if norm(p)]
    return {full, *parts}

existing = []
for r in corpus:
    existing.append({'id': r['id'], 'artist': r['artist'], 'title': r['title'], 'names': artist_names(r['artist']), 'artist_key': norm(r['artist']), 'title_key': norm(r['title']), 'title_edition': norm_edition(r['title'])})

def compare(candidate):
    names, t, te = artist_names(candidate['artist']), norm(candidate['title']), norm_edition(candidate['title'])
    best = None
    for e in existing:
        same_artist = norm(candidate['artist']) == e['artist_key'] or bool(names & e['names'])
        if not same_artist: continue
        ref = {'id': e['id'], 'artist': e['artist'], 'title': e['title']}
        if t == e['title_key']: return {'tier': 'exact', 'matches': ref}
        if te and te == e['title_edition']: return {'tier': 'edition', 'matches': ref}
        ratio = difflib.SequenceMatcher(None, te or t, e['title_edition'] or e['title_key']).ratio()
        contained = min(len(te), len(e['title_edition'])) >= 4 and (te in e['title_edition'] or e['title_edition'] in te)
        if ratio >= .85 or contained:
            best = {'tier': 'fuzzy', 'matches': ref, 'similarity': round(ratio, 3)}
        elif not best:
            best = {'tier': 'artist_in_corpus', 'matches': ref}
    return best or {'tier': 'new'}

report, counts = [], {}
seen = {}
for c in pool:
    if c['pool_status'] != 'candidate':
        row = {'candidate_id': c['candidate_id'], 'artist': c['artist'], 'title': c['title'], 'status': 'rejected', 'reason': 'not a specific release'}
    else:
        result = compare(c)
        status = 'rejected' if result['tier'] in ('exact', 'edition', 'fuzzy') else 'eligible'
        row = {'candidate_id': c['candidate_id'], 'artist': c['artist'], 'title': c['title'], 'status': status, 'tier': result['tier']}
        if 'matches' in result: row['corpus_match'] = result['matches']
        if 'similarity' in result: row['similarity'] = result['similarity']
        if status == 'rejected': row['reason'] = f"duplicate of {result['matches']['id']} ({result['tier']} match)"
        # Near-duplicates inside the pool (alternate spellings across lists).
        if status == 'eligible':
            key = norm(c['artist']) + '|' + norm_edition(c['title'])
            if key in seen:
                row.update(status='rejected', tier='pool_duplicate', reason=f'same release as {seen[key]} under another spelling')
            else:
                seen[key] = c['candidate_id']
    label = row.get('tier') or row['reason']
    counts[label] = counts.get(label, 0) + 1
    report.append(row)

summary = {'candidates_checked': len(report), 'eligible': sum(r['status'] == 'eligible' for r in report), 'rejected': sum(r['status'] == 'rejected' for r in report), 'by_tier': counts}
(ROOT / 'research/02-dedupe-report.json').write_text(json.dumps({'summary': summary, 'method': __doc__.strip().splitlines()[2:7], 'results': report}, indent=1, ensure_ascii=False) + '\n')
print(json.dumps(summary, indent=1))
