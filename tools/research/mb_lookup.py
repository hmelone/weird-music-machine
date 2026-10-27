"""Stage 6 helper: look up each selected record on MusicBrainz (1 request/second, per MB policy).

For each selection it searches release groups by artist + title, keeps the
top candidates with their scores, and for the best match fetches the release
group (first-release date, type, genres, tags, URL relations such as Wikipedia)
and its earliest release (label, catalogue number, country).
Raw responses are cached under RAW_DIR so the run is repeatable.
Entries may carry mb_artist / mb_title (corrected query) or mb_release_group (chosen by hand).
usage: mb_lookup.py SELECTION_JSON RAW_DIR OUT_JSON
"""
import json, os, re, sys, time, urllib.parse, urllib.request
sel_path, raw, out_path = sys.argv[1:4]
UA = 'WeirdMusicMachineResearch/1.0 (Claude-User; https://github.com/hmelone/weird-music-machine)'
os.makedirs(raw, exist_ok=True)
last = [0.0]
def get(url, cache):
    path = os.path.join(raw, cache)
    if os.path.exists(path): return json.load(open(path))
    wait = 1.1 - (time.time() - last[0])
    if wait > 0: time.sleep(wait)
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=40) as r: data = json.load(r); break
        except Exception as e:
            if attempt == 3: data = {'error': str(e)}
            time.sleep(3 * (attempt + 1))
    last[0] = time.time()
    json.dump(data, open(path, 'w'), ensure_ascii=False)
    return data
def lucene(s): return re.sub(r'([+\-&|!(){}\[\]^"~*?:\\/])', r'\\\1', s)
selection = json.load(open(sel_path))['selection']
out = {}
for s in selection:
    cid = s['candidate_id']
    artist, title = s.get('mb_artist') or s['artist_in_source'], s.get('mb_title') or s['title_in_source']
    if s.get('mb_release_group'):  # a release group chosen by hand after reading the search hits
        groups = [{'id': s['mb_release_group'], 'score': None, 'title': title, 'artist-credit': [{'name': artist}]}]
    else:
        q = f'releasegroup:"{lucene(title)}" AND artist:"{lucene(artist)}"'
        res = get('https://musicbrainz.org/ws/2/release-group/?fmt=json&limit=5&query=' + urllib.parse.quote(q), f'{cid}-search{s.get("retry", "")}.json')
        groups = res.get('release-groups', [])
    if not groups:  # retry loosely: title only plus artist words
        q2 = f'releasegroup:({lucene(title)}) AND artist:({lucene(artist)})'
        res = get('https://musicbrainz.org/ws/2/release-group/?fmt=json&limit=5&query=' + urllib.parse.quote(q2), f'{cid}-search2{s.get("retry", "")}.json')
        groups = res.get('release-groups', [])
    entry = {'query_artist': artist, 'query_title': title, 'search_hits': [{'id': g['id'], 'score': g.get('score'), 'title': g.get('title'), 'artist': ''.join(a.get('name', '') + a.get('joinphrase', '') for a in g.get('artist-credit', [])), 'first_release_date': g.get('first-release-date'), 'primary_type': g.get('primary-type'), 'secondary_types': g.get('secondary-types', [])} for g in groups]}
    if groups:
        best = groups[0]
        rg = get(f"https://musicbrainz.org/ws/2/release-group/{best['id']}?fmt=json&inc=artist-credits+genres+tags+url-rels+releases", f'{cid}-rg{s.get("retry", "")}.json')
        releases = sorted([r for r in rg.get('releases', []) if r.get('date')], key=lambda r: r['date']) or rg.get('releases', [])
        first = None
        if releases:
            rel = get(f"https://musicbrainz.org/ws/2/release/{releases[0]['id']}?fmt=json&inc=labels", f'{cid}-rel{s.get("retry", "")}.json')
            first = {'id': rel.get('id'), 'title': rel.get('title'), 'date': rel.get('date'), 'country': rel.get('country'), 'status': rel.get('status'), 'labels': [{'name': (li.get('label') or {}).get('name'), 'catno': li.get('catalog-number')} for li in rel.get('label-info', [])]}
        entry['match'] = {'id': rg.get('id'), 'url': f"https://musicbrainz.org/release-group/{rg.get('id')}", 'title': rg.get('title'), 'artist': ''.join(a.get('name', '') + a.get('joinphrase', '') for a in rg.get('artist-credit', [])), 'first_release_date': rg.get('first-release-date'), 'primary_type': rg.get('primary-type'), 'secondary_types': rg.get('secondary-types', []), 'genres': [g['name'] for g in sorted(rg.get('genres', []), key=lambda g: -g.get('count', 0))], 'tags': [t['name'] for t in sorted(rg.get('tags', []), key=lambda t: -t.get('count', 0))][:12], 'urls': sorted({r['url']['resource'] for r in rg.get('relations', []) if r.get('url')}), 'release_count': len(rg.get('releases', [])), 'earliest_release': first}
    out[cid] = entry
    m = entry.get('match') or {}
    print(cid, '|', artist, '—', title, '=>', m.get('artist'), '—', m.get('title'), m.get('first_release_date'), m.get('primary_type'), m.get('secondary_types'), (entry['search_hits'][0]['score'] if entry['search_hits'] else None), flush=True)
json.dump(out, open(out_path, 'w'), indent=1, ensure_ascii=False)
