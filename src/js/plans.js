/* CommsAtlas — floor plans over several levels.
   A site has levels (floors or buildings); each level can carry its own plan picture with its comms rooms placed on it. A room can still carry a
   closer plan of its own. Pictures are kept beside the records on the server (a record holds only "plan:<id>"), or inside the record when there
   is no server. A multi-page PDF becomes one level per page. A scale (two points and a real distance) turns the plan into a measuring tool. */
(function () {
  'use strict';
  const RB = window.RB;
  const esc = RB.esc;
  const ic = RB.icon;
  const S = () => RB.store.state;
  const plans = (RB.plans = {});
  const MAX_PAGES = 40;
  const guard = (what) => { if (RB.auth && !RB.auth.mayCommit(what)) { RB.auth.refuse(what); return false; } return true; };
  const serverOn = () => !!(RB.server && RB.server.on && RB.server.headers && RB.server.headers().Authorization);

  /* ---------- reading pictures and PDFs ---------- */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (window.pdfjsLib) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('The PDF reader could not be loaded.'));
      document.head.appendChild(s);
    });
  }
  function decode(file) {
    return new Promise((resolve, reject) => {
      const u = URL.createObjectURL(file), img = new Image();
      img.onload = () => { URL.revokeObjectURL(u); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(u); reject(new Error('“' + file.name + '” could not be opened as a picture.')); };
      img.src = u;
    });
  }
  const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
  const isPicture = (f) => /^image\/(png|jpe?g|webp|gif|bmp)$/.test(f.type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name);

  /** Opens a file as a list of pages: a picture is one page, a PDF has one page per sheet. page(i) draws page i on a canvas. */
  async function openSource(file) {
    if (isPdf(file)) {
      await loadScript('/vendor/pdf.min.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.js';
      let doc;
      try { doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise; }
      catch (e) { throw new Error(/password/i.test(e && e.message) ? '“' + file.name + '” is password protected.' : '“' + file.name + '” could not be read as a PDF.'); }
      if (doc.numPages > MAX_PAGES) RB.toast('“' + file.name + '” has ' + doc.numPages + ' pages; only the first ' + MAX_PAGES + ' are used.');
      return {
        count: Math.min(doc.numPages, MAX_PAGES),
        async page(i) {
          const pg = await doc.getPage(i + 1);
          const v1 = pg.getViewport({ scale: 1 });
          const vp = pg.getViewport({ scale: Math.min(4, 3000 / Math.max(v1.width, v1.height)) });
          const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
          const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
          await pg.render({ canvasContext: x, viewport: vp }).promise;
          return c;
        },
      };
    }
    if (!isPicture(file)) throw new Error('“' + file.name + '” is not a picture or a PDF.');
    return { count: 1, page: () => decode(file) };
  }

  plans.store = async (file) => store(await (await openSource(file)).page(0));

  /** Shrinks a picture or canvas and stores it. Returns { ref, w, h }. */
  async function store(src) {
    const on = serverOn();
    const sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height;
    const k = Math.min(1, (on ? 3200 : 1800) / Math.max(sw, sh));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(src, 0, 0, c.width, c.height);
    if (on) {
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.86));
      if (!blob) throw new Error('The picture could not be prepared.');
      const res = await fetch('/api/v1/tenants/' + encodeURIComponent(RB.store.tenantId || 'default') + '/plans', {
        method: 'POST', headers: Object.assign({}, RB.server.headers(), { 'Content-Type': 'application/octet-stream' }), body: blob,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'The server did not accept the picture (' + res.status + ').');
      return { ref: 'plan:' + j.id, w: c.width, h: c.height };
    }
    return { ref: c.toDataURL('image/jpeg', 0.8), w: c.width, h: c.height };
  }

  /* ---------- showing pictures ---------- */
  const blobs = new Map(); // plan id → object URL
  const pending = new Map(); // plan id → promise
  const raw = new Map(); // plan id → the picture itself (a blob: address cannot be fetched under the page's security policy)
  const idOf = (ref) => (/^plan:([a-f0-9]{16})$/.exec(String(ref || '')) || [])[1] || null;
  async function blobUrl(id) {
    if (blobs.has(id)) return blobs.get(id);
    if (!pending.has(id)) {
      pending.set(id, fetch('/api/v1/tenants/' + encodeURIComponent(RB.store.tenantId || 'default') + '/plans/' + id, { headers: RB.server.headers() })
        .then((r) => { if (!r.ok) throw new Error('missing'); return r.blob(); })
        .then((b) => { const u = URL.createObjectURL(b); blobs.set(id, u); raw.set(id, b); return u; })
        .finally(() => pending.delete(id)));
    }
    return pending.get(id);
  }
  /** An <img> for a stored reference or an old inline picture; a stored one fills in a moment later. */
  plans.imgHtml = function (ref, alt) {
    if (!ref) return '';
    const id = idOf(ref);
    if (!id) return /^data:image\//.test(ref) ? '<img src="' + esc(ref) + '" alt="' + esc(alt) + '" draggable="false">' : '';
    const ready = blobs.get(id);
    return '<img data-plan="' + id + '"' + (ready ? ' src="' + ready + '"' : '') + ' alt="' + esc(alt) + '" draggable="false">';
  };
  function hydrate(root) {
    (root || document).querySelectorAll('img[data-plan]:not([src]):not([data-wait])').forEach((img) => {
      img.dataset.wait = '1';
      blobUrl(img.dataset.plan).then((u) => { img.src = u; }, () => { img.classList.add('is-bad'); img.alt = (img.alt ? img.alt + ' — ' : '') + 'picture not available'; });
    });
  }
  new MutationObserver(() => hydrate()).observe(document.documentElement, { childList: true, subtree: true });

  /** A copy of the records for a backup file, with every stored plan picture put back inside it so the file stands alone. */
  plans.forBackup = async function () {
    const copy = JSON.parse(RB.store.exportJSON());
    let missing = 0;
    const toData = async (ref) => {
      const id = idOf(ref);
      if (!id) return ref;
      try {
        await blobUrl(id);
        const blob = raw.get(id);
        return await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); });
      } catch (e) { missing++; return ref; } // one picture that cannot be read must not stop the backup of everything else
    };
    for (const f of copy.floors || []) if (f.plan && f.plan.ref) f.plan.ref = await toData(f.plan.ref);
    for (const r of copy.rooms || []) if (r.plan) r.plan = await toData(r.plan);
    if (missing) RB.toast(missing + ' floor plan picture' + (missing === 1 ? ' could' : 's could') + ' not be read, so the backup holds only a reference to ' + (missing === 1 ? 'it' : 'them') + '.', 'error');
    return JSON.stringify(copy, null, 2);
  };

  /* ---------- scale ---------- */
  /** Metres between two points given as percentages of the plan's width and height. */
  function metres(plan, a, b) {
    if (!plan || !plan.m || !plan.w || !plan.h) return null;
    const dx = (b.x - a.x) / 100, dy = ((b.y - a.y) / 100) * (plan.h / plan.w);
    return Math.hypot(dx, dy) * plan.m;
  }
  const fmt = (m) => (m < 10 ? m.toFixed(1) : Math.round(m)) + ' m';
  function niceBar(plan) {
    if (!plan.m) return null;
    for (const m of [0.5, 1, 2, 5, 10, 20, 50, 100]) if ((m / plan.m) * 100 >= 8) return { m, pct: (m / plan.m) * 100 };
    return null;
  }

  /* ---------- the floor page ---------- */
  const floorsOfSite = (siteId) => RB.get.floorsOf(siteId);
  function tool() { const t = RB.ui.planTool; return t && RB.ui.nav && RB.ui.nav.type === 'floor' && RB.ui.nav.id === t.floorId ? t : null; }

  RB.floorPlanHtml = function (floor) {
    const rooms = RB.get.roomsOf(floor.id);
    const p = floor.plan;
    const can = !RB.auth || RB.auth.can('edit');
    const t = tool();
    const head = '<div class="cr-head"><span class="cr-name">' + ic('floor', 16) + '<b>Floor plan</b></span>' +
      '<small>' + (p ? (p.m ? 'Scale set · the plan is ' + fmt(p.m) + ' wide' : 'No scale yet') : 'No plan picture yet') + '</small>' +
      (can ? '<button type="button" class="btn sm" data-act="floor-plan-upload" data-id="' + floor.id + '">' + ic('image', 14) + ' ' + (p ? 'Replace' : 'Add a plan') + '</button>' : '') +
      (p ? '<button type="button" class="btn sm' + (t && t.kind === 'measure' ? ' is-on btn--accent' : '') + '" data-act="floor-measure" data-id="' + floor.id + '"' + (p.m ? '' : ' disabled title="Set the scale first"') + '>Measure</button>' : '') +
      (p && can ? '<button type="button" class="btn sm' + (t && t.kind === 'scale' ? ' is-on btn--accent' : '') + '" data-act="floor-scale" data-id="' + floor.id + '">Set scale</button>' : '') +
      (p && can ? '<button type="button" class="btn btn--danger-ghost sm" data-act="floor-plan-remove" data-id="' + floor.id + '">Remove</button>' : '') + '</div>';
    if (!p) {
      return '<section class="cr-sec fp">' + head + '<div class="plan"><div class="plan-grid"><span>Add a plan picture (PNG, JPEG, WebP or PDF) to place this level’s comms rooms where they really are.</span></div></div></section>';
    }
    const pts = t ? t.pts : [];
    const mk = rooms.filter((r) => r.pos).map((r) => '<button type="button" class="marker marker--room" data-marker="room" data-id="' + esc(r.id) + '" style="left:' + (+r.pos.x || 0) + '%;top:' + (+r.pos.y || 0) + '%"><span class="mk-dot">' + ic('room', 13) + '</span><span class="mk-name">' + esc(r.name) + '</span></button>').join('');
    const dots = pts.map((q) => '<i class="fp-pt" style="left:' + q.x + '%;top:' + q.y + '%"></i>').join('');
    const line = pts.length === 2 ? '<svg class="fp-line" viewBox="0 0 100 ' + (100 * p.h / p.w) + '" preserveAspectRatio="none"><line x1="' + pts[0].x + '" y1="' + (pts[0].y * p.h / p.w) + '" x2="' + pts[1].x + '" y2="' + (pts[1].y * p.h / p.w) + '"/></svg>' : '';
    const bar = niceBar(p);
    const banner = t ? '<div class="banner banner--place fp-banner">' + ic('pin') + '<div><b>' + (t.kind === 'scale' ? 'Set the scale' : 'Measure') + '</b><span>' + (pts.length === 0 ? 'Click the first point' + (t.kind === 'scale' ? ' of something whose real length you know, like a wall or a door.' : '.') : pts.length === 1 ? 'Now click the second point.' : (t.kind === 'measure' && metres(p, pts[0], pts[1]) != null ? 'That is ' + fmt(metres(p, pts[0], pts[1])) + '. Click again to measure another.' : '')) + '</span></div><button type="button" class="btn sm" data-act="floor-tool-end">Done</button></div>' : '';
    const unplaced = rooms.filter((r) => !r.pos);
    const chips = unplaced.length && can ? '<div class="fp-unplaced"><span>Not on the plan yet:</span>' + unplaced.map((r) => '<button type="button" class="chip" data-act="floor-place" data-id="' + r.id + '">' + ic('room', 13) + ' ' + esc(r.name) + '</button>').join('') + '</div>' : '';
    return '<section class="cr-sec fp">' + head + banner +
      '<div class="plan has-img' + (t ? ' is-tool' : '') + '" id="plan" data-floor="' + floor.id + '" style="aspect-ratio:' + p.w + ' / ' + p.h + '">' + plans.imgHtml(p.ref, 'Plan of ' + floor.name) + mk + dots + line +
      (bar ? '<div class="fp-scale" style="width:' + bar.pct + '%"><span>' + bar.m + ' m</span></div>' : '') + '</div>' + chips + '</section>';
  };

  /** The levels of a site: one tile per floor, with its plan, and the buttons to add or import them. */
  RB.levelsHtml = function (site) {
    const floors = floorsOfSite(site.id);
    const can = !RB.auth || RB.auth.can('edit');
    const tiles = floors.map((f) => {
      const n = RB.get.roomsOf(f.id).length;
      return '<button type="button" class="lvl" data-nav="floor" data-id="' + f.id + '"><span class="lvl-img">' + (f.plan ? plans.imgHtml(f.plan.ref, '') : ic('floor', 22)) + '</span><b>' + esc(f.name) + '</b><small>' + n + ' comms room' + (n === 1 ? '' : 's') + (f.plan ? '' : ' · no plan') + '</small></button>';
    }).join('');
    return '<section class="cr-sec levels"><div class="cr-head"><span class="cr-name">' + ic('floor', 16) + '<b>Levels</b></span><small>' + floors.length + ' level' + (floors.length === 1 ? '' : 's') + '</small>' +
      (can ? '<button type="button" class="btn sm" data-act="levels-import" data-id="' + site.id + '">' + ic('image', 14) + ' Import plans (PDF or pictures)</button>' : '') + '</div>' +
      (tiles ? '<div class="lvl-grid">' + tiles + '</div>' : '<p class="cr-empty">No levels yet. Import a PDF with one page per level, or use Add floor.</p>') + '</section>';
  };

  /* ---------- actions ---------- */
  function chooseFiles(multiple) {
    return new Promise((resolve) => {
      const i = document.createElement('input');
      i.type = 'file'; i.multiple = !!multiple; i.accept = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,application/pdf,.pdf';
      i.addEventListener('change', () => resolve(Array.from(i.files || [])));
      i.addEventListener('cancel', () => resolve([]));
      i.click();
    });
  }
  const busyToast = (m) => RB.toast(m);

  /** One plan for a floor or a room. A PDF with several pages uses its first page; use Import plans on the site for one level per page. */
  plans.pickOne = async function () {
    const f = (await chooseFiles(false))[0];
    if (!f) return null;
    const src = await openSource(f);
    if (src.count > 1) busyToast('That PDF has ' + src.count + ' pages. Using the first; use Import plans on the site page for one level per page.');
    return store(await src.page(0));
  };

  async function uploadFloorPlan(floorId) {
    const floor = RB.get.floor(floorId);
    if (!floor || !guard('Changed the floor plan of ' + floor.name)) return;
    try {
      const got = await plans.pickOne();
      if (!got) return;
      RB.store.commit('Added a floor plan to ' + floor.name, (s) => { const f = s.floors.find((x) => x.id === floorId); f.plan = { ref: got.ref, w: got.w, h: got.h, m: null }; });
      RB.toast('Plan added. Press Set scale to measure distances on it.');
    } catch (e) { RB.toast(e.message, 'error'); }
  }

  async function importLevels(siteId) {
    const site = RB.get.site(siteId);
    if (!site || !guard('Imported floor plans into ' + site.name)) return;
    try {
      const files = await chooseFiles(true);
      if (!files.length) return;
      const pages = [];
      for (const f of files) {
        const src = await openSource(f);
        const base = f.name.replace(/\.[^.]+$/, '');
        for (let i = 0; i < src.count; i++) pages.push({ src, i, label: src.count > 1 ? base + ' · page ' + (i + 1) : base });
      }
      if (pages.length > MAX_PAGES) throw new Error('Import up to ' + MAX_PAGES + ' plans at a time.');
      // Without the server the pictures live inside the records in this browser, whose storage is small.
      if (!serverOn() && pages.length > 8) throw new Error('Without the CommsAtlas server, import up to 8 plans at a time (browser storage is small).');
      const tenant = RB.store.tenantId;
      const existing = floorsOfSite(siteId).length;
      const vals = await RB.modal.form({
        title: 'Name the levels', submitLabel: 'Import ' + pages.length + ' plan' + (pages.length === 1 ? '' : 's'),
        intro: 'Each plan becomes a level of ' + site.name + '. Change the names if you like; you can rename them later.',
        fields: pages.map((p, k) => ({ name: 'n' + k, label: p.label, value: pages.length === 1 && !existing ? 'Ground floor' : 'Level ' + (existing + k + 1), required: true })),
      });
      if (!vals) return;
      const made = [];
      for (let k = 0; k < pages.length; k++) {
        busyToast('Storing plan ' + (k + 1) + ' of ' + pages.length + '…');
        const got = await store(await pages[k].src.page(pages[k].i));
        made.push({ id: RB.uid('floor'), siteId, name: String(vals['n' + k]).trim().slice(0, 80), plan: { ref: got.ref, w: got.w, h: got.h, m: null } });
      }
      // The pictures went to the tenant that was open when the import began; if the person has moved on, or the site is gone, do not attach them anywhere else.
      if (RB.store.tenantId !== tenant || !RB.get.site(siteId)) throw new Error('The workspace changed while the plans were being stored, so nothing was added. Try the import again.');
      RB.store.commit('Imported ' + made.length + ' floor plan' + (made.length === 1 ? '' : 's') + ' into ' + site.name, (s) => { made.forEach((f) => s.floors.push(f)); });
      RB.toast(made.length + ' level' + (made.length === 1 ? '' : 's') + ' added.');
      RB.render();
    } catch (e) { RB.toast(e.message, 'error'); }
  }

  async function finishScale(floor, t) {
    const frac = Math.hypot((t.pts[1].x - t.pts[0].x) / 100, ((t.pts[1].y - t.pts[0].y) / 100) * (floor.plan.h / floor.plan.w));
    if (frac < 0.005) { RB.toast('Those points are too close together. Try again.', 'error'); t.pts = []; RB.render(); return; }
    const v = await RB.modal.form({ title: 'Set the scale', intro: 'How long is the line you drew, in metres?', submitLabel: 'Set scale', fields: [{ name: 'd', label: 'Distance (metres)', type: 'number', min: 0.1, max: 5000, step: 'any', required: true }] });
    t.pts = [];
    const now = RB.get.floor(floor.id);
    if (v && v.d > 0 && now && now.plan) {
      const m = Math.round((v.d / frac) * 100) / 100;
      if (RB.store.commit('Set the scale of ' + floor.name, (s) => { const f = s.floors.find((x) => x.id === floor.id); if (f && f.plan) f.plan.m = m; })) RB.toast('Scale set: the plan is ' + fmt(m) + ' wide.');
    } else if (v) RB.toast('That plan is no longer there, so the scale was not set.', 'error');
    RB.ui.planTool = null; RB.render();
  }

  document.addEventListener('click', (e) => {
    const t = tool();
    const planEl = e.target.closest && e.target.closest('.plan[data-floor]');
    if (t && planEl && !e.target.closest('button')) {
      e.stopPropagation();
      const floor = RB.get.floor(t.floorId);
      if (!floor || !floor.plan) return;
      const r = planEl.getBoundingClientRect();
      const pt = { x: Math.round(RB.clamp(((e.clientX - r.left) / r.width) * 100, 0, 100) * 100) / 100, y: Math.round(RB.clamp(((e.clientY - r.top) / r.height) * 100, 0, 100) * 100) / 100 };
      if (t.pts.length >= 2) t.pts = [];
      t.pts.push(pt);
      if (t.pts.length === 2 && t.kind === 'scale') { RB.render(); finishScale(floor, t).catch((err) => { RB.ui.planTool = null; RB.toast(err.message, 'error'); RB.render(); }); return; }
      RB.render();
      return;
    }
    const b = e.target.closest && e.target.closest('[data-act]');
    if (!b) return;
    const a = b.dataset.act, id = b.dataset.id;
    if (a === 'floor-plan-upload') { e.stopPropagation(); uploadFloorPlan(id); }
    else if (a === 'levels-import') { e.stopPropagation(); importLevels(id); }
    else if (a === 'floor-scale' || a === 'floor-measure') {
      e.stopPropagation();
      const kind = a === 'floor-scale' ? 'scale' : 'measure';
      RB.ui.planTool = RB.ui.planTool && RB.ui.planTool.kind === kind && RB.ui.planTool.floorId === id ? null : { floorId: id, kind, pts: [] };
      RB.render();
    } else if (a === 'floor-tool-end') { e.stopPropagation(); RB.ui.planTool = null; RB.render(); }
    else if (a === 'floor-plan-remove') {
      e.stopPropagation();
      const floor = RB.get.floor(id);
      if (floor && guard('Removed the floor plan of ' + floor.name)) RB.store.commit('Removed the floor plan of ' + floor.name, (s) => { const f = s.floors.find((x) => x.id === id); f.plan = null; RB.ui.planTool = null; });
    } else if (a === 'floor-place') {
      e.stopPropagation();
      const room = RB.get.room(id);
      if (room && guard('Placed ' + room.name + ' on the floor plan')) RB.store.commit('Placed ' + room.name + ' on the floor plan', (s) => { s.rooms.find((x) => x.id === id).pos = { x: 50, y: 50 }; });
    }
  }, true);
})();
