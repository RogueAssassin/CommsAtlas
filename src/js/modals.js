/* CommsAtlas — dialogs: forms, confirmations, device builder, VLANs, connections, data and printing. */
(function () {
  'use strict';
  const RB = window.RB;
  const esc = RB.esc;
  const S = () => RB.store.state;

  /* ---------- base dialog ---------- */
  const stack = [];
  function open(o) {
    const el = RB.html(
      '<div class="modal-wrap" role="presentation"><div class="modal' + (o.wide ? ' modal--wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(o.title) + '">' +
      '<div class="modal-head"><h2>' + esc(o.title) + '</h2><button type="button" class="icon-btn" data-close aria-label="Close">' + RB.icon('close', 18) + '</button></div>' +
      '<div class="modal-body"></div><div class="modal-foot"></div></div></div>'
    );
    const body = el.querySelector('.modal-body');
    if (typeof o.body === 'string') body.innerHTML = o.body; else if (o.body) body.appendChild(o.body);
    const foot = el.querySelector('.modal-foot');
    (o.actions || []).forEach((a) => {
      const b = RB.html('<button type="button" class="btn ' + (a.kind ? 'btn--' + a.kind : '') + '">' + esc(a.label) + '</button>');
      b.addEventListener('click', () => a.onClick && a.onClick(api));
      if (a.left) b.classList.add('push-left');
      foot.appendChild(b);
    });
    if (!(o.actions || []).length) foot.remove();
    const prevFocus = document.activeElement;
    const api = {
      el, body,
      close() {
        if (!el.isConnected) return;
        el.remove();
        const i = stack.indexOf(api); if (i >= 0) stack.splice(i, 1);
        if (o.onClose) o.onClose();
        if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) { /* ignore */ }
      },
    };
    // Clicking the dark area outside a dialog closes it, but never by accident: the press and the release must both be on that area
    // (not on a scroll bar, not a drag that started inside the dialog), and never while something has been typed into a field.
    let downOnBackdrop = false;
    const onBackdrop = (e) => e.target === el && e.offsetX < el.clientWidth && e.offsetY < el.clientHeight;
    const dirty = () => [...el.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea')].some((f) => f.value !== f.defaultValue);
    el.addEventListener('mousedown', (e) => { downOnBackdrop = onBackdrop(e); });
    el.addEventListener('click', (e) => { if (downOnBackdrop && onBackdrop(e) && !o.sticky && !dirty()) api.close(); downOnBackdrop = false; });
    el.querySelector('[data-close]').addEventListener('click', () => api.close());
    document.body.appendChild(el);
    stack.push(api);
    setTimeout(() => {
      const f = el.querySelector('[autofocus], input:not([type=hidden]):not([type=checkbox]), select, textarea, .btn--primary');
      if (f) f.focus();
    }, 20);
    return api;
  }
  RB.modal = { open, top: () => stack[stack.length - 1], closeTop() { const t = stack[stack.length - 1]; if (t) { t.close(); return true; } return false; } };

  function fieldHtml(f) {
    const id = 'f_' + f.name;
    const v = f.value == null ? '' : f.value;
    let input;
    if (f.type === 'select') {
      input = '<select id="' + id + '" name="' + f.name + '">' + f.options.map((op) => '<option value="' + esc(op.value) + '"' + (String(op.value) === String(v) ? ' selected' : '') + '>' + esc(op.label) + '</option>').join('') + '</select>';
    } else if (f.type === 'textarea') {
      input = '<textarea id="' + id + '" name="' + f.name + '" rows="' + (f.rows || 3) + '">' + esc(v) + '</textarea>';
    } else if (f.type === 'checkbox') {
      return '<label class="check"><input type="checkbox" id="' + id + '" name="' + f.name + '"' + (v ? ' checked' : '') + '> <span>' + esc(f.label) + '</span></label>' + (f.hint ? '<p class="hint">' + esc(f.hint) + '</p>' : '');
    } else if (f.type === 'color') {
      input = '<div class="swatches">' + RB.CABLE_COLORS.map((c) => '<button type="button" class="swatch' + (c === v ? ' is-on' : '') + '" data-color="' + c + '" style="background:' + c + '" aria-label="Colour ' + c + '"></button>').join('') +
        '<input type="color" id="' + id + '" name="' + f.name + '" value="' + esc(v || '#2563eb') + '" aria-label="Custom colour"></div>';
    } else {
      input = '<input id="' + id + '" name="' + f.name + '" type="' + (f.type || 'text') + '" value="' + esc(v) + '"' +
         (f.step ? ' step="' + f.step + '"' : '') + (f.min != null ? ' min="' + f.min + '"' : '') + (f.max != null ? ' max="' + f.max + '"' : '') +
        (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '') + (f.required ? ' required' : '') + (f.list ? ' list="' + id + '_l"' : '') + '>' +
        (f.list ? '<datalist id="' + id + '_l">' + f.list.map((x) => '<option value="' + esc(x) + '">').join('') + '</datalist>' : '');
    }
    return '<div class="field' + (f.half ? ' field--half' : '') + '"><label for="' + id + '">' + esc(f.label) + '</label>' + input + (f.hint ? '<p class="hint">' + esc(f.hint) + '</p>' : '') + '</div>';
  }

  function wireSwatches(root) {
    root.querySelectorAll('.swatches').forEach((sw) => {
      const input = sw.querySelector('input[type=color]');
      sw.addEventListener('click', (e) => {
        const b = e.target.closest('.swatch');
        if (!b) return;
        input.value = b.dataset.color;
        sw.querySelectorAll('.swatch').forEach((x) => x.classList.toggle('is-on', x === b));
      });
      input.addEventListener('input', () => sw.querySelectorAll('.swatch').forEach((x) => x.classList.remove('is-on')));
    });
  }

  function readForm(root, fields) {
    const out = {};
    fields.forEach((f) => {
      const el = root.querySelector('[name="' + f.name + '"]');
      if (!el) return;
      if (f.type === 'checkbox') out[f.name] = el.checked;
      else if (f.type === 'number') out[f.name] = el.value === '' ? null : Number(el.value);
      else out[f.name] = el.value.trim();
    });
    return out;
  }

  /** A form dialog. Resolves with the values, or null when cancelled. */
  RB.modal.form = function (o) {
    return new Promise((resolve) => {
      let done = false;
      const body = RB.html('<form class="form" novalidate>' + o.fields.map(fieldHtml).join('') + (o.intro ? '' : '') + '<button type="submit" hidden></button></form>');
      if (o.intro) body.insertBefore(RB.html('<p class="intro">' + esc(o.intro) + '</p>'), body.firstChild);
      wireSwatches(body);
      const submit = (m) => {
        const vals = readForm(body, o.fields);
        for (const f of o.fields) {
          if (f.required && (vals[f.name] == null || vals[f.name] === '')) { RB.toast((f.label || f.name) + ' is required.', 'error'); return; }
          if (f.type === 'number' && vals[f.name] != null) {
            if ((f.min != null && vals[f.name] < f.min) || (f.max != null && vals[f.name] > f.max) || isNaN(vals[f.name])) { RB.toast(f.label + ' must be between ' + f.min + ' and ' + f.max + '.', 'error'); return; }
          }
        }
        if (o.validate) { const err = o.validate(vals); if (err) { RB.toast(err, 'error'); return; } }
        done = true; m.close(); resolve(vals);
      };
      const m = open({
        title: o.title, body, wide: o.wide,
        onClose: () => { if (!done) resolve(null); },
        actions: [{ label: 'Cancel', onClick: (x) => x.close() }, { label: o.submitLabel || 'Save', kind: o.danger ? 'danger' : 'primary', onClick: (x) => submit(x) }],
      });
      body.addEventListener('submit', (e) => { e.preventDefault(); submit(m); });
    });
  };

  RB.modal.confirm = function (text, o) {
    const opts = o || {};
    return new Promise((resolve) => {
      let done = false;
      open({
        title: opts.title || 'Are you sure?', body: '<p class="intro">' + esc(text) + '</p>',
        onClose: () => { if (!done) resolve(false); },
        actions: [{ label: 'Cancel', onClick: (m) => m.close() }, { label: opts.okLabel || 'Delete', kind: opts.danger === false ? 'primary' : 'danger', onClick: (m) => { done = true; m.close(); resolve(true); } }],
      });
    });
  };

  /* ---------- template picker (add device) ---------- */
  RB.pickTemplate = function (o) {
    const opts = o || {};
    return new Promise((resolve) => {
      let done = false;
      const tpls = S().templates.filter((t) => (opts.endpoints ? RB.unitsOfTpl(t) === 0 : RB.unitsOfTpl(t) > 0) && (!opts.maxUnits || RB.unitsOfTpl(t) <= opts.maxUnits));
      const body = RB.html('<div class="picker"><div class="search-box">' + RB.icon('search') + '<input type="search" placeholder="Search devices" aria-label="Search devices"></div><div class="picker-list"></div>' +
        (opts.maxUnits ? '<p class="hint">Showing devices that fit in the ' + opts.maxUnits + ' free unit' + (opts.maxUnits > 1 ? 's' : '') + ' here.</p>' : '') + '</div>');
      const list = body.querySelector('.picker-list');
      const draw = (q) => {
        const needle = (q || '').toLowerCase();
        const rows = tpls.filter((t) => !needle || (t.name + ' ' + t.maker + ' ' + t.model + ' ' + t.category).toLowerCase().includes(needle));
        list.innerHTML = rows.length ? rows.map((t) => '<button type="button" class="pick-row" data-t="' + t.id + '"><span class="lib-chip" style="background:' + t.color + '"></span><span class="pick-main"><b>' + esc(t.name) + '</b><small>' + esc([t.maker, t.model].filter(Boolean).join(' · ')) + '</small></span><span class="pick-u">' + (RB.unitsOfTpl(t) ? RB.unitsOfTpl(t) + 'U' : '—') + '</span></button>').join('')
          : '<p class="empty-note">No matching devices. Build one in the device library.</p>';
      };
      draw('');
      body.querySelector('input').addEventListener('input', (e) => draw(e.target.value));
      const m = open({ title: opts.title || 'Add a device', body, onClose: () => { if (!done) resolve(null); } });
      list.addEventListener('click', (e) => {
        const b = e.target.closest('.pick-row');
        if (!b) return;
        done = true; m.close(); resolve(RB.get.template(b.dataset.t));
      });
    });
  };
  RB.unitsOfTpl = (t) => Math.max(0, parseInt(t.units, 10) || 0);

  /* ---------- device builder ---------- */
  RB.openBuilder = function (tplId, opts) {
    const existing = tplId ? RB.get.template(tplId) : null;
    const draft = existing ? JSON.parse(JSON.stringify(existing)) : {
      id: RB.uid('tpl'), name: '', maker: '', model: '', category: 'Switch', units: 1, color: '#1e3a8a', passthrough: false,
      groups: [{ type: 'RJ45', count: 24, rows: 2, side: 'front', prefix: '', start: 1 }],
    };
    if (opts && opts.copy) { draft.id = RB.uid('tpl'); draft.name = draft.name + ' (copy)'; }
    const isNew = !existing || (opts && opts.copy);
    const inUse = existing ? S().devices.filter((d) => d.templateId === existing.id).length : 0;

    const body = RB.html('<div class="builder">' +
      '<div class="builder-form">' +
      '<div class="row2">' + fieldHtml({ name: 'name', label: 'Name', value: draft.name, placeholder: 'e.g. Core switch 48 port' }) + fieldHtml({ name: 'category', label: 'Category', type: 'select', value: draft.category, options: RB.CATEGORIES.map((c) => ({ value: c, label: c })) }) + '</div>' +
      '<div class="row2">' + fieldHtml({ name: 'maker', label: 'Manufacturer', value: draft.maker, list: Array.from(new Set(S().templates.map((t) => t.maker).filter(Boolean))) }) + fieldHtml({ name: 'model', label: 'Model', value: draft.model }) + '</div>' +
      '<div class="row2">' + fieldHtml({ name: 'units', label: 'Height in rack units (0 = not in a rack: outlets, access points…)', type: 'number', value: draft.units, min: 0, max: 20 }) +
      '<div class="field"><label>Colour</label><div class="swatches">' + ['#1e3a8a', '#172554', '#3f3f46', '#262626', '#171717', '#7f1d1d', '#14532d', '#334155', '#a1a1aa', '#f5f5f5'].map((c) => '<button type="button" class="swatch' + (c === draft.color ? ' is-on' : '') + '" data-color="' + c + '" style="background:' + c + '" aria-label="Colour ' + c + '"></button>').join('') + '<input type="color" name="color" value="' + esc(draft.color) + '" aria-label="Custom colour"></div></div></div>' +
      fieldHtml({ name: 'screen', label: 'UniFi-style screen on the front (the small display at the right-hand end of UniFi switches, gateways and recorders)', type: 'checkbox', value: draft.screen }) +
      fieldHtml({ name: 'passthrough', label: 'Pass-through ports (patch panels and outlets: every front port also has a back)', type: 'checkbox', value: draft.passthrough }) +
      '<h3 class="sub">Ports</h3><div class="groups"></div>' +
      '<button type="button" class="btn btn--ghost add-group">' + RB.icon('plus') + ' Add a row of ports</button>' +
      '</div>' +
      '<div class="builder-preview"><h3 class="sub">Preview</h3><div class="pv-face"><span class="pv-tag">Front</span><div class="pv pv-front"></div></div><div class="pv-face"><span class="pv-tag">Rear</span><div class="pv pv-rear"></div></div><p class="hint pv-count"></p>' +
      (inUse ? '<p class="hint warn">' + inUse + ' device' + (inUse > 1 ? 's use' : ' uses') + ' this template. Changes apply to all of them; cables on ports that disappear are removed.</p>' : '') + '</div>' +
      '</div>');

    const groupsEl = body.querySelector('.groups');
    function groupRow(gp, i) {
      return '<div class="grp" data-i="' + i + '">' +
        '<label><span>Type</span><select data-k="type">' + RB.PORT_TYPES.map((t) => '<option' + (t === gp.type ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></label>' +
        '<label><span>Count</span><input data-k="count" type="number" min="1" max="96" value="' + gp.count + '"></label>' +
        '<label><span>Rows</span><input data-k="rows" type="number" min="1" max="4" value="' + gp.rows + '"></label>' +
        '<label><span>Side</span><select data-k="side"><option value="front"' + (gp.side !== 'rear' ? ' selected' : '') + '>Front</option><option value="rear"' + (gp.side === 'rear' ? ' selected' : '') + '>Rear</option></select></label>' +
        '<label><span>Label prefix</span><input data-k="prefix" value="' + esc(gp.prefix || '') + '" placeholder="e.g. SFP "></label>' +
        '<label><span>First number</span><input data-k="start" type="number" min="0" max="999" value="' + (gp.start == null ? 1 : gp.start) + '"></label>' +
        '<div class="grp-tools"><button type="button" class="icon-btn" data-move="-1" aria-label="Move up">' + RB.icon('up') + '</button><button type="button" class="icon-btn" data-move="1" aria-label="Move down">' + RB.icon('down') + '</button><button type="button" class="icon-btn danger" data-del aria-label="Remove this row">' + RB.icon('trash') + '</button></div>' +
        '</div>';
    }
    function drawGroups() {
      groupsEl.innerHTML = draft.groups.length ? draft.groups.map(groupRow).join('') : '<p class="empty-note">No ports — fine for shelves, blanks and cable managers.</p>';
    }
    function readTop() {
      draft.name = body.querySelector('[name=name]').value.trim();
      draft.category = body.querySelector('[name=category]').value;
      draft.maker = body.querySelector('[name=maker]').value.trim();
      draft.model = body.querySelector('[name=model]').value.trim();
      const u = parseInt(body.querySelector('[name=units]').value, 10);
      draft.units = RB.clamp(isNaN(u) ? 1 : u, 0, 20);
      draft.color = body.querySelector('[name=color]').value;
      draft.passthrough = body.querySelector('[name=passthrough]').checked;
      draft.screen = body.querySelector('[name=screen]').checked;
    }
    function preview() {
      readTop();
      const tmp = JSON.parse(JSON.stringify(draft));
      const units = Math.max(1, tmp.units);
      const h = units * 34 - 1;
      ['front', 'rear'].forEach((face) => {
        const host = body.querySelector('.pv-' + face);
        host.style.height = h + 'px';
        host.style.setProperty('--dc', tmp.color);
        host.style.color = RB.inkOn(tmp.color);
        const availW = Math.max(160, (host.clientWidth || 400) - 64 - 30);
        host.innerHTML = '<div class="dev-label dev-label--pv"><span class="dev-name">' + esc(tmp.name || 'New device') + '</span>' + (units > 1 ? '<span class="dev-model">' + esc(tmp.model) + '</span>' : '') + '</div><div class="dev-ports">' + RB.faceplate(tmp, face, availW, h - 2, null, { static: true, zoom: 1.3 }) + '</div>';
      });
      const n = RB.portsOf(tmp).filter((p) => !p.twin).length;
      body.querySelector('.pv-count').textContent = n + ' port' + (n === 1 ? '' : 's') + (tmp.passthrough ? ', each with a front and a back' : '') + (tmp.units === 0 ? ' · placed in rooms, not racks' : ' · ' + tmp.units + 'U');
    }
    groupsEl.addEventListener('input', (e) => {
      const row = e.target.closest('.grp'); if (!row) return;
      const gp = draft.groups[+row.dataset.i];
      const k = e.target.dataset.k;
      gp[k] = ['count', 'rows', 'start'].includes(k) ? (parseInt(e.target.value, 10) || (k === 'start' ? 0 : 1)) : e.target.value;
      if (k === 'count') gp.count = RB.clamp(gp.count, 1, 96);
      if (k === 'rows') gp.rows = RB.clamp(gp.rows, 1, 4);
      preview();
    });
    groupsEl.addEventListener('click', (e) => {
      const row = e.target.closest('.grp'); if (!row) return;
      const i = +row.dataset.i;
      if (e.target.closest('[data-del]')) { draft.groups.splice(i, 1); drawGroups(); preview(); }
      const mv = e.target.closest('[data-move]');
      if (mv) {
        const j = i + (+mv.dataset.move);
        if (j < 0 || j >= draft.groups.length) return;
        const t = draft.groups[i]; draft.groups[i] = draft.groups[j]; draft.groups[j] = t;
        drawGroups(); preview();
      }
    });
    body.querySelector('.add-group').addEventListener('click', () => {
      draft.groups.push({ type: 'RJ45', count: 8, rows: 1, side: 'front', prefix: '', start: 1 });
      drawGroups(); preview();
    });
    body.querySelector('.builder-form').addEventListener('input', (e) => { if (!e.target.closest('.grp')) preview(); });
    body.querySelector('.builder-form').addEventListener('change', (e) => {
      if (e.target.closest('.grp') && e.target.tagName === 'SELECT') {
        const row = e.target.closest('.grp');
        draft.groups[+row.dataset.i][e.target.dataset.k] = e.target.value;
      }
      preview();
    });
    wireSwatches(body);
    body.querySelector('.swatches').addEventListener('click', () => setTimeout(preview, 0));
    drawGroups();
    setTimeout(preview, 0);

    const actions = [];
    if (existing && !(opts && opts.copy)) {
      actions.push({ label: 'Delete', kind: 'danger-ghost', left: true, onClick: async (m) => {
        if (inUse) { RB.toast('Remove the ' + inUse + ' device' + (inUse > 1 ? 's' : '') + ' using this template first.', 'error'); return; }
        if (!(await RB.modal.confirm('Delete the template "' + existing.name + '"?'))) return;
        m.close();
        RB.store.commit('Deleted device template ' + existing.name, (s) => { s.templates = s.templates.filter((t) => t.id !== existing.id); });
      } });
    }
    actions.push({ label: 'Cancel', onClick: (m) => m.close() });
    actions.push({ label: isNew ? 'Add to library' : 'Save changes', kind: 'primary', onClick: (m) => {
      readTop();
      if (!draft.name) { RB.toast('Give the device a name.', 'error'); return; }
      if (existing && !(opts && opts.copy) && draft.units !== existing.units) {
        const conflict = S().devices.some((d) => d.templateId === existing.id && d.rackId && (draft.units === 0 || !RB.fits(d.rackId, d.position, draft.units, d.id)));
        if (conflict) { RB.toast('The new height does not fit where these devices are placed. Move them first.', 'error'); return; }
      }
      const clean = { id: draft.id, name: draft.name, maker: draft.maker, model: draft.model, category: draft.category, units: draft.units, color: draft.color, passthrough: draft.passthrough, screen: !!draft.screen, groups: draft.groups.map((gp) => ({ type: gp.type, count: RB.clamp(+gp.count || 1, 1, 96), rows: RB.clamp(+gp.rows || 1, 1, 4), side: gp.side === 'rear' ? 'rear' : 'front', prefix: gp.prefix || '', start: isNaN(+gp.start) ? 1 : +gp.start })) };
      m.close();
      RB.store.commit((isNew ? 'Added device template ' : 'Edited device template ') + clean.name, (s) => {
        const i = s.templates.findIndex((t) => t.id === clean.id);
        if (i >= 0) s.templates[i] = clean; else s.templates.push(clean);
        RB.pruneConnections(s);
      });
      RB.toast(isNew ? 'Added to the device library' : 'Template saved');
    } });
    open({ title: isNew ? 'Build a device' : 'Edit device template', body, wide: true, actions });
  };

  /* ---------- connect a port to anything ---------- */
  RB.openConnect = function (devId, key) {
    const d = RB.get.device(devId);
    if (!d) return;
    // Only ports a cable from this one can go to (RJ45 to RJ45, SFP to SFP, power to power...).
    const srcPort = RB.portOf(d, key);
    const reach = (x) => RB.devicePorts(x).filter((p) => !(x.id === devId && p.key === key) && (!srcPort || RB.canLink(srcPort.type, p.type)));
    const devices = S().devices.filter((x) => reach(x).length > 0);
    const groupOf = (x) => {
      if (x.rackId) { const r = RB.get.rack(x.rackId); return 'Rack ' + (r ? r.name : '?'); }
      const room = RB.get.room(x.roomId); return room ? 'Room ' + room.name : 'Unplaced';
    };
    const opts = {};
    devices.slice().sort((a, b) => (groupOf(a) + a.name).localeCompare(groupOf(b) + b.name)).forEach((x) => { (opts[groupOf(x)] = opts[groupOf(x)] || []).push(x); });
    const body = RB.html('<form class="form" novalidate>' +
      '<p class="intro">From <b>' + esc(d.name) + ' / ' + esc(RB.portLabel(d, key)) + '</b></p>' +
      '<div class="field"><label for="c_dev">To device</label><select id="c_dev">' + Object.keys(opts).map((g) => '<optgroup label="' + esc(g) + '">' + opts[g].map((x) => '<option value="' + x.id + '">' + esc(x.name) + '</option>').join('') + '</optgroup>').join('') + '</select></div>' +
      '<div class="field"><label for="c_port">Port</label><select id="c_port"></select></div>' +
      '<div class="row2">' + fieldHtml({ name: 'cable', label: 'Cable', type: 'select', value: 'Cat6', options: RB.CABLES.map((c) => ({ value: c, label: c })) }) + fieldHtml({ name: 'length', label: 'Length', placeholder: 'e.g. 1 m' }) + '</div>' +
      fieldHtml({ name: 'auto', label: 'Colour the cable automatically from the VLAN of its ports', type: 'checkbox', value: true }) +
      fieldHtml({ name: 'color', label: 'Cable colour (used when automatic colouring is off, or no VLAN is set)', type: 'color', value: RB.suggestColor() }) +
      fieldHtml({ name: 'label', label: 'Cable label', placeholder: 'optional' }) +
      '</form>');
    wireSwatches(body);
    const devSel = body.querySelector('#c_dev'), portSel = body.querySelector('#c_port');
    const fillPorts = () => {
      const t = RB.get.device(devSel.value);
      const ports = reach(t);
      portSel.innerHTML = ports.map((p) => {
        const used = RB.connOf(t.id, p.key);
        return '<option value="' + p.key + '"' + (used ? ' disabled' : '') + '>' + esc(p.name + (p.side === 'rear' ? ' (rear)' : '') + ' · ' + p.type + (used ? ' — in use' : '')) + '</option>';
      }).join('');
      const firstFree = ports.find((p) => !RB.connOf(t.id, p.key));
      if (firstFree) portSel.value = firstFree.key;
    };
    // Default to a device in the same rack/room, other than this one.
    const sameRack = devices.find((x) => x.id !== devId && d.rackId && x.rackId === d.rackId);
    if (sameRack) devSel.value = sameRack.id;
    devSel.addEventListener('change', fillPorts);
    fillPorts();
    open({
      title: 'Connect port', body,
      actions: [{ label: 'Cancel', onClick: (m) => m.close() }, { label: 'Connect', kind: 'primary', onClick: (m) => {
        if (!portSel.value) { RB.toast('That device has no free port.', 'error'); return; }
        const color = body.querySelector('[name=color]').value;
        RB.rememberColor(color);
        const ok = RB.connect({ d: devId, p: key }, { d: devSel.value, p: portSel.value }, {
          cable: body.querySelector('[name=cable]').value, color, manual: !body.querySelector('[name=auto]').checked, length: body.querySelector('[name=length]').value.trim(), label: body.querySelector('[name=label]').value.trim(),
        });
        if (ok) m.close();
      } }],
    });
  };

  RB.editConnection = async function (connId) {
    const c = S().connections.find((x) => x.id === connId);
    if (!c) return;
    const vals = await RB.modal.form({
      title: 'Cable details',
      fields: [
        { name: 'cable', label: 'Cable', type: 'select', value: c.cable, options: RB.CABLES.map((x) => ({ value: x, label: x })), half: true },
        { name: 'length', label: 'Length', value: c.length, half: true },
        { name: 'auto', label: 'Colour automatically from the VLAN of its ports', type: 'checkbox', value: !c.manual },
        { name: 'color', label: 'Colour (used when automatic colouring is off, or no VLAN is set)', type: 'color', value: c.color },
        { name: 'label', label: 'Cable label', value: c.label },
      ],
    });
    if (!vals) return;
    RB.rememberColor(vals.color);
    const upd = Object.assign({}, vals, { manual: !vals.auto }); delete upd.auto;
    RB.store.commit('Edited a cable', (s) => { Object.assign(s.connections.find((x) => x.id === connId), upd); });
  };

  /* ---------- VLANs and Wi-Fi ---------- */
  /* A VLAN is either wired (LAN) or Wi-Fi (WLAN). It is Wi-Fi when it is set so, or (if nobody has said) when a Wi-Fi network uses it. */
  RB.vlanKind = (v) => (v.kind === 'wifi' || (v.kind !== 'lan' && S().wlans.some((w) => w.vlanId === v.id)) ? 'wifi' : 'lan');
  /** VLANs in two groups, wired first, each in ID order. */
  RB.vlanGroups = function () {
    const all = S().vlans.slice().sort((a, b) => Number(a.vid) - Number(b.vid));
    return [{ kind: 'lan', title: 'Wired / LAN VLANs', items: all.filter((v) => RB.vlanKind(v) === 'lan') }, { kind: 'wifi', title: 'Wi-Fi / WLAN VLANs', items: all.filter((v) => RB.vlanKind(v) === 'wifi') }].filter((g) => g.items.length);
  };
  /** <option>s for choosing a VLAN, with the wired and Wi-Fi ones in their own groups. */
  RB.vlanOptions = function (selected, none) {
    const g = RB.vlanGroups();
    const opt = (v) => '<option value="' + v.id + '"' + (v.id === selected ? ' selected' : '') + '>' + esc(v.vid + ' · ' + v.name) + '</option>';
    const body = g.length > 1 ? g.map((x) => '<optgroup label="' + esc(x.title) + '">' + x.items.map(opt).join('') + '</optgroup>').join('') : g.map((x) => x.items.map(opt).join('')).join('');
    return (none === false ? '' : '<option value="">' + esc(none || 'No VLAN') + '</option>') + body;
  };
  RB.openVlans = function (opts) {
    const body = RB.html('<div class="vlans"><div class="tabs-inline"><button type="button" class="tab-i is-on" data-t="vlan">VLANs</button><button type="button" class="tab-i" data-t="wlan">Wi-Fi networks</button></div><div class="vl-body"></div></div>');
    let tab = opts && opts.tab === 'wlan' ? 'wlan' : 'vlan';
    body.querySelectorAll('.tab-i').forEach((x) => x.classList.toggle('is-on', x.dataset.t === tab));
    // VLAN numbers, names and colours are one system for every site; each site has its own IP ranges.
    let siteId = (opts && opts.siteId) || (RB.siteInView && (RB.siteInView() || {}).id) || (S().sites[0] && S().sites[0].id) || '';
    const draw = () => {
      const host = body.querySelector('.vl-body');
      if (tab === 'vlan') {
        const usage = {};
        S().devices.forEach((d) => Object.values(d.portMeta || {}).forEach((m) => { if (m && m.vlan) usage[m.vlan] = (usage[m.vlan] || 0) + 1; }));
        const site = siteId && RB.get.site(siteId);
        const picker = S().sites.length ? '<div class="vl-site"><label for="vlSite">IP ranges at</label><select id="vlSite" data-vl-site>' +
          RB.sortSites(S().sites).map((x) => '<option value="' + x.id + '"' + (x.id === siteId ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select>' +
          '<span class="hint">The VLAN numbers, names and colours are the same at every site. Type each site’s own subnet and gateway; changes save as you leave a box.</span></div>' : '';
        host.innerHTML = picker + '<div class="tbl-wrap"><table class="tbl vl-tbl"><thead><tr><th></th><th>ID</th><th>Name</th>' + (site ? '<th>Subnet at ' + esc(site.name) + '</th><th>Gateway</th><th>DHCP range</th>' : '<th>Subnet</th>') + '<th>Cable</th><th>Ports</th><th></th></tr></thead><tbody>' +
          (RB.vlanGroups().map((grp) => '<tr class="vl-group"><th colspan="9">' + esc(grp.title) + ' <span class="hint">' + grp.items.length + '</span></th></tr>' + grp.items.map((v) => {
            const net = RB.vlanNet(v, site);
            const own = (site && site.nets && site.nets[v.id]) || {};
            const cellIn = (k, ph) => '<td><input class="inline-in" data-net="' + k + '" data-vid="' + v.id + '" value="' + esc(own[k] || '') + '" placeholder="' + esc(ph || '') + '" aria-label="' + esc(k + ' of VLAN ' + v.vid) + '"></td>';
            return '<tr><td><span class="dot" style="background:' + esc(v.color) + '"></span></td><td>' + v.vid + '</td><td>' + esc(v.name) + (S().wlans.some((w) => w.vlanId === v.id) ? '<span class="vl-wifi" title="A Wi-Fi network uses this VLAN">Wi-Fi</span>' : '') + (v.notes ? '<small class="t-sub">' + esc(v.notes) + '</small>' : '') + '</td>' +
              (site ? cellIn('subnet', v.subnet || 'e.g. 10.1.' + (v.vid % 256) + '.0/24') + cellIn('gateway', 'e.g. 10.1.' + (v.vid % 256) + '.1') + cellIn('dhcp', 'e.g. .100–.200') : '<td>' + esc(v.subnet) + '</td>') +
              '<td>' + (v.lead ? '<span class="lead-sw" style="background:' + esc(RB.leadHex(v.lead)) + '"></span>' + esc(v.lead) : '—') + '</td><td>' + (usage[v.id] || 0) + '</td><td class="t-act"><button type="button" class="icon-btn" data-edit="' + v.id + '" aria-label="Edit">' + RB.icon('edit') + '</button><button type="button" class="icon-btn danger" data-del="' + v.id + '" aria-label="Delete">' + RB.icon('trash') + '</button></td></tr>';
          }).join('')).join('') || '<tr><td colspan="9" class="empty-note">No VLANs yet.</td></tr>') +
          '</tbody></table></div><button type="button" class="btn btn--ghost" data-add>' + RB.icon('plus') + ' Add VLAN</button>';
      } else {
        host.innerHTML = '<table class="tbl"><thead><tr><th>SSID</th><th>Site</th><th>VLAN</th><th>Security</th><th>Band</th><th></th></tr></thead><tbody>' +
          (S().wlans.map((w) => { const v = RB.get.vlan(w.vlanId); const st = w.siteId && RB.get.site(w.siteId); return '<tr><td>' + esc(w.ssid) + '</td><td>' + (st ? esc(st.name) : 'All sites') + '</td><td>' + (v ? v.vid + ' · ' + esc(v.name) : '—') + '</td><td>' + esc(w.security) + '</td><td>' + esc(w.band) + '</td><td class="t-act"><button type="button" class="icon-btn" data-edit="' + w.id + '" aria-label="Edit">' + RB.icon('edit') + '</button><button type="button" class="icon-btn danger" data-del="' + w.id + '" aria-label="Delete">' + RB.icon('trash') + '</button></td></tr>'; }).join('') || '<tr><td colspan="6" class="empty-note">No Wi-Fi networks yet.</td></tr>') +
          '</tbody></table><button type="button" class="btn btn--ghost" data-add>' + RB.icon('plus') + ' Add Wi-Fi network</button>';
      }
    };
    const vlanForm = (v) => RB.modal.form({
      title: v ? 'Edit VLAN' : 'Add VLAN',
      fields: [
        { name: 'vid', label: 'VLAN ID', type: 'number', min: 1, max: 4094, value: v ? v.vid : '', required: true, half: true },
        { name: 'name', label: 'Name', value: v ? v.name : '', required: true, half: true },
        { name: 'kind', label: 'Network type', type: 'select', value: v ? RB.vlanKind(v) : 'lan', options: [{ value: 'lan', label: 'Wired / LAN' }, { value: 'wifi', label: 'Wi-Fi / WLAN' }] },
        { name: 'subnet', label: 'Usual subnet (when a site has none of its own)', value: v ? v.subnet : '', placeholder: 'e.g. 10.0.10.0/24' },
        { name: 'notes', label: 'Purpose / notes', value: v ? v.notes || '' : '', placeholder: 'e.g. Gateway 10.0.10.1' },
        { name: 'lead', label: 'Cable colour', type: 'select', value: v ? v.lead || '' : '', half: true,
          options: [{ value: '', label: 'Not set' }].concat(Object.keys(RB.LEAD_COLOURS || {}).map((k) => ({ value: k, label: k }))) },
        { name: 'color', label: 'Colour on screen', type: 'color', value: v ? v.color : '#2563eb', half: true },
      ],
      validate: (x) => (S().vlans.some((o) => o.vid === x.vid && (!v || o.id !== v.id)) ? 'VLAN ' + x.vid + ' already exists.' : null),
    });
    const wlanForm = (w) => RB.modal.form({
      title: w ? 'Edit Wi-Fi network' : 'Add Wi-Fi network',
      fields: [
        { name: 'ssid', label: 'Network name (SSID)', value: w ? w.ssid : '', required: true },
        { name: 'siteId', label: 'Site', type: 'select', value: w ? w.siteId || '' : siteId || '', options: [{ value: '', label: 'All sites' }].concat(RB.sortSites(S().sites).map((x) => ({ value: x.id, label: x.name }))) },
        { name: 'vlanId', label: 'VLAN', type: 'select', value: w ? w.vlanId : '', options: [{ value: '', label: 'None' }].concat(S().vlans.map((v) => ({ value: v.id, label: v.vid + ' · ' + v.name }))) },
        { name: 'security', label: 'Security', type: 'select', value: w ? w.security : 'WPA3', options: ['WPA3', 'WPA2/WPA3', 'WPA2', 'WPA2 Enterprise', 'Open'].map((x) => ({ value: x, label: x })), half: true },
        { name: 'band', label: 'Band', type: 'select', value: w ? w.band : '2.4 / 5 GHz', options: ['2.4 GHz', '5 GHz', '6 GHz', '2.4 / 5 GHz', '2.4 / 5 / 6 GHz'].map((x) => ({ value: x, label: x })), half: true },
      ],
    });
    body.addEventListener('change', (e) => {
      if (e.target.matches('[data-vl-site]')) { siteId = e.target.value; draw(); return; }
      const inp = e.target.closest('[data-net]');
      if (!inp || !siteId) return;
      const v = RB.get.vlan(inp.dataset.vid); const site = RB.get.site(siteId);
      if (!v || !site) return;
      const k = inp.dataset.net; const val = inp.value.trim();
      if (k === 'subnet' && val && !/^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(val) && !/:/.test(val)) { RB.toast('Write the subnet like 10.1.10.0/24', 'error'); return; }
      RB.store.commit('Set ' + k + ' of VLAN ' + v.vid + ' at ' + site.name, (s) => {
        const st = s.sites.find((x) => x.id === siteId);
        st.nets = st.nets || {};
        const n = Object.assign({}, st.nets[v.id]);
        if (val) n[k] = val; else delete n[k];
        if (Object.keys(n).length) st.nets[v.id] = n; else delete st.nets[v.id];
      });
    });
    body.addEventListener('click', async (e) => {
      const t = e.target.closest('.tab-i');
      if (t) { tab = t.dataset.t; body.querySelectorAll('.tab-i').forEach((x) => x.classList.toggle('is-on', x === t)); draw(); return; }
      if (e.target.closest('[data-add]')) {
        const vals = tab === 'vlan' ? await vlanForm() : await wlanForm();
        if (!vals) return;
        RB.store.commit(tab === 'vlan' ? 'Added VLAN ' + vals.vid : 'Added Wi-Fi ' + vals.ssid, (s) => { (tab === 'vlan' ? s.vlans : s.wlans).push(Object.assign({ id: RB.uid(tab) }, vals)); });
        draw(); return;
      }
      const ed = e.target.closest('[data-edit]');
      if (ed) {
        const list = tab === 'vlan' ? S().vlans : S().wlans;
        const item = list.find((x) => x.id === ed.dataset.edit);
        const vals = tab === 'vlan' ? await vlanForm(item) : await wlanForm(item);
        if (!vals) return;
        RB.store.commit('Edited ' + (tab === 'vlan' ? 'VLAN ' + vals.vid : 'Wi-Fi ' + vals.ssid), (s) => { Object.assign((tab === 'vlan' ? s.vlans : s.wlans).find((x) => x.id === item.id), vals); });
        draw(); return;
      }
      const del = e.target.closest('[data-del]');
      if (del) {
        if (!(await RB.modal.confirm('Delete this ' + (tab === 'vlan' ? 'VLAN? Ports using it will lose their VLAN.' : 'Wi-Fi network?')))) return;
        const id = del.dataset.del;
        RB.store.commit('Deleted a ' + (tab === 'vlan' ? 'VLAN' : 'Wi-Fi network'), (s) => {
          if (tab === 'vlan') {
            s.vlans = s.vlans.filter((x) => x.id !== id);
            s.sites.forEach((x) => { if (x.nets) delete x.nets[id]; });
            s.devices.forEach((d) => Object.values(d.portMeta).forEach((m) => { if (m.vlan === id) delete m.vlan; }));
            s.wlans.forEach((w) => { if (w.vlanId === id) w.vlanId = ''; });
          } else s.wlans = s.wlans.filter((x) => x.id !== id);
        });
        draw();
      }
    });
    draw();
    open({ title: 'VLANs, IP ranges & Wi-Fi', body, wide: true });
  };

  /* ---------- history ---------- */
  RB.openHistory = function () {
    const h = S().history;
    const body = '<ol class="history">' + (h.length ? h.slice(0, 300).map((x) => '<li><time>' + esc(RB.fmtDate(x.ts)) + '</time><span>' + esc(x.text) + (x.by ? ' <em class="by">· ' + esc(x.by) + '</em>' : '') + '</span></li>').join('') : '<li class="empty-note">No changes yet.</li>') + '</ol>';
    open({ title: 'Change history', body, actions: [{ label: 'Clear history', kind: 'danger-ghost', left: true, onClick: async (m) => {
      if (!(await RB.modal.confirm('Clear the change history? Your racks and devices stay as they are.'))) return;
      m.close();
      RB.store.commit(null, (s) => { s.history = [{ ts: Date.now(), text: 'History cleared' }]; });
    } }, { label: 'Close', kind: 'primary', onClick: (m) => m.close() }] });
  };

  /* ---------- data: export, import, reset ---------- */
  RB.openData = function () {
    const st = S();
    const isAdmin = !RB.auth || RB.auth.can('data');
    const mayImport = !RB.auth || RB.auth.can('import');
    const body = RB.html('<div class="data' + (isAdmin ? '' : ' data--limited') + (mayImport ? '' : ' data--noimport') + '">' +
      (isAdmin ? '<form class="form">' + fieldHtml({ name: 'ws', label: 'Workspace name', value: st.workspace }) + '</form>' : '<p class="hint">Your role can download copies. Restoring, emptying and renaming need an Admin.</p>') +
      '<div class="stats">' +
      ['Locations', st.sites.length, 'Rooms', st.rooms.length, 'Racks', st.racks.length, 'Devices', st.devices.length, 'Cables', st.connections.length, 'Templates', st.templates.length].reduce((acc, v, i, a) => (i % 2 ? acc : acc + '<div><b>' + a[i + 1] + '</b><span>' + v + '</span></div>'), '') +
      '</div>' +
      '<h3 class="sub">Back up & move</h3><p class="hint">Everything is saved in this browser. Download a backup file to keep it safe or to open it on another computer.</p>' +
      '<div class="btn-row"><button type="button" class="btn" data-a="export">' + RB.icon('download') + ' Download backup</button><button type="button" class="btn" data-a="import">' + RB.icon('upload') + ' Open backup file</button><input type="file" accept="application/json,.json" hidden></div>' +
      '<h3 class="sub">Spreadsheets</h3><p class="hint">Import VLAN reference and switch port-map sheets from Excel (.xlsx) or CSV. You can also drop the file anywhere on the page.</p><div class="btn-row"><button type="button" class="btn btn--primary" data-a="xlsx">' + RB.icon('upload') + ' Import from Excel or CSV</button><button type="button" class="btn" data-a="xlsx-out">' + RB.icon('download') + ' Download as Excel</button></div><p class="hint">The Excel download uses the same layout: a VLAN reference sheet and a port-map sheet for each switch, router and firewall, so you can edit it and import it again.</p><div class="btn-row"><button type="button" class="btn" data-a="csv-dev">' + RB.icon('download') + ' Devices (CSV)</button><button type="button" class="btn" data-a="csv-con">' + RB.icon('download') + ' Cables (CSV)</button></div>' +
      '<h3 class="sub admin-only">Start over</h3><div class="btn-row admin-only"><button type="button" class="btn" data-a="mock">Load the mock test data</button><button type="button" class="btn" data-a="demo">Load the example</button><button type="button" class="btn btn--danger-ghost" data-a="clear">Empty workspace</button></div>' +
      '</div>');
    const file = body.querySelector('input[type=file]');
    body.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      const a = b.dataset.a;
      if (a === 'export') { try { RB.download(RB.slug(S().workspace) + '-' + new Date().toISOString().slice(0, 10) + '.json', RB.plans ? await RB.plans.forBackup() : RB.store.exportJSON(), 'application/json'); } catch (err) { RB.toast(err.message, 'error'); } }
      if (a === 'import') file.click();
      if (a === 'xlsx') { m.close(); RB.openSheetImport(); }
      if (a === 'xlsx-out') RB.exportWorkbook();
      if (a === 'csv-dev') RB.download('devices.csv', RB.csv(RB.deviceRows()), 'text/csv');
      if (a === 'csv-con') RB.download('cables.csv', RB.csv(RB.connectionRows()), 'text/csv');
      if (a === 'mock') { if (await RB.modal.confirm('Replace everything with the mock test workspace: 3 invented sites, 5 racks (all 45U), about 80 devices and 150 cables covering every port and cable type? Download a backup first if you need your data.', { okLabel: 'Replace' })) { RB.store.replace(RB.mockWorkspace(), 'Mock test workspace loaded'); RB.goHome(); m.close(); } }
      if (a === 'demo') { if (await RB.modal.confirm('Replace everything with the example workspace? Download a backup first if you need your data.', { okLabel: 'Replace' })) { RB.store.replace(RB.demoWorkspace(), 'Example workspace loaded'); RB.goHome(); m.close(); } }
      if (a === 'clear') { if (await RB.modal.confirm('Remove all locations, racks, devices and cables? Your device library is kept.', { okLabel: 'Empty it' })) { const keep = S().templates; const n = RB.emptyWorkspace(); n.templates = keep; n.workspace = S().workspace; RB.store.replace(n, 'Workspace emptied'); RB.goHome(); m.close(); } }
    });
    file.addEventListener('change', () => {
      const f = file.files && file.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => { try { if (RB.store.importJSON(String(r.result)) === false) return; RB.goHome(); RB.toast('Backup opened'); m.close(); } catch (err) { RB.toast(err.message, 'error'); } };
      r.readAsText(f);
      file.value = '';
    });
    const m = open({ title: 'Workspace & data', body, wide: true, actions: [{ label: 'Done', kind: 'primary', onClick: (x) => {
      const wsIn = body.querySelector('[name=ws]');
      const ws = wsIn ? wsIn.value.trim() : '';
      if (ws && ws !== S().workspace) RB.store.commit('Renamed workspace to ' + ws, (s) => { s.workspace = ws; });
      x.close();
    } }] });
  };

  RB.deviceRows = function (filter) {
    const rows = [['Device', 'Template', 'Manufacturer', 'Model', 'Location', 'Room', 'Rack', 'U', 'Height (U)', 'IP / hostname', 'Serial', 'Asset tag', 'Purchased', 'In service', 'Notes']];
    S().devices.filter(filter || (() => true)).forEach((d) => {
      const t = RB.get.template(d.templateId) || {};
      const room = RB.get.roomOfDevice(d);
      const rack = d.rackId ? RB.get.rack(d.rackId) : null;
      rows.push([d.name, t.name, t.maker, t.model, RB.get.pathOfRoom(room), room ? room.name : '', rack ? rack.name : '', rack ? RB.uLabel(rack, d.position) : '', RB.unitsOf(d), d.ip, d.serial, d.assetTag, d.purchaseDate, d.startDate, d.notes]);
    });
    return rows;
  };

  RB.connectionRows = function (filter) {
    const rows = [['From device', 'From port', 'From location', 'To device', 'To port', 'To location', 'Cable', 'Colour', 'Length', 'Label']];
    S().connections.filter(filter || (() => true)).forEach((c) => {
      const a = RB.get.device(c.a.d), b = RB.get.device(c.b.d);
      rows.push([a.name, RB.portLabel(a, c.a.p), RB.get.whereIsDevice(a), b.name, RB.portLabel(b, c.b.p), RB.get.whereIsDevice(b), c.cable, RB.connColor(c), c.length, c.label]);
    });
    return rows;
  };

  /* ---------- print / PDF ---------- */
  RB.openPrint = function (scope) {
    const ui = RB.ui;
    const choices = [];
    const rack = ui.view === 'rack' && RB.get.rack(ui.rackId);
    if (rack) choices.push({ value: 'rack', label: 'This rack (' + rack.name + ')' });
    const roomId = rack ? rack.roomId : ui.view === 'room' ? ui.roomId : null;
    if (roomId) choices.push({ value: 'room', label: 'This room (' + RB.get.room(roomId).name + ')' });
    choices.push({ value: 'all', label: 'Everything in the workspace' });
    RB.modal.form({
      title: 'Print or save as PDF',
      intro: 'Your browser\'s print window opens. Choose "Save as PDF" there to make a PDF file.',
      fields: [
        { name: 'scope', label: 'What to include', type: 'select', value: scope || choices[0].value, options: choices },
        { name: 'faces', label: 'Show front and rear of each rack', type: 'checkbox', value: true },
        { name: 'tables', label: 'Include device and cable lists', type: 'checkbox', value: true },
      ],
      submitLabel: 'Print',
    }).then((v) => {
      if (!v) return;
      let racks;
      if (v.scope === 'rack') racks = [rack];
      else if (v.scope === 'room') racks = RB.get.racksOf(roomId);
      else racks = S().racks.slice();
      buildPrint(racks, v, v.scope === 'room' ? roomId : null);
    });
  };

  function buildPrint(racks, v, roomId) {
    let host = RB.$('#print');
    if (!host) { host = RB.html('<div id="print"></div>'); document.body.appendChild(host); }
    host.innerHTML = '';
    const ws = S().workspace;
    host.appendChild(RB.html('<header class="pr-head"><div>' + RB.logo() + '<b>' + esc(ws) + '</b></div><span>Printed ' + esc(RB.fmtDate(Date.now())) + '</span></header>'));
    const saved = { traceSet: RB.ui.traceSet, sel: RB.ui.sel, portSel: RB.ui.portSel, patchFrom: RB.ui.patchFrom };
    RB.ui.traceSet = null; RB.ui.sel = null; RB.ui.portSel = null; RB.ui.patchFrom = null;
    racks.forEach((rack) => {
      const room = RB.get.room(rack.roomId);
      const occ = RB.occupancy(rack.id);
      const sec = RB.html('<section class="pr-rack"><h1>' + esc(rack.name) + '</h1><p class="pr-sub">' + esc(RB.get.pathOfRoom(room)) + ' · ' + rack.units + 'U · ' + occ.used + 'U used, ' + occ.free + 'U free</p>' + (rack.notes ? '<p class="pr-notes">' + esc(rack.notes) + '</p>' : '') + '<div class="pr-faces"></div></section>');
      const faces = sec.querySelector('.pr-faces');
      (v.faces ? ['front', 'rear'] : ['front']).forEach((f) => {
        const el = RB.renderRack(rack, { face: f, zoom: 0.78, interactive: false });
        faces.appendChild(el);
      });
      if (v.tables) {
        const ids = new Set(RB.get.devicesInRack(rack.id).map((d) => d.id));
        sec.appendChild(tableOf('Devices', RB.deviceRows((d) => ids.has(d.id)), [0, 1, 7, 2, 3, 9, 10, 12, 13]));
        sec.appendChild(tableOf('Cables', RB.connectionRows((c) => ids.has(c.a.d) || ids.has(c.b.d)), [0, 1, 3, 4, 5, 6, 8, 9]));
      }
      host.appendChild(sec);
    });
    if (roomId && v.tables) {
      const eps = RB.get.endpointsOf(roomId);
      if (eps.length) {
        const ids = new Set(eps.map((d) => d.id));
        const sec = RB.html('<section class="pr-rack"><h1>Outlets & endpoints</h1></section>');
        sec.appendChild(tableOf('Endpoints', RB.deviceRows((d) => ids.has(d.id)), [0, 1, 9, 10, 14]));
        sec.appendChild(tableOf('Cables', RB.connectionRows((c) => ids.has(c.a.d) || ids.has(c.b.d)), [0, 1, 3, 4, 5, 6, 9]));
        host.appendChild(sec);
      }
    }
    if (!racks.length) host.appendChild(RB.html('<p>No racks to print.</p>'));
    Object.assign(RB.ui, saved);
    document.body.classList.add('is-printing');
    requestAnimationFrame(() => {
      host.querySelectorAll('.rack').forEach((el) => RB.drawCables(el));
      setTimeout(() => {
        window.print();
        setTimeout(() => document.body.classList.remove('is-printing'), 300);
      }, 60);
    });
  }

  function tableOf(title, rows, cols) {
    const head = rows[0];
    const body = rows.slice(1);
    return RB.html('<div class="pr-table"><h2>' + esc(title) + ' (' + body.length + ')</h2>' + (body.length ? '<table><thead><tr>' + cols.map((i) => '<th>' + esc(head[i]) + '</th>').join('') + '</tr></thead><tbody>' + body.map((r) => '<tr>' + cols.map((i) => '<td>' + esc(r[i]) + '</td>').join('') + '</tr>').join('') + '</tbody></table>' : '<p class="pr-sub">None.</p>') + '</div>');
  }

  /* ---------- keyboard help ---------- */
  RB.openHelp = function () {
    open({ title: 'How it works', body: '<div class="help">' +
      '<ol class="steps"><li><b>Create your site.</b> Add a site and its comms rooms in the left column (floors or buildings are optional).</li><li><b>Build your racks.</b> Add a rack to a room with the number of units it really has.</li><li><b>Place devices.</b> Drag a device from the library onto a rack unit, or press + on a free unit. Drag a device to move it.</li><li><b>Map the patching.</b> Click a port to name it, set its VLAN or connect it. Or switch on Patch mode and click two ports.</li><li><b>Add the details.</b> Select a device for its IP, serial number, dates, photo and notes.</li><li><b>Bring your team in.</b> Set up sign-in from the top right. Give each person a role: Viewer, Technician, Editor, Admin or Super Admin. A Super Admin can add single sign-on (Microsoft, Google, Okta and others), separate tenants and two-step sign-in.</li></ol>' +
      '<h3 class="sub">Shortcuts</h3><table class="tbl keys"><tbody>' +
      [['Ctrl + Z', 'Undo'], ['Ctrl + Y / Ctrl + Shift + Z', 'Redo'], ['Delete', 'Remove the selected device'], ['↑ / ↓', 'Move the selected device one unit'], ['P', 'Patch mode on/off'], ['F', 'Front/rear view'], ['Esc', 'Cancel / close']].map((r) => '<tr><td><kbd>' + r[0] + '</kbd></td><td>' + r[1] + '</td></tr>').join('') +
      '</tbody></table></div>', actions: [{ label: 'Got it', kind: 'primary', onClick: (m) => m.close() }] });
  };
})();
