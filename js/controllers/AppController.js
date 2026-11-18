// The controller connects user actions to models and tells the views what to draw.
SPES.App = {
  s: { mode: 'login', tab: null, m: null, play: null, board: null, cert: false, as: 'user', day: null, jday: null, cal: null, sub: 'account', confirm: false },
  anim: true, jpics: [], jkey: null, draft: null, pendingAtt: null,
  GAME_ACTS: ['open', 'quit', 'cert', 'answer', 'next', 'retry', 'flip', 'cell', 'mute'],
  TABS: {
    beneficiary: ['dashboard', 'attendance', 'journal', 'calendar', 'games', 'board', 'badges', 'notifs', 'profile', 'settings'],
    head: ['dashboard', 'journals', 'calendar', 'notifs', 'profile', 'settings'],
    admin: ['dashboard', 'approvals', 'review', 'journals', 'admin', 'announce', 'feedback', 'calendar', 'board', 'answers', 'notifs', 'profile', 'settings']
  },

  init() {
    SPES.UserModel.seed();
    const root = document.getElementById('app');
    root.addEventListener('click', e => { const t = e.target.closest('[data-act]'); if (t && t.tagName !== 'SELECT') this.act(t.dataset.act, t.dataset); });
    root.addEventListener('input', e => { if (e.target.id === 'classSearch') { this.s.roomQ = e.target.value; this.applySearch(); } });
    root.addEventListener('input', e => {
      if (e.target.id !== 'ansSearch') return;
      this.s.keyOpen = Date.now();
      const q = e.target.value.trim().toLowerCase();
      document.querySelectorAll('.ansroom').forEach(r => { let n = 0; r.querySelectorAll('.ansitem').forEach(i => { const hit = !q || i.textContent.toLowerCase().includes(q); i.hidden = !hit; if (hit) n++; }); r.hidden = !n; r.open = !!q && n > 0; });
    });
    root.addEventListener('click', () => { if (this.s.keyOpen) this.s.keyOpen = Date.now(); }, true); // activity keeps the answer key open
    root.addEventListener('change', e => { if (e.target.id === 'attDate' && e.target.value) { this.s.roomDate = e.target.value; this.render(); } });
    setInterval(() => { const u = this.user(); if (u) SPES.PresenceModel.beat(u.id); this.refreshPresence(); if (this.s.keyOpen && this.s.tab === 'answers' && Date.now() - this.s.keyOpen > 600000) { this.s.keyOpen = 0; this.render(); } }, 5000); // who is online
    window.addEventListener('storage', e => { if (e.key === 'spes_presence') this.refreshPresence(); });
    window.addEventListener('beforeunload', () => { const u = this.user(); if (u) SPES.PresenceModel.leave(u.id); });
    root.addEventListener('change', e => {
      const i = e.target, u = this.user();
      if (i.dataset.act === 'board') { this.s.board = i.value; this.render(); }
      else if (i.dataset.act === 'lang') { this.pref('lang', i.value); this.render(); }
      else if (i.classList.contains('pick')) { i.closest('form').querySelector('.pv').innerHTML = i.files[0] ? `<img class="thumb" src="${URL.createObjectURL(i.files[0])}" alt="Preview">` : ''; }
      else if (i.classList.contains('jpick')) this.addPics([...i.files]).then(() => { i.value = ''; });
      else if (i.classList.contains('avpick') && i.files[0]) this.readImage(i.files[0], 220).then(img => {
        SPES.UserModel.update(u.id, { avatar: img }); SPES.ActivityModel.log(u.id, 'Updated profile photo'); this.flash('Profile photo updated.', true); this.render();
      });
    });
    root.addEventListener('click', e => { const b = e.target.closest('.pw-eye'); if (!b) return; const i = b.parentElement.querySelector('input'), show = i.type === 'password'; i.type = show ? 'text' : 'password'; b.innerHTML = show ? this.EYE_OFF : this.EYE; b.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); b.setAttribute('aria-pressed', String(show)); });
    root.addEventListener('submit', e => { e.preventDefault(); this.submit(e.target.dataset.form, e.target, e.submitter && e.submitter.value); });
    root.addEventListener('reset', e => { const pv = e.target.querySelector('.pv'); if (pv) pv.innerHTML = ''; });
    setInterval(() => { if (!this.user() || this.s.tab !== 'attendance' || this.s.attConfirm || this.attSig === undefined) return; const sig = this.attSigNow(); if (sig !== this.attSig) { this.attSig = sig; this.render(); } }, 10000); // unlock slots on time
    this.syncPortal();
    window.addEventListener('hashchange', () => { this.syncPortal(); this.s.mode = 'login'; this.render(); });
    this.render();
  },

  // Two entry points: index.html = beneficiary login, admin.html = staff login (or index.html#admin when hosted as a single page)
  portal() { return window.SPES_PORTAL || (location.hash === '#admin' ? 'admin' : 'user'); },
  syncPortal() {
    const p = this.portal(), u = this.user();
    this.s.as = p;
    if (u && (u.role !== 'beneficiary') !== (p === 'admin')) { SPES.UserModel.setSession(null); Object.assign(this.s, { tab: null, mode: 'login', m: null, play: null, confirm: false }); }
  },

  EYE: '<svg class="ic" viewBox="0 0 24 24"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  EYE_OFF: '<svg class="ic" viewBox="0 0 24 24"><path d="M17.94 17.94A10.9 10.9 0 0 1 12 19C5 19 1 12 1 12a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.9 9.9 0 0 1 12 5c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/></svg>',
  // Every password field gets a show/hide eye button (fields always start hidden after a render).
  addEyes() {
    document.querySelectorAll('#app input[type=password]').forEach(i => {
      if (i.parentElement.classList.contains('pw')) return;
      const w = document.createElement('span'), b = document.createElement('button');
      w.className = 'pw'; i.parentNode.insertBefore(w, i); w.appendChild(i);
      b.type = 'button'; b.className = 'pw-eye'; b.innerHTML = this.EYE; b.setAttribute('aria-label', 'Show password'); b.setAttribute('aria-pressed', 'false'); w.appendChild(b);
    });
  },
  user() { return SPES.UserModel.session(); },
  pref(k, v) { const u = this.user(); SPES.UserModel.update(u.id, { settings: { ...(u.settings || {}), [k]: v } }); },
  applyPrefs(u) {
    const st = (u && u.settings) || {};
    document.documentElement.dataset.theme = st.theme || 'light';
    SPES.I18n.lang = st.lang || 'en'; SPES.Sound.on = st.sound !== false;
  },
  flash(text, ok, info) { this.s.m = { text, ok, info }; },
  applySearch() {
    const inp = document.getElementById('classSearch'); if (!inp) return;
    const q = inp.value.trim().toLowerCase(); let n = 0;
    document.querySelectorAll('.classroom-user,.attrow').forEach(x => { const hit = x.dataset.search.includes(q); x.hidden = !hit; if (hit) n++; });
    const nm = document.getElementById('noMatch'); if (nm) nm.hidden = n > 0 || !q;
  },
  // Live "who is online" inside an open batch room (only that batch's beneficiaries).
  refreshPresence() {
    const box = document.getElementById('onlinePanel'); if (!box || !this.s.room) return;
    const P = SPES.PresenceModel, V = SPES.View;
    box.innerHTML = V.onlineInner(SPES.UserModel.all().filter(x => x.role === 'beneficiary' && x.batch === this.s.room));
    document.querySelectorAll('[data-presence]').forEach(el => el.classList.toggle('on', P.online(el.dataset.presence)));
    document.querySelectorAll('[data-pres-text]').forEach(el => { el.textContent = P.label(el.dataset.presText); });
  },
  attSigNow() { const A = SPES.AttendanceModel; return Object.keys(A.SLOTS).map(k => A.windowState(k).state).join(); },
  // Full-screen welcome transition shown after logging in or registering.
  transition(title, sub, reveal) {
    const o = document.createElement('div');
    o.className = 'fx'; o.setAttribute('aria-hidden', 'true');
    o.innerHTML = `<div class="fx-in"><img src="img/logo.png" alt=""><b>${SPES.View.esc(title)}</b><span>${SPES.View.esc(sub)}</span><i class="fx-bar"></i></div>`;
    document.body.appendChild(o);
    setTimeout(() => {
      this.render();
      const app = document.getElementById('app');
      if (reveal) { app.classList.add('just-in'); setTimeout(() => app.classList.remove('just-in'), 1600); }
      o.classList.add('out'); setTimeout(() => o.remove(), 700);
    }, 1200);
  },
  go(tab) { this.anim = true; Object.assign(this.s, { tab, m: null, play: null, cert: false, room: null, keyOpen: 0, keyMode: '' }); this.render(); },

  readImage(file, max = 640) {
    return new Promise(resolve => {
      const r = new FileReader();
      r.onload = () => {
        const img = new Image();
        img.onload = () => {
          const k = Math.min(1, max / img.width), c = document.createElement('canvas');
          c.width = img.width * k; c.height = img.height * k;
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.6));
        };
        img.src = r.result;
      };
      r.readAsDataURL(file);
    });
  },
  async addPics(files) {
    const room = 5 - this.jpics.length, more = await Promise.all(files.slice(0, room).map(f => this.readImage(f)));
    this.jpics.push(...more);
    const el = document.getElementById('jpics'); if (el) el.innerHTML = SPES.View.pics(this.jpics, false);
    if (files.length > room) alert('You can upload a maximum of 5 images.');
  },

  act(a, d) {
    const s = this.s, u = this.user(), N = SPES.NotifModel, L = SPES.ActivityModel;
    this.anim = !['review', 'answer', 'attday', 'jday', 'flip', 'cell', 'rmpic', 'mute', 'sub', 'theme', 'lang', 'snd', 'markday', 'avborder', 'delnote', 'google', 'markpresent', 'deleteuser', 'canceldel', 'confirmdel', 'keylock', 'keymode'].includes(a);
    if (a === 'as') { s.as = d.v; s.m = null; }
    else if (a === 'deleteuser' && u.role === 'admin') { const t = SPES.UserModel.byId(d.id); if (t && t.role === 'beneficiary') s.delConfirm = t.id; }
    else if (a === 'canceldel') s.delConfirm = null;
    else if (a === 'confirmdel' && u.role === 'admin') { const t = SPES.UserModel.byId(s.delConfirm); s.delConfirm = null; if (t && t.role === 'beneficiary') { SPES.UserModel.deleteUser(t.id); SPES.PresenceModel.forget(t.id); this.flash(`${t.name}'s account and records were deleted.`, true); } }
    else if (a === 'markpresent' && u.role === 'admin') { const r = SPES.AttendanceModel.markPresent(d.id, d.date, u.id); if (r.error) this.flash(r.error); else if (r.added) SPES.NotifModel.push(d.id, `The administrator marked you present for ${d.date}.`, 'attendance'); }
    else if (a === 'mode') { s.mode = d.m; s.m = null; }
    else if (a === 'tab') return this.go(d.t);
    else if (a === 'askout' || a === 'cancelout') { s.confirm = a === 'askout'; this.anim = false; }
    else if (a === 'attcancel') { this.pendingAtt = null; s.attConfirm = false; }
    else if (a === 'attsubmit') { this.uploadAttendance(); return; }
    else if (a === 'logout') { SPES.UserModel.setSession(null); SPES.PresenceModel.leave(u.id); Object.assign(s, { tab: null, mode: 'login', m: null, play: null, confirm: false, delConfirm: null, room: null, keyOpen: 0, keyMode: '' }); }
    else if (a === 'google') this.flash('Google sign-in is not connected yet. It needs a Google client ID and the server, so for now please log in with your username and password.', false, true);
    else if (a === 'room') { s.room = d.code || null; s.roomQ = ''; s.roomDate = null; }
    else if (a === 'avborder') SPES.UserModel.update(u.id, { avBorder: d.v });
    else if (a === 'delnote') SPES.UserModel.update(u.id, { note: null });
    else if (a === 'keylock') { s.keyOpen = 0; s.keyMode = ''; }
    else if (a === 'keymode') s.keyMode = d.v || '';
    else if (a === 'attday') s.day = +d.n;
    else if (a === 'jday') s.jday = +d.n;
    else if (a === 'markday') {
      const day = this.selDay('day', u), r = SPES.AttendanceModel.mark(u.id, this.ctx(u).dates[day - 1]);
      if (!r.error) { N.push('staff', `${u.name} marked Day ${day} present (pending proof)`, 'attendance'); L.log(u.id, `Marked Day ${day} present`); }
      this.flash(r.error || `Day ${day} marked pending. Submit each attendance photo for administrator review.`, !r.error);
    }
    else if (a === 'calnav') { const c = s.cal; c.m += +d.d; if (c.m < 0) { c.m = 11; c.y--; } if (c.m > 11) { c.m = 0; c.y++; } }
    else if (a === 'delevent') SPES.EventModel.remove(d.id);
    else if (a === 'unsubmit') { SPES.JournalModel.setStatus(u.id, +d.day, 'draft'); this.jkey = null; this.flash('Journal unsubmitted. You can edit it now.', true); }
    else if (a === 'rmpic') { this.jpics.splice(+d.k, 1); document.getElementById('jpics').innerHTML = SPES.View.pics(this.jpics, false); return; }
    else if (a === 'review' && u.role === 'admin') {
      const rec = SPES.AttendanceModel.all().find(x => x.id === d.id);
      SPES.AttendanceModel.review(d.id, d.st, u.name);
      if (rec) N.push(rec.userId, `Your attendance was marked ${{ approved: 'approved', rejected: 'rejected' }[d.st]}.`, 'attendance');
    }
    else if (a === 'approve' || a === 'decline') {
      const x = SPES.UserModel.byId(d.id), ok = a === 'approve';
      SPES.UserModel.update(d.id, { status: ok ? 'approved' : 'rejected' });
      if (ok) N.push(d.id, 'Your account was approved. Welcome to SPES Hub!', 'approval');
      this.flash(`${x.name} was ${ok ? 'approved' : 'declined'}.`, true);
    }
    else if (a === 'sub') s.sub = d.v;
    else if (a === 'theme') this.pref('theme', d.v);
    else if (a === 'snd') this.pref('sound', d.v === '1');
    else if (this.GAME_ACTS.includes(a)) { if (SPES.Games.act(a, d) === 'skip') return; }
    this.render();
  },

  
async submit(form, el, mode) {
    const f = Object.fromEntries(new FormData(el).entries()),
        s = this.s,
        u = this.user(),
        M = SPES,
        N = M.NotifModel,
        L = M.ActivityModel;

    let r;

    if (form === 'login') {
      r = M.UserModel.login(f.username.trim(), f.password);

      if (!r.error && (r.user.role !== 'beneficiary') !== (s.as === 'admin')) {
        r = {
          error: r.user.role === 'beneficiary'
            ? 'This is a beneficiary account. Please use the beneficiary login page.'
            : 'This is a staff account. Please use the staff login page.'
        };
      }

      if (r.error) {
        this.flash(r.error);
      } else {
        M.UserModel.setSession(r.user);
        s.tab = null;
        this.anim = true;
        L.log(r.user.id, 'Logged in');
        this.transition('Welcome back,', r.user.name, true);
        return;
      }

    } else if (form === 'register') {

      // SUPABASE BENEFICIARY REGISTRATION
      const email = (f.email || '').trim().toLowerCase();
      const username = (f.username || '').trim().toLowerCase();
      const name = (f.name || '').trim();
      const batchCode = (f.batch || '').trim().toUpperCase();

      if (!window.supabaseClient) {
        this.flash('Supabase connection is not available.');
        return;
      }

      if (!email || !username || !name || !batchCode || !f.gender || !f.password) {
        this.flash('Please complete all registration fields.');
        return;
      }

      if (!['Male', 'Female'].includes(f.gender)) {
        this.flash('Please select your gender.');
        return;
      }

      if (f.password.length < 6) {
        this.flash('Password needs at least 6 characters.');
        return;
      }

      try {
        const { data, error } =
          await window.supabaseClient.auth.signUp({
            email: email,
            password: f.password,
            options: {
              data: {
                name: name,
                username: username,
                gender: f.gender,
                batch_code: batchCode
              }
            }
          });

        if (error) {
          this.flash(error.message);
          return;
        }

        if (!data.user) {
          this.flash('Registration could not be completed.');
          return;
        }

        if (data.session) {
          await window.supabaseClient.auth.signOut();
        }

        this.flash(
          'Account created! Please wait for administrator approval.',
          true
        );

        s.mode = 'login';
        s.as = 'user';

        this.transition(
          'Account created!',
          'Waiting for administrator approval',
          false
        );

        return;

      } catch (error) {
        console.error('Registration error:', error);
        this.flash(error.message || 'Registration failed.');
        return;
      }

    } else if (form === 'forgot') {
      r = M.UserModel.reset(f.username.trim(), f.batch, f.password);

      if (r.error) {
        this.flash(r.error);
      } else {
        this.flash('Password updated. You can log in now.', true);
        s.mode = 'login';
        s.as = this.portal();
      }

    } else if (form === 'attend') {
      const day = this.selDay('day', u);

      if (!el.photo.files[0]) {
        this.flash('Please choose an image first.');
        this.render();
        return;
      }

      this.pendingAtt = {
        slot: el.dataset.slot,
        file: el.photo.files[0],
        date: this.ctx(u).dates[day - 1],
        day
      };

      s.attConfirm = true;
      this.render();
      return;

    } else if (form === 'journal') {
      const day = +el.dataset.day;

      r = M.JournalModel.save(
        u.id,
        day,
        this.days(u, 'jr')[day - 1].date,
        { text: f.text, event: f.event, photos: this.jpics },
        mode
      );

      if (r.error) {
        this.draft = { text: f.text, event: f.event };
      } else {
        this.jkey = null;
        L.log(u.id, `${mode === 'submitted' ? 'Submitted' : 'Saved a draft of'} journal Day ${day}`);

        if (mode === 'submitted') {
          N.push('staff', `${u.name} submitted Journal Day ${day}`, 'journal');
        }
      }

      this.flash(
        r.error || (mode === 'submitted' ? 'Journal submitted.' : 'Draft saved.'),
        !r.error
      );

    } else if (form === 'gtype') {
      M.Games.type(f.val || '');

    } else if (form === 'name') {
      if (f.name.trim()) {
        M.UserModel.update(u.id, {
          name: f.name.trim(),
          ...(f.gender ? { gender: f.gender } : {})
        });

        L.log(u.id, 'Updated profile');
        this.flash('Profile updated.', true);
      }

    } else if (['keyset', 'keychange', 'keyreset', 'keyunlock'].includes(form)) {
      const K = M.KeyModel;

      if (u.role !== 'admin') {
        /* only administrators */
      } else if (K.locked()) {
        this.flash(`Too many wrong tries. Try again in ${K.locked()} minute(s).`);
      } else if (form === 'keyunlock') {
        if (K.check(f.pw)) {
          K.clearFails();
          s.keyOpen = Date.now();
          L.log(u.id, 'Opened the game answers');
        } else {
          K.miss();
          this.flash(
            K.locked()
              ? `Too many wrong tries. Try again in ${K.locked()} minute(s).`
              : 'Wrong password.'
          );
        }
      } else if (!f.pw || f.pw.length < 6) {
        this.flash('The password needs at least 6 characters.');
      } else if (f.pw !== f.pw2) {
        this.flash('The two passwords do not match.');
      } else if (form === 'keyset' && K.has()) {
        this.flash('A password is already set.');
      } else if (form === 'keychange' && !K.check(f.cur)) {
        K.miss();
        this.flash('The current password is wrong.');
      } else if (form === 'keyreset' && !M.Hash.verify(f.acct || '', u.password)) {
        K.miss();
        this.flash('Your administrator account password is wrong.');
      } else {
        K.set(f.pw);
        K.clearFails();
        s.keyOpen = Date.now();
        s.keyMode = '';
        L.log(u.id, 'Set the game answers password');
        this.flash('Answer key password saved.', true);
      }

    } else if (form === 'note') {
      const text = f.text.trim().slice(0, 60);

      if (text) {
        M.UserModel.update(u.id, {
          note: { text, at: new Date().toISOString() }
        });

        L.log(u.id, 'Shared a note');
        this.flash('Note shared. It shows above your photo for 24 hours.', true);
      }

    } else if (form === 'pass') {
      if (!SPES.Hash.verify(f.cur, u.password)) {
        this.flash('Your current password is not correct.');
      } else if (f.next.length < 6) {
        this.flash('New password needs at least 6 characters.');
      } else {
        M.UserModel.update(u.id, {
          password: SPES.Hash.make(f.next)
        });

        L.log(u.id, 'Changed password');
        this.flash('Password updated.', true);
      }

    } else if (form === 'feedback') {
      r = M.FeedbackModel.add(u, f.text.trim(), f.rating);

      if (r.first) M.GameModel.award(u.id, 20);

      N.push('staff', `${u.name} sent feedback (${f.rating}★)`, 'feedback');
      L.log(u.id, r.first ? 'Sent feedback (+20 points)' : 'Sent feedback');

      this.flash(
        r.first
          ? 'Thank you! You earned +20 points.'
          : 'Thank you for your feedback!',
        true
      );

    } else if (form === 'announce') {
      const to = f.to === 'all' ? 'all' : 'batch:' + f.to;
      const title = f.title.trim();

      M.DB.set('ann', [
        {
          id: M.DB.id(),
          title,
          body: f.body.trim(),
          ts: new Date().toISOString()
        },
        ...M.DB.get('ann', [])
      ]);

      N.push(to, `📢 ${title}: ${f.body.trim()}`, 'announce');

      if (f.date) {
        M.EventModel.add(title, f.date, 'Special event');
        N.push(to, `New event: ${title} on ${f.date}`, 'event');
      }

      this.flash('Announcement sent.', true);

    } else if (form === 'event') {
      M.EventModel.add(f.title.trim(), f.date, f.type);
      N.push('all', `New ${f.type.toLowerCase()}: ${f.title.trim()} on ${f.date}`, 'event');
      this.flash('Event added.', true);

    } else if (form === 'batch') {
      this.flash(
        'Batch created. Code: ' +
        M.BatchModel.create(f.name.trim(), f.year, null, f.start),
        true
      );
    }

    this.render();
},

  async uploadAttendance() {
    const u = this.user(), p = this.pendingAtt;
    if (!u || !p) return;
    const image = await this.readImage(p.file);
    const r = SPES.AttendanceModel.submit(u.id, p.slot, image, p.date);
    if (!r.error) { SPES.NotifModel.push('staff', `${u.name} submitted ${SPES.AttendanceModel.SLOTS[p.slot].label} proof for Day ${p.day}`, 'attendance'); SPES.ActivityModel.log(u.id, `Submitted ${SPES.AttendanceModel.SLOTS[p.slot].label} proof`); }
    this.pendingAtt = null; this.s.attConfirm = false;
    this.flash(r.error || 'Image submitted. Attendance is pending administrator review.', !r.error);
    this.render();
  },

  render() {
    const u = this.user(), V = SPES.View, s = this.s;
    this.applyPrefs(u);
    if (u) SPES.PresenceModel.beat(u.id);
    if (!u) V.mount(V.auth(s.mode, s.m, s.as));
    else {
      const tabs = this.TABS[u.role], tab = s.tab && tabs.includes(s.tab) ? s.tab : tabs[0], body = this.body(u, tab), me = this.user();
      V.mount(V.shell(me, tabs, tab, body, { notifs: SPES.NotifModel.unread(me), approvals: me.role === 'beneficiary' ? 0 : SPES.UserModel.all().filter(x => x.status === 'pending').length }) + (s.confirm ? V.logoutModal() : '') + (s.delConfirm && SPES.UserModel.byId(s.delConfirm) ? V.deleteModal(SPES.UserModel.byId(s.delConfirm)) : '') + (s.attConfirm ? V.attendanceConfirmModal() : ''));
    }
    this.addEyes();
    const nav = document.querySelector('.side nav'), on = nav && nav.querySelector('button.on');
    if (on && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = on.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2; // phones: keep the active tab visible in the swipeable menu
    if (this.anim) { const el = document.querySelector('.content, .panel'); if (el) el.classList.add('enter'); this.anim = false; }
    const af = document.querySelector('input[autofocus]'); if (af) af.focus();
    s.m = null;
    this.applySearch(); this.refreshPresence();
  },

  ctx(u) { const dates = SPES.UserModel.workDates(u), today = SPES.AttendanceModel.day(); return { dates, today, idx: dates.indexOf(today) + 1 }; },
  days(u, kind) {
    const { dates, today } = this.ctx(u), A = SPES.AttendanceModel, jr = kind === 'jr';
    return dates.map((date, i) => {
      let state = '', label = '';
      if (jr) { const j = SPES.JournalModel.get(u.id, i + 1); state = j ? (j.status === 'submitted' ? 'full' : 'part') : ''; label = j ? (j.status === 'submitted' ? 'Done' : 'Draft') : 'Empty'; }
      else [label, state] = A.dayStatus(u.id, date, date >= today);
      return { n: i + 1, date, state, label, today: date === today, future: false };
    });
  },
  selDay(key, u) { return this.s[key] || this.ctx(u).idx || 1; },
  badgeList(u) {
    const G = SPES.GameModel, A = SPES.AttendanceModel, rooms = G.completed(u.id), pts = G.total(u.id), perDay = {};
    A.forUser(u.id).filter(a => a.status === 'approved').forEach(a => perDay[a.date] = (perDay[a.date] || 0) + 1);
    const days = Object.keys(perDay).length, jn = SPES.JournalModel.forUser(u.id).filter(j => j.status === 'submitted').length, top = G.leaderboard(u.batch)[0] || {};
    const perfect = Object.values(G.userProgress(u.id)).some(r => r.done && r.wrong === 0);
    return [
      ['First Room', 'games', rooms >= 1], ['5 Rooms', 'games', rooms >= 5], ['10 Rooms', 'games', rooms >= 10], ['15 Rooms', 'games', rooms >= 15], ['All 20 Rooms', 'badges', rooms >= 20],
      ['Perfect Room', 'review', perfect], ['500 Points', 'board', pts >= 500], ['1000 Points', 'board', pts >= 1000], ['First Check-in', 'attendance', days >= 1], ['Perfect Day', 'attendance', Object.values(perDay).some(c => c >= 4)],
      ['5 Days Present', 'attendance', days >= 5], ['10 Days Present', 'attendance', days >= 10], ['20 Days Present', 'attendance', days >= 20], ['First Journal', 'journal', jn >= 1], ['5 Journals', 'journal', jn >= 5],
      ['10 Journals', 'journal', jn >= 10], ['20 Journals', 'journal', jn >= 20], ['Point Starter', 'board', pts >= 100], ['Quiz Master', 'games', pts >= 300], ['Batch Leader', 'admin', top.name === u.name && pts > 0]
    ].map(([name, ic, got]) => ({ name, ic, got }));
  },

  dashboard(u) {
    const V = SPES.View, G = SPES.GameModel, A = SPES.AttendanceModel, J = SPES.JournalModel, M = SPES.UserModel;
    if (u.role === 'beneficiary') {
      const mine = A.forUser(u.id), cnt = st => mine.filter(a => a.status === st).length, done = G.completed(u.id), badges = this.badgeList(u);
      const recent = [...mine.filter(a => a.photo).map(a => ['Sent proof: ' + A.SLOTS[a.slot].label, a.submittedAt]), ...J.forUser(u.id).filter(j => j.status === 'submitted').map(j => ['Submitted Journal Day ' + j.day, j.updatedAt])]
        .sort((x, y) => y[1].localeCompare(x[1])).slice(0, 4).map(r => [r[0], V.when(r[1])]);
      return V.userDash({ name: u.name, att: { ok: cnt('approved'), pend: cnt('pending'), rej: cnt('rejected') + cnt('absent'), pct: mine.length ? Math.round(cnt('approved') / mine.length * 100) : 0 },
        stats: [['Days present', this.days(u, 'att').filter(x => x.state === 'full').length + ' / 20'], ['Total points', G.total(u.id)], ['Learning progress', done * 5 + '%'], ['Badges earned', badges.filter(b => b.got).length + ' / ' + badges.length]],
        rooms: G.TITLES.map((t, i) => { const r = G.room(u.id, i); return { i, t, open: G.isOpen(i), cls: r.done ? 'done' : G.isOpen(i) ? 'open' : 'soon' }; }), badges, recent, done,
        board: G.leaderboard(u.batch).slice(0, 3).map(r => ({ ...r, me: r.name === u.name })),
        events: SPES.EventModel.all().filter(e => e.date >= A.day()).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3) });
    }
    const all = A.all(), today = A.day(), users = M.all().filter(x => x.role === 'beneficiary'), ok = users.filter(x => x.status !== 'pending');
    const bx = SPES.BatchModel.all().map(b => { const mem = ok.filter(x => x.batch === b.code); return { name: b.name, code: b.code, members: mem.length, present: mem.filter(x => all.some(a => a.userId === x.id && a.date === today && a.status !== 'absent')).length }; });
    const links = [['approvals', 'Approvals'], ['review', 'Review attendance']].concat(u.role === 'admin' ? [['announce', 'Announcements'], ['admin', 'Batches']] : []);
    return V.staffDash(u.name, [['Beneficiaries', ok.length], ['Awaiting approval', users.length - ok.length], ['Pending attendance', all.filter(a => a.status === 'pending').length], ['Journals submitted', J.all().filter(j => j.status === 'submitted').length]], links, bx);
  },

  body(u, tab) {
    const V = SPES.View, s = this.s, G = SPES.GameModel, A = SPES.AttendanceModel, M = SPES.UserModel, N = SPES.NotifModel, names = Object.fromEntries(M.all().map(x => [x.id, x.name]));
    if (tab === 'dashboard') return this.dashboard(u);
    if (tab === 'attendance') { this.attSig = this.attSigNow(); const days = this.days(u, 'att'), n = this.selDay('day', u), d = days[n - 1], allow = d.today && !A.isRestDay(d.date) && !A.isWorkFromHome(d.date); return V.attendance(A.SLOTS, days, n, A.forUser(u.id).filter(a => a.date === d.date), allow, s.m); }
    if (tab === 'journal') {
      const days = this.days(u, 'jr'), n = this.selDay('jday', u), d = days[n - 1], saved = SPES.JournalModel.get(u.id, n);
      if (this.jkey !== n) { this.jkey = n; this.jpics = saved ? [...saved.photos] : []; }
      const en = this.draft ? { ...(saved || { status: 'draft' }), text: this.draft.text, event: this.draft.event } : saved; this.draft = null;
      return V.journal(days, n, en, SPES.EventModel.on(d.date), this.jpics, s.m);
    }
    if (tab === 'journals') return '<h2>Beneficiary journals</h2>' + V.entries(SPES.JournalModel.all().filter(j => j.status === 'submitted'), names);
    if (tab === 'review') return u.role === 'admin' ? V.review(A.all().slice().reverse().map(a => ({ ...a, name: names[a.userId], label: A.SLOTS[a.slot] ? A.SLOTS[a.slot].label : 'Attendance' })), s.m) : '<h1>Not authorized</h1>'; 
    if (tab === 'answers') {
      if (u.role !== 'admin') return '<h1>Not authorized</h1>';
      const K = SPES.KeyModel;
      if (s.keyOpen && Date.now() - s.keyOpen < 600000) { s.keyOpen = Date.now(); return V.answers(SPES.GameModel, s.m, s.keyMode); }
      s.keyOpen = 0;
      return V.keyGate(K.has(), s.keyMode, K.locked(), s.m);
    }
    if (tab === 'admin') return V.admin(SPES.BatchModel.all(), M.all(), s.m, s.room, { date: s.roomDate || A.day(), q: s.roomQ || '' });
    if (tab === 'approvals') return V.approvals(M.all().filter(x => x.status === 'pending'), c => (SPES.BatchModel.find(c) || { name: c }).name, s.m);
    if (tab === 'announce') return V.announce(SPES.BatchModel.all(), SPES.DB.get('ann', []), s.m);
    if (tab === 'feedback') return V.feedbackList(SPES.FeedbackModel.all());
    if (tab === 'notifs') { const html = V.notifs(N.for(u), u.seen); N.markSeen(u); return html; }
    if (tab === 'badges') return `<h1>Badges & achievements</h1><div class="card">${V.badges(this.badgeList(u))}</div>`;
    if (tab === 'profile') {
      const st = u.role === 'beneficiary' ? [['Total points', G.total(u.id)], ['Rooms completed', G.completed(u.id) + ' / 20'], ['Batch', u.batch]] : [['Role', u.role === 'admin' ? 'Administrator' : 'Office Head'], ['Username', u.username]];
      return V.profile(u, st, s.m);
    }
    if (tab === 'settings') return V.settings(u, s.sub === 'feedback' && u.role !== 'beneficiary' ? 'account' : s.sub, SPES.ActivityModel.for(u.id), s.m);
    if (tab === 'calendar') {
      const c = s.cal || (s.cal = { y: new Date().getFullYear(), m: new Date().getMonth() }), marks = {};
      if (u.role === 'beneficiary') A.forUser(u.id).filter(a => a.status === 'approved').forEach(a => marks[a.date] = 1);
      return V.calendar(c.y, c.m, SPES.EventModel.inMonth(c.y, c.m), marks, u.role === 'admin', s.m);
    }
    if (tab === 'board') {
      const batches = SPES.BatchModel.all(), cur = u.role === 'beneficiary' ? u.batch : (s.board || (batches[0] || {}).code);
      return V.leaderboard(G.leaderboard(cur), batches, cur, u.role !== 'beneficiary', u.name);
    }
    if (tab === 'games') return SPES.Games.body(u);
  }
};
