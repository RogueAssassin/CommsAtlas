/* CommsAtlas — saving to the server.
   With the CommsAtlas server, every change is saved there so everyone sees the same records, and other people's
   changes are picked up. Without the server, everything stays in this browser. */
(function () {
  'use strict';
  const RB = window.RB;
  const esc = RB.esc;
  const S = () => RB.store.state;

  const TOKEN_KEY = 'commsatlas.srv.token';
  const srv = (RB.server = { on: false, status: 'local', who: '', note: '' });
  let pushTimer = null, pollTimer = null, pending = false, inFlight = false;

  function headers() {
    const h = { Accept: 'application/json' };
    let t = null;
    try { t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null'); } catch (e) { t = null; }
    if (t && t.token && new Date(t.expires) > new Date()) h.Authorization = 'Bearer ' + t.token;
    return h;
  }
  const hasCredential = () => { const h = headers(); return !!h.Authorization; };
  const base = () => '/api/v1/tenants/' + encodeURIComponent(RB.store.tenantId || 'default');
  function setStatus(st, note) { srv.status = st; srv.note = note || ''; const sb = RB.$('#srvState'); if (sb) sb.outerHTML = RB.server.badge(); }

  srv.badge = function () {
    const map = { local: ['ok', 'Saved in this browser'], ok: ['ok', 'Saved to the server'], saving: ['', 'Saving to the server…'], offline: ['warn', 'Server unreachable · kept in this browser'], signin: ['warn', 'Sign in again to save to the server'], readonly: ['', 'Server · view only'], conflict: ['warn', 'Updated from the server'] };
    const m = map[srv.status] || map.local;
    return '<span id="srvState" class="' + m[0] + '"' + (srv.note ? ' title="' + esc(srv.note) + '"' : '') + '>' + esc(m[1]) + (srv.status === 'signin' && RB.auth.ssoReady() ? ' <button type="button" class="link-btn" data-act="srv-signin">Sign in</button>' : '') + '</span>';
  };

  async function call(method, path, body) {
    const opt = { method, headers: headers() };
    if (body) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const res = await fetch(path, opt);
    const j = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, j };
  }

  async function pull(quiet) {
    const r = await call('GET', base() + '/workspace');
    if (r.status === 401) { setStatus('signin', r.j.error); return false; }
    if (!r.ok) { setStatus('offline', r.j.error || 'HTTP ' + r.status); return false; }
    if (r.j.workspace && r.j.rev !== RB.store.serverRev) {
      RB.store.adopt(r.j.workspace, r.j.rev);
      if (!quiet) RB.toast('Updated with the latest changes' + (r.j.savedBy ? ' from ' + r.j.savedBy : ''));
    } else RB.store.serverRev = r.j.rev || 0;
    return r.j;
  }

  async function push() {
    if (inFlight) { pending = true; return; }
    if (!hasCredential()) { setStatus(RB.auth.ssoReady() ? 'signin' : 'local'); return; }
    inFlight = true; pending = false;
    setStatus('saving');
    try {
      const r = await call('PUT', base() + '/workspace', { rev: RB.store.serverRev, workspace: S() });
      if (r.ok) { RB.store.serverRev = r.j.rev; setStatus('ok'); }
      else if (r.status === 409) {
        await pull(true);
        setStatus('conflict', 'Someone else saved at the same moment');
        RB.toast('Someone else saved a change at the same moment, so you now see their version. Please make your last change again.', 'error');
      } else if (r.status === 401) setStatus('signin', r.j.error);
      else if (r.status === 403) setStatus('readonly', r.j.error);
      else setStatus('offline', r.j.error || 'HTTP ' + r.status);
    } catch (e) { setStatus('offline', e.message); pending = true; }
    finally { inFlight = false; if (pending) schedule(); }
  }
  let dirty = false;
  function schedule() { dirty = true; clearTimeout(pushTimer); pushTimer = setTimeout(() => { dirty = false; push(); }, 1200); }
  /** Saves anything waiting right now (used before switching to another tenant, so nothing lands in the wrong one). */
  srv.flush = async function () {
    clearTimeout(pushTimer);
    if (dirty || pending) { dirty = false; pending = false; for (let i = 0; i < 40 && inFlight; i++) await new Promise((r) => setTimeout(r, 100)); await push(); }
    for (let i = 0; i < 40 && inFlight; i++) await new Promise((r) => setTimeout(r, 100));
  };
  /** Opens the current tenant's records from the server; a brand-new tenant is saved as an empty workspace so it exists there. */
  srv.openTenant = async function (isNew) {
    if (!srv.on || !hasCredential()) return;
    RB.store.serverRev = 0;
    const got = await pull(true);
    if (got && !got.workspace && (isNew || (RB.auth.rank() >= 4 && (S().sites.length || S().racks.length)))) await push();
  };

  /** Called once at start-up, after sign-in. */
  srv.start = async function () {
    if (RB.CONFIG.server === 'off' || location.protocol === 'file:') return;
    try { localStorage.removeItem('commsatlas.srv.apikey'); } catch (e) { /* an old key from the retired data API */ }
    let h = null;
    try { const r = await fetch('/api/v1/health', { headers: { Accept: 'application/json' } }); h = r.ok ? await r.json() : null; } catch (e) { h = null; }
    if (!h || !h.api) return; // a plain web server: everything stays in the browser
    srv.on = true; srv.health = h;
    if (!hasCredential()) { setStatus(RB.auth.ssoReady() ? 'signin' : 'local', 'This browser has no server sign-in yet.'); }
    else {
      try {
        const got = await pull(true);
        // An empty server takes this browser's records, if an Admin is the one opening it.
        if (got && !got.workspace && RB.auth.rank() >= 4 && (S().sites.length || S().racks.length)) await push();
        else if (got) setStatus('ok');
      } catch (e) { setStatus('offline', e.message); }
    }
    RB.store.on(() => { if (!RB.store.adopting && srv.on) schedule(); });
    // Pick up other people's changes.
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      if (document.hidden || inFlight || pending || !hasCredential()) return;
      try {
        const r = await call('GET', base() + '/rev');
        if (r.ok && r.j.rev && r.j.rev !== RB.store.serverRev) await pull(false);
        else if (r.status === 401) setStatus('signin');
      } catch (e) { setStatus('offline', e.message); }
    }, 20000);
  };

  srv.call = call;
  srv.hasCredential = hasCredential;
})();
