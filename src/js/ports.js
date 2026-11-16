/* CommsAtlas — ports, connections, tracing and rack-space rules. */
(function () {
  'use strict';
  const RB = window.RB;
  const S = () => RB.store.state;

  /**
   * Every port of a template. Keys are stable per group and index: g{group}n{index}.
   * Pass-through devices (patch panels, outlets) also get a rear twin of each front
   * port with the key suffix "r", so a cable can land on the back of the same port.
   */
  RB.portsOf = function (tpl) {
    if (!tpl) return [];
    if (tpl._portsCache && tpl._portsCacheSig === JSON.stringify(tpl.groups) + tpl.passthrough) return tpl._portsCache;
    const out = [];
    (tpl.groups || []).forEach((grp, gi) => {
      const count = RB.clamp(parseInt(grp.count, 10) || 0, 0, 96);
      const start = parseInt(grp.start, 10);
      for (let i = 0; i < count; i++) {
        const n = (isNaN(start) ? 1 : start) + i;
        const name = (grp.prefix || '') + n;
        out.push({ key: 'g' + gi + 'n' + i, name, type: grp.type, side: grp.side === 'rear' ? 'rear' : 'front', gi, i });
        if (tpl.passthrough && grp.side !== 'rear') {
          out.push({ key: 'g' + gi + 'n' + i + 'r', name, type: grp.type, side: 'rear', gi, i, twin: true });
        }
      }
    });
    Object.defineProperty(tpl, '_portsCache', { value: out, writable: true, configurable: true, enumerable: false });
    Object.defineProperty(tpl, '_portsCacheSig', { value: JSON.stringify(tpl.groups) + tpl.passthrough, writable: true, configurable: true, enumerable: false });
    return out;
  };

  RB.devicePorts = (d) => RB.portsOf(RB.get.template(d && d.templateId));
  RB.portOf = (d, key) => RB.devicePorts(d).find((p) => p.key === key);

  /** Readable name of a port: "Port 5" or "5 (rear)". */
  RB.portLabel = function (d, key) {
    const p = RB.portOf(d, key);
    if (!p) return key;
    return p.name + (p.twin ? ' (rear)' : '');
  };

  RB.connOf = function (devId, key) {
    return S().connections.find((c) => (c.a.d === devId && c.a.p === key) || (c.b.d === devId && c.b.p === key));
  };

  RB.peerOf = function (conn, devId, key) {
    if (!conn) return null;
    return conn.a.d === devId && conn.a.p === key ? conn.b : conn.a;
  };

  RB.connsOfDevice = (devId) => S().connections.filter((c) => c.a.d === devId || c.b.d === devId);

  /** The other side of a pass-through port (front ↔ rear), or null. */
  RB.twinKey = function (d, key) {
    const tpl = RB.get.template(d.templateId);
    if (!tpl || !tpl.passthrough) return null;
    if (/r$/.test(key)) return key.slice(0, -1);
    const p = RB.portOf(d, key);
    return p && p.side === 'front' ? key + 'r' : null;
  };

  /**
   * Follow a cable path through patch panels and outlets in both directions.
   * Returns the hops in order, each {d, p} — from one end of the path to the other.
   */
  RB.trace = function (devId, key) {
    function walk(dId, k, seen) {
      const hops = [];
      let cur = { d: dId, p: k };
      for (let guard = 0; guard < 64; guard++) {
        const conn = RB.connOf(cur.d, cur.p);
        if (!conn) break;
        const peer = RB.peerOf(conn, cur.d, cur.p);
        const sig = peer.d + '|' + peer.p;
        if (seen.has(sig)) break;
        seen.add(sig);
        hops.push({ d: peer.d, p: peer.p, conn });
        const pd = RB.get.device(peer.d);
        const twin = pd && RB.twinKey(pd, peer.p);
        if (!twin) break;
        seen.add(peer.d + '|' + twin);
        hops.push({ d: peer.d, p: twin });
        cur = { d: peer.d, p: twin };
      }
      return hops;
    }
    const seen = new Set([devId + '|' + key]);
    const forward = walk(devId, key, seen);
    const d = RB.get.device(devId);
    const twin = d && RB.twinKey(d, key);
    let backward = [];
    if (twin) {
      seen.add(devId + '|' + twin);
      backward = [{ d: devId, p: twin }].concat(walk(devId, twin, seen));
    }
    return backward.reverse().concat([{ d: devId, p: key }], forward);
  };

  RB.traceText = function (hops) {
    const parts = [];
    hops.forEach((h, i) => {
      const d = RB.get.device(h.d);
      if (!d) return;
      const prev = hops[i - 1];
      if (prev && prev.d === h.d) parts[parts.length - 1] += ' ⇄ ' + RB.portLabel(d, h.p);
      else parts.push(d.name + ' / ' + RB.portLabel(d, h.p));
    });
    return parts.join('  →  ');
  };

  /* ---------- what may be connected to what ---------- */
  const CAGES = ['SFP', 'SFP+', 'SFP28', 'QSFP'];
  const isFibre = (t) => RB.FIBRE_TYPES.includes(t);
  /**
   * A port only takes a cable that matches it: RJ45 to RJ45, power to power, any of SFP, SFP+ and SFP28 to any other of them (one cage size, links at the slower speed), QSFP to QSFP,
   * USB to USB, console to console, coax to coax. Fibre is the one place where cables change shape: a fibre connector port
   * (LC, SC, ST, FC) on a patch panel takes a cable from an SFP, SFP+ or SFP28 cage or from any other fibre connector (hybrid
   * cables such as LC to SC), and MTP/MPO takes QSFP or MTP/MPO.
   */
  RB.canLink = function (ta, tb) {
    if (ta === tb) return true;
    const cage = (t) => CAGES.includes(t);
    // SFP, SFP+ and SFP28 share one cage size, so a module or DAC pair between them links (at the slower speed).
    const sfp = (t) => t === 'SFP' || t === 'SFP+' || t === 'SFP28';
    if (sfp(ta) && sfp(tb)) return true;
    if (isFibre(ta) && isFibre(tb)) return ta === 'MTP' || tb === 'MTP' ? ta === tb : true;
    if (cage(ta) && isFibre(tb)) return ta === 'QSFP' ? tb === 'MTP' : tb !== 'MTP';
    if (cage(tb) && isFibre(ta)) return tb === 'QSFP' ? ta === 'MTP' : ta !== 'MTP';
    return false;
  };
  /** Ports of `d2` that a cable from port `pa` (type) can reach. */
  RB.linkablePorts = (type, ports) => ports.filter((p) => RB.canLink(type, p.type));
  /** The reason two ports cannot be joined, or '' if they can. */
  RB.linkProblem = function (a, b) {
    const da = RB.get.device(a.d), db = RB.get.device(b.d);
    const pa = da && RB.portOf(da, a.p), pb = db && RB.portOf(db, b.p);
    if (!pa || !pb || RB.canLink(pa.type, pb.type)) return '';
    const allowed = pa.type === 'Power' ? 'power' : pa.type === 'QSFP' ? 'QSFP (or MTP panel)' : CAGES.includes(pa.type) ? 'SFP, SFP+ or SFP28 (or fibre panel)' : isFibre(pa.type) ? 'fibre or SFP' : pa.type;
    return pa.type + ' ports only connect to ' + allowed + ' ports, not ' + pb.type + '.';
  };

  /* ---------- VLAN of a port, and the colour that follows from it ---------- */
  let vlanMemo = new Map();
  RB.resetVlanMemo = () => { vlanMemo = new Map(); };
  const ownVlan = (d, key) => { const m = d.portMeta || {}; const meta = m[key] || m[key.replace(/r$/, '')] || {}; return meta.vlan || ''; };
  /**
   * The VLAN a port carries: the one set on the port, or, for a patch panel or outlet port with none, the VLAN of whatever is on the
   * other end of the cable run (followed through every panel on the way). Returns the VLAN or null.
   */
  RB.vlanOfPort = function (devId, key) {
    const id = devId + '|' + key;
    if (vlanMemo.has(id)) return vlanMemo.get(id);
    let found = null;
    const d = RB.get.device(devId);
    const own = d ? ownVlan(d, key) : '';
    if (own) found = RB.get.vlan(own) || null;
    else if (d && RB.connOf(devId, key)) {
      const hops = RB.trace(devId, key);
      for (const h of hops) {
        const hd = RB.get.device(h.d);
        const v = hd ? ownVlan(hd, h.p) : '';
        if (v && RB.get.vlan(v)) { found = RB.get.vlan(v); break; }
      }
    }
    vlanMemo.set(id, found);
    return found;
  };
  /** A cable's colour: the VLAN colour of its ports, unless someone set the colour by hand (conn.manual). */
  RB.connColor = function (c) {
    if (!c) return '#2563eb';
    if (!c.manual) {
      const v = RB.vlanOfPort(c.a.d, c.a.p) || RB.vlanOfPort(c.b.d, c.b.p);
      if (v && v.color) return v.color;
    }
    return c.color || '#2563eb';
  };

  /* ---------- connecting ---------- */
  RB.connect = function (a, b, opts) {
    if (a.d === b.d && a.p === b.p) { RB.toast('Pick two different ports.', 'error'); return false; }
    const bad = RB.linkProblem(a, b);
    if (bad) { RB.toast(bad, 'error'); return false; }
    if (RB.connOf(a.d, a.p) || RB.connOf(b.d, b.p)) { RB.toast('One of those ports is already in use. Disconnect it first.', 'error'); return false; }
    const da = RB.get.device(a.d), db = RB.get.device(b.d);
    if (!da || !db) return false;
    const o = opts || {};
    return RB.store.commit('Connected ' + da.name + ' / ' + RB.portLabel(da, a.p) + ' to ' + db.name + ' / ' + RB.portLabel(db, b.p), (s) => {
      s.connections.push({
        id: RB.uid('con'), a: { d: a.d, p: a.p }, b: { d: b.d, p: b.p },
        cable: o.cable || 'Cat6', color: o.color || RB.suggestColor(), manual: !!o.manual, length: o.length || '', label: o.label || '',
      });
    });
  };

  RB.disconnect = function (connId) {
    const c = S().connections.find((x) => x.id === connId);
    if (!c) return;
    const da = RB.get.device(c.a.d), db = RB.get.device(c.b.d);
    RB.store.commit('Disconnected ' + (da ? da.name : '?') + ' / ' + RB.portLabel(da, c.a.p) + ' from ' + (db ? db.name : '?') + ' / ' + RB.portLabel(db, c.b.p), (s) => {
      s.connections = s.connections.filter((x) => x.id !== connId);
    });
  };

  let lastColor = '#2563eb';
  RB.suggestColor = () => lastColor;
  RB.rememberColor = (c) => { if (c) lastColor = c; };

  /* ---------- rack space ---------- */
  RB.unitsOf = (d) => { const t = RB.get.template(d.templateId); return t ? Math.max(0, parseInt(t.units, 10) || 0) : 1; };

  /** Can `units` rack units start at U `pos` (bottom U) in the rack, ignoring device `ignoreId`? */
  RB.fits = function (rackId, pos, units, ignoreId) {
    const rack = RB.get.rack(rackId);
    if (!rack || units < 1) return false;
    if (pos < 1 || pos + units - 1 > rack.units) return false;
    const top = pos + units - 1;
    return !RB.get.devicesInRack(rackId).some((d) => {
      if (d.id === ignoreId) return false;
      const dTop = d.position + RB.unitsOf(d) - 1;
      return !(top < d.position || pos > dTop);
    });
  };

  /** Lowest free start U for a device of the given height (searching from the top down). */
  RB.findSpace = function (rackId, units, preferTop) {
    const rack = RB.get.rack(rackId);
    if (!rack) return null;
    if (preferTop !== false) {
      for (let u = rack.units - units + 1; u >= 1; u--) if (RB.fits(rackId, u, units)) return u;
    } else {
      for (let u = 1; u <= rack.units - units + 1; u++) if (RB.fits(rackId, u, units)) return u;
    }
    return null;
  };

  RB.occupancy = function (rackId) {
    const rack = RB.get.rack(rackId);
    if (!rack) return { used: 0, free: 0, total: 0 };
    const used = RB.get.devicesInRack(rackId).reduce((n, d) => n + RB.unitsOf(d), 0);
    return { used, free: Math.max(0, rack.units - used), total: rack.units };
  };

  RB.uLabel = function (rack, u) {
    return rack.numbering === 'top' ? rack.units - u + 1 : u;
  };

  /** Next free name like "SW-02" based on existing names with the same stem. */
  RB.nextName = function (base) {
    const names = new Set(S().devices.map((d) => d.name));
    if (!names.has(base)) return base;
    for (let i = 2; i < 999; i++) { const n = base + ' ' + i; if (!names.has(n)) return n; }
    return base + ' ' + Date.now();
  };

  /** Remove connections whose ports no longer exist (after a template edit). */
  RB.pruneConnections = function (s) {
    s.connections = s.connections.filter((c) => {
      const da = s.devices.find((d) => d.id === c.a.d), db = s.devices.find((d) => d.id === c.b.d);
      if (!da || !db) return false;
      const ka = RB.portsOf(s.templates.find((t) => t.id === da.templateId)).some((p) => p.key === c.a.p);
      const kb = RB.portsOf(s.templates.find((t) => t.id === db.templateId)).some((p) => p.key === c.b.p);
      return ka && kb;
    });
  };
})();
