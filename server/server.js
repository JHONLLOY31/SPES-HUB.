// SERVER. Serves the web pages and a JSON API under /api. No packages needed.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { db, hashPassword, verifyPassword } = require('./db');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 3000, HOST = process.env.HOST || '127.0.0.1';
const SECURE = process.env.SECURE_COOKIES === '1';   // set to 1 once you serve over https
const WEEK = 7 * 24 * 3600;
const DUMMY = hashPassword('dummy');                  // makes "unknown user" take as long as "wrong password"

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const fail = (status, msg) => { throw { status, msg }; };
const pub = u => ({ id: u.id, spesId: u.spes_id, name: u.name, gender: u.gender, username: u.username, role: u.role, batchId: u.batch_id, status: u.status });

// ---- sessions: a random token in an HttpOnly cookie; only its hash is stored in the database ----
function tokenOf(req) { const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || ''); return m && m[1]; }
function userFor(req) {
  const t = tokenOf(req); if (!t) return null;
  return db.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'approved'").get(sha(t), Date.now()) || null;
}
function startSession(userId) {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha(token), userId, Date.now() + WEEK * 1000);
  return `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${WEEK}${SECURE ? '; Secure' : ''}`;
}

// ---- routes. roles: undefined = public, 'any' = any logged-in user, or a list of allowed roles ----
const routes = [];
const route = (method, pattern, roles, handler) => routes.push({ method, roles, handler, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$') });
const fails = new Map();                              // login attempts: 5 wrong passwords = 10 minute lock

route('GET', '/api/me', undefined, ({ user }) => [200, { user: user ? pub(user) : null }]);

route('POST', '/api/register', undefined, ({ body }) => {
  const name = str(body.name, 80), username = str(body.username, 30), gender = body.gender, code = str(body.batch, 40).toUpperCase();
  const password = typeof body.password === 'string' ? body.password : '';
  if (!name || !['Male', 'Female'].includes(gender) || !/^[A-Za-z0-9_.]{3,30}$/.test(username) || password.length < 6 || password.length > 100)
    fail(400, 'Fill in every field. Username: 3 to 30 letters or numbers. Password: at least 6 characters.');
  const batch = db.prepare('SELECT * FROM batches WHERE code = ?').get(code);
  if (!batch) fail(400, 'That batch code does not exist.');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) fail(409, 'That username is taken.');
  db.exec('BEGIN IMMEDIATE');
  try {
    const n = db.prepare("SELECT COUNT(*) AS c FROM users WHERE batch_id = ? AND role = 'beneficiary'").get(batch.id).c + 1;
    const spesId = `${batch.code}-${String(n).padStart(4, '0')}`;
    db.prepare("INSERT INTO users (spes_id, name, gender, username, password_hash, role, batch_id, status) VALUES (?, ?, ?, ?, ?, 'beneficiary', ?, 'pending')").run(spesId, name, gender, username, hashPassword(password), batch.id);
    db.exec('COMMIT');
    return [201, { ok: true, spesId }];
  } catch (e) { db.exec('ROLLBACK'); throw e; }
});

route('POST', '/api/login', undefined, ({ req, body }) => {
  const username = str(body.username, 60), password = typeof body.password === 'string' ? body.password : '';
  const portal = body.portal === 'admin' ? 'admin' : 'user';
  const key = `${req.socket.remoteAddress}|${username.toLowerCase()}`, f = fails.get(key);
  if (f && f.n >= 5 && f.until > Date.now()) fail(429, 'Too many attempts. Please try again in a few minutes.');
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!verifyPassword(password, u ? u.password_hash : DUMMY) || !u) {
    if (fails.size > 5000) fails.clear();
    fails.set(key, { n: (f && f.until > Date.now() ? f.n : 0) + 1, until: Date.now() + 600000 });
    fail(401, 'Wrong username or password.');
  }
  if ((u.role !== 'beneficiary') !== (portal === 'admin'))
    fail(403, u.role === 'beneficiary' ? 'This is a beneficiary account. Please use the beneficiary login page.' : 'This is a staff account. Please use the staff login page.');
  if (u.status === 'pending') fail(403, 'Your account is waiting for administrator approval.');
  if (u.status === 'rejected') fail(403, 'Your registration was not approved. Please contact the administrator.');
  fails.delete(key);
  return [200, { user: pub(u) }, { 'Set-Cookie': startSession(u.id) }];
});

route('POST', '/api/logout', undefined, ({ req }) => {
  const t = tokenOf(req); if (t) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(t));
  return [200, { ok: true }, { 'Set-Cookie': `sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${SECURE ? '; Secure' : ''}` }];
});

route('GET', '/api/batches', ['admin', 'head'], () => [200, { batches: db.prepare('SELECT id, name, code, year, start_date AS startDate FROM batches ORDER BY id DESC').all() }]);

route('POST', '/api/batches', ['admin'], ({ body }) => {
  const name = str(body.name, 60), year = Number(body.year) || new Date().getFullYear(), start = str(body.startDate, 10) || new Date().toISOString().slice(0, 10);
  if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(start)) fail(400, 'Enter a batch name and a valid start date.');
  const code = name.toUpperCase().replace(/\s*-\s*/g, '-').replace(/\s+/g, '-');
  if (db.prepare('SELECT 1 FROM batches WHERE code = ?').get(code)) fail(409, `A batch with the code ${code} already exists.`);
  const r = db.prepare('INSERT INTO batches (name, code, year, start_date) VALUES (?, ?, ?, ?)').run(name, code, year, start);
  return [201, { batch: { id: Number(r.lastInsertRowid), name, code, year, startDate: start } }];
});

route('GET', '/api/users', ['admin', 'head'], ({ url }) => {
  const status = ['pending', 'approved', 'rejected'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : null;
  const rows = db.prepare("SELECT u.*, b.code AS batch_code FROM users u LEFT JOIN batches b ON b.id = u.batch_id WHERE u.role = 'beneficiary' AND (? IS NULL OR u.status = ?) ORDER BY u.created_at DESC, u.id DESC").all(status, status);
  return [200, { users: rows.map(r => ({ ...pub(r), batchCode: r.batch_code })) }];
});

route('PATCH', '/api/users/:id/status', ['admin'], ({ params, body }) => {
  if (!['approved', 'rejected'].includes(body.status)) fail(400, 'Status must be approved or rejected.');
  const r = db.prepare("UPDATE users SET status = ? WHERE id = ? AND role = 'beneficiary'").run(body.status, Number(params.id));
  if (!r.changes) fail(404, 'Beneficiary not found.');
  return [200, { ok: true }];
});

// ---- request handling ----
const readJson = req => new Promise((ok, bad) => {
  const parts = []; let n = 0;
  req.on('data', c => { n += c.length; if (n > 1e6) { bad({ status: 413, msg: 'Request too large.' }); req.destroy(); } else parts.push(c); });
  req.on('end', () => { try { ok(JSON.parse(Buffer.concat(parts).toString() || '{}')); } catch { bad({ status: 400, msg: 'Invalid JSON.' }); } });
});
const send = (res, code, obj, headers = {}) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }); res.end(JSON.stringify(obj)); };

async function api(req, res, url) {
  const route = routes.find(r => r.method === req.method && r.re.test(url.pathname));
  if (!route) fail(404, 'Not found.');
  const writes = ['POST', 'PATCH', 'PUT'].includes(req.method);
  // Only JSON bodies are accepted. Together with SameSite cookies this blocks cross-site form attacks (CSRF).
  if (writes && !/^application\/json/.test(req.headers['content-type'] || '')) fail(415, 'Send JSON (Content-Type: application/json).');
  const user = userFor(req);
  if (route.roles) {
    if (!user) fail(401, 'Please log in.');
    if (route.roles !== 'any' && !route.roles.includes(user.role)) fail(403, 'You do not have permission to do that.');
  }
  const body = writes ? await readJson(req) : {};
  const [status, data, headers] = route.handler({ req, res, url, body, user, params: url.pathname.match(route.re).groups || {} });
  send(res, status, data, headers);
}

// ---- static files: only the website itself is public (never server/ or data/) ----
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const PUBLIC_FILE = /^\/(index\.html|admin\.html|(css|js|img)\/[\w./-]+)$/;
function serveStatic(req, res, url) {
  if (!['GET', 'HEAD'].includes(req.method)) fail(405, 'Method not allowed.');
  let p; try { p = decodeURIComponent(url.pathname); } catch { fail(400, 'Bad request.'); }
  if (p === '/') p = '/index.html';
  if (p.includes('..') || p.includes('\\') || p.includes('\0') || !PUBLIC_FILE.test(p)) fail(404, 'Not found.');
  const file = path.join(ROOT, p);
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { error: 'Not found.' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) await api(req, res, url); else serveStatic(req, res, url);
  } catch (e) {
    const status = e.status || 500; if (status === 500) console.error(e);
    send(res, status, { error: e.msg || 'Something went wrong on the server.' });
  }
});

module.exports = server;
if (require.main === module) server.listen(PORT, HOST, () => console.log(`SPES Hub is running:  http://localhost:${PORT}   (staff login: /admin.html)`));
