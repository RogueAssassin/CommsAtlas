/* CommsAtlas — reads Excel workbooks (.xlsx) and CSV files in the browser.
   An .xlsx file is a ZIP of XML parts; this unzips the parts it needs with the browser's own
   DecompressionStream and reads every sheet into rows of plain text. Nothing leaves the browser. */
(function () {
  'use strict';
  const RB = window.RB;
  const utf8 = new TextDecoder('utf-8');
  const NOT_XLSX = 'That file isn’t an Excel workbook (.xlsx). Older .xls files and password-protected workbooks can’t be read: in Excel use File › Save As › Excel Workbook (.xlsx), or save the sheet as CSV.';

  async function inflate(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser can’t open Excel files. Use a current version of Edge, Chrome, Firefox or Safari, or save the sheet as CSV.');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** The table of contents of a ZIP file: name → where its data is and how it is packed. */
  function zipIndex(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    if (u8.length < 22 || dv.getUint32(0, true) !== 0x04034b50) throw new Error(NOT_XLSX);
    let end = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { end = i; break; }
    }
    if (end < 0) throw new Error(NOT_XLSX);
    const count = dv.getUint16(end + 10, true);
    let p = dv.getUint32(end + 16, true);
    const files = new Map();
    for (let n = 0; n < count; n++) {
      if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error(NOT_XLSX);
      const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), noteLen = dv.getUint16(p + 32, true);
      const name = utf8.decode(u8.subarray(p + 46, p + 46 + nameLen));
      files.set(name, { method: dv.getUint16(p + 10, true), size: dv.getUint32(p + 20, true), offset: dv.getUint32(p + 42, true) });
      p += 46 + nameLen + extraLen + noteLen;
    }
    return { u8, dv, files };
  }

  async function zipText(zip, name) {
    const f = zip.files.get(name);
    if (!f) return null;
    const at = f.offset;
    if (zip.dv.getUint32(at, true) !== 0x04034b50) throw new Error(NOT_XLSX);
    const start = at + 30 + zip.dv.getUint16(at + 26, true) + zip.dv.getUint16(at + 28, true);
    const raw = zip.u8.subarray(start, start + f.size);
    if (f.method === 0) return utf8.decode(raw);
    if (f.method === 8) return utf8.decode(await inflate(raw));
    throw new Error('This workbook is packed in a way CommsAtlas can’t read. Save it again from Excel and try once more.');
  }

  const xml = (text) => {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error(NOT_XLSX);
    return doc;
  };
  const all = (node, local) => Array.from(node.getElementsByTagNameNS('*', local));
  const kids = (node, local) => Array.from(node.childNodes).filter((n) => n.nodeType === 1 && n.localName === local);
  const attr = (el, local) => { for (const a of Array.from(el.attributes)) if (a.localName === local) return a.value; return null; };
  /** Text of a rich or plain string, leaving out phonetic hints. */
  const richText = (el) => all(el, 't').filter((t) => !t.closest || !t.closest('rPh')).map((t) => t.textContent).join('');

  function colIndex(ref) {
    const m = /^([A-Z]+)/i.exec(ref || '');
    if (!m) return -1;
    let n = 0;
    for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  function resolve(target) {
    if (!target) return null;
    if (target.startsWith('/')) return target.slice(1);
    const parts = ('xl/' + target).split('/');
    const out = [];
    parts.forEach((p) => { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); });
    return out.join('/');
  }

  /** Every sheet of an .xlsx file as { name, rows: string[][] }. */
  async function readXlsx(buf) {
    const zip = zipIndex(buf);
    const bookText = await zipText(zip, 'xl/workbook.xml');
    if (!bookText) throw new Error(NOT_XLSX);
    const relsText = await zipText(zip, 'xl/_rels/workbook.xml.rels');
    const rels = new Map();
    if (relsText) all(xml(relsText), 'Relationship').forEach((r) => rels.set(r.getAttribute('Id'), r.getAttribute('Target')));
    const sstText = await zipText(zip, 'xl/sharedStrings.xml');
    const strings = sstText ? kids(xml(sstText).documentElement, 'si').map(richText) : [];

    const sheets = [];
    const sheetEls = all(xml(bookText), 'sheet');
    for (let i = 0; i < sheetEls.length; i++) {
      const el = sheetEls[i];
      if ((el.getAttribute('state') || '') === 'veryHidden') continue;
      const path = resolve(rels.get(attr(el, 'id'))) || 'xl/worksheets/sheet' + (i + 1) + '.xml';
      const text = await zipText(zip, path);
      if (!text) continue;
      const rows = [];
      all(xml(text), 'row').forEach((row, ri) => {
        const r = (parseInt(row.getAttribute('r'), 10) || ri + 1) - 1;
        const cells = rows[r] = rows[r] || [];
        kids(row, 'c').forEach((c, ci) => {
          const col = c.getAttribute('r') ? colIndex(c.getAttribute('r')) : ci;
          const type = c.getAttribute('t') || 'n';
          const v = kids(c, 'v')[0];
          let value = '';
          if (type === 's') value = v ? strings[parseInt(v.textContent, 10)] || '' : '';
          else if (type === 'inlineStr') value = kids(c, 'is')[0] ? richText(kids(c, 'is')[0]) : '';
          else if (type === 'b') value = v && v.textContent === '1' ? 'TRUE' : 'FALSE';
          else value = v ? v.textContent : '';
          if (col >= 0) cells[col] = String(value).replace(/ /g, ' ').trim();
        });
      });
      for (let r = 0; r < rows.length; r++) rows[r] = Array.from(rows[r] || [], (x) => x || '');
      sheets.push({ name: el.getAttribute('name') || 'Sheet ' + (i + 1), hidden: el.getAttribute('state') === 'hidden', rows });
    }
    if (!sheets.length) throw new Error('That workbook has no sheets CommsAtlas can read.');
    return sheets;
  }

  /** A CSV (comma, semicolon or tab separated) as one sheet. */
  function readCsv(text, name) {
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/, 1)[0] || '';
    const sep = [',', ';', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === sep) { row.push(cell.trim()); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell.trim()); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
    return [{ name: name || 'Sheet 1', hidden: false, rows }];
  }

  /** Read a picked file (.xlsx or .csv) into sheets of text rows. */
  RB.readSheets = async function (file) {
    const name = (file && file.name) || '';
    if (/\.(csv|tsv|txt)$/i.test(name)) return readCsv(await file.text(), name.replace(/\.[^.]+$/, ''));
    if (/\.xls$/i.test(name)) throw new Error(NOT_XLSX);
    return readXlsx(await file.arrayBuffer());
  };

  /* ---------- writing .xlsx ----------
     sheets: [{ name, cols: [widths], rows: [[cell...]] }], where a cell is text, a number, or
     { v, s } with s = 'bold' | 'title' | 'hint' | 'head'. Entries are stored uncompressed. */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function zipStore(files) {
    const enc = new TextEncoder();
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = [], central = [];
    let offset = 0;
    files.forEach((f) => {
      const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data);
      const head = new DataView(new ArrayBuffer(30));
      [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, time, 2], [12, date, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, name.length, 2], [28, 0, 2]]
        .forEach(([o, v, n]) => (n === 4 ? head.setUint32(o, v, true) : head.setUint16(o, v, true)));
      const cen = new DataView(new ArrayBuffer(46));
      [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, time, 2], [14, date, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, name.length, 2], [42, offset, 4]]
        .forEach(([o, v, n]) => (n === 4 ? cen.setUint32(o, v, true) : cen.setUint16(o, v, true)));
      parts.push(head, name, data);
      central.push(cen, name);
      offset += 30 + name.length + data.length;
    });
    const cdSize = central.reduce((a, p) => a + p.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    [[0, 0x06054b50, 4], [8, files.length, 2], [10, files.length, 2], [12, cdSize, 4], [16, offset, 4]]
      .forEach(([o, v, n]) => (n === 4 ? end.setUint32(o, v, true) : end.setUint16(o, v, true)));
    return new Blob(parts.concat(central, [end]), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  const xmlText = (v) => String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const colName = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - m) / 26); } return s; };
  const STYLE = { bold: 1, title: 2, hint: 3, head: 4 };

  function sheetXml(sheet) {
    const out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'];
    if (sheet.cols && sheet.cols.length) out.push('<cols>' + sheet.cols.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols>');
    out.push('<sheetData>');
    sheet.rows.forEach((row, r) => {
      if (!row || !row.length) return;
      const cells = [];
      row.forEach((c, i) => {
        const v = c && typeof c === 'object' ? c.v : c;
        if (v == null || v === '') return;
        const ref = colName(i) + (r + 1);
        const s = c && typeof c === 'object' && STYLE[c.s] ? ' s="' + STYLE[c.s] + '"' : '';
        if (typeof v === 'number' && isFinite(v)) cells.push('<c r="' + ref + '"' + s + '><v>' + v + '</v></c>');
        else cells.push('<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + xmlText(v) + '</t></is></c>');
      });
      if (cells.length) out.push('<row r="' + (r + 1) + '">' + cells.join('') + '</row>');
    });
    out.push('</sheetData></worksheet>');
    return out.join('');
  }

  const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="16"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE5E7EB"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  /** Build an .xlsx file (a Blob) from sheets of rows. */
  RB.writeXlsx = function (sheets) {
    const used = new Set();
    const names = sheets.map((sh, i) => {
      let base = String(sh.name || 'Sheet ' + (i + 1)).replace(/[\[\]:*?\/\\]/g, '-').replace(/^'+|'+$/g, '').trim().slice(0, 31) || 'Sheet ' + (i + 1);
      let name = base, k = 2;
      while (used.has(name.toLowerCase())) { const tail = ' (' + k++ + ')'; name = base.slice(0, 31 - tail.length) + tail; }
      used.add(name.toLowerCase());
      return name;
    });
    const files = [
      { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        names.map((n, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>' },
      { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        names.map((n, i) => '<sheet name="' + xmlText(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        names.map((n, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') +
        '<Relationship Id="rId' + (names.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/styles.xml', text: STYLES },
    ];
    sheets.forEach((sh, i) => files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', text: sheetXml(sh) }));
    return zipStore(files);
  };
  // The zip and XML readers are shared with the Word reader (docimport.js).
  RB._zip = { zipIndex, zipText, xml, all, kids, attr };
})();
