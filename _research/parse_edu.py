# -*- coding: utf-8 -*-
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Viacheslav Chukanov (GitHub: Kauter1989)
import re, json, sys
from lxml import html

doc = html.parse(r'E:\projects\spbpu-mindmap\_research\edu.html').getroot()

dir_re = re.compile(r'^https?://dep\.spbstu\.ru/edu/(\d{2}\.\d{2}\.\d{2})/?$')
prof_re = re.compile(r'^https?://dep\.spbstu\.ru/edu/(\d{2}\.\d{2}\.\d{2})/\1_(\d+)/?$')

def text(a):
    return ' '.join(a.text_content().split())

level = None
records = []
cur = None
for el in doc.iter():
    if el.tag in ('h1','h2','h3','h4'):
        t = text(el)
        for lv in ('Бакалавриат','Магистратура','Специалитет','Аспирантура','Среднее профессиональное образование'):
            if t.strip() == lv:
                level = lv
    if el.tag != 'a':
        continue
    href = el.get('href') or ''
    m = dir_re.match(href)
    if m:
        cur = {'code': m.group(1), 'title': text(el), 'level': level, 'profiles': [], 'institutes': []}
        records.append(cur)
        continue
    m = prof_re.match(href)
    if m and cur and m.group(1) == cur['code']:
        cur['profiles'].append(text(el))
        continue
    # institute links: spbstu subdomains or structure pages
    if cur is not None and href and ('spbstu.ru' in href) and not href.startswith('https://dep.spbstu.ru/edu'):
        t = text(el)
        if t and len(t) > 3 and ('нститут' in t or 'школа' in t or 'олледж' in t or 'Гуманитарный' in t):
            if t not in cur['institutes']:
                cur['institutes'].append({'name': t, 'url': href})

# clean titles: remove leading code
for r in records:
    r['name'] = re.sub(r'^\d{2}\.\d{2}\.\d{2}\s*', '', r['title']).strip('«» ')

out = {'count': len(records), 'programs': records}
with open(r'E:\projects\spbpu-mindmap\_research\programs.json','w',encoding='utf-8') as f:
    json.dump(out, f, ensure_ascii=False, indent=1)

# summary
from collections import Counter
lv = Counter(r['level'] for r in records)
print('LEVELS:', dict(lv))
for r in records:
    inst = '; '.join(i['name'] for i in r['institutes']) or '???'
    print(f"{r['code']} | {r['name']} | {r['level']} | {inst} | profiles={len(r['profiles'])}")