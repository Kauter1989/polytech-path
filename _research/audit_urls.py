# -*- coding: utf-8 -*-
# SPDX-License-Identifier: Apache-2.0
"""Sweep every URL referenced in js/data.js for HTTP reachability (HEAD then GET)."""
import re, json, urllib.request, urllib.error, socket
from concurrent.futures import ThreadPoolExecutor

src = open(r'E:\projects\spbpu-mindmap\js\data.js', encoding='utf-8').read()
urls = sorted(set(re.findall(r'https?://[^"\'\\\s]+', src)))

def probe(u):
    for method in ('HEAD', 'GET'):
        try:
            req = urllib.request.Request(u, method=method, headers={'User-Agent': 'Mozilla/5.0 (audit; +https://github.com/Kauter1989/polytech-path)'})
            with urllib.request.urlopen(req, timeout=18) as r:
                return u, r.status, method
        except urllib.error.HTTPError as e:
            if method == 'GET' or e.code not in (403, 405, 501):
                return u, e.code, method
        except (urllib.error.URLError, socket.timeout, OSError, ValueError) as e:
            if method == 'GET':
                return u, 'ERR:' + type(e).__name__, method
    return u, 'ERR', 'GET'

with ThreadPoolExecutor(max_workers=8) as ex:
    results = list(ex.map(probe, urls))

lines = ['%s | %s | %s' % (code, m, u) for u, code, m in results]
open(r'E:\projects\spbpu-mindmap\_research\audit\url_status.txt', 'w', encoding='utf-8').write('\n'.join(lines))
bad = [l for l in lines if not l.startswith('200')]
print('TOTAL', len(lines), 'NON-200', len(bad))
print('\n'.join(bad))