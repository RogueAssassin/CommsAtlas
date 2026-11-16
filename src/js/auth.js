/* CommsAtlas — accounts: local users with role levels, single sign-on (OpenID Connect with PKCE),
   two-step codes (authenticator apps), tenants, and the sign-in screen. Everything is kept in this
   browser; nothing is sent anywhere except to the sign-in provider a Super Admin sets up. */
(function () {
  'use strict';
  const RB = window.RB;
  const esc = RB.esc;
  const AKEY = 'rackbook.auth.v1';
  const SKEY = 'rackbook.session.v1';
  const FLOW_KEY = 'rackbook.sso.flow';
  const ITER = 210000;
  const subtle = window.crypto && window.crypto.subtle;
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  /* ---------- roles ---------- */
  const ROLES = [
    { id: 'super_admin', name: 'Super Admin', rank: 5, desc: 'Everything, including single sign-on, tenants, security rules and other Super Admins.' },
    { id: 'admin', name: 'Admin', rank: 4, desc: 'Adds and manages users (up to Admin) and which tenants they see, backs up, restores and resets workspaces, and everything an Editor can do.' },
    { id: 'editor', name: 'Editor', rank: 3, desc: 'Adds, changes and removes sites, comms rooms, racks, devices, cables, VLANs and library models, and imports spreadsheets.' },
    { id: 'technician', name: 'Technician', rank: 2, desc: 'Patches and unpatches cables, sets port details (VLAN, label, status, cable colour), device IPs, MACs and serials, notes and photos.' },
    { id: 'viewer', name: 'Viewer', rank: 1, desc: 'Looks, searches, traces cables, prints rack sheets and downloads Excel and CSV. Changes nothing.' },
  ];
  RB.ROLES = ROLES;
  const roleOf = (id) => ROLES.find((r) => r.id === id) || ROLES[ROLES.length - 1];
  const NEED = { view: 1, export: 1, patch: 2, edit: 3, import: 3, undo: 3, data: 4, users: 4, sso: 5, tenants: 5, security: 5 };
  const CAPS = [
    ['View, search, trace cables and print rack sheets', 1],
    ['Download Excel and CSV', 1],
    ['Patch cables, set port details, IPs, MACs, notes and photos', 2],
    ['Add, change and remove sites, comms rooms, racks and devices', 3],
    ['Import spreadsheets and edit the device library and VLANs', 3],
    ['Undo and redo', 3],
    ['Back up, restore, empty or rename a workspace', 4],
    ['Add and manage users and the tenants they see', 4],
    ['Single sign-on, tenants and security rules', 5],
  ];
  // Which changes need which level. Anything not listed needs an Editor.
  const ADMIN_RE = /^(Workspace imported|Example workspace loaded|Workspace emptied|Renamed workspace|History cleared)/;
  const TECH_RE = /^(Connected |Disconnected |Edited a cable|Set VLAN on |Labelled |Set status of |Set (?:cable|lead) colour of |Set tagged VLANs on |Set patch point of |Set device type on |Noted |Updated notes on |Added a photo to |Removed the photo of |Changed (ip|mac|serial|asset tag|platform|notes|firmware|hostname) of )/i;

  /* ---------- sign-in providers ---------- */
  const PRESETS = {
    entra: { label: 'Microsoft Entra ID (Microsoft 365)', name: 'Microsoft', issuer: 'https://login.microsoftonline.com/YOUR-DIRECTORY-ID/v2.0', flow: 'code', help: 'In Microsoft Entra ID open App registrations, add a registration and choose "Single-page application" as the platform with the redirect address below. Copy the Application (client) ID here and put the Directory (tenant) ID into the issuer.' },
    google: { label: 'Google Workspace', name: 'Google', issuer: 'https://accounts.google.com', flow: 'id_token', help: 'In Google Cloud console create an OAuth client ID of type "Web application". Add this site under Authorised JavaScript origins and the redirect address below under Authorised redirect URIs.' },
    okta: { label: 'Okta', name: 'Okta', issuer: 'https://YOUR-ORG.okta.com', flow: 'code', help: 'In Okta create an OIDC app integration of type "Single-Page Application" with the redirect address below as its sign-in redirect URI, and this site as a trusted origin.' },
    auth0: { label: 'Auth0', name: 'Auth0', issuer: 'https://YOUR-TENANT.auth0.com/', flow: 'code', help: 'In Auth0 create a "Single Page Application" with the redirect address below under Allowed Callback URLs and this site under Allowed Web Origins.' },
    keycloak: { label: 'Keycloak', name: 'Keycloak', issuer: 'https://YOUR-HOST/realms/YOUR-REALM', flow: 'code', help: 'In Keycloak create an OpenID Connect client with Client authentication off and Standard flow on. Put the redirect address below under Valid redirect URIs and this site under Web origins.' },
    authentik: { label: 'authentik', name: 'authentik', issuer: 'https://YOUR-HOST/application/o/YOUR-APP/', flow: 'code', help: 'In authentik create an OAuth2/OpenID provider with Client type "Public" and the redirect address below, then an application that uses it.' },
    other: { label: 'Other OpenID Connect provider', name: 'single sign-on', issuer: '', flow: 'code', help: 'Any OpenID Connect provider that allows a public (single-page) client using PKCE, or the id_token flow.' },
  };

  /* ---------- small crypto helpers ---------- */
  function rand(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; }
  function b64u(bytes) {
    const a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let s = ''; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64u(str) {
    let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s); const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }
  const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  function b32(bytes) {
    let bits = 0, val = 0, out = '';
    for (const b of bytes) { val = ((val << 8) | b) & 0xffff; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
    if (bits > 0) out += B32[(val << (5 - bits)) & 31];
    return out;
  }
  function unb32(str) {
    const s = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
    let bits = 0, val = 0; const out = [];
    for (const c of s) { val = ((val << 5) | B32.indexOf(c)) & 0xffff; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
    return new Uint8Array(out);
  }
  function same(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
  async function pbkdf2(pw, salt, iter) {
    const k = await subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
    return b64u(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, k, 256));
  }
  async function makePass(pw) { const salt = rand(16); return { salt: b64u(salt), iter: ITER, hash: await pbkdf2(pw, salt, ITER) }; }
  async function checkPass(p, pw) {
    if (!p) { await pbkdf2(pw, rand(16), ITER); return false; } // same work either way
    return same(await pbkdf2(pw, unb64u(p.salt), p.iter || ITER), p.hash);
  }
  async function hotp(secret, counter) {
    const key = await subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
    const buf = new ArrayBuffer(8); const v = new DataView(buf);
    v.setUint32(0, Math.floor(counter / 4294967296)); v.setUint32(4, counter >>> 0);
    const h = new Uint8Array(await subtle.sign('HMAC', key, buf));
    const o = h[19] & 15;
    const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
    return String(n % 1000000).padStart(6, '0');
  }
  /** Checks a 6-digit code against the secret, allowing 30 seconds either side; refuses a code used twice. */
  async function checkTotp(u, secretB32, code) {
    const c = String(code || '').replace(/\D/g, '');
    if (c.length !== 6) return false;
    const s = unb32(secretB32); const t = Math.floor(Date.now() / 30000);
    for (const d of [0, -1, 1]) {
      if (await hotp(s, t + d) === c) {
        if (u && u.totpStep && u.totpStep >= t + d) return false;
        if (u) u.totpStep = t + d;
        return true;
      }
    }
    return false;
  }
  RB._totp = { hotp, b32, unb32 }; // for checks

  /* ---------- accounts store ---------- */
  function blank() {
    return {
      version: 1, users: [], log: [],
      tenants: [{ id: 'default', name: 'Main tenant' }],
      // Single sign-on is the way in for everyone; groups from the provider decide each person's level.
      sso: { enabled: false, provider: 'entra', name: 'Microsoft', issuer: '', clientId: '', scopes: 'openid profile email', flow: 'code', autoCreate: true, domains: '', defaultRole: 'viewer', allowPasswords: false,
        groupClaim: 'groups', groupRoles: [], groupsDecide: true, requireGroup: false, superAdmins: '' },
      policy: { twoFactor: 'none', sessionHours: 12, lockAfter: 5 },
    };
  }
  const SSO_ROLES = ['viewer', 'technician', 'editor', 'admin', 'super_admin'];
  /** Single sign-on set in config.js by whoever deployed the site: it can't be changed from inside the app. */
  function configSso() {
    const c = (window.APP_CONFIG || {}).sso;
    if (!c || typeof c !== 'object' || !c.issuer || !c.clientId) return null;
    const out = Object.assign({}, c, { enabled: c.enabled !== false, managed: true });
    if (Array.isArray(c.groupRoles)) out.groupRoles = c.groupRoles.filter((g) => g && g.group && SSO_ROLES.includes(g.role)).map((g) => ({ group: String(g.group), role: g.role }));
    if (Array.isArray(c.superAdmins)) out.superAdmins = c.superAdmins.join(', ');
    return out;
  }
  const ssoReady = () => !!(A.sso.enabled && A.sso.issuer && A.sso.clientId);
  let A = blank();
  let me = null;
  let session = null;

  function loadA() {
    let a = null;
    try { a = JSON.parse(localStorage.getItem(AKEY) || 'null'); } catch (e) { a = null; }
    const b = blank();
    const cfg = configSso();
    if (!a || typeof a !== 'object') { A = b; if (cfg) A.sso = Object.assign(b.sso, cfg); return; }
    a.users = Array.isArray(a.users) ? a.users.filter((u) => u && u.id && u.email) : [];
    a.tenants = Array.isArray(a.tenants) ? a.tenants.filter((t) => t && t.id) : [];
    if (!a.tenants.some((t) => t.id === 'default')) a.tenants.unshift(b.tenants[0]);
    a.sso = Object.assign(b.sso, a.sso || {}, cfg || { managed: false });
    if (!Array.isArray(a.sso.groupRoles)) a.sso.groupRoles = [];
    a.policy = Object.assign(b.policy, a.policy || {});
    a.log = Array.isArray(a.log) ? a.log : [];
    A = a;
  }
  function saveA() {
    try { localStorage.setItem(AKEY, JSON.stringify(A)); return true; } catch (e) { RB.toast('Could not save accounts: browser storage is full.', 'error'); return false; }
  }
  function log(text) { A.log.unshift({ ts: Date.now(), text }); if (A.log.length > 300) A.log.length = 300; }
  // Sign-in is required once there is an account, or as soon as single sign-on is set up.
  const enforcing = () => A.users.length > 0 || ssoReady();
  const rank = (u) => (u ? roleOf(u.role).rank : 0);
  const superCount = () => A.users.filter((u) => u.role === 'super_admin' && !u.disabled).length;
  function newUser(o) {
    return { id: RB.uid('usr'), name: o.name || '', email: String(o.email || '').trim().toLowerCase(), role: o.role || 'viewer', pass: o.pass || null, totp: null, tenants: o.tenants || 'all', disabled: false, sso: !!o.sso, mustChange: !!o.mustChange, created: Date.now(), lastLogin: 0, failed: 0, lockedUntil: 0 };
  }
  function tenantsFor(u) {
    if (!u) return A.tenants.slice();
    if (rank(u) >= 4 || u.tenants === 'all') return A.tenants.slice();
    const ids = Array.isArray(u.tenants) ? u.tenants : [];
    return A.tenants.filter((t) => ids.includes(t.id));
  }
  function needsTwoFactor(u) { return A.policy.twoFactor === 'everyone' || (A.policy.twoFactor === 'admins' && rank(u) >= 4); }
  const initials = (n) => String(n || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
  const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

  /* ---------- session ---------- */
  function readSession() { try { return JSON.parse(localStorage.getItem(SKEY) || 'null'); } catch (e) { return null; } }
  function writeSession(s) { session = s; try { if (s) localStorage.setItem(SKEY, JSON.stringify(s)); else localStorage.removeItem(SKEY); } catch (e) { /* storage full */ } }
  function startSession(u, method) {
    const ts = tenantsFor(u);
    if (!ts.length) throw new Error('You have not been given any tenants yet. Ask an Admin.');
    const tenant = (ts.find((t) => t.id === u.lastTenant) || ts[0]).id;
    u.lastLogin = Date.now(); u.failed = 0; u.lockedUntil = 0;
    const hours = RB.clamp(parseInt(A.policy.sessionHours, 10) || 12, 1, 168);
    writeSession({ uid: u.id, method, tenant, exp: Date.now() + hours * 3600000 });
    me = u;
    log(u.name + ' signed in' + (method === 'sso' ? ' with single sign-on' : ''));
    saveA();
  }
  function applyTenant() {
    const t = A.tenants.find((x) => x.id === (session && session.tenant)) || A.tenants[0];
    RB.store.useTenant(t.id, t.name);
    if (me) document.documentElement.setAttribute('data-role', me.role); else document.documentElement.removeAttribute('data-role');
    renderButton();
  }

  /* ---------- public checks used by the rest of the app ---------- */
  const auth = (RB.auth = {
    enforcing,
    user: () => me,
    can(what) { if (!enforcing()) return true; return rank(me) >= (NEED[what] || 5); },
    mayCommit(label) {
      if (!enforcing()) return true;
      if (!me) return false;
      if (!label || ADMIN_RE.test(label)) return rank(me) >= 4;
      if (TECH_RE.test(label)) return rank(me) >= 2;
      return rank(me) >= 3;
    },
    refuse(what) {
      const r = me ? roleOf(me.role).name : 'signed out';
      RB.toast((what ? '"' + String(what).slice(0, 60) + '" needs a higher role. ' : '') + 'You are signed in as ' + r + '. Ask an Admin if you need more.', 'error');
      if (RB.render && RB.ui) setTimeout(() => RB.render(), 0);
    },
    currentName: () => (me ? me.name || me.email : null),
    rank: () => (enforcing() ? rank(me) : 5),
    ssoReady,
    signInAgain: () => startSso(),
    tenantName() { const t = A.tenants.find((x) => x.id === (session && session.tenant)); return t ? t.name : ''; },
  });

  /* ---------- OpenID Connect ---------- */
  const redirectUri = () => location.origin + '/';
  async function discover(issuer) {
    const base = String(issuer || '').trim().replace(/\/+$/, '');
    if (!/^https:\/\//i.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(base + '/')) throw new Error('The issuer must be an https:// address.');
    let res;
    try { res = await fetch(base + '/.well-known/openid-configuration', { headers: { Accept: 'application/json' } }); } catch (e) { throw new Error('Could not reach ' + base + '. Check the issuer address and your connection.'); }
    if (!res.ok) throw new Error('The issuer answered ' + res.status + '. Check the issuer address.');
    const conf = await res.json().catch(() => null);
    if (!conf || !conf.authorization_endpoint || !conf.issuer) throw new Error('That address does not look like an OpenID Connect issuer.');
    return conf;
  }
  async function startSso() {
    if (!subtle) throw new Error('Sign-in needs this site to be opened over https.');
    const sso = A.sso;
    const conf = await discover(sso.issuer);
    const state = b64u(rand(16)), nonce = b64u(rand(16)), verifier = b64u(rand(32));
    let scope = String(sso.scopes || 'openid profile email').trim();
    if (!/\bopenid\b/.test(scope)) scope = 'openid ' + scope;
    const p = new URLSearchParams({ client_id: sso.clientId, redirect_uri: redirectUri(), scope, state, nonce });
    if (sso.flow === 'id_token') { p.set('response_type', 'id_token'); p.set('response_mode', 'fragment'); }
    else {
      p.set('response_type', 'code');
      p.set('code_challenge', b64u(await subtle.digest('SHA-256', enc.encode(verifier))));
      p.set('code_challenge_method', 'S256');
    }
    sessionStorage.setItem(FLOW_KEY, JSON.stringify({ state, nonce, verifier, at: Date.now() }));
    location.assign(conf.authorization_endpoint + (conf.authorization_endpoint.includes('?') ? '&' : '?') + p.toString());
  }
  async function verifySig(header, parts, jwksUri) {
    if (!jwksUri) throw new Error('the provider lists no signing keys');
    const res = await fetch(jwksUri);
    if (!res.ok) throw new Error('signing keys answered ' + res.status);
    const keys = ((await res.json()) || {}).keys || [];
    const jwk = keys.find((k) => k.kid === header.kid) || (keys.length === 1 ? keys[0] : null);
    if (!jwk) throw new Error('no matching signing key');
    let key, algo;
    if (header.alg === 'RS256' && jwk.kty === 'RSA') {
      key = await subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      algo = { name: 'RSASSA-PKCS1-v1_5' };
    } else if (header.alg === 'ES256' && jwk.kty === 'EC') {
      key = await subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      algo = { name: 'ECDSA', hash: 'SHA-256' };
    } else throw new Error('signature type ' + header.alg + ' is not supported');
    const ok = await subtle.verify(algo, key, unb64u(parts[2]), enc.encode(parts[0] + '.' + parts[1]));
    if (!ok) { const e = new Error('bad signature'); e.bad = true; throw e; }
    return true;
  }
  async function checkIdToken(tok, conf, clientId, nonce, mustVerify) {
    const parts = String(tok).split('.');
    if (parts.length !== 3) throw new Error('The sign-in provider sent something that is not an identity token.');
    let header, c;
    try { header = JSON.parse(dec.decode(unb64u(parts[0]))); c = JSON.parse(dec.decode(unb64u(parts[1]))); } catch (e) { throw new Error('The identity token could not be read.'); }
    const iss = String(conf.issuer).replace('{tenantid}', c.tid || '');
    if (c.iss !== iss) throw new Error('The sign-in came from an unexpected issuer (' + c.iss + ').');
    const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
    if (!aud.includes(clientId)) throw new Error('The sign-in was meant for a different app.');
    if (!c.exp || c.exp * 1000 < Date.now() - 120000) throw new Error('The sign-in has expired. Try again.');
    if (c.nonce !== nonce) throw new Error('The sign-in reply did not match this sign-in. Try again.');
    try { await verifySig(header, parts, conf.jwks_uri); } catch (e) {
      if (e.bad) throw new Error('The sign-in signature is not valid.');
      // A token fetched straight from the provider over https can be trusted without it; one passed in the address can't.
      if (mustVerify) throw new Error('Could not check the sign-in signature: ' + e.message + '.');
    }
    return c;
  }
  function matchSsoUser(c) {
    const email = String(c.email || c.preferred_username || c.upn || '').trim().toLowerCase();
    if (!validEmail(email)) throw new Error('Your sign-in provider did not share an email address. Add the "email" scope.');
    const doms = String(A.sso.domains || '').split(/[\s,;]+/).map((s) => s.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
    if (doms.length && !doms.includes(email.split('@')[1])) throw new Error(email + ' is not from an allowed email domain.');
    const fromGroups = ssoRoleFor(c, email);
    const rules = (A.sso.groupRoles || []).length > 0;
    if (A.sso.requireGroup && rules && !fromGroups.role) throw new Error(email + ' is not in a group that is allowed in. Ask an Admin to add you to one.');
    const fallback = ['viewer', 'technician', 'editor'].includes(A.sso.defaultRole) ? A.sso.defaultRole : 'viewer';
    let u = A.users.find((x) => x.email === email);
    if (!u) {
      if (!A.sso.autoCreate && !fromGroups.role) throw new Error('There is no account for ' + email + '. Ask an Admin to add you.');
      // The very first person in, when nothing names a Super Admin, runs the place until groups are set up.
      const noSuperRule = !(A.sso.groupRoles || []).some((g) => g.role === 'super_admin') && !splitList(A.sso.superAdmins).length;
      const role = fromGroups.role || (A.users.length === 0 && noSuperRule ? 'super_admin' : fallback);
      u = newUser({ name: c.name || email.split('@')[0], email, role, sso: true });
      u.roleFrom = fromGroups.role ? 'group' : 'default';
      A.users.push(u);
      log('Account made for ' + email + ' on first single sign-on (' + roleOf(role).name + (fromGroups.role ? ', from ' + fromGroups.why : '') + ')');
    } else if (A.sso.groupsDecide !== false) {
      // Groups decide the level at every sign-in; a Super Admin with a break-glass password is never lowered by them.
      const next = fromGroups.role || (u.roleFrom === 'group' ? fallback : u.role);
      const keep = u.pass && u.role === 'super_admin' && rank({ role: next }) < rank(u);
      if (next !== u.role && !keep) { log(email + ' is now ' + roleOf(next).name + (fromGroups.role ? ' (from ' + fromGroups.why + ')' : ' (no matching group)')); u.role = next; }
      if (fromGroups.role) u.roleFrom = 'group';
    }
    if (u.disabled) throw new Error('The account for ' + email + ' is switched off. Ask an Admin.');
    if (!u.name && c.name) u.name = c.name;
    u.groups = fromGroups.matched;
    u.sso = true;
    return u;
  }
  const splitList = (v) => String(v || '').split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  /** The highest level the provider's groups (or app roles) give this person, and why. */
  function ssoRoleFor(c, email) {
    if (splitList(A.sso.superAdmins).includes(email)) return { role: 'super_admin', why: 'the Super Admin list', matched: [] };
    const names = Array.from(new Set([A.sso.groupClaim || 'groups', 'groups', 'roles']));
    const have = [];
    names.forEach((k) => { const v = c[k]; (Array.isArray(v) ? v : v ? String(v).split(/[\s,]+/) : []).forEach((g) => have.push(String(g).trim().toLowerCase())); });
    if (!have.length && c._claim_names && c._claim_names.groups) log('Single sign-on for ' + email + ': the provider sent too many groups to list. Use app roles, or send only groups assigned to the app.');
    let best = null; const matched = [];
    (A.sso.groupRoles || []).forEach((g) => {
      if (!have.includes(String(g.group).trim().toLowerCase())) return;
      matched.push(g.group);
      if (!best || roleOf(g.role).rank > roleOf(best.role).rank) best = g;
    });
    return best ? { role: best.role, why: 'group ' + best.group, matched } : { role: null, why: '', matched };
  }
  /** Finishes a sign-in provider's redirect back to this page, if there is one. */
  async function finishSso() {
    const q = new URLSearchParams(location.search);
    const h = new URLSearchParams(location.hash.replace(/^#/, ''));
    const src = q.get('state') ? q : (h.get('state') ? h : null);
    if (!src) return null;
    let flow = null;
    try { flow = JSON.parse(sessionStorage.getItem(FLOW_KEY) || 'null'); } catch (e) { flow = null; }
    sessionStorage.removeItem(FLOW_KEY);
    history.replaceState(null, '', location.pathname);
    if (!flow || flow.state !== src.get('state')) throw new Error('The single sign-on reply did not match a sign-in started here. Try again.');
    if (src.get('error')) throw new Error('Single sign-on said: ' + (src.get('error_description') || src.get('error')));
    if (Date.now() - flow.at > 10 * 60000) throw new Error('Single sign-on took too long. Try again.');
    if (!A.sso.enabled) throw new Error('Single sign-on is switched off.');
    const conf = await discover(A.sso.issuer);
    let idToken;
    if (src.get('code')) {
      const body = new URLSearchParams({ grant_type: 'authorization_code', code: src.get('code'), redirect_uri: redirectUri(), client_id: A.sso.clientId, code_verifier: flow.verifier });
      let res;
      try { res = await fetch(conf.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }); } catch (e) { throw new Error('Could not reach the sign-in provider to finish signing in. If it is Microsoft, make sure the app is registered as a "Single-page application".'); }
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.id_token) throw new Error('The sign-in provider refused: ' + (j.error_description || j.error || res.status));
      idToken = j.id_token;
    } else idToken = src.get('id_token');
    if (!idToken) throw new Error('No identity came back from single sign-on.');
    const claims = await checkIdToken(idToken, conf, A.sso.clientId, flow.nonce, !src.get('code'));
    // Kept for this tab only, so the CommsAtlas server (when there is one) can check the same sign-in once.
    try { sessionStorage.setItem('commsatlas.idt', idToken); } catch (e) { /* storage blocked */ }
    const u = matchSsoUser(claims);
    startSession(u, 'sso');
    return { ok: true };
  }

  /* ---------- start-up ---------- */
  auth.boot = async function () {
    loadA();
    let err = null;
    try { await finishSso(); } catch (e) { err = e.message; saveA(); }
    if (!enforcing()) { applyTenant(); return; }
    session = readSession();
    me = session ? A.users.find((u) => u.id === session.uid && !u.disabled) || null : null;
    if (!me || !(session.exp > Date.now()) || !tenantsFor(me).some((t) => t.id === session.tenant)) {
      writeSession(null); me = null;
      await showGate(err);
    }
    applyTenant();
    // End the session when it runs out, or when another tab signs out.
    setInterval(() => { if (session && session.exp < Date.now()) signOut('Your session ended. Sign in again.'); }, 60000);
    window.addEventListener('storage', (e) => {
      if (e.key === SKEY) { const s = readSession(); if (!s || !session || s.uid !== session.uid) location.reload(); }
      if (e.key === AKEY) { loadA(); const u = me && A.users.find((x) => x.id === me.id); if (!u || u.disabled || u.role !== me.role) location.reload(); else me = u; }
    });
  };
  function signOut(msg) {
    if (me) { log(me.name + ' signed out'); saveA(); }
    writeSession(null);
    try { localStorage.removeItem('commsatlas.srv.token'); sessionStorage.removeItem('commsatlas.idt'); } catch (e) { /* storage blocked */ }
    if (msg) sessionStorage.setItem('rackbook.gate.msg', msg);
    location.reload();
  }
  auth.signOut = () => signOut();

  /* ---------- the sign-in screen ---------- */
  function showGate(errMsg) {
    return new Promise((resolve) => {
      const carried = sessionStorage.getItem('rackbook.gate.msg');
      sessionStorage.removeItem('rackbook.gate.msg');
      const el = RB.html('<div class="gate" role="dialog" aria-modal="true" aria-labelledby="gateTitle"><div class="gate-card"></div></div>');
      document.body.appendChild(el);
      document.documentElement.classList.add('is-locked');
      const card = el.querySelector('.gate-card');
      const head = '<div class="gate-brand">' + RB.wordLogo('gate-wordmark', 84) + '</div>';
      const note = '<p class="gate-note">' + RB.icon('lock', 14) + ' Accounts and records are kept in this browser on this computer.</p>';
      const errP = (m) => '<p class="gate-err" role="alert"' + (m ? '' : ' hidden') + '>' + esc(m || '') + '</p>';
      function step(html, wire) {
        card.innerHTML = head + html + note;
        if (wire) wire();
        const f = card.querySelector('input:not([type=hidden])');
        if (f) setTimeout(() => f.focus(), 20);
      }
      function fail(m) { const p = card.querySelector('.gate-err'); if (p) { p.textContent = m; p.hidden = false; } }
      function busy(btn, on, text) { if (!btn) return; btn.disabled = on; if (text) btn.textContent = text; }
      function finish(u) {
        try { startSession(u, 'password'); } catch (e) { fail(e.message); return; }
        el.remove(); document.documentElement.classList.remove('is-locked'); resolve();
      }
      function afterPassword(u) {
        if (u.mustChange) return newPassword(u);
        if (u.totp) return codeStep(u);
        if (needsTwoFactor(u)) return setupStep(u);
        finish(u);
      }

      function signIn(msg) {
        const sso = A.sso;
        const ssoOn = !!(sso.enabled && sso.issuer && sso.clientId);
        const pwOn = !ssoOn || sso.allowPasswords;
        step('<h1 id="gateTitle">Sign in</h1><p class="gate-sub">Sign in to open your sites, comms rooms and racks.</p>' + errP(msg) +
          (ssoOn ? '<button type="button" class="btn btn--primary gate-wide" data-g="sso">' + RB.icon('key') + ' Sign in with ' + esc(sso.name || 'single sign-on') + '</button>' : '') +
          (ssoOn && pwOn ? '<div class="gate-or"><span>or with your email and password</span></div>' : '') +
          '<form class="form gate-form"' + (pwOn ? '' : ' hidden') + ' novalidate>' +
          '<div class="field"><label for="gEmail">Email</label><input id="gEmail" name="email" type="email" autocomplete="username" required></div>' +
          '<div class="field"><label for="gPw">Password</label><input id="gPw" name="pw" type="password" autocomplete="current-password" required></div>' +
          '<button type="submit" class="btn btn--primary gate-wide">Sign in</button></form>' +
          (pwOn ? '' : '<button type="button" class="link-btn gate-alt" data-g="pw">Super Admin password sign-in</button>'),
        () => {
          const form = card.querySelector('form');
          card.addEventListener('click', async (e) => {
            const b = e.target.closest('[data-g]'); if (!b) return;
            if (b.dataset.g === 'pw') { form.hidden = false; b.remove(); form.querySelector('input').focus(); }
            if (b.dataset.g === 'sso') {
              busy(b, true, 'Opening ' + (sso.name || 'single sign-on') + '…');
              try { await startSso(); } catch (err) { busy(b, false, 'Sign in with ' + (sso.name || 'single sign-on')); fail(err.message); }
            }
          });
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = form.email.value.trim().toLowerCase();
            const pw = form.pw.value;
            if (!email || !pw) { fail('Enter your email and password.'); return; }
            if (!subtle) { fail('Sign-in needs this site to be opened over https.'); return; }
            const btn = form.querySelector('[type=submit]');
            busy(btn, true, 'Checking…');
            const u = A.users.find((x) => x.email === email);
            if (u && u.lockedUntil > Date.now()) { await checkPass(null, pw); busy(btn, false, 'Sign in'); fail('Too many wrong tries. Try again in ' + Math.ceil((u.lockedUntil - Date.now()) / 60000) + ' minute(s).'); return; }
            const ok = u && !u.disabled ? await checkPass(u.pass, pw) : await checkPass(null, pw);
            const ssoOnly = ssoOn && !sso.allowPasswords && u && u.role !== 'super_admin';
            busy(btn, false, 'Sign in');
            if (!ok || ssoOnly) {
              if (u) {
                u.failed = (u.failed || 0) + 1;
                if (u.failed >= RB.clamp(parseInt(A.policy.lockAfter, 10) || 5, 3, 20)) { u.lockedUntil = Date.now() + 5 * 60000; u.failed = 0; log('Account ' + u.email + ' locked for 5 minutes after wrong passwords'); }
                saveA();
              }
              fail(ssoOnly && ok ? 'Use "Sign in with ' + sso.name + '".' : 'That email and password do not match an account.');
              form.pw.value = ''; form.pw.focus();
              return;
            }
            afterPassword(u);
          });
        });
      }

      function codeStep(u) {
        step('<h1 id="gateTitle">Two-step sign-in</h1><p class="gate-sub">Enter the 6-digit code from your authenticator app.</p>' + errP() +
          '<form class="form gate-form" novalidate><div class="field"><label for="gCode">Code</label><input id="gCode" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required></div>' +
          '<button type="submit" class="btn btn--primary gate-wide">Continue</button></form><button type="button" class="link-btn gate-alt" data-g="back">Back</button>',
        () => {
          card.querySelector('[data-g=back]').addEventListener('click', () => signIn());
          const form = card.querySelector('form');
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (await checkTotp(u, u.totp.secret, form.code.value)) { saveA(); finish(u); return; }
            u.failed = (u.failed || 0) + 1;
            if (u.failed >= RB.clamp(parseInt(A.policy.lockAfter, 10) || 5, 3, 20)) { u.lockedUntil = Date.now() + 5 * 60000; u.failed = 0; saveA(); signIn('Too many wrong codes. Try again in 5 minutes.'); return; }
            saveA();
            fail('That code is not right. Codes change every 30 seconds.');
            form.code.value = '';
          });
        });
      }

      function setupStep(u) {
        const secret = b32(rand(20));
        step('<h1 id="gateTitle">Set up two-step sign-in</h1><p class="gate-sub">Your organisation asks for a code from an authenticator app (Microsoft Authenticator, Google Authenticator, 1Password…) as well as your password.</p>' + errP() +
          tfaHtml(u, secret) +
          '<form class="form gate-form" novalidate><div class="field"><label for="gCode">Code from the app</label><input id="gCode" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required></div><button type="submit" class="btn btn--primary gate-wide">Turn on and continue</button></form>',
        () => {
          const form = card.querySelector('form');
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!(await checkTotp(u, secret, form.code.value))) { fail('That code is not right. Check the key was typed in exactly.'); return; }
            u.totp = { secret, added: Date.now() };
            log(u.name + ' turned on two-step sign-in');
            saveA(); finish(u);
          });
        });
      }

      function newPassword(u) {
        step('<h1 id="gateTitle">Choose a new password</h1><p class="gate-sub">Your password was set by an Admin. Choose your own before you carry on.</p>' + errP() +
          '<form class="form gate-form" novalidate><div class="field"><label for="gN1">New password</label><input id="gN1" name="n1" type="password" autocomplete="new-password" minlength="10" required><p class="hint">At least 10 characters.</p></div>' +
          '<div class="field"><label for="gN2">New password again</label><input id="gN2" name="n2" type="password" autocomplete="new-password" required></div><button type="submit" class="btn btn--primary gate-wide">Save and continue</button></form>',
        () => {
          const form = card.querySelector('form');
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const m = pwProblem(form.n1.value, form.n2.value);
            if (m) { fail(m); return; }
            if (await checkPass(u.pass, form.n1.value)) { fail('Choose a password that is different from the one you were given.'); return; }
            u.pass = await makePass(form.n1.value); u.mustChange = false;
            log(u.name + ' chose a new password');
            saveA(); afterPassword(u);
          });
        });
      }

      signIn(errMsg || carried);
    });
  }

  function pwProblem(a, b) {
    if (String(a).length < 10) return 'Use at least 10 characters.';
    if (a !== b) return 'The two passwords are not the same.';
    return null;
  }
  function tfaHtml(u, secret) {
    const uri = 'otpauth://totp/' + encodeURIComponent(RB.APP_NAME + ':' + u.email) + '?secret=' + secret + '&issuer=' + encodeURIComponent(RB.APP_NAME) + '&algorithm=SHA1&digits=6&period=30';
    return '<ol class="tfa-steps"><li>In your authenticator app, add an account and choose to enter a setup key.</li>' +
      '<li>Account: <b>' + esc(u.email) + '</b>, key: <code class="tfa-key">' + secret.replace(/(.{4})/g, '$1 ').trim() + '</code>, type: time based.</li>' +
      '<li>On a phone you can also <a href="' + esc(uri) + '">open the app with this link</a>.</li></ol>';
  }

  /* ---------- top bar button ---------- */
  function renderButton() {
    const b = document.getElementById('acctBtn');
    if (!b) return;
    if (me) {
      b.innerHTML = '<span class="avatar">' + esc(initials(me.name || me.email)) + '</span><span class="acct-text"><b>' + esc(me.name || me.email) + '</b><span>' + esc(roleOf(me.role).name) + (A.tenants.length > 1 ? ' · ' + esc(auth.tenantName()) : '') + '</span></span>';
      b.title = 'Your account';
      b.setAttribute('aria-label', 'Your account: ' + (me.name || me.email) + ', ' + roleOf(me.role).name);
    } else {
      b.innerHTML = RB.icon('lock', 16) + '<span class="acct-text"><b>Set up sign-in</b></span>';
      b.title = 'Turn on sign-in with users and roles';
      b.setAttribute('aria-label', 'Set up sign-in');
    }
  }
  auth.renderButton = renderButton;

  /* ---------- first-time setup ---------- */
  function openSetup() {
    const body = RB.html('<div><p class="hint">Make the first account. It becomes the Super Admin, who adds everyone else with the role they need and can set up single sign-on. From then on, everyone signs in before they see anything.</p>' +
      '<form class="form" novalidate style="margin-top:14px">' +
      '<div class="field field--half"><label for="suName">Your name</label><input id="suName" name="name" autocomplete="name" required></div>' +
      '<div class="field field--half"><label for="suEmail">Email</label><input id="suEmail" name="email" type="email" autocomplete="username" required></div>' +
      '<div class="field field--half"><label for="suPw">Password</label><input id="suPw" name="pw" type="password" autocomplete="new-password" required><p class="hint">At least 10 characters.</p></div>' +
      '<div class="field field--half"><label for="suPw2">Password again</label><input id="suPw2" name="pw2" type="password" autocomplete="new-password" required></div>' +
      '</form><h3 class="sub">The five roles</h3>' + rolesTable() + '<p class="gate-err" role="alert" hidden></p></div>');
    const err = body.querySelector('.gate-err');
    RB.modal.open({ title: 'Set up sign-in', body, wide: true, actions: [
      { label: 'Cancel', onClick: (m) => m.close() },
      { label: 'Create Super Admin', kind: 'primary', onClick: async (m) => {
        const f = body.querySelector('form').elements;
        const name = f.name.value.trim(), email = f.email.value.trim().toLowerCase();
        const say = (t) => { err.textContent = t; err.hidden = false; };
        if (!subtle) return say('Sign-in needs this site to be opened over https.');
        if (!name) return say('Enter your name.');
        if (!validEmail(email)) return say('Enter a valid email address.');
        const p = pwProblem(f.pw.value, f.pw2.value); if (p) return say(p);
        const u = newUser({ name, email, role: 'super_admin', pass: await makePass(f.pw.value) });
        A.users.push(u);
        log('Sign-in turned on by ' + name);
        startSession(u, 'password');
        applyTenant();
        m.close();
        RB.render();
        RB.toast('Sign-in is on. You are the Super Admin.');
      } },
    ] });
  }

  /* ---------- your account ---------- */
  RB.openAccount = function () {
    if (!enforcing()) { openSetup(); return; }
    const ts = tenantsFor(me);
    const body = RB.html('<div class="acct">' +
      '<div class="acct-head"><span class="avatar avatar--lg">' + esc(initials(me.name || me.email)) + '</span><div><b>' + esc(me.name || me.email) + '</b><span>' + esc(me.email) + '</span></div><span class="role-pill role--' + me.role + '">' + esc(roleOf(me.role).name) + '</span></div>' +
      '<p class="hint">' + esc(roleOf(me.role).desc) + '</p>' +
      (ts.length > 1 ? '<div class="field" style="margin-top:14px"><label for="acTenant">Tenant</label><select id="acTenant">' + ts.map((t) => '<option value="' + esc(t.id) + '"' + (t.id === session.tenant ? ' selected' : '') + '>' + esc(t.name) + '</option>').join('') + '</select><p class="hint">Each tenant has its own sites, comms rooms, racks and device library.</p></div>' : '') +
      '<h3 class="sub">Password</h3>' + (me.pass ? '' : '<p class="hint">You sign in with single sign-on. You can add a password too.</p>') +
      '<form class="form" data-f="pw" novalidate>' +
      (me.pass ? '<div class="field"><label for="acOld">Current password</label><input id="acOld" name="old" type="password" autocomplete="current-password"></div>' : '') +
      '<div class="field field--half"><label for="acN1">New password</label><input id="acN1" name="n1" type="password" autocomplete="new-password"></div>' +
      '<div class="field field--half"><label for="acN2">New password again</label><input id="acN2" name="n2" type="password" autocomplete="new-password"></div>' +
      '<button type="submit" class="btn sm">' + (me.pass ? 'Change password' : 'Add password') + '</button></form>' +
      '<h3 class="sub">Two-step sign-in</h3><div data-f="tfa"></div>' +
      '<p class="gate-err" role="alert" hidden></p></div>');
    const err = body.querySelector('.gate-err');
    const say = (t) => { err.textContent = t; err.hidden = !t; };
    const sel = body.querySelector('#acTenant');
    if (sel) sel.addEventListener('change', () => { switchTenant(sel.value); m.close(); });
    body.querySelector('[data-f=pw]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      if (me.pass && !(await checkPass(me.pass, f.old.value))) return say('Your current password is not right.');
      const p = pwProblem(f.n1.value, f.n2.value); if (p) return say(p);
      me.pass = await makePass(f.n1.value); me.mustChange = false;
      log(me.name + ' changed their password'); saveA();
      say(''); RB.toast('Password saved'); f.reset();
    });
    const tfa = body.querySelector('[data-f=tfa]');
    function drawTfa() {
      if (me.totp) {
        tfa.innerHTML = '<p class="hint">' + RB.icon('shield', 14) + ' On since ' + esc(RB.fmtDate(me.totp.added)) + '. You are asked for a code when you sign in with your password.</p>' +
          (needsTwoFactor(me) ? '<p class="hint">Your organisation asks for it, so it stays on.</p>' : '<div class="btn-row"><button type="button" class="btn sm btn--danger-ghost" data-t="off">Turn off</button></div>');
      } else if (!me.pass) {
        tfa.innerHTML = '<p class="hint">Your single sign-on provider handles extra sign-in checks for you.</p>';
      } else {
        tfa.innerHTML = '<p class="hint">Ask for a code from an authenticator app as well as your password.</p><div class="btn-row"><button type="button" class="btn sm" data-t="on">Set up</button></div>';
      }
    }
    tfa.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-t]'); if (!b) return;
      if (b.dataset.t === 'off') { me.totp = null; log(me.name + ' turned off two-step sign-in'); saveA(); drawTfa(); return; }
      if (b.dataset.t === 'on') {
        const secret = b32(rand(20));
        tfa.innerHTML = tfaHtml(me, secret) + '<div class="form"><div class="field field--half"><label for="acCode">Code from the app</label><input id="acCode" inputmode="numeric" autocomplete="one-time-code" maxlength="7"></div></div><div class="btn-row"><button type="button" class="btn sm btn--primary" data-t="confirm">Turn on</button><button type="button" class="btn sm" data-t="cancel">Cancel</button></div>';
        tfa.dataset.secret = secret;
        tfa.querySelector('input').focus();
        return;
      }
      if (b.dataset.t === 'cancel') { drawTfa(); return; }
      if (b.dataset.t === 'confirm') {
        if (!(await checkTotp(me, tfa.dataset.secret, tfa.querySelector('#acCode').value))) return say('That code is not right. Check the key was typed in exactly.');
        me.totp = { secret: tfa.dataset.secret, added: Date.now() };
        log(me.name + ' turned on two-step sign-in'); saveA(); say(''); drawTfa();
        RB.toast('Two-step sign-in is on');
      }
    });
    drawTfa();
    const actions = [];
    if (auth.can('users')) actions.push({ label: 'Users & access', left: true, onClick: (x) => { x.close(); RB.openUsers(); } });
    actions.push({ label: 'Sign out', kind: 'danger-ghost', onClick: () => signOut() });
    actions.push({ label: 'Done', kind: 'primary', onClick: (x) => x.close() });
    const m = RB.modal.open({ title: 'Your account', body, actions });
  };

  function switchTenant(id) {
    const t = tenantsFor(me).find((x) => x.id === id);
    if (!t || !session) return;
    session.tenant = t.id; writeSession(session);
    me.lastTenant = t.id; saveA();
    RB.store.useTenant(t.id, t.name);
    renderButton();
    if (RB.goHome) RB.goHome();
    RB.render();
    RB.toast('Opened ' + t.name);
  }

  /* ---------- users & access ---------- */
  function rolesTable() {
    return '<div class="tbl-wrap"><table class="tbl tbl--tight role-matrix"><thead><tr><th>What they can do</th>' + ROLES.map((r) => '<th>' + esc(r.name) + '</th>').join('') + '</tr></thead><tbody>' +
      CAPS.map(([t, need]) => '<tr><td>' + esc(t) + '</td>' + ROLES.map((r) => '<td class="rm-c">' + (r.rank >= need ? '<span class="rm-yes" aria-label="Yes">' + RB.icon('check', 14) + '</span>' : '<span class="rm-no" aria-label="No">–</span>') + '</td>').join('') + '</tr>').join('') +
      '</tbody></table></div>';
  }

  RB.rolesTableHtml = rolesTable;
  RB.authRules = { NEED, ADMIN_RE, TECH_RE, CAPS };
  RB.openUsers = function (tab) {
    if (!auth.can('users')) { auth.refuse('Users & access'); return; }
    if (!enforcing()) { openSetup(); return; }
    let cur = tab || 'users';
    const TABS = [['users', 'Users'], ['roles', 'Roles'], ['sso', 'Single sign-on'], ['tenants', 'Tenants'], ['security', 'Security']];
    const body = RB.html('<div class="ua"><div class="ua-tabs" role="tablist" aria-label="Users and access"></div><div class="ua-pane"></div><p class="gate-err" role="alert" hidden></p></div>');
    const tabsEl = body.querySelector('.ua-tabs');
    const pane = body.querySelector('.ua-pane');
    const err = body.querySelector('.gate-err');
    const say = (t) => { err.textContent = t || ''; err.hidden = !t; };
    const isSuper = () => me && me.role === 'super_admin';
    const mayManage = (u) => isSuper() || u.role !== 'super_admin';
    const assignable = () => ROLES.filter((r) => isSuper() || r.id !== 'super_admin');

    function draw() {
      tabsEl.innerHTML = TABS.map(([id, l]) => '<button type="button" role="tab" class="ua-tab' + (id === cur ? ' is-on' : '') + '" aria-selected="' + (id === cur) + '" data-tab="' + id + '">' + l + '</button>').join('');
      pane.innerHTML = PANES[cur]();
      say('');
    }
    function tenantText(u) {
      if (rank(u) >= 4) return 'All (' + roleOf(u.role).name + ')';
      if (u.tenants === 'all') return 'All tenants';
      const n = tenantsFor(u).length;
      return n ? n + ' of ' + A.tenants.length : 'None';
    }
    const PANES = {
      users() {
        const rows = A.users.slice().sort((a, b) => rank(b) - rank(a) || String(a.name).localeCompare(String(b.name))).map((u) => {
          const can = mayManage(u);
          const self = u.id === me.id;
          const badges = [u.pass ? 'Password' : '', u.sso ? 'Single sign-on' : '', u.totp ? 'Two-step' : '', u.mustChange ? 'New password due' : ''].filter(Boolean).map((b) => '<span class="tag">' + b + '</span>').join(' ');
          return '<tr data-uid="' + esc(u.id) + '"' + (u.disabled ? ' class="is-off"' : '') + '>' +
            '<td><b>' + esc(u.name || '—') + '</b>' + (self ? ' <span class="muted">(you)</span>' : '') + '<br><span class="muted">' + esc(u.email) + '</span>' + (u.disabled ? ' <span class="tag tag--off">Switched off</span>' : '') + '</td>' +
            '<td><select data-u="role" aria-label="Role of ' + esc(u.email) + '"' + (can && !self ? '' : ' disabled') + '>' + (can ? assignable() : ROLES).map((r) => '<option value="' + r.id + '"' + (r.id === u.role ? ' selected' : '') + '>' + r.name + '</option>').join('') + '</select></td>' +
            '<td>' + (badges || '<span class="muted">No sign-in yet</span>') + '</td>' +
            '<td>' + (rank(u) >= 4 || !can ? esc(tenantText(u)) : '<button type="button" class="link-btn" data-u="tenants">' + esc(tenantText(u)) + '</button>') + '</td>' +
            '<td class="muted">' + (u.lastLogin ? esc(RB.fmtDate(u.lastLogin)) : 'Never') + '</td>' +
            '<td class="ua-acts">' + (can ? '<button type="button" class="link-btn" data-u="pw">Set password</button>' +
              (u.totp ? '<button type="button" class="link-btn" data-u="tfa">Reset two-step</button>' : '') +
              (self ? '' : '<button type="button" class="link-btn" data-u="toggle">' + (u.disabled ? 'Switch on' : 'Switch off') + '</button><button type="button" class="link-btn danger" data-u="del">Delete</button>') : '<span class="muted">Super Admin only</span>') + '</td></tr>';
        }).join('');
        return '<div class="tbl-wrap"><table class="tbl ua-users"><thead><tr><th>Person</th><th>Role</th><th>Signs in with</th><th>Tenants</th><th>Last sign-in</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
          '<h3 class="sub">Add someone</h3><form class="form" data-f="add" novalidate>' +
          '<div class="field field--half"><label for="uaName">Name</label><input id="uaName" name="name" autocomplete="off"></div>' +
          '<div class="field field--half"><label for="uaEmail">Email</label><input id="uaEmail" name="email" type="email" autocomplete="off"></div>' +
          '<div class="field field--half"><label for="uaRole">Role</label><select id="uaRole" name="role">' + assignable().map((r) => '<option value="' + r.id + '"' + (r.id === 'editor' ? ' selected' : '') + '>' + r.name + '</option>').join('') + '</select></div>' +
          '<div class="field field--half"><label for="uaPw">Temporary password</label><input id="uaPw" name="pw" type="text" autocomplete="off" placeholder="Leave empty for single sign-on only"><p class="hint">They choose their own when they first sign in.</p></div>' +
          '<button type="submit" class="btn btn--primary sm">' + RB.icon('plus') + ' Add person</button></form>' +
          '<p class="hint" style="margin-top:10px">People who sign in with single sign-on are matched by email. ' + (A.sso.autoCreate ? 'New people from allowed domains get an account as ' + esc(roleOf(A.sso.defaultRole).name) + ' the first time they sign in.' : 'Add them here first, or turn on "Make accounts on first sign-in" under Single sign-on.') + '</p>';
      },
      roles() {
        return '<p class="hint">Five levels, from looking only to running everything. Give each person the lowest level that lets them do their job.</p>' +
          '<div class="role-list">' + ROLES.map((r) => '<div class="role-card"><span class="role-pill role--' + r.id + '">' + r.name + '</span><p>' + esc(r.desc) + '</p><span class="muted">' + A.users.filter((u) => u.role === r.id).length + ' people</span></div>').join('') + '</div>' +
          rolesTable();
      },
      sso() {
        const s = A.sso; const ro = !isSuper() || !!s.managed;
        const pre = PRESETS[s.provider] || PRESETS.other;
        const dis = ro ? ' disabled' : '';
        const roleSel = (cur) => '<select name="grpRole" aria-label="Level"' + dis + '>' + SSO_ROLES.slice().reverse().map((id) => '<option value="' + id + '"' + (id === cur ? ' selected' : '') + '>' + roleOf(id).name + '</option>').join('') + '</select>';
        const grpRow = (g) => '<div class="grp-row"><input name="grpName" value="' + esc(g.group) + '" placeholder="Group name or ID" aria-label="Group"' + dis + '>' + roleSel(g.role) + (ro ? '' : '<button type="button" class="icon-btn danger" data-s="grp-del" aria-label="Remove this group">' + RB.icon('trash') + '</button>') + '</div>';
        RB._grpRow = grpRow;
        return (s.managed ? '<p class="hint warn">Single sign-on is set in this site’s config.js file by whoever installed it, so it is the same for everyone. Change it there.</p>' : !isSuper() ? '<p class="hint warn">Only a Super Admin can change single sign-on.</p>' : '') +
          '<form class="form" data-f="sso" novalidate>' +
          '<label class="check"><input type="checkbox" name="enabled"' + (s.enabled ? ' checked' : '') + dis + '> <span>Offer single sign-on on the sign-in screen</span></label>' +
          '<div class="field field--half"><label for="ssoProv">Provider</label><select id="ssoProv" name="provider"' + dis + '>' + Object.keys(PRESETS).map((k) => '<option value="' + k + '"' + (k === s.provider ? ' selected' : '') + '>' + esc(PRESETS[k].label) + '</option>').join('') + '</select></div>' +
          '<div class="field field--half"><label for="ssoName">Button name</label><input id="ssoName" name="name" value="' + esc(s.name) + '"' + dis + '><p class="hint">Shown as "Sign in with …".</p></div>' +
          '<p class="hint sso-help">' + esc(pre.help) + '</p>' +
          '<div class="field"><label for="ssoRedir">Redirect address (copy this into the provider)</label><div class="copy-row"><input id="ssoRedir" readonly value="' + esc(redirectUri()) + '"><button type="button" class="btn sm" data-s="copy">' + RB.icon('copy') + ' Copy</button></div></div>' +
          '<div class="field"><label for="ssoIss">Issuer address</label><input id="ssoIss" name="issuer" value="' + esc(s.issuer) + '" placeholder="' + esc(pre.issuer) + '"' + dis + '></div>' +
          '<div class="field field--half"><label for="ssoCid">Client (application) ID</label><input id="ssoCid" name="clientId" value="' + esc(s.clientId) + '" autocomplete="off"' + dis + '></div>' +
          '<div class="field field--half"><label for="ssoFlow">Sign-in method</label><select id="ssoFlow" name="flow"' + dis + '><option value="code"' + (s.flow === 'code' ? ' selected' : '') + '>Authorisation code with PKCE (recommended)</option><option value="id_token"' + (s.flow === 'id_token' ? ' selected' : '') + '>Identity token (for Google)</option></select></div>' +
          '<div class="field field--half"><label for="ssoScp">Scopes</label><input id="ssoScp" name="scopes" value="' + esc(s.scopes) + '"' + dis + '></div>' +
          '<div class="field field--half"><label for="ssoDom">Allowed email domains</label><input id="ssoDom" name="domains" value="' + esc(s.domains) + '" placeholder="example.com.au, example.org"' + dis + '><p class="hint">Empty allows any domain.</p></div>' +
          '<h3 class="sub">Levels from your groups</h3>' +
          '<p class="hint">Give each group in your provider a level. When someone signs in, they get the highest level of the groups they are in, so you manage who can do what in one place. Microsoft Entra sends group IDs (copy the Object ID of each group) or app roles by their value; add a "groups" claim to the token under Token configuration.</p>' +
          '<div class="grp-list">' + (s.groupRoles || []).map(grpRow).join('') + '</div>' +
          (ro ? '' : '<button type="button" class="btn btn--ghost sm" data-s="grp-add">' + RB.icon('plus') + ' Add a group</button>') +
          '<div class="field field--half"><label for="ssoClaim">Group claim name</label><input id="ssoClaim" name="groupClaim" value="' + esc(s.groupClaim || 'groups') + '"' + dis + '><p class="hint">Usually "groups". App roles in "roles" are always read too.</p></div>' +
          '<div class="field field--half"><label for="ssoSupers">Always Super Admin</label><input id="ssoSupers" name="superAdmins" value="' + esc(s.superAdmins || '') + '" placeholder="it.manager@example.com.au"' + dis + '><p class="hint">Emails, separated by commas.</p></div>' +
          '<label class="check"><input type="checkbox" name="groupsDecide"' + (s.groupsDecide !== false ? ' checked' : '') + dis + '> <span>Groups decide each person’s level every time they sign in</span></label>' +
          '<label class="check"><input type="checkbox" name="requireGroup"' + (s.requireGroup ? ' checked' : '') + dis + '> <span>Only let in people who are in one of these groups</span></label>' +
          '<label class="check"><input type="checkbox" name="autoCreate"' + (s.autoCreate ? ' checked' : '') + dis + '> <span>Make accounts on first sign-in for everyone from the allowed domains</span></label>' +
          '<div class="field field--half"><label for="ssoRole">Level when no group matches</label><select id="ssoRole" name="defaultRole"' + dis + '>' + ['viewer', 'technician', 'editor'].map((id) => '<option value="' + id + '"' + (id === s.defaultRole ? ' selected' : '') + '>' + roleOf(id).name + '</option>').join('') + '</select></div>' +
          '<label class="check"><input type="checkbox" name="allowPasswords"' + (s.allowPasswords ? ' checked' : '') + dis + '> <span>Let people sign in with a password too</span></label>' +
          '<p class="hint">Single sign-on is the way in for everyone. Super Admins can always use their password, so nobody gets locked out if the provider is down.</p>' +
          '<div class="btn-row"><button type="button" class="btn" data-s="test">Test the issuer</button>' + (ro ? '' : '<button type="submit" class="btn btn--primary">Save single sign-on</button>') + '</div>' +
          '<div class="sso-test" aria-live="polite"></div></form>';
      },
      tenants() {
        const ro = !isSuper();
        const counts = (t) => {
          let s = null;
          try { s = JSON.parse(localStorage.getItem(RB.store.keyFor(t.id)) || 'null'); } catch (e) { s = null; }
          if (!s) return 'Empty';
          return (s.sites || []).length + ' sites · ' + (s.racks || []).length + ' racks · ' + (s.devices || []).length + ' devices';
        };
        return '<p class="hint">A tenant is a separate set of records with its own sites, comms rooms, racks and device library. Use them for separate organisations, regions or clients. Admins see every tenant; give other people the tenants they need on the Users tab.</p>' +
          (ro ? '<p class="hint warn">Only a Super Admin can add, rename or remove tenants.</p>' : '') +
          '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Tenant</th><th>Holds</th><th>People</th><th></th></tr></thead><tbody>' +
          A.tenants.map((t) => '<tr data-tid="' + esc(t.id) + '"><td>' + (ro ? esc(t.name) : '<input class="inline-in" data-t="name" value="' + esc(t.name) + '" aria-label="Tenant name">') + (t.id === session.tenant ? ' <span class="tag">Open now</span>' : '') + '</td><td class="muted">' + esc(counts(t)) + '</td><td class="muted">' + A.users.filter((u) => tenantsFor(u).some((x) => x.id === t.id)).length + '</td>' +
            '<td class="ua-acts">' + (t.id !== session.tenant ? '<button type="button" class="link-btn" data-t="open">Open</button>' : '') + (!ro && t.id !== 'default' ? '<button type="button" class="link-btn danger" data-t="del">Delete</button>' : '') + '</td></tr>').join('') +
          '</tbody></table></div>' +
          (ro ? '' : '<form class="form" data-f="tadd" novalidate style="margin-top:14px"><div class="field field--half"><label for="tnName">New tenant</label><input id="tnName" name="name" placeholder="For example: Northern region"></div><button type="submit" class="btn btn--primary sm">' + RB.icon('plus') + ' Add tenant</button></form>');
      },
      security() {
        const p = A.policy; const ro = !isSuper(); const dis = ro ? ' disabled' : '';
        return (ro ? '<p class="hint warn">Only a Super Admin can change these rules.</p>' : '') +
          '<form class="form" data-f="pol" novalidate>' +
          '<div class="field field--half"><label for="poTfa">Two-step sign-in needed for</label><select id="poTfa" name="twoFactor"' + dis + '>' +
          [['none', 'Nobody (people can choose)'], ['admins', 'Admins and Super Admins'], ['everyone', 'Everyone who uses a password']].map(([v, l]) => '<option value="' + v + '"' + (p.twoFactor === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select><p class="hint">People without it set it up the next time they sign in.</p></div>' +
          '<div class="field field--half"><label for="poHrs">Sign out after (hours)</label><input id="poHrs" name="sessionHours" type="number" min="1" max="168" value="' + esc(p.sessionHours) + '"' + dis + '></div>' +
          '<div class="field field--half"><label for="poLock">Lock for 5 minutes after this many wrong tries</label><input id="poLock" name="lockAfter" type="number" min="3" max="20" value="' + esc(p.lockAfter) + '"' + dis + '></div>' +
          (ro ? '' : '<div class="btn-row" style="width:100%"><button type="submit" class="btn btn--primary">Save rules</button></div>') + '</form>' +
          '<h3 class="sub">Sign-in activity</h3><ol class="history history--mini">' + (A.log.length ? A.log.slice(0, 60).map((x) => '<li><time>' + esc(RB.fmtDate(x.ts)) + '</time><span>' + esc(x.text) + '</span></li>').join('') : '<li class="empty-note">Nothing yet.</li>') + '</ol>' +
          (ro ? '' : '<h3 class="sub">Turn sign-in off</h3><p class="hint">Removes every account and opens the records to anyone using this browser. The records themselves are kept.</p><div class="btn-row"><button type="button" class="btn btn--danger-ghost" data-p="off">Remove all accounts</button></div>');
      },
    };

    function findU(el) { const tr = el.closest('[data-uid]'); return tr && A.users.find((u) => u.id === tr.dataset.uid); }
    function commitA(text) { if (text) log(text); saveA(); draw(); renderButton(); }

    body.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-tab]');
      if (t) { cur = t.dataset.tab; draw(); return; }
      const b = e.target.closest('[data-u],[data-s],[data-t],[data-p]');
      if (!b || b.tagName === 'SELECT' || b.tagName === 'INPUT') return;
      if (b.dataset.u) {
        const u = findU(b); if (!u || !mayManage(u)) return;
        if (b.dataset.u === 'pw') {
          if (!(await RB.modal.confirm('Give ' + (u.name || u.email) + ' a new temporary password? They choose their own when they next sign in.', { okLabel: 'Make one' }))) return;
          const temp = b32(rand(10)).toLowerCase().replace(/(.{4})(?!$)/g, '$1-');
          u.pass = await makePass(temp); u.mustChange = true; u.failed = 0; u.lockedUntil = 0;
          commitA('Temporary password set for ' + u.email + ' by ' + me.name);
          RB.modal.open({ title: 'Temporary password', body: '<p class="hint">Give this to ' + esc(u.name || u.email) + ' in person or by phone. It is shown only once.</p><p class="temp-pw"><code>' + esc(temp) + '</code></p>', actions: [{ label: 'Done', kind: 'primary', onClick: (x) => x.close() }] });
          return;
        }
        if (b.dataset.u === 'tfa') { u.totp = null; commitA('Two-step sign-in reset for ' + u.email + ' by ' + me.name); return; }
        if (b.dataset.u === 'toggle') {
          if (!u.disabled && u.role === 'super_admin' && superCount() <= 1) { say('Keep at least one Super Admin switched on.'); return; }
          u.disabled = !u.disabled; commitA((u.disabled ? 'Switched off ' : 'Switched on ') + u.email + ' (' + me.name + ')'); return;
        }
        if (b.dataset.u === 'del') {
          if (u.role === 'super_admin' && superCount() <= 1) { say('Keep at least one Super Admin.'); return; }
          if (!(await RB.modal.confirm('Delete the account for ' + (u.name || u.email) + '? Their past changes stay in the history.', { okLabel: 'Delete' }))) return;
          A.users = A.users.filter((x) => x !== u); commitA('Deleted the account for ' + u.email + ' (' + me.name + ')'); return;
        }
        if (b.dataset.u === 'tenants') { pickTenants(u); return; }
      }
      if (b.dataset.s === 'copy') { const i = body.querySelector('#ssoRedir'); i.select(); try { await navigator.clipboard.writeText(i.value); RB.toast('Copied'); } catch (er) { document.execCommand('copy'); } return; }
      if (b.dataset.s === 'grp-add') { const l = body.querySelector('.grp-list'); l.insertAdjacentHTML('beforeend', RB._grpRow({ group: '', role: 'technician' })); l.lastElementChild.querySelector('input').focus(); return; }
      if (b.dataset.s === 'grp-del') { b.closest('.grp-row').remove(); return; }
      if (b.dataset.s === 'test') {
        const out = body.querySelector('.sso-test');
        const iss = body.querySelector('[name=issuer]').value;
        out.innerHTML = '<p class="hint">Checking…</p>';
        try {
          const c = await discover(iss);
          out.innerHTML = '<p class="hint ok">' + RB.icon('check', 14) + ' Found ' + esc(c.issuer) + '. Its sign-in page, ' + (c.token_endpoint ? 'token address' : 'no token address') + ' and ' + (c.jwks_uri ? 'signing keys' : 'no signing keys') + ' are listed' + ((c.code_challenge_methods_supported || []).includes('S256') ? ', and PKCE is supported.' : '.') + '</p>';
        } catch (er) { out.innerHTML = '<p class="hint warn">' + esc(er.message) + '</p>'; }
        return;
      }
      if (b.dataset.t) {
        const tr = b.closest('[data-tid]'); const tn = tr && A.tenants.find((x) => x.id === tr.dataset.tid); if (!tn) return;
        if (b.dataset.t === 'open') { m.close(); switchTenant(tn.id); return; }
        if (b.dataset.t === 'del' && isSuper() && tn.id !== 'default') {
          if (!(await RB.modal.confirm('Delete the tenant "' + tn.name + '" and all of its sites, racks and devices? Download a backup from it first if you need them.', { okLabel: 'Delete tenant' }))) return;
          try { localStorage.removeItem(RB.store.keyFor(tn.id)); } catch (er) { /* ignore */ }
          A.tenants = A.tenants.filter((x) => x !== tn);
          A.users.forEach((u) => { if (Array.isArray(u.tenants)) u.tenants = u.tenants.filter((id) => id !== tn.id); });
          commitA('Deleted tenant ' + tn.name + ' (' + me.name + ')');
        }
        return;
      }
      if (b.dataset.p === 'off' && isSuper()) {
        if (!(await RB.modal.confirm('Remove every account and turn sign-in off? Anyone using this browser will then be able to open and change the records.', { okLabel: 'Turn sign-in off' }))) return;
        A.users = []; A.sso.enabled = false; log('Sign-in turned off by ' + me.name); saveA(); signOut();
      }
    });

    body.addEventListener('change', (e) => {
      const s = e.target;
      if (s.dataset.u === 'role') {
        const u = findU(s); if (!u || !mayManage(u) || u.id === me.id) { draw(); return; }
        if (!assignable().some((r) => r.id === s.value)) { draw(); return; }
        if (u.role === 'super_admin' && s.value !== 'super_admin' && superCount() <= 1) { say('Keep at least one Super Admin.'); draw(); return; }
        const from = roleOf(u.role).name; u.role = s.value;
        commitA(u.email + ' changed from ' + from + ' to ' + roleOf(u.role).name + ' by ' + me.name);
        return;
      }
      if (s.dataset.t === 'name' && isSuper()) {
        const tr = s.closest('[data-tid]'); const tn = tr && A.tenants.find((x) => x.id === tr.dataset.tid);
        const v = s.value.trim();
        if (!tn || !v) { draw(); return; }
        if (v !== tn.name) { log('Tenant ' + tn.name + ' renamed to ' + v); tn.name = v; saveA(); renderButton(); }
        return;
      }
      if (s.name === 'provider' && isSuper()) {
        const p = PRESETS[s.value] || PRESETS.other;
        const f = s.form;
        f.elements.name.value = p.name; f.elements.flow.value = p.flow;
        if (Object.values(PRESETS).some((x) => x.issuer && x.issuer === f.elements.issuer.value)) f.elements.issuer.value = '';
        if (!f.elements.issuer.value && p.issuer && !/YOUR-/.test(p.issuer)) f.elements.issuer.value = p.issuer;
        f.elements.issuer.placeholder = p.issuer;
        body.querySelector('.sso-help').textContent = p.help;
      }
    });

    body.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target; const el = f.elements;
      if (f.dataset.f === 'add') {
        const name = el.name.value.trim(), email = el.email.value.trim().toLowerCase(), role = el.role.value, pw = el.pw.value;
        if (!name) return say('Enter their name.');
        if (!validEmail(email)) return say('Enter a valid email address.');
        if (A.users.some((u) => u.email === email)) return say('There is already an account for ' + email + '.');
        if (!assignable().some((r) => r.id === role)) return say('You can not give that role.');
        if (pw && pw.length < 10) return say('Make the temporary password at least 10 characters, or leave it empty.');
        if (!pw && !(A.sso.enabled && A.sso.issuer && A.sso.clientId)) return say('Set a temporary password, or set up single sign-on first.');
        A.users.push(newUser({ name, email, role, pass: pw ? await makePass(pw) : null, mustChange: !!pw }));
        commitA('Added ' + email + ' as ' + roleOf(role).name + ' (' + me.name + ')');
        RB.toast('Added ' + name);
        return;
      }
      if (f.dataset.f === 'sso' && isSuper() && !A.sso.managed) {
        const groupRoles = Array.from(f.querySelectorAll('.grp-row')).map((r) => ({ group: r.querySelector('[name=grpName]').value.trim(), role: r.querySelector('[name=grpRole]').value }))
          .filter((g) => g.group && SSO_ROLES.includes(g.role));
        const next = {
          enabled: el.enabled.checked, provider: el.provider.value, name: el.name.value.trim() || 'single sign-on',
          issuer: el.issuer.value.trim(), clientId: el.clientId.value.trim(), flow: el.flow.value === 'id_token' ? 'id_token' : 'code',
          scopes: el.scopes.value.trim() || 'openid profile email', domains: el.domains.value.trim(), autoCreate: el.autoCreate.checked,
          defaultRole: ['viewer', 'technician', 'editor'].includes(el.defaultRole.value) ? el.defaultRole.value : 'viewer', allowPasswords: el.allowPasswords.checked,
          groupClaim: el.groupClaim.value.trim() || 'groups', groupRoles, groupsDecide: el.groupsDecide.checked, requireGroup: el.requireGroup.checked, superAdmins: el.superAdmins.value.trim(), managed: false,
        };
        if (next.requireGroup && !groupRoles.length) return say('Add at least one group, or untick "Only let in people who are in one of these groups".');
        if (next.enabled) {
          if (!next.issuer) return say('Enter the issuer address from your provider.');
          if (/YOUR-/.test(next.issuer)) return say('Replace the YOUR-… part of the issuer address with your own details.');
          if (!next.clientId) return say('Enter the client (application) ID from your provider.');
          if (!/\bopenid\b/.test(next.scopes)) next.scopes = 'openid ' + next.scopes;
          try { await discover(next.issuer); } catch (er) { return say(er.message); }
        }
        A.sso = next;
        commitA('Single sign-on ' + (next.enabled ? 'set up with ' + next.name : 'switched off') + ' by ' + me.name);
        RB.toast('Single sign-on saved');
        return;
      }
      if (f.dataset.f === 'tadd' && isSuper()) {
        const name = el.name.value.trim();
        if (!name) return say('Enter a name for the tenant.');
        if (A.tenants.some((t) => t.name.toLowerCase() === name.toLowerCase())) return say('There is already a tenant called ' + name + '.');
        A.tenants.push({ id: RB.uid('ten'), name });
        commitA('Added tenant ' + name + ' (' + me.name + ')');
        return;
      }
      if (f.dataset.f === 'pol' && isSuper()) {
        A.policy = {
          twoFactor: ['none', 'admins', 'everyone'].includes(el.twoFactor.value) ? el.twoFactor.value : 'none',
          sessionHours: RB.clamp(parseInt(el.sessionHours.value, 10) || 12, 1, 168),
          lockAfter: RB.clamp(parseInt(el.lockAfter.value, 10) || 5, 3, 20),
        };
        commitA('Security rules changed by ' + me.name);
        RB.toast('Rules saved');
      }
    });

    function pickTenants(u) {
      const all = u.tenants === 'all';
      const ids = Array.isArray(u.tenants) ? u.tenants : [];
      const bd = RB.html('<div class="form"><label class="check"><input type="checkbox" name="all"' + (all ? ' checked' : '') + '> <span>All tenants, including new ones</span></label>' +
        A.tenants.map((t) => '<label class="check tn-pick"><input type="checkbox" name="t" value="' + esc(t.id) + '"' + (all || ids.includes(t.id) ? ' checked' : '') + (all ? ' disabled' : '') + '> <span>' + esc(t.name) + '</span></label>').join('') + '</div>');
      const allBox = bd.querySelector('[name=all]');
      allBox.addEventListener('change', () => bd.querySelectorAll('[name=t]').forEach((x) => { x.disabled = allBox.checked; if (allBox.checked) x.checked = true; }));
      RB.modal.open({ title: 'Tenants for ' + (u.name || u.email), body: bd, actions: [
        { label: 'Cancel', onClick: (x) => x.close() },
        { label: 'Save', kind: 'primary', onClick: (x) => {
          u.tenants = allBox.checked ? 'all' : Array.from(bd.querySelectorAll('[name=t]:checked')).map((c) => c.value);
          commitA('Tenants changed for ' + u.email + ' (' + me.name + ')');
          x.close();
        } },
      ] });
    }

    draw();
    const m = RB.modal.open({ title: 'Users & access', body, wide: true, actions: [{ label: 'Done', kind: 'primary', onClick: (x) => x.close() }] });
  };
})();
