// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Viacheslav Chukanov (GitHub: Kauter1989)
/* SPbPU career mind-map — UI wiring. */
(function () {
  'use strict';
  const D = window.POLY_DATA;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const graph = new window.PolyGraph($('#graph'), D, { theme: initialTheme() });
  window.__graph = graph;

  function initialTheme() {
    const saved = localStorage.getItem('poly-theme');
    if (saved) return saved;
    return 'dark';
  }

  /* ---------- theme ---------- */
  function applyTheme(t) {
    document.body.dataset.theme = t;
    graph.set('theme', t);
    localStorage.setItem('poly-theme', t);
    const sel = $('#theme'); if (sel) sel.value = t;
    $('#themeBtn').setAttribute('aria-label', t === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему');
    $('#themeBtn').innerHTML = t === 'dark' ? iconSun() : iconMoon();
  }
  function iconSun() { return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'; }
  function iconMoon() { return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>'; }

  /* ---------- stats ---------- */
  const TYPE_LABEL = { institute: 'институтов', direction: 'направлений', discipline: 'дисциплин', role: 'карьерных ролей', company: 'компаний' };
  function updateStats(animate) {
    const s = graph.stats();
    const order = ['institute', 'direction', 'discipline', 'role', 'company'];
    const box = $('#stats');
    box.innerHTML = order.map(k => `<span class="stat"><b data-k="${k}">${s[k]}</b>${TYPE_LABEL[k]}</span>`).join('');
    if (animate) $$('#stats b').forEach(b => countUp(b, +b.textContent));
  }
  function countUp(el, target) {
    const dur = 900, t0 = performance.now();
    function tick(t) { const p = Math.min(1, (t - t0) / dur); el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(tick); }
    requestAnimationFrame(tick);
  }

  /* ---------- institute chips ---------- */
  const activeInst = new Set();
  function buildInstChips() {
    const box = $('#instChips');
    box.innerHTML = D.institutes.map(i =>
      `<button class="chip" data-inst="${i.id}" style="--c:${i.color}" title="${esc(i.name)}"><span class="dot"></span>${esc(i.abbr)}</button>`).join('');
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-inst]'); if (!b) return;
      const id = b.dataset.inst;
      if (activeInst.has(id)) activeInst.delete(id); else activeInst.add(id);
      syncInst();
    });
  }
  function syncInst() {
    $$('#instChips .chip').forEach(c => c.classList.toggle('on', activeInst.has(c.dataset.inst)));
    graph.set('institutes', activeInst.size ? new Set(activeInst) : null);
    updateStats(false);
  }

  /* ---------- controls ---------- */
  function bindRange(id, key, fmt, after) {
    const el = $('#' + id), out = $('#' + id + 'Val');
    const apply = () => { const v = +el.value; graph.set(key, v); if (out) out.textContent = fmt ? fmt(v) : v; if (after) after(v); };
    el.addEventListener('input', apply); apply();
  }
  function bindToggle(id, fn) { const el = $('#' + id); el.addEventListener('change', () => fn(el.checked)); fn(el.checked); }

  function setZoom(k) {
    const cx = graph.w / 2, cy = graph.h / 2;
    const w = graph.toWorld(cx, cy);
    graph.cam.k = k; graph.cam.tx = cx - w.x * k; graph.cam.ty = cy - w.y * k; graph.camTarget = null;
    syncZoom();
  }
  function syncZoom() { const z = $('#zoom'); if (z) { z.value = graph.cam.k.toFixed(2); $('#zoomVal').textContent = graph.cam.k.toFixed(2) + '×'; } }

  function wireControls() {
    $('#layout').addEventListener('change', e => graph.set('layout', e.target.value));
    $('#btnShuffle').addEventListener('click', () => graph.randomize());
    $('#btnReset').addEventListener('click', () => { graph.reset(); syncZoom(); closeDrawer(); });
    $('#zoom').addEventListener('input', e => setZoom(+e.target.value));
    $('#zoomIn').addEventListener('click', () => setZoom(Math.min(4, graph.cam.k * 1.25)));
    $('#zoomOut').addEventListener('click', () => setZoom(Math.max(0.12, graph.cam.k * 0.8)));
    $('#fit').addEventListener('click', () => { graph.fit(true); setTimeout(syncZoom, 600); });
    $('#btnPause').addEventListener('click', togglePause);

    bindRange('nodeScale', 'nodeScale', v => v.toFixed(2) + '×');
    bindRange('linkWidth', 'linkWidth', v => v.toFixed(1));
    bindRange('glow', 'glow', v => Math.round(v * 100) + '%');
    $('#labels').addEventListener('change', e => graph.set('labels', e.target.value));
    bindToggle('particles', v => graph.set('particles', v));
    bindToggle('grid', v => graph.set('grid', v));
    bindRange('repulsion', 'repulsion', v => v);
    bindRange('linkDist', 'linkDist', v => v);
    bindRange('speed', 'speed', v => v.toFixed(1) + '×');
    bindToggle('paused', v => { graph.set('paused', v); syncPause(); });
    bindToggle('layerDisc', v => { graph.set('layers', Object.assign({}, graph.opt.layers, { discipline: v })); updateStats(false); });
    bindToggle('layerRole', v => { graph.set('layers', Object.assign({}, graph.opt.layers, { role: v })); updateStats(false); });
    bindToggle('layerCompany', v => { graph.set('layers', Object.assign({}, graph.opt.layers, { company: v })); updateStats(false); });
    $('#instAll').addEventListener('click', () => { activeInst.clear(); syncInst(); });
    $('#instNone').addEventListener('click', () => { D.institutes.forEach(i => activeInst.add(i.id)); syncInst(); });
    $('#btnPng').addEventListener('click', () => graph.exportPNG());
    $('#btnJson').addEventListener('click', exportJSON);
    $('#theme').addEventListener('change', e => applyTheme(e.target.value));
    $('#themeBtn').addEventListener('click', () => applyTheme(document.body.dataset.theme === 'dark' ? 'light' : 'dark'));
    graph.on('cam', syncZoom);
  }
  function togglePause() { const el = $('#paused'); el.checked = !el.checked; graph.set('paused', el.checked); syncPause(); }
  function syncPause() { const p = graph.opt.paused; $('#btnPause').innerHTML = p ? iconPlay() : iconPause(); $('#btnPause').title = p ? 'Продолжить симуляцию' : 'Пауза симуляции'; }
  function iconPlay() { return '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'; }
  function iconPause() { return '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>'; }
  function exportJSON() {
    const blob = new Blob([JSON.stringify(D, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'spbpu-career-data.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ---------- search ---------- */
  const searchIndex = [];
  graph.nodes.forEach(n => {
    if (n.type === 'applicant') return;
    const hay = (n.label + ' ' + (n.sub || '') + ' ' + (n.data && n.data.code ? n.data.code : '') + ' ' + (n.data && n.data.name ? n.data.name : '')).toLowerCase();
    searchIndex.push({ n, hay });
  });
  function runSearch(q) {
    q = q.trim().toLowerCase();
    const box = $('#searchResults');
    if (!q) { graph.setSearch(new Set()); box.classList.remove('open'); box.innerHTML = ''; return; }
    const matches = searchIndex.filter(x => x.hay.includes(q));
    graph.setSearch(new Set(matches.map(m => m.n.id)));
    const top = matches.slice(0, 8);
    box.innerHTML = top.length ? top.map(m =>
      `<button class="sresult" data-node="${m.n.id}"><span class="stype t-${m.n.type}"></span><span class="sname">${esc(m.n.label)}</span><span class="ssub">${esc(m.n.sub || '')}</span></button>`).join('')
      : '<div class="snone">Ничего не найдено</div>';
    box.classList.add('open');
  }
  function wireSearch() {
    const inp = $('#search');
    inp.addEventListener('input', () => runSearch(inp.value));
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { const first = $('#searchResults .sresult'); if (first) { selectNode(first.dataset.node); inp.blur(); } }
      if (e.key === 'Escape') { inp.value = ''; runSearch(''); inp.blur(); }
    });
    $('#searchResults').addEventListener('click', e => { const b = e.target.closest('[data-node]'); if (b) { selectNode(b.dataset.node); $('#search').value = ''; runSearch(''); } });
    $('#searchClear').addEventListener('click', () => { $('#search').value = ''; runSearch(''); $('#search').focus(); });
    document.addEventListener('click', e => { if (!e.target.closest('.search')) $('#searchResults').classList.remove('open'); });
  }

  /* ---------- tooltip ---------- */
  const TT = { applicant: 'Абитуриент', institute: 'Институт', direction: 'Направление', discipline: 'Дисциплина', role: 'Карьерная роль', company: 'Компания' };
  graph.on('hover', n => {
    const tt = $('#tooltip');
    if (!n) { tt.classList.remove('show'); return; }
    tt.innerHTML = `<span class="tt-type t-${n.type}">${TT[n.type]}</span><b>${esc(n.label)}</b>${n.sub ? `<span>${esc(n.sub)}</span>` : ''}`;
    tt.classList.add('show');
  });
  graph.on('cam', () => { });
  window.addEventListener('pointermove', e => {
    const tt = $('#tooltip'); if (!tt.classList.contains('show')) return;
    const stage = $('.stage').getBoundingClientRect();
    let x = e.clientX - stage.left + 16, y = e.clientY - stage.top + 16;
    if (x + 240 > stage.width) x = e.clientX - stage.left - 240;
    if (y + 80 > stage.height) y = e.clientY - stage.top - 80;
    tt.style.left = x + 'px'; tt.style.top = y + 'px';
  });

  /* ---------- drawer ---------- */
  function chip(id, label, color) {
    const n = graph.byId[id]; if (!n) return '';
    const c = color || n.color;
    return `<button class="dchip" data-node="${id}" style="--c:${c}">${esc(label || n.label)}</button>`;
  }
  function levelBadge(l) { return { bak: 'Бакалавриат', spec: 'Специалитет', mag: 'Магистратура' }[l] || l; }
  function statusBadge(s) { return { partner: 'Стратегический партнёр', anchor: 'Опорный вуз Росатома', open: 'Работодатель · открытые данные' }[s] || s; }

  function trajectoryFor(node) {
    // build a representative applicant→…→company chain for context
    if (node.type === 'direction') {
      const d = node.data; const inst = D.institutes.find(i => i.id === d.inst[0]);
      const role = D.roles.find(r => r.id === d.roles[0]);
      const comp = D.companies.find(c => role && c.roles.includes(role.id));
      return ['Абитуриент', inst ? inst.abbr : '', d.code, role ? role.name : '', comp ? comp.name : ''].filter(Boolean);
    }
    if (node.type === 'company') {
      const c = node.data; const role = D.roles.find(r => c.roles.includes(r.id));
      const dir = D.directions.find(d => role && d.roles.includes(role.id));
      const inst = dir ? D.institutes.find(i => i.id === dir.inst[0]) : null;
      return ['Абитуриент', inst ? inst.abbr : '', dir ? dir.code : '', role ? role.name : '', c.name].filter(Boolean);
    }
    if (node.type === 'role') {
      const r = node.data; const dir = D.directions.find(d => d.roles.includes(r.id));
      const inst = dir ? D.institutes.find(i => i.id === dir.inst[0]) : null;
      const comp = D.companies.find(c => c.roles.includes(r.id));
      return ['Абитуриент', inst ? inst.abbr : '', dir ? dir.code : '', r.name, comp ? comp.name : ''].filter(Boolean);
    }
    return null;
  }

  function renderDrawer(n) {
    const body = $('#drawerBody');
    const head = $('#drawerHead');
    head.innerHTML = `<span class="badge t-${n.type}">${TT[n.type]}</span><h2>${esc(n.label)}</h2>${n.sub ? `<p class="dsub">${esc(n.sub)}</p>` : ''}`;
    let html = '';
    const traj = trajectoryFor(n);
    if (traj) html += `<div class="traj">${traj.map((t, i) => `<span>${esc(t)}</span>${i < traj.length - 1 ? '<i>→</i>' : ''}`).join('')}</div>`;

    if (n.type === 'institute') {
      const i = n.data;
      html += `<p>${esc(i.desc)}</p>`;
      html += `<div class="tags">${i.focus.map(f => `<span class="tag">${esc(f)}</span>`).join('')}</div>`;
      const dirs = D.directions.filter(d => d.inst.includes(i.id));
      html += section('Направления (' + dirs.length + ')', dirs.map(d => chip('dir:' + d.id, d.code + ' · ' + d.name, i.color)).join(''));
      html += links([{ url: i.url, label: 'Сайт института' }, { url: i.ruz, label: 'Расписание (RUZ)' }]);
    }
    else if (n.type === 'direction') {
      const d = n.data;
      html += `<div class="meta"><span class="badge soft">${levelBadge(d.level)}</span><span class="code">${esc(d.code)}</span></div>`;
      html += `<p>${esc(d.desc)}</p>`;
      html += section('Институт', d.inst.map(id => { const i = D.institutes.find(x => x.id === id); return chip('inst:' + id, i.abbr + ' · ' + i.name, i.color); }).join(''));
      if (d.profiles && d.profiles.length) html += section('Профили (' + d.profiles.length + ')', `<ul class="profiles">${d.profiles.map(p => `<li>${esc(p)}</li>`).join('')}</ul>`);
      html += section('Ключевые дисциплины', d.disc.map(x => chip('disc:' + x)).join('') + `<p class="note">Состав ориентировочный; точный учебный план — в репозитории СПбПУ.</p>`);
      html += section('Кем работать', d.roles.map(x => chip('role:' + x)).join(''));
      const comps = D.companies.filter(c => c.roles.some(r => d.roles.includes(r)));
      if (comps.length) html += section('Компании, которым нужны эти специалисты (' + comps.length + ')', comps.map(c => chip('comp:' + c.id, c.name)).join(''));
      html += links([{ url: d.url, label: 'Программа на dep.spbstu.ru' }, { url: 'https://plan.spbstu.ru/', label: 'Учебный план' }, { url: 'https://ruz.spbstu.ru/', label: 'Расписание (RUZ)' }]);
    }
    else if (n.type === 'discipline') {
      const x = n.data;
      html += `<p>${esc(x.desc)}</p>`;
      const dirs = D.directions.filter(d => d.disc.includes(x.id));
      html += section('Входит в направления (' + dirs.length + ')', dirs.map(d => chip('dir:' + d.id, d.code + ' · ' + d.name, graph.instColor[d.inst[0]])).join(''));
    }
    else if (n.type === 'role') {
      const r = n.data;
      html += `<div class="meta"><span class="badge soft">${esc(r.field)}</span><span class="salary">${esc(r.salary)}</span></div>`;
      html += `<p>${esc(r.desc)}</p>`;
      html += section('Ключевые навыки', `<div class="tags">${r.skills.map(s => `<span class="tag">${esc(s)}</span>`).join('')}</div>`);
      const dirs = D.directions.filter(d => d.roles.includes(r.id));
      html += section('Откуда приходят (' + dirs.length + ')', dirs.map(d => chip('dir:' + d.id, d.code + ' · ' + d.name, graph.instColor[d.inst[0]])).join(''));
      const comps = D.companies.filter(c => c.roles.includes(r.id));
      html += section('Кто нанимает (' + comps.length + ')', comps.map(c => chip('comp:' + c.id, c.name)).join(''));
      html += `<p class="note">Диапазон дохода — ориентир по открытым вакансиям (СПб / удалённо), не оферта.</p>`;
    }
    else if (n.type === 'company') {
      const c = n.data;
      html += `<div class="meta"><span class="badge soft">${esc(c.sector)}</span><span class="badge status-${c.status}">${statusBadge(c.status)}</span></div>`;
      html += `<p>${esc(c.desc)}</p>`;
      html += `<div class="why"><b>Почему интересны выпускники Политеха</b><p>${esc(c.note)}</p></div>`;
      html += section('Кого нанимают', c.roles.map(x => chip('role:' + x)).join(''));
      const dirs = D.directions.filter(d => d.roles.some(r => c.roles.includes(r)));
      html += section('Профильные направления (' + dirs.length + ')', dirs.slice(0, 18).map(d => chip('dir:' + d.id, d.code + ' · ' + d.name, graph.instColor[d.inst[0]])).join(''));
      html += links([{ url: c.url, label: 'Сайт компании' }, { url: 'https://www.spbstu.ru/students/employment/', label: 'Карьера в СПбПУ' }]);
    }
    else if (n.type === 'applicant') {
      html += `<p>Начало пути. Выберите институт и направление подготовки, чтобы увидеть дисциплины, карьерные роли и компании, которым нужны такие специалисты.</p>`;
      html += section('Институты', D.institutes.map(i => chip('inst:' + i.id, i.abbr + ' · ' + i.name, i.color)).join(''));
      html += links([{ url: 'https://www.spbstu.ru/applicants/admissions/', label: 'Приёмная комиссия' }, { url: 'https://dep.spbstu.ru/edu/', label: 'Все программы' }]);
    }
    body.innerHTML = html;
    body.scrollTop = 0;
  }
  function section(title, inner) { return `<div class="dsection"><h3>${esc(title)}</h3><div class="dchips">${inner}</div></div>`; }
  function links(arr) { return `<div class="dlinks">${arr.map(a => `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.label)}<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17L17 7M9 7h8v8"/></svg></a>`).join('')}</div>`; }

  function selectNode(id) {
    const n = graph.byId[id]; if (!n) return;
    graph.select(id); graph.focusNode(id);
    renderDrawer(n);
    $('#drawer').classList.add('open');
    $('#hint').classList.add('hide');
  }
  function closeDrawer() { $('#drawer').classList.remove('open'); graph.select(null); }
  graph.on('click', n => { renderDrawer(n); $('#drawer').classList.add('open'); $('#hint').classList.add('hide'); });
  graph.on('background', closeDrawer);
  $('#drawerClose').addEventListener('click', closeDrawer);
  $('#drawerBody').addEventListener('click', e => { const b = e.target.closest('[data-node]'); if (b) selectNode(b.dataset.node); });

  /* ---------- about ---------- */
  function buildAbout() {
    $('#aboutSources').innerHTML = D.meta.sources.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>`).join('');
    $('#aboutDisclaimer').textContent = D.meta.disclaimer;
    const a = D.meta.audit;
    if (a && $('#aboutAudit')) {
      $('#aboutAudit').innerHTML =
        `<p class="audit-date">Аудит ${esc(a.date)} · ${esc(a.method)}</p>` +
        `<ul class="audit-list ok">${a.verified.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` +
        `<ul class="audit-list warn">${a.indicative.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` +
        `<ul class="audit-list note">${a.notes.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
    }
    $('#aboutOpen').addEventListener('click', () => $('#about').classList.add('open'));
    $('#aboutClose').addEventListener('click', () => $('#about').classList.remove('open'));
    $('#about').addEventListener('click', e => { if (e.target.id === 'about') $('#about').classList.remove('open'); });
  }

  /* ---------- keyboard ---------- */
  window.addEventListener('keydown', e => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if (e.key === 'Escape') { if ($('#about').classList.contains('open')) $('#about').classList.remove('open'); else if ($('#drawer').classList.contains('open')) closeDrawer(); else { $('#search').value = ''; runSearch(''); } }
    if (typing) return;
    if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
    if (e.key === ' ') { e.preventDefault(); togglePause(); }
    if (e.key === 'f' || e.key === 'а') { graph.fit(true); setTimeout(syncZoom, 600); }
    if (e.key === 'r' || e.key === 'к') graph.randomize();
  });

  /* ---------- init ---------- */
  buildInstChips();
  wireControls();
  wireSearch();
  buildAbout();
  applyTheme(initialTheme());
  updateStats(true);
  syncZoom(); syncPause();
  // onboarding hint
  if (!localStorage.getItem('poly-hint')) {
    setTimeout(() => $('#hint').classList.add('hide'), 9000);
    localStorage.setItem('poly-hint', '1');
  } else $('#hint').classList.add('hide');
  $('#hint').addEventListener('click', () => $('#hint').classList.add('hide'));
})();