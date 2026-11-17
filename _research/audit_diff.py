# -*- coding: utf-8 -*-
# SPDX-License-Identifier: Apache-2.0
"""Audit: diff current dep.spbstu.ru/edu against the Nov-14 snapshot; extract ruz faculties,
structure institutes and strategic partners from fresh snapshots."""
import re, json, os
from lxml import html

A = r'E:\projects\spbpu-mindmap\_research\audit'
R = r'E:\projects\spbpu-mindmap\_research'

dir_re = re.compile(r'^https?://dep\.spbstu\.ru/edu/(\d{2}\.\d{2}\.\d{2})/?$')
prof_re = re.compile(r'^https?://dep\.spbstu\.ru/edu/(\d{2}\.\d{2}\.\d{2})/\1_(\d+)/?$')

def text(a): return ' '.join(a.text_content().split())

def parse_edu(path):
    doc = html.parse(path).getroot()
    recs = []; cur = None
    for el in doc.iter():
        if el.tag != 'a': continue
        href = el.get('href') or ''
        m = dir_re.match(href)
        if m:
            cur = {'code': m.group(1), 'title': text(el), 'profiles': [], 'institutes': []}
            recs.append(cur); continue
        m = prof_re.match(href)
        if m and cur and m.group(1) == cur['code']:
            cur['profiles'].append(text(el)); continue
        if cur is not None and href and 'spbstu.ru' in href and not href.startswith('https://dep.spbstu.ru/edu'):
            t = text(el)
            if t and len(t) > 3 and ('нститут' in t or 'школа' in t or 'олледж' in t or 'Гуманитарный' in t):
                if t not in cur['institutes']: cur['institutes'].append(t)
    for r in recs:
        r['name'] = re.sub(r'^\d{2}\.\d{2}\.\d{2}\s*', '', r['title']).strip('«» ')
    return recs

cur = parse_edu(os.path.join(A, 'edu_current.html'))
old = json.load(open(os.path.join(R, 'programs.json'), encoding='utf-8'))['programs']
json.dump({'programs': cur}, open(os.path.join(A, 'programs_current.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

def key(r): return (r['code'], tuple(r['institutes']))
oldmap = {}
for r in old: oldmap.setdefault(r['code'], []).append(r)
curmap = {}
for r in cur: curmap.setdefault(r['code'], []).append(r)

lines = []
lines.append('=== PROGRAM COUNT old=%d current=%d ===' % (len(old), len(cur)))
added = set(curmap) - set(oldmap)
removed = set(oldmap) - set(curmap)
lines.append('ADDED codes: ' + (', '.join(sorted(added)) or 'none'))
lines.append('REMOVED codes: ' + (', '.join(sorted(removed)) or 'none'))
for code in sorted(set(curmap) & set(oldmap)):
    c = curmap[code]; o = oldmap[code]
    # compare institute sets and names and profile counts
    ci = sorted(set(i for r in c for i in r['institutes']))
    oi = sorted(set((i['name'] if isinstance(i, dict) else i) for r in o for i in r['institutes']))
    cn = sorted(set(r['name'] for r in c)); on = sorted(set(r['name'] for r in o))
    cp = sum(len(r['profiles']) for r in c); op = sum(len(r['profiles']) for r in o)
    if ci != oi or cn != on or cp != op:
        lines.append('CHANGED %s' % code)
        if cn != on: lines.append('   name old=%s new=%s' % (on, cn))
        if ci != oi: lines.append('   inst old=%s new=%s' % (oi, ci))
        if cp != op: lines.append('   profiles old=%d new=%d' % (op, cp))

# ruz faculties
doc = html.parse(os.path.join(A, 'ruz_current.html')).getroot()
lines.append('=== RUZ FACULTIES ===')
for a in doc.iter('a'):
    href = a.get('href') or ''
    m = re.match(r'^/faculty/(\d+)/groups', href)
    if m: lines.append('%s | %s' % (m.group(1), text(a)))

# structure institutes (subdomain links + gi)
doc = html.parse(os.path.join(A, 'structure_current.html')).getroot()
lines.append('=== STRUCTURE INSTITUTE LINKS ===')
seen = set()
for a in doc.iter('a'):
    href = a.get('href') or ''; t = text(a)
    if not t: continue
    if re.match(r'^https?://[a-z]+\.spbstu\.ru/?$', href) or href == '/structure/gumanitarnyy_institut/':
        if ('нститут' in t or 'школа' in t or 'Гуманитарный' in t) and (href, t) not in seen:
            seen.add((href, t)); lines.append('%s | %s' % (t, href))

# partners
doc = html.parse(os.path.join(A, 'partners_current.html')).getroot()
lines.append('=== STRATEGIC PARTNERS (img alt) ===')
for img in doc.iter('img'):
    alt = img.get('alt') or ''
    if alt and len(alt) > 2: lines.append(alt)

out = '\n'.join(lines)
open(os.path.join(A, 'audit_diff.txt'), 'w', encoding='utf-8').write(out)
print(out)