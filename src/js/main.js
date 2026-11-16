/* CommsAtlas — start-up and all interaction: clicks, drag and drop, keyboard, drawers. */
(function () {
  'use strict';
  const RB = window.RB;
  const S = () => RB.store.state;
  const $ = RB.$;

  /* ======================= actions on the workspace ======================= */
  const PREFIX = { 'Patch panel': 'PP', Switch: 'SW', Gateway: 'GW', Router: 'RT', Firewall: 'FW', Server: 'SRV', Storage: 'NAS', NVR: 'NVR', Power: 'PWR',
    'Access point': 'AP', Camera: 'CAM', 'Nurse call': 'NC', Phone: 'PH', 'Access control': 'DOOR', 'Building management': 'BMS', IoT: 'IOT', 'Display / AV': 'AV' };
  RB.autoName = function (tpl) {
    let prefix = PREFIX[tpl.category];
    if (!prefix && tpl.category === 'Endpoint') prefix = (tpl.model || tpl.name).toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 5) || 'EP';
    if (!prefix) return RB.nextName(tpl.name);
    const re = new RegExp('^' + prefix + '-(\\d+)$');
    let max = 0;
    S().devices.forEach((d) => { const m = re.exec(d.name); if (m) max = Math.max(max, +m[1]); });
    return prefix + '-' + String(max + 1).padStart(2, '0');
  };

  function newDevice(tpl, where) {
    return Object.assign({ id: RB.uid('dev'), templateId: tpl.id, name: RB.autoName(tpl), rackId: null, roomId: null, position: null, ip: '', serial: '', assetTag: '', purchaseDate: '', startDate: '', notes: '', photo: null, portMeta: {} }, where);
  }

  RB.addDevice = function (tplId, rackId, pos) {
    const tpl = RB.get.template(tplId);
    const rack = RB.get.rack(rackId);
    if (!tpl || !rack) return false;
    const units = RB.unitsOfTpl(tpl);
    if (!units) { RB.toast('Outlets and endpoints are placed in rooms, not racks.', 'error'); return false; }
    if (!RB.fits(rackId, pos, units)) { RB.toast('Not enough free space there.', 'error'); return false; }
    const d = newDevice(tpl, { rackId, position: pos });
    RB.store.commit('Added ' + d.name + ' (' + tpl.name + ') to ' + rack.name + ' at U' + RB.uLabel(rack, pos), (s) => { s.devices.push(d); });
    RB.ui.placing = null;
    RB.select('device', d.id);
    return true;
  };

  RB.addEndpoint = function (tplId, roomId, pos) {
    const tpl = RB.get.template(tplId);
    const room = RB.get.room(roomId);
    if (!tpl || !room) return;
    if (RB.unitsOfTpl(tpl) > 0) { RB.toast('Rack devices go in a rack. Open a rack to place it.', 'error'); return; }
    const d = newDevice(tpl, { roomId, pos: pos || { x: RB.clamp(45 + Math.random() * 10, 2, 98), y: RB.clamp(45 + Math.random() * 10, 2, 98) } });
    RB.store.commit('Added ' + d.name + ' (' + tpl.name + ') to ' + room.name, (s) => { s.devices.push(d); });
    RB.select('device', d.id);
  };

  function moveDevice(devId, pos, rackId) {
    const d = RB.get.device(devId);
    const target = rackId || d.rackId;
    const units = RB.unitsOf(d);
    if (!RB.fits(target, pos, units, devId)) { RB.toast('That space is taken.', 'error'); return false; }
    const rack = RB.get.rack(target);
    return RB.store.commit('Moved ' + d.name + ' to ' + rack.name + ' U' + RB.uLabel(rack, pos), (s) => {
      const x = s.devices.find((y) => y.id === devId); x.position = pos; x.rackId = target; x.roomId = null;
    });
  }

  function removeDevice(id) {
    const d = RB.get.device(id); if (!d) return;
    RB.store.commit('Removed ' + d.name, (s) => {
      s.devices = s.devices.filter((x) => x.id !== id);
      s.connections = s.connections.filter((c) => c.a.d !== id && c.b.d !== id);
    });
    RB.ui.sel = null;
    RB.toast('Removed ' + d.name + ' — press Ctrl+Z to undo');
    RB.render();
  }

  function deleteThing(type, id) {
    const s0 = S();
    const label = { site: 'location', floor: 'floor', room: 'room', rack: 'rack', device: 'device' }[type];
    const item = { site: RB.get.site, floor: RB.get.floor, room: RB.get.room, rack: RB.get.rack, device: RB.get.device }[type](id);
    if (!item) return;
    if (type === 'device') { removeDevice(id); return; }
    // Work out everything that goes with it.
    let floors = [], rooms = [], racks = [];
    if (type === 'site') floors = s0.floors.filter((f) => f.siteId === id).map((f) => f.id);
    if (type === 'floor') floors = [id];
    if (type === 'room') rooms = [id];
    rooms = rooms.concat(s0.rooms.filter((r) => floors.includes(r.floorId) || (type === 'site' && !r.floorId && r.siteId === id)).map((r) => r.id));
    racks = type === 'rack' ? [id] : s0.racks.filter((r) => rooms.includes(r.roomId)).map((r) => r.id);
    const devs = s0.devices.filter((d) => racks.includes(d.rackId) || rooms.includes(d.roomId)).map((d) => d.id);
    const what = [racks.length && type !== 'rack' ? racks.length + ' rack(s)' : '', devs.length ? devs.length + ' device(s)' : ''].filter(Boolean).join(' and ');
    RB.modal.confirm('Delete the ' + label + ' "' + item.name + '"' + (what ? ' together with ' + what + ' and their cables' : '') + '? You can undo this with Ctrl+Z.').then((ok) => {
      if (!ok) return;
      RB.store.commit('Deleted ' + label + ' ' + item.name, (s) => {
        if (type === 'site') s.sites = s.sites.filter((x) => x.id !== id);
        s.floors = s.floors.filter((x) => !floors.includes(x.id));
        s.rooms = s.rooms.filter((x) => !rooms.includes(x.id));
        s.racks = s.racks.filter((x) => !racks.includes(x.id));
        s.devices = s.devices.filter((x) => !devs.includes(x.id));
        s.connections = s.connections.filter((c) => !devs.includes(c.a.d) && !devs.includes(c.b.d));
      });
      if (RB.ui.nav.id === id || (RB.ui.nav.type !== 'home' && !RB.get[RB.ui.nav.type](RB.ui.nav.id))) RB.goHome();
      else RB.render();
    });
  }

  function nextRackName() {
    let max = 0;
    S().racks.forEach((r) => { const m = /^RK(\d+)$/.exec(r.name); if (m) max = Math.max(max, +m[1]); });
    return 'RK' + String(max + 1).padStart(2, '0');
  }

  async function addChild(type, id) {
    if (type === 'root') {
      const v = await RB.modal.form({
        title: 'Add a site', intro: 'A site holds its comms rooms, and each comms room holds its racks. Floors or buildings are optional.',
        fields: [{ name: 'name', label: 'Site name', required: true, placeholder: 'e.g. Head office' }, { name: 'code', label: 'Site code', half: true, placeholder: 'e.g. HQ' }, { name: 'contact', label: 'On-site contact', half: true }, { name: 'address', label: 'Address' },
          { name: 'room', label: 'First comms room', value: 'Main comms room', half: true }, { name: 'floor', label: 'Floor or building (optional)', half: true }],
        submitLabel: 'Add site',
      });
      if (!v) return;
      const site = { id: RB.uid('site'), name: v.name, code: v.code || '', address: v.address, contact: v.contact, notes: '' };
      const floor = v.floor ? { id: RB.uid('floor'), siteId: site.id, name: v.floor } : null;
      const room = v.room ? { id: RB.uid('room'), siteId: site.id, floorId: floor ? floor.id : null, name: v.room, notes: '', plan: null } : null;
      RB.store.commit('Added site ' + site.name, (s) => { s.sites.push(site); if (floor) s.floors.push(floor); if (room) s.rooms.push(room); });
      if (room) RB.navigate('room', room.id); else RB.navigate('site', site.id);
      return;
    }
    if (type === 'site-floor') {
      const v = await RB.modal.form({ title: 'Add a floor or building', intro: 'Only needed when a site has several buildings or levels; comms rooms can also sit straight under the site.', fields: [{ name: 'name', label: 'Floor or building name', required: true, placeholder: 'e.g. Building B' }], submitLabel: 'Add' });
      if (!v) return;
      const f = { id: RB.uid('floor'), siteId: id, name: v.name };
      RB.store.commit('Added floor ' + f.name, (s) => { s.floors.push(f); });
      RB.navigate('floor', f.id);
      return;
    }
    if (type === 'site' || type === 'floor') {
      const floor = type === 'floor' ? RB.get.floor(id) : null;
      const siteId = floor ? floor.siteId : id;
      const v = await RB.modal.form({ title: 'Add a comms room', fields: [{ name: 'name', label: 'Comms room name', required: true, placeholder: 'e.g. Main comms room' }], submitLabel: 'Add comms room' });
      if (!v) return;
      const r = { id: RB.uid('room'), siteId, floorId: floor ? floor.id : null, name: v.name, notes: '', plan: null };
      RB.store.commit('Added comms room ' + r.name, (s) => { s.rooms.push(r); });
      RB.navigate('room', r.id);
      return;
    }
    if (type === 'room') {
      const v = await RB.modal.form({
        title: 'Add a rack',
        fields: [{ name: 'name', label: 'Rack name', value: nextRackName(), required: true },
          { name: 'units', label: 'Height in rack units (U)', type: 'number', value: 42, min: 1, max: 60, required: true, half: true, hint: 'Common sizes: 9, 12, 24, 42, 47' },
          { name: 'numbering', label: 'Unit numbering', type: 'select', value: 'bottom', half: true, options: [{ value: 'bottom', label: '1 at the bottom' }, { value: 'top', label: '1 at the top' }] }],
        submitLabel: 'Add rack',
      });
      if (!v) return;
      const r = { id: RB.uid('rack'), roomId: id, name: v.name, units: RB.clamp(Math.round(v.units), 1, 60), numbering: v.numbering, notes: '', pos: { x: 50, y: 50 } };
      RB.store.commit('Added rack ' + r.name + ' (' + r.units + 'U)', (s) => { s.racks.push(r); });
      RB.navigate('rack', r.id);
    }
  }

  async function rename(type, id) {
    const item = RB.get[type](id);
    const v = await RB.modal.form({ title: 'Rename', fields: [{ name: 'name', label: 'Name', value: item.name, required: true }] });
    if (!v || v.name === item.name) return;
    RB.store.commit('Renamed ' + item.name + ' to ' + v.name, (s) => { const coll = { site: s.sites, floor: s.floors, room: s.rooms, rack: s.racks }[type]; coll.find((x) => x.id === id).name = v.name; });
  }

  function duplicateDevice(id) {
    const d = RB.get.device(id);
    const copy = JSON.parse(JSON.stringify(d));
    copy.id = RB.uid('dev');
    copy.name = RB.autoName(RB.get.template(d.templateId));
    copy.serial = ''; copy.assetTag = ''; copy.ip = ''; copy.photo = null;
    if (d.rackId) {
      const units = RB.unitsOf(d);
      let pos = null;
      for (let u = d.position - units; u >= 1; u--) if (RB.fits(d.rackId, u, units)) { pos = u; break; }
      if (pos == null) pos = RB.findSpace(d.rackId, units);
      if (pos == null) { RB.toast('No free space left in this rack.', 'error'); return; }
      copy.position = pos;
    } else if (copy.pos) copy.pos = { x: RB.clamp(copy.pos.x + 4, 2, 98), y: RB.clamp(copy.pos.y + 4, 2, 98) };
    RB.store.commit('Duplicated ' + d.name + ' as ' + copy.name, (s) => { s.devices.push(copy); });
    RB.select('device', copy.id);
  }

  function duplicateRack(id) {
    const r = RB.get.rack(id);
    const nr = JSON.parse(JSON.stringify(r));
    nr.id = RB.uid('rack'); nr.name = nextRackName();
    const map = {};
    const devs = RB.get.devicesInRack(id).map((d) => { const c = JSON.parse(JSON.stringify(d)); map[d.id] = c.id = RB.uid('dev'); c.rackId = nr.id; c.name = d.name + ' (' + nr.name + ')'; c.serial = ''; c.ip = ''; c.photo = null; return c; });
    const cons = S().connections.filter((c) => map[c.a.d] && map[c.b.d]).map((c) => Object.assign(JSON.parse(JSON.stringify(c)), { id: RB.uid('con'), a: { d: map[c.a.d], p: c.a.p }, b: { d: map[c.b.d], p: c.b.p } }));
    RB.store.commit('Duplicated rack ' + r.name + ' as ' + nr.name, (s) => { s.racks.push(nr); s.devices.push.apply(s.devices, devs); s.connections.push.apply(s.connections, cons); });
    RB.navigate('rack', nr.id);
  }

  async function moveToRack(id) {
    const d = RB.get.device(id);
    const units = RB.unitsOf(d);
    const options = S().racks.filter((r) => r.id !== d.rackId && RB.findSpace(r.id, units) != null).map((r) => ({ value: r.id, label: r.name + ' — ' + RB.get.pathOfRoom(RB.get.room(r.roomId)) + ' (' + RB.occupancy(r.id).free + 'U free)' }));
    if (!options.length) { RB.toast('No other rack has ' + units + 'U free.', 'error'); return; }
    const v = await RB.modal.form({ title: 'Move ' + d.name, fields: [{ name: 'rack', label: 'To rack', type: 'select', options, value: options[0].value }], submitLabel: 'Move', intro: 'It goes to the highest free space; cables stay connected.' });
    if (!v) return;
    const pos = RB.findSpace(v.rack, units);
    if (moveDevice(id, pos, v.rack)) RB.navigate('rack', v.rack, { keepSel: true });
  }

  /* ======================= context menu ======================= */
  let menuAnchor = null;
  function showMenu(anchor, items) {
    closeMenu();
    menuAnchor = anchor;
    const m = RB.html('<div class="ctx-menu" role="menu">' + items.map((it, i) => '<button type="button" role="menuitem" class="' + (it.danger ? 'danger' : '') + '" data-i="' + i + '">' + RB.icon(it.icon, 14) + '<span>' + RB.esc(it.label) + '</span></button>').join('') + '</div>');
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    m.style.top = Math.min(window.innerHeight - m.offsetHeight - 8, r.bottom + 4) + 'px';
    m.style.left = RB.clamp(r.right - m.offsetWidth, 8, window.innerWidth - m.offsetWidth - 8) + 'px';
    m.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (!b) return; closeMenu(); items[+b.dataset.i].run(); });
    m.querySelector('button').focus();
  }
  function closeMenu() { const m = $('.ctx-menu'); if (m) { m.remove(); return true; } return false; }

  /* ======================= appearance: system, light or dark ======================= */
  const THEMES = [['system', 'System', 'monitor'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']];
  const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  RB.themePref = function () {
    let p = 'system';
    try { p = localStorage.getItem('rackbook.theme') || 'system'; } catch (e) { /* storage blocked */ }
    return THEMES.some((t) => t[0] === p) ? p : 'system';
  };
  RB.applyTheme = function (pref) {
    const dark = pref === 'dark' || (pref === 'system' && !!(darkQuery && darkQuery.matches));
    const root = document.documentElement;
    root.dataset.themePref = pref;
    root.dataset.theme = dark ? 'dark' : 'light';
    const t = THEMES.find((x) => x[0] === pref) || THEMES[0];
    const b = $('#themeBtn');
    if (b) {
      b.innerHTML = RB.icon(t[2], 18);
      b.setAttribute('aria-label', 'Appearance: ' + t[1]);
      b.title = 'Appearance: ' + t[1] + (pref === 'system' ? ' (now ' + (dark ? 'dark' : 'light') + ')' : '');
    }
  };
  RB.setTheme = function (pref) {
    try { localStorage.setItem('rackbook.theme', pref); } catch (e) { /* storage blocked */ }
    RB.applyTheme(pref);
  };
  RB.cycleTheme = function (anchor) {
    const cur = RB.themePref();
    showMenu(anchor || $('#themeBtn'), THEMES.map((t) => ({
      label: t[1] + (t[0] === 'system' ? ' (match this device)' : '') + (t[0] === cur ? ' ✓' : ''),
      icon: t[2], run: () => RB.setTheme(t[0]),
    })));
  };
  if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', () => { if (RB.themePref() === 'system') RB.applyTheme('system'); });

  function menuFor(type, id, anchor) {
    const items = [{ label: 'Rename', icon: 'edit', run: () => rename(type, id) }];
    if (type === 'site') { items.push({ label: 'Add comms room', icon: 'plus', run: () => addChild('site', id) }); items.push({ label: 'Add floor or building', icon: 'floor', run: () => addChild('site-floor', id) }); }
    if (type === 'floor') items.push({ label: 'Add comms room', icon: 'plus', run: () => addChild('floor', id) });
    if (type === 'room') { items.push({ label: 'Add rack', icon: 'plus', run: () => addChild('room', id) }); items.push({ label: 'Add outlet / endpoint', icon: 'pin', run: () => pickEndpoint(id) }); }
    if (type === 'rack') items.push({ label: 'Duplicate rack', icon: 'copy', run: () => duplicateRack(id) });
    items.push({ label: 'Details', icon: 'note', run: () => { RB.navigate(type, id); } });
    items.push({ label: 'Delete', icon: 'trash', danger: true, run: () => deleteThing(type, id) });
    showMenu(anchor, items);
  }

  async function pickEndpoint(roomId) {
    const tpl = await RB.pickTemplate({ endpoints: true, title: 'Add an outlet or endpoint' });
    if (!tpl) return;
    if (RB.ui.nav.type !== 'room' || RB.ui.nav.id !== roomId) RB.navigate('room', roomId);
    RB.addEndpoint(tpl.id, roomId);
  }

  /* ======================= drawers (tablet & phone) ======================= */
  RB.openDrawer = function (which) {
    const app = $('#app');
    app.classList.remove('nav-open', 'lib-open', 'insp-open');
    app.classList.add(which + '-open');
    syncNavToggle();
  };
  RB.closeDrawers = function () { $('#app').classList.remove('nav-open', 'lib-open', 'insp-open'); syncNavToggle(); };
  function syncNavToggle() {
    const open = $('#app').classList.contains('nav-open');
    const b = $('.topbar .nav-toggle');
    if (b) b.setAttribute('aria-expanded', String(open));
  }

  /* ======================= files ======================= */
  let fileTarget = null;
  function pickImage(target) { fileTarget = target; $('#fileImg').click(); }
  async function onImage(file) {
    const t = fileTarget; fileTarget = null;
    if (!t || !file) return;
    try {
      if (t.kind === 'photo') {
        const url = await RB.readImage(file, 640, 0.78);
        RB.store.commit('Added a photo to ' + RB.get.device(t.id).name, (s) => { s.devices.find((d) => d.id === t.id).photo = url; });
      } else if (t.kind === 'plan') {
        const url = await RB.readImage(file, 1800, 0.8);
        RB.store.commit('Added a floor plan to ' + RB.get.room(t.id).name, (s) => { s.rooms.find((r) => r.id === t.id).plan = url; });
      }
    } catch (err) { RB.toast(err.message, 'error'); }
  }

  /* ======================= rack interaction ======================= */
  function rackGeom(rackEl) {
    const body = rackEl.querySelector('.rack-body');
    const rect = body.getBoundingClientRect();
    const rack = RB.get.rack(rackEl.dataset.rack);
    const H = rect.height / rack.units;
    return { body, rect, rack, H };
  }
  function uAt(geom, clientY) {
    const y = clientY - geom.rect.top;
    return geom.rack.units - Math.floor(y / geom.H);
  }
  function showGhost(geom, pos, units, ok) {
    const g = geom.body.querySelector('.drop-ghost');
    if (!g) return;
    if (pos == null) { g.hidden = true; return; }
    const H = geom.body.offsetHeight / geom.rack.units;
    g.hidden = false;
    g.style.top = (geom.rack.units - (pos + units - 1)) * H + 'px';
    g.style.height = units * H + 'px';
    g.classList.toggle('is-bad', !ok);
    g.textContent = ok ? 'U' + RB.uLabel(geom.rack, pos) + (units > 1 ? '–' + RB.uLabel(geom.rack, pos + units - 1) : '') : 'No room here';
  }

  /** Free run of units around u: [lo, hi]. */
  function freeRun(rackId, u) {
    const rack = RB.get.rack(rackId);
    let lo = u, hi = u;
    while (lo - 1 >= 1 && RB.fits(rackId, lo - 1, 1)) lo--;
    while (hi + 1 <= rack.units && RB.fits(rackId, hi + 1, 1)) hi++;
    return [lo, hi];
  }

  async function slotAdd(u) {
    const rackId = RB.ui.rackId;
    const [lo, hi] = freeRun(rackId, u);
    let tpl = RB.ui.placing ? RB.get.template(RB.ui.placing) : null;
    if (!tpl) tpl = await RB.pickTemplate({ maxUnits: hi - lo + 1, title: 'Add a device at U' + RB.uLabel(RB.get.rack(rackId), u) });
    if (!tpl) return;
    const units = RB.unitsOfTpl(tpl);
    if (units > hi - lo + 1) { RB.toast(tpl.name + ' needs ' + units + 'U; only ' + (hi - lo + 1) + 'U are free here.', 'error'); return; }
    // Keep the clicked unit as the top of the device where possible.
    const pos = RB.clamp(u - units + 1, lo, hi - units + 1);
    RB.addDevice(tpl.id, rackId, pos);
  }

  // Moving a device with the pointer (mouse, pen or touch).
  let drag = null;
  function onDevPointerDown(e) {
    const dev = e.target.closest('.dev');
    // On touch screens a swipe scrolls the page; devices move with the ↑ ↓ buttons instead.
    if (!dev || e.target.closest('.port') || e.button > 0 || e.pointerType === 'touch') return;
    const rackEl = dev.closest('.rack');
    const d = RB.get.device(dev.dataset.dev);
    const geom = rackGeom(rackEl);
    const topU = d.position + RB.unitsOf(d) - 1;
    drag = { id: d.id, el: dev, geom, x: e.clientX, y: e.clientY, grab: topU - uAt(geom, e.clientY), units: RB.unitsOf(d), moved: false, pos: d.position, pointerId: e.pointerId, touch: e.pointerType === 'touch' };
  }
  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dist = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
    if (!drag.moved) {
      if (dist < (drag.touch ? 10 : 5)) return;
      if (drag.touch && Math.abs(e.clientX - drag.x) > Math.abs(e.clientY - drag.y)) { drag = null; return; }
      drag.moved = true;
      drag.el.classList.add('is-dragging');
      try { drag.el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }
    e.preventDefault();
    drag.geom.rect = drag.geom.body.getBoundingClientRect();
    const top = uAt(drag.geom, e.clientY) + drag.grab;
    const pos = top - drag.units + 1;
    drag.pos = pos;
    const H = drag.geom.body.offsetHeight / drag.geom.rack.units;
    drag.el.style.transform = 'translateY(' + (e.clientY - drag.y) + 'px)';
    void H;
    showGhost(drag.geom, pos, drag.units, RB.fits(drag.geom.rack.id, pos, drag.units, drag.id));
  }
  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dg = drag; drag = null;
    if (!dg.moved) return; // a click: handled by the click listener
    dg.el.classList.remove('is-dragging');
    dg.el.style.transform = '';
    showGhost(dg.geom, null);
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    const d = RB.get.device(dg.id);
    if (dg.pos !== d.position && RB.fits(dg.geom.rack.id, dg.pos, dg.units, dg.id)) { moveDevice(dg.id, dg.pos); RB.ui.sel = { type: 'device', id: dg.id }; RB.render(); }
    else { if (dg.pos !== d.position) RB.toast('That space is taken.', 'error'); RB.render(); }
  }
  let suppressClick = false;

  // Room plan markers.
  let mdrag = null;
  function onMarkerDown(e) {
    const mk = e.target.closest('.marker');
    if (!mk || e.button > 0) return;
    mdrag = { el: mk, x: e.clientX, y: e.clientY, moved: false, pointerId: e.pointerId, plan: mk.closest('.plan') };
  }
  function onMarkerMove(e) {
    if (!mdrag || e.pointerId !== mdrag.pointerId) return;
    if (!mdrag.moved && Math.hypot(e.clientX - mdrag.x, e.clientY - mdrag.y) < 5) return;
    if (!mdrag.moved) { mdrag.moved = true; try { mdrag.el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } mdrag.el.classList.add('is-dragging'); }
    e.preventDefault();
    const r = mdrag.plan.getBoundingClientRect();
    mdrag.px = RB.clamp(((e.clientX - r.left) / r.width) * 100, 1, 99);
    mdrag.py = RB.clamp(((e.clientY - r.top) / r.height) * 100, 1, 99);
    mdrag.el.style.left = mdrag.px + '%';
    mdrag.el.style.top = mdrag.py + '%';
  }
  function onMarkerUp(e) {
    if (!mdrag || e.pointerId !== mdrag.pointerId) return;
    const m = mdrag; mdrag = null;
    const kind = m.el.dataset.marker, id = m.el.dataset.id;
    if (!m.moved) {
      if (kind === 'rack') RB.navigate('rack', id); else RB.select('device', id);
      return;
    }
    const pos = { x: Math.round(m.px * 10) / 10, y: Math.round(m.py * 10) / 10 };
    RB.store.commit('Moved ' + (kind === 'rack' ? RB.get.rack(id).name : RB.get.device(id).name) + ' on the floor plan', (s) => {
      (kind === 'rack' ? s.racks : s.devices).find((x) => x.id === id).pos = pos;
    });
  }

  /* ======================= click handling ======================= */
  function onClick(e) {
    const t = e.target;
    if (suppressClick) { suppressClick = false; return; }
    if (!t.closest('.ctx-menu') && closeMenu() && !t.closest('[data-menu]')) return;
    // A tap anywhere outside an open drawer closes it (the toggle button handles itself).
    if ($('#app').matches('.nav-open, .lib-open, .insp-open') &&
        !t.closest('#sidebar, #library, #inspector, .nav-toggle, [data-act="library"], .ctx-menu, .modal, .modal-wrap, #popover')) RB.closeDrawers();

    const act = t.closest('[data-act]');
    if (act) { action(act.dataset.act, act); return; }

    const vtab = t.closest('[data-tab]');
    if (vtab) { RB.openViewTab(vtab.dataset.tab); return; }
    const hit = t.closest('[data-hit]');
    if (hit) { RB.openHit(hit.dataset.hit, hit.dataset.id, hit.dataset.p); return; }

    const tog = t.closest('[data-tog]');
    if (tog) { const id = tog.dataset.tog; RB.ui.expanded[id] = !RB.ui.expanded[id]; RB.render(); return; }

    const add = t.closest('[data-add]');
    if (add) { addChild(add.dataset.add, add.dataset.id); return; }

    const menu = t.closest('[data-menu]');
    if (menu) { menuFor(menu.dataset.menu, menu.dataset.id, menu); return; }

    const addEp = t.closest('[data-add-endpoint]');
    if (addEp) { pickEndpoint(addEp.dataset.addEndpoint); return; }

    const editTpl = t.closest('[data-edit-tpl]');
    if (editTpl) { e.stopPropagation(); RB.openBuilder(editTpl.dataset.editTpl); return; }

    const lib = t.closest('.lib-item');
    if (lib) { libraryPick(lib.dataset.tpl); return; }

    const nav = t.closest('[data-nav]');
    if (nav && !t.closest('.tree-acts')) {
      if (nav.dataset.nav === 'home') RB.goHome(); else RB.navigate(nav.dataset.nav, nav.dataset.id);
      return;
    }

    const face = t.closest('[data-face]');
    if (face) { RB.ui.face = face.dataset.face; RB.closePopover(); RB.render(); return; }

    const zoom = t.closest('[data-zoom]');
    if (zoom) {
      const cur = RB.effectiveZoom();
      if (zoom.dataset.zoom === 'fit') { RB.ui.zoomMode = 'fit'; }
      else { RB.ui.zoomMode = 'manual'; RB.ui.zoom = RB.clamp(Math.round((cur + (+zoom.dataset.zoom) * 0.15) * 100) / 100, 0.45, 2.2); }
      RB.render(); return;
    }

    const btab = t.closest('[data-btab]');
    if (btab) { RB.ui.bottomTab = btab.dataset.btab; RB.ui.bottomOpen = true; RB.render(); return; }

    const port = t.closest('.port[data-d]');
    if (port && port.dataset.d) { portClick(port.dataset.d, port.dataset.p, port); return; }

    const slot = t.closest('.slot-add');
    if (slot) { slotAdd(+slot.dataset.u); return; }

    const dev = t.closest('.dev');
    if (dev) { RB.closePopover(); RB.select('device', dev.dataset.dev); return; }

    const row = t.closest('[data-sel-dev]');
    if (row) { RB.select('device', row.dataset.selDev); return; }

    const tr = t.closest('[data-trace-d]');
    if (tr) { RB.startTrace(tr.dataset.traceD, tr.dataset.traceP); return; }
    const ec = t.closest('[data-edit-con]');
    if (ec) { RB.editConnection(ec.dataset.editCon); return; }
    const dc = t.closest('[data-del-con]');
    if (dc) { RB.disconnect(dc.dataset.delCon); return; }

    // Inspector
    const del = t.closest('[data-del]');
    if (del) { deleteThing(del.dataset.del, del.dataset.id); return; }
    const dupD = t.closest('[data-dup-dev]');
    if (dupD) { duplicateDevice(dupD.dataset.dupDev); return; }
    const dupR = t.closest('[data-dup-rack]');
    if (dupR) { duplicateRack(dupR.dataset.dupRack); return; }
    const mv = t.closest('[data-move-dev]');
    if (mv) { nudge(+mv.dataset.moveDev); return; }
    const mr = t.closest('[data-move-rack]');
    if (mr) { moveToRack(mr.dataset.moveRack); return; }
    const ph = t.closest('[data-photo]');
    if (ph) { pickImage({ kind: 'photo', id: ph.dataset.photo }); return; }
    const phd = t.closest('[data-photo-del]');
    if (phd) { RB.store.commit('Removed the photo of ' + RB.get.device(phd.dataset.photoDel).name, (s) => { s.devices.find((d) => d.id === phd.dataset.photoDel).photo = null; }); return; }
    const ne = t.closest('[data-notes-edit]');
    if (ne) { RB.ui.editNotes = ne.dataset.notesEdit; RB.render(); const ta = $('.notes-edit'); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } return; }
    if (t.closest('[data-notes-cancel]')) { RB.ui.editNotes = null; RB.render(); return; }
    const ns = t.closest('[data-notes-save]');
    if (ns) { saveNotes(ns.dataset.notesSave, ns.dataset.id); return; }
    const pr = t.closest('[data-port-row]');
    if (pr) { const sel = RB.ui.sel; if (sel && sel.type === 'device') RB.openPortPopover(sel.id, pr.dataset.portRow, pr); return; }

    // Port pop-up
    const pp = t.closest('[data-pp]');
    if (pp) { popoverAction(pp.dataset.pp, pp); return; }
    const gd = t.closest('[data-goto-dev]');
    if (gd) {
      const d = RB.get.device(gd.dataset.gotoDev);
      RB.closePopover();
      if (d.rackId) { const port = RB.portOf(d, gd.dataset.gotoP); if (port) RB.ui.face = port.side; RB.navigate('rack', d.rackId); }
      else RB.navigate('room', d.roomId);
      RB.ui.sel = { type: 'device', id: d.id };
      RB.startTrace(d.id, gd.dataset.gotoP);
      return;
    }
  }

  function saveNotes(kind, id) {
    const ta = $('.notes-edit');
    const text = ta ? ta.value.trim() : '';
    RB.ui.editNotes = null;
    const coll = { site: 'sites', room: 'rooms', rack: 'racks', device: 'devices' }[kind];
    const item = S()[coll].find((x) => x.id === id);
    if (!item || (item.notes || '') === text) { RB.render(); return; }
    RB.store.commit('Updated notes on ' + item.name, (s) => { s[coll].find((x) => x.id === id).notes = text; });
  }

  function nudge(dir) {
    const sel = RB.ui.sel;
    if (!sel || sel.type !== 'device') return;
    const d = RB.get.device(sel.id);
    if (!d || !d.rackId) return;
    const units = RB.unitsOf(d);
    let pos = d.position + dir;
    // Hop over neighbours to the next free gap.
    while (pos >= 1 && pos + units - 1 <= RB.get.rack(d.rackId).units && !RB.fits(d.rackId, pos, units, d.id)) pos += dir;
    if (pos < 1 || pos + units - 1 > RB.get.rack(d.rackId).units) { RB.toast('No free space in that direction.'); return; }
    moveDevice(d.id, pos);
  }

  function libraryPick(tplId) {
    const tpl = RB.get.template(tplId);
    const v = RB.ui.view;
    if (v === 'rack') {
      if (!RB.unitsOfTpl(tpl)) { RB.toast('Outlets and endpoints are placed in rooms. Open the room to add it.'); return; }
      RB.ui.placing = RB.ui.placing === tplId ? null : tplId;
      RB.ui.patchMode = false; RB.ui.patchFrom = null;
      RB.closeDrawers();
      RB.render();
      if (RB.ui.placing) {
        const u = RB.findSpace(RB.ui.rackId, RB.unitsOfTpl(tpl));
        if (u == null) RB.toast('This rack has no ' + RB.unitsOfTpl(tpl) + 'U gap left.', 'error');
      }
    } else if (v === 'room') {
      if (RB.unitsOfTpl(tpl)) { RB.toast('Open a rack to place rack devices.'); return; }
      RB.closeDrawers();
      RB.addEndpoint(tplId, RB.ui.roomId);
    } else {
      RB.openBuilder(tplId);
    }
  }

  function portClick(devId, key, el) {
    const ui = RB.ui;
    if (ui.patchMode) {
      if (!ui.patchFrom) {
        if (RB.connOf(devId, key)) { RB.toast('That port already has a cable. Pick a free one.', 'error'); return; }
        ui.patchFrom = { d: devId, p: key };
        RB.render();
        return;
      }
      if (ui.patchFrom.d === devId && ui.patchFrom.p === key) { ui.patchFrom = null; RB.render(); return; }
      const from = ui.patchFrom;
      if (RB.connect(from, { d: devId, p: key }, { cable: 'Cat6', color: RB.suggestColor() })) { ui.patchFrom = null; RB.render(); }
      return;
    }
    RB.openPortPopover(devId, key, el);
  }

  function popoverAction(a, btn) {
    const pop = $('#popover');
    const d = pop.dataset.d, p = pop.dataset.p;
    if (a === 'close') { RB.closePopover(); return; }
    if (a === 'connect') { RB.closePopover(); RB.openConnect(d, p); return; }
    if (a === 'patch-here') { RB.closePopover(); RB.ui.patchMode = true; RB.ui.patchFrom = { d, p }; RB.ui.placing = null; RB.render(); return; }
    if (a === 'trace') { RB.closePopover(); RB.startTrace(d, p); return; }
    if (a === 'edit-con') { RB.closePopover(); RB.editConnection(btn.dataset.id); return; }
    if (a === 'disconnect') { RB.closePopover(); RB.disconnect(btn.dataset.id); }
  }

  RB.setPortMeta = setPortMeta;
  function setPortMeta(devId, key, field, value) {
    const d = RB.get.device(devId);
    if (!d) return;
    const k = /r$/.test(key) && RB.twinKey(d, key) ? key.slice(0, -1) : key;
    const cur = (d.portMeta[k] || {})[field] || '';
    if (cur === value) return;
    const what = { vlan: 'Set VLAN on ', label: 'Labelled ', status: 'Set status of ', lead: 'Set cable colour of ', tagged: 'Set tagged VLANs on ', patch: 'Set patch point of ', type: 'Set device type on ', notes: 'Noted ' }[field] || 'Changed ';
    RB.store.commit(what + d.name + ' / ' + RB.portLabel(d, key), (s) => {
      const x = s.devices.find((y) => y.id === devId);
      const m = x.portMeta[k] = Object.assign({}, x.portMeta[k]);
      if (value) m[field] = value; else delete m[field];
      if (!Object.keys(m).length) delete x.portMeta[k];
    });
  }

  function action(a, el) {
    const ui = RB.ui;
    switch (a) {
      case 'undo': RB.store.undo(); break;
      case 'redo': RB.store.redo(); break;
      case 'vlans': RB.closeDrawers(); RB.openVlans(); break;
      case 'site-vlans': RB.closeDrawers(); RB.openVlans({ siteId: el.dataset.id }); break;
      case 'site-wifi': RB.closeDrawers(); RB.openVlans({ siteId: el.dataset.id, tab: 'wlan' }); break;
      case 'sites-map': RB.openViewTab('atlas', el.dataset.id); break;
      case 'geocode': RB.geocodeSite(el.dataset.id, el); break;
      case 'connectors': RB.closeDrawers(); RB.openConnectors(); break;
      case 'srv-signin': RB.auth.signInAgain().catch((er) => RB.toast(er.message, 'error')); break;
      case 'import-sheet': RB.closeDrawers(); RB.openSheetImport(); break;
      case 'theme': RB.closeDrawers(); RB.cycleTheme(el); break;
      case 'history': RB.closeDrawers(); RB.openHistory(); break;
      case 'data': RB.closeDrawers(); RB.openData(); break;
      case 'help': RB.closeDrawers(); RB.openHelp(); break;
      case 'account': RB.closeDrawers(); RB.openAccount(); break;
      case 'users': RB.closeDrawers(); RB.openUsers(); break;
      case 'tenants': RB.closeDrawers(); if (RB.openTenants) RB.openTenants(); break;
      case 'print': RB.openPrint(); break;
      case 'rack-xlsx': if (ui.rackId) RB.exportWorkbook(ui.rackId); break;
      case 'new-tpl': RB.openBuilder(null); break;
      case 'rack-standards': RB.closeDrawers(); RB.openRackStandards(); break;
      case 'sort-sites': showMenu(el, RB.SITE_SORTS.map((m) => ({ label: m[1] + ((ui.siteSort || 'az') === m[0] ? ' ✓' : ''), icon: 'up', run: () => { ui.siteSort = m[0]; RB.saveUi(ui); RB.render(); } }))); break;
      case 'toggle-nav': $('#app').classList.contains('nav-open') ? RB.closeDrawers() : RB.openDrawer('nav'); break;
      case 'library': $('#app').classList.contains('lib-open') ? RB.closeDrawers() : RB.openDrawer('lib'); break;
      case 'close-insp': RB.closeDrawers(); break;
      case 'scrim': RB.closeDrawers(); break;
      case 'cables': ui.showCables = !ui.showCables; RB.render(); break;
      case 'colorby': showMenu(el, [['cable', 'Cable colour (as drawn)', 'cable'], ['vlan', 'VLAN colour', 'vlan'], ['lead', 'Cable colour standard', 'link']].map((c) => ({
        label: c[1] + ((ui.colorBy || 'cable') === c[0] ? ' ✓' : ''), icon: c[2], run: () => { ui.colorBy = c[0]; RB.render(); },
      }))); break;
      case 'patch': ui.patchMode = !ui.patchMode; ui.patchFrom = null; ui.placing = null; RB.closePopover(); RB.render(); break;
      case 'cancel-place': ui.placing = null; RB.render(); break;
      case 'clear-trace': RB.clearTrace(); break;
      case 'bottom': ui.bottomOpen = !ui.bottomOpen; RB.render(); break;
      case 'csv-rack': {
        const rack = RB.get.rack(ui.rackId);
        const ids = new Set(RB.get.devicesInRack(rack.id).map((d) => d.id));
        if (ui.bottomTab === 'conns') RB.download(RB.slug(rack.name) + '-cables.csv', RB.csv(RB.connectionRows((c) => ids.has(c.a.d) || ids.has(c.b.d))), 'text/csv');
        else RB.download(RB.slug(rack.name) + '-devices.csv', RB.csv(RB.deviceRows((d) => ids.has(d.id))), 'text/csv');
        break;
      }
      case 'plan-upload': {
        const roomId = ui.sel && ui.sel.type === 'room' ? ui.sel.id : ui.roomId;
        if (roomId) pickImage({ kind: 'plan', id: roomId });
        break;
      }
      case 'plan-remove': {
        const roomId = ui.sel && ui.sel.type === 'room' ? ui.sel.id : ui.roomId;
        RB.store.commit('Removed the floor plan of ' + RB.get.room(roomId).name, (s) => { s.rooms.find((r) => r.id === roomId).plan = null; });
        break;
      }
      default: void el;
    }
  }

  /* ======================= inputs ======================= */
  function onChange(e) {
    const t = e.target;
    if (t.id === 'fileImg') { onImage(t.files && t.files[0]); t.value = ''; return; }
    if (t.id === 'libCat') { RB.ui.libCat = t.value; RB.render(); return; }
    const ppf = t.closest('[data-pp-f]');
    if (ppf) {
      const pop = $('#popover');
      setPortMeta(pop.dataset.d, pop.dataset.p, ppf.dataset.ppF, ppf.value.trim());
      return;
    }
    const f = t.closest('[data-f]');
    const sec = t.closest('[data-edit-kind]');
    if (f && sec) {
      const kind = sec.dataset.editKind, id = sec.dataset.id, field = f.dataset.f;
      let value = f.value.trim();
      const coll = { site: 'sites', floor: 'floors', room: 'rooms', rack: 'racks', device: 'devices' }[kind];
      const item = S()[coll].find((x) => x.id === id);
      if (!item) return;
      if (field === 'name' && !value) { RB.toast('A name is required.', 'error'); RB.render(); return; }
      if (kind === 'rack' && field === 'units') {
        const n = parseInt(value, 10);
        const highest = RB.get.devicesInRack(id).reduce((m, d) => Math.max(m, d.position + RB.unitsOf(d) - 1), 0);
        if (!(n >= 1 && n <= 60)) { RB.toast('Racks can be 1 to 60 units high.', 'error'); RB.render(); return; }
        if (n < highest) { RB.toast('Devices sit up to U' + highest + '. Move them down before making the rack smaller.', 'error'); RB.render(); return; }
        value = n;
      }
      if (kind === 'room' && field === 'place') {
        // A comms room sits straight under its site, or under one of the site's floors or buildings.
        const site = RB.get.siteOfRoom(item);
        const floorId = value.startsWith('site:') ? null : value;
        if ((item.floorId || null) === floorId) return;
        RB.store.commit('Moved comms room ' + item.name, (s) => { const r = s.rooms.find((x) => x.id === id); r.floorId = floorId; r.siteId = floorId ? (RB.get.floor(floorId) || {}).siteId : (site && site.id); });
        return;
      }
      if (kind === 'site' && (field === 'lat' || field === 'lon')) {
        const num = value === '' ? null : parseFloat(value.replace(',', '.'));
        if (value !== '' && (!Number.isFinite(num) || Math.abs(num) > (field === 'lat' ? 90 : 180))) { RB.toast('Enter the ' + (field === 'lat' ? 'latitude (−90 to 90)' : 'longitude (−180 to 180)') + ' as a number, e.g. ' + (field === 'lat' ? '-37.81' : '144.96'), 'error'); RB.render(); return; }
        if ((item[field] == null ? null : item[field]) === num) return;
        RB.store.commit('Changed map position of ' + item.name, (s) => { s.sites.find((x) => x.id === id)[field] = num; });
        return;
      }
      if (String(item[field] == null ? '' : item[field]) === String(value)) return;
      RB.store.commit('Changed ' + field.replace(/([A-Z])/g, ' $1').toLowerCase() + ' of ' + item.name, (s) => { s[coll].find((x) => x.id === id)[field] = value; });
    }
  }

  function onInput(e) {
    const t = e.target;
    if (t.id === 'search') { RB.ui.query = t.value; RB.render(); t.focus(); return; }
    if (t.id === 'libSearch') { RB.ui.libQuery = t.value; RB.render(); t.focus(); }
  }

  /* ======================= drag & drop from the library ======================= */
  function onDragStart(e) {
    const item = e.target.closest && e.target.closest('.lib-item');
    if (!item) return;
    RB.dragTpl = item.dataset.tpl;
    e.dataTransfer.effectAllowed = 'copy';
    try { e.dataTransfer.setData('text/plain', item.dataset.tpl); } catch (err) { /* ignore */ }
    if (window.matchMedia('(max-width: 1199px)').matches) setTimeout(RB.closeDrawers, 50);
  }
  /** A spreadsheet dragged in from the desktop. */
  const isFileDrag = (e) => !RB.dragTpl && e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') >= 0;
  function onDragOver(e) {
    if (isFileDrag(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; return; }
    if (!RB.dragTpl) return;
    const tpl = RB.get.template(RB.dragTpl);
    const rackEl = e.target.closest && e.target.closest('.rack');
    if (rackEl && RB.unitsOfTpl(tpl) > 0) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      const geom = rackGeom(rackEl);
      const units = RB.unitsOfTpl(tpl);
      const pos = uAt(geom, e.clientY) - units + 1;
      showGhost(geom, pos, units, RB.fits(geom.rack.id, pos, units));
      return;
    }
    const plan = e.target.closest && e.target.closest('.plan');
    if (plan && RB.unitsOfTpl(tpl) === 0) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; plan.classList.add('is-over'); }
  }
  function onDragLeave(e) {
    const rackEl = e.target.closest && e.target.closest('.rack');
    if (rackEl && !rackEl.contains(e.relatedTarget)) showGhost(rackGeom(rackEl), null);
    const plan = e.target.closest && e.target.closest('.plan');
    if (plan && !plan.contains(e.relatedTarget)) plan.classList.remove('is-over');
  }
  function onDrop(e) {
    if (isFileDrag(e)) {
      e.preventDefault();
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f && /\.(xlsx|csv)$/i.test(f.name)) RB.importSheetFile(f);
      else if (f && /\.json$/i.test(f.name)) RB.toast('To open a backup file, use Backup & data › Open backup file.');
      else if (f) RB.toast('Drop an Excel workbook (.xlsx) or a CSV file to import it.', 'error');
      return;
    }
    const tplId = RB.dragTpl;
    RB.dragTpl = null;
    if (!tplId) return;
    const tpl = RB.get.template(tplId);
    const rackEl = e.target.closest && e.target.closest('.rack');
    if (rackEl) {
      e.preventDefault();
      const geom = rackGeom(rackEl);
      showGhost(geom, null);
      const units = RB.unitsOfTpl(tpl);
      RB.addDevice(tplId, geom.rack.id, uAt(geom, e.clientY) - units + 1);
      return;
    }
    const plan = e.target.closest && e.target.closest('.plan');
    if (plan) {
      e.preventDefault();
      plan.classList.remove('is-over');
      const r = plan.getBoundingClientRect();
      RB.addEndpoint(tplId, RB.ui.roomId, { x: RB.clamp(((e.clientX - r.left) / r.width) * 100, 1, 99), y: RB.clamp(((e.clientY - r.top) / r.height) * 100, 1, 99) });
    }
  }

  /* ======================= keyboard ======================= */
  function onKey(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
    const ui = RB.ui;
    if (e.key === 'Escape') {
      if (closeMenu()) { if (menuAnchor && menuAnchor.isConnected) menuAnchor.focus(); return; }
      if (RB.modal.closeTop()) return;
      if (RB.closePopover()) return;
      if (ui.patchMode || ui.placing) { ui.patchMode = false; ui.patchFrom = null; ui.placing = null; RB.render(); return; }
      if ($('#app').matches('.nav-open, .lib-open, .insp-open')) { RB.closeDrawers(); return; }
      if (ui.traceHops) { RB.clearTrace(); return; }
      if (ui.sel) { RB.select(null); }
      return;
    }
    if (RB.modal.top()) return;
    // Menus: arrow keys move between items, Tab leaves the menu.
    const inMenu = e.target.closest && e.target.closest('.ctx-menu');
    if (inMenu) {
      const items = [...inMenu.querySelectorAll('[role=menuitem]')];
      if (e.key === 'Tab') { closeMenu(); return; }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) && items.length) {
        e.preventDefault();
        let i = items.indexOf(document.activeElement);
        i = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[i].focus();
        return;
      }
    }
    // The view tabs: Left and Right (and Home, End) move between them; Enter or Space opens the focused one.
    const onTab = e.target.closest && e.target.closest('.vtab');
    if (onTab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      const tabs = [...document.querySelectorAll('#viewtabs .vtab')];
      let i = tabs.indexOf(onTab);
      i = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      e.preventDefault(); tabs.forEach((t) => { t.tabIndex = -1; }); tabs[i].tabIndex = 0; tabs[i].focus();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !typing && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) RB.store.redo(); else RB.store.undo(); return; }
    if (mod && !typing && e.key.toLowerCase() === 'y') { e.preventDefault(); RB.store.redo(); return; }
    if (typing || mod || e.altKey) return;
    if (e.key === 'Enter' && e.target.classList.contains('dev')) { RB.select('device', e.target.dataset.dev); return; }
    if (e.key === 'Enter' && e.target.classList.contains('lib-item')) { libraryPick(e.target.dataset.tpl); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && ui.sel && ui.sel.type === 'device') { e.preventDefault(); removeDevice(ui.sel.id); return; }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && ui.sel && ui.sel.type === 'device' && ui.view === 'rack') { e.preventDefault(); nudge(e.key === 'ArrowUp' ? 1 : -1); return; }
    if (e.key.toLowerCase() === 'p' && ui.view === 'rack') { action('patch'); return; }
    if (e.key.toLowerCase() === 'f' && ui.view === 'rack') { ui.face = ui.face === 'front' ? 'rear' : 'front'; RB.closePopover(); RB.render(); }
  }

  /* ======================= start ======================= */
  async function start() {
    // Sign-in comes first: it picks the tenant and loads its records once someone is allowed in.
    await RB.auth.boot();
    RB.ui = RB.loadUi();
    // Every visit opens on the overview (with the "needs attention" list and the view tabs);
    // the Locations tree keeps what was opened out last time.
    RB.ui.nav = { type: 'home', id: null };
    RB.ui.tab = null;
    RB.ui.sel = null;
    RB.ui.view = RB.ui.nav.type;
    RB.ui.rackId = RB.ui.nav.type === 'rack' ? RB.ui.nav.id : null;
    RB.ui.roomId = RB.ui.nav.type === 'room' ? RB.ui.nav.id : null;
    if (!RB.ui.zoomMode) RB.ui.zoomMode = 'fit';
    // A link ending in #map opens straight on the site map.
    if (/^#map\b/.test(location.hash)) RB.ui.tab = 'atlas';
    // First visit: start on the overview with the example opened out in Locations, so the
    // racks, the "needs attention" list and the view tabs are all in sight.
    if (!localStorage.getItem('rackbook.visited')) {
      localStorage.setItem('rackbook.visited', '1');
      const r = S().racks[0];
      RB.ui.nav = { type: 'home', id: null }; RB.ui.view = 'home'; RB.ui.rackId = null; RB.ui.roomId = null;
      if (r) RB.ui.expanded = { site_1: true, floor_1: true, [r.roomId]: true };
    }
    // The name comes from config.js, so a deployment can call it what it likes: the CommsAtlas logo is shown for "CommsAtlas",
    // and the emblem with the chosen name for anything else.
    $('#brandMark').innerHTML = RB.APP_NAME === 'CommsAtlas' ? RB.wordLogo('brand-logo', 40)
      : RB.logo() + '<span class="brand-name">' + RB.esc(RB.APP_NAME) + '</span>';
    $('.brand').setAttribute('aria-label', RB.APP_NAME + ' home');
    document.title = RB.APP_NAME + ' — Sites, comms rooms, racks & patching';
    RB.applyTheme(RB.themePref());
    RB.store.on(() => RB.render());

    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('input', onInput);
    document.addEventListener('keydown', onKey);
    document.addEventListener('dragstart', onDragStart);
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('drop', onDrop);
    document.addEventListener('dragend', () => { RB.dragTpl = null; RB.$$('.drop-ghost').forEach((g) => { g.hidden = true; }); });
    const releasePointer = () => {
      RB.pointerDown = false;
      setTimeout(() => { if (RB.renderPending && !RB.pointerDown) { RB.renderPending = false; RB.render(); } }, 0);
    };
    document.addEventListener('pointerdown', (e) => { if (e.isPrimary) RB.pointerDown = true; }, true);
    document.addEventListener('pointerup', releasePointer, true);
    document.addEventListener('pointercancel', releasePointer, true);
    window.addEventListener('blur', releasePointer);
    document.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.dev')) onDevPointerDown(e);
      if (e.target.closest('.marker')) onMarkerDown(e);
      const pop = $('#popover');
      if (!pop.hidden && !e.target.closest('#popover') && !e.target.closest('.port') && !e.target.closest('[data-port-row]') && !e.target.closest('.modal-wrap')) RB.closePopover(true);
    });
    document.addEventListener('pointermove', (e) => { onPointerMove(e); onMarkerMove(e); }, { passive: false });
    document.addEventListener('pointerup', (e) => { onPointerUp(e); onMarkerUp(e); });
    document.addEventListener('pointercancel', (e) => {
      if (drag && drag.el) { drag.el.classList.remove('is-dragging'); drag.el.style.transform = ''; showGhost(drag.geom, null); }
      drag = null; if (mdrag) { mdrag = null; RB.render(); }
      void e;
    });
    $('#scrim').addEventListener('click', RB.closeDrawers);

    let rt;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => { if (RB.ui.view === 'rack') RB.render({ keepPopover: false }); }, 120);
    });
    window.addEventListener('afterprint', () => document.body.classList.remove('is-printing'));
    window.addEventListener('storage', (e) => { if (e.key === RB.store.key) { RB.store.load(); RB.render(); } });

    RB.render();
    // With the CommsAtlas server, records are shared through it; on a plain web server they stay in this browser.
    const started = RB.server ? RB.server.start().then(() => RB.render(), () => RB.render()) : Promise.resolve();
    // Links straight to a dialog: #vlans, #connectors, #users (connectors once the server has answered).
    const deep = { '#vlans': () => RB.openVlans(), '#connectors': () => started.then(() => RB.openConnectors()), '#users': () => RB.openUsers() }[location.hash];
    if (deep) setTimeout(deep, 0);
    // Fonts change text widths, so redraw cables once they are ready.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (RB.ui.view === 'rack') RB.render(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
