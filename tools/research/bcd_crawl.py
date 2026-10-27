"""Crawl chosen Bandcamp Daily lists/guides; one JSON per list with every featured release, in page order.
usage: bcd_crawl.py RAW_DIR OUT_DIR slug [slug ...]"""
import html, json, os, re, subprocess, sys, time
raw, out, slugs = sys.argv[1], sys.argv[2], sys.argv[3:]
GET = os.path.join(os.path.dirname(__file__), 'get.sh')
clean = lambda s: re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', s or ''))).strip()
for slug in slugs:
    path = os.path.join(raw, slug + '.html'); url = 'https://daily.bandcamp.com/lists/' + slug
    if not os.path.exists(path) or os.path.getsize(path) < 5000:
        subprocess.run([GET, url, path], stdout=subprocess.DEVNULL); time.sleep(0.5)
    s = open(path, encoding='utf-8', errors='replace').read()
    title = clean((re.search(r'<article-title>(.*?)</article-title>', s, re.S) or re.search(r'<title>(.*?)</title>', s, re.S)).group(1))
    credits = clean((re.search(r'<article-credits>(.*?)</article-credits>', s, re.S) or [None, ''])[1])
    date = re.search(r'"datePublished":\s*"([^"]+)', s)
    m = re.search(r'data-player-infos="([^"]+)"', s)
    picks = []
    for i, p in enumerate([p for p in (json.loads(html.unescape(m.group(1))) if m else []) if p], 1):
        picks.append({'position': i, 'artist': p.get('band_name') or '', 'title': p.get('title') or '', 'bandcamp_url': p.get('tralbum_url'), 'item_type': {'a': 'album', 't': 'track'}.get(p.get('parent_tralbum_type'), p.get('parent_tralbum_type')), 'band_location': p.get('band_location')})
    rec = {'publication': 'Bandcamp Daily', 'list_title': title, 'credits': credits, 'list_type': 'Bandcamp Daily list/guide (editorial; featured releases in page order, unranked)', 'url': url, 'published': date.group(1) if date else None, 'picks': picks}
    json.dump(rec, open(os.path.join(out, 'bcd-' + slug[:70] + '.json'), 'w'), indent=1, ensure_ascii=False)
    print(len(picks), (date.group(1)[:10] if date else '?'), title, '|', credits[:60])
