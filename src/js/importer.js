/* CommsAtlas — import from spreadsheets.
   Recognises two kinds of sheet, wherever their tables sit on the page:
   - a VLAN reference: a table headed "VLAN ID", "VLAN name" (+ subnet, purpose/notes, cable colour);
   - a switch / device sheet: label cells such as "Switch name", "Model", "Serial number",
     "Management IP" with the value beside them, a port map headed "Port", "Device name"
     (+ device type, native VLAN, VLAN name, tagged VLANs, patch point, status, notes, cable colour)
     and an optional change log headed "Date", "Change made".
   Importing again updates what is already there (VLANs by number, devices by serial or name). */
(function () {
  'use strict';
  const RB = window.RB;
  const esc = RB.esc;
  const S = () => RB.store.state;
  const norm = (v) => String(v == null ? '' : v).toLowerCase().replace(/\s+/g, ' ').replace(/[:*]+$/, '').trim();

  /** Cable colour names → swatches. */
  RB.LEAD_COLOURS = {
    Black: '#171717', Blue: '#2563eb', White: '#f5f5f5', Purple: '#9333ea', Red: '#dc2626', Pink: '#f472b6',
    Yellow: '#facc15', Green: '#16a34a', Orange: '#f97316', Grey: '#9ca3af', Brown: '#92400e', Teal: '#0d9488',
    'Light blue': '#7dd3fc', Navy: '#1e3a8a',
  };
  RB.leadHex = function (name) {
    const n = norm(name);
    if (!n) return '';
    if (/^#[0-9a-f]{6}$/.test(n)) return n;
    const k = Object.keys(RB.LEAD_COLOURS).find((x) => norm(x) === n || (n === 'gray' && x === 'Grey') || (n === 'violet' && x === 'Purple'));
    return k ? RB.LEAD_COLOURS[k] : '';
  };
  const leadName = (v) => { const n = norm(v); const k = Object.keys(RB.LEAD_COLOURS).find((x) => norm(x) === n); return k || String(v || '').trim(); };

  /** Excel stores dates as day numbers; show them as dates. */
  function asDate(v) {
    const s = String(v || '').trim();
    if (!/^\d{5}(\.\d+)?$/.test(s)) return s;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(parseFloat(s) * 86400000));
    return d.toISOString().slice(0, 10);
  }

  function headerRow(rows, spec, need, from, to) {
    for (let r = from || 0; r < Math.min(rows.length, to == null ? rows.length : to); r++) {
      const row = (rows[r] || []).map(norm);
      const cols = {};
      Object.keys(spec).forEach((k) => { const i = row.findIndex(spec[k]); if (i >= 0) cols[k] = i; });
      if (need.every((k) => cols[k] != null)) return { r, cols };
    }
    return null;
  }
  const cell = (row, i) => (i == null || !row ? '' : String(row[i] || '').trim());

  const VLAN_SPEC = {
    vid: (c) => c === 'vlan id' || c === 'vlan' || c === 'vid' || c === 'vlan number',
    name: (c) => c === 'vlan name' || c === 'name',
    subnet: (c) => c.startsWith('subnet') || c === 'network' || c === 'ip range',
    notes: (c) => c.startsWith('purpose') || c === 'notes' || c === 'description',
    colour: (c) => c.startsWith('patch cable colour') || c.startsWith('patch cable color') || c === 'cable colour' || c === 'cable color' || c.startsWith('patch lead colour') || c.startsWith('patch lead color') || c === 'lead colour' || c === 'vlan colour' || c === 'vlan color' || c === 'colour' || c === 'color',
    service: (c) => c.startsWith('service'),
  };
  const PORT_SPEC = {
    port: (c) => c === 'port' || c === 'port #' || c === 'port no' || c === 'port number',
    device: (c) => c === 'device name' || c === 'device' || c === 'connected device',
    type: (c) => c === 'device type' || c === 'type',
    vid: (c) => c === 'native vlan' || c === 'vlan id' || c === 'untagged vlan',
    vlanName: (c) => c === 'vlan name',
    tagged: (c) => c.startsWith('tagged'),
    patch: (c) => c.startsWith('patch point') || c === 'patch panel' || c === 'outlet',
    status: (c) => c === 'status',
    notes: (c) => c === 'notes' || c === 'description' || c === 'comment',
    lead: (c) => c === 'cable colour' || c === 'cable color' || c.startsWith('patch cable colour') || c === 'lead colour' || c === 'lead color' || c.startsWith('patch lead colour') || c === 'colour',
  };
  const LOG_SPEC = {
    date: (c) => c === 'date',
    ports: (c) => c.startsWith('port'),
    change: (c) => c.startsWith('change'),
    by: (c) => c === 'made by' || c === 'by' || c === 'changed by',
  };
  const FIELDS = [
    ['name', (c) => c === 'switch name' || c === 'device name' || c === 'hostname' || c === 'router name' || c === 'firewall name'],
    ['model', (c) => c === 'model'],
    ['serial', (c) => c === 'serial number' || c === 'serial' || c === 's/n'],
    ['mac', (c) => c === 'mac address' || c === 'mac'],
    ['ip', (c) => c === 'management ip' || c === 'mgmt ip' || c === 'ip address' || c === 'ip'],
    ['firmware', (c) => c.startsWith('firmware')],
    ['location', (c) => c.startsWith('location')],
    ['rackPos', (c) => c.startsWith('rack / u') || c === 'rack position' || c === 'u position' || c === 'rack'],
    ['upstream', (c) => c.startsWith('upstream')],
    ['surveyedOn', (c) => c === 'date surveyed' || c === 'survey date'],
    ['surveyedBy', (c) => c === 'surveyed by'],
    ['type', (c) => c === 'device type' || c === 'category'],
    ['assetTag', (c) => c === 'asset tag' || c === 'asset number'],
  ];
  const isLabel = (v) => { const c = norm(v); return !!c && (FIELDS.some((f) => f[1](c)) || c === 'ports in use (of 6)' || /^ports in use/.test(c)); };

  function readVlans(rows, h) {
    const out = [];
    for (let r = h.r + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const vidText = cell(row, h.cols.vid), name = cell(row, h.cols.name);
      if (!vidText && !name) { if (out.length) break; continue; }
      const vid = parseInt(vidText, 10);
      if (!Number.isFinite(vid) || vid < 1 || vid > 4094) continue;
      const notes = cell(row, h.cols.notes);
      const gw = /gateway\s*:?\s*(\d{1,3}(?:\.\d{1,3}){3})/i.exec(notes);
      // The gateway belongs to this site's IP range; the rest of the note (e.g. "Guest network") is the VLAN's purpose everywhere.
      const purpose = gw ? notes.replace(gw[0], '').replace(/^[\s.;,-]+|[\s.;,-]+$/g, '').trim() : notes;
      out.push({ vid, name: name || 'VLAN ' + vid, subnet: cell(row, h.cols.subnet), gateway: gw ? gw[1] : '', notes: purpose, lead: leadName(cell(row, h.cols.colour)), ref: h.cols.subnet != null });
    }
    return out;
  }

  /** The colour standard beside a VLAN table ("Colour" | "Service - cable colour standard"): cable colour → what it is for. */
  function readLegend(rows, h) {
    const si = h.cols.service;
    if (si == null) return {};
    const head = (rows[h.r] || []).map(norm);
    let ci = -1;
    for (let i = si - 1; i >= 0; i--) if (head[i] === 'colour' || head[i] === 'color') { ci = i; break; }
    if (ci < 0) return {};
    const out = {};
    for (let r = h.r + 1; r < rows.length; r++) {
      const col = leadName(cell(rows[r], ci)), svc = cell(rows[r], si);
      if (col && svc && RB.leadHex(col)) out[col] = svc;
    }
    return out;
  }

  /** Wi-Fi VLANs: the cable colour the standard keeps for Wi-Fi, or a name or purpose that says so. */
  const WIFI_RE = /\b(wi-?fi|wlan|wireless|ssid|byod)\b|^guest\b|\bguest (network|wi-?fi)\b/i;
  function wifiVlans(vlans, legend) {
    const wifiLeads = Object.keys(legend).filter((k) => /wi-?fi|wireless|wlan/i.test(legend[k]));
    return vlans.filter((v) => Number(v.vid) !== 1 && (WIFI_RE.test(v.name) || WIFI_RE.test(v.notes || '') || (v.lead && wifiLeads.includes(v.lead))));
  }

  function readDevice(sheet, rows, portHead) {
    const limit = portHead ? portHead.r : Math.min(rows.length, 40);
    const dev = { sheet: sheet.name };
    for (let r = 0; r < limit; r++) {
      const row = rows[r] || [];
      for (let i = 0; i < row.length; i++) {
        const c = norm(row[i]);
        if (!c) continue;
        const f = FIELDS.find((x) => x[1](c));
        if (!f || dev[f[0]] != null) continue;
        let v = '';
        for (let j = i + 1; j < row.length; j++) { if (String(row[j] || '').trim()) { v = isLabel(row[j]) ? '' : String(row[j]).trim(); break; } }
        dev[f[0]] = f[0] === 'surveyedOn' ? asDate(v) : v;
      }
    }
    FIELDS.forEach((f) => { if (dev[f[0]] == null) dev[f[0]] = ''; });
    if (!dev.name) dev.name = sheet.name;
    dev.ports = [];
    if (portHead) {
      // Every port table on the sheet: RJ45 first, then e.g. "SFP / SFP+ uplink ports" with its own header.
      let seq = 0, section = 0, blanks = 0;
      for (let r = portHead.r + 1; r < rows.length; r++) {
        const row = rows[r] || [];
        const pText = cell(row, portHead.cols.port);
        const text = row.join(' ');
        if (/change log/i.test(text)) break;
        const n = parseInt(pText, 10);
        const noDevice = !cell(row, portHead.cols.device);
        if (noDevice && !Number.isFinite(n) && /sfp|uplink|fibre|fiber/i.test(text)) { section++; blanks = 0; continue; }
        if (!pText && noDevice) { if (++blanks > 3 && dev.ports.length) break; continue; }
        blanks = 0;
        if (norm(pText) === 'port') { if (dev.ports.length && !section) section = 1; continue; }
        if (!Number.isFinite(n) && dev.ports.length && !cell(row, portHead.cols.device)) break; // "Total" and the like
        seq++;
        const vid = parseInt(cell(row, portHead.cols.vid), 10);
        const notes = cell(row, portHead.cols.notes);
        const sm = /^\s*(sfp28|sfp\+|sfp|qsfp)\b/i.exec(notes) || /\b(sfp28|sfp\+|qsfp)\b/i.exec(pText);
        dev.ports.push({
          section, cage: sm ? (sm[1].toUpperCase() === 'SFP+' ? 'SFP+' : sm[1].toUpperCase()) : '',
          n: Number.isFinite(n) && n > 0 ? n : seq,
          device: cell(row, portHead.cols.device), type: cell(row, portHead.cols.type),
          vid: Number.isFinite(vid) ? vid : null, vlanName: cell(row, portHead.cols.vlanName),
          tagged: cell(row, portHead.cols.tagged), patch: cell(row, portHead.cols.patch),
          status: cell(row, portHead.cols.status), notes, lead: leadName(cell(row, portHead.cols.lead)),
        });
      }
    }
    dev.log = [];
    const lh = headerRow(rows, LOG_SPEC, ['date', 'change'], portHead ? portHead.r + 1 : 0);
    if (lh) {
      for (let r = lh.r + 1; r < rows.length; r++) {
        const row = rows[r] || [];
        const e = { date: asDate(cell(row, lh.cols.date)), ports: cell(row, lh.cols.ports), change: cell(row, lh.cols.change), by: cell(row, lh.cols.by) };
        if (!e.date && !e.change) { if (dev.log.length) break; continue; }
        dev.log.push(e);
      }
    }
    return dev;
  }

  /* ----- the register's summary sheets: Cover, Switch Index, Cabinet Audit, CCTV & NVR ----- */
  const nextValue = (row, i) => { for (let j = i + 1; j < row.length; j++) { const v = String(row[j] || '').trim(); if (v) return isLabel(v) ? '' : v; } return ''; };

  /** "Site name", "Site code" and "Address" on a cover sheet (worked examples further down are ignored). */
  function readCover(rows) {
    const out = {};
    for (let r = 0; r < Math.min(rows.length, 60); r++) {
      const row = rows[r] || [];
      if (row.some((c) => /^examples?\b/i.test(String(c || '').trim()))) break;
      row.forEach((c, i) => {
        const k = norm(c);
        const key = k === 'site name' ? 'name' : k === 'site code' ? 'code' : k === 'address' || k === 'site address' ? 'address' : '';
        if (key && !out[key]) out[key] = nextValue(row, i);
      });
    }
    return out.name ? out : null;
  }

  const INDEX_SPEC = { tab: (c) => c === 'tab' || c === 'sheet', name: (c) => c === 'switch name' || c === 'device name', model: (c) => c === 'model', location: (c) => c.startsWith('location') || c === 'comms room' || c === 'cabinet', ip: (c) => c === 'management ip' || c === 'ip address' };
  function readIndex(rows, h) {
    const out = [];
    for (let r = h.r + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const name = cell(row, h.cols.name) || cell(row, h.cols.tab);
      if (!name) { if (out.length) break; continue; }
      if (/^total$/i.test(name)) break;
      out.push({ tab: cell(row, h.cols.tab) || name, name, model: cell(row, h.cols.model), location: cell(row, h.cols.location), ip: cell(row, h.cols.ip) });
    }
    return out;
  }

  /** The cabinets named on an audit sheet ("Cabinet name / location"), each one a comms room. */
  function readCabinets(rows) {
    for (let r = 0; r < Math.min(rows.length, 40); r++) {
      const row = rows[r] || [];
      const li = row.findIndex((c) => /^cabinet name/.test(norm(c)));
      if (li < 0) continue;
      const head = rows[r - 1] || [];
      const out = [];
      for (let i = li + 1; i < row.length; i++) {
        const label = String(row[i] || '').trim();
        const h = norm(head[i]);
        if (!label || (h && !/^cabinet\s*\d+/.test(h))) continue;
        const num = (/(\d+)/.exec(h) || [])[1];
        out.push({ label, name: label.replace(/\s*\((?:core|main)\)\s*$/i, '').trim(), core: /\bcore\b/i.test(label) || /cabinet 1 = core/i.test(row[li]) && num === '1', num: num ? +num : out.length + 1 });
      }
      return out;
    }
    return [];
  }

  const NVR_SPEC = { name: (c) => c === 'nvr name' || c === 'nvr', type: (c) => c === 'type', make: (c) => c.startsWith('make'), ip: (c) => c === 'ip address' || c === 'ip', sw: (c) => c === 'switch', port: (c) => c === 'port', mac: (c) => c.startsWith('mac'), cams: (c) => c.startsWith('cameras'), notes: (c) => c === 'notes' };
  function readNvrs(rows, h) {
    const out = [];
    for (let r = h.r + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      // The NVR table ends at the next section ("2. Cameras by NVR") or table header.
      if (/^\d+\.\s+\D/.test(String(row[0] || '').trim()) || norm(cell(row, h.cols.sw)) === 'switch') break;
      const name = cell(row, h.cols.name);
      if (!name) { if (out.length) break; continue; }
      out.push({ name, type: cell(row, h.cols.type), make: cell(row, h.cols.make), ip: cell(row, h.cols.ip), sw: cell(row, h.cols.sw), port: parseInt(cell(row, h.cols.port), 10) || null, mac: cell(row, h.cols.mac), cams: cell(row, h.cols.cams), notes: cell(row, h.cols.notes) });
    }
    return out;
  }

  /** Work out what a workbook holds, without changing anything. */
  RB.planSheetImport = function (sheets) {
    const plan = { vlans: [], wlans: [], legend: {}, devices: [], nvrs: [], skipped: [], hidden: 0, siteHint: '', orgHint: '', site: null, index: [], cabinets: [] };
    const seenVid = new Map();
    sheets.forEach((sheet) => {
      const rows = sheet.rows;
      // Hidden sheets are a workbook's own lists and templates, not equipment.
      if (sheet.hidden) { plan.hidden++; return; }
      if (!plan.site && /cover|site details/i.test(sheet.name + ' ' + rows.slice(0, 8).map((r) => (r || []).join(' ')).join(' '))) {
        const c = readCover(rows);
        if (c) { plan.site = c; return; }
      }
      const ih = headerRow(rows, INDEX_SPEC, ['tab', 'name', 'location'], 0, 30);
      if (ih) { plan.index = plan.index.concat(readIndex(rows, ih)); return; }
      const cabs = readCabinets(rows);
      if (cabs.length) { plan.cabinets = cabs; return; }
      const nh = headerRow(rows, NVR_SPEC, ['name', 'sw'], 0, 60);
      if (nh) { plan.nvrs = readNvrs(rows, nh); return; }
      if (!plan.siteHint) {
        for (let r = 0; r < Math.min(rows.length, 6) && !plan.siteHint; r++) {
          (rows[r] || []).forEach((c) => { const m = /^([^|]{2,})\|([^|]{2,})$/.exec(String(c || '')); if (m && !plan.siteHint) { plan.orgHint = m[1].trim(); plan.siteHint = m[2].trim(); } });
        }
      }
      const vh = headerRow(rows, VLAN_SPEC, ['vid', 'name']);
      const ph = headerRow(rows, PORT_SPEC, ['port', 'device']);
      const hasSwitchLabel = rows.slice(0, 40).some((row) => (row || []).some((c) => FIELDS[0][1](norm(c))));
      let used = false;
      if (vh && !ph) {
        readVlans(rows, vh).forEach((v) => {
          const had = seenVid.get(v.vid);
          if (!had) { seenVid.set(v.vid, v); plan.vlans.push(v); return; }
          // A summary table (e.g. ports per VLAN) only fills gaps; the VLAN reference table's values win.
          Object.keys(v).forEach((k) => { if (k === 'ref') return; if (v[k] && (!had[k] || (v.ref && !had.ref))) had[k] = v[k]; });
          had.ref = had.ref || v.ref;
        });
        Object.assign(plan.legend, readLegend(rows, vh));
        used = true;
      }
      if (ph || hasSwitchLabel) {
        const d = readDevice(sheet, rows, ph);
        if (d.ports.length || d.model || d.serial || d.ip) { plan.devices.push(d); used = true; }
      }
      if (!used) plan.skipped.push(sheet.name);
    });
    plan.vlans.sort((a, b) => a.vid - b.vid);
    plan.wlans = wifiVlans(plan.vlans, plan.legend);
    // The Switch Index says which comms room each switch is in, when its own sheet doesn't.
    plan.devices.forEach((d) => {
      const ix = plan.index.find((x) => same(x.tab, d.sheet) || same(x.name, d.name));
      if (ix) { if (!d.location) d.location = ix.location; if (!d.model) d.model = ix.model; if (!d.ip) d.ip = ix.ip; }
      d.where = whereFor(d, plan);
    });
    return plan;
  };

  /** A plan like planSheetImport's from the switches and gateways a connector pulled for one site.
      New devices go into the site's first comms room and rack (made when the site has none). */
  RB.planFromConnector = function (siteName, devs, source, networks, extra) {
    extra = extra || {};
    const plan = { vlans: [], wlans: [], legend: {}, devices: [], nvrs: [], skipped: [], hidden: 0, siteHint: siteName, orgHint: '', site: null, index: [], cabinets: [], source, addEndpoints: true, connector: true };
    const macKey = (m) => String(m || '').replace(/[^0-9a-f]/gi, '').toLowerCase();
    const s = S();
    const site = s.sites.find((x) => same(x.name, siteName));
    // The console's networks become VLANs (a VLAN you already have keeps its name and colour) with this site's subnet, gateway and DHCP range.
    (networks || []).forEach((n) => { const vid = Number(n.vid); if (Number.isFinite(vid)) plan.vlans.push({ vid, name: n.name || 'VLAN ' + vid, subnet: n.subnet || '', gateway: n.gateway || '', dhcp: n.dhcp || '', notes: '', lead: '', keepName: true }); });
    const room = site && s.rooms.find((r) => (RB.get.siteOfRoom(r) || {}).id === site.id);
    const rack = room && s.racks.find((r) => r.roomId === room.id);
    const floor = room && room.floorId && s.floors.find((f) => f.id === room.floorId);
    (devs || []).filter((d) => d.kind === 'switch' || d.kind === 'gateway').forEach((d) => {
      const ports = (d.ports || []).map((p) => {
        const cage = /sfp|qsfp/i.test(p.connector || '') ? (/sfp28/i.test(p.connector) ? 'SFP28' : /qsfp/i.test(p.connector) ? 'QSFP' : /\+|plus/i.test(p.connector) ? 'SFP+' : 'SFP') : '';
        const speed = p.speedMbps ? (p.speedMbps >= 1000 ? p.speedMbps / 1000 + ' Gb/s' : p.speedMbps + ' Mb/s') : '';
        // Every port is recorded, patched or not: its VLAN, whether it is disabled, whether it has a link, its name if it has a real one, and PoE.
        const named = p.name && !/^(?:port\s*)?\d+$/i.test(String(p.name).trim()) ? String(p.name).trim() : '';
        const who = (p.connected || []).length ? 'Connected: ' + p.connected.join(', ') + (p.connectedCount > p.connected.length ? ' (+' + (p.connectedCount - p.connected.length) + ' more)' : '') : '';
        const peer = p.peer && p.peer.name ? p.peer : null;
        const bits = [named && 'Port name: ' + named, p.disabled ? 'Disabled in UniFi' : p.wan ? 'WAN' : p.up ? 'Link up' + (speed ? ' at ' + speed : '') : 'No link', p.poe, p.profile && !/^all$/i.test(p.profile) && !p.disabled ? 'Profile: ' + p.profile : '', peer ? 'Linked to ' + peer.name + (peer.port ? ' port ' + peer.port : '') : '', who].filter(Boolean);
        // A single named client on the port is a good label (a UniFi device on the other end is named as the port's device).
        const one = (p.connected || []).length === 1 && p.connectedCount === 1 ? String(p.connected[0]).replace(/\s*\([^)]*\)\s*$/, '') : '';
        const label = peer ? peer.name : /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(one) ? '' : one;
        const vid = p.vlan != null && Number.isFinite(+p.vlan) ? +p.vlan : null;
        return { section: cage ? 1 : 0, cage, n: p.n, device: label, peerDevice: !!peer, type: peer && peer.kind === 'ap' ? 'Access point' : peer && peer.kind === 'other' ? 'Other' : '', vid, vlanName: p.vlanName || '', tagged: p.tagged || '', patch: '', status: p.disabled ? 'Disabled' : p.up ? 'Active' : '', notes: bits.join(' · '), lead: '' };
      });
      const pd = { sheet: '', name: d.name, model: d.model, serial: d.serial, mac: d.mac, ip: d.ip, firmware: d.firmware, location: '', rackPos: '', upstream: d.uplink ? d.uplink + (d.uplinkPort ? ', port ' + d.uplinkPort : '') : '', surveyedOn: '', surveyedBy: '',
        type: d.kind === 'gateway' ? 'Gateway' : 'Switch', assetTag: '', log: [], ports, keepNotes: true, extraLines: unifiLines(d) };
      pd.where = { site: site ? site.name : siteName, floor: floor ? floor.name : '', room: room ? room.name : 'Main comms room', rack: rack ? rack.name : 'Main rack', u: null };
      plan.devices.push(pd);
    });

    // Access points and the other UniFi devices that have no ports of their own: added as devices on the switch port they hang from.
    plan.endpointFacts = {};
    (devs || []).filter((d) => d.kind !== 'switch' && d.kind !== 'gateway').forEach((d) => { plan.endpointFacts[d.name] = { ip: d.ip || '', mac: d.mac || '', serial: d.serial || '', model: d.model || '', lines: unifiLines(d) }; });

    // Protect devices and the other things on the network, found by their MAC among the clients: the camera on a switch port is named after its Protect name,
    // and a recorder is added with the switch and port it is on.
    const clientsByMac = {};
    (extra.clients || []).forEach((c) => { if (c.mac) clientsByMac[macKey(c.mac)] = c; });
    const planByMac = {};
    plan.devices.forEach((pd) => { if (pd.mac) planByMac[macKey(pd.mac)] = pd; });
    // Every port with exactly one wired client (a PC, a camera, a printer, ...) gets a device for it, cabled to that port and named after the client.
    // With no patch panel in the way its cable just heads for the top of the cable manager, as a cable to any end device does.
    const byPort = {};
    (extra.clients || []).forEach((c) => { if (c.wired === false || !c.swMac || !c.swPort) return; const k = macKey(c.swMac) + '|' + c.swPort; (byPort[k] = byPort[k] || []).push(c); });
    const kindOf = (c) => {
      const t = (c.oui || '') + ' ' + (c.name || '');
      if (/hikvision|dahua|axis comm|hanwha|reolink|vivotek|amcrest|uniview|camera|cctv|\bcam\b|\bipc\b/i.test(t)) return 'Camera';
      if (/printer|canon|brother|epson|xerox|ricoh|kyocera|lexmark|konica/i.test(t)) return 'Printer';
      if (/yealink|grandstream|polycom|snom|fanvil|\bphone\b|voip|sip-/i.test(t)) return 'Phone';
      if (/\btv\b|roku|chromecast|sonos|display|speaker|projector/i.test(t)) return 'Display';
      return 'Workstation';
    };
    plan.devices.forEach((pd) => {
      pd.ports.forEach((pp) => {
        const list = byPort[macKey(pd.mac) + '|' + pp.n];
        if (pp.peerDevice || !list || list.length !== 1) return;
        const c = list[0];
        const nm = c.name || c.ip || 'Client ' + macKey(c.mac).slice(-6);
        pp.device = nm; pp.type = kindOf(c); pp.factKey = nm + '|' + pd.name + '|' + pp.n;
        plan.endpointFacts[pp.factKey] = { ip: c.ip || '', mac: c.mac || '', model: c.oui || '', lines: [] };
      });
    });
    const PROTECT_TYPE = { camera: 'Camera', sensor: 'Sensor', light: 'IoT', chime: 'IoT', siren: 'IoT', speaker: 'Speaker', viewer: 'Display', bridge: 'IoT', relay: 'IoT', fob: 'IoT', 'link station': 'IoT', 'alarm hub': 'IoT' };
    const prot = (extra.protect && extra.protect.devices) || [];
    const nCams = prot.filter((p) => p.kind === 'camera').length;
    prot.forEach((p) => {
      const c = clientsByMac[macKey(p.mac)];
      const sw = c && c.swMac && planByMac[macKey(c.swMac)];
      const pp = sw && sw.ports.find((x) => x.n === c.swPort);
      if (!pp) return;
      if (p.kind === 'nvr') {
        plan.nvrs.push({ name: p.name || 'UniFi Protect', make: p.model || '', type: 'UniFi Protect', ip: c.ip || '', mac: p.mac, sw: sw.name, port: c.swPort, cams: String(nCams), notes: 'UniFi Protect ' + (extra.protect.version || '') });
        return;
      }
      pp.device = p.name || pp.device; pp.type = PROTECT_TYPE[p.kind] || 'IoT';
      pp.notes = [pp.notes, 'UniFi Protect ' + p.kind + (p.state ? ' (' + p.state.toLowerCase() + ')' : '')].filter(Boolean).join(' · ');
    });

    // The console's Wi-Fi networks, each tied to its VLAN (the older API knows the network of each one; the newer list adds the rest).
    const wl = ((extra.info && extra.info.wlans) || []);
    const wf = ((extra.info && extra.info.wifi) || []);
    const seen = new Set();
    wl.concat(wf).forEach((w) => {
      const k = String(w.name || '').toLowerCase(); if (!k || seen.has(k)) return; seen.add(k);
      // The newer list names the security exactly (WPA2_WPA3_PERSONAL, WPA2_ENTERPRISE, ...); the older one gives wpapsk / wpaeap and a WPA3 flag.
      const nw = wf.find((x) => String(x.name || '').toLowerCase() === k) || {};
      const raw = String(nw.security || '');
      const sec = /wpa2.*wpa3|wpa3.*wpa2/i.test(raw) ? 'WPA2/WPA3' : /wpa3.*enterprise/i.test(raw) ? 'WPA3 Enterprise' : /wpa3/i.test(raw) ? 'WPA3' : /enterprise/i.test(raw) ? 'WPA2 Enterprise' : /^open/i.test(raw) ? 'Open' : /wpa2/i.test(raw) ? 'WPA2'
        : /eap|enterprise/i.test((w.security || '') + (w.wpaMode || '')) ? 'WPA2 Enterprise' : w.wpa3 ? 'WPA2/WPA3' : /open|none/i.test(w.security || '') ? 'Open' : /wpa/i.test((w.security || '') + (w.wpaMode || '')) ? 'WPA2' : (w.security || '');
      const bandName = { '2g': '2.4 GHz', ng: '2.4 GHz', '5g': '5 GHz', na: '5 GHz', '6g': '6 GHz', '6e': '6 GHz' };
      plan.wifis = (plan.wifis || []).concat({ ssid: w.name, vid: w.vlan == null ? null : +w.vlan, security: sec, band: w.bands ? String(w.bands).split(/[,\s]+/).filter(Boolean).map((b) => bandName[b.toLowerCase()] || b).join(' / ') : '2.4 / 5 GHz', guest: !!w.guest, hidden: !!w.hidden, isolation: !!w.isolation, enabled: w.enabled !== false });
    });

    // What the console told us about the site as a whole, kept on the site for its UniFi page.
    if (extra.info || extra.consoleInfo || extra.protect) {
      const inf = extra.info || {};
      plan.unifi = { at: new Date().toISOString(), from: source, console: extra.consoleInfo || null, system: inf.system || null, wans: (inf.wans || []).map((w) => w.name).filter(Boolean), protect: extra.protect || null };
    }
    return plan;
  };

  /** Notes about a device from what the console reports: firmware update, how long it has been up, load, Wi-Fi radios, product line. */
  function unifiLines(d) {
    const out = [];
    const st = d.stats || {};
    const days = (sec) => { const n = Math.floor(sec / 86400); return n > 0 ? n + ' d ' + Math.floor((sec % 86400) / 3600) + ' h' : Math.floor(sec / 3600) + ' h ' + Math.floor((sec % 3600) / 60) + ' min'; };
    const bits = [d.state && 'Status: ' + d.state, d.firmwareUpdatable || (d.cloud && /true|yes|available/i.test(String(d.cloud.updateAvailable || ''))) ? 'A firmware update is available' : '',
      st.uptimeSec != null ? 'Up ' + days(st.uptimeSec) : '', st.cpuPct != null ? 'CPU ' + Math.round(st.cpuPct) + '%' : '', st.memoryPct != null ? 'Memory ' + Math.round(st.memoryPct) + '%' : ''].filter(Boolean);
    if (bits.length) out.push('UniFi: ' + bits.join(' · '));
    const c = d.cloud || {};
    const cl = [c.productLine && 'Product line ' + c.productLine, c.firmwareStatus && 'Firmware ' + c.firmwareStatus, (c.adoptionTime || d.adoptedAt) && 'Adopted ' + String(c.adoptionTime || d.adoptedAt).slice(0, 10), c.note && 'Note: ' + c.note].filter(Boolean);
    if (cl.length) out.push('Site Manager: ' + cl.join(' · '));
    if ((d.radios || []).length) out.push('Radios: ' + d.radios.map((r) => [r.ghz && r.ghz + ' GHz', r.channel && 'ch ' + r.channel, r.widthMHz && r.widthMHz + ' MHz', r.standard].filter(Boolean).join(' ')).join('; '));
    if ((d.lags || []).length) out.push('LAGs: ' + d.lags.length);
    return out;
  }

  const baseName = (v) => norm(v).replace(/\s*\((?:core|main)\)\s*$/, '').replace(/\s+(?:cabinet|comms room|comms|rack)$/, '').trim();
  /** The comms room (cabinet) a register location names; a gateway or a switch with no location goes to the core one. */
  function registerRoom(d, plan) {
    const cabs = plan.cabinets;
    const loc = String(d.location || '').trim();
    if (loc) {
      const c = cabs.find((x) => baseName(x.name) === baseName(loc) || baseName(x.label) === baseName(loc));
      return c || { label: loc, name: loc, core: false, num: null };
    }
    const core = cabs.find((x) => x.core) || cabs[0];
    if (core) return core;
    // No audit sheet: the room most of the other switches are in, else a main comms room.
    const counts = {};
    plan.devices.forEach((x) => { if (x.location) counts[x.location] = (counts[x.location] || 0) + 1; });
    const top = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    return top ? { label: top, name: top, core: false, num: null } : { label: 'Main comms room', name: 'Main comms room', core: true, num: null };
  }

  /** Where a device will go: site, optional floor, comms room, rack and U. */
  function whereFor(d, plan) {
    if (plan.site || plan.index.length || plan.cabinets.length) {
      const c = registerRoom(d, plan);
      const rack = /cabinet|rack/i.test(c.name) ? c.name : c.name + ' cabinet';
      const um = /\bu\s*(\d{1,2})\b/i.exec(String(d.rackPos || ''));
      return { site: plan.site ? plan.site.name : plan.siteHint || 'Imported site', floor: '', room: c.label, rack, u: um ? +um[1] : null, core: !!c.core };
    }
    const parts = String(d.location || '').split(/\s*(?:\/|›|>|\||,)\s*/).map((x) => x.trim()).filter(Boolean);
    const site = parts[0] || plan.siteHint || 'Imported site';
    // site / room / rack, or site / floor / room / rack (floors are optional).
    const floor = parts.length >= 4 ? parts[1] : '';
    let room = parts.length >= 4 ? parts[2] : parts.length >= 2 ? parts[1] : 'Main comms room';
    let rack = parts.length >= 4 ? parts[3] : parts.length === 3 ? parts[2] : '';
    let u = null;
    const rp = String(d.rackPos || '');
    const um = /\bu\s*(\d{1,2})\b/i.exec(rp) || /^\s*(\d{1,2})\s*$/.exec(rp);
    if (um) u = parseInt(um[1], 10);
    const rackFromPos = rp.replace(/\bu\s*\d{1,2}\b/i, '').replace(/^\s*\d{1,2}\s*$/, '').replace(/[\/,·\-–]+\s*$/, '').trim();
    if (rackFromPos) rack = rackFromPos;
    if (!rack) rack = 'Imported rack';
    return { site, floor, room, rack, u };
  }

  const same = (a, b) => norm(a) === norm(b);
  const DETAILS = '\n\n— Imported details —\n';

  function findOrAdd(list, pred, make) {
    let x = list.find(pred);
    if (!x) { x = make(); list.push(x); x._new = true; }
    return x;
  }

  /* ----- matching what a sheet names to the device library ----- */
  const INFRA = ['Switch', 'Gateway', 'Router', 'Firewall', 'NVR', 'Server', 'Storage'];
  const baseDevName = (v) => norm(v).replace(/\s*\([^)]*\)\s*$/, '').trim();
  const NOT_DATA = /^(Power|Console|USB)$/;

  /** The key of port number n on a device type: the port named n, else the n-th data port. */
  function portKey(tpl, num) {
    const ports = RB.portsOf(tpl).filter((p) => !p.twin && !NOT_DATA.test(p.type));
    const named = ports.find((p) => p.name === String(num));
    if (named) return named.key;
    // Else count along (24 RJ45 then "SFP 1" as port 25), unless that lands on another plainly numbered port.
    const p = ports[num - 1];
    return p && !/^\d+$/.test(p.name) ? p.key : null;
  }

  /** The library model a sheet names (UniFi and the rest), else a device type built from its port tables. */
  function templateFor(s, pd) {
    const model = String(pd.model || '').trim();
    const fits = (t) => pd.ports.every((p) => portKey(t, p.n));
    const lib = model && s.templates.filter((t) => same(t.model, model) || same(t.model, model.replace(/\s+/g, '-')));
    const hit = lib && (lib.find(fits) || null);
    if (hit) return hit;
    const kind = pd.type + ' ' + model + ' ' + pd.name;
    const cat = /gateway|\befg\b|\budm|\buxg|\bucg|router/i.test(kind) || /internet|\bwan\b/i.test(pd.upstream) ? 'Gateway' : /firewall/i.test(kind) ? 'Firewall' : 'Switch';
    const first = pd.ports.filter((p) => !p.section && !p.cage);
    const cages = pd.ports.filter((p) => p.section || p.cage);
    const rj = first.length ? Math.max(...first.map((p) => p.n)) : (cages.length ? 0 : Math.max(1, ...pd.ports.map((p) => p.n)));
    const cageType = (() => { const c = {}; cages.forEach((p) => { const t = p.cage || 'SFP+'; c[t] = (c[t] || 0) + 1; }); return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || 'SFP+'; })();
    const groups = [];
    if (rj) groups.push({ type: 'RJ45', count: rj, rows: rj > 12 ? 2 : 1, side: 'front', prefix: '', start: 1 });
    if (cages.length) { const lo = Math.min(...cages.map((p) => p.n)), hi = Math.max(...cages.map((p) => p.n)); groups.push({ type: cageType, count: hi - lo + 1, rows: hi - lo > 1 ? 2 : 1, side: 'front', prefix: '', start: lo }); }
    const total = groups.reduce((a, g) => a + g.count, 0);
    const name = (model || cat) + ' · ' + total + ' port' + (total === 1 ? '' : 's');
    const unifi = /^(usw|udm|uxg|efg|ucg|us-|unvr)/i.test(model);
    return findOrAdd(s.templates, (t) => same(t.name, name), () => ({
      id: RB.uid('tpl'), name, maker: unifi ? 'Ubiquiti' : '', model, category: cat, units: /flex|mini|lite-8/i.test(model) ? 0 : 1,
      color: unifi ? '#d4d4d8' : cat === 'Gateway' ? '#14532d' : '#1e3a8a', passthrough: false, groups: groups.concat([{ type: 'Power', count: 1, rows: 1, side: 'rear', prefix: 'PSU ', start: 1 }]),
    }));
  }

  function nvrTemplate(s, nv) {
    const k = nv.type + ' ' + nv.make + ' ' + nv.name;
    const id = /envr/i.test(k) ? 'tpl_ui_envr' : /unvr[\s-]*pro/i.test(nv.make + ' ' + nv.name) ? 'tpl_ui_unvrpro' : /unvr/i.test(k) ? 'tpl_ui_unvr' : 'tpl_nvr_3rd';
    return s.templates.find((t) => t.id === id) || s.templates.find((t) => t.category === 'NVR') ||
      findOrAdd(s.templates, (t) => t.id === 'tpl_nvr_3rd', () => RB.extraTemplates().find((t) => t.id === 'tpl_nvr_3rd'));
  }

  /** Device type → library endpoint, for what's plugged into a switch port. */
  const ENDPOINTS = [[/access point|\bwi-?fi\b|\bap\b/i, 'tpl_ap'], [/camera|cctv/i, 'tpl_cam'], [/nurse/i, 'tpl_nc_room'], [/phone|voip|sip|dect/i, 'tpl_phone'],
    [/printer|mfd|copier/i, 'tpl_prn'], [/workstation|\bpc\b|desktop|laptop|computer/i, 'tpl_pc'], [/door|access control|reader|intercom/i, 'tpl_ac_door'],
    [/building|bms|solar|hvac|lift/i, 'tpl_bms_ctl'], [/resident/i, 'tpl_res_dev'], [/iot|sensor/i, 'tpl_iot_dev'], [/display|\bav\b|\btv\b|screen|speaker/i, 'tpl_av_tv'], [/^other$/i, 'tpl_iot_dev']];
  function endpointTemplate(s, pp) {
    const hit = ENDPOINTS.find((e) => e[0].test(pp.type)) || (!pp.type && /\((?:pro|lr|lite|mesh|u6|u7)\d*\)/i.test(pp.device) ? [null, 'tpl_ap'] : null);
    if (!hit) return null;
    return s.templates.find((t) => t.id === hit[1]) || findOrAdd(s.templates, (t) => t.id === hit[1], () => RB.defaultTemplates().find((t) => t.id === hit[1]));
  }

  /** Apply a plan to the workspace in one undoable step. Returns counts. */
  RB.applySheetImport = function (plan, fileName) {
    const n = { vlansNew: 0, vlansUpdated: 0, devNew: 0, devUpdated: 0, ports: 0, cables: 0, nvrs: 0, endpoints: 0, warnings: [] };
    const now = new Date();
    const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    RB.store.commit('Imported ' + (fileName || 'a spreadsheet') + ' (' + plan.vlans.length + ' VLANs, ' + plan.devices.length + ' devices)', (s) => {
      const fresh = [];
      const vlanFor = (vid, name, lead) => {
        let v = s.vlans.find((x) => Number(x.vid) === vid);
        if (!v) {
          v = { id: RB.uid('vlan'), vid, name: name || 'VLAN ' + vid, subnet: '', notes: '', color: RB.leadHex(lead) || RB.CABLE_COLORS[s.vlans.length % RB.CABLE_COLORS.length] };
          s.vlans.push(v); n.vlansNew++;
        }
        return v;
      };
      // The VLAN numbers, names and colours are shared by every site; the subnets in this workbook belong to its site.
      const siteNets = [];
      plan.vlans.forEach((p) => {
        let v = s.vlans.find((x) => Number(x.vid) === p.vid);
        if (v) {
          if (!p.keepName) v.name = p.name || v.name;
          if (p.notes) v.notes = p.notes; else if (p.gateway && /^\s*gateway\b/i.test(v.notes || '')) v.notes = '';
          if (p.lead) { v.lead = p.lead; v.color = RB.leadHex(p.lead) || v.color; }
          n.vlansUpdated++;
        } else {
          v = { id: RB.uid('vlan'), vid: p.vid, name: p.name, subnet: '', notes: p.notes, lead: p.lead, color: RB.leadHex(p.lead) || RB.CABLE_COLORS[s.vlans.length % RB.CABLE_COLORS.length] };
          s.vlans.push(v);
          n.vlansNew++;
        }
        if (p.subnet || p.gateway || p.dhcp) siteNets.push([v, p.subnet, p.gateway, p.dhcp]);
      });

      const register = !!(plan.site || plan.index.length || plan.cabinets.length);
      const rackUnits = register ? 42 : 24;
      const blankDev = (extra) => Object.assign({ id: RB.uid('dev'), rackId: null, roomId: null, position: null, ip: '', serial: '', assetTag: '', mac: '', platform: '', purchaseDate: '', startDate: '', notes: '', photo: null, portMeta: {} }, extra);
      const roomSpots = {};
      const spotIn = (roomId) => { const i = roomSpots[roomId] = (roomSpots[roomId] == null ? s.devices.filter((d) => d.roomId === roomId).length : roomSpots[roomId] + 1); return { x: 6 + (i % 12) * 8, y: Math.min(94, 8 + Math.floor(i / 12) * 9) }; };

      /** Site › (floor) › comms room › rack for a planned location. */
      const placeFor = (w) => {
        const site = findOrAdd(s.sites, (x) => same(x.name, w.site), () => ({ id: RB.uid('site'), name: w.site, code: '', address: '', contact: '', notes: '' }));
        if (plan.site && same(plan.site.name, site.name)) { if (plan.site.code && !site.code) site.code = plan.site.code; if (plan.site.address && !site.address) site.address = plan.site.address; }
        const floor = w.floor ? findOrAdd(s.floors, (x) => x.siteId === site.id && same(x.name, w.floor), () => ({ id: RB.uid('floor'), siteId: site.id, name: w.floor })) : null;
        const room = findOrAdd(s.rooms, (x) => (floor ? x.floorId === floor.id : (RB.get.siteOfRoom(x) || {}).id === site.id) && same(x.name, w.room),
          () => ({ id: RB.uid('room'), siteId: site.id, floorId: floor ? floor.id : null, name: w.room, notes: w.core ? 'Core comms room.' : '', plan: null }));
        const rack = findOrAdd(s.racks, (x) => x.roomId === room.id && same(x.name, w.rack), () => ({ id: RB.uid('rack'), roomId: room.id, name: w.rack, units: rackUnits, numbering: 'bottom', notes: '', pos: { x: 50, y: 50 } }));
        return { site, room, rack };
      };
      /** A rack spot for a device of this height, growing or adding a rack when it's full. */
      const slotIn = (place, w, units, name) => {
        let rack = place.rack;
        let pos = w.u && RB.fits(rack.id, w.u, units) ? w.u : RB.findSpace(rack.id, units);
        if (pos == null && (rack._new || fresh.includes(rack.id)) && rack.units < 60) { rack.units = Math.min(60, rack.units + Math.max(6, units)); pos = RB.findSpace(rack.id, units); }
        if (pos == null) {
          const alt = w.rack + ' (2)';
          rack = findOrAdd(s.racks, (x) => x.roomId === place.room.id && same(x.name, alt), () => ({ id: RB.uid('rack'), roomId: place.room.id, name: alt, units: rackUnits, numbering: 'bottom', notes: '', pos: { x: 60, y: 50 } }));
          pos = RB.findSpace(rack.id, units);
          n.warnings.push(name + ' went into ' + alt + ' because ' + w.rack + ' was full.');
        }
        if (w.u && pos !== w.u) n.warnings.push(name + ' was placed at U' + pos + ' because U' + w.u + ' was taken.');
        if (rack._new) fresh.push(rack.id);
        return { rack, pos };
      };
      const imported = []; // [planned device, workspace device]

      plan.devices.forEach((pd) => {
        let dev = s.devices.find((d) => (pd.serial && d.serial && same(d.serial, pd.serial)) || same(d.name, pd.name));
        const existed = !!dev;
        if (dev) n.devUpdated++;
        else {
          const tpl = templateFor(s, pd);
          const units = RB.unitsOfTpl(tpl);
          const w = pd.where;
          const place = placeFor(w);
          if (units > 0) {
            const at = slotIn(place, w, units, pd.name);
            dev = blankDev({ templateId: tpl.id, name: pd.name, rackId: at.rack.id, position: at.pos });
          } else dev = blankDev({ templateId: tpl.id, name: pd.name, roomId: place.room.id, pos: spotIn(place.room.id) });
          s.devices.push(dev);
          n.devNew++;
        }
        imported.push([pd, dev]);
        if (pd.ip) dev.ip = pd.ip;
        if (pd.serial) dev.serial = pd.serial;
        if (pd.assetTag) dev.assetTag = pd.assetTag;
        if (pd.mac) dev.mac = pd.mac;
        if (pd.firmware) dev.platform = pd.firmware;
        const lines = ['From ' + (fileName || 'a spreadsheet') + (pd.sheet && pd.sheet !== pd.name ? ' (sheet "' + pd.sheet + '")' : '') + ' on ' + today];
        [['Model', pd.model], ['Upstream', pd.upstream], ['Location', pd.location], ['Rack / U', pd.rackPos]]
          .forEach((x) => { if (x[1]) lines.push(x[0] + ': ' + x[1]); });
        if (pd.surveyedOn || pd.surveyedBy) lines.push('Surveyed' + (pd.surveyedOn ? ' ' + pd.surveyedOn : '') + (pd.surveyedBy ? ' by ' + pd.surveyedBy : ''));
        if (pd.log.length) { lines.push('Change log:'); pd.log.forEach((e) => lines.push('• ' + [e.date, e.ports, e.change, e.by].filter(Boolean).join(' · '))); }
        // Replace an earlier imported block rather than stacking a new one under it.
        // A connector pull keeps a device's notes (its register's change log) and only fills in the facts.
        const own = String(dev.notes || '').split(DETAILS.trim())[0].trim();
        (pd.extraLines || []).forEach((l) => lines.push(l));
        if (!(pd.keepNotes && existed)) dev.notes = ((own ? own + DETAILS : DETAILS.trim() + '\n') + lines.join('\n'));
        else if ((pd.extraLines || []).length) {
          // A pull keeps the notes you typed, but the facts it reports (status, uptime, update, radios) are refreshed.
          const kept = String(dev.notes || '').split('\n').filter((l) => !/^(?:UniFi:|Site Manager:|Radios:|LAGs:)/.test(l));
          dev.notes = kept.join('\n').replace(/\s+$/, '') + (kept.length ? '\n' : '') + pd.extraLines.join('\n');
        }

        const dtpl = RB.get.template(dev.templateId) || {};
        pd.ports.forEach((pp) => {
          const key = portKey(dtpl, pp.n);
          if (!key) { n.warnings.push(pd.name + ' port ' + pp.n + ' doesn’t exist on its device type, so it was skipped.'); return; }
          const m = Object.assign({}, dev.portMeta[key]);
          const set = (k, v) => { if (v) m[k] = v; };
          // A connector pull names the port after what is on it only when no one has labelled it.
          if (pd.keepNotes) { if (pp.device && !m.label) m.label = pp.device; } else set('label', pp.device);
          if (pp.vid != null) m.vlan = vlanFor(pp.vid, pp.vlanName, pp.lead).id;
          set('type', pp.type); set('tagged', pp.tagged); set('patch', pp.patch); set('lead', pp.lead);
          if (pd.keepNotes) {
            // A connector pull is the truth about link, enabled and VLAN: a port that is no longer disabled or linked loses that mark, while a status someone set by hand (Spare, Reserved, Faulty) stays.
            if (pp.status) m.status = pp.status; else if (/^(disabled|active)$/i.test(m.status || '')) delete m.status;
            // Notes this pull wrote earlier are replaced; notes someone typed are kept.
            if (pp.notes && (!m.notes || /^(?:port name:|link up|no link|disabled in unifi|wan)/i.test(m.notes))) m.notes = pp.notes;
          } else { set('status', pp.status); set('notes', pp.notes); }
          if (Object.keys(m).length) { dev.portMeta[key] = m; n.ports++; }
        });
      });

      /* Cables: switch-to-switch uplinks, NVRs and (if asked) what's plugged into each port. */
      const free = (d, key) => key && !s.connections.some((c) => (c.a.d === d && c.a.p === key) || (c.b.d === d && c.b.p === key));
      const cableOf = (notes, lead) => ({ cable: /\bdac\b/i.test(notes) ? 'DAC' : /fibre|fiber|\bom[1-5]\b|\bos[12]\b|\b(?:lc|sc|st|fc|mtp|mpo)\b|\bsr\b|\blr\b/i.test(notes) ? 'OM4' : 'Cat6a', color: RB.leadHex(lead) || '#171717' });
      const link = (a, ak, b, bk, notes, lead, label) => {
        if (!free(a.id, ak) || !free(b.id, bk) || (a.id === b.id && ak === bk)) return false;
        s.connections.push(Object.assign({ id: RB.uid('con'), a: { d: a.id, p: ak }, b: { d: b.id, p: bk }, length: '', label: label || '' }, cableOf(notes, lead)));
        n.cables++;
        return true;
      };
      const byName = (name) => {
        const k = baseDevName(name);
        return k ? s.devices.find((d) => baseDevName(d.name) === k && INFRA.includes((RB.get.template(d.templateId) || {}).category)) || null : null;
      };
      const upstreamOf = (pd) => { const m = /^(.+?),?\s+port\s+(\d+)\s*$/i.exec(String(pd.upstream || '')); return m ? { name: m[1].trim(), n: +m[2] } : null; };
      imported.forEach(([pd, dev]) => {
        const tpl = RB.get.template(dev.templateId) || {};
        pd.ports.forEach((pp) => {
          const peer = pp.device && byName(pp.device);
          if (!peer || peer.id === dev.id) return;
          const ppd = (imported.find((x) => x[1].id === peer.id) || [])[0];
          const ptpl = RB.get.template(peer.templateId) || {};
          let pn = null;
          const up = upstreamOf(pd);
          if (up && byName(up.name) === peer) pn = up.n;
          const back = ppd && ppd.ports.find((x) => x.device && byName(x.device) === dev);
          if (pn == null && back) pn = back.n;
          const pup = ppd && upstreamOf(ppd);
          if (pn == null && pup && byName(pup.name) === dev && pup.n !== pp.n) return; // they name another port of ours
          if (pn == null) return;
          link(dev, portKey(tpl, pp.n), peer, portKey(ptpl, pn), pp.notes + ' ' + ((back && back.notes) || ''), pp.lead, pp.patch || 'Uplink ' + pd.name + ' ↔ ' + peer.name);
        });
        // An upstream named on the sheet but not on any of our ports: use the port marked Uplink.
        const up = upstreamOf(pd);
        const target = up && byName(up.name);
        if (target && target.id !== dev.id && !s.connections.some((c) => (c.a.d === dev.id && c.b.d === target.id) || (c.b.d === dev.id && c.a.d === target.id))) {
          const mine = pd.ports.find((x) => /uplink/i.test(x.notes)) || null;
          if (mine) link(dev, portKey(tpl, mine.n), target, portKey(RB.get.template(target.templateId) || {}, up.n), mine.notes, mine.lead, mine.patch || 'Uplink ' + pd.name + ' ↔ ' + target.name);
        }
      });

      plan.nvrs.forEach((nv) => {
        const sw = byName(nv.sw);
        let dev = s.devices.find((d) => same(d.name, nv.name) || (nv.mac && d.mac && same(d.mac, nv.mac)));
        if (!dev) {
          const tpl = nvrTemplate(s, nv);
          const swRack = sw && sw.rackId && s.racks.find((r) => r.id === sw.rackId);
          const roomId = swRack ? swRack.roomId : sw && sw.roomId;
          const units = RB.unitsOfTpl(tpl);
          const pos = swRack && units ? RB.findSpace(swRack.id, units) : null;
          if (pos != null) dev = blankDev({ templateId: tpl.id, name: nv.name, rackId: swRack.id, position: pos });
          else if (roomId) dev = blankDev({ templateId: tpl.id, name: nv.name, roomId, pos: spotIn(roomId) });
          else { n.warnings.push(nv.name + ' was left out: its switch ' + (nv.sw || '(none)') + ' isn’t in the workspace.'); return; }
          if (swRack && pos == null) n.warnings.push(nv.name + ' sits in the comms room, not the rack, because ' + swRack.name + ' had no ' + units + 'U free.');
          s.devices.push(dev);
          n.nvrs++;
        }
        if (nv.ip) dev.ip = nv.ip;
        if (nv.mac) dev.mac = nv.mac;
        const own = String(dev.notes || '').split(DETAILS.trim())[0].trim();
        const lines = [['NVR type', nv.type], ['Make / model', nv.make], ['Cameras assigned', nv.cams], ['Notes', nv.notes]].filter((x) => x[1]).map((x) => x[0] + ': ' + x[1]);
        dev.notes = (own ? own + DETAILS : DETAILS.trim() + '\n') + ['From ' + (fileName || 'a spreadsheet') + ' (CCTV & NVR) on ' + today].concat(lines).join('\n');
        if (sw && nv.port) {
          const stpl = RB.get.template(sw.templateId) || {};
          const sk = portKey(stpl, nv.port);
          const sp = RB.portsOf(stpl).find((p) => p.key === sk);
          const nports = RB.portsOf(RB.get.template(dev.templateId) || {}).filter((p) => !p.twin && !/Power|Console|USB/.test(p.type));
          const fibre = sp && /SFP|QSFP/.test(sp.type);
          const np = nports.find((p) => (fibre ? /SFP|QSFP/.test(p.type) : p.type === 'RJ45') && free(dev.id, p.key)) || nports.find((p) => free(dev.id, p.key));
          if (np) link(sw, sk, dev, np.key, fibre ? 'DAC' : '', '', (/nvr/i.test(nv.name) ? '' : 'NVR ') + nv.name);
        }
      });

      /* A UPS named on a switch port (APC Smart-UPS, its network card, or any UPS): put it in that switch's rack and cable its network port. */
      const UPS_RE = /\bups\b|smart-?ups|\bapc\b|\bsm[tx]\s?\d{3,4}|\bsrt\s?\d|\bnmc\b|\bap96\d\d|eaton|cyberpower/i;
      const upsTemplate = (text) => {
        const id = /bypass|\bsbp/i.test(text) ? null : /3000|3\s?kva|\b3k\b|smt3000|srt3000/i.test(text) ? 'tpl_apc_smt3000' : /1500|1\.5\s?kva|smt1500|srt1500/i.test(text) ? 'tpl_apc_smt1500' : /apc|smart-?ups|\bsm[tx]/i.test(text) ? 'tpl_apc_smt1500' : 'tpl_ups';
        if (!id) return null;
        return s.templates.find((t) => t.id === id) || findOrAdd(s.templates, (t) => t.id === id, () => RB.defaultTemplates().find((t) => t.id === id)) || s.templates.find((t) => t.category === 'Power' && /ups/i.test(t.name));
      };
      imported.forEach(([pd, sw]) => {
        const stpl = RB.get.template(sw.templateId) || {};
        pd.ports.forEach((pp) => {
          const text = [pp.device, pp.type, pp.notes].join(' ');
          if (!pp.device || !UPS_RE.test(text) || /^(spare|disabled)$/i.test(pp.status)) return;
          const sk = portKey(stpl, pp.n);
          if (!free(sw.id, sk)) return;
          const swRoom = RB.get.roomOfDevice(sw);
          let ups = s.devices.find((d) => same(d.name, pp.device) && /Power/.test((RB.get.template(d.templateId) || {}).category || '') && RB.get.roomOfDevice(d) === swRoom);
          if (!ups) {
            const tpl = upsTemplate(text);
            if (!tpl) return;
            const swRack = sw.rackId && s.racks.find((r) => r.id === sw.rackId);
            const roomId = swRack ? swRack.roomId : sw.roomId;
            const units = RB.unitsOfTpl(tpl);
            // A UPS sits low in the rack: take the lowest free space.
            let pos = null;
            if (swRack && units) { for (let u = 1; u + units - 1 <= swRack.units; u++) if (RB.fits(swRack.id, u, units)) { pos = u; break; } }
            if (pos != null) ups = blankDev({ templateId: tpl.id, name: pp.device, rackId: swRack.id, position: pos });
            else if (roomId) { ups = blankDev({ templateId: tpl.id, name: pp.device, roomId, pos: spotIn(roomId) }); if (swRack) n.warnings.push(pp.device + ' sits in the comms room, not the rack, because ' + swRack.name + ' had no ' + units + 'U free.'); }
            else return;
            ups.notes = 'Found on ' + pd.name + ' port ' + pp.n + ' in ' + (fileName || 'a spreadsheet') + ' on ' + today + '.' + (pp.notes ? ' ' + pp.notes : '');
            s.devices.push(ups); n.ups = (n.ups || 0) + 1;
          }
          const up = RB.portsOf(RB.get.template(ups.templateId) || {}).filter((p) => !p.twin && p.type === 'RJ45');
          const nk = (up.find((p) => /nmc|net/i.test(p.name) && free(ups.id, p.key)) || up.find((p) => free(ups.id, p.key)) || {}).key;
          if (nk) link(sw, sk, ups, nk, pp.notes, pp.lead, pp.patch || pp.device + ' network card');
        });
      });

      // The workbook's subnets become that site's IP ranges.
      if (siteNets.length) {
        const sid = (() => {
          const named = plan.site ? s.sites.find((x) => same(x.name, plan.site.name)) : plan.siteHint ? s.sites.find((x) => same(x.name, plan.siteHint)) : null;
          if (named) return named;
          const d = imported[0] && imported[0][1];
          return (d && RB.get.siteOfRoom(d.rackId ? RB.get.room((s.racks.find((r) => r.id === d.rackId) || {}).roomId) : RB.get.room(d.roomId))) || (s.sites.length === 1 ? s.sites[0] : null);
        })();
        siteNets.forEach(([v, subnet, gateway, dhcp]) => {
          const net = {}; if (subnet) net.subnet = subnet; if (gateway) net.gateway = gateway; if (dhcp) net.dhcp = dhcp;
          if (sid) { sid.nets = sid.nets || {}; sid.nets[v.id] = Object.assign({}, sid.nets[v.id], net); }
          else if (!v.subnet && subnet) v.subnet = subnet;
        });
        if (sid) n.netsSite = sid.name;
      }

      // Wi-Fi networks for the Wi-Fi VLANs (named after the VLAN until you type the real SSID). Ones you already have stay as they are.
      (plan.wlans || []).forEach((p) => {
        const v = s.vlans.find((x) => Number(x.vid) === p.vid);
        if (!v || s.wlans.some((w) => w.vlanId === v.id)) return;
        s.wlans.push({ id: RB.uid('wlan'), ssid: v.name, vlanId: v.id, security: /guest|byod/i.test(v.name + ' ' + (v.notes || '')) ? 'WPA2' : 'WPA2 Enterprise', band: '2.4 / 5 GHz', notes: 'From ' + (fileName || 'a spreadsheet') + ': check the SSID and security.' });
        n.wlans = (n.wlans || 0) + 1;
      });

      // The console's Wi-Fi networks (the SSID, security, band and VLAN); one you already have by that name keeps what you typed.
      (plan.wifis || []).forEach((w) => {
        const v = w.vid != null && s.vlans.find((x) => Number(x.vid) === w.vid);
        const own = s.sites.find((x) => same(x.name, plan.siteHint));
        if (s.wlans.some((x) => String(x.ssid).toLowerCase() === String(w.ssid).toLowerCase() && (!x.siteId || !own || x.siteId === own.id))) return;
        s.wlans.push({ id: RB.uid('wlan'), siteId: own ? own.id : '', ssid: w.ssid, vlanId: v ? v.id : '', security: w.security || '', band: w.band || '', notes: ['From ' + (fileName || 'a connector'), w.guest && 'Guest network', w.hidden && 'Hidden SSID', w.isolation && 'Client isolation', w.enabled === false && 'Turned off'].filter(Boolean).join(' · ') });
        n.wlans = (n.wlans || 0) + 1;
      });
      // What the console told us about the whole site (health, WAN, VPN, firewall, ...), shown on the site's page.
      if (plan.unifi) {
        const st = s.sites.find((x) => same(x.name, plan.siteHint));
        if (st) { st.unifi = plan.unifi; n.siteInfo = true; }
      }

      if (plan.addEndpoints) {
        imported.forEach(([pd, dev]) => {
          const rack = dev.rackId && s.racks.find((r) => r.id === dev.rackId);
          const roomId = rack ? rack.roomId : dev.roomId;
          if (!roomId) return;
          const tpl = RB.get.template(dev.templateId) || {};
          pd.ports.forEach((pp) => {
            if (!pp.device || byName(pp.device) || /^(spare|disabled)$/i.test(pp.status)) return;
            const et = endpointTemplate(s, pp);
            const sk = portKey(tpl, pp.n);
            // A port already cabled (an earlier import) keeps what it has; names like "SIP-T31G" repeat, so each port gets its own device.
            if (!et || !free(dev.id, sk)) return;
            const fact = (plan.endpointFacts || {})[pp.factKey || pp.device] || {};
            const ep = blankDev({ templateId: et.id, name: pp.device, roomId, pos: spotIn(roomId), ip: fact.ip || '', mac: fact.mac || '', serial: fact.serial || '',
              notes: ['On ' + pd.name + ' port ' + pp.n + (pp.patch ? ', patch point ' + pp.patch : '') + '.', fact.model && 'Model: ' + fact.model, (fact.lines || []).join('\n')].filter(Boolean).join('\n') });
            s.devices.push(ep); n.endpoints++;
            const ek = (RB.portsOf(et).find((p) => !p.twin && p.type === 'RJ45' && free(ep.id, p.key)) || {}).key;
            link(dev, sk, ep, ek, pp.notes, pp.lead, pp.patch);
          });
        });
      }
      ['sites', 'floors', 'rooms', 'racks', 'templates'].forEach((k) => s[k].forEach((x) => { delete x._new; }));
    });
    return n;
  };

  /* ---------- export: the same layout the importer reads ---------- */
  const PORTED = ['Switch', 'Gateway', 'Router', 'Firewall'];
  const leadOf = (v) => v.lead || Object.keys(RB.LEAD_COLOURS).find((k) => RB.LEAD_COLOURS[k] === String(v.color || '').toLowerCase()) || '';
  const fromNotes = (notes, label) => { const m = new RegExp('^' + label + ':\\s*(.+)$', 'mi').exec(String(notes || '')); return m ? m[1].trim() : ''; };
  const day = (ts) => { const d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

  function placeOf(d) {
    const rack = d.rackId && RB.get.rack(d.rackId);
    const room = RB.get.room(rack ? rack.roomId : d.roomId);
    const floor = room && room.floorId ? RB.get.floor(room.floorId) : null;
    const site = RB.get.siteOfRoom(room);
    return { rack, room, floor, site, path: [site, floor, room, rack].filter(Boolean).map((x) => x.name).join(' / ') };
  }

  /** Every VLAN, then one sheet per switch, router, firewall or documented device. */
  RB.buildWorkbook = function (onlyRackId) {
    const s = S();
    const stamp = 'Exported from ' + RB.APP_NAME + ' on ' + day(Date.now()) + '. Edit and import it again to update the workspace.';
    const vlanRows = [[{ v: 'VLAN reference', s: 'title' }], [s.workspace + (s.sites[0] ? ' | ' + s.sites[0].name : '')], [{ v: stamp, s: 'hint' }], [],
      ['VLAN ID', 'VLAN name', 'Subnet', 'Purpose / notes', 'Cable colour', '', 'Colour', 'Service - cable colour standard'].map((v) => (v ? { v, s: 'head' } : ''))];
    const vlans = s.vlans.slice().sort((a, b) => Number(a.vid) - Number(b.vid));
    const legend = {};
    vlans.forEach((v) => { const l = leadOf(v); if (l) (legend[l] = legend[l] || []).push(v.name); });
    const legendRows = Object.keys(legend).map((k) => [k, legend[k].join(', ')]);
    const expSite = (onlyRackId && RB.get.siteOfRoom(RB.get.room((RB.get.rack(onlyRackId) || {}).roomId))) || s.sites[0] || null;
    vlans.forEach((v, i) => vlanRows.push([Number(v.vid) || v.vid, v.name, RB.vlanNet(v, expSite).subnet || '', v.notes || '', leadOf(v), '', ...(legendRows[i] || [])]));
    legendRows.slice(vlans.length).forEach((l) => vlanRows.push(['', '', '', '', '', '', ...l]));
    const sheets = [{ name: 'VLAN reference', cols: [9, 26, 18, 38, 18, 3, 14, 40], rows: vlanRows }];

    s.devices.forEach((d) => {
      const tpl = RB.get.template(d.templateId);
      if (!tpl) return;
      const pl = placeOf(d);
      if (onlyRackId && (!pl.rack || pl.rack.id !== onlyRackId)) return;
      const meta = d.portMeta || {};
      if (!PORTED.includes(tpl.category) && !Object.keys(meta).length) return;
      const ports = RB.portsOf(tpl).filter((p) => !p.twin);
      const inUse = ports.filter((p) => RB.connOf(d.id, p.key) || (meta[p.key] && /^active$/i.test(meta[p.key].status || ''))).length;
      const rows = [[{ v: d.name, s: 'title' }], [s.workspace + (pl.site ? ' | ' + pl.site.name : '')], [{ v: stamp, s: 'hint' }], []];
      const pair = (a, b, c, e) => [{ v: a, s: 'bold' }, b, '', { v: c, s: 'bold' }, e];
      rows.push(pair((tpl.category === 'Switch' ? 'Switch' : 'Device') + ' name', d.name, 'Location (site / comms room / cabinet)', pl.path));
      rows.push(pair('Model', tpl.model || tpl.name, 'Rack / U position', pl.rack ? 'U' + d.position : ''));
      rows.push(pair('Serial number', d.serial || '', 'Upstream device / port', fromNotes(d.notes, 'Upstream')));
      rows.push(pair('MAC address', d.mac || fromNotes(d.notes, 'MAC address'), 'Ports in use (of ' + ports.length + ')', inUse));
      rows.push(pair('Management IP', d.ip || '', 'Device type', tpl.category));
      rows.push(pair('Firmware version', d.platform || fromNotes(d.notes, 'Firmware'), 'Asset tag', d.assetTag || ''));
      rows.push([]);
      rows.push([{ v: 'Port map (ports 1-' + ports.length + ')', s: 'bold' }]);
      rows.push(['Port', 'Device name', 'Device type', 'Native VLAN', 'VLAN name', 'Tagged VLANs', 'Patch point', 'Status', 'Notes', 'Cable colour', 'Connected to'].map((v) => ({ v, s: 'head' })));
      ports.forEach((p, i) => {
        const m = meta[p.key] || {};
        const v = m.vlan && s.vlans.find((x) => x.id === m.vlan);
        const conn = RB.connOf(d.id, p.key);
        const peer = conn && RB.peerOf(conn, d.id, p.key);
        const pd = peer && RB.get.device(peer.d);
        rows.push([i + 1, m.label || '', m.type || '', v ? Number(v.vid) || v.vid : '', v ? v.name : '', m.tagged || '', m.patch || '',
          m.status || '', m.notes || '', m.lead || '', pd ? pd.name + ' · ' + RB.portLabel(pd, peer.p) : '']);
      });
      const log = s.history.filter((h) => h.text && h.text.includes(d.name)).slice(0, 50);
      if (log.length) {
        rows.push([], [{ v: 'Change log (newest first)', s: 'bold' }], ['Date', 'Port(s)', 'Change made', 'Made by'].map((v) => ({ v, s: 'head' })));
        log.forEach((h) => rows.push([day(h.ts), '', h.text, '']));
      }
      sheets.push({ name: d.name, cols: [24, 24, 14, 32, 22, 13, 13, 10, 36, 12, 30], rows });
    });
    return sheets;
  };

  RB.exportWorkbook = function (onlyRackId) {
    const sheets = RB.buildWorkbook(onlyRackId);
    const rack = onlyRackId && RB.get.rack(onlyRackId);
    const blob = RB.writeXlsx(sheets);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = RB.slug(rack ? rack.name : S().workspace) + '-' + day(Date.now()) + '.xlsx';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
    RB.toast('Downloaded ' + sheets.length + ' sheet' + (sheets.length === 1 ? '' : 's') + ' (VLANs' + (sheets.length > 1 ? ' and ' + (sheets.length - 1) + ' device port map' + (sheets.length === 2 ? '' : 's') : '') + ')');
  };

  /* ---------- the import dialog ---------- */
  RB.openSheetImport = function () {
    const input = RB.html('<input type="file" accept=".xlsx,.csv,.docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/csv" hidden>');
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0];
      input.remove();
      if (f) RB.importSheetFile(f);
    });
    input.addEventListener('cancel', () => input.remove());
    input.click();
  };

  RB.importSheetFile = async function (file) {
    let plan;
    try { plan = RB.planSheetImport(await RB.readSheets(file)); }
    catch (err) { RB.toast(err.message || 'That file couldn’t be read.', 'error'); return; }
    if (!plan.vlans.length && !plan.devices.length && !plan.nvrs.length) {
      RB.modal.open({ title: 'Nothing to import', body: '<p class="intro">' + esc(RB.APP_NAME) + ' couldn’t find a VLAN table or a device sheet in <b>' + esc(file.name) + '</b>.</p><p class="hint">It looks for a table headed <b>VLAN ID</b> and <b>VLAN name</b>, or a sheet with <b>Switch name</b>, <b>Model</b> and a port table headed <b>Port</b> and <b>Device name</b>.</p>', actions: [{ label: 'OK', kind: 'primary', onClick: (m) => m.close() }] });
      return;
    }
    const st = S();
    const vNew = plan.vlans.filter((v) => !st.vlans.some((x) => Number(x.vid) === v.vid)).length;
    // Site › comms room › devices, in the order the rooms first appear (core first).
    const groups = [];
    plan.devices.forEach((d) => {
      const w = d.where;
      const key = [w.site, w.floor, w.room].join('|');
      let gr = groups.find((x) => x.key === key);
      if (!gr) { gr = { key, w, devs: [] }; groups.push(gr); }
      gr.devs.push(d);
    });
    groups.sort((a, b) => (b.w.core ? 1 : 0) - (a.w.core ? 1 : 0));
    const plugged = plan.devices.reduce((a, d) => a + d.ports.filter((p) => p.device && !/^(spare|disabled)$/i.test(p.status) && !plan.devices.some((x) => baseDevName(x.name) === baseDevName(p.device))).length, 0);
    const devRows = groups.map((gr) => '<tr class="imp-grp"><th colspan="3">' + RB.icon('room', 14) + ' ' + esc([gr.w.floor, gr.w.room].filter(Boolean).join(' › ')) + (gr.w.core ? ' <span class="tag">Core</span>' : '') + ' <small class="muted">' + esc(gr.devs[0].where.rack) + '</small></th></tr>' + gr.devs.map((d) => {
      const exists = st.devices.some((x) => (d.serial && x.serial && same(x.serial, d.serial)) || same(x.name, d.name));
      const active = d.ports.filter((p) => /active|up|in use/i.test(p.status)).length;
      return '<tr><td><b>' + esc(d.name) + '</b>' + (d.model ? '<br><small class="muted">' + esc(d.model) + '</small>' : '') + '</td><td>' + d.ports.length + (active ? ' <small class="muted">(' + active + ' active)</small>' : '') + '</td><td>' + (exists ? '<span class="tag">Update</span>' : 'New' + (d.ip ? ' · ' + esc(d.ip) : '')) + '</td></tr>';
    }).join('')).join('');
    const siteName = plan.site ? plan.site.name : (groups[0] && groups[0].w.site) || '';
    const siteLine = siteName ? '<div class="imp-site">' + RB.icon('site', 18) + '<span><b>' + esc(siteName) + '</b><small>' + esc([plan.site && plan.site.code, plan.site && plan.site.address].filter(Boolean).join(' · ') || 'Site') + ' · ' + groups.length + ' comms room' + (groups.length === 1 ? '' : 's') + (plan.nvrs.length ? ' · ' + plan.nvrs.length + ' NVR' + (plan.nvrs.length === 1 ? '' : 's') : '') + '</small></span>' + (st.sites.some((x) => same(x.name, siteName)) ? '<span class="tag">Already here: updated</span>' : '<span class="tag">New site</span>') + '</div>' : '';
    const vlanRows = plan.vlans.slice(0, 40).map((v) => '<tr><td>' + v.vid + '</td><td>' + esc(v.name) + '</td><td>' + esc(v.subnet) + '</td><td>' + (v.lead ? '<span class="lead-sw" style="background:' + esc(RB.leadHex(v.lead) || 'transparent') + '"></span>' + esc(v.lead) : '') + '</td></tr>').join('');
    const body = '<div class="imp">' +
      '<p class="intro">From <b>' + esc(file.name) + '</b>. Nothing changes until you press Import, and Undo takes it all back.</p>' + RB.checksHtml(RB.checkPlan(plan)) + siteLine +
      (plan.vlans.length ? '<h3 class="sub">' + plan.vlans.length + ' VLAN' + (plan.vlans.length === 1 ? '' : 's') + ' <small class="muted">' + vNew + ' new, ' + (plan.vlans.length - vNew) + ' updated</small></h3><div class="imp-tbl"><table class="tbl"><thead><tr><th>ID</th><th>Name</th><th>Subnet</th><th>Cable colour</th></tr></thead><tbody>' + vlanRows + '</tbody></table></div>' + (plan.vlans.length > 40 ? '<p class="hint">and ' + (plan.vlans.length - 40) + ' more</p>' : '') : '') +
      (plan.devices.length ? '<h3 class="sub">' + plan.devices.length + ' device' + (plan.devices.length === 1 ? '' : 's') + '</h3><div class="imp-tbl"><table class="tbl"><thead><tr><th>Device</th><th>Ports</th><th>Status</th></tr></thead><tbody>' + devRows + '</tbody></table></div><p class="hint">Switches and gateways use the matching UniFi model from the device library. Ports get their connected device, VLAN, tagged VLANs, patch point, status, notes and cable colour; uplinks between switches' + (plan.nvrs.length ? ' and the NVRs' : '') + ' are cabled. Survey details and the change log go into each device’s notes.</p>' +
        (plugged ? '<label class="check imp-opt"><input type="checkbox" name="eps"><span>Also add the ' + plugged + ' things plugged into the ports (access points, cameras, nurse call, phones…) to their comms room, cabled to the switch</span></label>' : '') : '') +
      (plan.wlans.length ? '<p class="hint"><b>Wi-Fi VLANs:</b> ' + plan.wlans.map((v) => v.vid + ' ' + esc(v.name)).join(', ') + '. Each gets a Wi-Fi network you can rename to its real SSID.</p>' : '') +
      (plan.skipped.length ? '<p class="hint">Not used: ' + plan.skipped.map(esc).join(', ') + ' (no VLAN table or device details found).</p>' : '') +
      '</div>';
    RB.modal.open({
      title: 'Import spreadsheet', body, wide: true,
      actions: [
        { label: 'Cancel', onClick: (m) => m.close() },
        { label: 'Import', kind: 'primary', onClick: (m) => {
          const box = m.el && m.el.querySelector ? m.el.querySelector('[name=eps]') : document.querySelector('.modal [name=eps]');
          plan.addEndpoints = !!(box && box.checked);
          const n = RB.applySheetImport(plan, file.name);
          m.close();
          const site = siteName && S().sites.find((x) => same(x.name, siteName));
          const first = plan.devices[0] && S().devices.find((d) => same(d.name, plan.devices[0].name));
          if (site) { RB.ui.expanded[site.id] = true; RB.navigate('site', site.id); } else if (first && first.rackId) RB.navigate('rack', first.rackId); else RB.render();
          RB.toast('Imported ' + [n.vlansNew + n.vlansUpdated && (n.vlansNew + n.vlansUpdated) + ' VLANs', n.devNew && n.devNew + ' new devices', n.devUpdated && n.devUpdated + ' updated', n.nvrs && n.nvrs + ' NVRs', n.ups && n.ups + ' UPS', n.netsSite && 'IP ranges for ' + n.netsSite, n.wlans && n.wlans + ' Wi-Fi networks',n.endpoints && n.endpoints + ' endpoints', n.cables && n.cables + ' cables', n.ports && n.ports + ' ports'].filter(Boolean).join(', '));
          if (n.warnings.length) setTimeout(() => RB.modal.open({ title: 'Imported, with notes', body: '<ul class="imp-warn">' + n.warnings.map((w) => '<li>' + esc(w) + '</li>').join('') + '</ul>', actions: [{ label: 'OK', kind: 'primary', onClick: (x) => x.close() }] }), 50);
        } },
      ],
    });
  };
})();
