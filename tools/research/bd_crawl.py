"""Crawl chosen Quietus Baker's Dozens; write one JSON per list with every pick.
usage: bd_crawl.py RAW_DIR OUT_DIR slug [slug ...]"""
import html, json, os, re, subprocess, sys
raw, out, slugs = sys.argv[1], sys.argv[2], sys.argv[3:]
GET = os.path.join(os.path.dirname(__file__), 'get.sh')
BASE = 'https://thequietus.com/interviews/bakers-dozen/'
def fetch(url, path):
    if not os.path.exists(path) or os.path.getsize(path) < 5000:
        subprocess.run([GET, url, path], check=False, stdout=subprocess.DEVNULL)
    return open(path, encoding='utf-8', errors='replace').read()
clean = lambda s: re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', s))).strip()
for slug in slugs:
    d = os.path.join(raw, slug); os.makedirs(d, exist_ok=True)
    first = fetch(BASE + slug + '/', os.path.join(d, '1.html'))
    title = clean(re.search(r'<h1[^>]*>(.*?)</h1>', first, re.S).group(1))
    date = (re.search(r'"datePublished":"([^"]+)"', first) or re.search(r'article:published_time" content="([^"]+)"', first))
    pages = max([int(n) for n in re.findall(re.escape(BASE + slug) + r'/(\d+)/', first)] or [1])
    picks = []
    for n in range(2, pages + 1):
        s = fetch(BASE + slug + f'/{n}/', os.path.join(d, f'{n}.html'))
        h = re.search(r'<h1[^>]*>(.*?)</h1>', s, re.S)
        if not h: continue
        inner = h.group(1)
        num = re.search(r"class='number'>\s*(\d+)", inner)
        em = re.search(r'<em>(.*?)</em>', inner, re.S)
        artist_part = re.sub(r"<span class='number'>.*?</span>", '', inner, flags=re.S)
        artist_part = re.sub(r'<em>.*?</em>', '', artist_part, flags=re.S)
        para = re.search(r'</figure>.*?<p>(?:\s*<p>)?(?:\s*<(?:b|strong)>.*?</(?:b|strong)>\s*</p>\s*<p>)?(.*?)</p>', s, re.S)
        excerpt = clean(para.group(1)) if para else ''
        source = 'heading'
        if not (em and clean(em.group(1))):
            # Older migrated pages put the pick in the body as <b>Artist – <i>Title</i></b>.
            body = s[h.end():]
            b = re.search(r'<p>\s*(?:<p>)?\s*<(?:b|strong)>(.*?)</(?:b|strong)>', body, re.S)
            if b:
                bold = b.group(1)
                it = re.search(r'<i>(.*?)</i>', bold, re.S)
                if it:
                    em = it; artist_part = re.sub(r'<i>.*?</i>', '', bold, flags=re.S); source = 'body bold text'
                else:
                    parts = re.split(r'\s+[–—-]\s+', clean(bold), maxsplit=1)
                    if len(parts) == 2: artist_part, em, source = parts[0], None, 'body bold text'; inner_title = parts[1]
        title_text = clean(em.group(1)) if em else (locals().get('inner_title') or '')
        inner_title = None
        if not clean(artist_part) and not title_text: source = 'unparsed'
        picks.append({'position': int(num.group(1)) if num else None, 'artist': clean(artist_part), 'title': title_text, 'heading': clean(inner), 'parsed_from': source, 'page_url': BASE + slug + f'/{n}/'})
    rec = {'publication': 'The Quietus', 'list_title': title, 'list_type': "Baker's Dozen (artist-curated favourite records; numbered for presentation, unranked)", 'url': BASE + slug + '/', 'published': date.group(1) if date else None, 'picks': picks}
    json.dump(rec, open(os.path.join(out, 'quietus-bd-' + slug[:60] + '.json'), 'w'), indent=1, ensure_ascii=False)
    print(len(picks), date.group(1)[:10] if date else '?', title)
