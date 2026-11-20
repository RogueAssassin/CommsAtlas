/* CommsAtlas — shared helpers. Everything hangs off the global RB namespace so the
   app works as plain scripts (no bundler, also when opened straight from disk). */
(function () {
  'use strict';
  const RB = (window.RB = window.RB || {});
  RB.CONFIG = window.APP_CONFIG || {};
  RB.APP_NAME = String(RB.CONFIG.name || 'CommsAtlas').slice(0, 40);

  RB.uid = function (prefix) {
    return (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  };

  RB.esc = function (value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  RB.$ = (sel, root) => (root || document).querySelector(sel);
  RB.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /** Create an element from an HTML string (first element). */
  RB.html = function (str) {
    const t = document.createElement('template');
    t.innerHTML = str.trim();
    return t.content.firstElementChild;
  };

  RB.clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  RB.fmtDate = function (ts) {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  RB.download = function (filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
  };

  RB.csv = function (rows) {
    return rows.map((r) => r.map((c) => {
      const s = String(c == null ? '' : c);
      return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\r\n');
  };

  RB.slug = (s) => String(s || 'export').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'export';

  /** Read an image file, shrink it so it fits in browser storage, return a data URL. */
  RB.readImage = function (file, maxSide, quality) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) { reject(new Error('Please choose an image file.')); return; }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read the file.'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('That image could not be opened.'));
        img.onload = () => {
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * scale));
          c.height = Math.max(1, Math.round(img.height * scale));
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', quality || 0.8));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  };

  /* ---------- toasts ---------- */
  RB.toast = function (text, kind) {
    let host = RB.$('#toasts');
    if (!host) {
      host = RB.html('<div id="toasts" class="toasts" aria-live="polite"></div>');
      document.body.appendChild(host);
    }
    const el = RB.html('<div class="toast ' + (kind ? 'toast--' + kind : '') + '">' + RB.esc(text) + '</div>');
    host.appendChild(el);
    setTimeout(() => el.classList.add('is-out'), 2600);
    setTimeout(() => el.remove(), 3000);
  };

  /* ---------- small icon set (own drawings, stroke icons) ---------- */
  const P = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    rack: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M8 7h8M8 11h8M8 15h8"/>',
    site: '<path d="M4 21V8l8-5 8 5v13"/><path d="M9 21v-6h6v6"/>',
    floor: '<path d="M3 9l9-5 9 5-9 5-9-5z"/><path d="M3 14l9 5 9-5"/>',
    room: '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 12h7v8"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
    redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 000 12h3"/>',
    lib: '<rect x="3" y="4" width="7" height="7" rx="1"/><rect x="14" y="4" width="7" height="7" rx="1"/><rect x="3" y="15" width="7" height="5" rx="1"/><rect x="14" y="15" width="7" height="5" rx="1"/>',
    vlan: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="1.6"/><circle cx="16" cy="12" r="1.6"/><circle cx="10" cy="18" r="1.6"/>',
    history: '<path d="M3 12a9 9 0 103-6.7"/><path d="M3 4v4h4"/><path d="M12 8v4l3 2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
    print: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="1.5"/><path d="M6 14h12v7H6z"/>',
    cable: '<path d="M7 4v5a5 5 0 0010 0V4"/><path d="M5 4h4M15 4h4M12 14v6"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>',
    note: '<path d="M5 4h10l4 4v12H5z"/><path d="M15 4v4h4M8 12h8M8 16h5"/>',
    flip: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
    zoomIn: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4M8 11h6M11 8v6"/>',
    zoomOut: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4M8 11h6"/>',
    trace: '<circle cx="5" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 6h6a3 3 0 010 6h-2a3 3 0 000 6h6"/>',
    link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
    unlink: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/><path d="M4 4l16 16"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 8"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
    pin: '<path d="M12 21s-6-5.5-6-11a6 6 0 0112 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>',
    device: '<rect x="3" y="8" width="18" height="8" rx="1.2"/><path d="M6 12h2M10 12h2M14 12h4"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>',
    sheet: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M4 9h16M4 15h16M10 3v18"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 015 .5c0 1.7-2.5 2-2.5 4M12 17h.01"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0"/><path d="M16 4.5a3.5 3.5 0 010 7M18 14a6 6 0 013.5 6"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="1.5"/><path d="M8 11V8a4 4 0 018 0v3"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M14 9l2 2"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5L16 9.5"/>',
    logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
    building: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2M10 21v-3h4v3"/>',
    pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0113 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.4 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.4-3.6-8.5s1.1-5.9 3.6-8.5z"/>',
    api: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14"/>',
    zoomin: '<path d="M12 5v14M5 12h14"/>',
    zoomout: '<path d="M5 12h14"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  };
  RB.icon = function (name, size) {
    const s = size || 16;
    return '<svg class="ico" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (P[name] || '') + '</svg>';
  };

  /** The emblem on its own (printouts, small spaces). */
  RB.logo = function () {
    return '<img class="logo-mark" src="/img/emblem-128.png" width="30" height="30" alt="">';
  };
  /** The horizontal CommsAtlas logo: emblem and name. */
  RB.wordLogo = function (cls, h) {
    const hh = h || 40;
    return '<img class="' + (cls || 'brand-logo') + '" src="/img/website-logo.png" width="' + Math.round(hh * 3) + '" height="' + hh + '" alt="' + RB.esc(RB.APP_NAME || 'CommsAtlas') + '">';
  };
})();

/* ---- build number: made at random each time the package is built (see build.ps1), shown in its own space ---- */
(function () {
  'use strict';
  const RB = window.RB;
  RB.build = String((window.APP_BUILD && window.APP_BUILD.number) || 'dev');
  RB.buildLabel = function () { return 'Build ' + RB.esc(RB.build); };
  /** The server may report a newer build than the page that is open; show the page's own. */
  RB.setBuild = function () { /* the page's own build number is the one that counts */ };
})();
