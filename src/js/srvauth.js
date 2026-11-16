/* CommsAtlas — sign-in with the CommsAtlas server: first-time setup, Login, Sign-up, Login via SSO (Microsoft, Google, Okta,
   Auth0, Keycloak, authentik, OneLogin, Ping, JumpCloud, Cognito, GitLab or any OpenID Connect provider), two-step codes
   (Google / Microsoft Authenticator), and the people / security screens for Admins. Accounts live on the server.
   When there is no server, auth.js keeps working as before (accounts kept in the browser). */
(function () {
  'use strict';
  const RB = window.RB;
  const esc = RB.esc;
  const TOKEN_KEY = 'commsatlas.srv.token';
  const FLOW_KEY = 'commsatlas.sso.flow2';
  const subtle = window.crypto && window.crypto.subtle;
  const enc = new TextEncoder();
  const ROLES = RB.ROLES;
  const roleOf = (id) => ROLES.find((r) => r.id === id) || ROLES[ROLES.length - 1];
  const srv = (RB.srvAuth = { on: false });
  let me = null;
  let state = null; // what the server says about sign-in: setup needed, providers, sign-up mode
  const rank = (u) => (u ? roleOf(u.role).rank : 0);

  /* ---------- the server ---------- */
  function readToken() {
    try { const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null'); if (t && t.token && new Date(t.expires) > new Date()) return t; } catch (e) { /* none */ }
    return null;
  }
  function saveToken(r) { try { localStorage.setItem(TOKEN_KEY, JSON.stringify({ token: r.token, expires: new Date(r.expires * 1000).toISOString(), role: r.user.role })); } catch (e) { /* storage blocked */ } }
  function clearToken() { try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* storage blocked */ } }
  async function api(method, path, body) {
    const h = { Accept: 'application/json' };
    const t = readToken(); if (t) h.Authorization = 'Bearer ' + t.token;
    if (body) h['Content-Type'] = 'application/json';
    let res;
    try { res = await fetch('/api/v1' + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined }); }
    catch (e) { const er = new Error('Could not reach the server. Check your connection.'); er.status = 0; throw er; }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { const er = new Error(j.error || 'The server answered ' + res.status + '.'); er.status = res.status; throw er; }
    return j;
  }
  srv.api = api;

  srv.detect = async function () {
    if ((RB.CONFIG || {}).server === 'off' || location.protocol === 'file:') return false;
    try {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 6000);
      const r = await fetch('/api/v1/health', { signal: ctl.signal, headers: { Accept: 'application/json' } }); clearTimeout(to);
      const h = r.ok ? await r.json() : null;
      return !!(h && h.accounts);
    } catch (e) { return false; }
  };

  /* ---------- sign-in providers ---------- */
  const PRESETS = {
    entra: { label: 'Microsoft Entra ID (Microsoft 365)', name: 'Microsoft', issuer: 'https://login.microsoftonline.com/YOUR-DIRECTORY-ID/v2.0', flow: 'code', help: 'In Microsoft Entra ID open App registrations › New registration, then Authentication › Add a platform › Single-page application with the redirect address below. Copy the Application (client) ID here and the Directory (tenant) ID into the issuer. Under Token configuration add a groups claim to map groups to levels.' },
    google: { label: 'Google Workspace / Google', name: 'Google', issuer: 'https://accounts.google.com', flow: 'id_token', help: 'In Google Cloud console create an OAuth client ID of type "Web application". Add this site under Authorised JavaScript origins and the redirect address below under Authorised redirect URIs. Google sends no groups, so use the Super Admin list, the default level and the people list.' },
    okta: { label: 'Okta', name: 'Okta', issuer: 'https://YOUR-ORG.okta.com', flow: 'code', help: 'In Okta create an OIDC app integration of type "Single-Page Application" with the redirect address below, and add this site as a trusted origin. Add a "groups" claim to the ID token to map groups.' },
    auth0: { label: 'Auth0', name: 'Auth0', issuer: 'https://YOUR-TENANT.auth0.com/', flow: 'code', help: 'In Auth0 create a "Single Page Application" with the redirect address below under Allowed Callback URLs, and this site under Allowed Web Origins.' },
    keycloak: { label: 'Keycloak', name: 'Keycloak', issuer: 'https://YOUR-HOST/realms/YOUR-REALM', flow: 'code', help: 'Create an OpenID Connect client with Client authentication off and Standard flow on. Put the redirect address below under Valid redirect URIs and this site under Web origins.' },
    authentik: { label: 'authentik', name: 'authentik', issuer: 'https://YOUR-HOST/application/o/YOUR-APP/', flow: 'code', help: 'Create an OAuth2/OpenID provider with Client type "Public" and the redirect address below, then an application that uses it.' },
    onelogin: { label: 'OneLogin', name: 'OneLogin', issuer: 'https://YOUR-SUBDOMAIN.onelogin.com/oidc/2', flow: 'code', help: 'Add an "OpenID Connect (OIDC)" app, set the Application Type to "Native/SPA" (token endpoint authentication: None) and put the redirect address below under Redirect URIs.' },
    ping: { label: 'PingOne / Ping Identity', name: 'Ping Identity', issuer: 'https://auth.pingone.com/YOUR-ENVIRONMENT-ID/as', flow: 'code', help: 'Add a "Single Page App" application with the redirect address below and PKCE required. The issuer is your environment\'s authorization server address.' },
    jumpcloud: { label: 'JumpCloud', name: 'JumpCloud', issuer: 'https://oauth.id.jumpcloud.com/', flow: 'code', help: 'Create a custom OIDC SSO application with the redirect address below, grant type Authorization Code, and Client Authentication "None" (PKCE).' },
    cognito: { label: 'Amazon Cognito', name: 'Amazon Cognito', issuer: 'https://cognito-idp.YOUR-REGION.amazonaws.com/YOUR-USER-POOL-ID', flow: 'code', help: 'Create an app client without a client secret, enable the Hosted UI with the redirect address below, scopes openid, profile and email, and the Authorization code grant.' },
    gitlab: { label: 'GitLab', name: 'GitLab', issuer: 'https://gitlab.com', flow: 'code', help: 'Under Applications add a non-confidential application with the redirect address below and the openid, profile and email scopes.' },
    other: { label: 'Other OpenID Connect provider', name: 'single sign-on', issuer: '', flow: 'code', help: 'Any OpenID Connect provider that allows a public (single-page) client using PKCE, or the id_token flow. Providers that only offer plain OAuth 2.0 (such as GitHub) are not supported.' },
  };
  srv.PRESETS = PRESETS;
  const redirectUri = () => location.origin + '/';
  const b64u = (bytes) => { const a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); let s = ''; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const rand = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; };

  async function discover(issuer) {
    const base = String(issuer || '').trim().replace(/\/+$/, '');
    let res;
    try { res = await fetch(base + '/.well-known/openid-configuration', { headers: { Accept: 'application/json' } }); }
    catch (e) { throw new Error('Could not reach ' + base + '. Check the address and your connection.'); }
    if (!res.ok) throw new Error('The sign-in provider answered ' + res.status + '.');
    const conf = await res.json().catch(() => null);
    if (!conf || !conf.authorization_endpoint) throw new Error('That address does not look like an OpenID Connect provider.');
    return conf;
  }
  async function startSso(p) {
    if (!subtle) throw new Error('Single sign-on needs this site to be opened over https.');
    const conf = await discover(p.issuer);
    const state2 = b64u(rand(16)), nonce = b64u(rand(16)), verifier = b64u(rand(32));
    let scope = String(p.scopes || 'openid profile email').trim(); if (!/\bopenid\b/.test(scope)) scope = 'openid ' + scope;
    const q = new URLSearchParams({ client_id: p.clientId, redirect_uri: redirectUri(), scope, state: state2, nonce });
    if (p.flow === 'id_token') { q.set('response_type', 'id_token'); q.set('response_mode', 'fragment'); }
    else {
      q.set('response_type', 'code');
      q.set('code_challenge', b64u(await subtle.digest('SHA-256', enc.encode(verifier)))); q.set('code_challenge_method', 'S256');
    }
    sessionStorage.setItem(FLOW_KEY, JSON.stringify({ state: state2, nonce, verifier, provider: p.id, at: Date.now() }));
    location.assign(conf.authorization_endpoint + (conf.authorization_endpoint.includes('?') ? '&' : '?') + q.toString());
  }
  /** Back from the provider: swap the reply for a CommsAtlas session. */
  async function finishSso() {
    const q = new URLSearchParams(location.search), h = new URLSearchParams(location.hash.replace(/^#/, ''));
    const src = q.get('state') ? q : (h.get('state') ? h : null);
    if (!src) return null;
    let flow = null; try { flow = JSON.parse(sessionStorage.getItem(FLOW_KEY) || 'null'); } catch (e) { flow = null; }
    sessionStorage.removeItem(FLOW_KEY);
    history.replaceState(null, '', location.pathname);
    if (!flow || flow.state !== src.get('state')) throw new Error('The single sign-on reply did not match a sign-in started here. Try again.');
    if (src.get('error')) throw new Error('Single sign-on said: ' + (src.get('error_description') || src.get('error')));
    if (Date.now() - flow.at > 10 * 60000) throw new Error('Single sign-on took too long. Try again.');
    const p = (state.providers || []).find((x) => x.id === flow.provider);
    if (!p) throw new Error('That sign-in provider is no longer set up.');
    let idToken;
    if (src.get('code')) {
      const conf = await discover(p.issuer);
      const body = new URLSearchParams({ grant_type: 'authorization_code', code: src.get('code'), redirect_uri: redirectUri(), client_id: p.clientId, code_verifier: flow.verifier });
      let res;
      try { res = await fetch(conf.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }); }
      catch (e) { throw new Error('Could not reach the sign-in provider to finish signing in. For Microsoft, register the app as a "Single-page application".'); }
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.id_token) throw new Error('The sign-in provider refused: ' + (j.error_description || j.error || res.status));
      idToken = j.id_token;
    } else idToken = src.get('id_token');
    if (!idToken) throw new Error('No identity came back from single sign-on.');
    const r = await api('POST', '/auth/sso', { provider: p.id, id_token: idToken, nonce: flow.nonce });
    saveToken(r); me = r.user;
    return true;
  }

  /* ---------- the sign-in screen ---------- */
  const errP = (m) => '<p class="gate-err" role="alert"' + (m ? '' : ' hidden') + '>' + esc(m || '') + '</p>';
  const buildNote = () => '<p class="gate-build" title="Build number">' + RB.buildLabel() + '</p>';
  function showGate(errMsg) {
    return new Promise((resolve) => {
      const carried = sessionStorage.getItem('rackbook.gate.msg'); sessionStorage.removeItem('rackbook.gate.msg');
      const el = RB.html('<div class="gate" role="dialog" aria-modal="true" aria-labelledby="gateTitle"><div class="gate-card"></div></div>');
      document.body.appendChild(el); document.documentElement.classList.add('is-locked');
      const card = el.querySelector('.gate-card');
      const head = '<div class="gate-brand">' + RB.wordLogo('gate-wordmark', 84) + '<em>Visualise · Document · Manage</em></div>';
      function step(html, wire) {
        card.innerHTML = head + html + '<p class="gate-note">' + RB.icon('lock', 14) + ' Your records are kept on this CommsAtlas server and protected by your sign-in.</p>' + buildNote();
        if (wire) wire();
        const f = card.querySelector('input:not([type=hidden])'); if (f) setTimeout(() => f.focus(), 20);
      }
      const fail = (m) => { const p = card.querySelector('.gate-err'); if (p) { p.textContent = m; p.hidden = false; } };
      const busy = (b, on, text) => { if (!b) return; b.disabled = on; if (text) b.textContent = text; };
      function done(r) { saveToken(r); me = r.user; el.remove(); document.documentElement.classList.remove('is-locked'); resolve(); }
      function handle(r) {
        if (r.token) { if (r.recovery) return recoveryStep(r); return done(r); }
        if (r.step === 'code') return codeStep(r.ticket);
        if (r.step === 'enrol') return enrolStep(r);
        if (r.step === 'password') return passwordStep(r.ticket);
      }
      async function submit(form, call, label) {
        const btn = form.querySelector('[type=submit]'); busy(btn, true, 'Please wait…');
        try { handle(await call()); } catch (e) { busy(btn, false, label); fail(e.message); }
      }

      function setupStep() {
        step('<h1 id="gateTitle">Welcome. Set up ' + esc(RB.APP_NAME) + '</h1><p class="gate-sub">Create the first account. It becomes the <b>Super Admin</b>, who adds everyone else, turns on two-step sign-in and connects single sign-on.</p>' + errP() +
          '<form class="form gate-form" novalidate>' +
          '<div class="field"><label for="gName">Your name</label><input id="gName" name="name" autocomplete="name" required></div>' +
          '<div class="field"><label for="gEmail">Email</label><input id="gEmail" name="email" type="email" autocomplete="username" required></div>' +
          '<div class="field"><label for="gPw">Password</label><input id="gPw" name="pw" type="password" autocomplete="new-password" minlength="10" required><p class="hint">At least 10 characters.</p></div>' +
          '<div class="field"><label for="gPw2">Password again</label><input id="gPw2" name="pw2" type="password" autocomplete="new-password" required></div>' +
          '<button type="submit" class="btn btn--primary gate-wide">Create Super Admin</button></form>',
        () => {
          const form = card.querySelector('form');
          form.addEventListener('submit', (e) => {
            e.preventDefault();
            if (form.pw.value !== form.pw2.value) return fail('The two passwords are not the same.');
            submit(form, () => api('POST', '/auth/setup', { name: form.name.value, email: form.email.value, password: form.pw.value }), 'Create Super Admin');
          });
        });
      }

      function loginStep(msg) {
        const provs = state.providers || [];
        const sso = provs.length
          ? '<div class="gate-or"><span>or</span></div><div class="gate-sso"><h2>Login via SSO</h2>' + provs.map((p) => '<button type="button" class="btn gate-wide gate-ssobtn" data-sso="' + esc(p.id) + '">' + RB.icon('key', 16) + '<span>Continue with ' + esc(p.name) + '</span></button>').join('') + '</div>'
          : '<div class="gate-or"><span>or</span></div><div class="gate-sso"><h2>Login via SSO</h2><p class="hint">No single sign-on provider is connected yet. A Super Admin can add Microsoft, Google, Okta and more under Users &amp; access › Single sign-on.</p></div>';
        step('<h1 id="gateTitle">Login</h1><p class="gate-sub">Sign in to open your sites, comms rooms and racks.</p>' + errP(msg) +
          '<form class="form gate-form" novalidate>' +
          '<div class="field"><label for="gEmail">Email</label><input id="gEmail" name="email" type="email" autocomplete="username" required></div>' +
          '<div class="field"><label for="gPw">Password</label><input id="gPw" name="pw" type="password" autocomplete="current-password" required></div>' +
          '<button type="submit" class="btn btn--primary gate-wide">Login</button></form>' + sso +
          (state.signup !== 'off' ? '<p class="gate-alt-row">New here? <button type="button" class="link-btn" data-g="signup">Create an account</button></p>' : ''),
        () => {
          const form = card.querySelector('form');
          form.addEventListener('submit', (e) => {
            e.preventDefault();
            if (!form.email.value.trim() || !form.pw.value) return fail('Enter your email and password.');
            submit(form, () => api('POST', '/auth/login', { email: form.email.value, password: form.pw.value }), 'Login');
          });
          card.addEventListener('click', async (e) => {
            const b = e.target.closest('[data-sso],[data-g]'); if (!b) return;
            if (b.dataset.g === 'signup') return signupStep();
            const p = provs.find((x) => x.id === b.dataset.sso); if (!p) return;
            const old = b.innerHTML; busy(b, true); b.textContent = 'Opening ' + p.name + '…';
            try { await startSso(p); } catch (er) { b.disabled = false; b.innerHTML = old; fail(er.message); }
          });
        });
      }

      function signupStep() {
        step('<h1 id="gateTitle">Create an account</h1><p class="gate-sub">' + (state.signup === 'open' ? 'You will be able to look at records straight away.' : 'An Admin needs to approve your account before you can sign in.') + '</p>' + errP() +
          '<form class="form gate-form" novalidate>' +
          '<div class="field"><label for="gName">Your name</label><input id="gName" name="name" autocomplete="name" required></div>' +
          '<div class="field"><label for="gEmail">Email</label><input id="gEmail" name="email" type="email" autocomplete="username" required></div>' +
          '<div class="field"><label for="gPw">Password</label><input id="gPw" name="pw" type="password" autocomplete="new-password" minlength="10" required><p class="hint">At least 10 characters.</p></div>' +
          '<div class="field"><label for="gPw2">Password again</label><input id="gPw2" name="pw2" type="password" autocomplete="new-password" required></div>' +
          '<button type="submit" class="btn btn--primary gate-wide">Sign up</button></form><button type="button" class="link-btn gate-alt" data-g="back">Back to login</button>',
        () => {
          const form = card.querySelector('form');
          card.querySelector('[data-g=back]').addEventListener('click', () => loginStep());
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (form.pw.value !== form.pw2.value) return fail('The two passwords are not the same.');
            const btn = form.querySelector('[type=submit]'); busy(btn, true, 'Please wait…');
            try {
              const r = await api('POST', '/auth/signup', { name: form.name.value, email: form.email.value, password: form.pw.value });
              state = Object.assign(state, {}); loginStep(r.message);
              const p = card.querySelector('.gate-err'); if (p) { p.classList.add('gate-ok'); }
            } catch (er) { busy(btn, false, 'Sign up'); fail(er.message); }
          });
        });
      }

      function codeStep(ticket) {
        step('<h1 id="gateTitle">Two-step sign-in</h1><p class="gate-sub">Open Google Authenticator or Microsoft Authenticator and enter the 6-digit code for ' + esc(RB.APP_NAME) + '. Lost your phone? Enter one of your recovery codes instead.</p>' + errP() +
          '<form class="form gate-form" novalidate><div class="field"><label for="gCode">Code</label><input id="gCode" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="12" required></div>' +
          '<button type="submit" class="btn btn--primary gate-wide">Continue</button></form><button type="button" class="link-btn gate-alt" data-g="back">Back</button>',
        () => {
          card.querySelector('[data-g=back]').addEventListener('click', () => loginStep());
          const form = card.querySelector('form');
          form.addEventListener('submit', (e) => { e.preventDefault(); submit(form, () => api('POST', '/auth/step', { ticket, code: form.code.value }), 'Continue'); });
        });
      }

      function enrolStep(r) {
        step('<h1 id="gateTitle">Set up two-step sign-in</h1><p class="gate-sub">Your organisation asks for a code from an authenticator app as well as your password.</p>' + errP() + tfaSetupHtml(r.secret, r.uri) +
          '<form class="form gate-form" novalidate><div class="field"><label for="gCode">Code from the app</label><input id="gCode" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required></div>' +
          '<button type="submit" class="btn btn--primary gate-wide">Turn on and continue</button></form>',
        () => {
          const form = card.querySelector('form');
          form.addEventListener('submit', (e) => { e.preventDefault(); submit(form, () => api('POST', '/auth/step', { ticket: r.ticket, code: form.code.value }), 'Turn on and continue'); });
        });
      }

      function recoveryStep(r) {
        step('<h1 id="gateTitle">Save your recovery codes</h1><p class="gate-sub">Each code works once if you lose your phone. Keep them somewhere safe: they will not be shown again.</p>' + recoveryHtml(r.recovery) +
          '<button type="button" class="btn btn--primary gate-wide" data-g="ok">I have saved them</button>',
        () => { wireRecovery(card, r.recovery); card.querySelector('[data-g=ok]').addEventListener('click', () => done(r)); });
      }

      function passwordStep(ticket) {
        step('<h1 id="gateTitle">Choose a new password</h1><p class="gate-sub">Your password was set by an Admin. Choose your own before you carry on.</p>' + errP() +
          '<form class="form gate-form" novalidate><div class="field"><label for="gN1">New password</label><input id="gN1" name="n1" type="password" autocomplete="new-password" minlength="10" required><p class="hint">At least 10 characters.</p></div>' +
          '<div class="field"><label for="gN2">New password again</label><input id="gN2" name="n2" type="password" autocomplete="new-password" required></div><button type="submit" class="btn btn--primary gate-wide">Save and continue</button></form>',
        () => {
          const form = card.querySelector('form');
          form.addEventListener('submit', (e) => {
            e.preventDefault();
            if (form.n1.value !== form.n2.value) return fail('The two passwords are not the same.');
            submit(form, () => api('POST', '/auth/step', { ticket, newPassword: form.n1.value }), 'Save and continue');
          });
        });
      }

      if (!state) {
        step('<h1 id="gateTitle">Can not reach the server</h1>' + errP(errMsg || 'The CommsAtlas server did not answer.') + '<button type="button" class="btn btn--primary gate-wide" data-g="retry">Try again</button>', () => card.querySelector('[data-g=retry]').addEventListener('click', () => location.reload()));
        return;
      }
      if (state.setup) setupStep(); else loginStep(errMsg || carried);
    });
  }

  function tfaSetupHtml(secret, uri) {
    return '<div class="tfa-box"><div class="tfa-qr">' + (RB.qrSvg(uri, 176) || '') + '</div><ol class="tfa-steps">' +
      '<li>Open <b>Google Authenticator</b> or <b>Microsoft Authenticator</b> and add an account (the + button), then scan this code.</li>' +
      '<li>Can not scan? Choose "enter a setup key" and type <code class="tfa-key">' + secret.replace(/(.{4})/g, '$1 ').trim() + '</code> (time based).</li></ol></div>';
  }
  function recoveryHtml(codes) {
    return '<div class="rc-box"><ul class="rc-list">' + codes.map((c) => '<li><code>' + esc(c) + '</code></li>').join('') + '</ul>' +
      '<div class="btn-row"><button type="button" class="btn sm" data-rc="copy">Copy</button><button type="button" class="btn sm" data-rc="save">Download</button></div></div>';
  }
  function wireRecovery(root, codes) {
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-rc]'); if (!b) return;
      const text = RB.APP_NAME + ' recovery codes\n' + codes.join('\n') + '\n';
      if (b.dataset.rc === 'copy') { (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => RB.toast('Copied'), () => RB.toast('Could not copy. Use Download.', 'error')); }
      else { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' })); a.download = 'commsatlas-recovery-codes.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
    });
  }

  /* ---------- plugging into the rest of the app ---------- */
  /* ---------- tenants: each is one client with its own sites, rooms, racks and device library ---------- */
  let tenants = [], tenant = null;
  const TKEY = () => 'commsatlas.srv.tenant:' + (me ? me.id : '');
  async function loadTenants() { try { tenants = (await api('GET', '/tenants')).tenants || []; } catch (e) { tenants = []; } }
  function pickTenant() {
    let id = null; try { id = localStorage.getItem(TKEY()); } catch (e) { id = null; }
    return tenants.find((t) => t.id === id) || tenants.find((t) => t.id === 'default') || tenants[0] || null;
  }
  function noAccessGate() {
    const el = RB.html('<div class="gate" role="dialog" aria-modal="true"><div class="gate-card"><h1>No tenant yet</h1><p class="gate-err">You have not been given access to any tenant. Ask an Admin to give you one.</p><button type="button" class="btn btn--primary gate-wide">Sign out</button></div></div>');
    el.querySelector('button').addEventListener('click', () => signOut());
    document.body.appendChild(el);
  }
  function apply() {
    document.documentElement.setAttribute('data-role', me.role);
    tenant = pickTenant();
    if (!tenant) { noAccessGate(); return; }
    RB.store.useTenant(tenant.id, tenant.name);
    // The name at the top of the page opens the tenant list.
    const ws = document.getElementById('wsName');
    if (ws) { ws.dataset.act = 'tenants'; ws.setAttribute('role', 'button'); ws.tabIndex = 0; ws.classList.add('ws-name--pick'); ws.title = 'Switch client (tenant)'; ws.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); RB.openTenants(); } }); }
    renderButton();
  }
  async function openTenantById(id, isNew) {
    const t = tenants.find((x) => x.id === id); if (!t) return;
    await RB.server.flush();
    tenant = t; try { localStorage.setItem(TKEY(), t.id); } catch (e) { /* storage blocked */ }
    RB.store.useTenant(t.id, t.name);
    RB.ui.sel = null; if (RB.goHome) RB.goHome();
    RB.render();
    await RB.server.openTenant(!!isNew);
    if (RB.goHome) RB.goHome();
    RB.render();
    RB.toast('Opened ' + t.name);
  }
  function openTenants() {
    if (!me) return;
    const mayEdit = rank(me) >= 5;
    const body = RB.html('<div class="tn"><p class="intro">Each tenant is one client with its own sites, comms rooms, racks, VLANs and device library. People only ever see the tenants they have been given.</p><div class="tn-list"></div><p class="gate-err" role="alert" hidden></p></div>');
    const list = body.querySelector('.tn-list'), errEl = body.querySelector('.gate-err');
    const say = (t) => { errEl.textContent = t || ''; errEl.hidden = !t; };
    const draw = () => {
      list.innerHTML = tenants.map((t) => '<div class="tn-row' + (tenant && t.id === tenant.id ? ' is-on' : '') + '" data-id="' + esc(t.id) + '"><div class="tn-name"><b>' + esc(t.name) + '</b><span class="hint">' + (tenant && t.id === tenant.id ? 'Open now' : t.rev ? 'Last saved ' + esc(RB.fmtDate(new Date(t.savedAt).getTime())) : 'Empty') + '</span></div><div class="tn-acts">' +
        (tenant && t.id === tenant.id ? '' : '<button type="button" class="btn sm btn--primary" data-t="open">Open</button>') +
        (mayEdit ? '<button type="button" class="btn sm" data-t="rename">Rename</button><button type="button" class="btn sm" data-t="remove">Remove</button>' : '') + '</div></div>').join('') || '<p class="hint">No tenants.</p>';
    };
    draw();
    if (mayEdit) body.appendChild(RB.html('<form class="form tn-add" novalidate><div class="field"><label for="tnName">Add a tenant</label><input id="tnName" name="name" maxlength="80" placeholder="Client name, e.g. Acme Care" autocomplete="off"></div><div class="btn-row"><button type="submit" class="btn sm btn--primary">Add tenant</button></div><p class="gate-err" data-tn-err role="alert" hidden></p></form>'));
    let m;
    const refresh = async () => { await loadTenants(); draw(); };
    body.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-t]'); if (!b) return;
      const id = b.closest('[data-id]').dataset.id, t = tenants.find((x) => x.id === id); say('');
      try {
        if (b.dataset.t === 'open') { m.close(); await openTenantById(id); }
        else if (b.dataset.t === 'rename') {
          const n = prompt('New name for this tenant', t.name); if (!n || !n.trim() || n.trim() === t.name) return;
          await api('PATCH', '/tenants/' + encodeURIComponent(id), { name: n.trim() });
          if (tenant && tenant.id === id) { tenant.name = n.trim(); RB.store.commit('Renamed the workspace to ' + n.trim(), (s) => { s.workspace = n.trim(); }); }
          await refresh(); if (tenant) { tenant = tenants.find((x) => x.id === tenant.id) || tenant; } RB.render();
        } else if (b.dataset.t === 'remove') {
          if (!confirm('Remove "' + t.name + '" with all its sites, racks and devices? This can not be undone from the app (the daily backups still hold it).')) return;
          const was = tenant && tenant.id === id;
          await api('DELETE', '/tenants/' + encodeURIComponent(id)); await refresh();
          if (was) { try { localStorage.removeItem(TKEY()); } catch (er) { /* ignore */ } m.close(); tenant = pickTenant(); if (tenant) await openTenantById(tenant.id); }
        }
      } catch (er) { say(er.message); }
    });
    body.addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.target, eEl = f.querySelector('[data-tn-err]'), btn = f.querySelector('button[type=submit]');
      eEl.hidden = true; btn.disabled = true;
      try {
        const r = await api('POST', '/tenants', { name: f.elements.name.value.trim() });
        await loadTenants(); m.close(); await openTenantById(r.id, true);
      } catch (er) { eEl.textContent = er.message; eEl.hidden = false; }
      finally { btn.disabled = false; }
    });
    m = RB.modal.open({ title: 'Tenants', body, sticky: true, actions: [{ label: 'Done', kind: 'primary', onClick: (x) => x.close() }] });
  }
  RB.openTenants = openTenants;
  RB.currentTenant = () => tenant;
  const initials = (n) => String(n || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
  function renderButton() {
    const b = document.getElementById('acctBtn'); if (!b || !me) return;
    b.innerHTML = '<span class="avatar">' + esc(initials(me.name || me.email)) + '</span><span class="acct-text"><b>' + esc(me.name || me.email) + '</b><span>' + esc(roleOf(me.role).name) + '</span></span>';
    b.title = 'Your account'; b.setAttribute('aria-label', 'Your account: ' + (me.name || me.email) + ', ' + roleOf(me.role).name);
  }
  function signOut(msg) {
    api('POST', '/auth/logout').catch(() => { /* already ended */ }).finally(() => {
      clearToken();
      try { if (msg) sessionStorage.setItem('rackbook.gate.msg', msg); } catch (e) { /* storage blocked */ }
      location.reload();
    });
  }
  function install() {
    const A = RB.auth, R = RB.authRules;
    A.enforcing = () => true;
    A.user = () => me;
    A.can = (what) => rank(me) >= (R.NEED[what] || 5);
    A.mayCommit = (label) => {
      if (!me) return false;
      if (!label || R.ADMIN_RE.test(label)) return rank(me) >= 4;
      if (R.TECH_RE.test(label)) return rank(me) >= 2;
      return rank(me) >= 3;
    };
    A.refuse = (what) => {
      RB.toast((what ? '"' + String(what).slice(0, 60) + '" needs a higher role. ' : '') + 'You are signed in as ' + (me ? roleOf(me.role).name : 'signed out') + '. Ask an Admin if you need more.', 'error');
      if (RB.render && RB.ui) setTimeout(() => RB.render(), 0);
    };
    A.currentName = () => (me ? me.name || me.email : null);
    A.rank = () => rank(me);
    A.ssoReady = () => true;
    A.signInAgain = () => { clearToken(); location.reload(); return Promise.resolve(); };
    A.tenantName = () => '';
    A.renderButton = renderButton;
    A.signOut = () => signOut();
    RB.openAccount = openAccount;
    RB.openUsers = openUsers;
  }

  srv.boot = async function () {
    srv.on = true; install();
    let err = null;
    try { state = await api('GET', '/auth/state'); } catch (e) { state = null; err = e.message; }
    if (state && state.build) RB.setBuild(state.build);
    if (state) { try { await finishSso(); } catch (e) { err = e.message; } }
    if (!me && readToken()) { try { me = (await api('GET', '/auth/me')).user; } catch (e) { clearToken(); } }
    if (!me) await showGate(err);
    await loadTenants();
    apply();
    // End the session when it runs out.
    setInterval(() => { if (!readToken()) signOut('Your session ended. Login again.'); }, 60000);
    RB.sessionExpired = () => signOut('Your session ended. Login again.');
  };
  const prevBoot = RB.auth.boot;
  RB.auth.boot = async function () { if (await srv.detect()) return srv.boot(); return prevBoot.apply(this, arguments); };

  /* ---------- your account ---------- */
  function openAccount() {
    const body = RB.html('<div class="acct"><div class="acct-head"><span class="avatar avatar--lg">' + esc(initials(me.name || me.email)) + '</span><div><b>' + esc(me.name || me.email) + '</b><span>' + esc(me.email) + '</span></div><span class="role-pill role--' + me.role + '">' + esc(roleOf(me.role).name) + '</span></div>' +
      '<p class="hint">' + esc(roleOf(me.role).desc) + '</p>' +
      (me.source === 'sso' && !me.hasPassword ? '' : '') +
      '<h3 class="sub">Password</h3><form class="form" data-f="pw" novalidate>' +
      '<div class="field"><label for="acOld">Current password</label><input id="acOld" name="old" type="password" autocomplete="current-password"></div>' +
      '<div class="field field--half"><label for="acN1">New password</label><input id="acN1" name="n1" type="password" autocomplete="new-password"></div>' +
      '<div class="field field--half"><label for="acN2">New password again</label><input id="acN2" name="n2" type="password" autocomplete="new-password"></div>' +
      '<button type="submit" class="btn sm">Change password</button></form>' +
      '<h3 class="sub">Two-step sign-in</h3><div data-f="tfa"></div><p class="gate-err" role="alert" hidden></p></div>');
    const err = body.querySelector('.gate-err'); const say = (t) => { err.textContent = t || ''; err.hidden = !t; };
    body.querySelector('[data-f=pw]').addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.target;
      if (f.n1.value !== f.n2.value) return say('The two passwords are not the same.');
      try { await api('POST', '/auth/password', { current: f.old.value, newPassword: f.n1.value }); say(''); RB.toast('Password saved'); f.reset(); } catch (er) { say(er.message); }
    });
    const tfa = body.querySelector('[data-f=tfa]');
    function draw() {
      if (me.totp) {
        tfa.innerHTML = '<p class="hint ok">' + RB.icon('shield', 14) + ' On. You are asked for a code from your authenticator app each time you sign in with your password.</p>' +
          (state.twoFactor === 'everyone' || (state.twoFactor === 'admins' && rank(me) >= 4) ? '<p class="hint">Your organisation asks for it, so it stays on.</p>' : '<div class="btn-row"><button type="button" class="btn sm btn--danger-ghost" data-t="off">Turn off</button></div>');
      } else if (me.source === 'sso') {
        tfa.innerHTML = '<p class="hint">You sign in with single sign-on, so your provider handles extra sign-in checks for you.</p>';
      } else tfa.innerHTML = '<p class="hint">Ask for a code from Google Authenticator or Microsoft Authenticator as well as your password.</p><div class="btn-row"><button type="button" class="btn sm btn--primary" data-t="on">Set up</button></div>';
    }
    tfa.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-t]'); if (!b) return;
      try {
        if (b.dataset.t === 'on') {
          const r = await api('POST', '/auth/2fa/begin'); tfa.dataset.secret = r.secret;
          tfa.innerHTML = tfaSetupHtml(r.secret, r.uri) + '<div class="form"><div class="field field--half"><label for="acCode">Code from the app</label><input id="acCode" inputmode="numeric" autocomplete="one-time-code" maxlength="7"></div></div><div class="btn-row"><button type="button" class="btn sm btn--primary" data-t="confirm">Turn on</button><button type="button" class="btn sm" data-t="cancel">Cancel</button></div>';
          tfa.querySelector('#acCode').focus();
        } else if (b.dataset.t === 'cancel') draw();
        else if (b.dataset.t === 'confirm') {
          const r = await api('POST', '/auth/2fa/enable', { secret: tfa.dataset.secret, code: tfa.querySelector('#acCode').value });
          me.totp = true; say('');
          tfa.innerHTML = '<p class="hint ok">' + RB.icon('shield', 14) + ' Two-step sign-in is on. Save these recovery codes: each works once, and they will not be shown again.</p>' + recoveryHtml(r.recovery);
          wireRecovery(tfa, r.recovery);
        } else if (b.dataset.t === 'off') {
          const pw = prompt('Enter your password to turn off two-step sign-in');
          if (pw === null) return;
          await api('POST', '/auth/2fa/disable', { password: pw }); me.totp = false; say(''); draw(); RB.toast('Two-step sign-in is off');
        }
      } catch (er) { say(er.message); }
    });
    draw();
    const actions = [];
    if (tenants.length > 1 || rank(me) >= 5) actions.push({ label: 'Tenants', left: true, onClick: (x) => { x.close(); openTenants(); } });
    if (RB.auth.can('users')) actions.push({ label: 'Users & access', left: true, onClick: (x) => { x.close(); RB.openUsers(); } });
    actions.push({ label: 'Sign out', kind: 'danger-ghost', onClick: () => signOut() });
    actions.push({ label: 'Done', kind: 'primary', onClick: (x) => x.close() });
    RB.modal.open({ title: 'Your account', body, actions });
  }

  /* ---------- users & access (Admins) ---------- */
  function openUsers(tab) {
    if (!RB.auth.can('users')) { RB.auth.refuse('Users & access'); return; }
    const isSuper = () => me.role === 'super_admin';
    const TABS = [['users', 'Users'], ['roles', 'Roles'], ['sso', 'Single sign-on', 5], ['security', 'Security', 5], ['activity', 'Activity'], ['backups', 'Backups']].filter((t) => !t[2] || rank(me) >= t[2]);
    let cur = TABS.some((t) => t[0] === tab) ? tab : 'users';
    const body = RB.html('<div class="ua"><div class="ua-tabs" role="tablist" aria-label="Users and access"></div><div class="ua-pane"></div><p class="gate-err" role="alert" hidden></p></div>');
    const tabsEl = body.querySelector('.ua-tabs'), pane = body.querySelector('.ua-pane'), err = body.querySelector('.gate-err');
    const say = (t) => { err.textContent = t || ''; err.hidden = !t; };
    let users = [], settings = null, providers = [];
    const assignable = () => ROLES.filter((r) => isSuper() || r.id !== 'super_admin');
    const mayManage = (u) => isSuper() || u.role !== 'super_admin';
    const when = (s) => (s ? RB.fmtDate(s * 1000) : '—');

    const PANES = {
      users() {
        const pend = users.filter((u) => u.status === 'pending');
        return (pend.length ? '<p class="hint warn">' + pend.length + ' account' + (pend.length > 1 ? 's are' : ' is') + ' waiting for approval.</p>' : '') +
          '<div class="tbl-wrap"><table class="tbl tbl--tight ua-users"><thead><tr><th>Person</th><th>Level</th><th>Status</th><th>Two-step</th><th>Last login</th><th></th></tr></thead><tbody>' +
          users.map((u) => {
            const ok = mayManage(u), self = u.id === me.id;
            return '<tr class="' + (u.status === 'disabled' ? 'is-off' : '') + '"><td><b>' + esc(u.name || u.email) + '</b><br><span class="hint">' + esc(u.email) + (u.source === 'sso' ? ' · SSO' : '') + (tenants.length > 1 ? ' · ' + (roleOf(u.role).rank >= 4 || u.tenants === 'all' ? 'All tenants' : (Array.isArray(u.tenants) ? u.tenants.filter((id) => tenants.some((t) => t.id === id)).length : 0) + ' of ' + tenants.length + ' tenants') : '') + '</span></td>' +
              '<td>' + (ok && !self ? '<select data-role="' + u.id + '" aria-label="Level for ' + esc(u.email) + '">' + assignable().map((r) => '<option value="' + r.id + '"' + (r.id === u.role ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('') + '</select>' : esc(roleOf(u.role).name)) + '</td>' +
              '<td>' + (u.locked ? 'Locked' : u.status === 'pending' ? 'Waiting' : u.status === 'disabled' ? 'Off' : 'Active') + '</td><td>' + (u.totp ? 'On' : '—') + '</td><td>' + when(u.lastLogin) + '</td>' +
              '<td class="ua-acts">' + (ok && !self ? (u.status === 'pending' ? '<button type="button" class="link-btn" data-act="approve" data-id="' + u.id + '">Approve</button>' : '') +
                '<button type="button" class="link-btn" data-act="' + (u.status === 'disabled' ? 'enable' : 'disable') + '" data-id="' + u.id + '">' + (u.status === 'disabled' ? 'Switch on' : 'Switch off') + '</button>' +
                (tenants.length > 1 && roleOf(u.role).rank < 4 ? '<button type="button" class="link-btn" data-act="utenants" data-id="' + u.id + '">Tenants</button>' : '') +
                (u.totp ? '<button type="button" class="link-btn" data-act="reset2fa" data-id="' + u.id + '">Reset 2-step</button>' : '') +
                (u.source === 'local' ? '<button type="button" class="link-btn" data-act="pw" data-id="' + u.id + '">Set password</button>' : '') +
                '<button type="button" class="link-btn danger" data-act="remove" data-id="' + u.id + '">Remove</button>' : '') + '</td></tr>';
          }).join('') + '</tbody></table></div>' +
          '<h3 class="sub">Add a person</h3><form class="form" data-f="add" novalidate>' +
          '<div class="field field--half"><label for="uaName">Name</label><input id="uaName" name="name"></div><div class="field field--half"><label for="uaEmail">Email</label><input id="uaEmail" name="email" type="email" required></div>' +
          '<div class="field field--half"><label for="uaRole">Level</label><select id="uaRole" name="role">' + assignable().map((r) => '<option value="' + r.id + '"' + (r.id === 'viewer' ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('') + '</select></div>' +
          '<div class="field field--half"><label for="uaPw">Temporary password</label><input id="uaPw" name="pw" type="text" autocomplete="off" placeholder="Blank = make one (10+ characters)"></div>' +
          '<div class="btn-row"><button type="submit" class="btn sm btn--primary">Add person</button></div><p class="gate-err" data-add-err role="alert" hidden></p></form><p class="hint">They choose their own password the first time they login.</p>';
      },
      roles() { return RB.rolesTableHtml(); },
      sso() {
        const redirect = redirectUri();
        return '<p class="intro">Let people login with the accounts they already have. Add one or more providers; each appears as a button under Login. The redirect address to register with the provider is <code class="tfa-key">' + esc(redirect) + '</code></p>' +
          '<div class="sso-list">' + providers.map((p, i) => ssoCard(p, i)).join('') + '</div>' +
          '<div class="btn-row"><select id="ssoAdd" aria-label="Provider to add">' + Object.entries(PRESETS).map(([k, v]) => '<option value="' + k + '">' + esc(v.label) + '</option>').join('') + '</select>' +
          '<button type="button" class="btn sm" data-act="sso-add">Add provider</button><button type="button" class="btn sm btn--primary" data-act="sso-save">Save providers</button></div>';
      },
      security() {
        const p = settings.policy;
        return '<form class="form" data-f="policy" novalidate>' +
          '<div class="field field--half"><label for="spSignup">Sign-up page</label><select id="spSignup" name="signup"><option value="approval"' + (p.signup === 'approval' ? ' selected' : '') + '>Open, an Admin approves each account</option><option value="open"' + (p.signup === 'open' ? ' selected' : '') + '>Open, accounts are ready straight away (Viewer)</option><option value="off"' + (p.signup === 'off' ? ' selected' : '') + '>Closed, Admins add people</option></select></div>' +
          '<div class="field field--half"><label for="spTf">Two-step sign-in</label><select id="spTf" name="tf"><option value="none"' + (p.twoFactor === 'none' ? ' selected' : '') + '>Optional (each person chooses)</option><option value="admins"' + (p.twoFactor === 'admins' ? ' selected' : '') + '>Required for Admins and Super Admins</option><option value="everyone"' + (p.twoFactor === 'everyone' ? ' selected' : '') + '>Required for everyone who uses a password</option></select></div>' +
          '<div class="field field--half"><label for="spHrs">Stay signed in for (hours)</label><input id="spHrs" name="hrs" type="number" min="1" max="168" value="' + esc(String(p.sessionHours)) + '"></div>' +
          '<button type="submit" class="btn sm btn--primary">Save</button></form><p class="hint">Single sign-on people use their provider\'s own multi-factor checks. Five wrong passwords lock an account for five minutes.</p>';
      },
      activity() {
        return '<div class="tbl-wrap"><table class="tbl tbl--tight"><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>' +
          (settings && settings.audit ? settings.audit.map((a) => '<tr><td>' + esc(when(a.ts)) + '</td><td>' + esc(a.actor) + '</td><td>' + esc(a.detail || a.action) + '</td></tr>').join('') : '<tr><td colspan="3">Loading…</td></tr>') + '</tbody></table></div>';
      },
      backups() {
        const v = settings && settings.versions;
        return '<p class="intro">The server keeps the last 40 saves of your records and a full copy of its database every day. Restore an earlier save below; the current records are kept as a save too.</p>' +
          (isSuper() ? '<div class="btn-row" style="margin:0 0 12px"><button type="button" class="btn sm" data-act="backup-now">Back up the database now</button></div>' : '') +
          '<div class="tbl-wrap"><table class="tbl tbl--tight"><thead><tr><th>Save</th><th>Saved</th><th>By</th><th></th></tr></thead><tbody>' +
          (v ? (v.length ? v.map((h) => '<tr><td>#' + h.rev + '</td><td>' + esc(RB.fmtDate(new Date(h.savedAt).getTime())) + '</td><td>' + esc(h.savedBy) + '</td><td class="ua-acts"><button type="button" class="link-btn" data-act="restore" data-id="' + h.id + '">Restore</button></td></tr>').join('') : '<tr><td colspan="4">No earlier saves yet.</td></tr>') : '<tr><td colspan="4">Loading…</td></tr>') + '</tbody></table></div>';
      },
    };
    function ssoCard(p, i) {
      const pr = PRESETS[p.preset] || PRESETS.other;
      const rules = (p.groupRoles || []).map((g) => g.group + ' = ' + g.role).join('\n');
      return '<details class="sso-card" data-i="' + i + '"' + (p._new ? ' open' : '') + '><summary><b>' + esc(p.name || pr.name) + '</b> <span class="hint">' + esc(pr.label) + (p.enabled === false ? ' · off' : '') + '</span></summary>' +
        '<p class="hint">' + esc(pr.help) + '</p><div class="form">' +
        '<div class="field field--half"><label>Button name</label><input data-k="name" value="' + esc(p.name || '') + '"></div>' +
        '<div class="field field--half"><label>Client ID</label><input data-k="clientId" value="' + esc(p.clientId || '') + '" autocomplete="off"></div>' +
        '<div class="field"><label>Issuer address</label><input data-k="issuer" value="' + esc(p.issuer || '') + '" placeholder="https://"></div>' +
        '<div class="field field--half"><label>Only these email domains (optional)</label><input data-k="domains" value="' + esc(p.domains || '') + '" placeholder="example.com.au"></div>' +
        '<div class="field field--half"><label>People with no group get</label><select data-k="defaultRole"><option value="viewer"' + (p.defaultRole !== 'technician' && p.defaultRole !== 'editor' ? ' selected' : '') + '>Viewer</option><option value="technician"' + (p.defaultRole === 'technician' ? ' selected' : '') + '>Technician</option><option value="editor"' + (p.defaultRole === 'editor' ? ' selected' : '') + '>Editor</option></select></div>' +
        '<div class="field"><label>Group → level (one per line, e.g. <code>group-id = admin</code>)</label><textarea data-k="groups" rows="3" placeholder="aaaaaaaa-0000 = super_admin">' + esc(rules) + '</textarea></div>' +
        '<div class="field field--half"><label>Always Super Admin (emails)</label><input data-k="superAdmins" value="' + esc(Array.isArray(p.superAdmins) ? p.superAdmins.join(', ') : p.superAdmins || '') + '"></div>' +
        '<div class="field field--half"><label>Groups claim</label><input data-k="groupClaim" value="' + esc(p.groupClaim || 'groups') + '"></div>' +
        '<label class="chk"><input type="checkbox" data-k="requireGroup"' + (p.requireGroup ? ' checked' : '') + '> Refuse people who are in none of the groups above</label>' +
        '<label class="chk"><input type="checkbox" data-k="autoCreate"' + (p.autoCreate !== false ? ' checked' : '') + '> Make an account the first time someone logs in</label>' +
        '<label class="chk"><input type="checkbox" data-k="enabled"' + (p.enabled !== false ? ' checked' : '') + '> Show this provider on the Login page</label>' +
        '</div><div class="btn-row"><button type="button" class="link-btn danger" data-act="sso-del" data-i="' + i + '">Remove this provider</button></div></details>';
    }
    function readSso() {
      return providers.map((p, i) => {
        const card = pane.querySelector('.sso-card[data-i="' + i + '"]'); if (!card) return p;
        const g = (k) => { const e = card.querySelector('[data-k="' + k + '"]'); return e ? (e.type === 'checkbox' ? e.checked : e.value) : ''; };
        const rules = String(g('groups')).split('\n').map((l) => l.split('=')).filter((a) => a.length >= 2 && a[0].trim()).map((a) => ({ group: a[0].trim(), role: a.slice(1).join('=').trim() }));
        return { id: p.id, preset: p.preset, name: g('name'), issuer: g('issuer'), clientId: g('clientId'), scopes: p.scopes, flow: p.flow, domains: g('domains'), defaultRole: g('defaultRole'), groupRoles: rules, superAdmins: g('superAdmins'), groupClaim: g('groupClaim'), requireGroup: g('requireGroup'), autoCreate: g('autoCreate'), enabled: g('enabled') };
      });
    }

    async function load(which) {
      try {
        if (which === 'users') users = (await api('GET', '/users')).users;
        if (which === 'sso' || which === 'security') { settings = Object.assign(settings || {}, await api('GET', '/settings')); providers = settings.providers || []; }
        if (which === 'activity') { settings = settings || {}; settings.audit = (await api('GET', '/audit')).events; }
        if (which === 'backups') { settings = settings || {}; settings.versions = (await api('GET', '/tenants/default/history')).versions; }
      } catch (e) { say(e.message); }
    }
    async function draw() {
      tabsEl.innerHTML = TABS.map(([id, l]) => '<button type="button" role="tab" class="ua-tab' + (id === cur ? ' is-on' : '') + '" aria-selected="' + (id === cur) + '" data-tab="' + id + '">' + l + '</button>').join('');
      pane.innerHTML = '<p class="hint">Loading…</p>'; say('');
      await load(cur);
      if (cur === 'security' && !(settings && settings.policy)) return;
      pane.innerHTML = PANES[cur]();
    }
    body.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-tab]'); if (t) { cur = t.dataset.tab; draw(); return; }
      const b = e.target.closest('[data-act]'); if (!b) return;
      const id = b.dataset.id, a = b.dataset.act;
      try {
        if (a === 'approve') { await api('POST', '/users/' + id + '/approve', { role: 'viewer' }); RB.toast('Approved as Viewer. Change their level if needed.'); }
        else if (a === 'disable' || a === 'enable') await api('PATCH', '/users/' + id, { status: a === 'disable' ? 'disabled' : 'active' });
        else if (a === 'utenants') {
          const u = users.find((x) => x.id === id); await loadTenants();
          const all = !Array.isArray(u.tenants);
          const tb = RB.html('<div><p class="intro">Choose which tenants <b>' + esc(u.name || u.email) + '</b> can open. Admins and Super Admins always see every tenant. They are signed out so the change applies straight away.</p>' +
            '<label class="check"><input type="checkbox" data-all' + (all ? ' checked' : '') + '> <span>All tenants (including ones added later)</span></label>' +
            tenants.map((t) => '<label class="check"><input type="checkbox" data-tid="' + esc(t.id) + '"' + (all || u.tenants.includes(t.id) ? ' checked' : '') + (all ? ' disabled' : '') + '> <span>' + esc(t.name) + '</span></label>').join('') + '<p class="gate-err" role="alert" hidden></p></div>');
          const allBox = tb.querySelector('[data-all]');
          allBox.addEventListener('change', () => tb.querySelectorAll('[data-tid]').forEach((c) => { c.disabled = allBox.checked; if (allBox.checked) c.checked = true; }));
          RB.modal.open({ title: 'Tenants for ' + (u.name || u.email), body: tb, actions: [
            { label: 'Cancel', onClick: (x) => x.close() },
            { label: 'Save', kind: 'primary', onClick: async (x) => {
              const ids = [...tb.querySelectorAll('[data-tid]')].filter((c) => c.checked).map((c) => c.dataset.tid);
              const er = tb.querySelector('.gate-err');
              if (!allBox.checked && !ids.length) { er.textContent = 'Choose at least one tenant, or tick All tenants.'; er.hidden = false; return; }
              try { await api('PATCH', '/users/' + id, { tenants: allBox.checked ? 'all' : ids }); x.close(); RB.toast('Tenants saved'); await draw(); } catch (e2) { er.textContent = e2.message; er.hidden = false; }
            } }] });
          return;
        }
        else if (a === 'reset2fa') { if (!confirm('Turn off two-step sign-in for this person? They can set it up again.')) return; await api('POST', '/users/' + id + '/reset-2fa'); }
        else if (a === 'pw') { const pw = prompt('Temporary password (at least 10 characters). They choose their own at next login.'); if (!pw) return; await api('POST', '/users/' + id + '/password', { password: pw }); RB.toast('Password set'); return; }
        else if (a === 'remove') { if (!confirm('Remove this person? This can not be undone.')) return; await api('DELETE', '/users/' + id); }
        else if (a === 'sso-add') { const k = pane.querySelector('#ssoAdd').value; const pr = PRESETS[k]; providers = readSso(); providers.push({ preset: k, name: pr.name, issuer: pr.issuer, flow: pr.flow, scopes: 'openid profile email', enabled: true, autoCreate: true, groupClaim: 'groups', groupRoles: [], _new: true }); pane.innerHTML = PANES.sso(); return; }
        else if (a === 'sso-del') { providers = readSso(); providers.splice(+b.dataset.i, 1); pane.innerHTML = PANES.sso(); return; }
        else if (a === 'sso-save') { providers = readSso(); const r = await api('PUT', '/settings/sso', { providers }); providers = r.providers; RB.toast('Single sign-on saved'); pane.innerHTML = PANES.sso(); return; }
        else if (a === 'backup-now') { const r = await api('POST', '/admin/backup'); RB.toast('Backed up: ' + r.file); return; }
        else if (a === 'restore') {
          if (!confirm('Restore this earlier save? The current records are kept as a save too.')) return;
          await api('POST', '/tenants/default/history/' + id + '/restore'); RB.toast('Restored. Reloading…'); setTimeout(() => location.reload(), 800); return;
        }
        say(''); await draw();
      } catch (er) { say(er.message); }
    });
    body.addEventListener('change', async (e) => {
      // Only the Level drop-downs in the table. (A bare [data-role] also matches the page itself, which carries the signed-in person's level,
      // so leaving any field fired a change of level for "super_admin", failed, and redrew the form, wiping what had been typed.)
      const s = e.target.closest('select[data-role]'); if (!s || !body.contains(s)) return;
      try { await api('PATCH', '/users/' + s.dataset.role, { role: s.value }); RB.toast('Level changed'); say(''); } catch (er) { say(er.message); draw(); }
    });
    body.addEventListener('submit', async (e) => {
      e.preventDefault(); const f = e.target;
      try {
        if (f.dataset.f === 'add') {
          // Errors show right under the button (the one at the bottom of the window can be out of sight), and the button is off while it saves.
          const eEl = f.querySelector('[data-add-err]'), btn = f.querySelector('button[type=submit]');
          eEl.hidden = true; btn.disabled = true;
          let r;
          try { r = await api('POST', '/users', { name: f.elements.name.value.trim(), email: f.elements.email.value.trim(), role: f.elements.role.value, password: f.elements.pw.value }); }
          catch (er) { eEl.textContent = er.message; eEl.hidden = false; eEl.scrollIntoView({ block: 'nearest' }); return; }
          finally { btn.disabled = false; }
          RB.modal.open({ title: 'Person added', body: RB.html('<div><p class="intro">Give <b>' + esc(r.user.email) + '</b> this temporary password. They choose their own when they login.</p><p><code class="tfa-key">' + esc(r.temporaryPassword) + '</code></p></div>'), actions: [{ label: 'Done', kind: 'primary', onClick: (m) => m.close() }] });
          say(''); await draw();
        } else if (f.dataset.f === 'policy') {
          await api('PUT', '/settings/policy', { signup: f.signup.value, twoFactor: f.tf.value, sessionHours: +f.hrs.value });
          state.signup = f.signup.value; state.twoFactor = f.tf.value; settings.policy = { signup: f.signup.value, twoFactor: f.tf.value, sessionHours: +f.hrs.value }; RB.toast('Saved'); say('');
        }
      } catch (er) { say(er.message); }
    });
    RB.modal.open({ title: 'Users & access', body, wide: true, sticky: true, actions: [{ label: 'Done', kind: 'primary', onClick: (m) => m.close() }] });
    draw();
  }
})();
