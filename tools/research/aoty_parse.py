"""Parse Quietus Albums of the Year pages: <p><b>N. Artist – <i>Title</i> (Label)</b> or <br>(Label).
usage: aoty_parse.py RAW_DIR OUT_DIR"""
import glob, html, json, os, re, sys
clean = lambda s: re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', s or ''))).strip()
for f in sorted(glob.glob(sys.argv[1] + '/*20*.html')):
    s = open(f, encoding='utf-8').read()
    year = int(re.search(r'20\d\d', os.path.basename(f)).group(0))
    title = clean(re.search(r'<h1[^>]*>(.*?)</h1>', s, re.S).group(1))
    url = re.search(r'<link rel="canonical" href="([^"]+)"', s).group(1)
    picks = []
    for m in re.finditer(r'<p>\s*<b>\s*(\d{1,3})\.\s*(.*?)</b>(.{0,200}?)</p>', s, re.S):
        rank, inner, after = int(m.group(1)), m.group(2), m.group(3)
        it = re.search(r'<i>(.*?)(?:</i>|$)', inner, re.S)  # some entries close </b> before </i>
        artist = clean(re.sub(r'<i>.*', '', inner, flags=re.S)).rstrip(' –-—')
        rest = clean(inner[it.end():]) if it else ''
        label = re.search(r'\(([^)]+)\)', rest + ' ' + clean(after))
        picks.append({'position': rank, 'rank': rank, 'artist': artist, 'title': clean(it.group(1)) if it else '', 'label_in_source': label.group(1) if label else None})
    rec = {'publication': 'The Quietus', 'list_title': f'Albums of the Year {year}', 'page_title': title, 'list_type': 'Year-end list (ranked)', 'list_year': year, 'url': url, 'picks': sorted(picks, key=lambda p: p['rank'])}
    json.dump(rec, open(os.path.join(sys.argv[2], f'quietus-aoty-{year}.json'), 'w'), indent=1, ensure_ascii=False)
    ranks = [p['rank'] for p in picks]
    print(year, len(picks), 'ranks ok' if sorted(ranks) == list(range(1, len(ranks) + 1)) else 'RANK GAP', [p for p in picks if not p['title'] or not p['artist']][:3])
