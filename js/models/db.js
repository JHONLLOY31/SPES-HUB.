// Tiny storage layer shared by all models (browser localStorage).
window.SPES = window.SPES || {};
SPES.DB = {
  get(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem('spes_' + key)); return v === null ? fallback : v; }
    catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('spes_' + key, JSON.stringify(value)); return true; }
    catch (e) { alert('Browser storage is full. Remove old records or use smaller photos.'); return false; }
  },
  id() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
};

// Password hashing: salted, iterated SHA-256 (pure JS so it works on file:// and https://).
// Stored format: h1$<iterations>$<salt>$<hex>. Plain-text values from older versions still verify and are upgraded at start-up.
SPES.Hash = (() => {
  const K = [], H0 = [];
  for (let c = 2, n = 0; n < 64; c++) {
    let prime = true; for (let d = 2; d * d <= c; d++) if (c % d === 0) { prime = false; break; }
    if (prime) { if (n < 8) H0[n] = (Math.pow(c, .5) % 1 * 4294967296) | 0; K[n++] = (Math.pow(c, 1 / 3) % 1 * 4294967296) | 0; }
  }
  const rr = (x, n) => (x >>> n) | (x << (32 - n));
  function sha256(str) {
    const bytes = unescape(encodeURIComponent(str)), len = bytes.length, total = (((len + 8) >> 6) + 1) * 16, words = new Array(total).fill(0);
    for (let i = 0; i < len; i++) words[i >> 2] |= bytes.charCodeAt(i) << ((3 - i % 4) * 8);
    words[len >> 2] |= 0x80 << ((3 - len % 4) * 8); words[total - 1] = len * 8;
    let h = H0.slice();
    for (let j = 0; j < total; j += 16) {
      const w = words.slice(j, j + 16);
      for (let i = 16; i < 64; i++) { const a = w[i - 15], b = w[i - 2]; w[i] = (w[i - 16] + (rr(a, 7) ^ rr(a, 18) ^ (a >>> 3)) + w[i - 7] + (rr(b, 17) ^ rr(b, 19) ^ (b >>> 10))) | 0; }
      let [a, b, c, d, e, f, g, k] = h;
      for (let i = 0; i < 64; i++) {
        const t1 = (k + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0, t2 = ((rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h = h.map((x, i) => (x + [a, b, c, d, e, f, g, k][i]) | 0);
    }
    return h.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }
  const ITER = 2000;
  const salt = () => { const a = new Uint8Array(12); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => a[i] = Math.random() * 256); return [...a].map(x => x.toString(16).padStart(2, '0')).join(''); };
  const digest = (pw, s, n) => { let d = sha256(s + ':' + pw); for (let i = 0; i < n; i++) d = sha256(d + s + pw); return d; };
  return {
    sha256,
    isHashed: v => typeof v === 'string' && v.startsWith('h1$'),
    make(pw) { const s = salt(); return `h1$${ITER}$${s}$${digest(pw, s, ITER)}`; },
    verify(pw, stored) { if (!this.isHashed(stored)) return stored === pw; const [, n, s, hex] = stored.split('$'); return digest(pw, s, +n) === hex; }
  };
})();
