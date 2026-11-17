// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Viacheslav Chukanov (GitHub: Kauter1989)
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'file:///E:/projects/spbpu-mindmap/index.html';
const SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const errors = [];
(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--force-color-profile=srgb'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500); // let simulation settle + fonts

  // basic state
  const state = await page.evaluate(() => {
    const g = window.__graph;
    return { nodes: g.nodes.length, edges: g.edges.length, cam: g.cam, w: g.w, h: g.h, theme: document.body.dataset.theme };
  });
  console.log('STATE', JSON.stringify(state));

  // canvas non-blank check
  const painted = await page.evaluate(() => {
    const c = document.querySelector('#graph');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 8) n++;
    return n;
  });
  console.log('PAINTED_SAMPLES', painted);

  await page.screenshot({ path: path.join(SHOTS, '01-desktop-dark.png') });

  // select a direction node via API + open drawer
  await page.evaluate(() => { const g = window.__graph; const n = g.nodes.find(x => x.type === 'direction' && x.data.code === '09.03.04'); g.select(n.id); g.focusNode(n.id); document.querySelector('#drawer').classList.add('open'); document.querySelector('#drawerHead').innerHTML = '<h2>test</h2>'; });
  // trigger real renderDrawer through a chip click path: use search instead
  await page.fill('#search', 'Программная инженерия');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, '02-search.png') });
  const sres = await page.evaluate(() => document.querySelectorAll('#searchResults .sresult').length);
  console.log('SEARCH_RESULTS', sres);
  await page.click('#searchResults .sresult');
  await page.waitForTimeout(900);
  const drawerTxt = await page.evaluate(() => document.querySelector('#drawerBody').innerText.slice(0, 120));
  console.log('DRAWER', JSON.stringify(drawerTxt));
  await page.screenshot({ path: path.join(SHOTS, '03-drawer-direction.png') });

  // company drawer
  await page.evaluate(() => { const g = window.__graph; const n = g.nodes.find(x => x.type === 'company' && x.data.id === 'sber'); g.select(n.id); });
  await page.evaluate(() => { const ev = new Event('x'); window.__graph.emit('click', window.__graph.byId['comp:sber']); });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(SHOTS, '04-drawer-company.png') });

  // close drawer, radial layout
  await page.click('#drawerClose');
  await page.selectOption('#layout', 'radial');
  await page.waitForTimeout(1800);
  await page.evaluate(() => window.__graph.fit(true));
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(SHOTS, '05-radial.png') });

  // back to flow, light theme
  await page.selectOption('#layout', 'flow');
  await page.waitForTimeout(1500);
  await page.click('#themeBtn');
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__graph.fit(true));
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(SHOTS, '06-desktop-light.png') });

  // institute filter
  await page.click('#themeBtn'); // back to dark
  await page.click('#instChips .chip[data-inst="iccs"]');
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__graph.fit(true));
  await page.waitForTimeout(800);
  const filtered = await page.evaluate(() => window.__graph.stats());
  console.log('FILTERED_STATS', JSON.stringify(filtered));
  await page.screenshot({ path: path.join(SHOTS, '07-filter-iccs.png') });
  await page.click('#instAll');
  await page.waitForTimeout(800);

  // sliders live
  await page.evaluate(() => { const set = (id, v) => { const el = document.querySelector('#' + id); el.value = v; el.dispatchEvent(new Event('input')); }; set('nodeScale', 1.6); set('glow', 1.3); set('repulsion', 3500); });
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__graph.fit(true));
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, '08-sliders.png') });

  // PNG export download
  const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  await page.click('#btnPng');
  const download = await dl;
  console.log('PNG_DOWNLOAD', download ? download.suggestedFilename() : 'NONE');
  if (download) await download.saveAs(path.join(SHOTS, 'export.png'));

  // ---- stability & performance ----
  // FPS while simulation active
  await page.evaluate(() => window.__graph.reheat(0.8));
  const fps = await page.evaluate(() => new Promise(res => {
    let n = 0; const t0 = performance.now();
    function tick(t) { n++; if (t - t0 < 1200) requestAnimationFrame(tick); else res(Math.round(n / ((t - t0) / 1000))); }
    requestAnimationFrame(tick);
  }));
  console.log('FPS', fps);

  // drag a node with the mouse
  const dragInfo = await page.evaluate(() => {
    const g = window.__graph; const n = g.byId['inst:iccs'];
    const s = g.toScreen(n.x, n.y); return { x: s.x, y: s.y, ox: n.x, oy: n.y };
  });
  const stageBox = await page.locator('.stage').boundingBox();
  await page.mouse.move(stageBox.x + dragInfo.x, stageBox.y + dragInfo.y);
  await page.mouse.down();
  await page.mouse.move(stageBox.x + dragInfo.x + 90, stageBox.y + dragInfo.y + 60, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const afterDrag = await page.evaluate(() => { const n = window.__graph.byId['inst:iccs']; return { x: n.x, y: n.y, fx: n.fx }; });
  console.log('DRAG', JSON.stringify({ moved: Math.abs(afterDrag.x - dragInfo.ox) > 5, released: afterDrag.fx === null }));

  // raw canvas click selects node + opens drawer
  const cp = await page.evaluate(() => { const g = window.__graph; const n = g.byId['comp:yandex']; const s = g.toScreen(n.x, n.y); return { x: s.x, y: s.y }; });
  await page.mouse.click(stageBox.x + cp.x, stageBox.y + cp.y);
  await page.waitForTimeout(600);
  const clickSel = await page.evaluate(() => ({ open: document.querySelector('#drawer').classList.contains('open'), head: document.querySelector('#drawerHead').innerText.replace(/\n/g, ' '), sel: window.__graph.selected && window.__graph.selected.id }));
  console.log('CANVAS_CLICK', JSON.stringify(clickSel));
  await page.click('#drawerClose');

  // repeated layout switching must not duplicate nodes/edges/loops
  for (const L of ['organic', 'radial', 'flow', 'organic', 'flow']) {
    await page.selectOption('#layout', L);
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(800);
  const stable = await page.evaluate(() => ({ n: window.__graph.nodes.length, e: window.__graph.edges.length }));
  console.log('STABLE', JSON.stringify(stable));

  // JSON export
  const dl2 = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  await page.click('#btnJson');
  const d2 = await dl2;
  console.log('JSON_DOWNLOAD', d2 ? d2.suggestedFilename() : 'NONE');

  // export png integrity
  const pngSize = fs.existsSync(path.join(SHOTS, 'export.png')) ? fs.statSync(path.join(SHOTS, 'export.png')).size : 0;
  console.log('PNG_BYTES', pngSize);

  // keyboard: '/' focuses search, Escape clears
  await page.keyboard.press('/');
  const focused = await page.evaluate(() => document.activeElement.id);
  await page.keyboard.press('Escape');
  console.log('KEY_SEARCH_FOCUS', focused);

  // mobile viewport
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.__graph.fit(true));
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(SHOTS, '09-mobile.png') });
  // mobile drawer
  await page.evaluate(() => { window.__graph.emit('click', window.__graph.byId['comp:rosatom']); });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(SHOTS, '10-mobile-drawer.png') });
  const mobileOverflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, panelH: document.querySelector('#panel').getBoundingClientRect().height }));
  console.log('MOBILE', JSON.stringify(mobileOverflow));

  console.log('ERRORS', JSON.stringify(errors, null, 1));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });