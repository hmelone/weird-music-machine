"""Stage 3: merge the per-source extractions in research/candidates/ into one candidate pool.

Each candidate keeps every curated source that named it (publication, list,
year, rank, position, URL). Picks that do not name one specific release are
kept in the pool but marked `pool_status: "not a specific release"` so the
reason is visible.

usage: python3 tools/build_candidate_pool.py
"""
import glob, json, pathlib, re, unicodedata

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'research/candidates'
OUT = ROOT / 'research/01-candidate-pool.json'

DASH = r'\s*[–—-]\s*'

def tidy(text):
    return re.sub(r'\s+', ' ', (text or '').replace(' ', ' ')).strip()

def norm(text):
    text = unicodedata.normalize('NFKD', text or '').encode('ascii', 'ignore').decode().lower()
    text = re.sub(r'^the\s+', '', text.strip()).replace('&', 'and')
    return re.sub(r'[^a-z0-9]', '', text)

def split_pick(artist, title):
    """Repair the shapes the crawlers can return."""
    artist, title = tidy(artist), tidy(title)
    artist = re.sub(DASH + r'$', '', artist)
    if not artist and re.search(r'\s[–—-]\s', title):
        artist, title = re.split(r'\s[–—-]\s', title, maxsplit=1)
    return tidy(artist), tidy(title)

NOT_SPECIFIC = re.compile(r'complete discography|discography|string quartets|\bany\b.*\balbum\b|\balbum or\b|^$', re.I)

def list_year(source):
    if source.get('list_year'): return source['list_year']
    if source.get('published'): return int(source['published'][:4])
    return None

pool, order = {}, []
for path in sorted(SRC.glob('*.json')):
    source = json.loads(path.read_text())
    for pick in source['picks']:
        artist, title = split_pick(pick.get('artist'), pick.get('title'))
        status = 'candidate'
        if not artist or not title or NOT_SPECIFIC.search(title):
            status = 'not a specific release'
        key = norm(artist) + '|' + norm(title) if status == 'candidate' else f'{path.stem}#{pick.get("position")}'
        citation = {
            'publication': source['publication'],
            'list_title': source['list_title'],
            'list_year': list_year(source),
            'rank': pick.get('rank'),
            'position': pick.get('position'),
            'url': source['url'],
            'pick_url': pick.get('page_url'),
            'source_file': 'research/candidates/' + path.name,
            'list_type': source.get('list_type'),
        }
        hints = {k: pick[k] for k in ('label_in_source', 'bandcamp_url', 'item_type', 'band_location') if pick.get(k)}
        if key not in pool:
            pool[key] = {'artist': artist, 'title': title, 'pool_status': status, 'citations': [], 'source_hints': {}}
            if status != 'candidate':
                pool[key]['raw_pick'] = {k: pick.get(k) for k in ('artist', 'title', 'heading') if pick.get(k)}
            order.append(key)
        if not any(c['url'] == citation['url'] for c in pool[key]['citations']):  # a list can embed the same release twice
            pool[key]['citations'].append(citation)
        for k, v in hints.items(): pool[key]['source_hints'].setdefault(k, v)

candidates = []
for i, key in enumerate(order, 1):
    entry = pool[key]
    candidates.append({'candidate_id': f'cand-{i:04d}', 'match_key': key if entry['pool_status'] == 'candidate' else None, **entry})

summary = {
    'raw_picks': sum(len(json.loads(p.read_text())['picks']) for p in SRC.glob('*.json')),
    'source_lists': len(list(SRC.glob('*.json'))),
    'candidates': len(candidates),
    'specific_releases': sum(c['pool_status'] == 'candidate' for c in candidates),
    'not_specific': sum(c['pool_status'] != 'candidate' for c in candidates),
    'cited_by_multiple_lists': sum(len(c['citations']) > 1 for c in candidates),
}
OUT.write_text(json.dumps({'summary': summary, 'candidates': candidates}, indent=1, ensure_ascii=False) + '\n')
print(json.dumps(summary, indent=1))
