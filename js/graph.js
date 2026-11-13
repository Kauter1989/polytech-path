/* SPbPU career mind-map — canvas force-graph engine (no dependencies). */
(function () {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  function hexToRgb(h) {
    h = h.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mixHex(a, b, t) {
    const A = hexToRgb(a), B = hexToRgb(b);
    const c = A.map((v, i) => Math.round(lerp(v, B[i], t)));
    return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
  }
  function rgba(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }

  const TYPE = {
    applicant: { r: 30, shape: 'star', depth: 0 },
    institute: { r: 24, shape: 'circle', depth: 1 },
    direction: { r: 12, shape: 'circle', depth: 2 },
    discipline: { r: 6.5, shape: 'diamond', depth: 3 },
    role: { r: 11, shape: 'hex', depth: 4 },
    company: { r: 11.5, shape: 'square', depth: 5 },
  };

  class Graph {
    constructor(canvas, data, opts = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.data = data;
      this.opt = Object.assign({
        layout: 'flow', nodeScale: 1, glow: 0.85, linkWidth: 1, labels: 'auto',
        particles: true, grid: true, repulsion: 2000, linkDist: 90, speed: 1,
        theme: 'dark', paused: false,
        layers: { discipline: true, role: true, company: true },
        institutes: null, // null = all
      }, opts);
      this.cam = { k: 0.5, tx: 0, ty: 0 };
      this.camTarget = null;
      this.alpha = 1; this.alphaMin = 0.004;
      this.hover = null; this.selected = null;
      this.searchMatches = new Set();
      this.pointer = { x: 0, y: 0 };
      this.drag = null; this.pan = null; this.pinch = null;
      this.pointers = new Map();
      this.dpr = 1; this.w = 0; this.h = 0;
      this.glowCache = new Map();
      this.labelCache = new Map();
      this.time = 0; this.last = performance.now();
      this.listeners = {};
      this.ambient = [];
      this._build();
      this._bind();
      this.resize();
      this._seed();
      this.fit(false);
      this._loop = this._loop.bind(this);
      requestAnimationFrame(this._loop);
    }

    on(ev, cb) { (this.listeners[ev] = this.listeners[ev] || []).push(cb); }
    emit(ev, payload) { (this.listeners[ev] || []).forEach(cb => cb(payload)); }

    /* ---------- build graph ---------- */
    _build() {
      const D = this.data;
      this.nodes = []; this.byId = {};
      const add = (n) => { this.nodes.push(n); this.byId[n.id] = n; return n; };
      const instColor = {}; D.institutes.forEach(i => instColor[i.id] = i.color);
      this.instColor = instColor;

      add({ id: 'applicant', type: 'applicant', label: 'Абитуриент', sub: 'Старт пути', color: '#ffffff', data: null });
      D.institutes.forEach(i => add({ id: 'inst:' + i.id, type: 'institute', label: i.abbr, sub: i.name, color: i.color, inst: i.id, data: i }));
      D.directions.forEach(d => {
        const c = instColor[d.inst[0]] || '#9aa7b8';
        add({ id: 'dir:' + d.id, type: 'direction', label: d.name, sub: d.code, color: c, inst: d.inst[0], insts: d.inst, data: d });
      });
      D.disciplines.forEach(d => add({ id: 'disc:' + d.id, type: 'discipline', label: d.name, sub: 'Дисциплина', color: '#8fa3bf', data: d }));
      D.roles.forEach(r => add({ id: 'role:' + r.id, type: 'role', label: r.name, sub: r.field, color: '#ffb020', data: r }));
      D.companies.forEach(c => add({ id: 'comp:' + c.id, type: 'company', label: c.name, sub: c.sector, color: '#ff4d8d', data: c }));

      this.edges = [];
      const link = (a, b, type) => {
        const A = this.byId[a], B = this.byId[b];
        if (!A || !B) return;
        this.edges.push({ a: A, b: B, type, color: mixHex(A.color, B.color, 0.5), phase: Math.random() });
      };
      D.institutes.forEach(i => link('applicant', 'inst:' + i.id, 'a-i'));
      D.directions.forEach(d => {
        d.inst.forEach(i => link('inst:' + i, 'dir:' + d.id, 'i-d'));
        d.disc.forEach(x => link('dir:' + d.id, 'disc:' + x, 'd-x'));
        d.roles.forEach(x => link('dir:' + d.id, 'role:' + x, 'd-r'));
      });
      D.companies.forEach(c => c.roles.forEach(x => link('role:' + x, 'comp:' + c.id, 'r-c')));

      // adjacency for ego highlight
      this.adj = {};
      this.nodes.forEach(n => this.adj[n.id] = new Set());
      this.edges.forEach(e => { this.adj[e.a.id].add(e.b.id); this.adj[e.b.id].add(e.a.id); });
      this.nodes.forEach(n => { n.r0 = TYPE[n.type].r; n.depth = TYPE[n.type].depth; n.vx = 0; n.vy = 0; n.fx = null; n.fy = null; });
    }

    _computeFlowTargets() {
      const D = this.data;
      const colX = d => d * 640;
      const dirSpacing = 32;
      const order = D.institutes.map(i => i.id);
      const per = {};
      D.directions.forEach(d => { (per[d.inst[0]] = per[d.inst[0]] || []).push(d); });
      let total = 0;
      order.forEach(id => { total += (per[id] || []).length * dirSpacing + 24; });
      let y = -total / 2;
      const dirY = {}, instY = {};
      order.forEach(id => {
        const arr = per[id] || []; const h = arr.length * dirSpacing + 24;
        instY[id] = y + h / 2;
        arr.forEach((d, j) => { dirY[d.id] = y + 12 + (j + 0.5) * dirSpacing; });
        y += h;
      });
      this.nodes.forEach(n => {
        if (n.type === 'applicant') { n.tx = colX(0); n.ty = 0; }
        else if (n.type === 'institute') { n.tx = colX(1); n.ty = instY[n.inst]; }
        else if (n.type === 'direction') { n.tx = colX(2); n.ty = dirY[n.data.id]; }
      });
      const spread = (type, depth, neighborTypes, spacing) => {
        const arr = this.nodes.filter(n => n.type === type);
        arr.forEach(n => {
          let s = 0, c = 0;
          for (const id of this.adj[n.id]) { const m = this.byId[id]; if (neighborTypes.includes(m.type)) { s += m.ty; c++; } }
          n._bary = c ? s / c : 0;
        });
        arr.sort((a, b) => a._bary - b._bary);
        const H = arr.length * spacing;
        arr.forEach((n, i) => { n.tx = colX(depth); n.ty = -H / 2 + (i + 0.5) * spacing; });
      };
      spread('discipline', 3, ['direction'], 30);
      spread('role', 4, ['direction'], 56);
      spread('company', 5, ['role'], 66);
    }
    _placeByLayout() {
      const L = this.opt.layout;
      if (L === 'radial') {
        const byDepth = {};
        this.nodes.forEach(n => { (byDepth[n.depth] = byDepth[n.depth] || []).push(n); });
        Object.values(byDepth).forEach(arr => arr.forEach((n, i) => {
          const r = 150 + n.depth * 250; const ang = (i / arr.length) * TAU + n.depth * 0.7;
          n.x = Math.cos(ang) * r; n.y = Math.sin(ang) * r; n.vx = n.vy = 0;
        }));
      } else if (L === 'organic') {
        this.nodes.forEach(n => { n.x = (Math.random() - 0.5) * 1800; n.y = (Math.random() - 0.5) * 1800; n.vx = n.vy = 0; });
      } else {
        this.nodes.forEach(n => { n.x = n.tx + (Math.random() - 0.5) * 10; n.y = n.ty + (Math.random() - 0.5) * 10; n.vx = n.vy = 0; });
      }
    }
    _seed() {
      this._computeFlowTargets();
      this._placeByLayout();
      this.ambient = this.edges.filter(() => Math.random() < 0.06).slice(0, 46);
    }

    /* ---------- visibility ---------- */
    _visible(n) {
      const L = this.opt.layers;
      if (n.type === 'discipline' && !L.discipline) return false;
      if (n.type === 'role' && !L.role) return false;
      if (n.type === 'company' && !L.company) return false;
      const F = this.opt.institutes;
      if (F && F.size) {
        if (n.type === 'institute' && !F.has(n.inst)) return false;
        if (n.type === 'direction' && !n.insts.some(i => F.has(i))) return false;
        if (n.type === 'discipline' || n.type === 'role' || n.type === 'company') {
          // keep if connected to a visible direction
          if (!this._connToInst(n, F)) return false;
        }
      }
      return true;
    }
    _connToInst(n, F) {
      for (const id of this.adj[n.id]) {
        const m = this.byId[id];
        if (m.type === 'direction' && m.insts.some(i => F.has(i))) return true;
        if (m.type === 'role') {
          for (const id2 of this.adj[id]) {
            const m2 = this.byId[id2];
            if (m2.type === 'direction' && m2.insts.some(i => F.has(i))) return true;
          }
        }
      }
      return false;
    }
    _edgeVisible(e) { return this._visible(e.a) && this._visible(e.b); }

    /* ---------- camera ---------- */
    resize() {
      const rect = this.canvas.getBoundingClientRect();
      this.dpr = clamp(window.devicePixelRatio || 1, 1, 2);
      this.w = rect.width; this.h = rect.height;
      this.canvas.width = Math.round(rect.width * this.dpr);
      this.canvas.height = Math.round(rect.height * this.dpr);
    }
    toWorld(sx, sy) { return { x: (sx - this.cam.tx) / this.cam.k, y: (sy - this.cam.ty) / this.cam.k }; }
    toScreen(wx, wy) { return { x: wx * this.cam.k + this.cam.tx, y: wy * this.cam.k + this.cam.ty }; }
    zoomAt(sx, sy, factor) {
      const k = clamp(this.cam.k * factor, 0.12, 4);
      const w = this.toWorld(sx, sy);
      this.cam.k = k; this.cam.tx = sx - w.x * k; this.cam.ty = sy - w.y * k;
      this.camTarget = null;
    }
    animateCam(k, tx, ty) { this.camTarget = { k, tx, ty }; }
    fit(animate = true) {
      const vis = this.nodes.filter(n => this._visible(n));
      if (!vis.length) return;
      let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
      vis.forEach(n => { const r = n.r0 * this.opt.nodeScale + 40; minX = Math.min(minX, n.x - r); maxX = Math.max(maxX, n.x + r); minY = Math.min(minY, n.y - r); maxY = Math.max(maxY, n.y + r); });
      const pad = 60;
      const k = clamp(Math.min((this.w - pad) / (maxX - minX), (this.h - pad) / (maxY - minY)), 0.12, 1.6);
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      const tx = this.w / 2 - cx * k, ty = this.h / 2 - cy * k;
      if (animate) this.animateCam(k, tx, ty); else { this.cam.k = k; this.cam.tx = tx; this.cam.ty = ty; }
    }
    focusNode(id, k) {
      const n = this.byId[id]; if (!n) return;
      const kk = k || clamp(Math.max(this.cam.k, 1.0), 0.6, 1.8);
      this.animateCam(kk, this.w / 2 - n.x * kk, this.h / 2 - n.y * kk);
    }

    /* ---------- params ---------- */
    set(key, val) {
      this.opt[key] = val;
      if (key === 'nodeScale' || key === 'theme' || key === 'glow') this.glowCache.clear();
      if (key === 'layout') { this._relayout(); this.reheat(0.9); }
      if (['repulsion', 'linkDist', 'speed'].includes(key)) this.reheat(0.5);
      if (key === 'layers' || key === 'institutes') { this.reheat(0.7); }
    }
    reheat(a = 0.6) { this.alpha = Math.max(this.alpha, a); }
    _relayout() { this._placeByLayout(); }
    randomize() { this._relayout(); this.reheat(1); }
    reset() { this._seed(); this.alpha = 1; this.selected = null; this.hover = null; this.fit(true); }

    /* ---------- simulation ---------- */
    _step(dt) {
      const o = this.opt;
      const vis = this.nodes.filter(n => this._visible(n));
      const edges = this.edges.filter(e => this._edgeVisible(e));
      const a = this.alpha;
      const rep = o.repulsion * (o.layout === 'flow' ? 0.35 : 1);
      // repulsion + collision
      for (let i = 0; i < vis.length; i++) {
        const n = vis[i];
        for (let j = i + 1; j < vis.length; j++) {
          const m = vis[j];
          let dx = m.x - n.x, dy = m.y - n.y;
          let d2 = dx * dx + dy * dy;
          if (d2 > 640000) continue; // 800px cutoff
          if (d2 < 1) { dx = (Math.random() - 0.5); dy = (Math.random() - 0.5); d2 = 1; }
          const d = Math.sqrt(d2);
          const rn = n.r0 * o.nodeScale, rm = m.r0 * o.nodeScale;
          let f = (rep * a) / d2;
          const minD = rn + rm + 6;
          if (d < minD) f += (minD - d) * 0.5 * a; // collision
          f = Math.min(f, 6);
          const fx = (dx / d) * f, fy = (dy / d) * f;
          n.vx -= fx; n.vy -= fy; m.vx += fx; m.vy += fy;
        }
      }
      // springs
      const ld = o.linkDist;
      for (const e of edges) {
        const A = e.a, B = e.b;
        let dx = B.x - A.x, dy = B.y - A.y;
        let d = Math.sqrt(dx * dx + dy * dy) || 1;
        const span = Math.abs(B.depth - A.depth);
        const rest = ld * (0.7 + span * 0.55);
        const f = (d - rest) * (o.layout === 'flow' ? 0.006 : 0.045) * a;
        const fx = (dx / d) * f, fy = (dy / d) * f;
        A.vx += fx; A.vy += fy; B.vx -= fx; B.vy -= fy;
      }
      // anchors
      const colX = dep => (dep - 2.5) * 470;
      for (const n of vis) {
        if (o.layout === 'flow') {
          n.vx += (n.tx - n.x) * 0.18 * a;
          n.vy += (n.ty - n.y) * 0.18 * a;
        } else if (o.layout === 'radial') {
          const r = 150 + n.depth * 250;
          const d = Math.sqrt(n.x * n.x + n.y * n.y) || 1;
          const f = (r - d) * 0.05 * a;
          n.vx += (n.x / d) * f; n.vy += (n.y / d) * f;
        } else {
          n.vx += (0 - n.x) * 0.012 * a; n.vy += (0 - n.y) * 0.012 * a;
        }
      }
      // integrate
      const damp = 0.82, sp = clamp(o.speed, 0.2, 2.2);
      for (const n of vis) {
        if (n.fx != null) { n.x = n.fx; n.y = n.fy; n.vx = 0; n.vy = 0; continue; }
        n.vx *= damp; n.vy *= damp;
        n.x += n.vx * sp; n.y += n.vy * sp;
      }
      this.alpha = Math.max(this.alphaMin, this.alpha * 0.992);
    }

    /* ---------- interaction ---------- */
    _bind() {
      const c = this.canvas;
      c.style.touchAction = 'none';
      c.addEventListener('pointerdown', e => this._down(e));
      c.addEventListener('pointermove', e => this._move(e));
      window.addEventListener('pointerup', e => this._up(e));
      window.addEventListener('pointercancel', e => this._up(e));
      c.addEventListener('wheel', e => { e.preventDefault(); this.zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 1.12 : 0.89); this.emit('cam', this.cam); }, { passive: false });
      c.addEventListener('pointerleave', () => { if (!this.drag && !this.pan) { this.hover = null; this.emit('hover', null); } });
      if (window.ResizeObserver) new ResizeObserver(() => this.resize()).observe(c);
      else window.addEventListener('resize', () => this.resize());
    }
    _hit(sx, sy) {
      const w = this.toWorld(sx, sy);
      let best = null, bd = 1e9;
      for (const n of this.nodes) {
        if (!this._visible(n)) continue;
        const r = n.r0 * this.opt.nodeScale + 5 / this.cam.k;
        const dx = n.x - w.x, dy = n.y - w.y; const d = dx * dx + dy * dy;
        if (d < r * r && d < bd) { bd = d; best = n; }
      }
      return best;
    }
    _down(e) {
      this.canvas.setPointerCapture && this.canvas.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (this.pointers.size === 2) {
        const pts = [...this.pointers.values()];
        this.pinch = { d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y), k: this.cam.k, cx: (pts[0].x + pts[1].x) / 2, cy: (pts[0].y + pts[1].y) / 2, tx: this.cam.tx, ty: this.cam.ty };
        this.drag = null; this.pan = null; return;
      }
      const n = this._hit(e.offsetX, e.offsetY);
      this.camTarget = null;
      if (n) { this.drag = { n, moved: 0, sx: e.offsetX, sy: e.offsetY }; n.fx = n.x; n.fy = n.y; this.reheat(0.5); }
      else { this.pan = { sx: e.offsetX, sy: e.offsetY, tx: this.cam.tx, ty: this.cam.ty, moved: 0 }; }
    }
    _move(e) {
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      this.pointer = { x: e.offsetX, y: e.offsetY };
      if (this.pinch && this.pointers.size === 2) {
        const pts = [...this.pointers.values()];
        const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
        const k = clamp(this.pinch.k * (d / this.pinch.d), 0.12, 4);
        const w = { x: (this.pinch.cx - this.pinch.tx) / this.pinch.k, y: (this.pinch.cy - this.pinch.ty) / this.pinch.k };
        this.cam.k = k; this.cam.tx = cx - w.x * k; this.cam.ty = cy - w.y * k;
        this.emit('cam', this.cam); return;
      }
      if (this.drag) {
        const w = this.toWorld(e.offsetX, e.offsetY);
        this.drag.n.fx = w.x; this.drag.n.fy = w.y;
        this.drag.moved += Math.abs(e.offsetX - this.drag.sx) + Math.abs(e.offsetY - this.drag.sy);
        this.drag.sx = e.offsetX; this.drag.sy = e.offsetY; this.reheat(0.35);
        return;
      }
      if (this.pan) {
        this.cam.tx = this.pan.tx + (e.offsetX - this.pan.sx);
        this.cam.ty = this.pan.ty + (e.offsetY - this.pan.sy);
        this.pan.moved += Math.abs(e.offsetX - this.pan.sx) + Math.abs(e.offsetY - this.pan.sy);
        this.emit('cam', this.cam); return;
      }
      const n = this._hit(e.offsetX, e.offsetY);
      if (n !== this.hover) { this.hover = n; this.canvas.style.cursor = n ? 'pointer' : 'grab'; this.emit('hover', n); }
    }
    _up(e) {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (this.drag) {
        const n = this.drag.n; n.fx = null; n.fy = null;
        if (this.drag.moved < 6) { this.select(n.id); this.emit('click', n); }
        this.drag = null; this.reheat(0.3);
      } else if (this.pan) {
        if (this.pan.moved < 6) { this.select(null); this.emit('background'); }
        this.pan = null;
      }
      this.canvas.style.cursor = 'grab';
    }
    select(id) {
      this.selected = id ? this.byId[id] : null;
      this.emit('select', this.selected);
    }
    setSearch(set) { this.searchMatches = set || new Set(); }

    /* ---------- rendering ---------- */
    _glow(color, r) {
      const key = color + '|' + Math.round(r);
      let s = this.glowCache.get(key);
      if (s) return s;
      const size = Math.ceil(r * 4);
      const cv = document.createElement('canvas'); cv.width = cv.height = size;
      const g = cv.getContext('2d');
      const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      grd.addColorStop(0, rgba(color, 0.55)); grd.addColorStop(0.4, rgba(color, 0.18)); grd.addColorStop(1, rgba(color, 0));
      g.fillStyle = grd; g.fillRect(0, 0, size, size);
      if (this.glowCache.size > 400) this.glowCache.clear();
      this.glowCache.set(key, cv); return cv;
    }
    _shape(ctx, shape, x, y, r) {
      ctx.beginPath();
      if (shape === 'circle') ctx.arc(x, y, r, 0, TAU);
      else if (shape === 'diamond') { ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); }
      else if (shape === 'hex') { for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * TAU / 6; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath(); }
      else if (shape === 'square') { const s = r * 0.92; const rr = s * 0.32; ctx.moveTo(x - s + rr, y - s); ctx.arcTo(x + s, y - s, x + s, y + s, rr); ctx.arcTo(x + s, y + s, x - s, y + s, rr); ctx.arcTo(x - s, y + s, x - s, y - s, rr); ctx.arcTo(x - s, y - s, x + s, y - s, rr); ctx.closePath(); }
      else if (shape === 'star') { for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5; const rr = i % 2 ? r * 0.45 : r; const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath(); }
    }
    _labelWidth(text, font) {
      const key = font + '|' + text; let w = this.labelCache.get(key);
      if (w == null) { this.ctx.font = font; w = this.ctx.measureText(text).width; if (this.labelCache.size > 3000) this.labelCache.clear(); this.labelCache.set(key, w); }
      return w;
    }

    _loop(now) {
      const dt = Math.min(50, now - this.last); this.last = now; this.time = now;
      if (!this.opt.paused && (this.alpha > this.alphaMin || this.drag)) {
        const iters = this.opt.speed > 1.4 ? 2 : 1;
        for (let i = 0; i < iters; i++) this._step(dt);
      }
      if (this.camTarget) {
        const t = this.camTarget, c = this.cam, e = 0.16;
        c.k = lerp(c.k, t.k, e); c.tx = lerp(c.tx, t.tx, e); c.ty = lerp(c.ty, t.ty, e);
        if (Math.abs(c.k - t.k) < 0.002 && Math.abs(c.tx - t.tx) < 0.5 && Math.abs(c.ty - t.ty) < 0.5) { Object.assign(c, t); this.camTarget = null; }
        this.emit('cam', c);
      }
      this._render();
      requestAnimationFrame(this._loop);
    }

    _render() {
      const ctx = this.ctx, o = this.opt, cam = this.cam;
      const dark = o.theme === 'dark';
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.w, this.h);
      const vis = this.nodes.filter(n => this._visible(n));
      const visSet = new Set(vis.map(n => n.id));
      const edges = this.edges.filter(e => visSet.has(e.a.id) && visSet.has(e.b.id));
      const focus = this.selected || this.hover;
      const ego = focus ? this.adj[focus.id] : null;
      const hasSearch = this.searchMatches.size > 0;
      const dimNode = n => {
        if (focus) return !(n === focus || ego.has(n.id));
        if (hasSearch) return !this.searchMatches.has(n.id);
        return false;
      };

      // world transform
      ctx.setTransform(this.dpr * cam.k, 0, 0, this.dpr * cam.k, this.dpr * cam.tx, this.dpr * cam.ty);

      // grid
      if (o.grid) {
        const step = 120; const x0 = (-cam.tx / cam.k), y0 = (-cam.ty / cam.k);
        const x1 = x0 + this.w / cam.k, y1 = y0 + this.h / cam.k;
        ctx.lineWidth = 1 / cam.k; ctx.strokeStyle = dark ? 'rgba(120,180,150,0.05)' : 'rgba(20,60,40,0.05)';
        ctx.beginPath();
        for (let x = Math.floor(x0 / step) * step; x < x1; x += step) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
        for (let y = Math.floor(y0 / step) * step; y < y1; y += step) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
        ctx.stroke();
      }

      // edges
      const lw = o.linkWidth / cam.k;
      for (const e of edges) {
        const A = e.a, B = e.b;
        const inEgo = focus && (A === focus || B === focus);
        const dim = focus ? !inEgo : (hasSearch ? !(this.searchMatches.has(A.id) && this.searchMatches.has(B.id)) : false);
        const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
        const dx = B.x - A.x, dy = B.y - A.y; const d = Math.hypot(dx, dy) || 1;
        const span = Math.abs(B.depth - A.depth);
        const bend = (span > 1 ? 0.16 : 0.07) * d * (e.phase > 0.5 ? 1 : -1);
        const cx = mx - dy / d * bend, cy = my + dx / d * bend;
        e._cx = cx; e._cy = cy;
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.quadraticCurveTo(cx, cy, B.x, B.y);
        if (inEgo) {
          const grd = ctx.createLinearGradient(A.x, A.y, B.x, B.y);
          grd.addColorStop(0, rgba(A.color, 0.95)); grd.addColorStop(1, rgba(B.color, 0.95));
          ctx.strokeStyle = grd; ctx.lineWidth = lw * 2.2; ctx.globalAlpha = 1;
        } else {
          ctx.strokeStyle = e.color; ctx.lineWidth = lw; ctx.globalAlpha = dim ? 0.04 : (dark ? 0.2 : 0.26);
        }
        ctx.stroke(); ctx.globalAlpha = 1;
      }

      // particles
      if (o.particles) {
        const plist = focus ? edges.filter(e => e.a === focus || e.b === focus) : this.ambient.filter(e => visSet.has(e.a.id) && visSet.has(e.b.id));
        const speed = focus ? 0.0006 : 0.00018;
        ctx.globalCompositeOperation = 'lighter';
        for (const e of plist) {
          if (e._cx == null) continue;
          const t = ((this.time * speed) + e.phase) % 1;
          const A = e.a, B = e.b, cx = e._cx, cy = e._cy;
          const it = 1 - t;
          const px = it * it * A.x + 2 * it * t * cx + t * t * B.x;
          const py = it * it * A.y + 2 * it * t * cy + t * t * B.y;
          const col = focus ? mixHex(A.color, B.color, t) : e.color;
          ctx.fillStyle = rgba(col, focus ? 0.9 : 0.5);
          ctx.beginPath(); ctx.arc(px, py, (focus ? 2.6 : 1.8) / cam.k, 0, TAU); ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      // nodes
      for (const n of vis) {
        const r = n.r0 * o.nodeScale;
        const dim = dimNode(n);
        const isFocus = n === focus;
        const isSel = n === this.selected;
        const alpha = dim ? 0.13 : 1;
        ctx.globalAlpha = alpha;
        // glow
        if (o.glow > 0.02 && !dim) {
          const spr = this._glow(n.color, r);
          ctx.globalAlpha = alpha * o.glow * (isFocus ? 1 : 0.7);
          const gs = r * 4; ctx.drawImage(spr, n.x - gs / 2, n.y - gs / 2, gs, gs);
          ctx.globalAlpha = alpha;
        }
        // body
        const shape = TYPE[n.type].shape;
        this._shape(ctx, shape, n.x, n.y, r);
        const grd = ctx.createRadialGradient(n.x - r * 0.3, n.y - r * 0.3, r * 0.1, n.x, n.y, r);
        grd.addColorStop(0, mixHex(n.color, '#ffffff', 0.35)); grd.addColorStop(1, n.color);
        ctx.fillStyle = grd; ctx.fill();
        ctx.lineWidth = (isSel ? 2.6 : 1.2) / cam.k;
        ctx.strokeStyle = isSel ? '#ffffff' : rgba(mixHex(n.color, '#000000', 0.25), 0.9);
        ctx.stroke();
        // selection pulse
        if (isSel) {
          const pr = r + (6 + Math.sin(this.time * 0.005) * 3) / cam.k;
          ctx.beginPath(); ctx.arc(n.x, n.y, pr, 0, TAU);
          ctx.strokeStyle = rgba(n.color, 0.5); ctx.lineWidth = 1.5 / cam.k; ctx.stroke();
        }
        // search ring
        if (hasSearch && this.searchMatches.has(n.id) && !focus) {
          ctx.beginPath(); ctx.arc(n.x, n.y, r + 4 / cam.k, 0, TAU);
          ctx.strokeStyle = rgba('#ffffff', 0.8); ctx.lineWidth = 1.4 / cam.k; ctx.stroke();
        }
        // institute abbr inside
        if (n.type === 'institute' && r * cam.k > 13) {
          ctx.fillStyle = dark ? '#04140d' : '#ffffff';
          ctx.font = `700 ${Math.max(8, r * 0.5)}px Inter, system-ui, sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(n.label, n.x, n.y + 0.5);
        }
        if (n.type === 'direction' && r * cam.k > 15) {
          ctx.fillStyle = dark ? '#04140d' : '#ffffff';
          ctx.font = `700 ${Math.max(6, r * 0.42)}px Inter, system-ui, sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(n.sub.split('.').pop(), n.x, n.y + 0.5);
        }
        ctx.globalAlpha = 1;
      }

      // labels (screen space)
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      const labelColor = dark ? '#e8f3ec' : '#12241b';
      const pillBg = dark ? 'rgba(6,16,12,0.72)' : 'rgba(255,255,255,0.8)';
      for (const n of vis) {
        const dim = dimNode(n);
        let show = false, text = n.label, size = 11, weight = 600;
        const k = cam.k;
        if (o.labels === 'none') show = false;
        else if (o.labels === 'all') show = true;
        else if (o.labels === 'hover') show = (n === focus || n === this.selected);
        else { // auto
          const flow = o.layout === 'flow';
          if (n.type === 'applicant' || n.type === 'institute') show = true;
          else if (n.type === 'company') show = flow ? k > 0.22 : k > 0.8;
          else if (n.type === 'direction') show = k > (flow ? 0.42 : 0.9);
          else if (n.type === 'role') show = k > (flow ? 0.6 : 1.0);
          else if (n.type === 'discipline') show = k > 1.1;
          if (n === focus || n === this.selected) show = true;
        }
        if (!show) continue;
        if (n.type === 'institute') { text = n.label; size = 12; weight = 700; }
        if (n.type === 'direction') { if (k <= 0.85) { text = n.sub; size = 9; } else { size = 11; } }
        if (n.type === 'company') { size = k < 0.5 ? 9.5 : 11; }
        if (n.type === 'role') { size = 10; }
        if (n.type === 'discipline') { size = 9; }
        if (n.type === 'applicant') { size = 13; weight = 700; }
        const s = this.toScreen(n.x, n.y);
        const r = n.r0 * o.nodeScale * k;
        if (s.x < -120 || s.x > this.w + 120 || s.y < -40 || s.y > this.h + 40) continue;
        const font = `${weight} ${size}px Inter, system-ui, sans-serif`;
        const tw = this._labelWidth(text, font);
        const ly = s.y + r + 5;
        ctx.globalAlpha = dim ? 0.16 : 1;
        // pill
        const px = s.x - tw / 2 - 5, py = ly - 2, pw = tw + 10, ph = size + 6;
        ctx.fillStyle = pillBg;
        ctx.beginPath();
        const rr = 5; ctx.moveTo(px + rr, py); ctx.arcTo(px + pw, py, px + pw, py + ph, rr); ctx.arcTo(px + pw, py + ph, px, py + ph, rr); ctx.arcTo(px, py + ph, px, py, rr); ctx.arcTo(px, py, px + pw, py, rr); ctx.closePath(); ctx.fill();
        ctx.font = font; ctx.fillStyle = n === focus ? mixHex(n.color, '#ffffff', 0.3) : labelColor;
        ctx.fillText(text, s.x, ly);
        ctx.globalAlpha = 1;
      }
    }

    /* ---------- export ---------- */
    exportPNG() {
      const dark = this.opt.theme === 'dark';
      const cv = document.createElement('canvas');
      cv.width = this.canvas.width; cv.height = this.canvas.height;
      const g = cv.getContext('2d');
      const grd = g.createLinearGradient(0, 0, cv.width, cv.height);
      if (dark) { grd.addColorStop(0, '#06120d'); grd.addColorStop(0.5, '#08181a'); grd.addColorStop(1, '#0a1410'); }
      else { grd.addColorStop(0, '#f3f8f4'); grd.addColorStop(1, '#e8f1ec'); }
      g.fillStyle = grd; g.fillRect(0, 0, cv.width, cv.height);
      g.drawImage(this.canvas, 0, 0);
      // watermark
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      g.font = '600 13px Inter, system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'bottom';
      g.fillStyle = dark ? 'rgba(232,243,236,0.6)' : 'rgba(18,36,27,0.6)';
      g.fillText('СПбПУ · Карта развития · по открытым источникам', 16, this.h - 14);
      const a = document.createElement('a');
      a.download = 'spbpu-career-map.png'; a.href = cv.toDataURL('image/png'); a.click();
    }
    stats() {
      const vis = this.nodes.filter(n => this._visible(n));
      const c = { applicant: 0, institute: 0, direction: 0, discipline: 0, role: 0, company: 0 };
      vis.forEach(n => c[n.type]++);
      return c;
    }
  }

  window.PolyGraph = Graph;
})();