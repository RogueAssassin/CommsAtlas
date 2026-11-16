/* CommsAtlas — screens: location tree, device library, overview, room, rack, details and port pop-up. */
(function () {
  'use strict';
  const RB = window.RB;
  const esc = RB.esc;
  const S = () => RB.store.state;
  const ic = RB.icon;

  /* ======================= navigation ======================= */
  RB.navigate = function (type, id, opts) {
    const ui = RB.ui;
    ui.nav = { type: type || 'home', id: id || null };
    ui.tab = null;
    ui.view = ui.nav.type;
    ui.rackId = type === 'rack' ? id : null;
    ui.roomId = type === 'room' ? id : null;
    if (!(opts && opts.keepSel)) ui.sel = null;
    ui.portSel = null;
    ui.placing = null;
    const here = type && type !== 'home' ? RB.contextSiteId() : null;
    if (here) ui.lastSiteId = here;
    // Open the tree down to what we show.
    const exp = ui.expanded;
    if (type === 'rack') {
      const r = RB.get.rack(id);
      // Remember the rack last opened in each room, so the Rack View tab comes back to it.
      if (r) { openRoomPath(r.roomId); ui.lastRack = ui.lastRack || {}; ui.lastRack[r.roomId] = r.id; ui.lastRackId = r.id; }
    }
    if (type === 'room') openRoomPath(id);
    if (type === 'floor') { const f = RB.get.floor(id); if (f) exp[f.siteId] = true; }
    function openRoomPath(roomId) {
      const room = RB.get.room(roomId); if (!room) return;
      exp[room.id] = true; if (room.floorId) exp[room.floorId] = true;
      const s = RB.get.siteOfRoom(room); if (s) exp[s.id] = true;
    }
    RB.closeDrawers();
    RB.render();
  };
  RB.goHome = () => RB.navigate('home');

  /* ---------- which site are we in? ---------- */
  /** Every comms room of a site, the ones straight under it first, then those on its floors or buildings (each group in name order). */
  RB.roomsOfSite = function (siteId) {
    const out = RB.get.siteRoomsOf(siteId);
    RB.get.floorsOf(siteId).forEach((f) => RB.get.roomsOf(f.id).forEach((r) => out.push(r)));
    return out;
  };
  const siteIdOfRoom = (roomId) => { const st = RB.get.siteOfRoom(RB.get.room(roomId)); return st ? st.id : null; };
  const siteIdOfThing = (type, id) => {
    if (type === 'site') return RB.get.site(id) ? id : null;
    if (type === 'floor') { const f = RB.get.floor(id); return f ? f.siteId : null; }
    if (type === 'room') return siteIdOfRoom(id);
    if (type === 'rack') { const r = RB.get.rack(id); return r ? siteIdOfRoom(r.roomId) : null; }
    if (type === 'device') { const st = RB.get.siteOfDevice(RB.get.device(id)); return st ? st.id : null; }
    return null;
  };
  /**
   * The site the person is working in: the one they opened (a site, floor, room or rack), else the site of what they selected, else
   * the one they were last in. The Mapping, Rack View, Site Map and Device Library tabs stay in this site instead of jumping to the first.
   */
  RB.contextSiteId = function () {
    const ui = RB.ui, n = ui.nav || {};
    let id = n.type && n.type !== 'home' ? siteIdOfThing(n.type, n.id) : null;
    if (!id && ui.sel) id = siteIdOfThing(ui.sel.type, ui.sel.id);
    if (!id && ui.lastSiteId && RB.get.site(ui.lastSiteId)) id = ui.lastSiteId;
    return id;
  };

  RB.select = function (type, id) {
    RB.ui.sel = type ? { type, id } : null;
    RB.ui.portSel = null;
    RB.render();
    if (type && window.matchMedia('(max-width: 991px)').matches) RB.openDrawer('insp');
  };

  /** Make sure the current navigation still points at something that exists. */
  function validateNav() {
    const ui = RB.ui;
    const n = ui.nav || { type: 'home' };
    const exists = { site: RB.get.site, floor: RB.get.floor, room: RB.get.room, rack: RB.get.rack };
    if (n.type !== 'home' && (!exists[n.type] || !exists[n.type](n.id))) { ui.nav = { type: 'home', id: null }; ui.view = 'home'; ui.rackId = ui.roomId = null; }
    if (ui.sel) {
      const getter = { site: RB.get.site, floor: RB.get.floor, room: RB.get.room, rack: RB.get.rack, device: RB.get.device }[ui.sel.type];
      if (!getter || !getter(ui.sel.id)) ui.sel = null;
    }
    if (ui.traceHops && ui.traceHops.some((h) => !RB.get.device(h.d))) clearTrace();
  }

  /* ======================= top bar ======================= */
  function renderTop() {
    RB.$('#wsName').textContent = (RB.currentTenant && RB.currentTenant() && RB.currentTenant().name) || S().workspace;
    const n = RB.ui.nav;
    const crumbs = [];
    const add = (type, item, icon) => item && crumbs.push('<button type="button" class="crumb" data-nav="' + type + '" data-id="' + item.id + '">' + ic(icon, 14) + '<span>' + esc(item.name) + '</span></button>');
    let rack, room, floor, site;
    if (n.type === 'rack') { rack = RB.get.rack(n.id); room = rack && RB.get.room(rack.roomId); }
    if (n.type === 'room') room = RB.get.room(n.id);
    if (room) { floor = room.floorId ? RB.get.floor(room.floorId) : null; site = RB.get.siteOfRoom(room); }
    if (n.type === 'floor') floor = RB.get.floor(n.id);
    if (floor && !site) site = RB.get.site(floor.siteId);
    if (n.type === 'site') site = RB.get.site(n.id);
    add('site', site, 'site'); add('floor', floor, 'floor'); add('room', room, 'room'); add('rack', rack, 'rack');
    RB.$('#crumbs').innerHTML = '<button type="button" class="crumb" data-nav="home">Overview</button>' + crumbs.map((c) => '<span class="crumb-sep">/</span>' + c).join('');
    const st = S();
    const last = st.history[0];
    RB.$('#statusbar').innerHTML = (RB.server ? RB.server.badge() : '<span class="ok">Saved in this browser</span>') + '<span>' + st.racks.length + ' racks · ' + st.devices.length + ' devices · ' + st.connections.length + ' cables</span>' +
      (last ? '<span class="sb-right">Last change: ' + esc(last.text) + ' · ' + esc(RB.fmtDate(last.ts)) + '</span>' : '<span class="sb-right"></span>') + '<span class="build" id="buildNo" title="Build number of this version of ' + esc(RB.APP_NAME) + '">' + RB.buildLabel() + '</span>';
    RB.$('[data-act=undo]').disabled = !RB.store.undoStack.length;
    RB.$('[data-act=redo]').disabled = !RB.store.redoStack.length;
  }

  /* ======================= sidebar tree ======================= */
  function renderSidebar() {
    const host = RB.$('#tree');
    const q = (RB.ui.query || '').trim().toLowerCase();
    if (q) { host.innerHTML = searchResults(q); return; }
    const exp = RB.ui.expanded;
    const n = RB.ui.nav;
    const row = (type, item, depth, icon, hasKids, extra, addTitle) => {
      const open = !!exp[item.id];
      const active = n.type === type && n.id === item.id;
      return '<div class="tree-row' + (active ? ' is-active' : '') + '" style="--depth:' + depth + '" data-nav="' + type + '" data-id="' + item.id + '">' +
        (hasKids ? '<button type="button" class="tree-tog' + (open ? ' is-open' : '') + '" data-tog="' + item.id + '" aria-label="' + (open ? 'Collapse' : 'Expand') + ' ' + esc(item.name) + '" aria-expanded="' + open + '">' + ic('chevron', 14) + '</button>' : '<span class="tree-tog tree-tog--none"></span>') +
        '<button type="button" class="tree-name" data-nav="' + type + '" data-id="' + item.id + '">' + ic(icon, 15) + '<span>' + esc(item.name) + '</span>' + (extra ? '<em>' + extra + '</em>' : '') + '</button>' +
        '<span class="tree-acts">' + (addTitle ? '<button type="button" class="icon-btn sm" data-add="' + type + '" data-id="' + item.id + '" title="' + esc(addTitle) + '" aria-label="' + esc(addTitle) + '">' + ic('plus', 14) + '</button>' : '') +
        '<button type="button" class="icon-btn sm" data-menu="' + type + '" data-id="' + item.id + '" aria-label="More for ' + esc(item.name) + '">' + ic('more', 14) + '</button></span></div>';
    };
    let html = '';
    const roomRows = (room, depth) => {
      const racks = RB.get.racksOf(room.id);
      html += row('room', room, depth, 'room', true, racks.length ? racks.length + (racks.length === 1 ? ' rack' : ' racks') : '', 'Add a rack');
      if (!exp[room.id]) return;
      if (!racks.length) html += '<button type="button" class="tree-hint" style="--depth:' + (depth + 1) + '" data-add="room" data-id="' + room.id + '">+ Add a rack</button>';
      racks.forEach((rack) => {
        const occ = RB.occupancy(rack.id);
        html += row('rack', rack, depth + 1, 'rack', false, occ.used + '/' + occ.total + 'U');
      });
    };
    RB.sortSites(S().sites).forEach((site) => {
      const floors = RB.get.floorsOf(site.id);
      const direct = RB.get.siteRoomsOf(site.id);
      html += row('site', site, 0, 'site', true, '', 'Add a comms room');
      if (!exp[site.id]) return;
      if (!floors.length && !direct.length) html += '<button type="button" class="tree-hint" style="--depth:1" data-add="site" data-id="' + site.id + '">+ Add a comms room</button>';
      // Site › Comms rooms › Racks; floors (buildings or levels) are optional.
      direct.forEach((room) => roomRows(room, 1));
      floors.forEach((f) => {
        const rooms = RB.get.roomsOf(f.id);
        html += row('floor', f, 1, 'floor', true, '', 'Add a comms room');
        if (!exp[f.id]) return;
        if (!rooms.length) html += '<button type="button" class="tree-hint" style="--depth:2" data-add="floor" data-id="' + f.id + '">+ Add a comms room</button>';
        rooms.forEach((room) => roomRows(room, 2));
      });
    });
    if (!S().sites.length) html = '<div class="tree-empty"><p>No locations yet.</p><button type="button" class="btn btn--primary sm" data-add="root">' + ic('plus') + ' Add a location</button></div>';
    host.innerHTML = html;
  }

  function searchResults(q) {
    const hits = [];
    S().racks.forEach((r) => { if (r.name.toLowerCase().includes(q)) hits.push({ t: 'rack', id: r.id, icon: 'rack', title: r.name, sub: RB.get.pathOfRoom(RB.get.room(r.roomId)) }); });
    S().rooms.forEach((r) => { if (r.name.toLowerCase().includes(q)) hits.push({ t: 'room', id: r.id, icon: 'room', title: r.name, sub: RB.get.pathOfRoom(r) }); });
    S().devices.forEach((d) => {
      const t = RB.get.template(d.templateId) || {};
      const hay = [d.name, d.ip, d.serial, d.assetTag, d.mac, d.platform, t.name, t.model, t.maker, t.category].join(' ').toLowerCase();
      if (hay.includes(q)) hits.push({ t: 'device', id: d.id, icon: 'device', title: d.name, sub: RB.get.whereIsDevice(d) + (d.ip ? ' · ' + d.ip : '') });
      Object.keys(d.portMeta || {}).forEach((k) => {
        const m = d.portMeta[k];
        if (m && m.label && m.label.toLowerCase().includes(q)) hits.push({ t: 'port', id: d.id, p: k, icon: 'cable', title: m.label, sub: d.name + ' / ' + RB.portLabel(d, k) });
      });
    });
    S().connections.forEach((c) => { if (c.label && c.label.toLowerCase().includes(q)) { const a = RB.get.device(c.a.d); hits.push({ t: 'port', id: c.a.d, p: c.a.p, icon: 'cable', title: c.label, sub: 'Cable · ' + a.name + ' / ' + RB.portLabel(a, c.a.p) }); } });
    if (!hits.length) return '<p class="tree-empty">Nothing matches “' + esc(q) + '”.</p>';
    return '<div class="results">' + hits.slice(0, 80).map((h) => '<button type="button" class="result" data-hit="' + h.t + '" data-id="' + h.id + '"' + (h.p ? ' data-p="' + h.p + '"' : '') + '>' + ic(h.icon, 15) + '<span><b>' + esc(h.title) + '</b><small>' + esc(h.sub) + '</small></span></button>').join('') + '</div>';
  }

  RB.openHit = function (t, id, p) {
    if (t === 'rack' || t === 'room') { RB.ui.query = ''; RB.$('#search').value = ''; RB.navigate(t, id); return; }
    const d = RB.get.device(id);
    if (!d) return;
    RB.ui.query = ''; RB.$('#search').value = '';
    if (d.rackId) RB.navigate('rack', d.rackId); else if (d.roomId) RB.navigate('room', d.roomId);
    RB.ui.sel = { type: 'device', id };
    if (t === 'port') {
      const port = RB.portOf(d, p);
      if (port && d.rackId) RB.ui.face = port.side;
      RB.startTrace(id, p, true);
    }
    RB.render();
  };

  /* ======================= device library ======================= */
  function renderLibrary() {
    const host = RB.$('#libList');
    const view = RB.ui.view;
    const endpointsFirst = view === 'room';
    const q = (RB.ui.libQuery || '').toLowerCase();
    const cat = RB.ui.libCat || '';
    const tpls = S().templates.filter((t) => (!q || (t.name + ' ' + t.maker + ' ' + t.model).toLowerCase().includes(q)) && (!cat || t.category === cat));
    const rackable = tpls.filter((t) => RB.unitsOfTpl(t) > 0);
    const endpoints = tpls.filter((t) => RB.unitsOfTpl(t) === 0);
    const item = (t) => '<div class="lib-item" draggable="true" data-tpl="' + t.id + '" role="button" tabindex="0" title="Drag onto ' + (RB.unitsOfTpl(t) ? 'a rack' : 'the room plan') + ', or click to place">' +
      '<span class="lib-chip" style="background:' + esc(t.color) + '"></span><span class="lib-main"><b>' + esc(t.name) + '</b><small>' + esc([t.maker, t.model].filter(Boolean).join(' · ') || t.category) + '</small></span>' +
      '<span class="lib-u">' + (RB.unitsOfTpl(t) ? RB.unitsOfTpl(t) + 'U' : '') + '</span>' +
      '<button type="button" class="icon-btn sm lib-edit" data-edit-tpl="' + t.id + '" aria-label="Edit ' + esc(t.name) + '">' + ic('edit', 13) + '</button></div>';
    const section = (title, list) => list.length ? '<h4 class="lib-sec">' + title + '</h4>' + list.map(item).join('') : '';
    const blocks = endpointsFirst ? [section('Outlets & endpoints', endpoints), section('Rack devices', rackable)] : [section('Rack devices', rackable), section('Outlets & endpoints', endpoints)];
    host.innerHTML = blocks.join('') || '<p class="empty-note">No devices match.</p>';
    const catSel = RB.$('#libCat');
    if (catSel.options.length <= 1) catSel.innerHTML = '<option value="">All categories</option>' + RB.CATEGORIES.map((c) => '<option>' + c + '</option>').join('');
    catSel.value = cat;
    RB.$('#app').classList.toggle('is-placing', !!RB.ui.placing);
    RB.$$('.lib-item').forEach((el) => el.classList.toggle('is-placing', RB.ui.placing === el.dataset.tpl));
  }

  /* ======================= main area ======================= */
  function renderMain() {
    const v = RB.ui.view;
    const app = RB.$('#app');
    app.dataset.view = v;
    app.classList.toggle('has-library', v === 'rack' || v === 'room');
    renderViewTabs(v);
    renderSiteBar();
    if (v === 'rack') return renderRackView();
    if (v === 'room') return renderRoomView();
    if (v === 'home' && RB.ui.tab === 'atlas' && RB.renderAtlas) return RB.renderAtlas();
    return renderOverview();
  }

  /* The site banner: the site's name and details, with its comms rooms one click away. */
  function siteInView() {
    const n = RB.ui.nav;
    if (n.type === 'site') return RB.get.site(n.id);
    if (n.type === 'floor') { const f = RB.get.floor(n.id); return f && RB.get.site(f.siteId); }
    let room = null;
    if (n.type === 'room') room = RB.get.room(n.id);
    if (n.type === 'rack') { const r = RB.get.rack(n.id); room = r && RB.get.room(r.roomId); }
    return RB.get.siteOfRoom(room);
  }
  RB.siteInView = siteInView;
  function renderSiteBar() {
    const bar = RB.$('#sitebar');
    const site = siteInView();
    bar.classList.toggle('is-on', !!site);
    if (!site) { bar.innerHTML = ''; return; }
    const n = RB.ui.nav;
    const curRoom = n.type === 'room' ? n.id : n.type === 'rack' ? (RB.get.rack(n.id) || {}).roomId : null;
    const rooms = RB.get.siteRoomsOf(site.id).concat(...RB.get.floorsOf(site.id).map((f) => RB.get.roomsOf(f.id)));
    const ids = new Set(rooms.map((r) => r.id));
    const nRacks = S().racks.filter((r) => ids.has(r.roomId)).length;
    const meta = [site.code, site.address, site.contact && 'Contact: ' + site.contact].filter(Boolean);
    bar.innerHTML = '<button type="button" class="sb-site' + (n.type === 'site' ? ' is-here' : '') + '" data-nav="site" data-id="' + site.id + '">' + ic('site', 18) + '<span><b>' + esc(site.name) + '</b><small>' + esc(meta.join(' · ') || rooms.length + ' comms room' + (rooms.length === 1 ? '' : 's') + ' · ' + nRacks + ' rack' + (nRacks === 1 ? '' : 's')) + '</small></span></button>' +
      '<nav class="sb-rooms" aria-label="Comms rooms at ' + esc(site.name) + '">' + rooms.map((r) => '<button type="button" class="sb-room' + (r.id === curRoom ? ' is-here' : '') + '" data-nav="room" data-id="' + r.id + '"' + (r.id === curRoom ? ' aria-current="true"' : '') + '>' + ic('room', 13) + '<span>' + esc(r.name) + '</span><em>' + RB.get.racksOf(r.id).length + '</em></button>').join('') + '</nav>';
  }

  /* The four ways into the workspace: locations, room plans, racks and the device library. */
  const VIEW_TABS = [['atlas', 'Site Map', 'pin'], ['nav', 'Navigation', 'site'], ['map', 'Mapping', 'room'], ['rack', 'Rack View', 'rack'], ['lib', 'Device Library', 'lib']];
  function renderViewTabs(v) {
    let cur = RB.ui.tab;
    if (cur === 'lib' && v !== 'rack' && v !== 'room') cur = null;
    if (cur === 'atlas' && v !== 'home') cur = null;
    // The overview (home) is the dashboard above the four views, so no tab is selected there.
    if (!cur) cur = v === 'rack' ? 'rack' : v === 'room' ? 'map' : (v === 'site' || v === 'floor') ? 'nav' : null;
    const box = RB.$('#viewtabs');
    // Built once and updated in place, so focus and the clicked button survive a re-render.
    if (!box.children.length) box.innerHTML = VIEW_TABS.map((t) => '<button type="button" role="tab" class="vtab" id="vtab-' + t[0] + '" data-tab="' + t[0] + '" aria-controls="canvas">' + ic(t[2], 15) + '<span>' + t[1] + '</span></button>').join('');
    RB.$$('.vtab', box).forEach((b) => {
      const on = b.dataset.tab === cur;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on || (!cur && b.dataset.tab === 'nav') ? 0 : -1;
    });
  }

  /** Open one of the view tabs: picks the current or first room/rack when one is needed. */
  RB.openViewTab = function (tab, focusSiteId) {
    const ui = RB.ui, s = S();
    // A view tab always shows its view, so close any drawer that would sit over it on small screens.
    if (RB.closeDrawers) RB.closeDrawers();
    const site0 = RB.contextSiteId();
    const siteName = (id) => { const st = id && RB.get.site(id); return st ? st.name : 'this site'; };
    if (tab === 'atlas') {
      // Every site on one map, with the site we are in picked out; the overview's details stay beside it.
      if (ui.view !== 'home') RB.navigate('home');
      ui.tab = 'atlas';
      ui.atlasFocus = focusSiteId || (ui.view !== 'home' ? site0 : null) || null;
      RB.render();
      return;
    }
    const curRack = ui.rackId && RB.get.rack(ui.rackId);
    const curRoomId = ui.roomId || (curRack && curRack.roomId);
    if (tab === 'nav') {
      // Browse the building: the site we are in, else the first one in the list.
      const first = RB.sortSites(s.sites)[0];
      const siteId = site0 || (first && first.id);
      if (ui.view === 'site' || ui.view === 'floor') { ui.tab = 'nav'; RB.render(); }
      else if (siteId) RB.navigate('site', siteId);
      else { ui.tab = 'nav'; RB.render(); if (window.innerWidth <= 767) RB.openDrawer('nav'); }
      return;
    }
    // The rooms to choose from: those of the site we are in (or, with no site yet, every site in list order).
    const rooms = site0 ? RB.roomsOfSite(site0) : RB.sortSites(s.sites).reduce((all, st) => all.concat(RB.roomsOfSite(st.id)), []);
    if (tab === 'map') {
      const room = (curRoomId && RB.get.room(curRoomId)) || rooms.find((r) => r.plan) || rooms[0];
      if (!room) { RB.toast(site0 ? 'Add a comms room to ' + siteName(site0) + ' first.' : 'Add a comms room first: open a site in Locations and add one.'); return; }
      ui.tab = 'map'; RB.navigate('room', room.id); return;
    }
    // Which rack to show: the one open now, else the rack (or the device's rack) selected here, else the rack last opened in the
    // room being looked at, else the first rack of this site (the one last opened there first), never a rack of another site.
    const inSite = (r) => r && (!site0 || siteIdOfRoom(r.roomId) === site0) ? r : null;
    const remembered = (roomId) => { const r = ui.lastRack && ui.lastRack[roomId] && RB.get.rack(ui.lastRack[roomId]); return r && r.roomId === roomId ? r : null; };
    const selRack = ui.sel && ui.sel.type === 'rack' && inSite(RB.get.rack(ui.sel.id));
    const selDev = ui.sel && ui.sel.type === 'device' && RB.get.device(ui.sel.id);
    let rack = curRack || selRack || (selDev && selDev.rackId && inSite(RB.get.rack(selDev.rackId))) ||
      (curRoomId && (remembered(curRoomId) || RB.get.racksOf(curRoomId)[0])) || (ui.lastRackId && inSite(RB.get.rack(ui.lastRackId))) || null;
    for (let i = 0; !rack && i < rooms.length; i++) rack = remembered(rooms[i].id) || RB.get.racksOf(rooms[i].id)[0] || null;
    if (tab === 'rack') {
      if (!rack) { RB.toast(site0 ? 'There is no rack at ' + siteName(site0) + ' yet. Open a comms room there and add one.' : 'Add a rack first: open a room in Locations and add one.'); return; }
      ui.tab = 'rack'; RB.navigate('rack', rack.id); return;
    }
    // Device library
    if (ui.view !== 'rack' && ui.view !== 'room') {
      if (rack) RB.navigate('rack', rack.id);
      else if (rooms[0]) RB.navigate('room', rooms[0].id);
      else { RB.openBuilder(); return; }
    }    ui.tab = 'lib';
    RB.render();
    if (window.innerWidth <= 1199) RB.openDrawer('lib');
    const q = RB.$('#libSearch'); if (q) q.focus({ preventScroll: true });
  };

  function traceBanner() {
    const hops = RB.ui.traceHops;
    if (!hops) return '';
    return '<div class="banner banner--trace">' + ic('trace') + '<div><b>Cable path</b><span>' + esc(RB.traceText(hops)) + '</span></div><button type="button" class="icon-btn" data-act="clear-trace" aria-label="Close the cable path">' + ic('close') + '</button></div>';
  }

  function renderOverview() {
    const n = RB.ui.nav;
    let title = 'Overview', sub = 'All sites', racks = S().racks.slice(), addBtn = '<button type="button" class="btn" data-act="vlans">' + ic('vlan') + ' VLANs &amp; Wi-Fi</button><button type="button" class="btn btn--primary" data-add="root">' + ic('plus') + ' Add site</button>';
    let groups = null; // comms rooms of the open site or floor, each with its racks
    if (n.type === 'site') {
      const site = RB.get.site(n.id);
      title = site.name; sub = 'Site overview';
      groups = RB.get.siteRoomsOf(site.id).concat(...RB.get.floorsOf(site.id).map((f) => RB.get.roomsOf(f.id)));
      addBtn = '<button type="button" class="btn" data-add="site-floor" data-id="' + site.id + '">' + ic('floor') + ' Add floor</button><button type="button" class="btn btn--primary" data-add="site" data-id="' + site.id + '">' + ic('plus') + ' Add comms room</button>';
    } else if (n.type === 'floor') {
      const floor = RB.get.floor(n.id);
      title = floor.name; sub = (RB.get.site(floor.siteId) || {}).name || '';
      groups = RB.get.roomsOf(floor.id);
      addBtn = '<button type="button" class="btn btn--primary" data-add="floor" data-id="' + floor.id + '">' + ic('plus') + ' Add comms room</button>';
    }
    if (groups) { const ids = new Set(groups.map((r) => r.id)); racks = racks.filter((r) => ids.has(r.roomId)); }
    RB.$('#toolbar').innerHTML = '<div class="tb-title"><h1>' + esc(title) + '</h1><span>' + esc(sub) + '</span></div><div class="tb-actions">' + addBtn + '</div>';
    const devs = S().devices;
    // On a site or floor page, count what is in its racks and comms rooms only.
    const roomIds = groups ? new Set(groups.map((r) => r.id)) : null;
    const rackIds = new Set(racks.map((r) => r.id));
    const here = roomIds ? new Set(devs.filter((d) => rackIds.has(d.rackId) || roomIds.has(d.roomId)).map((d) => d.id)) : null;
    const cables = here ? S().connections.filter((c) => here.has(c.a.d) || here.has(c.b.d)).length : S().connections.length;
    const stats = [['Racks', racks.length], ['Rack units used', racks.reduce((a, r) => a + RB.occupancy(r.id).used, 0) + ' / ' + racks.reduce((a, r) => a + r.units, 0)], ['Devices', here ? here.size : devs.filter((d) => racks.some((r) => r.id === d.rackId)).length], ['Cables', cables]];
    let body = traceBanner();
    if (!S().sites.length) {
      body += '<div class="empty-hero"><div class="empty-art">' + ic('rack', 40) + '</div><h2>Document your first rack</h2><p>Start with the site and its comms room, then add the rack and drag devices into it. Or import your switch port register.</p><button type="button" class="btn btn--primary" data-add="root">' + ic('plus') + ' Add a site</button><button type="button" class="btn" data-act="import-sheet">Import a spreadsheet</button><button type="button" class="btn btn--ghost" data-act="data">Load the example</button></div>';
    } else {
      body += '<div class="stat-row">' + stats.map((s) => '<div class="stat"><b>' + s[1] + '</b><span>' + s[0] + '</span></div>').join('') + '</div>';
      body += attentionCard(racks);
      if (n.type === 'site' && RB.siteBoxes) body += RB.siteBoxes(RB.get.site(n.id));
      const card = (r, withPath) => {
        const occ = RB.occupancy(r.id);
        const room = RB.get.room(r.roomId);
        const nDev = RB.get.devicesInRack(r.id).length;
        return '<button type="button" class="rack-card" data-nav="rack" data-id="' + r.id + '">' + RB.miniRack(r) + '<span class="rc-main"><b>' + esc(r.name) + '</b><small>' + esc(withPath ? RB.get.pathOfRoom(room) : (r.notes || 'Rack · ' + r.units + 'U')) + '</small>' +
          '<span class="occ"><span style="width:' + Math.round((occ.used / occ.total) * 100) + '%"></span></span><small>' + occ.used + ' of ' + occ.total + 'U used · ' + nDev + ' device' + (nDev === 1 ? '' : 's') + '</small></span></button>';
      };
      if (groups) {
        // Site › Comms rooms › Racks: one section per comms room.
        if (!groups.length) body += '<div class="empty-card"><p>No comms rooms here yet.</p><button type="button" class="btn btn--primary sm" data-add="' + (n.type === 'site' ? 'site' : 'floor') + '" data-id="' + n.id + '">' + ic('plus') + ' Add a comms room</button></div>';
        groups.forEach((room) => {
          const rr = RB.get.racksOf(room.id);
          const fl = room.floorId && n.type === 'site' ? RB.get.floor(room.floorId) : null;
          const eps = RB.get.endpointsOf(room.id).length;
          body += '<section class="cr-sec"><div class="cr-head"><button type="button" class="cr-name" data-nav="room" data-id="' + room.id + '">' + ic('room', 16) + '<b>' + esc(room.name) + '</b></button>' +
            '<small>' + [fl && fl.name, rr.length + (rr.length === 1 ? ' rack' : ' racks'), eps ? eps + ' outlet' + (eps === 1 ? '' : 's') : ''].filter(Boolean).map(esc).join(' · ') + '</small>' +
            '<button type="button" class="btn sm" data-add="room" data-id="' + room.id + '">' + ic('plus', 14) + ' Add rack</button></div>' +
            (rr.length ? '<div class="rack-cards">' + rr.map((r) => card(r, false)).join('') + '</div>' : '<p class="cr-empty">No racks in this comms room yet.</p>') + '</section>';
        });
      } else if (!racks.length) body += '<div class="empty-card"><p>No racks here yet. Open a comms room in the left column and add a rack to it.</p></div>';
      else body += '<div class="rack-cards">' + racks.map((r) => card(r, true)).join('') + '</div>';
    }
    RB.$('#canvas').innerHTML = '<div class="overview">' + body + '</div>';
    RB.$('#bottom').hidden = true;
  }

  /* Things in these racks that are not fully documented yet. */
  const NEEDS_IP = ['Switch', 'Gateway', 'Firewall', 'Router', 'Server', 'Storage', 'NVR'];
  function attentionCard(racks) {
    const items = [];
    racks.forEach((r) => {
      const occ = RB.occupancy(r.id);
      const pct = occ.total ? Math.round((occ.used / occ.total) * 100) : 0;
      if (pct >= 90) items.push(['rack', r.id, r.name + ' is ' + pct + '% full', occ.total - occ.used + 'U free']);
      RB.get.devicesInRack(r.id).forEach((d) => {
        const t = RB.get.template(d.templateId) || {};
        if (NEEDS_IP.indexOf(t.category) >= 0 && !String(d.ip || '').trim()) items.push(['device', d.id, d.name + ' has no IP address', r.name]);
        const unlabelled = RB.connsOfDevice(d.id).filter((c) => !String(c.label || '').trim()).length;
        if (unlabelled && t.category !== 'Patch panel') items.push(['device', d.id, d.name + ': ' + unlabelled + ' cable' + (unlabelled === 1 ? '' : 's') + ' without a label', r.name]);
      });
    });
    const head = '<h2 class="sec-title">Needs attention</h2>';
    if (!items.length) return head + '<div class="attn attn--ok">' + ic('check') + '<span>Everything in view is documented: every rack has room, network devices have IP addresses and cables are labelled.</span></div>';
    const shown = items.slice(0, 8);
    return head + '<ul class="attn">' + shown.map((it) => '<li><button type="button" class="attn-row" data-hit="' + it[0] + '" data-id="' + it[1] + '"><b>' + esc(it[2]) + '</b><small>' + esc(it[3]) + '</small></button></li>').join('') +
      (items.length > shown.length ? '<li class="attn-more">and ' + (items.length - shown.length) + ' more</li>' : '') + '</ul>';
  }

  /* ---------- room ---------- */
  /** Where things with no saved position go while a room is laid out automatically (nothing is saved until someone drags it):
      the busiest rack (the comms rack) in the middle, other racks on an inner ring, outlets and endpoints on the rings outside.
      It works in real pixels (the plan is 16:9 and fills the page width), then pushes any markers that still touch apart, so none overlap. */
  function autoLayout(racks, eps) {
    const out = {};
    const canvas = RB.$('#canvas');
    const W = Math.max(360, (canvas ? canvas.clientWidth : 900) - 40), H = Math.round((W * 9) / 16);
    const MH = 46; // a marker is about this tall
    const wOf = (it) => 28 + String(it.name || '').length * 5;
    const fr = racks.filter((r) => !r.pos), fe = eps.filter((d) => !d.pos);
    const nodes = [];
    // Things someone has already placed stay where they are and the rest keep clear of them.
    racks.concat(eps).filter((x) => x.pos).forEach((x) => nodes.push({ x: (x.pos.x / 100) * W, y: (x.pos.y / 100) * H, w: wOf(x), pin: true }));
    const cx = W / 2, cy = H * 0.58;
    const hub = fr.length ? fr.slice().sort((a, b) => RB.occupancy(b.id).used - RB.occupancy(a.id).used)[0] : null;
    if (hub) nodes.push({ id: hub.id, x: cx, y: cy, w: wOf(hub), pin: true });
    const radii = [[0.17, 0.2], [0.3, 0.34], [0.43, 0.46]];
    let ring = 0, tilt = 0;
    const perim = (a, b) => 2 * Math.PI * Math.sqrt((a * a + b * b) / 2);
    function place(items) {
      let rest = items.slice();
      while (rest.length) {
        const r = radii[Math.min(ring, radii.length - 1)];
        const a = W * r[0], b = H * r[1];
        const room = ring >= radii.length ? rest.length : Math.max(1, Math.floor(perim(a, b) / (Math.max(...rest.map(wOf)) + 10)));
        const take = rest.splice(0, room);
        take.forEach((it, i) => {
          const t = -Math.PI / 2 + tilt + (2 * Math.PI * i) / take.length;
          nodes.push({ id: it.id, x: cx + a * Math.cos(t), y: cy + b * Math.sin(t) * 0.9, w: wOf(it) });
        });
        tilt += Math.PI / Math.max(2, take.length);
        ring++;
      }
    }
    place(fr.filter((r) => r !== hub));
    if (fe.length) place(fe);
    // Push apart whatever still touches, keeping everything inside the plan.
    const clampN = (n) => { if (n.pin) return; n.x = RB.clamp(n.x, n.w / 2 + 4, W - n.w / 2 - 4); n.y = RB.clamp(n.y, MH + 4, H - 4); };
    nodes.forEach(clampN);
    for (let it = 0; it < 160; it++) {
      let moved = false;
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const p = nodes[i], q = nodes[j];
        if (p.pin && q.pin) continue;
        const dx = p.x - q.x, dy = p.y - q.y;
        const ox = (p.w + q.w) / 2 + 10 - Math.abs(dx), oy = MH + 8 - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        const kp = p.pin ? 0 : q.pin ? 1 : 0.5, kq = q.pin ? 0 : p.pin ? 1 : 0.5;
        if (ox < oy) { const s = dx >= 0 ? 1 : -1; p.x += s * ox * kp; q.x -= s * ox * kq; }
        else { const s = dy >= 0 ? 1 : -1; p.y += s * oy * kp; q.y -= s * oy * kq; }
        clampN(p); clampN(q);
      }
      if (!moved) break;
    }
    nodes.forEach((n) => { if (n.id && !n.pin || n.id === (hub && hub.id)) out[n.id] = { x: Math.round((n.x / W) * 1000) / 10, y: Math.round((n.y / H) * 1000) / 10 }; });
    return out;
  }

  function renderRoomView() {
    const room = RB.get.room(RB.ui.roomId);
    const racks = RB.get.racksOf(room.id);
    const eps = RB.get.endpointsOf(room.id);
    RB.$('#toolbar').innerHTML = '<div class="tb-title"><h1>' + esc(room.name) + '</h1><span>' + esc(RB.get.pathOfRoom(room)) + '</span></div>' +
      '<div class="tb-actions"><button type="button" class="btn lib-toggle" data-act="library">' + ic('lib') + '<span>Library</span></button>' +
      '<button type="button" class="btn" data-act="plan-upload">' + ic('image') + '<span>' + (room.plan ? 'Replace floor plan' : 'Floor plan') + '</span></button>' +
      '<button type="button" class="btn" data-add-endpoint="' + room.id + '">' + ic('pin') + '<span>Add outlet</span></button>' +
      '<button type="button" class="btn btn--primary" data-add="room" data-id="' + room.id + '">' + ic('plus') + '<span>Add rack</span></button></div>';
    const auto = autoLayout(racks, eps);
    const marker = (kind, item, icon, extra) => {
      const p = item.pos || auto[item.id] || { x: 50, y: 50 };
      const sel = RB.ui.sel && RB.ui.sel.id === item.id;
      const trace = RB.ui.traceSet && kind === 'device' && Array.from(RB.ui.traceSet).some((k) => k.startsWith(item.id + '|'));
      return '<button type="button" class="marker marker--' + kind + (sel ? ' is-sel' : '') + (trace ? ' is-trace' : '') + '" data-marker="' + kind + '" data-id="' + item.id + '" style="left:' + p.x + '%;top:' + p.y + '%">' +
        '<span class="mk-dot">' + ic(icon, 13) + '</span><span class="mk-name">' + esc(item.name) + (extra || '') + '</span></button>';
    };
    const plan = '<div class="plan' + (room.plan ? ' has-img' : '') + '" id="plan">' + (room.plan ? '<img src="' + room.plan + '" alt="Floor plan of ' + esc(room.name) + '" draggable="false">' : '<div class="plan-grid">' + (racks.length || eps.length ? '' : '<span>Drop outlets and racks here. Add a floor plan picture to place them where they really are.</span>') + '</div>') +
      racks.map((r) => marker('rack', r, 'rack')).join('') + eps.map((d) => marker('device', d, 'pin')).join('') + '</div>';
    const rackList = racks.length ? '<div class="rack-cards rack-cards--sm">' + racks.map((r) => {
      const occ = RB.occupancy(r.id);
      return '<button type="button" class="rack-card" data-nav="rack" data-id="' + r.id + '">' + RB.miniRack(r) + '<span class="rc-main"><b>' + esc(r.name) + '</b><span class="occ"><span style="width:' + Math.round((occ.used / occ.total) * 100) + '%"></span></span><small>' + occ.used + ' of ' + occ.total + 'U used</small></span></button>';
    }).join('') + '</div>' : '<div class="empty-card"><p>No racks in this room.</p><button type="button" class="btn btn--primary sm" data-add="room" data-id="' + room.id + '">' + ic('plus') + ' Add rack</button></div>';
    const epRows = eps.length ? '<table class="tbl tbl--click"><thead><tr><th>Name</th><th>Type</th><th>Ports</th><th>Connected to</th></tr></thead><tbody>' + eps.map((d) => {
      const t = RB.get.template(d.templateId) || {};
      const conns = RB.devicePorts(d).filter((p) => !p.twin).map((p) => {
        const hops = RB.trace(d.id, p.key);
        const far = hops.filter((h) => h.d !== d.id);
        const last = far.length ? far[far.length - 1] : (hops[0] && hops[0].d !== d.id ? hops[0] : null);
        const first = far.find((h) => { const x = RB.get.device(h.d); return x && x.rackId; });
        const target = first || last;
        if (!target) return null;
        const td = RB.get.device(target.d);
        return esc(p.name) + ' → ' + esc(td.name + ' / ' + RB.portLabel(td, target.p));
      }).filter(Boolean);
      return '<tr data-sel-dev="' + d.id + '" class="' + (RB.ui.sel && RB.ui.sel.id === d.id ? 'is-sel' : '') + '"><td><b>' + esc(d.name) + '</b></td><td>' + esc(t.name) + '</td><td>' + RB.devicePorts(d).filter((p) => !p.twin).length + '</td><td>' + (conns.join('<br>') || '<span class="muted">Not connected</span>') + '</td></tr>';
    }).join('') + '</tbody></table>' : '<p class="empty-note">No outlets or endpoints yet. Use “Add outlet” or drag one from the library onto the plan.</p>';
    RB.$('#canvas').innerHTML = '<div class="room-view">' + traceBanner() + plan + '<h3 class="sec-title">Racks</h3>' + rackList + '<h3 class="sec-title">Outlets & endpoints</h3>' + epRows + '</div>';
    RB.$('#bottom').hidden = true;
  }

  /* ---------- rack ---------- */
  RB.effectiveZoom = function () {
    const ui = RB.ui;
    const canvas = RB.$('#canvas');
    const avail = Math.max(240, (canvas ? canvas.clientWidth : 800) - 40);
    const need = 470 + 60 + 68 + 20;       // the rack, its numbered rails and the two cable managers
    const fit = RB.clamp(avail / need, 0.45, 1.25);
    if (ui.zoomMode === 'manual') return ui.zoom;
    return Math.min(1, fit);
  };

  /** A small key above the rack when ports are coloured by VLAN or patch cable. */
  function colourKey() {
    const mode = RB.ui.colorBy;
    if (mode !== 'vlan' && mode !== 'lead') return '';
    const vlans = S().vlans.slice().sort((a, b) => Number(a.vid) - Number(b.vid));
    let items;
    if (mode === 'vlan') items = vlans.map((v) => [v.color, v.vid + ' ' + v.name]);
    else {
      const by = {};
      vlans.forEach((v) => { if (v.lead && RB.leadHex(v.lead)) (by[v.lead] = by[v.lead] || []).push(v.name); });
      items = Object.keys(by).map((k) => [RB.leadHex(k), k + ': ' + by[k].join(', ')]);
    }
    if (!items.length) return '<div class="ckey"><span class="ckey-t">' + (mode === 'lead' ? 'No cable colours yet. Set them on a VLAN or in a port’s details.' : 'No VLANs yet.') + '</span></div>';
    return '<div class="ckey" aria-label="Colour key"><span class="ckey-t">' + (mode === 'lead' ? 'Cable colours' : 'VLANs') + '</span>' +
      items.map((i) => '<span class="ckey-i"><i style="background:' + esc(i[0]) + '"></i>' + esc(i[1]) + '</span>').join('') + '</div>';
  }

  function renderRackView() {
    const ui = RB.ui;
    const rack = RB.get.rack(ui.rackId);
    const occ = RB.occupancy(rack.id);
    const z = RB.effectiveZoom();
    // Other racks in the same comms room, so you can switch between a main rack and its sub racks here.
    const roomRacks = RB.get.racksOf(rack.roomId);
    const picker = roomRacks.length > 1 ? '<div class="rack-pick"><select data-rack-pick aria-label="Rack in this room" title="Switch to another rack in this room">' +
      roomRacks.map((r) => '<option value="' + r.id + '"' + (r.id === rack.id ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('') + '</select></div>' : '';
    RB.$('#toolbar').innerHTML =
      '<div class="tb-title"><h1>' + esc(rack.name) + '</h1><span>' + rack.units + 'U · ' + occ.free + 'U free · ' + RB.get.devicesInRack(rack.id).length + ' devices</span>' + picker + '</div>' +
      '<div class="tb-actions">' +
      '<button type="button" class="btn lib-toggle" data-act="library">' + ic('lib') + '<span>Library</span></button>' +
      '<div class="seg" role="group" aria-label="Side of the rack"><button type="button" class="' + (ui.face === 'front' ? 'is-on' : '') + '" data-face="front" aria-pressed="' + (ui.face === 'front') + '">Front</button><button type="button" class="' + (ui.face === 'rear' ? 'is-on' : '') + '" data-face="rear" aria-pressed="' + (ui.face === 'rear') + '">Rear</button></div>' +
      '<div class="seg seg--zoom" role="group" aria-label="Zoom"><button type="button" data-zoom="-1" aria-label="Zoom out">' + ic('zoomOut') + '</button><button type="button" data-zoom="fit" title="Fit to screen">' + Math.round(z * 100) + '%</button><button type="button" data-zoom="1" aria-label="Zoom in">' + ic('zoomIn') + '</button></div>' +
      '<button type="button" class="btn' + (ui.showCables ? ' is-on' : '') + '" data-act="cables" aria-pressed="' + !!ui.showCables + '">' + ic('cable') + '<span>Cables</span></button>' +
      '<button type="button" class="btn' + (ui.colorBy === 'vlan' || ui.colorBy === 'lead' ? ' is-on' : '') + '" data-act="colorby" aria-haspopup="menu" title="Colour the ports by cable colour, VLAN or the cable colour standard">' + ic('vlan') + '<span>' + (ui.colorBy === 'lead' ? 'Cable colour standard' : ui.colorBy === 'vlan' ? 'VLAN colours' : 'Port colours') + '</span></button>' +
      '<button type="button" class="btn' + (ui.patchMode ? ' is-on btn--accent' : '') + '" data-act="patch" aria-pressed="' + !!ui.patchMode + '">' + ic('link') + '<span>Patch mode</span></button>' +
      '<button type="button" class="btn" data-act="print">' + ic('print') + '<span>PDF</span></button>' +
      '</div>';
    const pick = RB.$('#toolbar [data-rack-pick]');
    if (pick) pick.addEventListener('change', () => { if (pick.value && pick.value !== rack.id) RB.navigate('rack', pick.value); });
    let banners = traceBanner() + colourKey();
    if (ui.patchMode) {
      const from = ui.patchFrom && RB.get.device(ui.patchFrom.d);
      banners += '<div class="banner banner--patch">' + ic('link') + '<div><b>Patch mode</b><span>' + (from ? 'Now click the port to connect to <b>' + esc(from.name + ' / ' + RB.portLabel(from, ui.patchFrom.p)) + '</b>' : 'Click the first port of the cable. Switch to Rear to reach the back of patch panels.') + '</span></div><button type="button" class="btn sm" data-act="patch">Done</button></div>';
    }
    if (ui.placing) {
      const t = RB.get.template(ui.placing);
      banners += '<div class="banner banner--place">' + ic('plus') + '<div><b>Place ' + esc(t ? t.name : '') + '</b><span>Click a free unit (+) in the rack.</span></div><button type="button" class="btn sm" data-act="cancel-place">Cancel</button></div>';
    }
    const canvas = RB.$('#canvas');
    canvas.innerHTML = '<div class="rack-view">' + banners + '<div class="rack-stage"></div></div>';
    const el = RB.renderRack(rack, { face: ui.face, zoom: z, interactive: true });
    canvas.querySelector('.rack-stage').appendChild(el);
    requestAnimationFrame(() => RB.drawCables(el));
    renderBottom(rack);
  }

  function renderBottom(rack) {
    const ui = RB.ui;
    const host = RB.$('#bottom');
    host.hidden = false;
    const devs = RB.get.devicesInRack(rack.id);
    const ids = new Set(devs.map((d) => d.id));
    const conns = S().connections.filter((c) => ids.has(c.a.d) || ids.has(c.b.d));
    let content = '';
    if (ui.bottomTab === 'devices') {
      content = devs.length ? '<table class="tbl tbl--click"><thead><tr><th>U</th><th>Name</th><th>Type</th><th>Model</th><th>IP / hostname</th><th>Serial</th><th>Ports in use</th></tr></thead><tbody>' + devs.map((d) => {
        const t = RB.get.template(d.templateId) || {};
        const ports = RB.devicePorts(d);
        const used = ports.filter((p) => RB.connOf(d.id, p.key)).length;
        const u = RB.unitsOf(d);
        return '<tr data-sel-dev="' + d.id + '" class="' + (ui.sel && ui.sel.id === d.id ? 'is-sel' : '') + '"><td>' + RB.uLabel(rack, d.position + u - 1) + (u > 1 ? '–' + RB.uLabel(rack, d.position) : '') + '</td><td><span class="dot" style="background:' + t.color + '"></span><b>' + esc(d.name) + '</b></td><td>' + esc(t.category || '') + '</td><td>' + esc([t.maker, t.model].filter(Boolean).join(' ')) + '</td><td>' + esc(d.ip) + '</td><td>' + esc(d.serial) + '</td><td>' + used + ' / ' + ports.length + '</td></tr>';
      }).join('') + '</tbody></table>' : '<p class="empty-note">This rack is empty. Drag devices from the library, or press + on a free unit.</p>';
    } else {
      content = conns.length ? '<table class="tbl"><thead><tr><th>From</th><th></th><th>To</th><th>Cable</th><th>Length</th><th>Label</th><th></th></tr></thead><tbody>' + conns.map((c) => {
        let a = c.a, b = c.b;
        if (!ids.has(a.d)) { const t = a; a = b; b = t; }
        const da = RB.get.device(a.d), db = RB.get.device(b.d);
        return '<tr><td><b>' + esc(da.name) + '</b> / ' + esc(RB.portLabel(da, a.p)) + '</td><td><span class="cable-sw" style="background:' + esc(RB.connColor(c)) + '"></span></td><td><b>' + esc(db.name) + '</b> / ' + esc(RB.portLabel(db, b.p)) + '<small class="muted"> · ' + esc(RB.get.whereIsDevice(db)) + '</small></td><td>' + esc(c.cable) + '</td><td>' + esc(c.length) + '</td><td>' + esc(c.label) + '</td>' +
          '<td class="t-act"><button type="button" class="icon-btn" data-trace-d="' + a.d + '" data-trace-p="' + a.p + '" aria-label="Show cable path">' + ic('trace') + '</button><button type="button" class="icon-btn" data-edit-con="' + c.id + '" aria-label="Cable details">' + ic('edit') + '</button><button type="button" class="icon-btn danger" data-del-con="' + c.id + '" aria-label="Disconnect">' + ic('unlink') + '</button></td></tr>';
      }).join('') + '</tbody></table>' : '<p class="empty-note">No cables yet. Click a port to connect it, or use Patch mode.</p>';
    }
    host.innerHTML = '<div class="bottom-head"><button type="button" class="bottom-tog" data-act="bottom" aria-expanded="' + !!ui.bottomOpen + '">' + ic('device', 14) + '<span>Devices & connections</span></button>' +
      '<div class="bottom-tabs"><button type="button" class="' + (ui.bottomTab === 'devices' ? 'is-on' : '') + '" data-btab="devices">Devices <em>' + devs.length + '</em></button><button type="button" class="' + (ui.bottomTab === 'conns' ? 'is-on' : '') + '" data-btab="conns">Connections <em>' + conns.length + '</em></button></div>' +
      '<button type="button" class="icon-btn sm" data-act="csv-rack" title="Download as spreadsheet (CSV)" aria-label="Download as spreadsheet">' + ic('download', 14) + '</button>' +
      '<button type="button" class="icon-btn sm bottom-chev' + (ui.bottomOpen ? ' is-open' : '') + '" data-act="bottom" aria-label="' + (ui.bottomOpen ? 'Collapse' : 'Expand') + '">' + ic('up', 14) + '</button></div>' +
      (ui.bottomOpen ? '<div class="bottom-body">' + content + '</div>' : '');
  }

  /* ======================= inspector ======================= */
  function input(field, label, value, type, extra) {
    return '<label class="ifield"><span>' + esc(label) + '</span><input data-f="' + field + '" type="' + (type || 'text') + '" value="' + esc(value || '') + '"' + (extra || '') + '></label>';
  }

  function notesCard(kind, id, text) {
    const editing = RB.ui.editNotes === id;
    return '<div class="notes"><div class="notes-head">' + ic('note', 14) + '<b>Notes</b></div>' +
      (editing ? '<textarea class="notes-edit" data-notes="' + kind + '" data-id="' + id + '" rows="5" aria-label="Notes">' + esc(text || '') + '</textarea><div class="btn-row"><button type="button" class="btn sm btn--primary" data-notes-save="' + kind + '" data-id="' + id + '">Save</button><button type="button" class="btn sm" data-notes-cancel>Cancel</button></div>'
        : (text ? '<p class="notes-text">' + esc(text) + '</p>' : '<p class="notes-text muted">Add your first note…</p>') + '<button type="button" class="link-btn" data-notes-edit="' + id + '">' + ic('edit', 12) + ' Edit</button>') + '</div>';
  }

  function renderInspector() {
    const ui = RB.ui;
    const host = RB.$('#inspector');
    let sel = ui.sel;
    if (!sel && ui.nav.type !== 'home') sel = { type: ui.nav.type, id: ui.nav.id };
    let html = '<button type="button" class="icon-btn insp-close" data-act="close-insp" aria-label="Close details">' + ic('close') + '</button>';
    if (!sel) {
      html += '<div class="insp-sec"><h2>' + esc(S().workspace) + '</h2><p class="muted">Pick a location, room or rack on the left. Select a device to see its details here.</p></div>' +
        '<div class="insp-sec"><h3>Recent changes</h3><ol class="history history--mini">' + S().history.slice(0, 8).map((h) => '<li><time>' + esc(RB.fmtDate(h.ts)) + '</time><span>' + esc(h.text) + (h.by ? ' <em class="by">· ' + esc(h.by) + '</em>' : '') + '</span></li>').join('') + '</ol><button type="button" class="link-btn" data-act="history">All changes</button></div>';
      host.innerHTML = html;
      return;
    }
    const t = sel.type;
    if (t === 'device') html += deviceInspector(RB.get.device(sel.id));
    else if (t === 'rack') html += rackInspector(RB.get.rack(sel.id));
    else if (t === 'room') html += roomInspector(RB.get.room(sel.id));
    else if (t === 'site') {
      const s = RB.get.site(sel.id);
      const vl = S().vlans.slice().sort((a, b) => a.vid - b.vid);
      html += '<div class="insp-sec" data-edit-kind="site" data-id="' + s.id + '"><p class="kicker">' + ic('site', 13) + ' Site</p>' + input('name', 'Site name', s.name) + '<div class="ifield-row">' + input('code', 'Site code', s.code || '') + input('contact', 'On-site contact', s.contact) + '</div>' + input('address', 'Address', s.address) +
        '<div class="ifield-row">' + input('lat', 'Latitude', s.lat == null ? '' : String(s.lat), 'text', ' inputmode="decimal" placeholder="-37.81"') + input('lon', 'Longitude', s.lon == null ? '' : String(s.lon), 'text', ' inputmode="decimal" placeholder="144.96"') + '</div>' +
        '<div class="btn-row"><button type="button" class="btn sm" data-act="geocode" data-id="' + s.id + '">' + ic('search', 14) + ' Find from address</button><button type="button" class="btn sm" data-act="sites-map" data-id="' + s.id + '">' + ic('site', 14) + ' Show on map</button></div></div>' +
        '<div class="insp-sec"><h3>IP ranges at this site</h3>' + (vl.length ? '<table class="tbl tbl--mini"><tbody>' + vl.map((v) => { const n = RB.vlanNet(v, s); return '<tr><td><span class="dot" style="background:' + esc(v.color) + '"></span>' + v.vid + '</td><td>' + esc(v.name) + '</td><td>' + (n.subnet ? esc(n.subnet) + (n.own ? '' : ' <small class="muted">usual</small>') : '<span class="muted">Not set</span>') + '</td></tr>'; }).join('') + '</tbody></table>' : '<p class="muted">No VLANs yet.</p>') +
        '<button type="button" class="link-btn" data-act="site-vlans" data-id="' + s.id + '">' + ic('vlan', 12) + ' Edit this site’s IP ranges</button></div>' +
        notesCard('site', s.id, s.notes) + '<div class="insp-sec"><button type="button" class="btn btn--danger-ghost sm" data-del="site" data-id="' + s.id + '">' + ic('trash', 14) + ' Delete site</button></div>';
    } else if (t === 'floor') {
      const f = RB.get.floor(sel.id);
      html += '<div class="insp-sec" data-edit-kind="floor" data-id="' + f.id + '"><p class="kicker">' + ic('floor', 13) + ' Floor</p>' + input('name', 'Name', f.name) + '</div><div class="insp-sec"><button type="button" class="btn btn--danger-ghost sm" data-del="floor" data-id="' + f.id + '">' + ic('trash', 14) + ' Delete floor</button></div>';
    }
    host.innerHTML = html;
  }

  function rackInspector(r) {
    const occ = RB.occupancy(r.id);
    const rooms = S().rooms.map((x) => '<option value="' + x.id + '"' + (x.id === r.roomId ? ' selected' : '') + '>' + esc(RB.get.pathOfRoom(x)) + '</option>').join('');
    return '<div class="insp-sec" data-edit-kind="rack" data-id="' + r.id + '"><p class="kicker">' + ic('rack', 13) + ' Rack</p>' +
      input('name', 'Name', r.name) +
      '<div class="ifield-row">' + input('units', 'Height (U)', r.units, 'number', ' min="1" max="60"') +
      '<label class="ifield"><span>Unit numbering</span><select data-f="numbering"><option value="bottom"' + (r.numbering !== 'top' ? ' selected' : '') + '>1 at the bottom</option><option value="top"' + (r.numbering === 'top' ? ' selected' : '') + '>1 at the top</option></select></label></div>' +
      '<label class="ifield"><span>Comms room</span><select data-f="roomId">' + rooms + '</select></label>' +
      '<div class="occ-big"><div class="occ"><span style="width:' + Math.round((occ.used / occ.total) * 100) + '%"></span></div><small>' + occ.used + 'U used · ' + occ.free + 'U free</small></div></div>' +
      notesCard('rack', r.id, r.notes) +
      '<div class="insp-sec btn-col"><button type="button" class="btn sm" data-act="print">' + ic('print', 14) + ' Print / PDF</button><button type="button" class="btn sm" data-act="rack-xlsx">' + ic('sheet', 14) + ' Port maps (Excel)</button><button type="button" class="btn sm" data-dup-rack="' + r.id + '">' + ic('copy', 14) + ' Duplicate rack</button><button type="button" class="btn btn--danger-ghost sm" data-del="rack" data-id="' + r.id + '">' + ic('trash', 14) + ' Delete rack</button></div>';
  }

  function roomInspector(room) {
    const site = RB.get.siteOfRoom(room);
    const floors = site ? RB.get.floorsOf(site.id) : [];
    const place = floors.length ? '<label class="ifield"><span>Sits under</span><select data-f="place"><option value="site:' + site.id + '"' + (!room.floorId ? ' selected' : '') + '>' + esc(site.name) + ' (the site)</option>' +
      floors.map((f) => '<option value="' + f.id + '"' + (f.id === room.floorId ? ' selected' : '') + '>' + esc(f.name) + '</option>').join('') + '</select></div>' : '';
    return '<div class="insp-sec" data-edit-kind="room" data-id="' + room.id + '"><p class="kicker">' + ic('room', 13) + ' Comms room</p>' + input('name', 'Name', room.name) + place +
      '<p class="muted small">' + RB.get.racksOf(room.id).length + ' racks · ' + RB.get.endpointsOf(room.id).length + ' outlets & endpoints</p>' +
      (room.plan ? '<div class="btn-row"><button type="button" class="btn sm" data-act="plan-upload">' + ic('image', 14) + ' Replace plan</button><button type="button" class="btn btn--danger-ghost sm" data-act="plan-remove">Remove plan</button></div>' : '<button type="button" class="btn sm" data-act="plan-upload">' + ic('image', 14) + ' Add a floor plan picture</button>') + '</div>' +
      notesCard('room', room.id, room.notes) +
      '<div class="insp-sec"><button type="button" class="btn btn--danger-ghost sm" data-del="room" data-id="' + room.id + '">' + ic('trash', 14) + ' Delete room</button></div>';
  }

  const HOST_CATS = ['Server', 'Storage'];
  function deviceInspector(d) {
    const t = RB.get.template(d.templateId) || { name: 'Unknown', groups: [] };
    const rack = d.rackId && RB.get.rack(d.rackId);
    const ports = RB.devicePorts(d);
    let where;
    if (rack) {
      const u = RB.unitsOf(d);
      where = '<div class="where"><span>' + ic('rack', 14) + ' <b>' + esc(rack.name) + '</b> · U' + RB.uLabel(rack, d.position) + (u > 1 ? '–' + RB.uLabel(rack, d.position + u - 1) : '') + '</span>' +
        '<span class="where-acts"><button type="button" class="icon-btn sm" data-move-dev="1" aria-label="Move up one unit">' + ic('up', 14) + '</button><button type="button" class="icon-btn sm" data-move-dev="-1" aria-label="Move down one unit">' + ic('down', 14) + '</button></span></div>';
    } else {
      const room = RB.get.room(d.roomId);
      where = '<div class="where"><span>' + ic('pin', 14) + ' <b>' + esc(room ? room.name : 'Unplaced') + '</b></span></div>';
    }
    const portRows = ports.map((p) => {
      const meta = d.portMeta[p.key] || (p.twin ? d.portMeta[p.key.slice(0, -1)] : null) || {};
      const conn = RB.connOf(d.id, p.key);
      let to ='<span class="muted">free</span>';
      if (conn) { const peer = RB.peerOf(conn, d.id, p.key); const pd = RB.get.device(peer.d); to = '<span class="cable-sw" style="background:' + esc(RB.connColor(conn)) + '"></span>' + esc(pd ? pd.name + ' / ' + RB.portLabel(pd, peer.p) : '?'); }
      return '<tr data-port-row="' + p.key + '" class="' + (RB.ui.portSel && RB.ui.portSel.p === p.key && RB.ui.portSel.d === d.id ? 'is-sel' : '') + '"><td><b>' + esc(p.name) + '</b>' + (p.side === 'rear' ? ' <small class="muted">rear</small>' : '') + '</td><td>' + esc(meta.label || '') + '</td><td>' + (meta.vlan && RB.get.vlan(meta.vlan) ? '<span class="dot" style="background:' + RB.get.vlan(meta.vlan).color + '"></span>' + RB.get.vlan(meta.vlan).vid : '') + '</td><td>' + to + '</td></tr>';
    }).join('');
    const usedCount = ports.filter((p) => RB.connOf(d.id, p.key)).length;
    return '<div class="insp-sec" data-edit-kind="device" data-id="' + d.id + '">' +
      '<p class="kicker"><span class="dot" style="background:' + esc(t.color) + '"></span>' + esc(t.category || 'Device') + '</p>' +
      input('name', 'Name', d.name) +
      '<p class="muted small tpl-line">' + esc(t.name) + (t.maker || t.model ? ' · ' + esc([t.maker, t.model].filter(Boolean).join(' ')) : '') + ' <button type="button" class="link-btn" data-edit-tpl="' + t.id + '">Edit template</button></p>' +
      where +
      '<div class="ifield-row">' + input('ip', 'IP / hostname', d.ip) + input('serial', 'Serial number', d.serial) + '</div>' +
      '<div class="ifield-row">' + input('mac', 'MAC address', d.mac) + input('platform', HOST_CATS.indexOf(t.category) >= 0 ? 'Platform / OS' : 'Firmware / platform', d.platform, 'text', ' list="platformList" placeholder="' + (HOST_CATS.indexOf(t.category) >= 0 ? 'e.g. Proxmox VE 8' : 'e.g. UniFi OS') + '"') + '</div>' +
      '<datalist id="platformList">' + RB.PLATFORMS.map((p) => '<option value="' + esc(p) + '">').join('') + '</datalist>' +
      '<div class="ifield-row">' + input('purchaseDate', 'Purchase date', d.purchaseDate, 'date') + input('startDate', 'In service since', d.startDate, 'date') + '</div>' +
      input('assetTag', 'Asset tag', d.assetTag) + '</div>' +
      '<div class="insp-sec photo-sec"><h3>Photo</h3>' + (d.photo ? '<img class="photo" src="' + d.photo + '" alt="Photo of ' + esc(d.name) + '"><div class="btn-row"><button type="button" class="btn sm" data-photo="' + d.id + '">Replace</button><button type="button" class="btn btn--danger-ghost sm" data-photo-del="' + d.id + '">Remove</button></div>' : '<button type="button" class="btn sm" data-photo="' + d.id + '">' + ic('image', 14) + ' Add a photo</button>') + '</div>' +
      notesCard('device', d.id, d.notes) +
      (ports.length ? '<div class="insp-sec"><h3>Ports <small class="muted">' + usedCount + ' of ' + ports.length + ' in use</small></h3><div class="port-table"><table class="tbl tbl--click tbl--tight"><thead><tr><th>Port</th><th>Label</th><th>VLAN</th><th>Connected to</th></tr></thead><tbody>' + portRows + '</tbody></table></div></div>' : '') +
      '<div class="insp-sec btn-col">' +
      (rack ? '<button type="button" class="btn sm" data-dup-dev="' + d.id + '">' + ic('copy', 14) + ' Duplicate</button><button type="button" class="btn sm" data-move-rack="' + d.id + '">' + ic('rack', 14) + ' Move to another rack</button>' : '<button type="button" class="btn sm" data-dup-dev="' + d.id + '">' + ic('copy', 14) + ' Duplicate</button>') +
      '<button type="button" class="btn btn--danger-ghost sm" data-del="device" data-id="' + d.id + '">' + ic('trash', 14) + ' Remove device</button></div>';
  }

  /* ======================= port pop-up ======================= */
  RB.openPortPopover = function (devId, key, anchor) {
    const d = RB.get.device(devId);
    const p = d && RB.portOf(d, key);
    if (!p) return;
    RB.ui.portSel = { d: devId, p: key };
    const metaKey = key.replace(/r$/, '');
    const meta = d.portMeta[p.twin ? metaKey : key] || {};
    const conn = RB.connOf(devId, key);
    const twin = RB.twinKey(d, key);
    let connHtml;
    if (conn) {
      const peer = RB.peerOf(conn, devId, key);
      const pd = RB.get.device(peer.d);
      connHtml = '<div class="pp-conn"><span class="cable-sw" style="background:' + esc(RB.connColor(conn)) + '"></span><div><small>Connected to</small><button type="button" class="link-btn" data-goto-dev="' + peer.d + '" data-goto-p="' + peer.p + '"><b>' + esc(pd.name) + ' / ' + esc(RB.portLabel(pd, peer.p)) + '</b></button><small>' + esc(RB.get.whereIsDevice(pd)) + ' · ' + esc(conn.cable) + (conn.length ? ' · ' + esc(conn.length) : '') + (conn.label ? ' · ' + esc(conn.label) : '') + '</small></div></div>' +
        '<div class="btn-row"><button type="button" class="btn sm" data-pp="trace">' + ic('trace', 14) + ' Cable path</button><button type="button" class="btn sm" data-pp="edit-con" data-id="' + conn.id + '">' + ic('edit', 14) + ' Cable</button><button type="button" class="btn btn--danger-ghost sm" data-pp="disconnect" data-id="' + conn.id + '">' + ic('unlink', 14) + ' Disconnect</button></div>';
    } else {
      connHtml = '<p class="muted small">Not connected.</p><div class="btn-row"><button type="button" class="btn btn--primary sm" data-pp="connect">' + ic('link', 14) + ' Connect…</button><button type="button" class="btn sm" data-pp="patch-here">Patch from here</button>' + (twin ? '<button type="button" class="btn sm" data-pp="trace">' + ic('trace', 14) + ' Path</button>' : '') + '</div>';
    }
    const vlanOpts = RB.vlanOptions(meta.vlan, 'No VLAN');
    const el = RB.$('#popover');
    el.innerHTML = '<div class="pp" role="dialog" aria-label="Port ' + esc(p.name) + '">' +
      '<div class="pp-head"><div><b>' + esc(d.name) + '</b><span>Port ' + esc(p.name) + (p.side === 'rear' ? ' · rear' : '') + ' · ' + esc(p.type) + '</span></div><button type="button" class="icon-btn sm" data-pp="close" aria-label="Close">' + ic('close', 14) + '</button></div>' +
      '<label class="ifield"><span>Label' + (twin ? ' (front and back)' : '') + '</span><input data-pp-f="label" value="' + esc(meta.label || '') + '" placeholder="e.g. Desk 12, Uplink"></label>' +
      '<label class="ifield"><span>VLAN</span><select data-pp-f="vlan">' + vlanOpts + '</select></label>' +
      '<details class="pp-more"' + (meta.status || meta.tagged || meta.patch || meta.notes || meta.lead || meta.type ? ' open' : '') + '><summary>Port details</summary><div class="pp-grid">' +
      '<label class="ifield"><span>Status</span><select data-pp-f="status">' + opts(['', 'Active', 'Spare', 'Reserved', 'Disabled', 'Faulty'], meta.status, 'Not set') + '</select></label>' +
      '<label class="ifield"><span>Cable colour</span><select data-pp-f="lead">' + opts([''].concat(Object.keys(RB.LEAD_COLOURS || {})), meta.lead, 'Not set') + '</select></label>' +
      '<label class="ifield"><span>Tagged VLANs</span><input data-pp-f="tagged" value="' + esc(meta.tagged || '') + '" placeholder="e.g. 102, 108 or All"></label>' +
      '<label class="ifield"><span>Patch point</span><input data-pp-f="patch" value="' + esc(meta.patch || '') + '" placeholder="e.g. PP-A 12"></label>' +
      '<label class="ifield"><span>Device type</span><input data-pp-f="type" value="' + esc(meta.type || '') + '" placeholder="e.g. Access point"></label>' +
      '<label class="ifield"><span>Notes</span><input data-pp-f="notes" value="' + esc(meta.notes || '') + '" placeholder="e.g. SFP+ DAC"></label>' +
      '</div></details>' +
      connHtml + '</div>';
    el.hidden = false;
    el.dataset.d = devId; el.dataset.p = key;
    positionPopover(el, anchor);
    RB.render({ keepPopover: true });
    setTimeout(() => { const i = el.querySelector('input'); if (i && !window.matchMedia('(max-width: 767px)').matches) i.focus(); }, 10);
  };

  /** <option>s for a list of values, keeping a current value that isn't in the list. */
  function opts(list, cur, emptyLabel) {
    const all = cur && list.indexOf(cur) < 0 ? list.concat([cur]) : list;
    return all.map((v) => '<option value="' + esc(v) + '"' + (v === (cur || '') ? ' selected' : '') + '>' + esc(v || emptyLabel || '') + '</option>').join('');
  }

  function positionPopover(el, anchor) {
    const pp = el.firstElementChild;
    const vw = window.innerWidth, vh = window.innerHeight;
    if (vw < 768 || !anchor) { el.classList.add('is-sheet'); pp.style.left = pp.style.top = ''; return; }
    el.classList.remove('is-sheet');
    const r = anchor.getBoundingClientRect();
    const w = pp.offsetWidth || 300, h = pp.offsetHeight || 260;
    let left = r.left + r.width / 2 - w / 2;
    let top = r.bottom + 10;
    if (top + h > vh - 8) top = Math.max(8, r.top - h - 10);
    left = RB.clamp(left, 8, vw - w - 8);
    pp.style.left = left + 'px';
    pp.style.top = top + 'px';
  }

  /** Close the port pop-up. `light` only hides it without redrawing, so a click that
      started on another control is not lost under a re-rendered screen. */
  RB.closePopover = function (light) {
    const el = RB.$('#popover');
    if (el.hidden) return false;
    // Keep anything typed in the pop-up that was not saved yet.
    const d = el.dataset.d, p = el.dataset.p;
    const pending = RB.$$('[data-pp-f]', el).map((f) => [f.dataset.ppF, f.value.trim()]);
    el.hidden = true;
    el.innerHTML = '';
    if (RB.setPortMeta && RB.get.device(d)) pending.forEach((x) => RB.setPortMeta(d, p, x[0], x[1]));
    RB.ui.portSel = null;
    if (light) {
      RB.$$('.port.is-sel').forEach((p) => p.classList.remove('is-sel'));
      RB.$$('[data-port-row].is-sel').forEach((p) => p.classList.remove('is-sel'));
    } else RB.render();
    return true;
  };

  /* ======================= tracing ======================= */
  RB.startTrace = function (devId, key, quiet) {
    const hops = RB.trace(devId, key);
    RB.ui.traceHops = hops;
    RB.ui.traceSet = new Set(hops.map((h) => h.d + '|' + h.p));
    if (!quiet) RB.render();
  };
  function clearTrace() { RB.ui.traceHops = null; RB.ui.traceSet = null; }
  RB.clearTrace = () => { clearTrace(); RB.render(); };

  /* ======================= render all ======================= */
  RB.render = function (opts) {
    RB.get.reset();
    // Never redraw under a pressed mouse button: the click would land on a replaced element.
    if (RB.pointerDown) { RB.renderPending = true; return; }
    validateNav();
    renderTop();
    renderSidebar();
    renderLibrary();
    renderMain();
    renderInspector();
    if (!(opts && opts.keepPopover)) {
      const pop = RB.$('#popover');
      if (!pop.hidden) {
        const d = RB.get.device(pop.dataset.d);
        if (!d || !RB.portOf(d, pop.dataset.p)) { pop.hidden = true; pop.innerHTML = ''; }
      }
    }
    RB.saveUi(RB.ui);
  };
})();
