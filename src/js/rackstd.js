/* CommsAtlas — rack standards: a standard layout for a rack (its size in U, then the patch panels and where they go),
   kept once and applied to any rack. A standard can be typed in, or read from an Excel / CSV / Word / PDF file or a picture. */
(function () {
  'use strict';
  const RB = window.RB;
  const esc = RB.esc;
  const S = () => RB.store.state;
  const list = () => (S().rackStandards = Array.isArray(S().rackStandards) ? S().rackStandards : []);

  /* Media a panel can carry: the port type it needs and the cable it is wired with. */
  const MEDIA = [
    { id: 'cat5e', label: 'Copper · Cat5e', port: 'RJ45', cable: 'Cat5e' },
    { id: 'cat6', label: 'Copper · Cat6', port: 'RJ45', cable: 'Cat6' },
    { id: 'cat6a', label: 'Copper · Cat6a', port: 'RJ45', cable: 'Cat6a' },
    { id: 'fibre-lc', label: 'Fibre · LC', port: 'LC', cable: 'OM4' },
    { id: 'fibre-sc', label: 'Fibre · SC (older)', port: 'SC', cable: 'OM4' },
    { id: 'fibre-st', label: 'Fibre · ST (older)', port: 'ST', cable: 'OM2' },
    { id: 'fibre-fc', label: 'Fibre · FC (older)', port: 'FC', cable: 'OS2' },
    { id: 'fibre-mtp', label: 'Fibre · MTP/MPO trunk', port: 'MTP', cable: 'OM4' },
  ];
  const mediaOf = (id) => MEDIA.find((m) => m.id === id) || MEDIA[1];
  const heightOf = (p) => Math.max(1, parseInt(p.height, 10) || (p.ports > 24 && mediaOf(p.media).port === 'RJ45' ? 2 : 1));
  const blankPanel = (o) => Object.assign({ id: RB.uid('pnl'), label: '', ports: 24, media: 'cat6', u: null, height: 0 }, o || {});
  const totalPorts = (s) => s.panels.reduce((a, p) => a + (Number(p.ports) || 0), 0);

  /* ---------- reading a standard out of a file ---------- */
  const norm = (c) => String(c == null ? '' : c).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const HEAD = {
    label: /^(patch ?panel|panel|panel name|label|name|pp|description|item|panel id)$/,
    ports: /^(ports?|port count|no of ports|number of ports|qty|quantity|size|ways|cores?)$/,
    media: /^(type|media|cable|category|cable type|connector|cat|panel type)$/,
    u: /^(u|pos|position|rack u|ru|slot|u position|start u|u start|location)$/,
    height: /^(height|panel height|units|height u|u height)$/,
    standard: /^(rack|standard|cabinet|template|rack name|rack standard)$/,
    size: /^(rack size|rack height|cabinet size|total u|rack u|size u)$/,
  };
  function mediaFrom(text) {
    const t = String(text || '').toLowerCase();
    if (/\bmtp\b|\bmpo\b/.test(t)) return 'fibre-mtp';
    if (/\bst\b/.test(t)) return 'fibre-st';
    if (/\bfc\b/.test(t)) return 'fibre-fc';
    if (/\bsc\b/.test(t)) return 'fibre-sc';
    if (/fib(er|re)|\blc\b|\bom[1-5]\b|\bos[12]\b|\bsm\b|\bmm\b/.test(t)) return 'fibre-lc';
    if (/cat ?6 ?a|cat6a|6a\b/.test(t)) return 'cat6a';
    if (/cat ?5|5e/.test(t)) return 'cat5e';
    if (/cat ?6|cat6|utp|rj ?45|copper/.test(t)) return 'cat6';
    return '';
  }
  const rackSizeIn = (text) => { const m = /(?:rack|cabinet|cab)[^0-9]{0,20}(\d{1,2})\s*-?\s*u\b|\b(\d{1,2})\s*-?\s*u\s*(?:rack|cabinet|cab)/i.exec(String(text || '')); const n = m ? parseInt(m[1] || m[2], 10) : 0; return n >= 2 && n <= 60 ? n : 0; };

  /** Standards found in rows of text (spreadsheet tables, Word tables, PDF lines, OCR lines). */
  function parseSheets(sheets, fallbackName) {
    const found = [];
    const globalSize = sheets.reduce((a, sh) => a || (sh.rows || []).slice(0, 12).reduce((b, r) => b || rackSizeIn((r || []).join(' ')), 0), 0);
    sheets.forEach((sheet) => {
      if (sheet.hidden) return;
      const rows = sheet.rows || [];
      let size = globalSize;
      rows.slice(0, 12).forEach((r) => { if (!size) size = rackSizeIn((r || []).join(' ')); });
      // A table with a header row naming a panel column and a ports column.
      let h = null;
      for (let r = 0; r < Math.min(rows.length, 40) && !h; r++) {
        const cols = {};
        (rows[r] || []).forEach((c, i) => { const n = norm(c); Object.keys(HEAD).forEach((k) => { if (cols[k] == null && HEAD[k].test(n)) cols[k] = i; }); });
        if (cols.label != null && (cols.ports != null || cols.media != null)) h = { r, cols };
      }
      const byName = new Map();
      const add = (name, p, sz) => {
        const key = name || fallbackName;
        if (!byName.has(key)) byName.set(key, { name: key, units: sz || size || 42, panels: [] });
        const st = byName.get(key); if (sz) st.units = sz; st.panels.push(p);
      };
      if (h) {
        for (let r = h.r + 1; r < rows.length; r++) {
          const row = rows[r] || []; const get = (k) => (h.cols[k] == null ? '' : String(row[h.cols[k]] == null ? '' : row[h.cols[k]]).trim());
          const label = get('label'); if (!label && !get('ports')) continue;
          if (/^total/i.test(label)) continue;
          const ports = parseInt(get('ports'), 10) || parseInt((/(\d{1,3})\s*-?\s*(?:port|way|core|fib)/i.exec(label) || [])[1], 10) || 24;
          const media = mediaFrom(get('media') + ' ' + label) || 'cat6';
          const u = parseInt(String(get('u')).replace(/\D/g, ''), 10) || null;
          add(get('standard'), blankPanel({ label: label || 'Patch panel', ports: Math.min(ports, 96), media, u, height: parseInt(get('height'), 10) || 0 }), parseInt(get('size'), 10) || 0);
        }
      } else {
        // Free text: any line that mentions a panel gets one.
        rows.forEach((row) => {
          const line = (row || []).join(' ').trim(); if (!line) return;
          if (!size) size = rackSizeIn(line);
          if (!/patch|panel|\bpp\s*-?\d|fib(er|re) (tray|box)|\bodf\b/i.test(line)) return;
          const noRack = line.replace(/(?:rack|cabinet)[^0-9]{0,20}\d{1,2}\s*-?\s*u\b/gi, '');
          const ports = parseInt((/(\d{1,3})\s*-?\s*(?:port|p\b|way|core|x\b|fib)/i.exec(noRack) || /\b(12|16|24|32|48|96)\b/.exec(noRack) || [])[1], 10) || 24;
          const um = /\bu\s*-?\s*(\d{1,2})\b/i.exec(noRack) || /\b(?:at|in|slot|pos(?:ition)?)\s*(\d{1,2})\b/i.exec(noRack);
          add('', blankPanel({ label: line.replace(/\s+/g, ' ').slice(0, 60), ports: Math.min(ports, 96), media: mediaFrom(line) || 'cat6', u: um ? parseInt(um[1], 10) : null }), size);
        });
      }
      byName.forEach((st) => found.push(st));
    });
    return found.filter((s) => s.panels.length);
  }

  /* ---------- the editor ---------- */
  function editor(draft, o) {
    return new Promise((resolve) => {
      const body = RB.html('<div class="rs"><div class="row2"><div class="field"><label for="rsName">Standard name</label><input id="rsName" name="name" value="' + esc(draft.name) + '" placeholder="e.g. Comms rack, 42U"></div>' +
        '<div class="field"><label for="rsU">Rack size (U)</label><input id="rsU" name="units" type="number" min="2" max="60" value="' + draft.units + '"></div></div>' +
        '<h3 class="sub">Patch panels, top of the rack first</h3><div class="rs-panels"></div>' +
        '<div class="btn-row"><button type="button" class="btn sm" data-a="add">' + RB.icon('plus') + ' Add a patch panel</button></div>' +
        '<p class="hint">Leave "U" empty to stack a panel in the next free space from the top. A panel with more than 24 copper ports takes 2U unless you set its height.</p>' +
        (o.note ? '<p class="hint warn">' + o.note + '</p>' : '') + '<p class="gate-err" role="alert" hidden></p></div>');
      const host = body.querySelector('.rs-panels'), err = body.querySelector('.gate-err');
      const say = (t) => { err.textContent = t || ''; err.hidden = !t; };
      const read = () => {
        draft.name = body.querySelector('[name=name]').value.trim();
        draft.units = RB.clamp(parseInt(body.querySelector('[name=units]').value, 10) || 42, 2, 60);
        draft.panels = Array.from(host.querySelectorAll('.rs-row')).map((r) => ({
          id: r.dataset.id, label: r.querySelector('[data-k=label]').value.trim(), ports: RB.clamp(parseInt(r.querySelector('[data-k=ports]').value, 10) || 0, 1, 96),
          media: r.querySelector('[data-k=media]').value, u: parseInt(r.querySelector('[data-k=u]').value, 10) || null, height: parseInt(r.querySelector('[data-k=height]').value, 10) || 0,
        }));
      };
      const draw = () => {
        host.innerHTML = draft.panels.length ? draft.panels.map((p) =>
          '<div class="rs-row" data-id="' + p.id + '"><label class="rs-l"><span>Name</span><input data-k="label" value="' + esc(p.label) + '" placeholder="e.g. PP1 Floor 1 data"></label>' +
          '<label><span>Media</span><select data-k="media">' + MEDIA.map((m) => '<option value="' + m.id + '"' + (m.id === p.media ? ' selected' : '') + '>' + esc(m.label) + '</option>').join('') + '</select></label>' +
          '<label><span>Ports</span><input data-k="ports" type="number" min="1" max="96" value="' + p.ports + '"></label>' +
          '<label><span>At U</span><input data-k="u" type="number" min="1" max="60" value="' + (p.u || '') + '" placeholder="auto"></label>' +
          '<label><span>Height</span><input data-k="height" type="number" min="1" max="4" value="' + (p.height || '') + '" placeholder="auto"></label>' +
          '<button type="button" class="icon-btn danger" data-del aria-label="Remove this panel">' + RB.icon('trash') + '</button></div>').join('') : '<p class="empty-note">No patch panels yet.</p>';
      };
      body.addEventListener('click', (e) => {
        if (e.target.closest('[data-a=add]')) { read(); draft.panels.push(blankPanel({ label: 'PP' + (draft.panels.length + 1) })); draw(); return; }
        const del = e.target.closest('[data-del]'); if (del) { read(); const id = del.closest('.rs-row').dataset.id; draft.panels = draft.panels.filter((p) => p.id !== id); draw(); }
      });
      draw();
      RB.modal.open({ title: o.title || 'Rack standard', body, wide: true, onClose: () => resolve(null), actions: [
        { label: 'Cancel', onClick: (x) => x.close() },
        { label: o.save || 'Save standard', kind: 'primary', onClick: (x) => {
          read();
          if (!draft.name) return say('Give the standard a name.');
          if (!draft.panels.length) return say('Add at least one patch panel.');
          if (draft.panels.some((p) => !p.label)) return say('Every patch panel needs a name.');
          const bad = checkFit(draft); if (bad) return say(bad);
          resolve(draft); x.close();
        } },
      ] });
    });
  }
  /** Gives each panel a start U (stacking from the top where none is set) and says what does not fit. */
  function layout(std) {
    const used = new Set(); const out = [];
    const take = (u, h) => { for (let i = 0; i < h; i++) used.add(u + i); };
    const free = (u, h) => { if (u < 1 || u + h - 1 > std.units) return false; for (let i = 0; i < h; i++) if (used.has(u + i)) return false; return true; };
    std.panels.filter((p) => p.u).forEach((p) => { const h = heightOf(p); if (free(p.u, h)) { take(p.u, h); out.push({ p, u: p.u, h }); } else out.push({ p, u: p.u, h, bad: true }); });
    std.panels.filter((p) => !p.u).forEach((p) => {
      const h = heightOf(p); let u = std.units - h + 1;
      while (u >= 1 && !free(u, h)) u--;
      if (u >= 1) { take(u, h); out.push({ p, u, h }); } else out.push({ p, u: 0, h, bad: true });
    });
    return out;
  }
  function checkFit(std) {
    const bad = layout(std).filter((x) => x.bad);
    return bad.length ? 'These panels do not fit in a ' + std.units + 'U rack, or overlap another: ' + bad.map((x) => x.p.label + (x.u ? ' (U' + x.u + ')' : '')).join(', ') + '.' : null;
  }

  /* ---------- applying a standard to a rack ---------- */
  function templateFor(s, p) {
    const md = mediaOf(p.media), h = heightOf(p);
    const total = (t) => (t.groups || []).reduce((a, g) => a + (Number(g.count) || 0), 0);
    let t = s.templates.find((x) => x.category === 'Patch panel' && total(x) === p.ports && (x.groups || []).every((g) => g.type === md.port) && RB.unitsOfTpl(x) === h);
    if (!t) {
      t = { id: RB.uid('tpl'), name: (md.port === 'RJ45' ? 'Patch panel ' : 'Fibre panel ') + p.ports + ' × ' + md.port, maker: 'Generic', model: (md.port === 'RJ45' ? 'PP-' : 'FP-') + p.ports + (md.port === 'RJ45' ? '' : md.port), category: 'Patch panel', units: h, color: md.port === 'RJ45' ? '#3f3f46' : '#334155', passthrough: true,
        groups: [{ type: md.port, count: p.ports, rows: h > 1 ? 2 : 1, side: 'front', prefix: '', start: 1 }] };
      s.templates.push(t);
    }
    return t;
  }
  function applyTo(std, rackId) {
    const rack = RB.get.rack(rackId); if (!rack) return null;
    const lay = layout(std); const result = { placed: 0, skipped: [] };
    RB.store.commit('Applied rack standard ' + std.name + ' to ' + rack.name, (s) => {
      const r = s.racks.find((x) => x.id === rackId);
      if (r.units < std.units) r.units = std.units; // the standard's rack size wins when the rack is smaller
      r.standardId = std.id;
      const unitsOf = (d) => { const t = s.templates.find((x) => x.id === d.templateId); return t ? RB.unitsOfTpl(t) : 0; };
      const taken = (a, b) => s.devices.some((d) => d.rackId === rackId && unitsOf(d) && d.position <= b && d.position + unitsOf(d) - 1 >= a);
      lay.forEach((x) => {
        if (x.bad) { result.skipped.push(x.p.label + ': does not fit'); return; }
        // The standard speaks in the U numbers painted on the rack; the records count from the bottom.
        const pos = r.numbering === 'top' ? r.units - (x.u + x.h - 1) + 1 : x.u;
        if (pos < 1 || pos + x.h - 1 > r.units || taken(pos, pos + x.h - 1)) { result.skipped.push(x.p.label + ': U' + x.u + ' is already used'); return; }
        const tpl = templateFor(s, x.p);
        s.devices.push({ id: RB.uid('dev'), templateId: tpl.id, name: x.p.label, rackId, roomId: null, position: pos, ip: '', serial: '', assetTag: '', purchaseDate: '', startDate: '', notes: 'From rack standard ' + std.name, photo: null, portMeta: {} });
        result.placed++;
      });
    });
    return result;
  }

  /* ---------- the screen ---------- */
  RB.openRackStandards = function () {
    const can = () => RB.auth.can('edit');
    const body = RB.html('<div class="rs-main"></div>');
    const draw = () => {
      const l = list();
      body.innerHTML = '<p class="intro">A rack standard says how every rack of a kind is set up: its size in U, then the patch panels and where they sit. Keep one standard and apply it to each new rack, so they all match.</p>' +
        (can() ? '<div class="btn-row" style="margin:0 0 12px"><button type="button" class="btn btn--primary sm" data-a="new">' + RB.icon('plus') + ' New standard</button><button type="button" class="btn sm" data-a="import">' + RB.icon('sheet') + ' Import from Excel, Word, PDF or a picture</button></div>' : '') +
        (l.length ? '<div class="rs-cards">' + l.map((s) => {
          const racks = S().racks.filter((r) => r.standardId === s.id);
          return '<div class="rs-card"><div class="rs-head"><b>' + esc(s.name) + '</b><span class="tag">' + s.units + 'U</span></div>' +
            '<p class="hint">' + s.panels.length + ' patch panel' + (s.panels.length === 1 ? '' : 's') + ' · ' + totalPorts(s) + ' ports' + (racks.length ? ' · used by ' + racks.length + ' rack' + (racks.length === 1 ? '' : 's') : '') + '</p>' +
            '<ul class="rs-sum">' + layout(s).sort((a, b) => b.u - a.u).map((x) => '<li' + (x.bad ? ' class="bad"' : '') + '><span>U' + (x.u || '?') + (x.h > 1 ? '–' + (x.u + x.h - 1) : '') + '</span>' + esc(x.p.label) + ' <small>' + x.p.ports + ' × ' + esc(mediaOf(x.p.media).label) + '</small></li>').join('') + '</ul>' +
            (can() ? '<div class="btn-row"><button type="button" class="btn sm btn--primary" data-a="apply" data-id="' + s.id + '">Apply to a rack…</button><button type="button" class="btn sm" data-a="edit" data-id="' + s.id + '">Edit</button><button type="button" class="btn sm btn--danger-ghost" data-a="del" data-id="' + s.id + '">Delete</button></div>' : '') + '</div>';
        }).join('') + '</div>' : '<div class="empty-card"><p>No rack standards yet.' + (can() ? ' Make one, or import one from a file or a picture.' : '') + '</p></div>');
    };
    const save = (std, isNew, label) => {
      RB.store.commit((isNew ? 'Added rack standard ' : 'Changed rack standard ') + label, (s) => {
        s.rackStandards = s.rackStandards || [];
        const i = s.rackStandards.findIndex((x) => x.id === std.id);
        if (i >= 0) s.rackStandards[i] = std; else s.rackStandards.push(std);
      });
      draw();
    };
    body.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      const a = b.dataset.a, std = list().find((x) => x.id === b.dataset.id);
      if (a === 'new') { const d = await editor({ id: RB.uid('rstd'), name: '', units: 42, panels: [blankPanel({ label: 'PP1' })] }, { title: 'New rack standard' }); if (d) save(d, true, d.name); }
      else if (a === 'edit' && std) { const d = await editor(JSON.parse(JSON.stringify(std)), { title: 'Edit rack standard' }); if (d) save(d, false, d.name); }
      else if (a === 'del' && std) { if (confirm('Delete the standard "' + std.name + '"? Racks keep the panels already placed in them.')) { RB.store.commit('Deleted rack standard ' + std.name, (s) => { s.rackStandards = (s.rackStandards || []).filter((x) => x.id !== std.id); s.racks.forEach((r) => { if (r.standardId === std.id) delete r.standardId; }); }); draw(); } }
      else if (a === 'apply' && std) applyDialog(std);
      else if (a === 'import') importFile(save);
    });
    draw();
    RB.modal.open({ title: 'Rack standards', body, wide: true, actions: [{ label: 'Done', kind: 'primary', onClick: (m) => m.close() }] });
  };

  function applyDialog(std) {
    const racks = S().racks;
    if (!racks.length) { RB.toast('Add a rack first, then apply the standard to it.', 'error'); return; }
    const body = RB.html('<div><p class="intro">Places the ' + std.panels.length + ' patch panels of <b>' + esc(std.name) + '</b> in the rack you choose. Spaces that are already used are skipped and listed afterwards.</p>' +
      '<div class="field"><label for="rsRack">Rack</label><select id="rsRack">' + racks.map((r) => '<option value="' + r.id + '">' + esc(r.name) + ' (' + r.units + 'U, ' + esc(RB.get.room(r.roomId) ? RB.get.pathOfRoom(RB.get.room(r.roomId)) : '') + ')</option>').join('') + '</select></div>' +
      (racks.some((r) => r.units < std.units) ? '<p class="hint">A rack smaller than ' + std.units + 'U is made ' + std.units + 'U.</p>' : '') + '</div>');
    RB.modal.open({ title: 'Apply ' + std.name, body, actions: [
      { label: 'Cancel', onClick: (m) => m.close() },
      { label: 'Apply', kind: 'primary', onClick: (m) => {
        const id = body.querySelector('#rsRack').value; const r = applyTo(std, id); m.close();
        if (!r) return;
        RB.toast('Placed ' + r.placed + ' patch panel' + (r.placed === 1 ? '' : 's') + (r.skipped.length ? ', skipped ' + r.skipped.length : ''), r.skipped.length ? 'error' : undefined);
        if (r.skipped.length) RB.modal.open({ title: 'Some panels were not placed', body: '<ul class="imp-warn">' + r.skipped.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>', actions: [{ label: 'OK', kind: 'primary', onClick: (x) => x.close() }] });
        RB.navigate('rack', id);
      } },
    ] });
  }

  function importFile(save) {
    const input = RB.html('<input type="file" accept=".xlsx,.csv,.docx,.pdf,image/*,application/pdf" hidden>');
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0]; input.remove(); if (!f) return;
      let found;
      try { found = parseSheets(await RB.readSheets(f), f.name.replace(/\.[^.]+$/, '')); }
      catch (e) { RB.toast(e.message || 'That file could not be read.', 'error'); return; }
      if (!found.length) { RB.modal.open({ title: 'No patch panels found', body: '<p class="intro">Nothing in <b>' + esc(f.name) + '</b> looked like a rack with patch panels.</p><p class="hint">Use a table with columns such as <b>Panel</b>, <b>Ports</b>, <b>Type</b> and <b>U</b>, or lines such as “PP1 24 port Cat6a at U40”. You can also make the standard by hand.</p>', actions: [{ label: 'OK', kind: 'primary', onClick: (m) => m.close() }] }); return; }
      const isPic = /\.(png|jpe?g|webp|bmp|gif)$/i.test(f.name) || /^image\//.test(f.type || '');
      for (const std of found) {
        std.id = RB.uid('rstd'); std.source = f.name;
        const d = await editor(std, { title: 'Check what was read: ' + std.name, save: 'Save standard', note: isPic ? 'Pictures are read by OCR and can be wrong. Check every name, port count and U number against the picture before saving.' : 'Read from ' + esc(f.name) + '. Check it, then save.' });
        if (d) save(d, true, d.name);
      }
    });
    input.click();
  }

  RB.rackStandardTools = { parseSheets, layout, applyTo };
})();
