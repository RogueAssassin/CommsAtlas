/* CommsAtlas — reads Word (.docx) and PDF files (and pictures, by OCR) into the same rows-of-text the spreadsheet import uses,
   and checks what an import found so the records stay true: bad IP addresses, duplicate IPs, VLAN numbers that do not exist,
   MAC addresses that are not MAC addresses. Everything is read in the browser; nothing is uploaded.
   pdf.js (Apache-2.0) is part of this site (/vendor). Tesseract.js (Apache-2.0) is loaded only when a picture is imported;
   its OCR engine and English data come from jsDelivr then. */
(function () {
  'use strict';
  const RB = window.RB;
  const esc = RB.esc;
  const S = () => RB.store.state;

  function loadScript(src) {
    return new Promise((ok, bad) => {
      if (document.querySelector('script[data-lib="' + src + '"]')) { ok(); return; }
      const s = document.createElement('script'); s.src = src; s.dataset.lib = src;
      s.onload = () => ok(); s.onerror = () => bad(new Error('Could not load ' + src.split('/').pop() + '.'));
      document.head.appendChild(s);
    });
  }
  /** "Label: value" lines become two cells, the way a spreadsheet's cover sheet reads. */
  function lineCells(line) {
    const t = String(line || '').replace(/ /g, ' ').trim();
    if (!t) return null;
    const m = /^([^:|]{2,40}):\s*(\S.*)$/.exec(t);
    if (m) return [m[1].trim(), m[2].trim()];
    if (t.includes('\t') || /\s{3,}/.test(t) || t.includes('|')) return t.split(/\t|\s{3,}|\|/).map((c) => c.trim()).filter((c, i, a) => c || (i > 0 && i < a.length - 1));
    return [t];
  }

  /* ---------- Word ---------- */
  async function readDocx(file) {
    const Z = RB._zip;
    let zip, text;
    try { zip = Z.zipIndex(await file.arrayBuffer()); text = await Z.zipText(zip, 'word/document.xml'); }
    catch (e) { throw new Error('That file is not a Word document (.docx). Older .doc files can not be read: in Word use File › Save As › Word Document (.docx).'); }
    if (!text) throw new Error('That Word document has no readable content.');
    const doc = Z.xml(text);
    const body = Z.all(doc, 'body')[0];
    const runText = (p) => Z.all(p, 't').map((t) => t.textContent).join('') ;
    const paraText = (p) => {
      let s = '';
      const walk = (n) => {
        Array.from(n.childNodes).forEach((c) => {
          if (c.nodeType !== 1) return;
          if (c.localName === 't') s += c.textContent;
          else if (c.localName === 'tab' || c.localName === 'br') s += ' ';
          else walk(c);
        });
      };
      walk(p);
      return s.replace(/\s+/g, ' ').trim();
    };
    void runText;
    const sheets = []; const loose = []; let heading = '', n = 0;
    Array.from(body.childNodes).forEach((el) => {
      if (el.nodeType !== 1) return;
      if (el.localName === 'p') {
        const t = paraText(el); if (!t) return;
        heading = t.length <= 60 ? t : heading;
        const c = lineCells(t); if (c) loose.push(c);
      } else if (el.localName === 'tbl') {
        const rows = [];
        Z.kids(el, 'tr').forEach((tr) => {
          const row = [];
          Z.kids(tr, 'tc').forEach((tc) => {
            const pr = Z.kids(tc, 'tcPr')[0]; const gs = pr && Z.kids(pr, 'gridSpan')[0];
            const span = gs ? parseInt(Z.attr(gs, 'val'), 10) || 1 : 1;
            row.push(Z.all(tc, 'p').map(paraText).filter(Boolean).join(' '));
            for (let i = 1; i < span; i++) row.push('');
          });
          if (row.some(Boolean)) rows.push(row);
        });
        if (rows.length) sheets.push({ name: heading || 'Table ' + (++n), hidden: false, rows });
      }
    });
    if (loose.length) sheets.unshift({ name: 'Text', hidden: false, rows: loose });
    if (!sheets.length) throw new Error('That Word document has no tables or text to read.');
    return sheets;
  }

  /* ---------- PDF ---------- */
  async function readPdf(file) {
    await loadScript('/vendor/pdf.min.js');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.min.js';
    let doc;
    try { doc = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise; }
    catch (e) { throw new Error(/password/i.test(e && e.message) ? 'That PDF is password protected. Remove the password and try again.' : 'That file could not be read as a PDF.'); }
    const sheets = []; let chars = 0;
    for (let p = 1; p <= Math.min(doc.numPages, 80); p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const items = tc.items.filter((i) => i.str && i.str.trim()).map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width || 0 }));
      items.sort((a, b) => (Math.abs(b.y - a.y) > 2.5 ? b.y - a.y : a.x - b.x));
      const rows = []; let line = [], ly = null;
      const flush = () => {
        if (!line.length) return;
        line.sort((a, b) => a.x - b.x);
        const cells = []; let cur = null;
        line.forEach((it) => {
          if (cur && it.x - cur.end < 6) { cur.s += (it.x - cur.end > 1 ? ' ' : '') + it.s; cur.end = it.x + it.w; }
          else { cur = { s: it.s, end: it.x + it.w }; cells.push(cur); }
        });
        rows.push(cells.map((c) => c.s.trim()));
        line = [];
      };
      items.forEach((it) => { if (ly === null || Math.abs(it.y - ly) > 2.5) { flush(); ly = it.y; } line.push(it); chars += it.s.length; });
      flush();
      if (rows.length) sheets.push({ name: 'Page ' + p, hidden: false, rows });
    }
    if (chars < 20) throw new Error('That PDF has no text to read (it may be a scan). Export it with text, or take a picture of the page and import that instead.');
    return sheets;
  }

  /* ---------- pictures (OCR) ---------- */
  async function readImage(file) {
    RB.toast('Reading the picture… the first time loads the OCR engine, which can take a minute.');
    try { await loadScript('/vendor/tesseract.min.js'); } catch (e) { throw new Error('The picture reader could not start.'); }
    let worker;
    try {
      worker = await window.Tesseract.createWorker('eng');
      const { data } = await worker.recognize(file);
      const rows = String(data.text || '').split('\n').map(lineCells).filter(Boolean);
      if (!rows.length) throw new Error('No text could be read from that picture. Try a sharper, straight-on photo.');
      return [{ name: 'Picture', hidden: false, rows }];
    } catch (e) {
      throw new Error(e && /fetch|network|load|worker/i.test(e.message || '') ? 'The picture reader needs an internet connection the first time (it downloads the OCR engine). ' + e.message : (e && e.message) || 'The picture could not be read.');
    } finally { if (worker) { try { await worker.terminate(); } catch (e) { /* done */ } } }
  }

  const prev = RB.readSheets;
  RB.readSheets = async function (file) {
    const name = (file && file.name) || '';
    if (/\.docx$/i.test(name)) return readDocx(file);
    if (/\.docm?$/i.test(name) && !/\.docx$/i.test(name)) throw new Error('Older .doc files can not be read: in Word use File › Save As › Word Document (.docx).');
    if (/\.pdf$/i.test(name) || (file && file.type === 'application/pdf')) return readPdf(file);
    if (/\.(png|jpe?g|webp|bmp|gif)$/i.test(name) || (file && /^image\//.test(file.type || ''))) return readImage(file);
    return prev.apply(this, arguments);
  };

  /* ---------- data checks ---------- */
  const ipOk = (s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s) && s.split('.').every((n) => +n <= 255);
  const cidrOk = (s) => { const m = /^(\d{1,3}(?:\.\d{1,3}){3})(?:\/(\d{1,2}))?$/.exec(String(s).trim()); return !!m && ipOk(m[1]) && (m[2] == null || +m[2] <= 32); };
  const macOk = (s) => /^([0-9a-f]{2}[:-]?){5}[0-9a-f]{2}$/i.test(s) || /^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/i.test(s);
  const cap = (list, n) => (list.length > n ? list.slice(0, n).concat(['…and ' + (list.length - n) + ' more']) : list);

  /** Looks over what an import found. Returns { problems: [...], notes: [...], checked: n }. Nothing is changed. */
  RB.checkPlan = function (plan) {
    const problems = [], notes = []; let checked = 0;
    const st = S();
    const vids = new Set(plan.vlans.map((v) => Number(v.vid)).concat(st.vlans.map((v) => Number(v.vid))));
    plan.vlans.forEach((v) => {
      checked++;
      if (!Number.isInteger(Number(v.vid)) || v.vid < 1 || v.vid > 4094) problems.push('VLAN ' + v.vid + ' (' + v.name + ') is not a valid VLAN number (1 to 4094).');
      if (v.subnet && !cidrOk(v.subnet)) problems.push('VLAN ' + v.vid + ': the subnet "' + v.subnet + '" is not a valid IPv4 range like 10.1.10.0/24.');
      if (!v.name) problems.push('VLAN ' + v.vid + ' has no name.');
    });
    const names = new Map(), ips = new Map(), badVid = new Map();
    plan.devices.forEach((d) => {
      checked++;
      const nm = String(d.name || '').trim().toLowerCase();
      if (names.has(nm)) problems.push('Two devices are both called "' + d.name + '" (sheets "' + names.get(nm) + '" and "' + d.sheet + '"). The second would overwrite the first.'); else names.set(nm, d.sheet);
      const raw = String(d.ip || '').trim();
      if (raw) {
        const m = /\d{1,3}(\.\d{1,3}){3}/.exec(raw);
        if (!m || !ipOk(m[0])) problems.push(d.name + ': "' + raw + '" is not a valid IP address.');
        else {
          const ip = m[0];
          if (ips.has(ip)) problems.push('IP ' + ip + ' is given to both ' + ips.get(ip) + ' and ' + d.name + '.'); else ips.set(ip, d.name);
          const other = st.devices.find((x) => x.ip && x.ip.includes(ip) && String(x.name).toLowerCase() !== nm);
          if (other) notes.push('IP ' + ip + ' for ' + d.name + ' is already on ' + other.name + ' in your records.');
        }
      }
      if (d.mac && !macOk(String(d.mac).trim())) problems.push(d.name + ': "' + d.mac + '" is not a valid MAC address.');
      const seen = new Set();
      (d.ports || []).forEach((p) => {
        const k = p.section + ':' + p.n;
        if (seen.has(k)) problems.push(d.name + ': port ' + p.n + ' appears twice.'); else seen.add(k);
        if (p.vid != null && !vids.has(Number(p.vid))) { badVid.set(p.vid, (badVid.get(p.vid) || new Set()).add(d.name)); }
      });
    });
    badVid.forEach((devs, vid) => notes.push('VLAN ' + vid + ' is used on ports of ' + Array.from(devs).join(', ') + ' but is not in the VLAN table.'));
    return { problems: cap(problems, 25), notes: cap(notes, 15), checked, total: problems.length + notes.length };
  };
  RB.checksHtml = function (r) {
    if (!r.checked) return '';
    if (!r.total) return '<div class="chk-box chk-ok">' + RB.icon('check', 16) + '<span><b>Checks passed.</b> ' + r.checked + ' item' + (r.checked === 1 ? '' : 's') + ' looked over: VLAN numbers, subnets, IP and MAC addresses, duplicate names and ports.</span></div>';
    return '<div class="chk-box chk-warn">' + RB.icon('info', 16) + '<div><b>' + r.total + ' thing' + (r.total === 1 ? '' : 's') + ' to look at before importing.</b> You can still import; fix the source file and import again to correct them.' +
      (r.problems.length ? '<ul>' + r.problems.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '') +
      (r.notes.length ? '<p class="hint">For your information</p><ul>' + r.notes.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '') + '</div></div>';
  };
  RB._docimport = { lineCells };
})();
