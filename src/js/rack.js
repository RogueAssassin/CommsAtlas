/* CommsAtlas — drawing racks, device faceplates and patch cables. */
(function () {
  'use strict';
  const RB = window.RB;
  const esc = RB.esc;

  const TYPE_W = { RJ45: 1, SFP: 1.3, 'SFP+': 1.3, SFP28: 1.3, QSFP: 1.75, LC: 1.1, SC: 1.1, ST: 1.1, FC: 1.1, MTP: 1.7, Power: 1.3, Console: 1, USB: 0.8, Coax: 1 };

  RB.dims = function (zoom) {
    const z = zoom || 1;
    return { z, H: Math.round(26 * z * 10) / 10, rail: Math.round(30 * z), inner: Math.round(470 * z), cap: Math.round(14 * z), base: Math.round(26 * z), label: Math.round(96 * z), vcm: Math.round(34 * z) };
  };

  /** Port groups shown on one face. Returns [{type, rows, ports:[port...]}] */
  function groupsForFace(tpl, face) {
    const ports = RB.portsOf(tpl).filter((p) => p.side === face);
    const out = [];
    ports.forEach((p) => {
      const key = p.gi + (p.twin ? 't' : '');
      let grp = out.find((x) => x.key === key);
      if (!grp) {
        const def = tpl.groups[p.gi] || {};
        grp = { key, type: p.type, rows: Math.max(1, parseInt(def.rows, 10) || 1), ports: [] };
        out.push(grp);
      }
      grp.ports.push(p);
    });
    return out;
  }

  /**
   * Faceplate HTML for a template on one face, fitted into maxW × maxH pixels.
   * `dev` (optional) gives live state: connections, VLAN colours, trace highlight.
   */
  RB.faceplate = function (tpl, face, maxW, maxH, dev, opts) {
    const o = opts || {};
    const ui = RB.ui || {};
    const groups = groupsForFace(tpl, face);
    const screen = !!tpl.screen && face === 'front';       // the small UniFi-style display at the left-hand end
    if (!groups.length && !screen) return '<div class="fp fp--empty"></div>';
    let ps = Infinity;
    groups.forEach((g) => { ps = Math.min(ps, (maxH - 4 - (g.rows - 1) * 2) / g.rows); });
    ps = Math.max(4, Math.min(ps, 15 * (o.zoom || 1)));
    const gapFor = (s) => Math.max(1, Math.round(s * 0.18));
    const widthAt = (s) => groups.reduce((w, g) => {
      const cols = Math.ceil(g.ports.length / g.rows);
      return w + cols * (s * (TYPE_W[g.type] || 1) + gapFor(s)) + s * 0.7;
    }, 0) + (screen ? s * 2.6 : 0);
    const need = widthAt(ps);
    if (need > maxW) ps = Math.max(3, ps * (maxW / need));
    const gap = gapFor(ps);
    const trace = ui.traceSet;
    const fromDev = ui.patchFrom && RB.get.device(ui.patchFrom.d);
    const fromPort = fromDev && RB.portOf(fromDev, ui.patchFrom.p);
    let html = '<div class="fp' + (screen ? ' fp--screen' : '') + '" style="gap:' + (ps * 0.7).toFixed(1) + 'px">';
    // The screen is a part of the face, not a port: nothing to click, so it is never a button. It is small and sits at the left-hand end.
    if (screen) html += '<span class="fp-screen" style="width:' + (ps * 1.9).toFixed(1) + 'px;height:' + Math.max(4, Math.min(maxH - 8, ps * 1.1)).toFixed(1) + 'px" title="UniFi screen" aria-hidden="true"><i></i><i></i></span>';
    groups.forEach((g) => {
      const cols = Math.ceil(g.ports.length / g.rows);
      const w = ps * (TYPE_W[g.type] || 1);
      html += '<div class="fp-group" style="grid-template-columns:repeat(' + cols + ',' + w.toFixed(1) + 'px);grid-template-rows:repeat(' + g.rows + ',' + ps.toFixed(1) + 'px);gap:' + gap + 'px">';
      // Ports fill column by column (odd on top, even below), like most switches.
      g.ports.forEach((p, idx) => {
        const col = Math.floor(idx / g.rows) + 1;
        const row = (idx % g.rows) + 1;
        let cls = 'port port--' + p.type.replace('+', 'p');
        let style = 'grid-column:' + col + ';grid-row:' + row + ';';
        let title = p.name + (p.twin ? ' (rear)' : '') + ' · ' + p.type;
        if (dev) {
          const conn = RB.connOf(dev.id, p.key);
          const meta = dev.portMeta[p.key] || dev.portMeta[p.key.replace(/r$/, '')] || {};
          // A disabled (or faulty) port is blank: no VLAN colour, just the red cross.
          const off = !!(meta.status && /^(disabled|faulty)$/i.test(meta.status));
          if (conn) {
            cls += ' is-linked';
            style += '--c:' + RB.connColor(conn) + ';';
            const peer = RB.peerOf(conn, dev.id, p.key);
            const pd = RB.get.device(peer.d);
            title += ' → ' + (pd ? pd.name + ' / ' + RB.portLabel(pd, peer.p) : '?');
          }
          if (ui.colorBy === 'vlan') {
            // The port's own VLAN, or (patch panel and outlet ports) the VLAN of what the cable leads to.
            const v = RB.vlanOfPort(dev.id, p.key);
            if (v && !off) { cls += ' has-vlan'; style += '--v:' + v.color + ';'; title += ' · VLAN ' + v.vid + ' ' + v.name; }
          }
          if (ui.colorBy === 'lead') {
            // The port's own cable colour, else the cable colour its VLAN uses.
            const v = meta.vlan && RB.get.vlan(meta.vlan);
            const lead = meta.lead || (v && v.lead) || '';
            const hex = RB.leadHex ? RB.leadHex(lead) : '';
            if (hex && !off) { cls += ' has-vlan'; style += '--v:' + hex + ';'; title += ' · ' + lead + ' cable colour'; }
          }
          if (off) { cls += ' is-off'; title += ' · ' + meta.status; }
          if (meta.label) title += ' · ' + meta.label;
          if (trace && trace.has(dev.id + '|' + p.key)) cls += ' is-trace';
          if (ui.patchFrom && ui.patchFrom.d === dev.id && ui.patchFrom.p === p.key) cls += ' is-from';
          if (ui.portSel && ui.portSel.d === dev.id && ui.portSel.p === p.key) cls += ' is-sel';
          // While patching, ports the cable cannot go to are dimmed.
          if (fromPort && !(ui.patchFrom.d === dev.id && ui.patchFrom.p === p.key) && !RB.canLink(fromPort.type, p.type)) { cls += ' is-incompat'; title += ' · cannot connect to ' + fromPort.type; }
        }
        const tag = o.static ? 'span' : 'button';
        html += '<' + tag + (o.static ? '' : ' type="button"') + ' class="' + cls + '" style="' + style + '" data-d="' + (dev ? dev.id : '') + '" data-p="' + p.key + '" title="' + esc(title) + '" aria-label="' + esc(title) + '"></' + tag + '>';
      });
      html += '</div>';
    });
    return html + '</div>';
  };

  /** Light or dark text for a device colour. */
  RB.inkOn = function (hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#fff';
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? '#171717' : '#ffffff';
  };

  /**
   * Draw one rack. opts: {face, zoom, interactive, static}
   * Returns an element; call RB.drawCables(el) once it is in the page.
   */
  RB.renderRack = function (rack, opts) {
    const o = Object.assign({ face: 'front', zoom: 1, interactive: true }, opts || {});
    const D = RB.dims(o.zoom);
    const ui = RB.ui || {};
    const devices = RB.get.devicesInRack(rack.id);
    const bodyH = rack.units * D.H;
    const occupied = new Set();
    devices.forEach((d) => { for (let u = d.position; u < d.position + RB.unitsOf(d); u++) occupied.add(u); });

    let rails = '';
    for (let u = rack.units; u >= 1; u--) {
      const top = (rack.units - u) * D.H;
      rails += '<span class="rail-u" style="top:' + top + 'px;height:' + D.H + 'px">' + RB.uLabel(rack, u) + '</span>';
    }

    let slots = '';
    if (o.interactive) {
      for (let u = rack.units; u >= 1; u--) {
        if (occupied.has(u)) continue;
        const top = (rack.units - u) * D.H;
        slots += '<div class="slot" data-u="' + u + '" style="top:' + top + 'px;height:' + D.H + 'px">' +
          '<button type="button" class="slot-add" data-u="' + u + '" title="Add a device at U' + RB.uLabel(rack, u) + '" aria-label="Add a device at U' + RB.uLabel(rack, u) + '">' + RB.icon('plus', Math.max(10, Math.round(11 * o.zoom))) + '</button></div>';
      }
    } else {
      for (let u = rack.units; u >= 1; u--) {
        if (occupied.has(u)) continue;
        slots += '<div class="slot slot--static" style="top:' + (rack.units - u) * D.H + 'px;height:' + D.H + 'px"></div>';
      }
    }

    let devs = '';
    devices.forEach((d) => {
      const tpl = RB.get.template(d.templateId) || { color: '#999', groups: [], name: '?' };
      const units = RB.unitsOf(d);
      const top = (rack.units - (d.position + units - 1)) * D.H;
      const h = units * D.H - 1;
      const ink = RB.inkOn(tpl.color);
      const sel = ui.sel && ui.sel.type === 'device' && ui.sel.id === d.id;
      const labelW = D.label;
      const portsW = D.inner - labelW - Math.round(16 * o.zoom);
      const fs = Math.max(8, Math.min(12.5 * o.zoom, (h - 4) * 0.42));
      devs += '<div class="dev' + (sel ? ' is-sel' : '') + (tpl.category === 'Accessory' && !tpl.groups.length ? ' dev--plain' : '') + '" data-dev="' + d.id + '" tabindex="' + (o.interactive ? 0 : -1) + '" role="' + (o.interactive ? 'button' : 'img') + '" aria-label="' + esc(d.name + ', ' + tpl.name + ', U' + RB.uLabel(rack, d.position)) + '" style="top:' + top + 'px;height:' + h + 'px;--dc:' + tpl.color + ';color:' + ink + '">' +
        '<div class="dev-label" style="width:' + labelW + 'px;font-size:' + fs.toFixed(1) + 'px">' +
        '<span class="dev-name">' + esc(d.name) + '</span>' +
        (units > 1 || h > 30 ? '<span class="dev-model">' + esc(tpl.model || tpl.name) + '</span>' : '') + '</div>' +
        '<div class="dev-ports">' + RB.faceplate(tpl, o.face, portsW, h - 2, d, { zoom: o.zoom, static: !o.interactive }) + '</div>' +
        '</div>';
    });

    const vents = '<div class="rack-vent"></div>';
    const el = RB.html(
      '<div class="rack" data-rack="' + rack.id + '" style="--z:' + o.zoom + ';--vcm:' + D.vcm + 'px;width:' + (D.inner + D.rail * 2 + D.vcm * 2) + 'px">' +
      '<div class="vcm vcm--l" style="width:' + D.vcm + 'px" title="Vertical cable manager" aria-hidden="true"></div><div class="vcm vcm--r" style="width:' + D.vcm + 'px" title="Vertical cable manager" aria-hidden="true"></div>' +
      '<div class="rack-cap" style="height:' + D.cap + 'px"></div>' +
      '<div class="rack-mid" style="height:' + bodyH + 'px">' +
      '<div class="rail rail--l" style="width:' + D.rail + 'px">' + rails + '</div>' +
      '<div class="rack-body" style="width:' + D.inner + 'px;height:' + bodyH + 'px">' + slots + devs +
      '<div class="drop-ghost" hidden></div><svg class="cables" width="' + D.inner + '" height="' + bodyH + '"></svg></div>' +
      '<div class="rail rail--r" style="width:' + D.rail + 'px">' + rails + '</div>' +
      '</div>' +
      '<div class="rack-base" style="height:' + D.base + 'px">' + vents + '</div>' +
      '<div class="rack-face-tag">' + (o.face === 'rear' ? 'Rear' : 'Front') + '</div>' +
      '</div>'
    );
    el._opts = o;
    return el;
  };

  /**
   * Draw the patch cables of one rack. Each cable leaves its port sideways, runs to the vertical cable manager on that side of the
   * rack (outside the U numbers), goes up or down inside it, and comes back along the row of the other port. Which side: the one the
   * switch (or other active device) end is nearer to; for a cable that leaves the rack, the side of its port. Several cables in one
   * manager get lanes side by side so they never lie on top of each other. Cables between two ports of one device just hang in a loop.
   */
  RB.drawCables = function (rackEl) {
    const svg = rackEl && rackEl.querySelector('svg.cables');
    if (!svg) return;
    svg.innerHTML = '';
    const ui = RB.ui || {};
    if (ui.showCables === false) return;
    const body = rackEl.querySelector('.rack-body');
    const box = body.getBoundingClientRect();
    if (!box.width) return;
    const scale = box.width / body.offsetWidth || 1;
    const z = (rackEl._opts && rackEl._opts.zoom) || 1;
    const D = RB.dims(z);
    const W = body.offsetWidth;
    const portEls = {};
    rackEl.querySelectorAll('.port[data-d]').forEach((p) => { portEls[p.dataset.d + '|' + p.dataset.p] = p; });
    const pt = (el) => { const r = el.getBoundingClientRect(); return { x: (r.left + r.width / 2 - box.left) / scale, y: (r.top + r.height / 2 - box.top) / scale }; };
    const passes = (devId) => { const d = RB.get.device(devId); const t = d && RB.get.template(d.templateId); return !!(t && t.passthrough); };
    const topY = -D.cap + 3 * z;                       // where a cable that leaves the rack ends, at the top of its manager
    const done = new Set();
    const items = [];
    RB.store.state.connections.forEach((c) => {
      const pa = portEls[c.a.d + '|' + c.a.p], pb = portEls[c.b.d + '|' + c.b.p];
      if ((!pa && !pb) || done.has(c.id)) return;
      done.add(c.id);
      const A = pa ? pt(pa) : null, B = pb ? pt(pb) : null;
      const hot = !!(ui.traceSet && ui.traceSet.has(c.a.d + '|' + c.a.p) && ui.traceSet.has(c.b.d + '|' + c.b.p));
      const it = { c, A, B, hot, color: RB.connColor(c) };
      if (A && B && c.a.d === c.b.d) it.loop = true;
      else {
        // The end that comes from a switch (or other active device) decides the side.
        const src = A && B ? (!passes(c.a.d) ? A : !passes(c.b.d) ? B : A) : (A || B);
        it.src = src; it.side = src.x < W / 2 ? 'L' : 'R';
        it.y0 = Math.min(A ? A.y : topY, B ? B.y : topY); it.y1 = Math.max(A ? A.y : topY, B ? B.y : topY);
      }
      items.push(it);
    });

    // Lanes inside each manager: cables whose vertical runs overlap get different lanes.
    const count = { L: 1, R: 1 };
    ['L', 'R'].forEach((side) => {
      const mine = items.filter((x) => x.side === side).sort((p, q) => p.y0 - q.y0 || p.y1 - q.y1);
      const ends = [];
      mine.forEach((it) => {
        let lane = ends.findIndex((e) => e < it.y0 - 2 * z);
        if (lane < 0) { lane = ends.length; ends.push(0); }
        ends[lane] = it.y1; it.lane = lane;
      });
      count[side] = Math.max(1, ends.length);
    });
    // A busy rack needs a wider manager: about 1.3 px per cable at 100%, between the normal width and 90 px.
    const vcm = Math.round(RB.clamp(Math.max(count.L, count.R) * 1.3 * z + 8 * z, D.vcm, 90 * z));
    if (vcm !== D.vcm) {
      rackEl.style.setProperty('--vcm', vcm + 'px');
      rackEl.style.width = (D.inner + D.rail * 2 + vcm * 2) + 'px';
      rackEl.querySelectorAll('.vcm').forEach((v) => { v.style.width = vcm + 'px'; });
    }
    const ductW = vcm - 6 * z;
    let leadW = 1.7 * z;
    ['L', 'R'].forEach((side) => {
      const mine = items.filter((x) => x.side === side);
      const n = count[side];
      const gap = Math.max(0.5 * z, Math.min(3.6 * z, ductW / n));
      const span = gap * (n - 1);
      leadW = Math.min(leadW, Math.max(0.8 * z, gap * 1.15));
      // Lane 0 is the one nearest the rack, the rest fan outwards.
      mine.forEach((it) => {
        const inner = side === 'L' ? -D.rail - 3 * z - (ductW - span) / 2 : W + D.rail + 3 * z + (ductW - span) / 2;
        it.x = side === 'L' ? inner - it.lane * gap : inner + it.lane * gap;
      });
    });
    const R = 6 * z;
    const rounded = (pts) => {
      let d = 'M' + pts[0].x.toFixed(1) + ' ' + pts[0].y.toFixed(1);
      for (let i = 1; i < pts.length - 1; i++) {
        const p = pts[i - 1], c = pts[i], n = pts[i + 1];
        const l1 = Math.hypot(p.x - c.x, p.y - c.y), l2 = Math.hypot(n.x - c.x, n.y - c.y);
        if (!l1 || !l2) continue;
        const r = Math.min(R, l1 / 2, l2 / 2);
        const a = { x: c.x + (p.x - c.x) / l1 * r, y: c.y + (p.y - c.y) / l1 * r };
        const b = { x: c.x + (n.x - c.x) / l2 * r, y: c.y + (n.y - c.y) / l2 * r };
        d += ' L' + a.x.toFixed(1) + ' ' + a.y.toFixed(1) + ' Q' + c.x.toFixed(1) + ' ' + c.y.toFixed(1) + ' ' + b.x.toFixed(1) + ' ' + b.y.toFixed(1);
      }
      const e = pts[pts.length - 1];
      return d + ' L' + e.x.toFixed(1) + ' ' + e.y.toFixed(1);
    };
    let paths = '', dots = '';
    items.forEach((it) => {
      let d;
      if (it.loop) {
        const dy = Math.abs(it.B.y - it.A.y);
        const sag = dy < 6 * z ? Math.min(40 * z, 10 * z + Math.abs(it.B.x - it.A.x) * 0.15) : 0;
        const midY = dy < 6 * z ? Math.max(it.A.y, it.B.y) + sag : (it.A.y + it.B.y) / 2;
        d = 'M' + it.A.x.toFixed(1) + ' ' + it.A.y.toFixed(1) + ' C ' + it.A.x.toFixed(1) + ' ' + midY.toFixed(1) + ', ' + it.B.x.toFixed(1) + ' ' + midY.toFixed(1) + ', ' + it.B.x.toFixed(1) + ' ' + it.B.y.toFixed(1);
      } else if (it.A && it.B) {
        // Out of the first port, into the manager, along it, and back to the other port. The end that is not the switch end comes second.
        const first = it.src === it.A ? it.A : it.B, second = first === it.A ? it.B : it.A;
        d = rounded([first, { x: it.x, y: first.y }, { x: it.x, y: second.y }, second]);
      } else {
        const only = it.A || it.B;
        d = rounded([only, { x: it.x, y: only.y }, { x: it.x, y: topY }]);
        dots += '<circle cx="' + it.x.toFixed(1) + '" cy="' + topY.toFixed(1) + '" r="' + (1.7 * z).toFixed(1) + '" fill="' + esc(it.color) + '" class="cable-end"/>';
      }
      paths += '<path d="' + d + '" stroke="' + esc(it.color) + '" class="cable' + (it.hot ? ' is-hot' : '') + '" style="stroke-width:' + leadW.toFixed(2) + 'px"/>';
    });
    svg.innerHTML = paths + dots;
  };

  /** Small preview of a rack for overview cards. */
  RB.miniRack = function (rack) {
    const devices = RB.get.devicesInRack(rack.id);
    let bars = '';
    devices.forEach((d) => {
      const tpl = RB.get.template(d.templateId) || { color: '#999' };
      const u = RB.unitsOf(d);
      const top = ((rack.units - (d.position + u - 1)) / rack.units) * 100;
      bars += '<span style="top:' + top.toFixed(2) + '%;height:calc(' + ((u / rack.units) * 100).toFixed(2) + '% - 1px);background:' + tpl.color + '"></span>';
    });
    return '<div class="mini-rack" aria-hidden="true">' + bars + '</div>';
  };
})();
