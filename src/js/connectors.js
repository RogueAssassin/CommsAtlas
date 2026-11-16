/* CommsAtlas — connectors: the server calls another system's API with its key (UniFi today) and the app merges what it
   finds into the records. Keys are kept on the server, encrypted, and never come back to the browser. */
(function () {
  'use strict';
  const RB = window.RB;
  const esc = RB.esc;
  const ic = RB.icon;
  const S = () => RB.store.state;
  const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  const when = (t) => { if (!t) return ''; const d = new Date(t); return isNaN(d) ? '' : d.toLocaleString(); };

  let types = [];
  const typeOf = (id) => types.find((t) => t.id === id) || { id, name: id, help: '' };
  const call = (m, p, b) => RB.server.call(m, p, b);

  function noServer() {
    RB.modal.open({
      title: 'Connectors',
      body: '<p class="intro">Connectors pull switches, gateways and their ports straight from your network system, such as UniFi, using that system’s API key.</p>' +
        '<p class="hint warn">They need the ' + esc(RB.APP_NAME) + ' server, because the key must be kept on a server rather than in a browser. This copy is on a plain web server. Install the server (see INSTALL.md), sign in, and Connectors appear here.</p>',
      actions: [{ label: 'OK', kind: 'primary', onClick: (m) => m.close() }],
    });
  }

  RB.openConnectors = async function () {
    if (!RB.server.on) { noServer(); return; }
    if (!RB.server.hasCredential()) { RB.toast('Sign in to the server first.', 'error'); return; }
    if (RB.auth.rank() < 3) { RB.toast('Connectors are for Editors and Admins.', 'error'); return; }
    const m = RB.modal.open({ title: 'Connectors', body: '<p class="hint">Loading…</p>', wide: true });
    const isAdmin = RB.auth.rank() >= 4;

    async function load() {
      let r;
      try { r = await call('GET', '/api/v1/connectors'); } catch (e) { r = { ok: false, j: { error: e.message } }; }
      if (!r.ok) { m.body.innerHTML = '<p class="hint warn">' + esc(r.j.error || 'The server didn’t answer.') + '</p>'; return; }
      types = r.j.types || [];
      const list = r.j.connectors || [];
      const rows = list.map((c) => '<tr><td><b>' + esc(c.name) + '</b><br><small class="muted">' + esc(typeOf(c.type).name) + (c.url ? ' · ' + esc(c.url) : '') + (c.site ? ' · sites with “' + esc(c.site) + '”' : '') + '</small></td>' +
        '<td><code>' + esc(c.keyHint || '') + '</code></td>' +
        '<td>' + (c.lastAt ? '<span class="' + (c.lastOk ? 'ok' : 'warn') + '">' + esc(c.lastResult) + '</span><br><small class="muted">' + esc(when(c.lastAt)) + '</small>' : '<small class="muted">Not used yet</small>') + '</td>' +
        '<td class="con-acts"><button type="button" class="btn sm btn--primary" data-con="pull" data-id="' + esc(c.id) + '">' + ic('download', 14) + ' Pull</button>' +
        (isAdmin ? '<button type="button" class="btn sm" data-con="test" data-id="' + esc(c.id) + '">Test</button><button type="button" class="btn sm" data-con="edit" data-id="' + esc(c.id) + '">Edit</button><button type="button" class="btn sm btn--ghost" data-con="del" data-id="' + esc(c.id) + '">Remove</button>' : '') + '</td></tr>').join('');
      m.body.innerHTML = '<div class="con">' +
        '<p class="intro">A connector lets the server read devices from another system’s API with that system’s key. <b>Pull</b> shows what it found; nothing changes until you press Import, and Undo takes it back.</p>' +
        (list.length ? '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Connector</th><th>Key</th><th>Last used</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
          : '<p class="hint">No connectors yet.' + (isAdmin ? ' Add one with its API key.' : ' An Admin adds them.') + '</p>') +
        (isAdmin ? '<div class="btn-row"><button type="button" class="btn btn--primary" data-con="add">' + ic('plus', 14) + ' Add a connector</button></div>' : '') +
        '<h3 class="sub">Where the keys come from</h3><ul class="con-help">' + types.map((t) => '<li><b>' + esc(t.name) + ':</b> ' + esc(t.help) + '</li>').join('') + '</ul>' +
        '<p class="hint">Keys are sent once to the server, kept there encrypted and never shown again; only their last four characters are listed. Only Admins add, change or test connectors; Editors can pull.</p></div>';
    }

    async function edit(c) {
      const v = await RB.modal.form({
        title: c ? 'Edit ' + c.name : 'Add a connector',
        fields: [
          { name: 'name', label: 'Name', value: c ? c.name : '', required: true, placeholder: 'e.g. Head office UniFi' },
          { name: 'type', label: 'Connects to', type: 'select', value: c ? c.type : (types[0] || {}).id, options: types.map((t) => ({ value: t.id, label: t.name })) },
          { name: 'url', label: 'Console address (on-site consoles only)', value: c ? c.url : '', placeholder: 'https://192.168.1.1' },
          { name: 'apiKey', label: 'API key', type: 'password', value: '', required: !c, placeholder: c ? 'Leave blank to keep ' + (c.keyHint || 'the current key') : 'Paste the key' },
          { name: 'site', label: 'Only sites whose name has (optional)', value: c ? c.site : '', placeholder: 'e.g. Northside' },
          { name: 'allowSelfSigned', label: 'The console uses its own (self-signed) certificate', type: 'checkbox', value: c ? c.allowSelfSigned : true, hint: 'Usual for a UniFi console reached by its IP address. Only used for on-site consoles.' },
        ],
        validate: (x) => (typeOf(x.type).needsUrl && !/^https:\/\/\S+$/i.test(x.url) ? 'Give the console’s https address.' : null),
        submitLabel: c ? 'Save' : 'Add',
      });
      if (!v) return;
      const r = await call('PUT', '/api/v1/connectors', Object.assign({ id: c ? c.id : '' }, v));
      if (!r.ok) { RB.toast(r.j.error || 'The server didn’t save it.', 'error'); return; }
      RB.toast(c ? 'Connector saved' : 'Connector added. Press Test to check its key.');
      await load();
    }

    m.body.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-con]'); if (!b) return;
      const act = b.dataset.con, id = b.dataset.id;
      if (act === 'add') { edit(null); return; }
      const r0 = await call('GET', '/api/v1/connectors');
      const c = ((r0.j && r0.j.connectors) || []).find((x) => x.id === id);
      if (!c) { RB.toast('That connector is gone.', 'error'); load(); return; }
      if (act === 'edit') { edit(c); return; }
      if (act === 'del') {
        if (!(await RB.modal.confirm('Remove the connector “' + c.name + '” and its key from the server? Your records stay as they are.', { okLabel: 'Remove' }))) return;
        const r = await call('DELETE', '/api/v1/connectors/' + encodeURIComponent(id));
        RB.toast(r.ok ? 'Connector removed' : r.j.error || 'Not removed', r.ok ? '' : 'error');
        load(); return;
      }
      b.disabled = true; const label = b.innerHTML; b.textContent = act === 'test' ? 'Testing…' : 'Pulling…';
      let r;
      try {
        if (act === 'pull') r = await runPull(id, (stage) => { b.textContent = 'Pulling… ' + String(stage || '').slice(0, 44); });
        else r = await call('POST', '/api/v1/connectors/' + encodeURIComponent(id) + '/' + act);
      } catch (err) { r = { ok: false, j: { error: err.message } }; }
      b.disabled = false; b.innerHTML = label;
      if (!r.ok) { RB.toast(r.j.error || 'The connector failed.', 'error'); load(); return; }
      if (act === 'test') {
        if (!r.j.deviceCount) showDiag(c, r.j);
        else RB.toast('It works: ' + r.j.siteCount + ' site' + (r.j.siteCount === 1 ? '' : 's') + ', ' + r.j.deviceCount + ' devices.');
      } else preview(c, r.j);
      load();
    });
    load();
  };

  /** A pull runs on the server in the background (a big site takes longer than one web request may); this asks how it is going until it ends. */
  async function runPull(id, onStage) {
    const s = await call('POST', '/api/v1/connectors/' + encodeURIComponent(id) + '/pull-start');
    if (!s.ok || !s.j.job) return s;
    const t0 = Date.now();
    for (;;) {
      await new Promise((res) => setTimeout(res, 1500));
      const p = await call('GET', '/api/v1/connector-jobs/' + encodeURIComponent(s.j.job));
      if (!p.ok) return p;
      if (p.j.state === 'done') return { ok: true, j: p.j.result };
      if (p.j.state === 'failed') return { ok: false, j: { error: p.j.error } };
      if (onStage) onStage(p.j.stage);
      if (Date.now() - t0 > 15 * 60 * 1000) return { ok: false, j: { error: 'The pull is taking too long; it may still finish on the server. Try again in a few minutes.' } };
    }
  }

  /** When a pull or test finds nothing: every question the server asked and the answer, so the cause is visible. */
  function showDiag(c, got) {
    const lines = got.diagnostics || [];
    RB.modal.open({
      title: 'No devices found',
      body: '<p class="intro">The key for <b>' + esc(c.name) + '</b> was accepted, but no devices came back. This is what the server asked and what it was told:</p>' +
        (lines.length ? '<ul class="imp-warn">' + lines.map((d) => '<li>' + esc(d) + '</li>').join('') + '</ul>' : '<p class="hint">The server gave no further detail.</p>') +
        '<p class="hint">For a UniFi Site Manager (cloud) key: the key must be made at unifi.ui.com > API while signed in as the owner of the console, and the console must be online. Site Manager does not list consoles you are only a member of.</p>',
      actions: [{ label: 'OK', kind: 'primary', onClick: (x) => x.close() }],
    });
  }

  /** What a pull found, each remote site matched to one of ours (or a new one, or skipped). */
  function preview(c, got) {
    const st = S();
    const sites = (got.sites || []).filter((x) => (x.devices || []).length);
    if (!sites.length) { showDiag(c, got); return; }
    const opts = (name) => '<option value="+">New site: ' + esc(name) + '</option>' + st.sites.map((x) => '<option value="' + esc(x.id) + '"' + (same(x.name, name) ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '<option value="">Skip</option>';
    const count = (devs, k) => devs.filter((d) => d.kind === k).length;
    const rows = sites.map((x, i) => {
      const devs = x.devices, sw = count(devs, 'switch'), gw = count(devs, 'gateway'), ap = count(devs, 'ap');
      const known = devs.filter((d) => (d.kind === 'switch' || d.kind === 'gateway') && st.devices.some((y) => (d.serial && y.serial && same(y.serial, d.serial)) || same(y.name, d.name))).length;
      return '<tr><td><b>' + esc(x.name) + '</b>' + (x.console && x.console !== x.name ? '<br><small class="muted">' + esc(x.console) + '</small>' : '') + '</td>' +
        '<td>' + [gw && gw + ' gateway' + (gw === 1 ? '' : 's'), sw && sw + ' switch' + (sw === 1 ? '' : 'es'), ap && ap + ' access point' + (ap === 1 ? '' : 's'), devs.length - sw - gw - ap > 0 && devs.length - sw - gw - ap + ' other'].filter(Boolean).join(', ') +
        (known ? '<br><small class="muted">' + known + ' already in your records: updated</small>' : '') +
        (() => {
          const inf = x.info || {}, len = (k) => (Array.isArray(inf[k]) ? inf[k].length : 0);
          const more = [[(x.networks || []).length, 'VLAN'], [(x.clients || []).length, 'wired client'], [len('wlans') || len('wifi'), 'Wi-Fi network'],
            [((x.protect || {}).devices || []).filter((p) => p.kind === 'camera').length, 'UniFi camera']].filter((m) => m[0]).map((m) => m[0] + ' ' + m[1] + (m[0] === 1 ? '' : 's'));
          return more.length ? '<br><small class="muted">Also: ' + more.map(esc).join(', ') + '</small>' : '';
        })() + '</td>' +
        '<td><select data-site="' + i + '" aria-label="Put ' + esc(x.name) + ' into">' + opts(x.name) + '</select></td></tr>';
    }).join('');
    const body = '<div class="imp"><p class="intro">From <b>' + esc(c.name) + '</b>, just now. Nothing changes until you press Import, and Undo takes it all back.</p>' +
      '<div class="imp-tbl"><table class="tbl"><thead><tr><th>Their site</th><th>Found</th><th>Put into</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="hint">Gateways and switches are added or updated with their model, IP address, MAC, serial and firmware' + (c.type === 'unifi-local' ? ', and every port, patched or not, with its VLAN, link, PoE and a Disabled mark where it is turned off' : '') + '. New ones go into the site’s first comms room and rack. Your port labels, cables and typed notes are kept, and VLANs you already have keep their names and colours. Access points, Protect cameras and other UniFi devices are added as devices on the switch port they hang from. The site’s Wi-Fi, WANs, VPN, firewall and health are kept on the site’s page.</p>' +
      ((got.diagnostics || []).length ? '<details class="con-diag"><summary>What the connector asked, and what came back</summary><ul class="imp-warn">' + got.diagnostics.map((d) => '<li>' + esc(d) + '</li>').join('') + '</ul></details>' : '') + '</div>';
    RB.modal.open({
      title: 'Pull from ' + c.name, body, wide: true,
      actions: [
        { label: 'Cancel', onClick: (x) => x.close() },
        { label: 'Import', kind: 'primary', onClick: (x) => {
          const n = { devNew: 0, devUpdated: 0, ports: 0, vlans: 0, warnings: [] };
          let firstSite = null;
          x.el.querySelectorAll('[data-site]').forEach((sel) => {
            const remote = sites[+sel.dataset.site];
            if (sel.value === '') return;
            const ours = sel.value === '+' ? null : S().sites.find((y) => y.id === sel.value);
            let name = ours ? ours.name : remote.name;
            if (!ours && S().sites.some((y) => same(y.name, name))) name = remote.name + ' (' + (remote.console || c.name) + ')';
            const plan = RB.planFromConnector(name, remote.devices, c.name, remote.networks, { info: remote.info, clients: remote.clients, protect: remote.protect, consoleInfo: remote.consoleInfo });
            if (!plan.devices.length) return;
            const got = RB.applySheetImport(plan, c.name + ' connector');
            n.devNew += got.devNew; n.devUpdated += got.devUpdated; n.ports += got.ports; n.vlans += got.vlansNew; n.warnings = n.warnings.concat(got.warnings);
            if (!firstSite) firstSite = S().sites.find((y) => same(y.name, name));
          });
          x.close();
          if (firstSite) { RB.ui.expanded[firstSite.id] = true; RB.navigate('site', firstSite.id); } else RB.render();
          RB.toast(n.devNew || n.devUpdated ? 'Imported ' + [n.devNew && n.devNew + ' new devices', n.devUpdated && n.devUpdated + ' updated', n.ports && n.ports + ' ports', n.vlans && n.vlans + ' new VLANs'].filter(Boolean).join(', ') : 'Nothing imported');
          if (n.warnings.length) setTimeout(() => RB.modal.open({ title: 'Imported, with notes', body: '<ul class="imp-warn">' + n.warnings.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul>', actions: [{ label: 'OK', kind: 'primary', onClick: (y) => y.close() }] }), 50);
        } },
      ],
    });
  }

  /* ---------- a site's own VLANs, Wi-Fi and UniFi Protect, as drop boxes on its page ---------- */
  function table(cols, rows, cap) {
    if (!rows || !rows.length) return '';
    const shown = rows.slice(0, cap || 100);
    return '<div class="ux-tbl"><table class="tbl"><thead><tr>' + cols.map((c) => '<th>' + esc(c[0]) + '</th>').join('') + '</tr></thead><tbody>' +
      shown.map((r) => '<tr>' + cols.map((c) => '<td>' + (c[2] ? c[1](r) : esc(String(c[1](r) == null ? '' : c[1](r)))) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' +
      (rows.length > shown.length ? '<p class="hint">Showing ' + shown.length + ' of ' + rows.length + '.</p>' : '');
  }
  const kv = (o) => (o && Object.keys(o).length ? '<dl class="ux-kv">' + Object.keys(o).filter((k) => o[k] !== '' && o[k] != null).map((k) => '<dt>' + esc(k) + '</dt><dd>' + esc(String(o[k])) + '</dd>').join('') + '</dl>' : '');
  const sec = (title, count, html, open) => '<details class="ux-sec"' + (open ? ' open' : '') + '><summary>' + esc(title) + (count != null ? ' <span class="ux-n">' + count + '</span>' : '') + '</summary>' + html + '</details>';
  const ago = (t) => { if (!t) return ''; const d = new Date(t); return isNaN(d) ? '' : d.toLocaleString(); };

  /** The VLANs a site uses: those with an IP range of its own here, and those on a port of one of its devices. */
  function siteVlans(site) {
    const s = S();
    const rooms = new Set(RB.get.siteRoomsOf(site.id).concat(...RB.get.floorsOf(site.id).map((f) => RB.get.roomsOf(f.id))).map((r) => r.id));
    const racks = new Set(s.racks.filter((r) => rooms.has(r.roomId)).map((r) => r.id));
    const used = {};
    s.devices.filter((d) => racks.has(d.rackId) || rooms.has(d.roomId)).forEach((d) => Object.values(d.portMeta || {}).forEach((m) => { if (m && m.vlan) used[m.vlan] = (used[m.vlan] || 0) + 1; }));
    return s.vlans.filter((v) => used[v.id] || (site.nets && site.nets[v.id])).sort((a, b) => Number(a.vid) - Number(b.vid)).map((v) => ({ v, net: Object.assign({}, v.subnet && !(site.nets && site.nets[v.id]) ? { subnet: v.subnet } : {}, site.nets && site.nets[v.id]), ports: used[v.id] || 0 }));
  }

  /** The drop boxes for one site. Returns '' for something that is not a site. */
  RB.siteBoxes = function (site) {
    if (!site) return '';
    const s = S();
    const vl = siteVlans(site);
    const wl = s.wlans.filter((w) => !w.siteId || w.siteId === site.id);
    const u = site.unifi || null;
    const prot = (u && u.protect && u.protect.devices) || [];
    const nvrs = prot.filter((p) => p.kind === 'nvr'), cams = prot.filter((p) => p.kind === 'camera');
    const edit = (act, label) => '<div class="ux-actions"><button type="button" class="btn sm" data-act="' + act + '" data-id="' + esc(site.id) + '">' + label + '</button></div>';
    const parts = [
      sec('VLANs at this site', vl.length, table([['', (r) => '<span class="ux-sw" style="background:' + esc(r.v.color) + '"></span>', true], ['ID', (r) => r.v.vid], ['Name', (r) => r.v.name], ['Subnet', (r) => r.net.subnet], ['Gateway', (r) => r.net.gateway], ['DHCP range', (r) => r.net.dhcp], ['Ports', (r) => r.ports || '']], vl) +
        (vl.length ? '' : '<p class="hint">No VLANs are in use at this site yet.</p>') + edit('site-vlans', 'Edit VLANs and IP ranges')),
      sec('Wi-Fi networks at this site', wl.length, table([['SSID', (r) => r.ssid], ['VLAN', (r) => { const v = RB.get.vlan(r.vlanId); return v ? v.vid + ' ' + v.name : ''; }], ['Security', (r) => r.security], ['Band', (r) => r.band], ['Site', (r) => (r.siteId ? '' : 'All sites')]], wl) +
        (wl.length ? '' : '<p class="hint">No Wi-Fi networks are recorded for this site yet.</p>') + edit('site-wifi', 'Edit Wi-Fi networks')),
    ];
    if (u) {
      const c = u.console || {};
      const info = { Console: [c.model, c.firmware && 'firmware ' + c.firmware].filter(Boolean).join(' · '), 'Console name': c.name, Timezone: c.timezone, ISP: c.isp, 'WAN address': c.wanIp, WANs: (u.wans || []).join(', '), 'WAN uptime': c.wanUptimePct != null ? c.wanUptimePct + '%' : '', Devices: c.devices, 'Offline devices': c.offlineDevices, 'Updates waiting': c.pendingUpdates, 'Last backup': ago(c.lastBackup), 'Pulled from UniFi': ago(u.at) };
      parts.push(sec('UniFi site information', null, kv(info)));
      parts.push(sec('UniFi Protect', nvrs.length + cams.length, (u.protect && u.protect.version ? '<p class="hint">Protect ' + esc(u.protect.version) + '</p>' : '') +
        (nvrs.length ? table([['Recorder (NVR)', (r) => r.name], ['Model', (r) => r.model], ['MAC', (r) => r.mac]], nvrs) : '<p class="hint">No recorder found.</p>') +
        (cams.length ? table([['UniFi camera', (r) => r.name], ['Model', (r) => r.model], ['State', (r) => String(r.state || '').toLowerCase()], ['MAC', (r) => r.mac]], cams) : '<p class="hint">No UniFi cameras.</p>')));
    }
    return '<section class="ux-boxes" aria-label="Site details">' + parts.join('') + '</section>';
  };
})();
