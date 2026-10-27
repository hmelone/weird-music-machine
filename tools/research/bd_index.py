import re, sys, glob, json, html
out = {}
for f in glob.glob(sys.argv[1] + '/p*.html'):
    s = open(f, encoding='utf-8', errors='replace').read()
    if 'Page not found' in s[:3000]: continue
    for m in re.finditer(r'<a[^>]+href="(https://thequietus.com/interviews/bakers-dozen/[^"]+)"[^>]*>(.*?)</a>', s, re.S):
        text = html.unescape(re.sub(r'<[^>]+>', ' ', m.group(2))).strip()
        text = re.sub(r'\s+', ' ', text)
        if text and len(text) > len(out.get(m.group(1), '')): out[m.group(1)] = text
json.dump(out, open(sys.argv[2], 'w'), indent=1, ensure_ascii=False)
print(len(out))
