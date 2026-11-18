SPES.UserModel = {
  all() { const rows = SPES.DB.get('users', []); let changed = false; rows.filter(u => u.role === 'beneficiary' && !u.spesId).forEach(u => { const batch = SPES.BatchModel.find(u.batch) || {}; const prefix = ((batch.name || '').match(/B[12]/i) || [String(u.batch || '').startsWith('B2-') ? 'B2' : 'B1'])[0].toUpperCase(); const year = batch.year || (String(u.batch || '').match(/20\d{2}/) || [new Date().getFullYear()])[0]; const count = rows.filter(x => x.role === 'beneficiary' && x.batch === u.batch && x.spesId).length + 1; u.spesId = `${prefix}-${year}-${String(count).padStart(4, '0')}`; changed = true; }); if (changed) SPES.DB.set('users', rows); return rows; },
  byId(id) { return this.all().find(u => u.id === id); },
  // Demo accounts so the app can be tried right away.
  seed() {
    if (this.all().length) return this.migrate();
    SPES.DB.set('users', [
      { id: 'u_admin', name: 'Administrator', username: 'admin', password: 'admin123', role: 'admin' },
      { id: 'u_head', name: 'Office Head', username: 'head', password: 'head123', role: 'head' }
    ]);
    SPES.BatchModel.create('Batch 2026', 2026, 'SPES-2026-DEMO');
    this.migrate();
  },
  // Upgrade any plain-text passwords (older versions) to salted hashes.
  migrate() { const rows = SPES.DB.get('users', []); if (rows.some(u => u.password && !SPES.Hash.isHashed(u.password))) SPES.DB.set('users', rows.map(u => u.password && !SPES.Hash.isHashed(u.password) ? { ...u, password: SPES.Hash.make(u.password) } : u)); },
  // Day 1 of a beneficiary is the day they registered (late acceptance does not shorten their 20 days).
  // Older accounts without a start date fall back to the batch start date.
  startDate(u) { return u.startDate || SPES.BatchModel.start(u.batch); },
  workDates(u) { return SPES.BatchModel.workDatesFrom(this.startDate(u)); },
  register(f) {
    if (!f.name || !f.username || !['Male','Female'].includes(f.gender) || f.password.length < 6) return { error: 'Fill in every field. Password needs at least 6 characters.' };
    if (this.all().some(u => u.username === f.username)) return { error: 'That username is already taken.' };
    const batch = SPES.BatchModel.find(f.batch);
    if (!batch) return { error: 'Batch code not found. Ask your administrator for the code.' };
    const seqKey = 'spes_seq_' + batch.code; const existingMax = this.all().filter(x => x.role === 'beneficiary' && x.batch === batch.code).reduce((m, x) => Math.max(m, Number(String(x.spesId || '').split('-').pop()) || 0), 0); const seq = Math.max(Number(localStorage.getItem(seqKey) || 0), existingMax) + 1; localStorage.setItem(seqKey, String(seq));
    const prefix = (batch.name.match(/B[12]/i) || [batch.code.startsWith('B2-') ? 'B2' : 'B1'])[0].toUpperCase();
    const spesId = `${prefix}-${batch.year}-${String(seq).padStart(4, '0')}`;
    const u = { id: SPES.DB.id(), spesId, gender: f.gender, name: f.name, username: f.username, password: SPES.Hash.make(f.password), role: 'beneficiary', batch: batch.code, status: 'pending', seen: new Date().toISOString(), startDate: SPES.AttendanceModel.day() };
    SPES.DB.set('users', [...this.all(), u]);
    return { user: u };
  },
  login(username, password) {
    const u = this.all().find(x => x.username === username && SPES.Hash.verify(password, x.password));
    if (!u) return { error: 'Wrong username or password.' };
    if (u.status === 'pending') return { error: 'Your account is waiting for administrator approval.' };
    if (u.status === 'rejected') return { error: 'Your registration was declined. Please contact the administrator.' };
    return { user: u };
  },
  update(id, patch) { SPES.DB.set('users', this.all().map(u => u.id === id ? { ...u, ...patch } : u)); },
  deleteUser(id) {
    SPES.DB.set('users', this.all().filter(u => u.id !== id));
    ['attendance','journals','notifs','feedback','attmanual'].forEach(k => { const v = SPES.DB.get(k, []); SPES.DB.set(k, v.filter(x => x.userId !== id && x.to !== id)); });
    SPES.DB.set('activity', SPES.DB.get('activity', []).filter(x => x.uid !== id));
    ['progress','points'].forEach(k => { const v = SPES.DB.get(k, {}); delete v[id]; SPES.DB.set(k, v); });
  },
  reset(username, batch, pw) {
    const u = this.all().find(x => x.username === username && x.role === 'beneficiary');
    if (!u || u.batch !== String(batch || '').trim().toUpperCase()) return { error: 'Username and batch code do not match.' };
    if (pw.length < 6) return { error: 'Password needs at least 6 characters.' };
    SPES.DB.set('users', this.all().map(x => x.id === u.id ? { ...x, password: SPES.Hash.make(pw) } : x));
    return { ok: 1 };
  },
  session() { return this.byId(sessionStorage.getItem('spes_uid')); },
  setSession(u) { u ? sessionStorage.setItem('spes_uid', u.id) : sessionStorage.removeItem('spes_uid'); }
};
