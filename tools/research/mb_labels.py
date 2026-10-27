"""Stage 6 helper: choose each record's original label from MusicBrainz.

For every matched release group, fetch all its releases with labels, and the
primary artist's country. The label is taken from the earliest release in the
first-release year that was issued in the artist's own country, falling back
to the earliest dated release. All first-year labels are kept for review.
usage: mb_labels.py MB_JSON RAW_DIR OUT_JSON
"""
import json, os, sys, time, urllib.error, urllib.request
mb_path, raw, out_path = sys.argv[1:4]
UA = 'WeirdMusicMachineResearch/1.0 (Claude-User; https://github.com/hmelone/weird-music-machine)'
def get(url, cache):
    path = os.path.join(raw, cache)
    if os.path.exists(path): return json.load(open(path))
    for attempt in range(5):
        time.sleep(1.2 + 4 * attempt)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=40) as r: data = json.load(r); break
        except urllib.error.HTTPError as e:
            if e.code != 503 or attempt == 4: raise
    json.dump(data, open(path, 'w'), ensure_ascii=False)
    return data
mb = json.load(open(mb_path)); out = {}
for cid, entry in mb.items():
    m = entry.get('match')
    if not m: continue
    cached = [f for f in (f'{cid}-rg-r1.json', f'{cid}-rg.json') if os.path.exists(os.path.join(raw, f))]
    rg = json.load(open(os.path.join(raw, cached[0]))) if cached else get(f"https://musicbrainz.org/ws/2/release-group/{m['id']}?fmt=json&inc=artist-credits+genres+tags+url-rels+releases", f'{cid}-rg-hand.json')
    if not cached:  # hand-resolved match: fill in what the search pass would have recorded
        m.update({'first_release_date': rg.get('first-release-date'), 'primary_type': rg.get('primary-type'), 'secondary_types': rg.get('secondary-types', []), 'genres': [g['name'] for g in rg.get('genres', [])], 'tags': [t['name'] for t in rg.get('tags', [])][:12], 'urls': sorted({r['url']['resource'] for r in rg.get('relations', []) if r.get('url')})})
    artist_id = (rg.get('artist-credit') or [{}])[0].get('artist', {}).get('id')
    artist = get(f'https://musicbrainz.org/ws/2/artist/{artist_id}?fmt=json', f'artist-{artist_id}.json') if artist_id else {}
    rels = get(f"https://musicbrainz.org/ws/2/release?release-group={m['id']}&inc=labels&fmt=json&limit=100", f'{cid}-releases.json').get('releases', [])
    first_year = (m.get('first_release_date') or '')[:4]
    dated = sorted([r for r in rels if r.get('date')], key=lambda r: r['date'])
    year_rels = [r for r in dated if r['date'][:4] == first_year] or dated
    home = [r for r in year_rels if artist.get('country') and r.get('country') == artist.get('country')]
    chosen = (home or year_rels or rels or [None])[0]
    labels = lambda r: [li['label']['name'] for li in r.get('label-info', []) if li.get('label')] if r else []
    out[cid] = {'artist_country': artist.get('country'), 'chosen_release': {'id': chosen.get('id'), 'date': chosen.get('date'), 'country': chosen.get('country'), 'labels': labels(chosen), 'url': f"https://musicbrainz.org/release/{chosen.get('id')}"} if chosen else None, 'basis': 'first-year release in artist country' if home else 'earliest dated release', 'first_year_labels': sorted({l for r in year_rels for l in labels(r)})}
    print(cid, artist.get('country'), out[cid]['basis'], out[cid]['chosen_release'] and out[cid]['chosen_release']['labels'], out[cid]['first_year_labels'], flush=True)
json.dump(out, open(out_path, 'w'), indent=1, ensure_ascii=False)
json.dump(mb, open(mb_path, 'w'), indent=1, ensure_ascii=False)  # keeps the filled-in hand-resolved matches
