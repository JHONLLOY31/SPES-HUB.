// Notifications, activity history and feedback.
SPES.NotifModel = {
  all() { return SPES.DB.get('notifs', []); },
  // to: a user id, 'staff' (admins and office head), 'all' (every beneficiary) or 'batch:CODE'
  push(to, text, kind) { SPES.DB.set('notifs', [{ id: SPES.DB.id(), to, text, kind: kind || 'info', ts: new Date().toISOString() }, ...this.all()].slice(0, 300)); },
  for(u) {
    const staff = u.role !== 'beneficiary';
    return this.all().filter(n => n.to === u.id || (staff ? n.to === 'staff' : (n.to === 'all' || n.to === 'batch:' + u.batch)));
  },
  unread(u) { return this.for(u).filter(n => n.ts > (u.seen || '')).length; },
  markSeen(u) { SPES.UserModel.update(u.id, { seen: new Date().toISOString() }); }
};
SPES.ActivityModel = {
  log(uid, text) { SPES.DB.set('activity', [{ uid, text, ts: new Date().toISOString() }, ...SPES.DB.get('activity', [])].slice(0, 600)); },
  for(uid) { return SPES.DB.get('activity', []).filter(a => a.uid === uid).slice(0, 30); }
};
SPES.FeedbackModel = {
  all() { return SPES.DB.get('feedback', []); },
  add(u, text, rating) {
    const first = !this.all().some(f => f.userId === u.id);
    SPES.DB.set('feedback', [{ id: SPES.DB.id(), userId: u.id, name: u.name, text, rating, ts: new Date().toISOString() }, ...this.all()]);
    return { first };
  }
};

// Who is online. Each logged-in browser sends a heartbeat; an account counts as online if it beat in the last 45 seconds.
// (Prototype: this shares through the same browser's storage, so real cross-device presence needs the server.)
SPES.PresenceModel = {
  TTL: 45000,
  all() { return SPES.DB.get('presence', {}); },
  write(map) { try { localStorage.setItem('spes_presence', JSON.stringify(map)); } catch (e) {} },
  beat(id) { const p = this.all(); if (p[id] && p[id].on && Date.now() - p[id].t < 5000) return; p[id] = { t: Date.now(), on: true }; this.write(p); },
  leave(id) { const p = this.all(); p[id] = { t: Date.now(), on: false }; this.write(p); },
  forget(id) { const p = this.all(); delete p[id]; this.write(p); },
  online(id) { const e = this.all()[id]; return !!(e && e.on && Date.now() - e.t < this.TTL); },
  label(id) {
    if (this.online(id)) return 'Online now';
    const e = this.all()[id]; if (!e) return 'Offline';
    const m = Math.max(1, Math.round((Date.now() - e.t) / 60000));
    return 'Last seen ' + (m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : new Date(e.t).toLocaleDateString());
  }
};
