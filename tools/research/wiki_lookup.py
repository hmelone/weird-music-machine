"""Stage 6 helper: find each selected record's English Wikipedia album article and read its infobox.

Tries any en.wikipedia URL MusicBrainz links, then the usual article titles
("Title (Artist album)", "Title (album)", "Title"). A page is accepted only if
it has an album infobox whose artist field matches the record's artist.
Fetches /wiki/<title>?action=raw (robots.txt allows /wiki/; /w/ and /api/ are disallowed).
usage: wiki_lookup.py SELECTION_JSON MB_JSON RAW_DIR OUT_JSON
"""
import json, os, re, sys, time, unicodedata, urllib.parse, urllib.request
sel_path, mb_path, raw, out_path = sys.argv[1:5]
UA = 'WeirdMusicMachineResearch/1.0 (Claude-User; https://github.com/hmelone/weird-music-machine)'
os.makedirs(raw, exist_ok=True)
def norm(s): return re.sub(r'[^a-z0-9]', '', unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower().replace('&', 'and'))
def fetch(title):
    path = os.path.join(raw, re.sub(r'[^\w.-]', '_', title)[:150] + '.wiki')
    if os.path.exists(path): return open(path, encoding='utf-8').read()
    url = 'https://en.wikipedia.org/wiki/' + urllib.parse.quote(title.replace(' ', '_')) + '?action=raw'
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=30) as r: text = r.read().decode('utf-8')
    except Exception: text = ''
    time.sleep(0.3)
    open(path, 'w', encoding='utf-8').write(text)
    return text
def field(box, name):
    m = re.search(r'\|\s*' + name + r'\s*=\s*(.*?)(?=\n\s*\||\n\}\})', box, re.S)
    if not m: return None
    v = re.sub(r'<ref[^>]*/>|<ref[^>]*>.*?</ref>|<!--.*?-->', '', m.group(1), flags=re.S)
    v = re.sub(r'\[\[(?:[^|\]]*\|)?([^\]]+)\]\]', r'\1', v)
    v = re.sub(r'\{\{(?:start date|release date|dts|Start date)[^}]*?\|(\d{4})(?:\|(\d{1,2}))?(?:\|(\d{1,2}))?[^}]*\}\}', lambda m: '-'.join(x for x in m.groups() if x), v, flags=re.I)
    v = re.sub(r'\{\{(?:hlist|flatlist|ubl|unbulleted list|plainlist)\s*\|?', '', v, flags=re.I)
    v = re.sub(r'\{\{nowrap\|([^}]*)\}\}', r'\1', v, flags=re.I)
    v = re.sub(r'[{}]|\*', ' ', v).replace('|', ', ')
    v = re.sub(r"'''?|<br\s*/?>", ', ', v)
    return re.sub(r'\s*,\s*(,\s*)*', ', ', re.sub(r'\s+', ' ', v)).strip(' ,') or None
selection = json.load(open(sel_path))['selection']; mb = json.load(open(mb_path))
out = {}
for s in selection:
    cid = s['candidate_id']; m = (mb.get(cid) or {}).get('match') or {}
    artist = m.get('artist') or s['artist_in_source']; title = m.get('title') or s['title_in_source']
    tries = [urllib.parse.unquote(u.split('/wiki/')[1]).replace('_', ' ') for u in m.get('urls', []) if 'en.wikipedia.org/wiki/' in u]
    year = (m.get('first_release_date') or '')[:4]
    names = list(dict.fromkeys(x.replace('\u2010', '-').replace('\u2019', "'") for x in (artist, s['artist_in_source'])))
    titles = list(dict.fromkeys(x.replace('\u2010', '-').replace('\u2019', "'") for x in (title, s['title_in_source'])))
    for t in titles:
        for a in names: tries.append(f'{t} ({a} album)')
        tries += [f'{t} ({year} album)', f'{t} (album)', f'{t} (EP)', t]
    found = None
    for t in dict.fromkeys(tries):
        text = fetch(t)
        red = re.match(r'#REDIRECT\s*\[\[([^\]#]+)', text, re.I)
        if red: t, text = red.group(1), fetch(red.group(1))
        box = re.search(r'\{\{\s*Infobox album(.*?)\n\}\}', text, re.S | re.I)
        if not box: continue
        box = box.group(0)
        art = field(box, 'artist') or ''
        if norm(art) and (norm(art) in norm(artist) or norm(artist) in norm(art) or norm(art.split(',')[0]) in norm(artist)):
            found = {'title': t, 'url': 'https://en.wikipedia.org/wiki/' + urllib.parse.quote(t.replace(' ', '_')), 'infobox': {k: field(box, k) for k in ('name', 'artist', 'type', 'released', 'recorded', 'genre', 'label', 'length', 'producer')}}
            break
    out[cid] = found
    print(cid, '|', artist, '—', title, '=>', (found or {}).get('title'), '|', ((found or {}).get('infobox') or {}).get('genre'), flush=True)
json.dump(out, open(out_path, 'w'), indent=1, ensure_ascii=False)
