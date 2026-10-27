"""Stage 6: build the researched addition records in the corpus schema.

Combines the selection (research/03-selection.json), the editorial
classification (tools/classify_additions.py) and the verification data in
research/enrichment/ (MusicBrainz release groups and labels, Wikipedia
infoboxes). Year comes from MusicBrainz's first-release date unless the
classification overrides it with a reason. Label comes from the first-year
release in the artist's own country (tools/research/mb_labels.py). Year
disagreements between MusicBrainz and Wikipedia are flagged for manual review.

New IDs continue the wmm- series from wmm-0121, in selection order.
Writes research/04-enriched-additions.json.
usage: python3 tools/enrich_additions.py
"""
import json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
from classify_additions import C, REJECTED

load = lambda p: json.loads((ROOT / p).read_text())
selection = load('research/03-selection.json')['selection']
mb = load('research/enrichment/musicbrainz.json')
labels = load('research/enrichment/labels.json')
wiki = load('research/enrichment/wikipedia.json')
WIKI_REJECTED = {'cand-0246': 'the automatic match was the 1998 EP, not this album'}
EXTRA_SOURCES = {'cand-0342': ['https://en.wikipedia.org/wiki/Minyo_Crusaders']}
FIRST_ID = 121

def wiki_year(infobox):
    m = re.search(r'(19|20)\d\d', (infobox or {}).get('released') or '')
    return int(m.group(0)) if m else None

records, evidence, rejected = [], [], []
next_id = FIRST_ID
for s in selection:
    cid = s['candidate_id']
    if cid in REJECTED:
        rejected.append({'candidate_id': cid, 'artist_in_source': s['artist_in_source'], 'title_in_source': s['title_in_source'], 'reason': REJECTED[cid]})
        continue
    c = C[cid]
    match = (mb.get(cid) or {}).get('match') or {}
    lab = labels.get(cid) or {}
    w = None if cid in WIKI_REJECTED else wiki.get(cid)
    notes = list(c.get('notes', []))
    review = c.get('review')

    mb_year = int(match['first_release_date'][:4]) if match.get('first_release_date') else None
    year = c.get('year', mb_year)
    if year is None:
        raise SystemExit(f'{cid}: no verified year')
    wy = wiki_year((w or {}).get('infobox'))
    if wy and mb_year and wy != mb_year:
        notes.append(f'MusicBrainz dates the first release to {mb_year}; Wikipedia gives {wy}.')
        review = review or f'Manual review: MusicBrainz ({mb_year}) and Wikipedia ({wy}) disagree on the year.'

    if 'label' in c:
        label = c['label']
    else:
        chosen = (lab.get('chosen_release') or {}).get('labels') or []
        chosen = ['self-released' if l == '[no label]' else l for l in dict.fromkeys(chosen)]
        label = ' / '.join(chosen) or None
        if label is None:
            notes.append('No label is recorded for the first release on MusicBrainz.')
        elif lab.get('basis') == 'earliest dated release' and lab.get('artist_country') and (lab.get('chosen_release') or {}).get('country') not in (None, lab.get('artist_country')):
            notes.append(f"Label is from the earliest documented release ({lab['chosen_release']['country']}); no first-year release from the artist's country is listed on MusicBrainz.")
    if review:
        notes.append(review)

    research_sources = [u for u in [match.get('url'), (lab.get('chosen_release') or {}).get('url'), (w or {}).get('url')] if u] + EXTRA_SOURCES.get(cid, [])
    type_sources = [u for u in [match.get('url'), (w or {}).get('url') if (w or {}).get('infobox', {}).get('type') else None] if u] + EXTRA_SOURCES.get(cid, [])
    src_notes = list(c.get('src_notes', []))
    if s['source_hints'].get('bandcamp_url'):
        src_notes.append('Bandcamp Daily linked this release page: ' + s['source_hints']['bandcamp_url'])
    record = {
        'id': f'wmm-{next_id:04d}',
        'artist': c['artist'], 'title': c['title'], 'label': label, 'year': year,
        'list_number': None, 'list_group': None,
        'source_notes': src_notes,
        'genres': c['genres'], 'styles': c['styles'], 'traits': c['traits'],
        'weirdness': c['w'], 'intensity': c['i'], 'accessibility': c['a'],
        'research_sources': list(dict.fromkeys(research_sources)),
        'research_notes': notes,
        'curation_sources': [{'publication': x['publication'], 'list_title': x['list_title'], 'list_year': x['list_year'], 'rank': x['rank'], 'url': x['url']} for x in s['citations']],
        'release_type': c['rt'],
        'release_type_sources': list(dict.fromkeys(type_sources)),
        'release_type_notes': [],
    }
    next_id += 1
    records.append(record)
    evidence.append({
        'id': record['id'], 'candidate_id': cid, 'area': s['area_label'], 'selection_reason': s['reason'],
        'source_spelling': {'artist': s['artist_in_source'], 'title': s['title_in_source']},
        'list_positions': [{'list_title': x['list_title'], 'position': x['position'], 'rank': x['rank'], 'pick_url': x.get('pick_url')} for x in s['citations']],
        'musicbrainz': {k: match.get(k) for k in ('url', 'artist', 'title', 'first_release_date', 'primary_type', 'secondary_types', 'genres', 'tags')} if match else None,
        'label_basis': {k: lab.get(k) for k in ('basis', 'artist_country', 'first_year_labels')} if lab else None,
        'wikipedia': w, 'wikipedia_rejected': WIKI_REJECTED.get(cid),
        'manual_review': bool(review),
    })

out = {
    'summary': {'records': len(records), 'rejected_in_research': len(rejected), 'manual_review': sum(e['manual_review'] for e in evidence), 'first_id': records[0]['id'], 'last_id': records[-1]['id']},
    'records': records, 'evidence': evidence, 'rejected_in_research': rejected,
}
(ROOT / 'research/04-enriched-additions.json').write_text(json.dumps(out, indent=1, ensure_ascii=False) + '\n')
print(json.dumps(out['summary'], indent=1))
