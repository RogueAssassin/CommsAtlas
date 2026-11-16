/* CommsAtlas — the site map: every site on an OpenStreetMap (or any slippy-tile) map, with its name.
   No map library: tiles are plain images placed in Web Mercator, pins are buttons. */
(function () {
  'use strict';
  const RB = window.RB;
  const esc = RB.esc;
  const ic = RB.icon;
  const S = () => RB.store.state;
  const TILE = 256;
  const cfg = () => Object.assign({ tiles: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap contributors', maxZoom: 19, geocoder: 'https://nominatim.openstreetmap.org/search', center: [-37.81, 144.96], zoom: 7 }, RB.CONFIG.map || {});

  /* Web Mercator: degrees ↔ world pixels at a zoom level. */
  const worldSize = (z) => TILE * Math.pow(2, z);
  function project(lat, lon, z) {
    const s = Math.sin(RB.clamp(lat, -85.05, 85.05) * Math.PI / 180);
    return { x: (lon + 180) / 360 * worldSize(z), y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * worldSize(z) };
  }
  function unproject(x, y, z) {
    const n = Math.PI - 2 * Math.PI * y / worldSize(z);
    return { lat: 180 / Math.PI * Math.atan(Math.sinh(n)), lon: x / worldSize(z) * 360 - 180 };
  }
  const placed = () => RB.sortSites(S().sites.filter((s) => s.lat != null && s.lon != null));

  function view() {
    const ui = RB.ui;
    if (!ui.atlas) {
      const c = cfg();
      ui.atlas = { lat: c.center[0], lon: c.center[1], z: c.zoom, fitted: false };
    }
    return ui.atlas;
  }

  /** Zoom and centre so every placed site shows. */
  function fit(box) {
    const v = view();
    const pts = placed();
    if (!pts.length) return;
    // Leave room for the name labels, which sit to the right of each pin.
    const w = Math.max(160, box.clientWidth - 260), h = Math.max(160, box.clientHeight - 110);
    let z = Math.min(16, cfg().maxZoom);
    for (; z > 2; z--) {
      const ps = pts.map((s) => project(s.lat, s.lon, z));
      const dx = Math.max(...ps.map((p) => p.x)) - Math.min(...ps.map((p) => p.x));
      const dy = Math.max(...ps.map((p) => p.y)) - Math.min(...ps.map((p) => p.y));
      if (dx <= w && dy <= h) break;
    }
    const ps = pts.map((s) => project(s.lat, s.lon, z));
    const cx = (Math.max(...ps.map((p) => p.x)) + Math.min(...ps.map((p) => p.x))) / 2;
    const cy = (Math.max(...ps.map((p) => p.y)) + Math.min(...ps.map((p) => p.y))) / 2;
    const c = unproject(cx + 70, cy - 10, z);
    Object.assign(v, { lat: c.lat, lon: c.lon, z: pts.length === 1 ? Math.min(z, 14) : z, fitted: true });
  }

  function tileUrl(x, y, z) {
    const n = Math.pow(2, z);
    const tx = ((x % n) + n) % n;
    return String(cfg().tiles).replace('{z}', z).replace('{x}', tx).replace('{y}', y).replace('{s}', 'abc'[(tx + y) % 3]).replace('{r}', '');
  }

  /** Draw tiles and pins for the current centre and zoom. */
  function paint(box) {
    const v = view();
    const W = box.clientWidth, H = box.clientHeight;
    if (!W || !H) return;
    const c = project(v.lat, v.lon, v.z);
    const ox = c.x - W / 2, oy = c.y - H / 2;
    const tiles = box.querySelector('.atlas-tiles');
    const n = Math.pow(2, v.z);
    const want = new Set();
    for (let tx = Math.floor(ox / TILE); tx <= Math.floor((ox + W) / TILE); tx++) {
      for (let ty = Math.max(0, Math.floor(oy / TILE)); ty <= Math.min(n - 1, Math.floor((oy + H) / TILE)); ty++) {
        const key = v.z + '/' + tx + '/' + ty;
        want.add(key);
        let img = tiles.querySelector('img[data-k="' + key + '"]');
        if (!img) {
          img = document.createElement('img');
          img.dataset.k = key; img.alt = ''; img.draggable = false; img.decoding = 'async'; img.loading = 'eager';
          img.width = TILE; img.height = TILE;
          img.onerror = () => { img.classList.add('is-bad'); };
          img.src = tileUrl(tx, ty, v.z);
          tiles.appendChild(img);
        }
        img.style.transform = 'translate(' + Math.round(tx * TILE - ox) + 'px,' + Math.round(ty * TILE - oy) + 'px)';
      }
    }
    tiles.querySelectorAll('img').forEach((img) => { if (!want.has(img.dataset.k)) img.remove(); });
    box.querySelectorAll('.atlas-pin').forEach((pin) => {
      const s = RB.get.site(pin.dataset.id);
      if (!s || s.lat == null) { pin.hidden = true; return; }
      const p = project(s.lat, s.lon, v.z);
      // Pins wrap with the world so they line up with repeated tiles.
      let x = p.x - ox; const ws = worldSize(v.z);
      while (x < -ws / 2) x += ws; while (x > W + ws / 2) x -= ws;
      pin.hidden = false;
      pin.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(p.y - oy) + 'px)';
    });
    const zl = box.querySelector('[data-atlas=zin]'), zo = box.querySelector('[data-atlas=zout]');
    if (zl) zl.disabled = v.z >= cfg().maxZoom;
    if (zo) zo.disabled = v.z <= 2;
  }

  function zoomAt(box, dz, px, py) {
    const v = view();
    const nz = RB.clamp(v.z + dz, 2, cfg().maxZoom);
    if (nz === v.z) return;
    const W = box.clientWidth, H = box.clientHeight;
    const ax = px == null ? W / 2 : px, ay = py == null ? H / 2 : py;
    const c = project(v.lat, v.lon, v.z);
    const at = unproject(c.x - W / 2 + ax, c.y - H / 2 + ay, v.z);
    const p2 = project(at.lat, at.lon, nz);
    const nc = unproject(p2.x - ax + W / 2, p2.y - ay + H / 2, nz);
    Object.assign(v, { lat: nc.lat, lon: nc.lon, z: nz });
    box.querySelector('.atlas-tiles').innerHTML = '';
    paint(box);
  }

  function panBy(box, dx, dy) {
    const v = view();
    const c = project(v.lat, v.lon, v.z);
    const nc = unproject(c.x - dx, RB.clamp(c.y - dy, 0, worldSize(v.z)), v.z);
    v.lat = nc.lat; v.lon = ((nc.lon + 540) % 360) - 180;
    paint(box);
  }

  function siteStats(site) {
    const rooms = RB.get.siteRoomsOf(site.id).concat(...RB.get.floorsOf(site.id).map((f) => RB.get.roomsOf(f.id)));
    const ids = new Set(rooms.map((r) => r.id));
    const racks = S().racks.filter((r) => ids.has(r.roomId));
    const rackIds = new Set(racks.map((r) => r.id));
    const devs = S().devices.filter((d) => rackIds.has(d.rackId) || ids.has(d.roomId)).length;
    return { rooms: rooms.length, racks: racks.length, devs };
  }

  RB.renderAtlas = function () {
    const ui = RB.ui;
    const sites = S().sites;
    const on = placed();
    RB.$('#toolbar').innerHTML = '<div class="tb-title"><h1>Site map</h1><span>' + sites.length + ' site' + (sites.length === 1 ? '' : 's') + ' · ' + on.length + ' on the map</span></div><div class="tb-actions">' +
      (sites.some((s) => s.lat == null && s.address) ? '<button type="button" class="btn" data-atlas="geocode-all">' + ic('search') + '<span>Find unplaced from addresses</span></button>' : '') +
      '<button type="button" class="btn btn--primary" data-add="root">' + ic('plus') + ' Add site</button></div>';
    const placing = ui.atlasPlacing && RB.get.site(ui.atlasPlacing);
    const list = sites.map((s) => {
      const st = siteStats(s);
      return '<div class="atlas-site' + (ui.atlasFocus === s.id ? ' is-focus' : '') + '"><button type="button" class="atlas-go" data-atlas="focus" data-id="' + s.id + '">' + ic(s.lat != null ? 'pin' : 'site', 15) + '<span><b>' + esc(s.name) + '</b><small>' + esc([s.code, s.address].filter(Boolean).join(' · ') || 'No address yet') + '</small><small class="muted">' + st.rooms + ' comms room' + (st.rooms === 1 ? '' : 's') + ' · ' + st.racks + ' rack' + (st.racks === 1 ? '' : 's') + ' · ' + st.devs + ' device' + (st.devs === 1 ? '' : 's') + '</small></span></button>' +
        '<div class="atlas-acts"><button type="button" class="btn sm" data-nav="site" data-id="' + s.id + '">Open</button><button type="button" class="btn sm' + (ui.atlasPlacing === s.id ? ' is-on btn--accent' : '') + '" data-atlas="place" data-id="' + s.id + '">' + (s.lat != null ? 'Move pin' : 'Place pin') + '</button>' +
        (s.address ? '<button type="button" class="btn sm" data-act="geocode" data-id="' + s.id + '" title="Look up ' + esc(s.address) + '">Find address</button>' : '') + '</div></div>';
    }).join('') || '<div class="empty-card"><p>No sites yet.</p><button type="button" class="btn btn--primary sm" data-add="root">' + ic('plus') + ' Add a site</button></div>';
    RB.$('#canvas').innerHTML = '<div class="atlas' + (placing ? ' is-placing' : '') + '">' +
      '<div class="atlas-map" tabindex="0" role="application" aria-label="Map of sites. Drag or use the arrow keys to move, plus and minus to zoom.">' +
      '<div class="atlas-tiles" aria-hidden="true"></div><div class="atlas-pins">' +
      sites.map((s) => '<button type="button" class="atlas-pin' + (ui.atlasFocus === s.id ? ' is-focus' : '') + '" data-atlas="pin" data-id="' + s.id + '" hidden title="' + esc(s.name + (s.address ? ' — ' + s.address : '')) + '"><span class="atlas-dot">' + ic('pin', 18) + '</span><span class="atlas-label">' + esc(s.name) + '</span></button>').join('') + '</div>' +
      (placing ? '<div class="banner banner--place atlas-banner">' + ic('pin') + '<div><b>Place ' + esc(placing.name) + '</b><span>Click its spot on the map.</span></div><button type="button" class="btn sm" data-atlas="cancel">Cancel</button></div>' : '') +
      (!on.length && sites.length ? '<div class="atlas-hint">' + ic('pin', 16) + ' Sites with an address are placed on the map automatically. For one without an address, press Place pin and click its spot.</div>' : '') +
      '<div class="atlas-ctl"><button type="button" class="icon-btn" data-atlas="zin" aria-label="Zoom in">' + ic('zoomin') + '</button><button type="button" class="icon-btn" data-atlas="zout" aria-label="Zoom out">' + ic('zoomout') + '</button><button type="button" class="icon-btn" data-atlas="fit" aria-label="Show every site">' + ic('fit') + '</button></div>' +
      '<div class="atlas-attr">' + esc(cfg().attribution) + '</div></div>' +
      '<aside class="atlas-list" aria-label="Sites">' + list + '</aside></div>';
    RB.$('#bottom').hidden = true;
    const box = RB.$('.atlas-map');
    const v = view();
    const focus = ui.atlasFocus && RB.get.site(ui.atlasFocus);
    if (focus && focus.lat != null && ui.atlasCentred !== focus.id) { Object.assign(v, { lat: focus.lat, lon: focus.lon, z: Math.max(v.z, 13) }); ui.atlasCentred = focus.id; }
    else if (!v.fitted && on.length) requestAnimationFrame(() => { fit(box); paint(box); });
    wire(box);
    requestAnimationFrame(() => paint(box));
    autoPlace();
  };

  let dragging = null;
  function wire(box) {
    box.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button')) return;
      dragging = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId };
      box.setPointerCapture(e.pointerId);
      box.classList.add('is-drag');
    });
    box.addEventListener('pointermove', (e) => {
      if (!dragging || e.pointerId !== dragging.id) return;
      const dx = e.clientX - dragging.x, dy = e.clientY - dragging.y;
      dragging.moved += Math.abs(dx) + Math.abs(dy);
      dragging.x = e.clientX; dragging.y = e.clientY;
      panBy(box, dx, dy);
    });
    const end = (e) => {
      if (!dragging) return;
      const d = dragging; dragging = null;
      box.classList.remove('is-drag');
      if (d.moved < 4 && RB.ui.atlasPlacing && e.type === 'pointerup') placeAt(box, e);
    };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
    box.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = box.getBoundingClientRect();
      zoomAt(box, e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    box.addEventListener('dblclick', (e) => {
      if (e.target.closest('button')) return;
      const r = box.getBoundingClientRect();
      zoomAt(box, e.shiftKey ? -1 : 1, e.clientX - r.left, e.clientY - r.top);
    });
    box.addEventListener('keydown', (e) => {
      if (e.target !== box) return;
      const k = e.key;
      if (k === '+' || k === '=') zoomAt(box, 1);
      else if (k === '-' || k === '_') zoomAt(box, -1);
      else if (k === 'ArrowLeft') panBy(box, 80, 0);
      else if (k === 'ArrowRight') panBy(box, -80, 0);
      else if (k === 'ArrowUp') panBy(box, 0, 80);
      else if (k === 'ArrowDown') panBy(box, 0, -80);
      else return;
      e.preventDefault();
    });
    if (window.ResizeObserver) new ResizeObserver(() => paint(box)).observe(box);
  }

  function placeAt(box, e) {
    const id = RB.ui.atlasPlacing;
    const site = RB.get.site(id);
    RB.ui.atlasPlacing = null;
    if (!site) { RB.render(); return; }
    const v = view();
    const r = box.getBoundingClientRect();
    const c = project(v.lat, v.lon, v.z);
    const at = unproject(c.x - r.width / 2 + (e.clientX - r.left), c.y - r.height / 2 + (e.clientY - r.top), v.z);
    const lat = Math.round(at.lat * 1e6) / 1e6, lon = Math.round((((at.lon + 540) % 360) - 180) * 1e6) / 1e6;
    if (!RB.store.commit('Changed map position of ' + site.name, (s) => { const x = s.sites.find((y) => y.id === id); x.lat = lat; x.lon = lon; })) RB.render();
    else RB.toast(site.name + ' is on the map');
  }

  /* Map buttons (handled here so main.js stays about the racks). */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-atlas]');
    if (!b) return;
    const box = RB.$('.atlas-map');
    const a = b.dataset.atlas, ui = RB.ui;
    if (a === 'zin' && box) zoomAt(box, 1);
    else if (a === 'zout' && box) zoomAt(box, -1);
    else if (a === 'fit' && box) { if (!placed().length) { RB.toast('No site is on the map yet.'); return; } fit(box); box.querySelector('.atlas-tiles').innerHTML = ''; paint(box); }
    else if (a === 'focus' || a === 'pin') {
      const s = RB.get.site(b.dataset.id);
      if (!s) return;
      if (a === 'pin' && ui.atlasFocus === s.id) { RB.navigate('site', s.id); return; }
      ui.atlasFocus = s.id; ui.atlasCentred = null;
      if (s.lat == null) RB.toast(s.name + ' is not on the map yet. Press Place pin or Find address.');
      RB.render();
    } else if (a === 'place') {
      if (RB.auth && !RB.auth.mayCommit('Changed map position of a site')) { RB.auth.refuse('Changed map position'); return; }
      ui.atlasPlacing = ui.atlasPlacing === b.dataset.id ? null : b.dataset.id; RB.render();
    } else if (a === 'cancel') { ui.atlasPlacing = null; RB.render(); }
    else if (a === 'geocode-all') geocodeAll(b);
  });

  /* Address search with OpenStreetMap Nominatim: one look-up at a time and at most one a second, as its usage policy asks. */
  let lastLookup = 0;
  async function lookup(q) {
    const wait = lastLookup + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastLookup = Date.now();
    const url = cfg().geocoder + (cfg().geocoder.includes('?') ? '&' : '?') + 'format=jsonv2&limit=1&q=' + encodeURIComponent(q);
    let res;
    try { res = await fetch(url, { headers: { Accept: 'application/json' } }); } catch (e) { throw new Error('Could not reach the address search. Check the internet connection.'); }
    if (!res.ok) throw new Error('The address search answered ' + res.status + '.');
    const j = await res.json().catch(() => []);
    const hit = Array.isArray(j) ? j[0] : null;
    if (!hit) return null;
    const lat = parseFloat(hit.lat), lon = parseFloat(hit.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon, label: hit.display_name || '' } : null;
  }
  let busy = false;
  RB.geocodeSite = async function (id, btn) {
    const s = RB.get.site(id);
    if (!s) return;
    if (!String(s.address || '').trim()) { RB.toast('Type the site’s address first.', 'error'); return; }
    if (RB.auth && !RB.auth.mayCommit('Changed map position of ' + s.name)) { RB.auth.refuse('Changed map position'); return; }
    if (busy) { RB.toast('Already looking up an address…'); return; }
    busy = true;
    if (btn) btn.disabled = true;
    try {
      const hit = await lookup(s.address);
      if (!hit) { RB.toast('No match for “' + s.address + '”. Add the town and state, or press Place pin on the map.', 'error'); return; }
      RB.store.commit('Changed map position of ' + s.name, (st) => { const x = st.sites.find((y) => y.id === id); x.lat = Math.round(hit.lat * 1e6) / 1e6; x.lon = Math.round(hit.lon * 1e6) / 1e6; });
      RB.ui.atlasFocus = id; RB.ui.atlasCentred = null;
      RB.toast(s.name + ' found: ' + hit.label.split(',').slice(0, 3).join(','));
    } catch (e) { RB.toast(e.message, 'error'); }
    finally { busy = false; if (btn && btn.isConnected) btn.disabled = false; }
  };
  /* Sites with an address and no pin are placed automatically, so nobody has to press anything: quietly, one look-up a second,
     and each address is tried once per page load (a failed one is retried only if its address changes). */
  const tried = new Set();
  let autoBusy = false, autoTimer = null;
  async function autoPlace() {
    if (autoBusy || (RB.auth && !RB.auth.can('edit'))) return;
    const todo = S().sites.filter((s) => s.lat == null && String(s.address || '').trim() && !tried.has(s.id + '|' + s.address));
    if (!todo.length) return;
    autoBusy = true;
    let ok = 0;
    try {
      for (const s of todo) {
        tried.add(s.id + '|' + s.address);
        let hit = null;
        try { hit = await lookup(s.address); } catch (e) { break; } // offline or blocked: try again next time
        const now = RB.get.site(s.id);
        if (!hit || !now || now.lat != null || now.address !== s.address) continue;
        if (RB.store.commit('Placed ' + s.name + ' on the map from its address', (st) => { const x = st.sites.find((y) => y.id === s.id); x.lat = Math.round(hit.lat * 1e6) / 1e6; x.lon = Math.round(hit.lon * 1e6) / 1e6; })) ok++;
      }
    } finally { autoBusy = false; }
    if (ok) { if (RB.ui && RB.ui.atlas) RB.ui.atlas.fitted = false; RB.render(); }
  }
  RB.autoPlaceSites = autoPlace;
  // Look again shortly after any change (a new site, or an edited address).
  RB.store.on(() => { clearTimeout(autoTimer); autoTimer = setTimeout(autoPlace, 1500); });
  async function geocodeAll(btn) {
    const todo = S().sites.filter((s) => s.lat == null && s.address);
    if (!todo.length) return;
    if (RB.auth && !RB.auth.mayCommit('Changed map position of a site')) { RB.auth.refuse('Changed map position'); return; }
    btn.disabled = true;
    let ok = 0;
    for (const s of todo) {
      btn.querySelector('span').textContent = 'Finding ' + s.name + '…';
      try {
        const hit = await lookup(s.address);
        if (hit) { RB.store.commit('Changed map position of ' + s.name, (st) => { const x = st.sites.find((y) => y.id === s.id); x.lat = Math.round(hit.lat * 1e6) / 1e6; x.lon = Math.round(hit.lon * 1e6) / 1e6; }); ok++; }
      } catch (e) { RB.toast(e.message, 'error'); break; }
    }
    if (RB.ui.atlas) RB.ui.atlas.fitted = false;
    RB.toast('Found ' + ok + ' of ' + todo.length + ' sites');
    RB.render();
  }
})();
