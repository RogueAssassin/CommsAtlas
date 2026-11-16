/* CommsAtlas — a small QR code maker (byte mode, error correction L, versions 1 to 8: up to 192 characters).
   Used to show the authenticator-app set-up code. No libraries. RB.qrSvg(text, size) → an <svg> string. */
(function () {
  'use strict';
  const RB = window.RB;

  // Version tables for error correction level L.
  const DATA_CW = [19, 34, 55, 80, 108, 136, 156, 194];
  const EC_CW = [7, 10, 15, 20, 26, 18, 20, 24]; // per block
  const BLOCKS = [1, 1, 1, 1, 1, 2, 2, 2];
  const ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42]];

  // Arithmetic in GF(256) with the QR polynomial 0x11d.
  const EXP = new Array(512), LOG = new Array(256);
  (function () { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
  const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

  function rsRemainder(data, ecLen) {
    let gen = [1];
    for (let i = 0; i < ecLen; i++) {
      const next = new Array(gen.length + 1).fill(0);
      for (let j = 0; j < gen.length; j++) { next[j] ^= gen[j]; next[j + 1] ^= mul(gen[j], EXP[i]); }
      gen = next;
    }
    const res = new Array(ecLen).fill(0);
    for (const b of data) {
      const f = b ^ res.shift(); res.push(0);
      if (f !== 0) for (let j = 0; j < ecLen; j++) res[j] ^= mul(gen[j + 1], f);
    }
    return res;
  }

  function bchDigit(d) { let n = 0; while (d !== 0) { n++; d >>>= 1; } return n; }
  function formatBits(mask) {
    const G15 = 0x537, MASK = 0x5412; const data = (1 << 3) | mask; // level L is 01
    let d = data << 10;
    while (bchDigit(d) - bchDigit(G15) >= 0) d ^= G15 << (bchDigit(d) - bchDigit(G15));
    return ((data << 10) | d) ^ MASK;
  }
  function versionBits(v) {
    const G18 = 0x1f25; let d = v << 12;
    while (bchDigit(d) - bchDigit(G18) >= 0) d ^= G18 << (bchDigit(d) - bchDigit(G18));
    return (v << 12) | d;
  }
  const MASKS = [
    (i, j) => (i + j) % 2 === 0, (i) => i % 2 === 0, (i, j) => j % 3 === 0, (i, j) => (i + j) % 3 === 0,
    (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0, (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
    (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0, (i, j) => (((i * j) % 3) + ((i + j) % 2)) % 2 === 0,
  ];

  function encodeBytes(bytes, ver) {
    const cap = DATA_CW[ver - 1];
    const bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4); put(bytes.length, 8);
    bytes.forEach((b) => put(b, 8));
    for (let i = 0; i < 4 && bits.length < cap * 8; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    const out = [];
    for (let i = 0; i < bits.length; i += 8) { let v = 0; for (let k = 0; k < 8; k++) v = (v << 1) | bits[i + k]; out.push(v); }
    for (let pad = 0xec; out.length < cap; pad ^= 0xec ^ 0x11) out.push(pad);
    // Split into blocks, add error correction, interleave.
    const nb = BLOCKS[ver - 1], per = cap / nb, ec = EC_CW[ver - 1];
    const dBlocks = [], eBlocks = [];
    for (let b = 0; b < nb; b++) { const d = out.slice(b * per, (b + 1) * per); dBlocks.push(d); eBlocks.push(rsRemainder(d, ec)); }
    const final = [];
    for (let i = 0; i < per; i++) dBlocks.forEach((d) => final.push(d[i]));
    for (let i = 0; i < ec; i++) eBlocks.forEach((e) => final.push(e[i]));
    return final;
  }

  function build(codewords, ver, mask) {
    const n = 17 + 4 * ver;
    const m = Array.from({ length: n }, () => new Array(n).fill(null));
    const finder = (r, c) => {
      for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
        const rr = r + dr, cc = c + dc; if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
        m[rr][cc] = (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6)) || (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6)) || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
      }
    };
    finder(0, 0); finder(n - 7, 0); finder(0, n - 7);
    const pos = ALIGN[ver - 1];
    pos.forEach((r) => pos.forEach((c) => {
      if (m[r][c] !== null) return;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) m[r + dr][c + dc] = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
    }));
    for (let i = 8; i < n - 8; i++) { if (m[i][6] === null) m[i][6] = i % 2 === 0; if (m[6][i] === null) m[6][i] = i % 2 === 0; }
    // format information
    const fb = formatBits(mask);
    for (let i = 0; i < 15; i++) {
      const bit = ((fb >> i) & 1) === 1;
      if (i < 6) m[i][8] = bit; else if (i < 8) m[i + 1][8] = bit; else m[n - 15 + i][8] = bit;
      if (i < 8) m[8][n - i - 1] = bit; else if (i < 9) m[8][15 - i] = bit; else m[8][15 - i - 1] = bit;
    }
    m[n - 8][8] = true;
    if (ver >= 7) {
      const vb = versionBits(ver);
      for (let i = 0; i < 18; i++) { const bit = ((vb >> i) & 1) === 1; m[Math.floor(i / 3)][(i % 3) + n - 11] = bit; m[(i % 3) + n - 11][Math.floor(i / 3)] = bit; }
    }
    // data, in the zig-zag order
    let inc = -1, row = n - 1, bitIndex = 7, byteIndex = 0;
    for (let col = n - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (;;) {
        for (let c = 0; c < 2; c++) {
          if (m[row][col - c] === null) {
            let dark = false;
            if (byteIndex < codewords.length) dark = ((codewords[byteIndex] >>> bitIndex) & 1) === 1;
            if (MASKS[mask](row, col - c)) dark = !dark;
            m[row][col - c] = dark;
            if (--bitIndex === -1) { byteIndex++; bitIndex = 7; }
          }
        }
        row += inc;
        if (row < 0 || row >= n) { row -= inc; inc = -inc; break; }
      }
    }
    return m;
  }

  function penalty(m) {
    const n = m.length; let p = 0, dark = 0;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) dark++;
    for (let pass = 0; pass < 2; pass++) {
      const at = (a, b) => (pass ? m[b][a] : m[a][b]);
      for (let a = 0; a < n; a++) {
        let run = 1;
        for (let b = 1; b < n; b++) {
          if (at(a, b) === at(a, b - 1)) run++; else { if (run >= 5) p += 3 + run - 5; run = 1; }
        }
        if (run >= 5) p += 3 + run - 5;
        for (let b = 0; b + 10 < n; b++) {
          const s = []; for (let k = 0; k < 11; k++) s.push(at(a, b + k) ? 1 : 0);
          const t = s.join('');
          if (t === '10111010000' || t === '00001011101') p += 40;
        }
      }
    }
    for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) if (m[r][c] === m[r + 1][c] && m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c + 1]) p += 3;
    p += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
    return p;
  }

  RB._qr = { rsRemainder, formatBits, versionBits };
  /** The QR matrix (rows of true/false) for a text, or null when it is too long. */
  RB.qrMatrix = function (text) {
    const bytes = Array.from(new TextEncoder().encode(String(text)));
    let ver = 0;
    for (let v = 1; v <= 8; v++) if (bytes.length <= DATA_CW[v - 1] - 2) { ver = v; break; }
    if (!ver) return null;
    const cw = encodeBytes(bytes, ver);
    let best = null, bestP = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const m = build(cw, ver, mask); const p = penalty(m);
      if (p < bestP) { bestP = p; best = m; }
    }
    return best;
  };

  /** An SVG for the code: dark squares on white, with the quiet border scanners need. */
  RB.qrSvg = function (text, size) {
    const m = RB.qrMatrix(text);
    if (!m) return '';
    const n = m.length, q = 4; let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) d += 'M' + (c + q) + ' ' + (r + q) + 'h1v1h-1z';
    const s = size || 176;
    return '<svg class="qr" xmlns="http://www.w3.org/2000/svg" width="' + s + '" height="' + s + '" viewBox="0 0 ' + (n + 2 * q) + ' ' + (n + 2 * q) + '" role="img" aria-label="QR code for your authenticator app" shape-rendering="crispEdges">' +
      '<rect width="100%" height="100%" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  };
})();
